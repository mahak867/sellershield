// SellerShield: AI agent that protects a small seller's money on PayPal.
// Runs in MOCK mode when keys are missing, so judges can try it with zero setup.
import 'dotenv/config';
import express from 'express';
import { paypal, MOCK_PAYPAL } from './lib/paypal.js';
import { ai, MOCK_AI } from './lib/ai.js';
import { store, logAction, resetStore } from './lib/store.js';
import { assessProtection } from './lib/protection.js';
import { workspaceMiddleware, workspaceId, SHARED, forEachWorkspace } from './lib/workspace.js';
import { buildRecords, checkDraft, fingerprint, renderForPayPal } from './lib/evidence.js';
import { disputePack } from './lib/pdf.js';
import { catalogFacts, CHANNEL3_ON } from './lib/channel3.js';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.set('trust proxy', 1); // Render sits behind a proxy; use the real client IP for limits
app.use(workspaceMiddleware);

// Simple fixed-window rate limits so a public demo can't be used to spam PayPal's sandbox.
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
  h.n += 1;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  return h.n <= max;
}
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST' || req.path.startsWith('/webhooks/')) return next();
  if (!limit(`ip:${req.ip}`, 120, 60_000)) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  next();
});
app.use(express.static('public'));
app.use('/vendor/ag-grid', express.static('node_modules/ag-grid-community'));
app.get('/api/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile('apimatic/src/spec/openapi.yaml', { root: process.cwd() }));
app.use('/vendor/ag-charts', express.static('node_modules/ag-charts-community/dist/umd'));
app.use('/vendor/bryntum', express.static('node_modules/@bryntum/scheduler-trial'));

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
    const live = await paypal.liveRecords(d, order);
    // "Not as described" is outside Seller Protection: add independent catalog facts (Channel3).
    if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' && order?.item) live.catalog = await catalogFacts(order.item);
    const flag = live.capture?.sellerProtection || order?.paypalProtection;
    const protection = assessProtection(detail || d, order, flag);
    const records = buildRecords({ ...d, ...(detail || {}) }, order, live);
    const plan = await ai.planDispute(detail, order, protection, records);
    return { d, protection, records, order, plan, issues: checkDraft(plan.draft, records) };
  }));
  store.disputeDue = Object.fromEntries(disputes.map((d) => [d.dispute_id, d.seller_response_due_date]));
  for (const { d, plan, protection, records, order, issues } of disputePlans) {
    proposals.push({ id: `dispute:${d.dispute_id}`, kind: 'dispute', target: d.dispute_id, amount: d.amount, demo: !!d.demo,
      protection, records, issues, orderTx: order?.transactionId, ...plan });
  }
  const invoicePlans = await Promise.all(invoices.map(async (inv) => ({ inv, plan: await ai.planReminder(inv) })));
  for (const { inv, plan } of invoicePlans) {
    const scheduledFor = store.reminders[inv.id] || today();
    proposals.push({ id: `invoice:${inv.id}`, kind: 'invoice', target: inv.id, amount: inv.amount, demo: !!inv.demo, scheduledFor, ...plan,
      reasoning: scheduledFor > today() ? `${plan.reasoning} Scheduled by you for ${scheduledFor}; autopilot will wait.` : plan.reasoning });
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
  for (const p of proposals) p.fingerprint = fingerprint({ kind: p.kind, decision: p.decision, target: p.target, text: p.draft });
  // A scheduled action was approved with a specific fingerprint: keep that exact proposal.
  for (const [i, p] of proposals.entries()) {
    const prev = store.schedule[p.id] && store.proposals.find((x) => x.id === p.id);
    if (prev) proposals[i] = prev;
  }
  for (const p of proposals) if (store.schedule[p.id]) p.scheduledAt = store.schedule[p.id].at;
  store.proposals = proposals;
  return proposals;
}

// Execute one proposal on PayPal.
// The approval must carry the fingerprint of exactly the text being sent: a changed draft
// is a different payload and needs its own approval. Dispute text must pass the citation check.
// Guards against double-sends: one in-flight execution per item, and for real PayPal objects
// one write per target in 10 minutes across all visitors (two judges can't both answer one dispute).
const inflight = new Set();
const realWrites = new Map();
async function execute(id, draft, by = 'seller', approvedFingerprint) {
  const p = store.proposals.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error(`proposal ${id} not found; run a scan first`), { status: 404 });
  const lockKey = p.demo ? `${workspaceId()}:${id}` : `real:${id}`;
  if (inflight.has(lockKey)) throw Object.assign(new Error('This action is already being sent.'), { status: 409 });
  const last = realWrites.get(id);
  if (!p.demo && !MOCK_PAYPAL && last && Date.now() - last < 600_000) {
    throw Object.assign(new Error('This PayPal item was already acted on in the last 10 minutes.'), { status: 409 });
  }
  inflight.add(lockKey);
  try { return await executeOnce(p, id, draft, by, approvedFingerprint); }
  finally { inflight.delete(lockKey); }
}

async function executeOnce(p, id, draft, by, approvedFingerprint) {
  const text = draft ?? p.draft;
  const fp = fingerprint({ kind: p.kind, decision: p.decision, target: p.target, text });
  if (by === 'seller' && approvedFingerprint !== fp) {
    throw Object.assign(new Error('Approval fingerprint does not match the text being sent. Review the draft and approve again.'), { status: 409 });
  }
  if (by !== 'seller' && fp !== p.fingerprint) throw Object.assign(new Error('Agent may only send the draft it proposed.'), { status: 409 });
  if (by === 'calendar' && store.schedule[id]?.fingerprint !== fp) throw Object.assign(new Error('Scheduled approval does not match the draft.'), { status: 409 });
  if (p.kind === 'dispute' && p.decision !== 'ACCEPT') {
    const issues = checkDraft(text, p.records || []);
    if (issues.length) throw Object.assign(new Error(`Citation check failed: ${issues.map((i) => `${i.code} (${i.detail})`).join('; ')}`), { status: 422, issues });
  }
  let result;
  if (p.kind === 'dispute') {
    const order = store.orders.find((o) => o.transactionId === p.orderTx);
    result = p.decision === 'ACCEPT'
      ? await paypal.acceptClaim(p.target, text)
      : await paypal.provideEvidence(p.target, renderForPayPal(text, p.records || []), order, disputePack(p, text));
  } else if (p.kind === 'invoice') {
    result = await paypal.remindInvoice(p.target, text);
  } else if (p.kind === 'hold') {
    result = await paypal.addTracking(store.orders.find((x) => x.transactionId === p.target));
  }
  store.proposals = store.proposals.filter((x) => x.id !== id);
  delete store.schedule[id];
  if (!p.demo && !result?.simulated) realWrites.set(id, Date.now());
  return logAction({
    kind: p.kind, target: p.target, decision: p.decision, amount: p.amount, confidence: p.confidence,
    by, fingerprint: fp, simulated: !!result?.simulated, text: result?.via ? `[sent as buyer message: PayPal not taking evidence at this stage] ${text}` : text,
    minutesSaved: MINUTES_SAVED[p.kind],
  });
}

const today = () => new Date().toISOString().slice(0, 10);

// Autopilot never sends a draft that fails the citation check, and respects reminder dates the seller set.
const qualifies = (p, ap) => ap.enabled && p.amount <= ap.maxAmount && p.confidence >= ap.minConfidence
  && !(p.issues || []).length && !(p.kind === 'invoice' && p.scheduledFor > today());

app.get('/api/status', (_req, res) => {
  res.json({ mockPaypal: MOCK_PAYPAL, mockAi: MOCK_AI, channel3: CHANNEL3_ON, autopilot: store.autopilot });
});

app.get('/api/risk', async (_req, res, next) => {
  try { res.json({ ...(await getRisk()), actions: store.actions, proposals: store.proposals, reminders: store.reminders, schedule: Object.fromEntries(Object.entries(store.schedule).map(([k, v]) => [k, v.at])) }); } catch (e) { next(e); }
});

// Scan, then let autopilot act on what qualifies. The rest waits for the seller.
// ---------- Live activity (Server-Sent Events) ----------
const clients = new Map(); // res -> workspace id
// Activity goes to the current visitor; events from PayPal itself (shared workspace) go to everyone.
function activity(kind, text, extra = {}) {
  const e = { at: new Date().toISOString(), kind, text, ...extra };
  store.activity.unshift(e);
  store.activity.length = Math.min(store.activity.length, 50);
  const ws = workspaceId();
  for (const [res, id] of clients) if (ws === SHARED || id === ws) res.write(`data: ${JSON.stringify(e)}\n\n`);
  return e;
}
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ kind: 'hello' })}\n\n`);
  clients.set(res, workspaceId());
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
const seenEvents = new Set();
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
  if (ev.id) { // PayPal retries deliveries; handle each event once
    if (seenEvents.has(ev.id)) return;
    seenEvents.add(ev.id);
    if (seenEvents.size > 1000) seenEvents.delete(seenEvents.values().next().value);
  }
  const label = WEBHOOK_EVENTS[ev.event_type];
  if (!label) return;
  activity('webhook', `PayPal webhook: ${label} (${ev.resource?.dispute_id || ev.resource?.id || 'n/a'})`);
  runAgent(`webhook ${ev.event_type}`).catch((e) => activity('error', `Agent run failed: ${e.message}`));
});

// SANDBOX ONLY: let PayPal decide a real sandbox dispute, to show the full lifecycle.
app.post('/api/disputes/:id/sandbox-settle', async (req, res, next) => {
  try {
    const r = await paypal.sandboxSettle(req.params.id, req.body?.outcome === 'BUYER_FAVOR' ? 'BUYER_FAVOR' : 'SELLER_FAVOR');
    activity('webhook', `PayPal (sandbox) decided dispute ${req.params.id}: ${r.outcome || r.status} [${r.steps.join('; ')}]`);
    res.json(r);
  } catch (e) { next(e); }
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
  try { res.json({ ok: true, entry: await execute(req.body.id, req.body.draft, 'seller', req.body.fingerprint) }); } catch (e) { next(e); }
});

// Download the evidence pack (PDF) for a dispute proposal, with the seller's current draft.
app.post('/api/agent/pack', (req, res) => {
  const p = store.proposals.find((x) => x.id === req.body?.id && x.kind === 'dispute');
  if (!p) return res.status(404).json({ error: 'dispute proposal not found' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="evidence-${p.target}.pdf"` });
  res.send(disputePack(p, String(req.body.draft ?? p.draft).slice(0, 5000)));
});

app.post('/api/agent/check', (req, res) => {
  const p = store.proposals.find((x) => x.id === req.body.id);
  if (!p) return res.status(404).json({ error: 'proposal not found' });
  const text = String(req.body.draft ?? p.draft);
  res.json({
    fingerprint: fingerprint({ kind: p.kind, decision: p.decision, target: p.target, text }),
    issues: p.kind === 'dispute' && p.decision !== 'ACCEPT' ? checkDraft(text, p.records || []) : [],
  });
});

// Seller records the carrier's delivery confirmation (the missing Seller Protection proof).
// The agent re-runs: the dispute's coverage and draft update from the new fact.
app.post('/api/orders/:tx/delivered', async (req, res, next) => {
  try {
    const o = store.orders.find((x) => x.transactionId === req.params.tx);
    if (!o) return res.status(404).json({ error: 'order not found' });
    const date = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return res.status(400).json({ error: 'Enter the delivery date as YYYY-MM-DD, today or earlier.' });
    o.delivered = date;
    o.deliveredSource = 'carrier confirmation entered by seller';
    activity('agent', `Delivery confirmation recorded for ${o.item} (${o.carrier} ${o.trackingNumber}, delivered ${date}). Re-checking Seller Protection.`);
    res.json(await runAgent('delivery confirmed'));
  } catch (e) { next(e); }
});

// ---------- Agent calendar (Bryntum): scheduling an action approves it for that day ----------
app.post('/api/schedule', (req, res) => {
  const { id, at, fingerprint: fp } = req.body || {};
  const p = store.proposals.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'proposal not found; run the agent first' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(at))) return res.status(400).json({ error: 'at must be YYYY-MM-DD' });
  if (at < today()) return res.status(400).json({ error: 'Pick today or a later day.' });
  if (fp !== p.fingerprint) return res.status(409).json({ error: 'The draft changed. Review it, then schedule again.' });
  if ((p.issues || []).length) return res.status(422).json({ error: 'This draft fails the citation check. Fix it before scheduling.' });
  if (p.kind === 'dispute') {
    const due = store.disputeDue?.[p.target];
    if (due && at > due) return res.status(400).json({ error: `PayPal needs a response by ${due}. Pick that day or earlier.` });
  }
  store.schedule[id] = { at, fingerprint: fp };
  p.scheduledAt = at;
  if (p.kind === 'invoice') store.reminders[p.target] = at;
  activity('agent', `Approved ${p.decision.replaceAll('_', ' ').toLowerCase()} on ${p.target} to run ${at === today() ? 'today' : 'on ' + at}.`);
  res.json({ ok: true, id, at });
});
app.delete('/api/schedule', (req, res) => {
  const id = String(req.query.id || '');
  const p = store.proposals.find((x) => x.id === id);
  delete store.schedule[id];
  if (p) delete p.scheduledAt;
  res.json({ ok: true });
});

// Background scheduler: runs approved actions when their day arrives, in every workspace.
async function runSchedule() {
  await forEachWorkspace(async () => {
    for (const [id, s] of Object.entries(store.schedule || {})) {
      if (s.at > today()) continue;
      try {
        const e = await execute(id, undefined, 'calendar');
        activity('agent', `Calendar: ran ${e.decision.replaceAll('_', ' ').toLowerCase()} on ${e.target} ($${e.amount.toFixed(2)}).`);
      } catch (err) {
        delete store.schedule[id];
        activity('error', `Calendar: could not run ${id}: ${err.message}`);
      }
    }
  });
}
setInterval(() => runSchedule().catch((e) => console.error('scheduler', e)), 15_000).unref();

// Seller drags a reminder on the Bryntum timeline: the agent waits until that date.
app.post('/api/reminders', (req, res) => {
  const { invoiceId, at } = req.body || {};
  if (!/^[\w-]{3,64}$/.test(String(invoiceId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(at))) return res.status(400).json({ error: 'invoiceId and at (YYYY-MM-DD) required' });
  store.reminders[invoiceId] = at;
  const p = store.proposals.find((x) => x.id === `invoice:${invoiceId}`);
  if (p) p.scheduledFor = at;
  activity('agent', `Reminder for ${invoiceId} scheduled for ${at}${at > today() ? '; autopilot will wait until then' : ''}.`);
  res.json({ ok: true, invoiceId, at });
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
app.post('/api/demo/seed', async (req, res, next) => {
  try {
    if (!limit(`seed:${req.ip}`, 3, 600_000) || !limit('seed:all', 60, 86_400_000)) {
      return res.status(429).json({ error: 'Sandbox data was loaded recently. Use Run agent on the existing invoices.' });
    }
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
      delivered: null, onHold: true, daysHeld: 0, captureStatus: c.captureStatus, paypalProtection: c.sellerProtection,
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
