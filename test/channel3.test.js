// Channel3 catalog lookup through @channel3/sdk, against a local fake of the Channel3 API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let srv, seen = [];
before(async () => {
  srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, key: req.headers['x-api-key'], body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ products: [{ id: 'c3_123', title: 'Denim trucker jacket', brands: [{ id: 'b1', name: 'Acme' }],
        structured_attributes: { size: ['M'], color: ['Blue'] }, materials: ['Cotton'], key_features: ['Two pockets'] }] }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.CHANNEL3_API_KEY = 'c3-test';
  process.env.CHANNEL3_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('catalog facts come from Channel3 search and become a citable record', async () => {
  const { catalogFacts } = await import('../lib/channel3.js');
  const { buildRecords, checkDraft } = await import('../lib/evidence.js');
  const facts = await catalogFacts('Vintage denim jacket');
  assert.equal(facts.id, 'c3_123');
  assert.equal(facts.brand, 'Acme');
  assert.deepEqual(facts.attributes.size, ['M']);
  const req = seen.at(-1);
  assert.equal(req.key, 'c3-test');
  assert.match(req.url, /search/);
  assert.equal(req.body.query, 'Vintage denim jacket');
  const recs = buildRecords({ dispute_id: 'D1', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', amount: 120 }, null, { catalog: facts });
  const c3 = recs.find((r) => r.source === 'Channel3 product catalog');
  assert.match(c3.fields.attributes, /size: M/);
  assert.deepEqual(checkDraft(`The catalog lists size M [${c3.ref}].`, recs), []);
  // cached: a second lookup makes no new request
  const n = seen.length; await catalogFacts('Vintage denim jacket'); assert.equal(seen.length, n);
});
