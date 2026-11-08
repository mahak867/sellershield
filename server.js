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

app.get('/api/status', (_req, res) => {
  res.json({ mockPaypal: MOCK_PAYPAL, mockAi: MOCK_AI, actions: store.actions.length });
});

// Pull everything at risk: disputes, unpaid invoices, held orders without tracking.
app.get('/api/risk', async (_req, res, next) => {
  try {
    const [disputes, invoices] = await Promise.all([paypal.listDisputes(), paypal.listUnpaidInvoices()]);
    const holds = store.orders.filter((o) => o.onHold);
    res.json({ disputes, invoices, holds, actions: store.actions });
  } catch (e) { next(e); }
});

// Agent scan: AI reviews every risk item and proposes one action each.
// Nothing touches PayPal until the seller approves (human in the loop).
app.post('/api/agent/scan', async (_req, res, next) => {
  try {
    const disputes = await paypal.listDisputes();
    const invoices = await paypal.listUnpaidInvoices();
    const holds = store.orders.filter((o) => o.onHold && !o.trackingAdded);
    const proposals = [];

    for (const d of disputes) {
      const detail = await paypal.getDispute(d.dispute_id);
      const order = store.orders.find((o) => o.transactionId === d.transaction_id);
      const plan = await ai.planDispute(detail, order);
      proposals.push({ id: `dispute:${d.dispute_id}`, kind: 'dispute', target: d.dispute_id, amount: d.amount, ...plan });
    }
    for (const inv of invoices) {
      const plan = await ai.planReminder(inv);
      proposals.push({ id: `invoice:${inv.id}`, kind: 'invoice', target: inv.id, amount: inv.amount, ...plan });
    }
    for (const o of holds) {
      proposals.push({
        id: `hold:${o.transactionId}`, kind: 'hold', target: o.transactionId, amount: o.amount,
        decision: 'ADD_TRACKING', confidence: 0.9,
        reasoning: `Funds held ${o.daysHeld} days. Order shipped with ${o.carrier} ${o.trackingNumber} but tracking never sent to PayPal. Adding it can trigger early release.`,
        draft: `${o.carrier} ${o.trackingNumber}`,
      });
    }
    store.proposals = proposals;
    res.json({ proposals });
  } catch (e) { next(e); }
});

// Seller approves a proposal: agent executes it on PayPal.
app.post('/api/agent/approve', async (req, res, next) => {
  try {
    const { id, draft } = req.body;
    const p = store.proposals.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'proposal not found' });
    const text = draft ?? p.draft;
    let result;
    if (p.kind === 'dispute') {
      result = p.decision === 'ACCEPT'
        ? await paypal.acceptClaim(p.target, text)
        : await paypal.provideEvidence(p.target, text, store.orders.find((o) => o.disputeId === p.target));
    } else if (p.kind === 'invoice') {
      result = await paypal.remindInvoice(p.target, text);
    } else if (p.kind === 'hold') {
      const o = store.orders.find((x) => x.transactionId === p.target);
      result = await paypal.addTracking(o);
      o.trackingAdded = true;
    }
    store.proposals = store.proposals.filter((x) => x.id !== id);
    const entry = logAction({ kind: p.kind, target: p.target, decision: p.decision, amount: p.amount, text, result });
    res.json({ ok: true, entry });
  } catch (e) { next(e); }
});

// Free-form chat with the agent about the seller's money.
app.post('/api/agent/chat', async (req, res, next) => {
  try {
    const [disputes, invoices] = await Promise.all([paypal.listDisputes(), paypal.listUnpaidInvoices()]);
    const reply = await ai.chat(req.body.message ?? '', { disputes, invoices, holds: store.orders.filter((o) => o.onHold), actions: store.actions });
    res.json({ reply });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SellerShield on :${port} (paypal ${MOCK_PAYPAL ? 'MOCK' : 'SANDBOX'}, ai ${MOCK_AI ? 'MOCK' : 'LIVE'})`));
