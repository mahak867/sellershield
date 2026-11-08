// Run with: npm test   (no keys needed; uses mock PayPal and rule-based AI)
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.ANTHROPIC_API_KEY = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessProtection } from '../lib/protection.js';
import { buildRecords, checkDraft, fingerprint, renderForPayPal } from '../lib/evidence.js';
import { CASES } from '../bench/cases.js';
import { ai } from '../lib/ai.js';

const soon = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const order = { transactionId: 'TX12345678', item: 'Mug', amount: 64, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', addressMatches: true };
const inr = { dispute_id: 'PP-D-1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 64, transaction_id: 'TX12345678', seller_response_due_date: soon(5) };

test('Seller Protection: delivered INR is likely covered', () => {
  assert.equal(assessProtection(inr, order).status, 'LIKELY_COVERED');
});
test('Seller Protection: not-as-described is never covered', () => {
  assert.equal(assessProtection({ ...inr, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' }, order).status, 'NOT_COVERED');
});
test('Seller Protection: missing delivery is fixable evidence', () => {
  assert.equal(assessProtection(inr, { ...order, delivered: null }).status, 'NEEDS_EVIDENCE');
});
test('Seller Protection: wrong address is not covered', () => {
  assert.equal(assessProtection(inr, { ...order, addressMatches: false }).status, 'NOT_COVERED');
});
test('Seller Protection: missed deadline is not covered', () => {
  assert.equal(assessProtection({ ...inr, seller_response_due_date: soon(-1) }, order).status, 'NOT_COVERED');
});

test('Citations: values from a cited record pass', () => {
  const recs = buildRecords(inr, order);
  assert.deepEqual(checkDraft('Shipped with tracking 9400111899223197428490 [R2]. Delivered on 2026-10-30 [R2].', recs), []);
});
test('Citations: a factual sentence without a citation fails', () => {
  const issues = checkDraft('Delivered on 2026-10-30.', buildRecords(inr, order));
  assert.equal(issues[0].code, 'NO_CITATION');
});
test('Citations: a value missing from the cited record fails', () => {
  const issues = checkDraft('Delivered on 2026-11-02 [R2].', buildRecords(inr, order));
  assert.equal(issues[0].code, 'VALUE_NOT_IN_CITED_RECORD');
});
test('Citations: an unknown record ref fails', () => {
  const issues = checkDraft('Delivered on 2026-10-30 [R9].', buildRecords(inr, order));
  assert.ok(issues.some((i) => i.code === 'UNKNOWN_RECORD'));
});
test('Citations: plain requests need no citation', () => {
  assert.deepEqual(checkDraft('We ask that the case be decided in the seller\'s favor.', buildRecords(inr, order)), []);
});
test('Citations: PayPal text carries a record appendix', () => {
  const out = renderForPayPal('Delivered on 2026-10-30 [R2].', buildRecords(inr, order));
  assert.match(out, /Records:\nR2: Seller order book/);
});

test('Fingerprint: one changed character changes the fingerprint', () => {
  const a = fingerprint({ kind: 'dispute', decision: 'FIGHT', target: 'X', text: 'hello' });
  const b = fingerprint({ kind: 'dispute', decision: 'FIGHT', target: 'X', text: 'hello.' });
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('Rule planner drafts always pass the citation check', async () => {
  for (const c of CASES) {
    const recs = buildRecords(c.dispute, c.o);
    const plan = await ai.planDispute(c.dispute, c.o, assessProtection(c.dispute, c.o), recs);
    if (plan.decision === 'FIGHT') assert.deepEqual(checkDraft(plan.draft, recs), [], `${c.id}: ${plan.draft}`);
  }
});

test('Policy suite: coverage and decision match every label', async () => {
  for (const c of CASES) {
    const prot = assessProtection(c.dispute, c.o);
    assert.equal(prot.status, c.coverage, `${c.id} coverage`);
    const plan = await ai.planDispute(c.dispute, c.o, prot, buildRecords(c.dispute, c.o));
    assert.equal(plan.decision, c.decision, `${c.id} decision`);
  }
});

test("Seller Protection: PayPal's NOT_ELIGIBLE flag overrides a full checklist", () => {
  const r = assessProtection(inr, order, { status: 'NOT_ELIGIBLE', disputeCategories: [] });
  assert.equal(r.status, 'NOT_COVERED');
  assert.ok(r.checks.some((c) => c.rule.startsWith("PayPal's own") && !c.pass));
});
test("Seller Protection: PayPal's ELIGIBLE flag for the right category passes", () => {
  const r = assessProtection(inr, order, { status: 'ELIGIBLE', disputeCategories: ['ITEM_NOT_RECEIVED'] });
  assert.equal(r.status, 'LIKELY_COVERED');
});
test("Seller Protection: eligible only for unauthorized does not cover item-not-received", () => {
  const r = assessProtection(inr, order, { status: 'PARTIALLY_ELIGIBLE', disputeCategories: ['UNAUTHORIZED_TRANSACTION'] });
  assert.equal(r.status, 'NOT_COVERED');
});
