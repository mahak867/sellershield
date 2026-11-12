// Alert webhooks: which addresses are allowed, and that failures never throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedWebhook, notify } from '../lib/notify.js';

test('Zapier catch hooks over https are allowed', () => {
  assert.equal(allowedWebhook('https://hooks.zapier.com/hooks/catch/123/abc/'), 'https://hooks.zapier.com/hooks/catch/123/abc/');
});
test('anything else is refused', () => {
  for (const u of ['http://hooks.zapier.com/x', 'https://evil.com/hooks.zapier.com', 'https://hooks.zapier.com.evil.com/x', 'https://user:pass@hooks.zapier.com/x',
    'http://169.254.169.254/latest/meta-data', 'http://localhost:3000/api/agent/approve', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '', null]) {
    assert.equal(allowedWebhook(u), null, String(u));
  }
});
test('notify: no url is a no-op', async () => assert.equal(await notify(null, { event: 'x' }), false));
test('notify: an unreachable address returns false instead of throwing', async () => {
  assert.equal(await notify('http://127.0.0.1:9/never', { event: 'x' }), false);
});
