// PayPal REST client (sandbox). Disputes, Invoicing, Tracking APIs.
// MOCK mode when PAYPAL_CLIENT_ID/SECRET are unset.
// In sandbox mode, demo disputes fill in when the sandbox has none (sellers can't create
// disputes via API); they are flagged `demo: true` and actions on them are simulated.
import { workspace } from './workspace.js';
import { sdk } from './paypal-sdk.js';
import { randomUUID } from 'node:crypto';

const BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';
const ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
export const MOCK_PAYPAL = !(ID && SECRET);
const DEMO_FILL = process.env.DEMO_FILL !== '0';

let token = null;
let tokenExp = 0;

async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in - 60) * 1000;
  return token;
}

async function call(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${await getToken()}` };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : { status: r.status };
}

// ---------- demo data ----------
const DEMO_SEED = () => ({
  disputes: [
    { dispute_id: 'PP-D-1001', transaction_id: '5TY05013RG002845M', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 64.0, buyer_message: 'I never got my mugs. It has been 2 weeks.', seller_response_due_date: '2026-11-15' },
    { dispute_id: 'PP-D-1002', transaction_id: '8MC585209K746392H', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 120.0, buyer_message: 'Jacket is a different size than listed.', seller_response_due_date: '2026-11-14' },
    { dispute_id: 'PP-D-1004', transaction_id: '9JK41126LM553201P', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 210.0, buyer_message: 'Tracking has said in transit for a week.', seller_response_due_date: '2026-11-17' },
    { dispute_id: 'PP-D-1003', transaction_id: '3HK26519EU112054W', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 18.0, buyer_message: 'Ordered blue, got red.', seller_response_due_date: '2026-11-16' },
  ].map((d) => ({ ...d, demo: true })),
  invoices: [
    { id: 'INV2-ACME-0042', recipient: 'billing@acme-studio.example', amount: 1500.0, due_date: '2026-10-20', days_overdue: 19, memo: 'Logo + brand kit design' },
    { id: 'INV2-BLUE-0007', recipient: 'ops@bluecafe.example', amount: 320.0, due_date: '2026-11-03', days_overdue: 5, memo: 'Menu photography' },
  ].map((i) => ({ ...i, demo: true })),
});
// Demo data lives in the visitor's workspace.
const D = () => (workspace().demo ??= DEMO_SEED());
const isDemoDispute = (id) => D().disputes.some((d) => d.dispute_id === id) || id.startsWith('PP-D-');
const simulated = (what) => ({ simulated: true, status: 'OK', what });

const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export const paypal = {
  resetDemo() { workspace().demo = DEMO_SEED(); },

  // Adds a demo "item not received" dispute on a delivered order (for the real-time demo).
  addDemoDispute() {
    const n = 2000 + D().disputes.length;
    const d = { dispute_id: `PP-D-${n}`, transaction_id: '5TY05013RG002845M', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE',
      amount: 64.0, buyer_message: 'Where is my order?', seller_response_due_date: isoDay(10), demo: true };
    D().disputes.unshift(d);
    return d;
  },

  // Verifies a webhook really came from PayPal (needs PAYPAL_WEBHOOK_ID from the developer dashboard).
  async verifyWebhook(headers, event) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID not set');
    const r = await call('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId, webhook_event: event,
    });
    return r.verification_status === 'SUCCESS';
  },

  async listDisputes() {
    if (MOCK_PAYPAL) return D().disputes;
    const j = await call('GET', '/v1/customer/disputes?page_size=20');
    const live = (j.items || [])
      .filter((d) => !['RESOLVED', 'CLOSED'].includes(d.status))
      .map((d) => ({
        dispute_id: d.dispute_id, reason: d.reason, status: d.status, stage: d.dispute_life_cycle_stage,
        amount: Number(d.dispute_amount?.value || 0),
        transaction_id: d.disputed_transactions?.[0]?.seller_transaction_id,
        seller_response_due_date: d.seller_response_due_date,
      }));
    return live.length || !DEMO_FILL ? live : D().disputes;
  },

  async getDispute(id) {
    if (MOCK_PAYPAL || isDemoDispute(id)) return D().disputes.find((d) => d.dispute_id === id);
    const d = await call('GET', `/v1/customer/disputes/${id}`);
    return {
      dispute_id: d.dispute_id, reason: d.reason, status: d.status, stage: d.dispute_life_cycle_stage,
      amount: Number(d.dispute_amount?.value || 0),
      buyer_message: d.messages?.find((m) => m.posted_by === 'BUYER')?.content,
      transaction_id: d.disputed_transactions?.[0]?.seller_transaction_id,
      seller_response_due_date: d.seller_response_due_date,
      disputed_transactions: d.disputed_transactions,
    };
  },

  // Live records the agent may cite (best effort; missing ones are skipped).
  async liveRecords(dispute, order) {
    if (MOCK_PAYPAL || dispute.demo) return {};
    const out = { dispute: true };
    if (dispute.transaction_id) out.capture = await sdk.getCapture(dispute.transaction_id).catch(() => undefined);
    if (order?.orderId) out.order = await sdk.getOrder(order.orderId).catch(() => undefined);
    return out;
  },

  async provideEvidence(id, note, order, pdf) {
    if (MOCK_PAYPAL || isDemoDispute(id)) { D().disputes = D().disputes.filter((d) => d.dispute_id !== id); return simulated(pdf ? 'evidence + PDF pack submitted' : 'evidence submitted'); }
    const evidence = {
      evidence_type: order?.trackingNumber ? 'PROOF_OF_FULFILLMENT' : 'OTHER',
      evidence_info: order?.trackingNumber ? { tracking_info: [{ carrier_name: order.carrier, tracking_number: order.trackingNumber }] } : undefined,
      notes: note.slice(0, 2000),
    };
    const send = (withPdf) => {
      const fd = new FormData();
      const input = { evidences: [withPdf ? { ...evidence, documents: [{ name: 'evidence-pack.pdf' }] } : evidence] };
      fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
      if (withPdf) fd.append('evidence-file', new Blob([pdf], { type: 'application/pdf' }), 'evidence-pack.pdf');
      return call('POST', `/v1/customer/disputes/${id}/provide-evidence`, fd, true);
    };
    const refusable = (e) => /-> (400|403|422)/.test(e.message);
    try {
      if (pdf) {
        try { return { ...(await send(true)), pdf: 'attached' }; }
        catch (e) { if (!refusable(e)) throw e; } // PayPal may not take a file at this stage: send the text alone
      }
      return await send(false);
    } catch (e) {
      // In the INQUIRY stage PayPal may not accept evidence yet; message the buyer with the same facts instead.
      if (!refusable(e)) throw e;
      const r = await call('POST', `/v1/customer/disputes/${id}/send-message`, { message: note.slice(0, 2000) });
      return { ...r, via: 'send-message', reason: e.message.slice(0, 200) };
    }
  },

  // SANDBOX ONLY: ask PayPal to decide a dispute (escalating an inquiry to a claim first).
  // Lets a demo show the full lifecycle on real PayPal state. Never available on live.
  async sandboxSettle(id, outcome = 'SELLER_FAVOR') {
    if (!BASE.includes('sandbox')) throw Object.assign(new Error('sandbox only'), { status: 400 });
    if (MOCK_PAYPAL || isDemoDispute(id)) throw Object.assign(new Error('only for real sandbox disputes'), { status: 400 });
    const steps = [];
    const d = await call('GET', `/v1/customer/disputes/${id}`);
    if (d.dispute_life_cycle_stage === 'INQUIRY') {
      try { await call('POST', `/v1/customer/disputes/${id}/escalate`, { note: 'Escalated for sandbox demo.' }); steps.push('escalated to claim'); }
      catch (e) { steps.push(`escalate failed: ${e.message.slice(0, 160)}`); }
    }
    await call('POST', `/v1/customer/disputes/${id}/adjudicate`, { adjudication_outcome: outcome });
    steps.push(`adjudicated ${outcome}`);
    const after = await call('GET', `/v1/customer/disputes/${id}`);
    return { steps, status: after.status, outcome: after.dispute_outcome?.outcome_code };
  },

  async acceptClaim(id, note) {
    if (MOCK_PAYPAL || isDemoDispute(id)) { D().disputes = D().disputes.filter((d) => d.dispute_id !== id); return simulated('claim accepted, buyer refunded'); }
    return call('POST', `/v1/customer/disputes/${id}/accept-claim`, { note: note.slice(0, 2000) });
  },

  async listUnpaidInvoices() {
    if (MOCK_PAYPAL) return D().invoices;
    let j;
    try { j = await call('GET', '/v2/invoicing/invoices?page_size=50&total_required=true'); }
    catch (e) { console.warn('Invoicing unavailable (enable Invoicing on your PayPal app):', e.message.slice(0, 120)); return []; }
    return (j.items || [])
      .filter((i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status))
      .map((i) => {
        const due = i.detail?.payment_term?.due_date;
        return {
          id: i.id,
          recipient: i.primary_recipients?.[0]?.billing_info?.email_address,
          amount: Number(i.due_amount?.value ?? i.amount?.value ?? 0),
          due_date: due,
          days_overdue: due ? daysSince(due) : 0,
          memo: i.detail?.memo || i.detail?.note || '',
        };
      })
      .filter((i) => i.days_overdue > 0);
  },

  async remindInvoice(id, note) {
    if (MOCK_PAYPAL) { D().invoices = D().invoices.filter((i) => i.id !== id); return simulated('reminder sent'); }
    return call('POST', `/v2/invoicing/invoices/${id}/remind`, { subject: 'Reminder: invoice payment due', note: note.slice(0, 4000), send_to_invoicer: true });
  },

  // Creates and sends a real overdue invoice in the sandbox (for demos).
  async seedInvoice({ email, name, memo, amount, daysOverdue }) {
    if (MOCK_PAYPAL) return simulated('mock mode: no seeding');
    const created = await call('POST', '/v2/invoicing/invoices', {
      detail: { currency_code: 'USD', invoice_date: isoDay(-daysOverdue - 10), payment_term: { due_date: isoDay(-daysOverdue) }, memo },
      primary_recipients: [{ billing_info: { email_address: email, name: { given_name: name, surname: 'Client' } } }],
      items: [{ name: memo, quantity: '1', unit_amount: { currency_code: 'USD', value: amount.toFixed(2) } }],
    });
    const id = created.href?.split('/').pop() ?? created.id;
    await call('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false });
    return { id };
  },

  // Storefront checkout (PayPal Orders v2 through the APIMatic-generated PayPal Server SDK).
  // The buyer approves in the PayPal popup.
  async createOrder({ name, price }) {
    const o = await sdk.createOrder({ name, price, requestId: randomUUID() });
    return o.id;
  },

  async captureOrder(orderId) {
    const j = await sdk.captureOrder(orderId);
    const cap = j.purchaseUnits?.[0]?.payments?.captures?.[0];
    return {
      orderId: j.id, status: j.status, captureId: cap?.id, captureStatus: cap?.status,
      amount: Number(cap?.amount?.value || 0), buyer: j.payer?.emailAddress,
    };
  },

  async addTracking(order) {
    if (MOCK_PAYPAL || order.demo) { order.onHold = false; return simulated('tracking added, hold release requested'); }
    // Orders placed through our storefront: Orders v2 tracking endpoint (ties tracking to the capture).
    const r = order.orderId
      ? await sdk.trackOrder({ orderId: order.orderId, captureId: order.transactionId, trackingNumber: order.trackingNumber, carrier: order.carrier })
      : await call('POST', '/v1/shipping/trackers-batch', {
          trackers: [{ transaction_id: order.transactionId, tracking_number: order.trackingNumber, status: 'SHIPPED', carrier: order.carrier }],
        });
    order.onHold = false;
    return r;
  },
};
