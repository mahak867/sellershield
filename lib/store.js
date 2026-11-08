// In-memory demo store. The seller's own order records (what they shipped, how).
// PayPal does not know tracking numbers until the agent sends them.
export const store = {
  orders: [
    { transactionId: '5TY05013RG002845M', disputeId: 'PP-D-1001', item: 'Handmade ceramic mug set', buyer: 'j.doe@example.com', amount: 64.0, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', onHold: false },
    { transactionId: '8MC585209K746392H', disputeId: 'PP-D-1002', item: 'Vintage denim jacket', buyer: 'sam.k@example.com', amount: 120.0, carrier: 'UPS', trackingNumber: '1Z999AA10123456784', delivered: '2026-10-27', onHold: false },
    { transactionId: '3HK26519EU112054W', disputeId: 'PP-D-1003', item: 'Phone case (wrong color)', buyer: 'lee.m@example.com', amount: 18.0, carrier: 'USPS', trackingNumber: '9400111899223197428111', delivered: '2026-11-01', onHold: false },
    { transactionId: '1AB23456CD789012E', item: 'Leather wallet', buyer: 'ana.p@example.com', amount: 85.0, carrier: 'FEDEX', trackingNumber: '772899172350', delivered: '2026-11-04', onHold: true, daysHeld: 9 },
    { transactionId: '7FG89012HI345678J', item: 'Scented candle bundle', buyer: 'tom.r@example.com', amount: 42.5, carrier: 'USPS', trackingNumber: '9400111899223197428777', delivered: null, onHold: true, daysHeld: 14 },
  ],
  proposals: [],
  actions: [],
};

export function logAction(a) {
  const entry = { at: new Date().toISOString(), ...a };
  store.actions.unshift(entry);
  return entry;
}
