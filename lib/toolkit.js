// PayPal Agent Toolkit (@paypal/agent-toolkit) gives the chat agent direct, read-only
// access to the seller's PayPal account. Write actions stay behind SellerShield's own
// approval + autopilot guardrails (see server.js execute()).
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;

let toolkit = null;
if (ID && SECRET) {
  try {
    // The package's ESM build fails to import lodash, so load the CommonJS build.
    const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
    toolkit = new PayPalAgentToolkit({
      clientId: ID,
      clientSecret: SECRET,
      configuration: {
        actions: {
          invoices: { list: true, get: true },
          disputes: { list: true, get: true },
          shipment: { get: true },
          orders: { get: true },
          transactions: { list: true },
        },
        context: { sandbox: (process.env.PAYPAL_BASE || 'sandbox').includes('sandbox') },
      },
    });
  } catch (e) {
    console.warn('PayPal Agent Toolkit unavailable:', e.message);
  }
}

export const TOOLKIT_ON = !!toolkit;

// Tool definitions in Anthropic format, prefixed so the model knows they come from PayPal.
export const toolkitDefs = toolkit
  ? toolkit.getTools().map((t) => ({
      name: `paypal_${t.function.name}`,
      description: `[PayPal Agent Toolkit, read-only] ${t.function.description}`.slice(0, 1000),
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }))
  : [];

export async function callToolkit(name, input) {
  const r = await toolkit.handleToolCall({
    id: `call_${Date.now()}`,
    type: 'function',
    function: { name: name.replace(/^paypal_/, ''), arguments: JSON.stringify(input || {}) },
  });
  const text = String(r.content ?? '');
  try { return JSON.parse(text); } catch { return text; }
}
