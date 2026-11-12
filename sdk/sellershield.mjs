// SellerShield client: a few lines to make any storefront's PayPal sales protection-ready.
// Dependency-free (uses fetch). Works in Node 18+ and in the browser.
//
//   import { SellerShield } from './sdk/sellershield.mjs';
//   const shield = new SellerShield({ baseUrl: 'https://your-sellershield.example' });
//   const { readiness } = await shield.registerSale({
//     transactionId: capture.id, item: 'Ceramic mug set', amount: 64,
//     carrier: 'USPS', trackingNumber: '9400111899223197428490',
//   });
//   // readiness.status: READY | AGENT_CAN_FIX | WAITING | AT_RISK
export class SellerShield {
  constructor({ baseUrl, workspace } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.workspace = workspace; // optional: the workspace id shown under "Connect your own agent"
  }

  async #call(path, body) {
    const headers = { 'Content-Type': 'application/json', ...(this.workspace ? { Cookie: `ss_ws=${this.workspace}` } : {}) };
    const r = await fetch(this.baseUrl + path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (!this.workspace && set) this.workspace = /ss_ws=([0-9a-f-]{36})/.exec(set)?.[1];
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  // Tell SellerShield about a paid PayPal sale. Returns the sale and its Seller Protection readiness.
  registerSale(sale) { return this.#call('/api/orders', sale); }

  // Every sale checked against the Seller Protection proof requirements.
  async readiness() { return (await this.#call('/api/risk')).readiness; }

  // Run the agent: one proposed action per dispute, overdue invoice and sale missing tracking.
  async review() { return (await this.#call('/api/agent/scan', {})).proposals; }

  // Approve one proposal exactly as proposed (bound to its fingerprint).
  approve(proposal) { return this.#call('/api/agent/approve', { id: proposal.id, fingerprint: proposal.fingerprint }); }
}
