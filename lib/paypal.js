// PayPal REST client (sandbox). Disputes, Invoicing, Tracking APIs.
// Falls back to realistic mock data when PAYPAL_CLIENT_ID/SECRET are unset.
const BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';
const ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
export const MOCK_PAYPAL = !(ID && SECRET);

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
  if (!r.ok) throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// ---------- mock data ----------
const mock = {
  disputes: [
    { dispute_id: 'PP-D-1001', transaction_id: '5TY05013RG002845M', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 64.0, buyer_message: 'I never got my mugs. It has been 2 weeks.', seller_response_due_date: '2026-11-15' },
    { dispute_id: 'PP-D-1002', transaction_id: '8MC585209K746392H', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 120.0, buyer_message: 'Jacket is a different size than listed.', seller_response_due_date: '2026-11-14' },
    { dispute_id: 'PP-D-1003', transaction_id: '3HK26519EU112054W', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status: 'WAITING_FOR_SELLER_RESPONSE', amount: 18.0, buyer_message: 'Ordered blue, got red.', seller_response_due_date: '2026-11-16' },
  ],
  invoices: [
    { id: 'INV2-ACME-0042', recipient: 'billing@acme-studio.example', amount: 1500.0, due_date: '2026-10-20', days_overdue: 19, reminders_sent: 1, memo: 'Logo + brand kit design' },
    { id: 'INV2-BLUE-0007', recipient: 'ops@bluecafe.example', amount: 320.0, due_date: '2026-11-03', days_overdue: 5, reminders_sent: 0, memo: 'Menu photography' },
  ],
};
const ok = (what) => ({ mock: true, status: 'OK', what });

function daysSince(d) { return Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)); }

export const paypal = {
  async listDisputes() {
    if (MOCK_PAYPAL) return mock.disputes;
    const j = await call('GET', '/v1/customer/disputes?dispute_state=REQUIRED_ACTION&page_size=20');
    return (j.items || []).map((d) => ({
      dispute_id: d.dispute_id, reason: d.reason, status: d.status,
      amount: Number(d.dispute_amount?.value || 0),
      transaction_id: d.disputed_transactions?.[0]?.seller_transaction_id,
      seller_response_due_date: d.seller_response_due_date,
    }));
  },

  async getDispute(id) {
    if (MOCK_PAYPAL) return mock.disputes.find((d) => d.dispute_id === id);
    const d = await call('GET', `/v1/customer/disputes/${id}`);
    return { ...d, buyer_message: d.messages?.find((m) => m.posted_by === 'BUYER')?.content };
  },

  async provideEvidence(id, note, order) {
    if (MOCK_PAYPAL) { mock.disputes = mock.disputes.filter((d) => d.dispute_id !== id); return ok('evidence submitted'); }
    const input = {
      evidences: [{
        evidence_type: order?.trackingNumber ? 'PROOF_OF_FULFILLMENT' : 'OTHER',
        evidence_info: order?.trackingNumber ? { tracking_info: [{ carrier_name: order.carrier, tracking_number: order.trackingNumber }] } : undefined,
        notes: note.slice(0, 2000),
      }],
    };
    const fd = new FormData();
    fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    return call('POST', `/v1/customer/disputes/${id}/provide-evidence`, fd, true);
  },

  async acceptClaim(id, note) {
    if (MOCK_PAYPAL) { mock.disputes = mock.disputes.filter((d) => d.dispute_id !== id); return ok('claim accepted, buyer refunded'); }
    return call('POST', `/v1/customer/disputes/${id}/accept-claim`, { note: note.slice(0, 2000) });
  },

  async listUnpaidInvoices() {
    if (MOCK_PAYPAL) return mock.invoices;
    const j = await call('GET', '/v2/invoicing/invoices?page_size=50&total_required=true');
    return (j.items || [])
      .filter((i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status))
      .map((i) => ({
        id: i.id,
        recipient: i.primary_recipients?.[0]?.billing_info?.email_address,
        amount: Number(i.amount?.value || 0),
        due_date: i.detail?.payment_term?.due_date,
        days_overdue: i.detail?.payment_term?.due_date ? daysSince(i.detail.payment_term.due_date) : 0,
        memo: i.detail?.memo || i.detail?.note || '',
      }));
  },

  async remindInvoice(id, note) {
    if (MOCK_PAYPAL) { mock.invoices = mock.invoices.filter((i) => i.id !== id); return ok('reminder sent'); }
    return call('POST', `/v2/invoicing/invoices/${id}/remind`, { subject: 'Friendly reminder: invoice due', note: note.slice(0, 4000), send_to_invoicer: true });
  },

  async addTracking(order) {
    if (MOCK_PAYPAL) { order.onHold = false; return ok('tracking added, hold release requested'); }
    const r = await call('POST', '/v1/shipping/trackers-batch', {
      trackers: [{ transaction_id: order.transactionId, tracking_number: order.trackingNumber, status: 'SHIPPED', carrier: order.carrier }],
    });
    order.onHold = false;
    return r;
  },
};
