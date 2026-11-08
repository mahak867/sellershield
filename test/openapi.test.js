// The published OpenAPI spec (APIMatic / Postman) must match the routes the server defines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = readFileSync(new URL('../apimatic/src/spec/openapi.yaml', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const specPaths = [...spec.matchAll(/^  (\/api\/[^:]+):$/gm)].map((m) => m[1].replace(/\{(\w+)\}/g, ':$1'));
const serverPaths = [...server.matchAll(/app\.(?:get|post|delete)\('(\/api\/[^']+)'/g)].map((m) => m[1]);

test('every documented path exists on the server', () => {
  assert.ok(specPaths.length >= 15);
  for (const p of specPaths) assert.ok(serverPaths.includes(p), `missing route ${p}`);
});
test('every public API route is documented', () => {
  const undocumented = serverPaths.filter((p) => !specPaths.includes(p) && !['/api/activity', '/api/shop/config', '/api/openapi.yaml'].includes(p));
  assert.deepEqual(undocumented, []);
});
