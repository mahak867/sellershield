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

const post = (path, body) => fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

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
