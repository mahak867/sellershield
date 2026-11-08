// SellerShield: AI agent that protects a small seller's money on PayPal.
// Runs in MOCK mode when keys are missing, so judges can try it with zero setup.
import 'dotenv/config';
import express from 'express';
import { paypal, MOCK_PAYPAL } from './lib/paypal.js';
import { ai, MOCK_AI } from './lib/ai.js';
import { store, logAction, resetStore } from './lib/store.js';
import { assessProtection } from './lib/protection.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/vendor/ag-grid', express.static('node_modules/ag-grid-community'));

// Minutes a seller would spend doing each action by hand (for the "time saved" KPI).
const MINUTES_SAVED = { dispute: 45, invoice: 10, hold: 15 };

async function getRisk() {
  const [disputes, invoices] = await Promise.all([paypal.listDisputes(), paypal.listUnpaidInvoices()]);
  const holds = store.orders.filter((o) => o.onHold);
  return { disputes, invoices, holds };
}

// AI reviews every risk item and proposes one action each.
async function scan() {
  const { disputes, invoices, holds } = await getRisk();
  const proposals = [];
  const disputePlans = await Promise.all(disputes.map(async (d) => {
    const detail = await paypal.getDispute(d.dispute_id);
    const order = store.orders.find((o) => o.transactionId === d.transaction_id);
    const protection = assessProtection(detail || d, order);
    return { d, protection, plan: await ai.planDispute(detail, order, protection) };
  }));
  for (const { d, plan, protection } of disputePlans) {
    proposals.push({ id: `dispute:${d.dispute_id}`, kind: 'dispute', target: d.dispute_id, amount: d.amount, demo: !!d.demo, protection, ...plan });
  }
  const invoicePlans = await Promise.all(invoices.map(async (inv) => ({ inv, plan: await ai.planReminder(inv) })));
  for (const { inv, plan } of invoicePlans) {
    proposals.push({ id: `invoice:${inv.id}`, kind: 'invoice', target: inv.id, amount: inv.amount, demo: !!inv.demo, ...plan });
  }
  for (const o of holds) {
    proposals.push({
      id: `hold:${o.transactionId}`, kind: 'hold', target: o.transactionId, amount: o.amount, demo: !!o.demo,
      decision: 'ADD_TRACKING', confidence: o.live ? 0.95 : o.delivered ? 0.92 : 0.8,
      reasoning: o.live
        ? `Paid through PayPal Checkout (capture ${o.transactionId}, ${o.captureStatus}). Shipped with ${o.carrier} but PayPal has no tracking. Without it you lose "item not received" disputes and new-seller funds can stay held.`
        : `Funds held ${o.daysHeld} days. Shipped with ${o.carrier} ${o.trackingNumber} but tracking never reached PayPal. Adding it can trigger early release.`,
      draft: `${o.carrier} ${o.trackingNumber}`,
    });
  }
  store.proposals = proposals;
  return proposals;
}

// Execute one proposal on PayPal.
async function execute(id, draft, by = 'seller') {
  const p = store.proposals.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error(`proposal ${id} not found; run a scan first`), { status: 404 });
  const text = draft ?? p.draft;
  let result;
  if (p.kind === 'dispute') {
    result = p.decision === 'ACCEPT'
      ? await paypal.acceptClaim(p.target, text)
      : await paypal.provideEvidence(p.target, text, store.orders.find((o) => o.disputeId === p.target || o.transactionId === p.target));
  } else if (p.kind === 'invoice') {
    result = await paypal.remindInvoice(p.target, text);
  } else if (p.kind === 'hold') {
    result = await paypal.addTracking(store.orders.find((x) => x.transactionId === p.target));
  }
  store.proposals = store.proposals.filter((x) => x.id !== id);
  return logAction({
    kind: p.kind, target: p.target, decision: p.decision, amount: p.amount, confidence: p.confidence,
    by, simulated: !!result?.simulated, text, minutesSaved: MINUTES_SAVED[p.kind],
  });
}

const qualifies = (p, ap) => ap.enabled && p.amount <= ap.maxAmount && p.confidence >= ap.minConfidence;

app.get('/api/status', (_req, res) => {
  res.json({ mockPaypal: MOCK_PAYPAL, mockAi: MOCK_AI, autopilot: store.autopilot });
});

app.get('/api/risk', async (_req, res, next) => {
  try { res.json({ ...(await getRisk()), actions: store.actions, proposals: store.proposals }); } catch (e) { next(e); }
});

// Scan, then let autopilot act on what qualifies. The rest waits for the seller.
// ---------- Live activity (Server-Sent Events) ----------
const clients = new Set();
function activity(kind, text, extra = {}) {
  const e = { at: new Date().toISOString(), kind, text, ...extra };
  store.activity.unshift(e);
  store.activity.length = Math.min(store.activity.length, 50);
  for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`);
  return e;
}
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ kind: 'hello' })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
app.get('/api/activity', (_req, res) => res.json(store.activity));

// Scan, then let autopilot act on what qualifies. The rest waits for the seller.
async function runAgent(trigger) {
  const proposals = await scan();
  const auto = [];
  for (const p of proposals.filter((x) => qualifies(x, store.autopilot))) auto.push(await execute(p.id, undefined, 'autopilot'));
  activity('agent', `Agent reviewed ${proposals.length} item${proposals.length === 1 ? '' : 's'} (${trigger})${auto.length ? `; autopilot handled ${auto.length} worth $${auto.reduce((s, a) => s + a.amount, 0).toFixed(2)}` : ''}; ${store.proposals.length} waiting for you.`);
  return { proposals: store.proposals, auto };
}

app.post('/api/agent/scan', async (_req, res, next) => {
  try { res.json(await runAgent('manual run')); } catch (e) { next(e); }
});

// ---------- PayPal webhooks: the agent reacts the moment money is at risk ----------
const WEBHOOK_EVENTS = {
  'CUSTOMER.DISPUTE.CREATED': 'New dispute opened',
  'CUSTOMER.DISPUTE.UPDATED': 'Dispute updated',
  'PAYMENT.CAPTURE.COMPLETED': 'Payment captured',
  'INVOICING.INVOICE.PAID': 'Invoice paid',
};
app.post('/api/webhooks/paypal', async (req, res) => {
  const ev = req.body || {};
  if (!MOCK_PAYPAL) {
    const ok = await paypal.verifyWebhook(req.headers, ev).catch((e) => { console.warn('webhook verify failed:', e.message); return false; });
    if (!ok) return res.status(400).json({ error: 'signature not verified (set PAYPAL_WEBHOOK_ID)' });
  }
  res.sendStatus(200); // ack fast; PayPal retries slow endpoints
  const label = WEBHOOK_EVENTS[ev.event_type];
  if (!label) return;
  activity('webhook', `PayPal webhook: ${label} (${ev.resource?.dispute_id || ev.resource?.id || 'n/a'})`);
  runAgent(`webhook ${ev.event_type}`).catch((e) => activity('error', `Agent run failed: ${e.message}`));
});

// Demo: simulate a buyer opening a dispute, to show the real-time loop without a buyer account.
app.post('/api/demo/simulate-dispute', async (_req, res, next) => {
  try {
    const d = paypal.addDemoDispute();
    activity('webhook', `Simulated: new dispute ${d.dispute_id} for $${d.amount.toFixed(2)} (item not received)`);
    res.json(await runAgent('new dispute'));
  } catch (e) { next(e); }
});

app.post('/api/agent/approve', async (req, res, next) => {
  try { res.json({ ok: true, entry: await execute(req.body.id, req.body.draft) }); } catch (e) { next(e); }
});

app.post('/api/autopilot', (req, res) => {
  const { enabled, maxAmount, minConfidence } = req.body;
  if (enabled !== undefined) store.autopilot.enabled = !!enabled;
  if (maxAmount !== undefined) store.autopilot.maxAmount = Math.max(0, Number(maxAmount));
  if (minConfidence !== undefined) store.autopilot.minConfidence = Math.min(1, Math.max(0, Number(minConfidence)));
  res.json(store.autopilot);
});

// Chat with a tool-using agent that can inspect and act on the seller's PayPal account.
app.post('/api/agent/chat', async (req, res, next) => {
  try {
    const out = await ai.agent(String(req.body.message ?? '').slice(0, 2000), {
      get_money_at_risk: getRisk,
      scan: async () => ({ proposals: await scan() }),
      execute_proposal: async ({ id }) => execute(id, undefined, 'chat agent'),
    });
    res.json(out);
  } catch (e) { next(e); }
});

// Creates real overdue invoices in the PayPal sandbox so the demo uses live data.
app.post('/api/demo/seed', async (_req, res, next) => {
  try {
    const seeds = [
      { email: 'billing@acme-studio.example', name: 'Acme', memo: 'Logo + brand kit design', amount: 1500, daysOverdue: 19 },
      { email: 'ops@bluecafe.example', name: 'Blue Cafe', memo: 'Menu photography', amount: 320, daysOverdue: 5 },
      { email: 'hello@northwind.example', name: 'Northwind', memo: 'Website copywriting', amount: 75, daysOverdue: 32 },
    ];
    const created = [];
    for (const s of seeds) created.push(await paypal.seedInvoice(s));
    res.json({ created });
  } catch (e) { next(e); }
});

// ---------- Storefront: real PayPal Checkout ----------
const PRODUCTS = [
  { sku: 'wallet', name: 'Leather wallet', price: 85, carrier: 'FEDEX' },
  { sku: 'candle', name: 'Scented candle bundle', price: 42.5, carrier: 'USPS' },
  { sku: 'mugs', name: 'Handmade ceramic mug set', price: 64, carrier: 'USPS' },
];
app.get('/api/shop/config', (_req, res) => {
  res.json({ clientId: MOCK_PAYPAL ? null : process.env.PAYPAL_CLIENT_ID, products: PRODUCTS });
});
app.post('/api/shop/order', async (req, res, next) => {
  try {
    const p = PRODUCTS.find((x) => x.sku === req.body.sku);
    if (!p) return res.status(400).json({ error: 'unknown product' });
    res.json({ id: await paypal.createOrder(p) });
  } catch (e) { next(e); }
});
// After capture the seller "ships" it, but tracking hasn't reached PayPal yet: exactly
// the gap that triggers holds and lost "item not received" disputes. The agent closes it.
app.post('/api/shop/capture', async (req, res, next) => {
  try {
    const sku = req.body.sku;
    const p = PRODUCTS.find((x) => x.sku === sku) || { name: 'Item', carrier: 'USPS' };
    const c = await paypal.captureOrder(String(req.body.orderId));
    const tracking = p.carrier === 'FEDEX' ? String(Date.now()).slice(-12) : '9400' + String(Date.now()).padStart(18, '1').slice(-18);
    store.orders.unshift({
      demo: false, live: true, orderId: c.orderId, transactionId: c.captureId, item: p.name,
      buyer: c.buyer || 'sandbox buyer', amount: c.amount, carrier: p.carrier, trackingNumber: tracking,
      delivered: null, onHold: true, daysHeld: 0, captureStatus: c.captureStatus,
    });
    res.json(c);
    activity('sale', `New PayPal Checkout sale: ${p.name} for $${c.amount.toFixed(2)} (capture ${c.captureId}). Shipped; tracking not yet on PayPal.`);
    runAgent('new sale').catch((e) => activity('error', `Agent run failed: ${e.message}`));
  } catch (e) { next(e); }
});

// Restore demo data and clear the log (for clean demo retakes). Real sandbox invoices stay.
app.post('/api/demo/reset', (_req, res) => {
  resetStore();
  paypal.resetDemo();
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SellerShield on :${port} (paypal ${MOCK_PAYPAL ? 'MOCK' : 'SANDBOX'}, ai ${MOCK_AI ? 'MOCK' : 'LIVE'})`));

// Keep the demo server alive if a stray network socket errors (e.g. a dropped proxy tunnel).
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e?.message ?? e));
