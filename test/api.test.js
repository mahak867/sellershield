// End-to-end API tests against a real server process in mock mode (no keys needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3199;
const URL = `http://127.0.0.1:${PORT}`;
let srv;

before(async () => {
  srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${URL}/api/status`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => srv.kill());

let cookie = '';
const post = async (path, body, jar = true) => {
  const r = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jar && cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}) });
  const set = r.headers.get('set-cookie');
  if (jar && set) cookie = set.split(';')[0];
  return r;
};

test('scan proposes an action for every item, with fingerprints and records', async () => {
  const r = await (await post('/api/agent/scan')).json();
  assert.ok(r.proposals.length >= 7);
  for (const p of r.proposals) assert.match(p.fingerprint, /^[0-9a-f]{64}$/);
  const d = r.proposals.find((p) => p.kind === 'dispute' && p.decision === 'FIGHT');
  assert.ok(d.records.length >= 2);
  assert.deepEqual(d.issues, []);
});

test('approval with a stale fingerprint is refused (409)', async () => {
  const { proposals } = await (await post('/api/agent/scan')).json();
  const p = proposals[0];
  const r = await post('/api/agent/approve', { id: p.id, draft: p.draft + ' Edited.', fingerprint: p.fingerprint });
  assert.equal(r.status, 409);
});

test('an uncited fact in an edited dispute draft is refused (422)', async () => {
  const { proposals } = await (await post('/api/agent/scan')).json();
  const p = proposals.find((x) => x.kind === 'dispute' && x.decision === 'FIGHT');
  const draft = 'The buyer signed for it on 2026-01-01.';
  const { fingerprint } = await (await post('/api/agent/check', { id: p.id, draft })).json();
  const r = await post('/api/agent/approve', { id: p.id, draft, fingerprint });
  assert.equal(r.status, 422);
});

test('approval with the matching fingerprint executes and is logged', async () => {
  const { proposals } = await (await post('/api/agent/scan')).json();
  const p = proposals.find((x) => x.kind === 'invoice');
  const r = await (await post('/api/agent/approve', { id: p.id, fingerprint: p.fingerprint })).json();
  assert.equal(r.ok, true);
  assert.equal(r.entry.fingerprint, p.fingerprint);
});

test('autopilot acts only within limits', async () => {
  await post('/api/demo/reset');
  await post('/api/autopilot', { enabled: true, maxAmount: 100, minConfidence: 0.8 });
  const r = await (await post('/api/agent/scan')).json();
  assert.ok(r.auto.length > 0);
  for (const a of r.auto) { assert.ok(a.amount <= 100); assert.ok(a.confidence >= 0.8); assert.equal(a.by, 'autopilot'); }
  await post('/api/autopilot', { enabled: false });
});

test('sandbox settle refuses demo disputes (400)', async () => {
  const r = await post('/api/disputes/PP-D-1001/sandbox-settle');
  assert.equal(r.status, 400);
});

test('each visitor gets an isolated workspace', async () => {
  await post('/api/demo/reset');
  const mine = await (await post('/api/agent/scan')).json();
  const p = mine.proposals.find((x) => x.kind === 'invoice');
  await post('/api/agent/approve', { id: p.id, fingerprint: p.fingerprint });
  // A second visitor (no cookie) still sees that invoice and an empty audit log.
  const other = await post('/api/agent/scan', {}, false);
  const theirs = await other.json();
  assert.ok(theirs.proposals.some((x) => x.id === p.id));
  const r = await fetch(URL + '/api/risk', { headers: { Cookie: other.headers.get('set-cookie').split(';')[0] } });
  assert.equal((await r.json()).actions.length, 0);
});

test('readiness: sending tracking makes one more sale protection-ready', async () => {
  await post('/api/demo/reset');
  const risk = async () => (await fetch(URL + '/api/risk', { headers: { Cookie: cookie } })).json();
  const before = (await risk()).readiness;
  const { proposals } = await (await post('/api/agent/scan')).json();
  const hold = proposals.find((x) => x.kind === 'hold' && x.target === '1AB23456CD789012E');
  assert.equal((await post('/api/agent/approve', { id: hold.id, fingerprint: hold.fingerprint })).status, 200);
  const after = (await risk()).readiness;
  assert.equal(after.ready, before.ready + 1);
  assert.equal(after.fixable, before.fixable - 1);
});

test('MCP: another agent can read, but may act only inside the seller\'s autopilot limits', async () => {
  let sid = '';
  const rpc = async (method, params, id = 1) => {
    const r = await fetch(URL + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sid ? { 'Mcp-Session-Id': sid } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    sid ||= r.headers.get('mcp-session-id') || '';
    return r.json();
  };
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'sellershield');
  assert.match(sid, /^[0-9a-f-]{36}$/);
  const note = await fetch(URL + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  assert.deepEqual((await rpc('tools/list')).result.tools.map((t) => t.name), ['get_protection_readiness', 'get_money_at_risk', 'review_account', 'approve_action']);
  assert.equal((await call('get_protection_readiness')).structuredContent.ready, 3);

  const { proposals } = (await call('review_account')).structuredContent;
  const small = proposals.find((p) => p.id === 'hold:1AB23456CD789012E');
  const big = proposals.find((p) => p.kind === 'invoice' && p.amount > 100);
  assert.equal(small.withinPolicy, false); // autopilot is off by default
  const off = await call('approve_action', { id: small.id, fingerprint: small.fingerprint });
  assert.ok(off.isError); assert.match(off.content[0].text, /has not turned autopilot on/);

  // The seller turns autopilot on in the same workspace (max $100, 80%).
  await fetch(URL + '/api/autopilot', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `ss_ws=${sid}` }, body: JSON.stringify({ enabled: true, maxAmount: 100, minConfidence: 0.8 }) });
  const over = await call('approve_action', { id: big.id, fingerprint: big.fingerprint });
  assert.ok(over.isError); assert.match(over.content[0].text, /outside the seller's limits/);
  const stale = await call('approve_action', { id: small.id, fingerprint: 'x'.repeat(64) });
  assert.ok(stale.isError);
  const done = await call('approve_action', { id: small.id, fingerprint: small.fingerprint });
  assert.equal(done.structuredContent.done, true);
  assert.equal((await call('get_protection_readiness')).structuredContent.ready, 4);
  const risk = await (await fetch(URL + '/api/risk', { headers: { Cookie: `ss_ws=${sid}` } })).json();
  assert.equal(risk.actions[0].by, 'mcp agent');
  assert.equal((await rpc('nope')).error.code, -32601);
});

test('demo data never goes stale: no demo dispute is past its deadline', async () => {
  await post('/api/demo/reset');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const disputes = proposals.filter((p) => p.kind === 'dispute');
  assert.equal(disputes.length, 4);
  for (const d of disputes) assert.ok(d.protection.checks[0].pass, `${d.target} deadline passed`);
  assert.equal(disputes.find((d) => d.target === 'PP-D-1001').decision, 'FIGHT');
});

test('ids that could reach other PayPal paths are rejected', async () => {
  assert.equal((await post('/api/disputes/..%2F..%2Fv2%2Fx/sandbox-settle')).status, 400);
  assert.equal((await post('/api/shop/capture', { orderId: '../../v1/x', sku: 'wallet' })).status, 400);
});

test('any storefront can register a sale with the client library', async () => {
  const { SellerShield } = await import('../sdk/sellershield.mjs');
  const shield = new SellerShield({ baseUrl: URL });
  const bare = await shield.registerSale({ transactionId: 'EXT0000000000001A', item: 'Linen apron', amount: 38 });
  assert.equal(bare.readiness.status, 'AT_RISK'); // no tracking number: only the seller can fix it
  const tracked = await shield.registerSale({ transactionId: 'EXT0000000000002B', item: 'Oak spoon set', amount: 27.5, carrier: 'usps', trackingNumber: '9400111899223197400001' });
  assert.equal(tracked.readiness.status, 'AGENT_CAN_FIX');
  await assert.rejects(shield.registerSale({ transactionId: 'EXT0000000000002B', item: 'x', amount: 1 }), (e) => e.status === 409);
  await assert.rejects(shield.registerSale({ transactionId: '../v1/x', item: 'x', amount: 1 }), (e) => e.status === 400);
  await assert.rejects(shield.registerSale({ transactionId: 'EXT0000000000003C', item: 'x', amount: 5, trackingNumber: '9400111899223197400002' }), (e) => e.status === 400);
  assert.equal((await shield.readiness()).total, 8);
  const proposals = await shield.review();
  assert.ok(!proposals.some((p) => p.target === 'EXT0000000000001A')); // nothing to send without a tracking number
  const fix = proposals.find((p) => p.target === 'EXT0000000000002B');
  const { entry } = await shield.approve(fix);
  assert.equal(entry.api, 'Tracking: trackers-batch');
  assert.equal((await shield.readiness()).rows.find((r) => r.transactionId === 'EXT0000000000002B').status, 'WAITING');
});

test('seller can type missing proof for a sale; tracking locks once it is on PayPal', async () => {
  await post('/api/demo/reset');
  const reg = await post('/api/orders', { transactionId: 'EXT0000000000009Z', item: 'Vintage denim jacket', amount: 50 });
  assert.equal((await reg.json()).readiness.status, 'AT_RISK');
  const proof = (b) => post('/api/orders/EXT0000000000009Z/proof', b);
  assert.equal((await proof({ trackingNumber: '9400111899223197400009' })).status, 400); // carrier first
  assert.equal((await proof({ carrier: 'usps' })).status, 200);
  assert.equal((await proof({ trackingNumber: 'bad' })).status, 400);
  assert.equal((await (await proof({ trackingNumber: '9400111899223197400009' })).json()).readiness.status, 'AGENT_CAN_FIX');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const fix = proposals.find((p) => p.target === 'EXT0000000000009Z');
  assert.equal((await post('/api/agent/approve', { id: fix.id, fingerprint: fix.fingerprint })).status, 200);
  assert.equal((await proof({ trackingNumber: '9400111899223197400010' })).status, 409);
  assert.equal((await (await proof({ delivered: new Date().toISOString().slice(0, 10) })).json()).readiness.status, 'READY');
  // Channel3: an independent product record was collected for the sale, as extra evidence.
  const risk = await (await fetch(URL + '/api/risk', { headers: { Cookie: cookie } })).json();
  const row = risk.readiness.rows.find((r) => r.transactionId === 'EXT0000000000009Z');
  const c3 = row.checks.find((c) => c.optional);
  assert.ok(c3.pass); assert.match(c3.detail, /trucker jacket/);
  await post('/api/demo/reset');
});

test('chat agent answers whether sales are protected', async () => {
  await post('/api/demo/reset');
  const r = await (await post('/api/agent/chat', { message: 'Are all my sales protected?' })).json();
  assert.equal(r.steps[0].tool, 'get_protection_readiness');
  assert.match(r.reply, /3 of 6 sales/);
});

test('autopilot waits for a reminder the seller rescheduled', async () => {
  await post('/api/demo/reset');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const inv = proposals.find((x) => x.kind === 'invoice');
  const later = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal((await post('/api/reminders', { invoiceId: inv.target, at: later })).status, 200);
  await post('/api/autopilot', { enabled: true, maxAmount: 100000, minConfidence: 0 });
  const r = await (await post('/api/agent/scan')).json();
  assert.ok(!r.auto.some((a) => a.target === inv.target));
  await post('/api/autopilot', { enabled: false });
  assert.equal((await post('/api/reminders', { invoiceId: 'x', at: 'tomorrow' })).status, 400);
});

test('double-clicking approve sends only once', async () => {
  await post('/api/demo/reset');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const p = proposals.find((x) => x.kind === 'invoice');
  const [a, b] = await Promise.all([
    post('/api/agent/approve', { id: p.id, fingerprint: p.fingerprint }),
    post('/api/agent/approve', { id: p.id, fingerprint: p.fingerprint }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.equal(codes[0], 200);
  assert.ok([404, 409].includes(codes[1]));
});

test('webhook events are processed once even if PayPal retries', async () => {
  const ev = { id: 'WH-TEST-1', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: 'PP-D-9' } };
  assert.equal((await post('/api/webhooks/paypal', ev, false)).status, 200);
  assert.equal((await post('/api/webhooks/paypal', ev, false)).status, 200);
});

test('evidence pack is a valid PDF with the response and records', async () => {
  await post('/api/demo/reset');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const p = proposals.find((x) => x.kind === 'dispute' && x.decision === 'FIGHT');
  const r = await post('/api/agent/pack', { id: p.id });
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.match(buf.toString('latin1'), /Records cited/);
  assert.match(buf.toString('latin1'), /%%EOF\n$/);
});

test('agent calendar: scheduling approves for a day; today runs automatically; deadlines enforced', async () => {
  await post('/api/demo/reset');
  const { proposals } = await (await post('/api/agent/scan')).json();
  const inv = proposals.find((x) => x.kind === 'invoice');
  const today = new Date().toISOString().slice(0, 10);
  // stale fingerprint refused
  assert.equal((await post('/api/schedule', { id: inv.id, at: today, fingerprint: 'nope' })).status, 409);
  // a dispute cannot be scheduled after PayPal's deadline
  const d = proposals.find((x) => x.kind === 'dispute' && x.decision === 'FIGHT');
  assert.equal((await post('/api/schedule', { id: d.id, at: '2099-01-01', fingerprint: d.fingerprint })).status, 400);
  // future day: stays scheduled, survives a re-scan with the same fingerprint
  const later = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await post('/api/schedule', { id: d.id, at: later, fingerprint: d.fingerprint })).status, 200);
  const again = await (await post('/api/agent/scan')).json();
  const kept = again.proposals.find((x) => x.id === d.id);
  assert.equal(kept.fingerprint, d.fingerprint);
  assert.equal(kept.scheduledAt, later);
  // today: the scheduler runs it within its next tick
  assert.equal((await post('/api/schedule', { id: inv.id, at: today, fingerprint: inv.fingerprint })).status, 200);
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const risk = await (await fetch(URL + '/api/risk', { headers: { Cookie: cookie } })).json();
    done = risk.actions.some((a) => a.target === inv.target && a.by === 'calendar');
  }
  assert.ok(done, 'calendar action ran');
});

test('recording a delivery confirmation flips a dispute to covered', async () => {
  await post('/api/demo/reset');
  const before = await (await post('/api/agent/scan')).json();
  const d = before.proposals.find((x) => x.target === 'PP-D-1004');
  assert.equal(d.protection.status, 'NEEDS_EVIDENCE');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await post(`/api/orders/${d.orderTx}/delivered`, { date: '2999-01-01' })).status, 400);
  const after = await (await post(`/api/orders/${d.orderTx}/delivered`, { date: today })).json();
  const d2 = after.proposals.find((x) => x.target === 'PP-D-1004');
  assert.equal(d2.protection.status, 'LIKELY_COVERED');
  assert.ok(d2.records.some((r) => r.fields.delivered_source));
});
