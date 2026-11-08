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

  async chat(message, ctx) {
    if (MOCK_AI) {
      const atRisk = ctx.disputes.reduce((s, d) => s + d.amount, 0) + ctx.invoices.reduce((s, i) => s + i.amount, 0) + ctx.holds.reduce((s, o) => s + o.amount, 0);
      return `(mock AI) You have $${atRisk.toFixed(2)} at risk: ${ctx.disputes.length} disputes, ${ctx.invoices.length} unpaid invoices, ${ctx.holds.length} held orders. Click "Run agent" and I will propose an action for each.`;
    }
    const r = await client.messages.create({
      model: MODEL, max_tokens: 600, system: SYSTEM + '\nAnswer the seller in plain, short language.',
      messages: [{ role: 'user', content: `Seller's current PayPal state: ${JSON.stringify(ctx)}\n\nSeller asks: ${message}` }],
    });
    return r.content.map((c) => c.text || '').join('');
  },
};

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
