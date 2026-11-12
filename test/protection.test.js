// Seller Protection rules and sale readiness: the full decision matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessProtection, assessReadiness, readinessSummary, REASONS } from '../lib/protection.js';

const soon = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const order = { trackingNumber: '9400111899223197428490', carrier: 'USPS', delivered: '2026-10-30', addressMatches: true };
const dispute = (reason, due = soon(5)) => ({ reason, seller_response_due_date: due });

for (const reason of [REASONS.INR, REASONS.UNAUTH]) {
  test(`${reason}: full proof is likely covered`, () => assert.equal(assessProtection(dispute(reason), order).status, 'LIKELY_COVERED'));
  test(`${reason}: no tracking is fixable evidence`, () => assert.equal(assessProtection(dispute(reason), { ...order, trackingNumber: '' }).status, 'NEEDS_EVIDENCE'));
  test(`${reason}: not delivered is fixable evidence`, () => assert.equal(assessProtection(dispute(reason), { ...order, delivered: null }).status, 'NEEDS_EVIDENCE'));
  test(`${reason}: wrong address is not covered`, () => assert.equal(assessProtection(dispute(reason), { ...order, addressMatches: false }).status, 'NOT_COVERED'));
  test(`${reason}: no order record at all is fixable evidence`, () => assert.equal(assessProtection(dispute(reason), null).status, 'NEEDS_EVIDENCE'));
}
test('not as described is never covered, even with full proof', () => {
  assert.equal(assessProtection(dispute(REASONS.SNAD), { ...order, signature: true }).status, 'NOT_COVERED');
});
test('other claim types are outside Seller Protection', () => {
  for (const r of ['CREDIT_NOT_PROCESSED', 'DUPLICATE_TRANSACTION', 'INCORRECT_AMOUNT', '']) assert.equal(assessProtection(dispute(r), order).status, 'NOT_COVERED', r);
});
test('a missed deadline beats everything else', () => {
  assert.equal(assessProtection(dispute(REASONS.INR, soon(-1)), order).status, 'NOT_COVERED');
});
test('no deadline returned is not treated as missed', () => {
  assert.equal(assessProtection(dispute(REASONS.INR, null), order).status, 'LIKELY_COVERED');
});
test('PayPal\'s own NOT_ELIGIBLE flag can only lower the verdict', () => {
  assert.equal(assessProtection(dispute(REASONS.INR), order, { status: 'NOT_ELIGIBLE' }).status, 'NOT_COVERED');
  assert.equal(assessProtection(dispute(REASONS.INR), order, { status: 'ELIGIBLE', disputeCategories: ['ITEM_NOT_RECEIVED'] }).status, 'LIKELY_COVERED');
});
test('PayPal\'s flag must cover this claim category', () => {
  assert.equal(assessProtection(dispute(REASONS.INR), order, { status: 'ELIGIBLE', disputeCategories: ['UNAUTHORIZED_TRANSACTION'] }).status, 'NOT_COVERED');
});
test('a signature strengthens proof but is never required', () => {
  const r = assessProtection(dispute(REASONS.INR), { ...order, signature: true });
  assert.equal(r.status, 'LIKELY_COVERED');
  assert.ok(r.checks.some((c) => /Signature/.test(c.rule)));
});
test('every result says the rules vary by country', () => {
  assert.match(assessProtection(dispute(REASONS.INR), order).note, /varies by country/);
});
const sale = (o) => ({ ...order, onHold: false, ...o });
test('readiness: each status, by who has to act', () => {
  assert.equal(assessReadiness(sale()).status, 'READY');
  assert.equal(assessReadiness(sale({ onHold: true })).status, 'AGENT_CAN_FIX');
  assert.equal(assessReadiness(sale({ delivered: null })).status, 'WAITING');
  assert.equal(assessReadiness(sale({ trackingNumber: '' })).status, 'AT_RISK');
  assert.equal(assessReadiness(sale({ addressMatches: false })).status, 'AT_RISK');
});
test('readiness: a seller-side gap outranks one the agent can fix', () => {
  assert.equal(assessReadiness(sale({ onHold: true, addressMatches: false })).status, 'AT_RISK');
});
test('readiness: optional evidence never blocks READY', () => {
  assert.equal(assessReadiness(sale({ catalog: null })).status, 'READY');
  assert.equal(assessReadiness(sale({ mandate: { id: 'M-1', want: 'x', maxPrice: 5 } })).status, 'READY');
});
test('readiness summary: counts, dollars, fixable and average days without proof', () => {
  const today = new Date().toISOString().slice(0, 10);
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const s = readinessSummary([
    sale({ amount: 10, soldAt: ago(4), trackingSentAt: ago(2) }),
    sale({ amount: 20, onHold: true, soldAt: ago(6), trackingSentAt: null }),
  ]);
  assert.deepEqual([s.total, s.ready, s.fixable, s.amountReady, s.amountTotal], [2, 1, 1, 10, 30]);
  assert.equal(s.avgDaysExposed, 4); // (2 + 6) / 2
  assert.ok(today);
});
test('readiness summary: an empty shop', () => {
  const s = readinessSummary([]);
  assert.deepEqual([s.total, s.ready, s.avgDaysExposed], [0, 0, 0]);
});
