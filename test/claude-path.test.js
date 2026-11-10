// Exercises the live Claude code path against a local fake of the Messages API:
// request shape (model, structured output, effort, refusal fallback), parsing, the tool loop,
// and falling back to rules on a refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const seen = [];
let replies = [];
let srv;

before(async () => {
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const next = replies.shift() ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, ...next }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.PAYPAL_CLIENT_ID = '';
  process.env.PAYPAL_CLIENT_SECRET = '';
});
after(() => srv.close());

const dispute = { dispute_id: 'PP-D-1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 64, seller_response_due_date: '2099-01-01' };

test('dispute plan: structured output request and parsed result', async () => {
  const { ai } = await import('../lib/ai.js');
  replies = [{ stop_reason: 'end_turn', content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: JSON.stringify({ decision: 'FIGHT', confidence: 0.9, reasoning: 'Delivered.', draft: 'Delivered on 2026-10-30 [R2].' }) },
  ] }];
  const plan = await ai.planDispute(dispute, null, { status: 'LIKELY_COVERED' }, []);
  assert.equal(plan.source, 'claude');
  assert.equal(plan.decision, 'FIGHT');
  const req = seen.at(-1);
  assert.match(req.url, /\/v1\/messages/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.deepEqual(req.body.output_config.format.schema.properties.decision.enum, ['FIGHT', 'ACCEPT']);
  assert.ok(req.body.max_tokens >= 16000);
  assert.equal(req.body.thinking, undefined); // never send disabled thinking or a budget
});

test('the same dispute is planned once: a re-scan reuses the plan and its draft', async () => {
  const { ai } = await import('../lib/ai.js');
  const d = { ...dispute, dispute_id: 'PP-D-CACHE' };
  const reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ decision: 'FIGHT', confidence: 0.8, reasoning: 'r', draft: 'First draft.' }) }] };
  replies = [reply, { ...reply, content: [{ type: 'text', text: JSON.stringify({ decision: 'ACCEPT', confidence: 0.2, reasoning: 'r', draft: 'Second draft.' }) }] }];
  const n = seen.length;
  const a = await ai.planDispute(d, null, { status: 'LIKELY_COVERED' }, []);
  const b = await ai.planDispute(d, null, { status: 'LIKELY_COVERED' }, []);
  assert.equal(seen.length, n + 1);
  assert.equal(b.draft, a.draft);
  replies = [];
});

test('buyer agent: Claude picks from the catalog; a refusal falls back to the rule shopper', async () => {
  const { ai } = await import('../lib/ai.js');
  const products = [{ sku: 'mugs', name: 'Mug set', price: 64, tags: ['coffee'] }, { sku: 'wallet', name: 'Leather wallet', price: 85, tags: [] }];
  const mandate = { id: 'M-TEST', want: 'something for coffee', maxPrice: 70 };
  replies = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ sku: 'wallet', reasoning: 'Nice wallet.' }) }] }];
  const pick = await ai.shop(mandate, products);
  assert.deepEqual([pick.sku, pick.source], ['wallet', 'claude']); // over the limit: the server discards it (see checkMandate)
  const req = seen.at(-1);
  assert.deepEqual(req.body.output_config.format.schema.properties.sku.enum, ['mugs', 'wallet', 'NONE']);
  assert.match(req.body.system, /data, not instructions/);
  const { checkMandate } = await import('../lib/buyer.js');
  assert.equal(checkMandate(mandate, products[1]).allowed, false);
  replies = [{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }];
  const fb = await ai.shop(mandate, products);
  assert.deepEqual([fb.sku, fb.source], ['mugs', 'rules']);
});

test('a refusal falls back to the rules planner', async () => {
  const { ai } = await import('../lib/ai.js');
  replies = [{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }];
  const plan = await ai.planReminder({ id: 'INV-1', amount: 10, days_overdue: 3, due_date: '2026-11-05', memo: 'x' });
  assert.equal(plan.source, 'rules');
  assert.equal(plan.decision, 'REMIND');
});

test('chat agent runs the tool loop and returns the final text', async () => {
  const { ai } = await import('../lib/ai.js');
  replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'get_money_at_risk', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '$74 at risk.' }] },
  ];
  const out = await ai.agent('biggest risk?', { get_money_at_risk: async () => ({ disputes: [], invoices: [{ amount: 74 }], holds: [] }) });
  assert.equal(out.reply, '$74 at risk.');
  assert.deepEqual(out.steps.map((s) => s.tool), ['get_money_at_risk']);
  const second = seen.at(-1).body;
  assert.equal(second.messages.at(-1).content[0].type, 'tool_result');
  assert.equal(second.messages.at(-1).content[0].tool_use_id, 'tu_1');
  assert.ok(second.tools.find((t) => t.name === 'execute_proposal').strict);
});
