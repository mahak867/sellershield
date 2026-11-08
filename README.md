# SellerShield

An AI agent that protects a small seller's money on PayPal.

Small sellers lose money three ways: buyer disputes they don't have time to fight, funds held for weeks, and invoices clients never pay. SellerShield scans all three, decides what to do, drafts the response, and executes it on PayPal once the seller clicks **Approve**.

## What it does

| Problem | Agent action | PayPal API |
|---|---|---|
| Buyer opens a dispute | Reads dispute + seller's order record, decides FIGHT or ACCEPT, writes evidence citing tracking and delivery date | Disputes API: `GET /v1/customer/disputes`, `provide-evidence`, `accept-claim` |
| Funds on hold | Finds shipped orders whose tracking never reached PayPal, adds it (can trigger early release) | Tracking API: `POST /v1/shipping/trackers-batch` |
| Unpaid invoice | Writes a reminder whose tone matches days overdue, sends it | Invoicing API: `GET /v2/invoicing/invoices`, `remind` |

- Human in the loop: nothing reaches PayPal until the seller approves. Drafts are editable.
- AG Grid dashboard: money at risk, money recovered, full agent action log.
- Chat: ask the agent questions about your PayPal state.

## AI tools used

- **Claude (Anthropic API)**: dispute triage (fight vs accept with win confidence), evidence writing, reminder writing, chat. See `lib/ai.js`.
- Mock mode uses rule-based logic so the app runs without keys.

## Run it

Requires Node 18+.

```bash
git clone <this repo> && cd sellershield
npm install
cp .env.example .env   # optional: add keys, or leave blank for mock mode
npm start
```

Open http://localhost:3000 and click **Run agent**.

### Use the real PayPal sandbox

1. Create an app at https://developer.paypal.com/dashboard/applications/sandbox.
2. Put Client ID + Secret in `.env`.
3. Add `ANTHROPIC_API_KEY` for live Claude.
4. Create sandbox disputes/invoices with sandbox buyer and seller accounts.

## Deploy (Render)

New Web Service, build `npm install`, start `npm start`, add the env vars.

## License

MIT
