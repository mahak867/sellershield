// Model Context Protocol endpoint (Streamable HTTP, JSON responses, no server-initiated stream).
// Lets another AI agent (the seller's own assistant, a storefront agent) ask SellerShield what
// money is stuck and act on it. The outside agent gets no more power than the seller delegated:
// it can only send the exact draft SellerShield proposed, and only inside the autopilot limits.
// Dependency-free: JSON-RPC 2.0 over one POST route.
const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const noArgs = { type: 'object', properties: {}, additionalProperties: false };
export const MCP_TOOLS = [
  { name: 'get_protection_readiness', inputSchema: noArgs,
    description: "Check every sale against PayPal Seller Protection proof requirements before any dispute exists. Returns how many sales are ready and, per sale, its status (READY, AGENT_CAN_FIX, WAITING, AT_RISK) and what is missing." },
  { name: 'get_money_at_risk', inputSchema: noArgs,
    description: "List the seller's open PayPal disputes, overdue invoices and orders whose tracking never reached PayPal, with amounts." },
  { name: 'review_account', inputSchema: noArgs,
    description: 'Run the SellerShield agent: one proposed action per dispute, invoice and order. Each proposal has an id, decision, confidence, draft, a SHA-256 fingerprint of exactly what would be sent to PayPal, and withinPolicy (whether you may approve it).' },
  { name: 'approve_action',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Proposal id from review_account, e.g. "hold:1AB23456CD789012E"' }, fingerprint: { type: 'string', description: 'The fingerprint returned with that proposal' } }, required: ['id', 'fingerprint'], additionalProperties: false },
    description: "Execute one proposal on PayPal. Allowed only when the seller has turned autopilot on and the proposal is inside the seller's limits (max amount, min confidence) and passes the citation check. Otherwise it is refused and stays queued for the seller." },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// handlers: { [toolName]: async (args) => any }. sessionId: the caller's workspace id.
export async function handleMcp(req, res, handlers, sessionId) {
  const msg = req.body;
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return res.status(400).json(fail(msg?.id, -32600, 'Expected one JSON-RPC 2.0 request'));
  }
  if (msg.id === undefined) return res.status(202).end(); // notification (e.g. notifications/initialized)
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    res.setHeader('Mcp-Session-Id', sessionId);
    return res.json(ok(id, {
      protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'sellershield', title: 'SellerShield', version: '1.0.0' },
      instructions: 'SellerShield watches a small PayPal seller\'s money: sales that are not yet covered by Seller Protection, overdue invoices and disputes. Call get_protection_readiness or review_account first. approve_action only works inside the limits the seller set; a refusal means the seller must approve it in the dashboard.',
    }));
  }
  if (method === 'ping') return res.json(ok(id, {}));
  if (method === 'tools/list') return res.json(ok(id, { tools: MCP_TOOLS }));
  if (method === 'tools/call') {
    const tool = MCP_TOOLS.find((t) => t.name === params.name);
    if (!tool) return res.json(fail(id, -32602, `Unknown tool: ${params.name}`));
    const args = params.arguments || {};
    const missing = (tool.inputSchema.required || []).filter((k) => typeof args[k] !== 'string' || !args[k]);
    if (missing.length) return res.json(fail(id, -32602, `Missing argument: ${missing.join(', ')}`));
    try {
      const out = await handlers[tool.name](args);
      return res.json(ok(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out }));
    } catch (e) { // tool errors go back to the model as a result, not as a protocol error
      return res.json(ok(id, { content: [{ type: 'text', text: e.message }], isError: true }));
    }
  }
  return res.json(fail(id, -32601, `Method not found: ${method}`));
}
