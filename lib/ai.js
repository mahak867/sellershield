// AI layer (Claude). Decides fight vs accept on disputes, drafts evidence and reminders.
// Falls back to rule-based mock output when ANTHROPIC_API_KEY is unset.
import Anthropic from '@anthropic-ai/sdk';
import { toolkitDefs, callToolkit, TOOLKIT_ON } from './toolkit.js';

export const MOCK_AI = !process.env.ANTHROPIC_API_KEY;
const client = MOCK_AI ? null : new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are SellerShield, an agent that protects a small online seller's money on PayPal.
You are precise, honest and never invent facts. Use only the data given.
Fighting a dispute you will lose wastes the seller's time; recommend ACCEPT when evidence is weak and the amount is small.`;

async function askJson(prompt) {
  const r = await client.messages.create({
    model: MODEL, max_tokens: 1200, system: SYSTEM,
    messages: [{ role: 'user', content: `${prompt}\n\nReply with ONLY a JSON object, no prose.` }],
  });
  const text = r.content.map((c) => c.text || '').join('');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

// Validate Claude's JSON. On any failure (network, bad JSON, odd values) use the rule-based
// plan so a live demo never breaks. `source` tells the UI which brain produced the plan.
async function safePlan(allowed, live, fallback) {
  if (MOCK_AI) return { ...fallback(), source: 'rules' };
  try {
    const p = await live();
    const confidence = Math.min(1, Math.max(0, Number(p.confidence)));
    if (!allowed.includes(p.decision) || Number.isNaN(confidence) || typeof p.draft !== 'string' || !p.draft.trim()) throw new Error('bad plan shape');
    return { decision: p.decision, confidence, reasoning: String(p.reasoning || ''), draft: p.draft.trim(), source: 'claude' };
  } catch (e) {
    console.warn('Claude plan failed, using rules:', e.message);
    return { ...fallback(), source: 'rules' };
  }
}

export const ai = {
  async planDispute(dispute, order, protection) {
    return safePlan(['FIGHT', 'ACCEPT'], () => askJson(`A buyer opened a PayPal dispute.
Dispute: ${JSON.stringify(dispute)}
Seller's order record: ${JSON.stringify(order ?? 'none found')}
PayPal Seller Protection check (deterministic, from PayPal's published rules): ${JSON.stringify(protection)}
Weigh coverage heavily: LIKELY_COVERED means strong odds; NOT_COVERED means the seller must win on evidence alone.
Decide FIGHT or ACCEPT. If FIGHT, write the evidence note the seller submits to PayPal (factual, cite tracking and delivery date, under 150 words). If ACCEPT, write a short polite note to the buyer.
JSON keys: decision ("FIGHT"|"ACCEPT"), confidence (0-1 chance of winning if fought), reasoning (1-2 sentences for the seller), draft.`), () => mockDispute(dispute, order, protection));
  },

  async planReminder(inv) {
    return safePlan(['REMIND'], () => askJson(`Unpaid PayPal invoice: ${JSON.stringify(inv)}
Write a payment reminder. Tone: friendly under 7 days overdue, firm 7-21 days, final notice over 21 days. Under 90 words. Keep the client relationship.
JSON keys: decision ("REMIND"), confidence (0-1 chance it gets paid after this reminder), reasoning (1 sentence), draft.`), () => mockReminder(inv));
  },

  // Tool-using agent. `tools` maps tool name -> async handler(input).
  // Returns { reply, steps } where steps lists every tool the agent called.
  async agent(message, tools) {
    const steps = [];
    if (MOCK_AI) return mockAgent(message, tools, steps);
    try { return await liveAgent(message, tools, steps); }
    catch (e) {
      console.warn('Claude agent failed, using rules:', e.message);
      return mockAgent(message, tools, steps);
    }
  },
};

async function liveAgent(message, tools, steps) {
  {

    const messages = [{ role: 'user', content: message }];
    for (let turn = 0; turn < 8; turn++) {
      const r = await client.messages.create({
        model: MODEL, max_tokens: 1500, tools: [...TOOL_DEFS, ...toolkitDefs], messages,
        system: SYSTEM + `
You talk with the seller in plain, short language. Use tools to look at real data before answering.
Tools starting with paypal_ come from the PayPal Agent Toolkit and read the account directly (invoices, disputes, orders, transactions, shipment tracking).
Only call execute_proposal when the seller clearly asked you to act. Say what you did and the dollar amounts.`,
      });
      messages.push({ role: 'assistant', content: r.content });
      const uses = r.content.filter((c) => c.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !uses.length) {
        return { reply: r.content.map((c) => c.text || '').join('').trim(), steps };
      }
      const results = [];
      for (const u of uses) {
        let out;
        try { out = u.name.startsWith('paypal_') ? await callToolkit(u.name, u.input) : await tools[u.name](u.input || {}); } catch (e) { out = { error: e.message }; }
        steps.push({ tool: u.name, input: u.input });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { reply: 'I stopped after 8 steps. Ask me to continue.', steps };
  }
}

const TOOL_DEFS = [
  { name: 'get_money_at_risk', description: "List the seller's open PayPal disputes, overdue invoices and held orders with amounts.", input_schema: { type: 'object', properties: {} } },
  { name: 'scan', description: 'Run the review: decide an action for every dispute, invoice and hold. Returns proposals with id, decision, confidence, reasoning and draft text.', input_schema: { type: 'object', properties: {} } },
  { name: 'execute_proposal', description: 'Execute one proposal on PayPal (submit evidence, accept claim, send reminder or add tracking). Only when the seller asked.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'proposal id from scan, e.g. "dispute:PP-D-1001"' } }, required: ['id'] } },
];

async function mockAgent(message, tools, steps) {
  const m = message.toLowerCase();
  const run = async (name, input = {}) => { steps.push({ tool: name, input }); return tools[name](input); };
  if (/(handle|fix|do it|go|execute|approve|all)/.test(m)) {
    const { proposals } = await run('scan');
    const safe = proposals.filter((p) => p.confidence >= 0.8);
    for (const p of safe) await run('execute_proposal', { id: p.id });
    const total = safe.reduce((s, p) => s + p.amount, 0);
    return { reply: `Done. I handled ${safe.length} high-confidence items worth $${total.toFixed(2)}. ${proposals.length - safe.length} need your review in the proposals list.`, steps };
  }
  const risk = await run('get_money_at_risk');
  let tk = '';
  if (TOOLKIT_ON) {
    steps.push({ tool: 'paypal_list_invoices', input: {} });
    try {
      const inv = await callToolkit('paypal_list_invoices', { page: 1, page_size: 50, total_required: true });
      const open = (inv.items || []).filter((i) => i.status === 'SENT' || i.status === 'UNPAID').length;
      tk = ` PayPal Agent Toolkit confirms ${open} unpaid invoice${open === 1 ? '' : 's'} on your account.`;
    } catch { /* toolkit read is a bonus; ignore failures */ }
  }
  const all = [...risk.disputes, ...risk.invoices, ...risk.holds];
  const total = all.reduce((s, x) => s + x.amount, 0);
  const top = all.sort((a, b) => b.amount - a.amount)[0];
  return { reply: `$${total.toFixed(2)} is at risk across ${risk.disputes.length} disputes, ${risk.invoices.length} overdue invoices and ${risk.holds.length} held orders.${top ? ` Biggest item: $${top.amount.toFixed(2)}.` : ''}${tk} Say "handle it" and I will act on everything I'm confident about.`, steps };
}

function mockDispute(d, o, prot) {
  const status = prot?.status;
  if (prot?.checks?.[0] && !prot.checks[0].pass) {
    return { decision: 'ACCEPT', confidence: 0.1, reasoning: 'The PayPal response deadline has passed. Accept and refund to avoid a forced loss plus a mark on your account.',
      draft: `Sorry about the trouble with your order. We've accepted your claim and you will be refunded in full.` };
  }
  if (status === 'LIKELY_COVERED') {
    return { decision: 'FIGHT', confidence: 0.9, reasoning: `Covered by Seller Protection: ${o.carrier} shows delivery on ${o.delivered} to the transaction address.`,
      draft: `The order (${o.item}) shipped via ${o.carrier}, tracking ${o.trackingNumber}. The carrier confirms delivery to the shipping address on the PayPal transaction on ${o.delivered}${o.signature ? ', with recipient signature' : ''}. This meets PayPal Seller Protection proof-of-delivery requirements. We request the dispute be resolved in the seller's favor.` };
  }
  if (status === 'NEEDS_EVIDENCE' && d.amount >= 50 && o?.trackingNumber) {
    return { decision: 'FIGHT', confidence: 0.55, reasoning: `${prot.summary} Worth fighting at $${d.amount} if the carrier confirms delivery in time.`,
      draft: `The order (${o?.item ?? 'item'}) shipped via ${o?.carrier ?? 'carrier'}, tracking ${o?.trackingNumber ?? 'n/a'}, to the address on the PayPal transaction. Carrier tracking is attached; we will add the delivery confirmation as soon as the carrier posts it.` };
  }
  if (d.amount < 25 || !o?.trackingNumber) {
    return { decision: 'ACCEPT', confidence: 0.3, reasoning: `${status === 'NOT_COVERED' ? 'Not covered by Seller Protection. ' : ''}Only $${d.amount} and weak evidence: fighting costs more time than it saves.`,
      draft: `Sorry about the trouble with your order. We've accepted your claim and you will be refunded in full.` };
  }
  return { decision: 'FIGHT', confidence: 0.5, reasoning: 'Not covered by Seller Protection, so this rests on evidence. The listing stated the details clearly; moderate odds.',
    draft: `The item was shipped exactly as listed (${o.item}), with details stated in the title and photos. Tracking ${o.trackingNumber} confirms delivery on ${o.delivered ?? 'n/a'}. We offered a return on receipt of the item.` };
}

function mockReminder(i) {
  const tone = i.days_overdue > 21 ? 'final' : i.days_overdue >= 7 ? 'firm' : 'friendly';
  const draft = {
    friendly: `Hi! Quick reminder that invoice ${i.id} for "${i.memo}" ($${i.amount}) was due ${i.due_date}. You can pay in one click with PayPal. Thanks so much!`,
    firm: `Hello, invoice ${i.id} for "${i.memo}" ($${i.amount}) is now ${i.days_overdue} days overdue. Please pay this week via the PayPal link. Let me know if anything is blocking payment.`,
    final: `Final notice: invoice ${i.id} ($${i.amount}) is ${i.days_overdue} days overdue. Please settle via PayPal within 5 days to avoid pausing further work.`,
  }[tone];
  return { decision: 'REMIND', confidence: tone === 'friendly' ? 0.7 : 0.55, reasoning: `${i.days_overdue} days overdue, ${tone} tone.`, draft };
}
