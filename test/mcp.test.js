// MCP endpoint: the JSON-RPC protocol, without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp, MCP_TOOLS } from '../lib/mcp.js';

function call(body, handlers = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; },
      json(b) { resolve({ code: this.code, body: b, headers: this.headers }); }, end() { resolve({ code: this.code, body: null, headers: this.headers }); } };
    handleMcp({ body }, res, handlers, '11111111-2222-3333-4444-555555555555');
  });
}
test('initialize: returns server info, the session id and a supported protocol version', async () => {
  const r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(r.body.result.serverInfo.name, 'sellershield');
  assert.equal(r.body.result.protocolVersion, '2025-03-26');
  assert.equal(r.headers['Mcp-Session-Id'], '11111111-2222-3333-4444-555555555555');
  assert.match(r.body.result.instructions, /limits the seller set/);
});
test('initialize: an unknown protocol version gets the current one', async () => {
  const r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(r.body.result.protocolVersion, '2025-06-18');
});
test('notifications get 202 and no body', async () => {
  const r = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual([r.code, r.body], [202, null]);
});
test('ping', async () => assert.deepEqual((await call({ jsonrpc: '2.0', id: 7, method: 'ping' })).body, { jsonrpc: '2.0', id: 7, result: {} }));
test('tools/list: four tools, each with a description and an object schema', async () => {
  const tools = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools;
  assert.equal(tools.length, 4);
  for (const t of tools) { assert.ok(t.description.length > 40, t.name); assert.equal(t.inputSchema.type, 'object'); }
  assert.deepEqual(MCP_TOOLS.find((t) => t.name === 'approve_action').inputSchema.required, ['id', 'fingerprint']);
});
test('tools/call: result comes back as text and structured content', async () => {
  const r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_money_at_risk', arguments: {} } }, { get_money_at_risk: async () => ({ total: 5 }) });
  assert.deepEqual(r.body.result.structuredContent, { total: 5 });
  assert.equal(JSON.parse(r.body.result.content[0].text).total, 5);
});
test('tools/call: a tool error goes back to the model, not as a protocol error', async () => {
  const r = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'review_account' } }, { review_account: async () => { throw new Error('nope'); } });
  assert.equal(r.body.result.isError, true);
  assert.equal(r.body.result.content[0].text, 'nope');
});
test('tools/call: missing required arguments are refused before the tool runs', async () => {
  let ran = false;
  const r = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'approve_action', arguments: { id: 'hold:X' } } }, { approve_action: async () => { ran = true; } });
  assert.equal(r.body.error.code, -32602);
  assert.match(r.body.error.message, /fingerprint/);
  assert.equal(ran, false);
});
test('tools/call: an unknown tool is refused', async () => {
  assert.equal((await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'transfer_all_money' } })).body.error.code, -32602);
});
test('an unknown method is refused', async () => {
  assert.equal((await call({ jsonrpc: '2.0', id: 8, method: 'resources/list' })).body.error.code, -32601);
});
test('malformed requests and batches get 400', async () => {
  for (const body of [null, {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], { jsonrpc: '2.0', id: 1 }]) {
    assert.equal((await call(body)).code, 400, JSON.stringify(body));
  }
});
