// Per-visitor workspaces and the state snapshot used for persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspace, workspaceId, runIn, snapshot, restore, workspaceMiddleware, SHARED } from '../lib/workspace.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('outside a request, the shared workspace is used', () => assert.equal(workspaceId(), SHARED));
test('two visitors never see each other\'s state', () => {
  runIn(A, () => { workspace().x = 1; });
  runIn(B, () => { assert.equal(workspace().x, undefined); workspace().x = 2; });
  runIn(A, () => assert.equal(workspace().x, 1));
});
test('snapshot and restore round-trip, dropping workspaces idle for over a week', () => {
  const json = JSON.parse(snapshot());
  assert.equal(json[A].x, 1);
  const old = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  restore({ [old]: { x: 9, _last: Date.now() - 8 * 86400000 }, dddddddd: { x: 3, _last: Date.now() } });
  assert.equal(JSON.parse(snapshot())[old], undefined);
  assert.equal(JSON.parse(snapshot()).dddddddd.x, 3);
});
function mw(req) {
  return new Promise((resolve) => {
    const headers = {};
    workspaceMiddleware({ path: '/api/risk', headers: {}, query: {}, ...req }, { setHeader: (k, v) => { headers[k] = v; } }, () => resolve({ id: workspaceId(), headers }));
  });
}
test('middleware: a new visitor gets a cookie and a fresh workspace', async () => {
  const r = await mw({});
  assert.match(r.headers['Set-Cookie'], /^ss_ws=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax/);
  assert.match(r.id, /^[0-9a-f-]{36}$/);
});
test('middleware: a returning visitor keeps their workspace', async () => {
  assert.equal((await mw({ headers: { cookie: `x=1; ss_ws=${A}` } })).id, A);
});
test('middleware: a malformed cookie is ignored', async () => {
  const r = await mw({ headers: { cookie: 'ss_ws=../../etc' } });
  assert.notEqual(r.id, '../../etc');
});
test('middleware: PayPal webhooks always run in the shared workspace', async () => {
  assert.equal((await mw({ path: '/api/webhooks/paypal', headers: { cookie: `ss_ws=${A}` } })).id, SHARED);
});
test('middleware: MCP callers name their workspace by header or ?ws=, other routes cannot', async () => {
  assert.equal((await mw({ path: '/api/mcp', headers: { 'mcp-session-id': B } })).id, B);
  assert.equal((await mw({ path: '/api/mcp', query: { ws: A } })).id, A);
  assert.notEqual((await mw({ path: '/api/risk', query: { ws: A } })).id, A);
});
