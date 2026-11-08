// Labelled dispute cases for the policy test suite (`npm run bench`).
// Labels were written by hand from PayPal's published Seller Protection rules and a simple
// seller-economics principle: don't spend time fighting small claims you will probably lose.
// `coverage` = expected Seller Protection status; `decision` = what a careful seller advisor would do.
const INR = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const SNAD = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';
const UNAUTH = 'UNAUTHORISED';
const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const order = (o) => ({ item: 'Item', carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', addressMatches: true, ...o });

export const CASES = [
  // Item not received: full proof of delivery -> covered, fight
  { id: 'inr-full-1', d: { reason: INR, amount: 64, due: 6 }, o: order({}), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'inr-full-2', d: { reason: INR, amount: 12, due: 3 }, o: order({}), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'inr-full-3', d: { reason: INR, amount: 980, due: 9 }, o: order({ signature: true }), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'inr-full-4', d: { reason: INR, amount: 140, due: 1 }, o: order({ carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'inr-full-5', d: { reason: INR, amount: 33, due: 10 }, o: order({ carrier: 'FEDEX', trackingNumber: '772899172350' }), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  // Item not received: shipped with tracking, not yet delivered -> needs evidence
  { id: 'inr-transit-big', d: { reason: INR, amount: 210, due: 8 }, o: order({ delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'FIGHT' },
  { id: 'inr-transit-mid', d: { reason: INR, amount: 75, due: 5 }, o: order({ delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'FIGHT' },
  { id: 'inr-transit-small', d: { reason: INR, amount: 22, due: 5 }, o: order({ delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  { id: 'inr-transit-tiny', d: { reason: INR, amount: 9, due: 4 }, o: order({ delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  // Item not received: no tracking at all
  { id: 'inr-notrack-1', d: { reason: INR, amount: 45, due: 6 }, o: order({ trackingNumber: null, delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  { id: 'inr-notrack-2', d: { reason: INR, amount: 18, due: 6 }, o: order({ trackingNumber: null, delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  { id: 'inr-noorder', d: { reason: INR, amount: 60, due: 6 }, o: null, coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  // Shipped to a different address than the PayPal transaction -> not covered
  { id: 'inr-addr-1', d: { reason: INR, amount: 300, due: 7 }, o: order({ addressMatches: false }), coverage: 'NOT_COVERED', decision: 'FIGHT' },
  { id: 'inr-addr-2', d: { reason: INR, amount: 20, due: 7 }, o: order({ addressMatches: false }), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  // Unauthorized payment with proof of delivery -> covered
  { id: 'unauth-full', d: { reason: UNAUTH, amount: 150, due: 8 }, o: order({}), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'unauth-full-small', d: { reason: UNAUTH, amount: 15, due: 8 }, o: order({}), coverage: 'LIKELY_COVERED', decision: 'FIGHT' },
  { id: 'unauth-notrack', d: { reason: UNAUTH, amount: 90, due: 8 }, o: order({ trackingNumber: null, delivered: null }), coverage: 'NEEDS_EVIDENCE', decision: 'ACCEPT' },
  // Not as described -> never covered; fight only when meaningful and backed by delivery proof
  { id: 'snad-big-proof', d: { reason: SNAD, amount: 120, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'FIGHT' },
  { id: 'snad-mid-proof', d: { reason: SNAD, amount: 60, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'FIGHT' },
  { id: 'snad-small-1', d: { reason: SNAD, amount: 18, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'snad-small-2', d: { reason: SNAD, amount: 24, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'snad-notrack', d: { reason: SNAD, amount: 80, due: 6 }, o: order({ trackingNumber: null, delivered: null }), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'snad-big-nodeliv', d: { reason: SNAD, amount: 400, due: 6 }, o: order({ delivered: null }), coverage: 'NOT_COVERED', decision: 'FIGHT' },
  // Response deadline already passed -> nothing to win
  { id: 'late-inr', d: { reason: INR, amount: 64, due: -1 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'late-snad', d: { reason: SNAD, amount: 500, due: -2 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'late-unauth', d: { reason: UNAUTH, amount: 200, due: 0 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  // Other / unknown reasons -> not a Seller Protection type
  { id: 'other-1', d: { reason: 'CREDIT_NOT_PROCESSED', amount: 70, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'FIGHT' },
  { id: 'other-2', d: { reason: 'DUPLICATE_TRANSACTION', amount: 15, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'other-3', d: { reason: 'INCORRECT_AMOUNT', amount: 11, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'ACCEPT' },
  { id: 'other-4', d: { reason: 'PAYMENT_BY_OTHER_MEANS', amount: 240, due: 6 }, o: order({}), coverage: 'NOT_COVERED', decision: 'FIGHT' },
].map((c) => ({
  ...c,
  dispute: { dispute_id: c.id, reason: c.d.reason, amount: c.d.amount, seller_response_due_date: soon(c.d.due) },
}));
