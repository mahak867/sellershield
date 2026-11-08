// SellerShield: AI agent that protects a small seller's money on PayPal.
// Runs in MOCK mode when keys are missing, so judges can try it with zero setup.
import 'dotenv/config';
import express from 'express';
import { paypal, MOCK_PAYPAL } from './lib/paypal.js';
import { ai, MOCK_AI } from './lib/ai.js';
import { store, logAction } from './lib/store.js';

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
    return { d, plan: await ai.planDispute(detail, order) };
  }));
  for (const { d, plan } of disputePlans) {
    proposals.push({ id: `dispute:${d.dispute_id}`, kind: 'dispute', target: d.dispute_id, amount: d.amount, demo: !!d.demo, ...plan });
  }
  const invoicePlans = await Promise.all(invoices.map(async (inv) => ({ inv, plan: await ai.planReminder(inv) })));
  for (const { inv, plan } of invoicePlans) {
    proposals.push({ id: `invoice:${inv.id}`, kind: 'invoice', target: inv.id, amount: inv.amount, demo: !!inv.demo, ...plan });
  }
  for (const o of holds) {
    proposals.push({
      id: `hold:${o.transactionId}`, kind: 'hold', target: o.transactionId, amount: o.amount, demo: !!o.demo,
      decision: 'ADD_TRACKING', confidence: o.delivered ? 0.92 : 0.8,
      reasoning: `Funds held ${o.daysHeld} days. Shipped with ${o.carrier} ${o.trackingNumber} but tracking never reached PayPal. Adding it can trigger early release.`,
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
app.post('/api/agent/scan', async (_req, res, next) => {
  try {
    const proposals = await scan();
    const auto = [];
    for (const p of proposals.filter((x) => qualifies(x, store.autopilot))) auto.push(await execute(p.id, undefined, 'autopilot'));
    res.json({ proposals: store.proposals, auto });
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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SellerShield on :${port} (paypal ${MOCK_PAYPAL ? 'MOCK' : 'SANDBOX'}, ai ${MOCK_AI ? 'MOCK' : 'LIVE'})`));
