import { workspace } from './workspace.js';

// In-memory demo store. The seller's own order records (what they shipped, how).
// PayPal does not know tracking numbers until the agent sends them.
// Delivery dates are relative to today, so the demo never goes stale.
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const ORDERS = () => [
    { demo: true, transactionId: '5TY05013RG002845M', soldAt: ago(14), trackingSentAt: ago(13), disputeId: 'PP-D-1001', item: 'Handmade ceramic mug set', buyer: 'j.doe@example.com', amount: 64.0, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: ago(10), addressMatches: true, signature: true, onHold: false, paypalProtection: { status: 'ELIGIBLE', disputeCategories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] } },
    { demo: true, transactionId: '8MC585209K746392H', soldAt: ago(17), trackingSentAt: ago(16), disputeId: 'PP-D-1002', item: 'Vintage denim jacket', buyer: 'sam.k@example.com', amount: 120.0, carrier: 'UPS', trackingNumber: '1Z999AA10123456784', delivered: ago(13), addressMatches: true, onHold: false },
    { demo: true, transactionId: '3HK26519EU112054W', soldAt: ago(12), trackingSentAt: ago(11), disputeId: 'PP-D-1003', item: 'Phone case (wrong color)', buyer: 'lee.m@example.com', amount: 18.0, carrier: 'USPS', trackingNumber: '9400111899223197428111', delivered: ago(8), addressMatches: true, onHold: false },
    { demo: true, transactionId: '9JK41126LM553201P', soldAt: ago(9), trackingSentAt: ago(8), disputeId: 'PP-D-1004', item: 'Wool throw blanket', buyer: 'r.chen@example.com', amount: 210.0, carrier: 'UPS', trackingNumber: '1Z999AA10198765432', delivered: null, addressMatches: true, onHold: false, paypalProtection: { status: 'ELIGIBLE', disputeCategories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] } },
    { demo: true, transactionId: '1AB23456CD789012E', soldAt: ago(9), trackingSentAt: null, item: 'Leather wallet', buyer: 'ana.p@example.com', amount: 85.0, carrier: 'FEDEX', trackingNumber: '772899172350', delivered: ago(5), onHold: true, daysHeld: 9 },
    { demo: true, transactionId: '7FG89012HI345678J', soldAt: ago(14), trackingSentAt: null, item: 'Scented candle bundle', buyer: 'tom.r@example.com', amount: 42.5, carrier: 'USPS', trackingNumber: '9400111899223197428777', delivered: null, onHold: true, daysHeld: 14 },
];

const fresh = () => ({
  orders: ORDERS(),
  proposals: [],
  // Autopilot: agent acts alone when amount <= maxAmount and confidence >= minConfidence.
  autopilot: { enabled: false, maxAmount: 100, minConfidence: 0.8 },
  actions: [],
  activity: [],
  reminders: {}, // invoiceId -> YYYY-MM-DD the seller scheduled on the timeline
  schedule: {},  // proposalId -> { at: YYYY-MM-DD, fingerprint } approved on the agent calendar
});
const S = () => { const w = workspace(); return (w.store ??= fresh()); };

// `store` reads and writes the current visitor's workspace (see lib/workspace.js).
export const store = new Proxy({}, {
  get: (_t, k) => S()[k],
  set: (_t, k, v) => { S()[k] = v; return true; },
});

export function logAction(a) {
  const entry = { at: new Date().toISOString(), ...a };
  store.actions.unshift(entry);
  return entry;
}

export function resetStore() {
  const s = S();
  // Keep real storefront orders that still need tracking; restore demo records.
  s.orders = [...s.orders.filter((o) => o.live && o.onHold), ...ORDERS()]; // registered demo-mode sales are dropped
  s.proposals = [];
  s.actions = [];
  s.activity = [];
  s.reminders = {};
  s.schedule = {};
}
