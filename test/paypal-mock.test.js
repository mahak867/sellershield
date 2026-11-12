// PayPal client in demo mode: data stays per visitor, actions are labelled simulated.
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { paypal, MOCK_PAYPAL } = await import('../lib/paypal.js');
const { runIn } = await import('../lib/workspace.js');

const A = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', B = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
test('no keys means demo mode', () => assert.equal(MOCK_PAYPAL, true));
test('demo disputes have future deadlines and are tagged demo', async () => {
  const ds = await runIn(A, () => paypal.listDisputes());
  assert.equal(ds.length, 4);
  const today = new Date().toISOString().slice(0, 10);
  for (const d of ds) { assert.equal(d.demo, true); assert.ok(d.seller_response_due_date > today, d.dispute_id); }
});
test('demo invoices are overdue by the stated number of days', async () => {
  for (const i of await runIn(A, () => paypal.listUnpaidInvoices())) {
    const days = Math.round((Date.now() - new Date(i.due_date)) / 86400000);
    assert.ok(Math.abs(days - i.days_overdue) <= 1, i.id);
  }
});
test('answering a dispute removes it, only in that visitor\'s workspace', async () => {
  const r = await runIn(A, () => paypal.provideEvidence('PP-D-1001', 'note', null, null));
  assert.equal(r.simulated, true);
  assert.equal((await runIn(A, () => paypal.listDisputes())).some((d) => d.dispute_id === 'PP-D-1001'), false);
  assert.equal((await runIn(B, () => paypal.listDisputes())).some((d) => d.dispute_id === 'PP-D-1001'), true);
});
test('a simulated dispute on an agent-made sale carries that sale\'s details', () => {
  const d = runIn(A, () => paypal.addDemoDispute({ transactionId: 'CAPTEST', amount: 12.5, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', message: 'm' }));
  assert.deepEqual([d.transaction_id, d.amount, d.reason, d.demo], ['CAPTEST', 12.5, 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', true]);
});
test('adding tracking clears the hold and records when it was sent', async () => {
  const o = { demo: true, onHold: true, trackingNumber: '1', carrier: 'USPS' };
  const r = await runIn(A, () => paypal.addTracking(o));
  assert.equal(r.simulated, true);
  assert.equal(o.onHold, false);
  assert.equal(o.trackingSentAt, new Date().toISOString().slice(0, 10));
});
test('reset restores the demo data', async () => {
  runIn(A, () => paypal.resetDemo());
  assert.equal((await runIn(A, () => paypal.listDisputes())).length, 4);
});
test('the sandbox-only settle refuses demo disputes', async () => {
  await assert.rejects(runIn(A, () => paypal.sandboxSettle('PP-D-1001')), /only for real sandbox disputes|sandbox only/);
});
