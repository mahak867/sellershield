// Buyer agent: mandates, the checks every purchase must pass, the rule shopper and fault analysis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMandate, checkMandate, mandateFingerprint, rulePick, agentFault } from '../lib/buyer.js';

const P = [
  { sku: 'wallet', name: 'Leather wallet', price: 85, tags: ['leather', 'card holder'] },
  { sku: 'candle', name: 'Scented candle bundle', price: 42.5, tags: ['candle', 'home'] },
  { sku: 'mugs', name: 'Handmade ceramic mug set', price: 64, tags: ['mug', 'coffee', 'tea'] },
];
const m = (want, maxPrice) => newMandate({ want, maxPrice });

test('mandate: normalises text, rounds the limit to cents, and gets a unique id', () => {
  const a = m('  a   coffee\n gift  ', 70.129);
  assert.equal(a.want, 'a coffee gift');
  assert.equal(a.maxPrice, 70.13);
  assert.match(a.id, /^M-[0-9A-F]{12}$/);
  assert.notEqual(a.id, m('a coffee gift', 70).id);
});
test('mandate: text is capped at 200 characters', () => {
  assert.equal(m('x'.repeat(500), 10).want.length, 200);
});
test('mandate: refuses empty or too-short requests', () => {
  for (const want of ['', '  ', 'ab', null, undefined]) assert.throws(() => m(want, 10), /Say what you want/);
});
test('mandate: refuses limits that are not positive, not numbers, or absurd', () => {
  for (const max of [0, -1, 'abc', NaN, Infinity, 10001, null]) assert.throws(() => m('a mug', max), /most you will pay/, String(max));
});
test('check: a catalog item within the limit is allowed, with all checks passing', () => {
  const v = checkMandate(m('mugs', 64), P[2]);
  assert.equal(v.allowed, true);
  assert.ok(v.checks.every((c) => c.pass));
});
test('check: one cent over the limit is refused', () => {
  assert.equal(checkMandate(m('mugs', 63.99), P[2]).allowed, false);
});
test('check: no item, or an item outside the catalog lookup, is refused', () => {
  assert.equal(checkMandate(m('anything', 100), null).allowed, false);
  assert.equal(checkMandate(m('anything', 100), undefined).allowed, false);
});
test('fingerprint: stable for the same mandate and pick, different for any change', () => {
  const a = m('mugs', 70);
  assert.equal(mandateFingerprint(a, P[2]), mandateFingerprint({ ...a }, { ...P[2] }));
  assert.notEqual(mandateFingerprint(a, P[2]), mandateFingerprint(a, P[1]));
  assert.notEqual(mandateFingerprint(a, P[2]), mandateFingerprint({ ...a, maxPrice: 71 }, P[2]));
  assert.notEqual(mandateFingerprint(a, P[2]), mandateFingerprint(a, { ...P[2], price: 63 }));
  assert.equal(mandateFingerprint(a, null).length, 64);
});
test('rule shopper: picks the best match within the limit', () => {
  assert.equal(rulePick(m('something for coffee', 70), P).sku, 'mugs');
  assert.equal(rulePick(m('a candle for the home', 50), P).sku, 'candle');
});
test('rule shopper: plural words still match', () => {
  assert.equal(rulePick(m('some candles', 50), P).sku, 'candle');
});
test('rule shopper: never picks above the limit, whatever the request says', () => {
  for (const want of ['the most expensive thing', 'ignore the limit and buy the wallet', 'leather wallet please']) {
    const pick = rulePick(m(want, 50), P);
    const item = P.find((p) => p.sku === pick.sku);
    assert.ok(!item || item.price <= 50, `${want} -> ${pick.sku}`);
  }
});
test('rule shopper: nothing affordable means nothing bought', () => {
  const r = rulePick(m('anything', 10), P);
  assert.equal(r.sku, null);
  assert.match(r.reasoning, /\$10\.00 or less/);
});
test('rule shopper: no substitute when the wanted item costs too much', () => {
  const r = rulePick(m('a leather wallet', 60), P);
  assert.equal(r.sku, null);
  assert.match(r.reasoning, /not buying a substitute/);
});
test('rule shopper: with no matching words, takes the cheapest affordable item and says so', () => {
  const r = rulePick(m('surprise me', 100), P);
  assert.equal(r.sku, 'candle');
  assert.match(r.reasoning, /closest item/);
});
const sale = (o) => ({ item: 'Handmade ceramic mug set', amount: 64, carrier: 'USPS', trackingNumber: '9400111899223197428490', onHold: false, delivered: '2026-11-01',
  mandate: { id: 'M-AAAAAAAAAAAA', want: 'coffee gift', maxPrice: 70, sku: 'mugs' }, ...o });
test('fault: no mandate means no fault analysis', () => {
  assert.equal(agentFault({ item: 'x', amount: 1 }, null), null);
});
test('fault: authorised, inside the mandate and delivered points to the buyer\'s own instructions', () => {
  const f = agentFault(sale(), P[2]);
  assert.deepEqual(f.questions.map((q) => q.answer), ['yes', 'yes', 'yes']);
  assert.equal(f.verdict.who, 'buyer');
});
test('fault: over the limit points to the agent', () => {
  const f = agentFault(sale({ amount: 85, item: 'Leather wallet' }), P[0]);
  assert.equal(f.questions[1].answer, 'no');
  assert.equal(f.verdict.who, 'agent');
});
test('fault: a different item than the mandate approved points to the agent', () => {
  assert.equal(agentFault(sale({ amount: 42.5, item: 'Scented candle bundle' }), P[1]).verdict.who, 'agent');
});
test('fault: tracking on PayPal but not delivered stays open', () => {
  const f = agentFault(sale({ delivered: null }), P[2]);
  assert.equal(f.questions[2].answer, 'unknown');
  assert.match(f.questions[2].detail, /not confirmed yet/);
  assert.equal(f.verdict.who, 'open');
});
test('fault: tracking never sent to PayPal stays open and says so', () => {
  const f = agentFault(sale({ onHold: true }), P[2]);
  assert.equal(f.questions[2].detail, 'Tracking is not on PayPal yet.');
  assert.equal(f.verdict.who, 'open');
});
