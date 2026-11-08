// Record-cited evidence for disputes.
// Every factual sentence in a dispute response must cite a numbered record [R1], [R2]...
// and every amount, date and ID in that sentence must appear in a cited record.
// This keeps the AI (or the seller) from sending PayPal a fact we cannot back up.
import { createHash } from 'crypto';

// Build the records the response may cite. Live PayPal records come first when available.
export function buildRecords(dispute, order, live = {}) {
  const recs = [];
  const add = (source, id, fields) => recs.push({ ref: `R${recs.length + 1}`, source, id, fields });
  add(live.dispute ? 'PayPal dispute' : 'Dispute (demo)', dispute.dispute_id, {
    reason: dispute.reason, amount: money(dispute.amount), transaction: dispute.transaction_id, due: dispute.seller_response_due_date,
  });
  // Accepts REST (snake_case) or PayPal Server SDK (camelCase) shapes.
  const c = live.capture, o = live.order;
  if (c) add('PayPal capture', c.id, { amount: money(c.amount?.value), status: c.status, created: (c.createTime || c.create_time)?.slice(0, 10) });
  if (o) add('PayPal order', o.id, { status: o.status, item: (o.purchaseUnits || o.purchase_units)?.[0]?.description });
  if (order) {
    add(order.live ? 'Seller order book' : 'Seller order book (demo)', order.transactionId, {
      item: order.item, amount: money(order.amount), carrier: order.carrier, tracking: order.trackingNumber,
      delivered: order.delivered, address_matches_transaction: order.addressMatches !== false ? 'yes' : 'no', signature: order.signature ? 'yes' : undefined,
    });
  }
  return recs.map((r) => ({ ...r, fields: Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v != null && v !== '')) }));
}

const money = (v) => (v == null ? undefined : `$${Number(v).toFixed(2)}`);

// Value patterns we verify: money, ISO dates, long IDs (tracking numbers, PayPal IDs).
const VALUE_RE = /\$\d[\d,]*(?:\.\d{2})?|\b\d{4}-\d{2}-\d{2}\b|\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{8,}\b/g;

export function checkDraft(draft, records) {
  const issues = [];
  const byRef = Object.fromEntries(records.map((r) => [r.ref, r]));
  const sentences = String(draft).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  for (const s of sentences) {
    const refs = [...s.matchAll(/\[(R\d+)\]/g)].map((m) => m[1]);
    const unknown = refs.filter((r) => !byRef[r]);
    if (unknown.length) issues.push({ code: 'UNKNOWN_RECORD', sentence: s, detail: unknown.join(', ') });
    const values = (s.replace(/\[R\d+\]/g, '').match(VALUE_RE) || []);
    if (!values.length) continue; // opinions/requests need no citation
    if (!refs.length) { issues.push({ code: 'NO_CITATION', sentence: s, detail: values.join(', ') }); continue; }
    const hay = refs.filter((r) => byRef[r]).map((r) => JSON.stringify(byRef[r])).join(' ');
    for (const v of values) {
      if (!hay.includes(v)) issues.push({ code: 'VALUE_NOT_IN_CITED_RECORD', sentence: s, detail: v });
    }
  }
  return issues;
}

// Canonical fingerprint of exactly what will be sent to PayPal.
export function fingerprint({ kind, decision, target, text }) {
  return createHash('sha256').update(JSON.stringify({ kind, decision, target, text })).digest('hex');
}

// Strip [R#] markers before sending to PayPal; keep a record appendix instead.
export function renderForPayPal(draft, records) {
  const used = [...new Set([...String(draft).matchAll(/\[(R\d+)\]/g)].map((m) => m[1]))];
  const appendix = records.filter((r) => used.includes(r.ref))
    .map((r) => `${r.ref}: ${r.source} ${r.id} (${Object.entries(r.fields).map(([k, v]) => `${k}: ${v}`).join(', ')})`).join('\n');
  return appendix ? `${draft}\n\nRecords:\n${appendix}` : draft;
}
