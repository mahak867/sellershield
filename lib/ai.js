// AI layer (Claude). Decides fight vs accept on disputes, drafts evidence and reminders.
// Falls back to rule-based mock output when ANTHROPIC_API_KEY is unset.
import Anthropic from '@anthropic-ai/sdk';
import { toolkitDefs, callToolkit, TOOLKIT_ON } from './toolkit.js';

export const MOCK_AI = !process.env.ANTHROPIC_API_KEY;
const client = MOCK_AI ? null : new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

// Server-side refusal fallback: if a safety classifier declines, the API re-runs the request on
// Anthropic's recommended fallback model inside the same call (routed by refusal category).
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

const SYSTEM = `You are SellerShield, an agent that protects a small online seller's money on PayPal.
You are precise, honest and never invent facts. Use only the data given.
Fighting a dispute you will lose wastes the seller's time; recommend ACCEPT when evidence is weak and the amount is small.`;

const planSchema = (decisions) => ({
  type: 'object',
  properties: {
    decision: { type: 'string', enum: decisions },
    confidence: { type: 'number', description: '0 to 1' },
    reasoning: { type: 'string' },
    draft: { type: 'string' },
  },
  required: ['decision', 'confidence', 'reasoning', 'draft'],
  additionalProperties: false,
});

// Structured outputs guarantee schema-valid JSON. Thinking is always on for current models and
// counts toward max_tokens, so leave generous headroom; low effort keeps per-item plans fast.
// Same inputs give the same plan for an hour. Webhooks, sales and manual runs all re-scan the
// account; without this each re-scan would rewrite every draft (changing its fingerprint under
// the seller) and pay for the same answer again.
const planCache = new Map(); // prompt -> { at, value }
const PLAN_TTL = 3_600_000;
async function askJson(prompt, decisions) {
  const hit = planCache.get(prompt);
  if (hit && Date.now() - hit.at < PLAN_TTL) return hit.value;
  const r = await client.beta.messages.create({
    ...FALLBACK,
    model: MODEL, max_tokens: 16000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: planSchema(decisions) } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (r.stop_reason === 'refusal') throw new Error(`refused (${r.stop_details?.category ?? 'unknown'})`);
  if (r.stop_reason === 'max_tokens') throw new Error('hit max_tokens');
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const out = JSON.parse(text);
  if (decisions.includes(out?.decision) && typeof out.draft === 'string' && out.draft.trim()) {
    planCache.set(prompt, { at: Date.now(), value: out });
    if (planCache.size > 500) planCache.delete(planCache.keys().next().value);
  }
  return out;
}

// Validate Claude's JSON. On any failure (network, bad JSON, odd values) use the rule-based
// plan so a live demo never breaks. `source` tells the UI which brain produced the plan.
// Counts of which brain produced each plan, so a silent fallback to rules is visible in the UI.
export const aiStats = { claude: 0, rules: 0, lastError: null };

async function safePlan(allowed, live, fallback) {
  if (MOCK_AI) return { ...fallback(), source: 'rules' };
  try {
    const p = await live();
    const confidence = Math.min(1, Math.max(0, Number(p.confidence)));
    if (!allowed.includes(p.decision) || Number.isNaN(confidence) || typeof p.draft !== 'string' || !p.draft.trim()) throw new Error('bad plan shape');
    aiStats.claude += 1;
    return { decision: p.decision, confidence, reasoning: String(p.reasoning || ''), draft: p.draft.trim(), source: 'claude' };
  } catch (e) {
    console.warn('Claude plan failed, using rules:', e.message);
    aiStats.rules += 1;
    aiStats.lastError = String(e.message).slice(0, 200);
    return { ...fallback(), source: 'rules' };
  }
}

export const ai = {
  async planDispute(dispute, order, protection, records = []) {
    return safePlan(['FIGHT', 'ACCEPT'], () => askJson(`A buyer opened a PayPal dispute.
Dispute: ${JSON.stringify(dispute)}
Seller's order record: ${JSON.stringify(order ?? 'none found')}
PayPal Seller Protection check (deterministic, from PayPal's published rules): ${JSON.stringify(protection)}
Weigh coverage heavily: LIKELY_COVERED means strong odds; NOT_COVERED means the seller must win on evidence alone.
For "not as described" claims, a Channel3 product catalog record (if present) gives independent product facts: cite it when the facts support the listing, and recommend ACCEPT if they support the buyer's claim.
Records you may cite: ${JSON.stringify(records)}
Citation rule: every sentence that states an amount, date, tracking number or ID must end with the record ref it comes from, like [R2], and must copy that value exactly as written in the record. Never state a fact that is not in a record.
Decide FIGHT or ACCEPT. If FIGHT, write the evidence note the seller submits to PayPal (factual, cite tracking and delivery date, under 150 words). If ACCEPT, write a short polite note to the buyer.
Fields: decision (FIGHT or ACCEPT), confidence (0-1 chance of winning if fought), reasoning (1-2 sentences for the seller), draft (the text to send).`, ['FIGHT', 'ACCEPT']), () => mockDispute(dispute, order, protection, records));
  },

  async planReminder(inv) {
    return safePlan(['REMIND'], () => askJson(`Unpaid PayPal invoice: ${JSON.stringify(inv)}
Write a payment reminder. Tone: friendly under 7 days overdue, firm 7-21 days, final notice over 21 days. Under 90 words. Keep the client relationship.
Fields: decision (REMIND), confidence (0-1 chance it gets paid after this reminder), reasoning (1 sentence), draft (the reminder text).`, ['REMIND']), () => mockReminder(inv));
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
      const r = await client.beta.messages.create({
        ...FALLBACK,
        model: MODEL, max_tokens: 16000, output_config: { effort: 'medium' },
        tools: [...TOOL_DEFS, ...toolkitDefs], messages,
        system: SYSTEM + `
You talk with the seller in plain, short language. Use tools to look at real data before answering.
Tools starting with paypal_ come from the PayPal Agent Toolkit and read the account directly (invoices, disputes, orders, transactions, shipment tracking).
Only call execute_proposal when the seller clearly asked you to act. Say what you did and the dollar amounts.`,
      });
      if (r.stop_reason === 'refusal') throw new Error(`refused (${r.stop_details?.category ?? 'unknown'})`);
      // Append the full content unchanged (thinking and fallback blocks must be passed back as-is).
      messages.push({ role: 'assistant', content: r.content });
      const uses = r.content.filter((c) => c.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !uses.length) {
        return { reply: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim(), steps };
      }
      const results = [];
      for (const u of uses) {
        let out, isError = false;
        try {
          if (!u.name.startsWith('paypal_') && !tools[u.name]) throw new Error(`unknown tool ${u.name}`);
          out = u.name.startsWith('paypal_') ? await callToolkit(u.name, u.input) : await tools[u.name](u.input || {});
        } catch (e) { out = { error: e.message }; isError = true; }
        steps.push({ tool: u.name, input: u.input });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000), ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { reply: 'I stopped after 8 steps. Ask me to continue.', steps };
  }
}

const TOOL_DEFS = [
  { name: 'get_money_at_risk', strict: true, description: "List the seller's open PayPal disputes, overdue invoices and held orders with amounts.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_protection_readiness', strict: true, description: "Check every sale against PayPal Seller Protection proof requirements before any dispute exists. Returns how many sales are ready, and for each sale its status (READY, AGENT_CAN_FIX, WAITING, AT_RISK) and what is missing.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'scan', strict: true, description: 'Run the review: decide an action for every dispute, invoice and hold. Returns proposals with id, decision, confidence, reasoning and draft text.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'execute_proposal', strict: true, description: 'Execute one proposal on PayPal (submit evidence, accept claim, send reminder or add tracking). Only when the seller asked. Guardrails still apply: drafts that fail the citation check are refused.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'proposal id from scan, e.g. "dispute:PP-D-1001"' } }, required: ['id'], additionalProperties: false } },
];

async function mockAgent(message, tools, steps) {
  const m = message.toLowerCase();
  const run = async (name, input = {}) => { steps.push({ tool: name, input }); return tools[name](input); };
  if (/(protect|ready|covered|safe)/.test(m) && tools.get_protection_readiness) {
    const rd = await run('get_protection_readiness');
    const gaps = rd.rows.filter((r) => r.status !== 'READY');
    return { reply: `${rd.ready} of ${rd.total} sales meet PayPal's Seller Protection proof requirements ($${rd.amountReady.toFixed(2)} of $${rd.amountTotal.toFixed(2)}).${gaps.length ? ' Not ready: ' + gaps.map((r) => `${r.item} (${r.checks.filter((c) => !c.pass).map((c) => c.rule.toLowerCase()).join(', ')})`).join('; ') + '.' : ''}${rd.fixable ? ` I can fix ${rd.fixable} of these by sending tracking to PayPal. Say "handle it".` : ''}`, steps };
  }
  if (/(handle|fix|do it|go|execute|approve|all)/.test(m)) {
    const { proposals } = await run('scan');
    const safe = proposals.filter((p) => p.confidence >= 0.8 && !(p.issues || []).length);
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

function mockDispute(d, o, prot, records = []) {
  const status = prot?.status;
  const R = `[${records.find((r) => r.source.startsWith('Seller order book'))?.ref || 'R1'}]`;
  if (prot?.checks?.[0] && !prot.checks[0].pass) {
    return { decision: 'ACCEPT', confidence: 0.1, reasoning: 'The PayPal response deadline has passed. Accept and refund to avoid a forced loss plus a mark on your account.',
      draft: `Sorry about the trouble with your order. We've accepted your claim and you will be refunded in full.` };
  }
  if (status === 'LIKELY_COVERED') {
    return { decision: 'FIGHT', confidence: 0.9, reasoning: `Covered by Seller Protection: ${o.carrier} shows delivery on ${o.delivered} to the transaction address.`,
      draft: `The order (${o.item}) shipped via ${o.carrier} with tracking ${o.trackingNumber} ${R}. The carrier confirms delivery to the shipping address on the PayPal transaction on ${o.delivered}${o.signature ? ', with recipient signature' : ''} ${R}. This meets the PayPal Seller Protection proof-of-delivery requirements, so we ask that the case be decided in the seller's favor.` };
  }
  if (status === 'NEEDS_EVIDENCE' && d.amount >= 50 && o?.trackingNumber) {
    return { decision: 'FIGHT', confidence: 0.55, reasoning: `${prot.summary} Worth fighting at $${d.amount} if the carrier confirms delivery in time.`,
      draft: `The order (${o?.item ?? 'item'}) shipped via ${o?.carrier ?? 'carrier'} with tracking ${o?.trackingNumber ?? 'n/a'} ${R}, to the address on the PayPal transaction. We will add the carrier's delivery confirmation as soon as it is posted.` };
  }
  if (d.amount < 25 || !o?.trackingNumber) {
    return { decision: 'ACCEPT', confidence: 0.3, reasoning: `${status === 'NOT_COVERED' ? 'Not covered by Seller Protection. ' : ''}Only $${d.amount} and weak evidence: fighting costs more time than it saves.`,
      draft: `Sorry about the trouble with your order. We've accepted your claim and you will be refunded in full.` };
  }
  const cat = records.find((r) => r.source.startsWith('Channel3'));
  const catLine = cat?.fields?.attributes ? ` The independent Channel3 product catalog lists this item as ${cat.fields.title} (${cat.fields.attributes}) [${cat.ref}], matching the listing.` : '';
  return { decision: 'FIGHT', confidence: cat ? 0.6 : 0.5,
    reasoning: `Not covered by Seller Protection, so this rests on evidence.${cat ? ' Channel3 catalog facts back the listing.' : ' The listing stated the details clearly;'} Moderate odds.`,
    draft: `The item (${o.item}) was shipped exactly as listed, with the details stated in the title and photos. Tracking ${o.trackingNumber} ${o.delivered ? `shows delivery on ${o.delivered}` : 'confirms shipment'} ${R}.${catLine} We offered a return on receipt of the item.` };
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
