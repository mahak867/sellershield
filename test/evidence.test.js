// Citation checker, records and fingerprints: edge cases and randomised checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecords, checkDraft, fingerprint, renderForPayPal } from '../lib/evidence.js';

const dispute = { dispute_id: 'PP-D-9001', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 64, transaction_id: 'TX12345678', seller_response_due_date: '2026-11-20' };
const order = { transactionId: 'TX12345678', item: 'Mug', amount: 64, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', addressMatches: true };
const recs = () => buildRecords(dispute, order);

test('records: numbered in order, dispute first, order book last', () => {
  const r = recs();
  assert.deepEqual(r.map((x) => x.ref), ['R1', 'R2']);
  assert.match(r[0].source, /Dispute/);
  assert.match(r[1].source, /Seller order book/);
});
test('records: empty fields are dropped', () => {
  const r = buildRecords(dispute, { ...order, delivered: null, signature: false });
  assert.equal('delivered' in r[1].fields, false);
  assert.equal('signature' in r[1].fields, false);
});
test('records: a buyer agent mandate becomes its own record', () => {
  const r = buildRecords(dispute, { ...order, mandate: { id: 'M-ABCDEF123456', want: 'coffee gift', maxPrice: 70, fingerprint: 'f'.repeat(64) } });
  const m = r.find((x) => x.source === 'Buyer agent mandate');
  assert.equal(m.id, 'M-ABCDEF123456');
  assert.equal(m.fields.price_limit, '$70.00');
  assert.equal(m.fields.mandate_fingerprint.length, 16);
});
test('citations: a record id itself can be cited', () => {
  assert.deepEqual(checkDraft('Dispute PP-D-9001 was opened [R1].', recs()), []);
});
test('citations: a value from a different record than the one cited fails', () => {
  const issues = checkDraft('Tracking 9400111899223197428490 [R1].', recs());
  assert.equal(issues[0].code, 'VALUE_NOT_IN_CITED_RECORD');
});
test('citations: citing two records lets a sentence use values from both', () => {
  assert.deepEqual(checkDraft('Dispute PP-D-9001 [R1] concerns tracking 9400111899223197428490 [R2].', recs()), []);
});
test('citations: every sentence is checked, not just the first', () => {
  const issues = checkDraft('Delivered on 2026-10-30 [R2]. Refunded $999.00 [R2]. Due 2026-11-20 [R1].', recs());
  assert.deepEqual(issues.map((i) => i.detail), ['$999.00']);
});
test('citations: opinions and requests need no citation', () => {
  assert.deepEqual(checkDraft('We ask PayPal to rule for the seller. Thank you for reviewing this case!', recs()), []);
});
test('citations: an empty draft has no issues', () => {
  assert.deepEqual(checkDraft('', recs()), []);
});
test('citations (randomised): any dollar amount not in the record is refused', () => {
  for (let i = 0; i < 200; i++) {
    const cents = Math.floor(Math.random() * 1e6);
    if (cents === 6400) continue;
    const v = `$${(cents / 100).toFixed(2)}`;
    const issues = checkDraft(`The amount was ${v} [R2].`, recs());
    assert.equal(issues.length, 1, v);
  }
});
test('citations (randomised): any date other than the recorded one is refused', () => {
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 3000) * 86400000).toISOString().slice(0, 10);
    if (d === '2026-10-30') continue;
    assert.equal(checkDraft(`Delivered on ${d} [R2].`, recs()).length, 1, d);
  }
});
test('fingerprint: any one-character change gives a different fingerprint', () => {
  const base = { kind: 'dispute', decision: 'FIGHT', target: 'PP-D-9001', text: 'Delivered on 2026-10-30 [R2].' };
  const f = fingerprint(base);
  assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(f, fingerprint({ ...base }));
  for (const k of Object.keys(base)) assert.notEqual(f, fingerprint({ ...base, [k]: base[k] + 'x' }), k);
});
test('render: keeps the draft and appends only the records it cites', () => {
  const out = renderForPayPal('Delivered on 2026-10-30 [R2].', recs());
  assert.match(out, /^Delivered on 2026-10-30 \[R2\]\./);
  assert.match(out, /R2: Seller order book/);
  assert.doesNotMatch(out, /R1:/);
});
test('render: no citations means no appendix', () => {
  assert.equal(renderForPayPal('Thank you.', recs()), 'Thank you.');
});
