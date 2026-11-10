// State survives a server restart, through a JSON file and through Redis (Render Key Value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function start(port, env) {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', ANTHROPIC_API_KEY: '', REDIS_URL: '', DATA_FILE: '', ...env }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/api/status`); return srv; } catch { await wait(100); } }
  srv.kill(); throw new Error('server did not start');
}
const stop = (srv) => new Promise((r) => { srv.once('exit', r); srv.kill('SIGTERM'); });

async function roundTrip(port, env, kind) {
  const url = `http://127.0.0.1:${port}`;
  let srv = await start(port, env);
  let cookie = '';
  const post = async (path, body) => {
    const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r.json();
  };
  assert.equal((await (await fetch(url + '/api/status')).json()).persistence, kind);
  await post('/api/autopilot', { enabled: false, maxAmount: 77, minConfidence: 0.9 }); // off, so only the approval below acts
  const { proposals } = await post('/api/agent/scan');
  const hold = proposals.find((p) => p.kind === 'hold');
  await post('/api/agent/approve', { id: hold.id, fingerprint: hold.fingerprint });
  await stop(srv); // SIGTERM flushes

  srv = await start(port, env);
  try {
    const risk = await (await fetch(url + '/api/risk', { headers: { Cookie: cookie } })).json();
    const status = await (await fetch(url + '/api/status', { headers: { Cookie: cookie } })).json();
    assert.equal(status.autopilot.maxAmount, 77);
    assert.equal(risk.actions.length, 1);
    assert.equal(risk.actions[0].target, hold.target);
    assert.equal(risk.readiness.ready, 4);
  } finally { await stop(srv); }
}

test('state survives a restart (JSON file)', async () => {
  await roundTrip(3197, { DATA_FILE: join(mkdtempSync(join(tmpdir(), 'ss-')), 'state.json') }, 'file');
});

const hasRedis = spawnSync('redis-server', ['--version']).status === 0;
test('state survives a restart (Redis, as on Render Key Value)', { skip: !hasRedis && 'redis-server not installed' }, async () => {
  const rs = spawn('redis-server', ['--port', '6398', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  await wait(600);
  try { await roundTrip(3196, { REDIS_URL: 'redis://127.0.0.1:6398' }, 'redis'); }
  finally { rs.kill(); }
});
