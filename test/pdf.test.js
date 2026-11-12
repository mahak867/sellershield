// Evidence PDF: structure, content and robustness to awkward input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disputePack } from '../lib/pdf.js';
import { buildRecords } from '../lib/evidence.js';
import { assessProtection } from '../lib/protection.js';

const dispute = { dispute_id: 'PP-D-9001', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 64, transaction_id: 'TX12345678', seller_response_due_date: '2099-01-01' };
const order = { transactionId: 'TX12345678', item: 'Mug', amount: 64, carrier: 'USPS', trackingNumber: '9400111899223197428490', delivered: '2026-10-30', addressMatches: true };
const proposal = (o = {}) => ({ target: 'PP-D-9001', decision: 'FIGHT', amount: 64, fingerprint: 'a'.repeat(64), records: buildRecords(dispute, order), protection: assessProtection(dispute, order), ...o });
const text = (buf) => buf.toString('latin1');
const pages = (buf) => (text(buf).match(/\/Type \/Page\b/g) || []).length;

test('a valid PDF: header, cross-reference table and trailer', () => {
  const b = disputePack(proposal(), 'Delivered on 2026-10-30 [R2].');
  const s = text(b);
  assert.equal(s.slice(0, 8), '%PDF-1.4');
  assert.match(s, /xref\n0 \d+\n0000000000 65535 f/);
  assert.match(s, /startxref\n\d+\n%%EOF\n$/);
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
});
test('every object offset in the cross-reference table is exact', () => {
  const s = text(disputePack(proposal(), 'x'));
  const offsets = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`));
});
test('contains the summary, the verdict, the checklist and the records', () => {
  const s = text(disputePack(proposal(), 'Delivered on 2026-10-30 [R2].'));
  for (const want of ['Dispute evidence pack', 'PP-D-9001', 'Item not received', 'Likely covered by Seller Protection', 'Seller Protection checklist', 'Records cited', 'Seller order book', 'Approval fingerprint aaaaaaaaaaaaaaaa']) {
    assert.ok(s.includes(want), want);
  }
});
test('an accepted claim is labelled as a message to the buyer', () => {
  const s = text(disputePack(proposal({ decision: 'ACCEPT' }), 'Sorry, refunded.'));
  assert.ok(s.includes('Seller accepts the claim'));
  assert.ok(s.includes('Message to the buyer'));
});
test('a long response flows onto more pages, each numbered', () => {
  const b = disputePack(proposal(), 'Delivered on 2026-10-30 [R2]. '.repeat(400));
  assert.ok(pages(b) >= 3);
  assert.ok(text(b).includes(`Page ${pages(b)} of ${pages(b)}`));
});
test('awkward text is escaped and non-Latin characters never break the file', () => {
  const s = text(disputePack(proposal(), 'Brackets (like this) and a backslash \\ and quotes “hi” and emoji \u{1F600} and 中文.'));
  assert.ok(s.includes('Brackets \\(like this\\)'));
  assert.ok(s.includes('"hi"'));
  assert.match(s, /%%EOF\n$/);
});
test('a very long unbroken id is hard-wrapped instead of running off the page', () => {
  assert.match(text(disputePack(proposal(), 'X'.repeat(600))), /%%EOF\n$/);
});
test('works with no protection result and no records', () => {
  const s = text(disputePack(proposal({ protection: null, records: [] }), 'x'));
  assert.ok(s.includes('No records were cited.'));
});
test('an agent-made purchase gets a whose-mistake section', () => {
  const fault = { questions: [{ q: 'Did the buyer authorize this purchase?', answer: 'yes', detail: 'd' }, { q: 'Did the agent stay inside its mandate?', answer: 'yes', detail: 'd' }, { q: 'Did the merchant deliver what was ordered?', answer: 'unknown', detail: 'd' }], verdict: { who: 'open', text: 'Pending delivery.' } };
  const s = text(disputePack(proposal({ fault }), 'x'));
  assert.ok(s.includes('Whose mistake was it?'));
  assert.ok(s.includes('Pending delivery.'));
});
