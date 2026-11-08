import { workspace } from './workspace.js';

// In-memory demo store. The seller's own order records (what they shipped, how).
// PayPal does not know tracking numbers until the agent sends them.
const ORDERS = () => [
    { demo: true, transactionId: '5TY05013RG002845M', disputeId: 'PP-D-1001', item: 'Handmade ceramic mug set', buyer: 'j.doe@example.com', amount: 64.0, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', addressMatches: true, signature: true, onHold: false },
    { demo: true, transactionId: '8MC585209K746392H', disputeId: 'PP-D-1002', item: 'Vintage denim jacket', buyer: 'sam.k@example.com', amount: 120.0, carrier: 'UPS', trackingNumber: '1Z999AA10123456784', delivered: '2026-10-27', addressMatches: true, onHold: false },
    { demo: true, transactionId: '3HK26519EU112054W', disputeId: 'PP-D-1003', item: 'Phone case (wrong color)', buyer: 'lee.m@example.com', amount: 18.0, carrier: 'USPS', trackingNumber: '9400111899223197428111', delivered: '2026-11-01', addressMatches: true, onHold: false },
    { demo: true, transactionId: '9JK41126LM553201P', disputeId: 'PP-D-1004', item: 'Wool throw blanket', buyer: 'r.chen@example.com', amount: 210.0, carrier: 'UPS', trackingNumber: '1Z999AA10198765432', delivered: null, addressMatches: true, onHold: false },
    { demo: true, transactionId: '1AB23456CD789012E', item: 'Leather wallet', buyer: 'ana.p@example.com', amount: 85.0, carrier: 'FEDEX', trackingNumber: '772899172350', delivered: '2026-11-04', onHold: true, daysHeld: 9 },
    { demo: true, transactionId: '7FG89012HI345678J', item: 'Scented candle bundle', buyer: 'tom.r@example.com', amount: 42.5, carrier: 'USPS', trackingNumber: '9400111899223197428777', delivered: null, onHold: true, daysHeld: 14 },
];

const fresh = () => ({
  orders: ORDERS(),
  proposals: [],
  // Autopilot: agent acts alone when amount <= maxAmount and confidence >= minConfidence.
  autopilot: { enabled: false, maxAmount: 100, minConfidence: 0.8 },
  actions: [],
  activity: [],
  reminders: {}, // invoiceId -> YYYY-MM-DD the seller scheduled on the timeline
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
  s.orders = [...s.orders.filter((o) => o.live && o.onHold), ...ORDERS()];
  s.proposals = [];
  s.actions = [];
  s.activity = [];
  s.reminders = {};
}
