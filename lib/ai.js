// AI layer (Claude). Decides fight vs accept on disputes, drafts evidence and reminders.
// Falls back to rule-based mock output when ANTHROPIC_API_KEY is unset.
import Anthropic from '@anthropic-ai/sdk';

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

export const ai = {
  async planDispute(dispute, order) {
    if (MOCK_AI) return mockDispute(dispute, order);
    return askJson(`A buyer opened a PayPal dispute.
Dispute: ${JSON.stringify(dispute)}
Seller's order record: ${JSON.stringify(order ?? 'none found')}
Decide FIGHT or ACCEPT. If FIGHT, write the evidence note the seller submits to PayPal (factual, cite tracking and delivery date, under 150 words). If ACCEPT, write a short polite note to the buyer.
JSON keys: decision ("FIGHT"|"ACCEPT"), confidence (0-1 chance of winning if fought), reasoning (1-2 sentences for the seller), draft.`);
  },

  async planReminder(inv) {
    if (MOCK_AI) return mockReminder(inv);
    return askJson(`Unpaid PayPal invoice: ${JSON.stringify(inv)}
Write a payment reminder. Tone: friendly under 7 days overdue, firm 7-21 days, final notice over 21 days. Under 90 words. Keep the client relationship.
JSON keys: decision ("REMIND"), confidence (0-1 chance it gets paid after this reminder), reasoning (1 sentence), draft.`);
  },

  // Tool-using agent. `tools` maps tool name -> async handler(input).
  // Returns { reply, steps } where steps lists every tool the agent called.
  async agent(message, tools) {
    const steps = [];
    if (MOCK_AI) return mockAgent(message, tools, steps);

    const messages = [{ role: 'user', content: message }];
    for (let turn = 0; turn < 8; turn++) {
      const r = await client.messages.create({
        model: MODEL, max_tokens: 1500, tools: TOOL_DEFS, messages,
        system: SYSTEM + `
You talk with the seller in plain, short language. Use tools to look at real data before answering.
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
        try { out = await tools[u.name](u.input || {}); } catch (e) { out = { error: e.message }; }
        steps.push({ tool: u.name, input: u.input });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { reply: 'I stopped after 8 steps. Ask me to continue.', steps };
  },
};

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
    return { reply: `(mock AI) Done. I handled ${safe.length} high-confidence items worth $${total.toFixed(2)}. ${proposals.length - safe.length} need your review in the proposals list.`, steps };
  }
  const risk = await run('get_money_at_risk');
  const all = [...risk.disputes, ...risk.invoices, ...risk.holds];
  const total = all.reduce((s, x) => s + x.amount, 0);
  const top = all.sort((a, b) => b.amount - a.amount)[0];
  return { reply: `(mock AI) $${total.toFixed(2)} is at risk across ${risk.disputes.length} disputes, ${risk.invoices.length} overdue invoices and ${risk.holds.length} held orders.${top ? ` Biggest item: $${top.amount.toFixed(2)}.` : ''} Say "handle it" and I will act on everything I'm confident about.`, steps };
}

function mockDispute(d, o) {
  if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' && o?.trackingNumber && o.delivered) {
    return { decision: 'FIGHT', confidence: 0.86, reasoning: `Carrier shows delivery on ${o.delivered}. Strong proof of fulfillment.`,
      draft: `The order (${o.item}) shipped via ${o.carrier}, tracking ${o.trackingNumber}. The carrier confirms delivery to the buyer's PayPal address on ${o.delivered}. We request the dispute be resolved in the seller's favor.` };
  }
  if (d.amount < 25) {
    return { decision: 'ACCEPT', confidence: 0.3, reasoning: `Only $${d.amount}. Buyer claim is plausible and fighting costs more time than it saves.`,
      draft: `Sorry about the mix-up with your order. We've accepted your claim and you will be refunded in full.` };
  }
  return { decision: 'FIGHT', confidence: 0.62, reasoning: 'Listing states size clearly. Item matches description; moderate chance.',
    draft: `The item was shipped exactly as listed (${o?.item ?? 'item'}), with size stated in the title and photos. Tracking ${o?.trackingNumber ?? 'n/a'} confirms delivery on ${o?.delivered ?? 'n/a'}. We offered a return on receipt of the item.` };
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
