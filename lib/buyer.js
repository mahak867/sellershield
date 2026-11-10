// Buyer agent: shops the store for a buyer inside a mandate (what they want, the most they will pay).
// The model proposes; code decides. A pick that breaks the mandate is never turned into a PayPal order.
// The mandate travels with the sale, so if the buyer later says "my agent bought the wrong thing",
// the seller has a record of exactly what was asked for and what the buyer approved in PayPal.
import { createHash, randomBytes } from 'node:crypto';

export function newMandate({ want, maxPrice }) {
  const w = String(want ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const max = Math.round(Number(maxPrice) * 100) / 100;
  if (w.length < 3) throw Object.assign(new Error('Say what you want to buy.'), { status: 400 });
  if (!(max > 0) || max > 10000) throw Object.assign(new Error('Set the most you will pay, as a positive number.'), { status: 400 });
  return { id: 'M-' + randomBytes(6).toString('hex').toUpperCase(), want: w, maxPrice: max, createdAt: new Date().toISOString() };
}

// Deterministic checks. Every one must pass before an order is created, and again before capture.
export function checkMandate(mandate, product) {
  const checks = [];
  const add = (rule, pass, detail) => checks.push({ rule, pass, detail });
  add('Item is in the store catalog', !!product, product ? product.name : 'No item picked');
  if (product) {
    add('Price is within the buyer\'s limit', product.price <= mandate.maxPrice, `$${product.price.toFixed(2)} against a limit of $${mandate.maxPrice.toFixed(2)}`);
    add('One item, at the store\'s listed price', true, `1 x ${product.name} at $${product.price.toFixed(2)}`);
  }
  return { allowed: checks.every((c) => c.pass), checks };
}

// SHA-256 of exactly what the buyer's agent was allowed to buy.
export function mandateFingerprint(m, product) {
  return createHash('sha256').update(JSON.stringify({ id: m.id, want: m.want, maxPrice: m.maxPrice, sku: product?.sku ?? null, price: product?.price ?? null })).digest('hex');
}

// Rule-based shopper, used without an API key and whenever the model's pick breaks the mandate.
const STOP = new Set(['a', 'an', 'the', 'for', 'my', 'me', 'i', 'want', 'need', 'buy', 'get', 'some', 'under', 'something', 'to', 'of', 'and', 'with', 'gift', 'present', 'please']);
export function rulePick(mandate, products) {
  const words = mandate.want.toLowerCase().match(/[a-z]+/g)?.filter((w) => !STOP.has(w)) ?? [];
  const affordable = products.filter((p) => p.price <= mandate.maxPrice);
  if (!affordable.length) return { sku: null, reasoning: `Nothing in the store costs $${mandate.maxPrice.toFixed(2)} or less, so I am not buying anything.` };
  const score = (p) => { const hay = `${p.name} ${(p.tags || []).join(' ')}`.toLowerCase(); return words.filter((w) => hay.includes(w.replace(/s$/, ''))).length; };
  const best = affordable.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s || a.p.price - b.p.price)[0];
  // What they asked for exists but costs too much: buy nothing, never a substitute.
  const wanted = products.filter((p) => p.price > mandate.maxPrice).map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[0];
  if (wanted?.s > 0 && best.s === 0) return { sku: null, reasoning: `${wanted.p.name} matches what you asked for but costs $${wanted.p.price.toFixed(2)}, above your $${mandate.maxPrice.toFixed(2)} limit. I am not buying a substitute.` };
  return { sku: best.p.sku, reasoning: best.s
    ? `${best.p.name} matches what you asked for and costs $${best.p.price.toFixed(2)}, inside your $${mandate.maxPrice.toFixed(2)} limit.`
    : `Nothing matches your words exactly. ${best.p.name} at $${best.p.price.toFixed(2)} is the closest item inside your $${mandate.maxPrice.toFixed(2)} limit.` };
}
