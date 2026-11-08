# SellerShield

**An AI agent that defends a small seller's money on PayPal.**

Small sellers lose money three ways: buyer disputes they don't have time to fight, funds held for weeks, and invoices clients never pay. SellerShield watches all three, decides what to do, writes the response, and executes it through PayPal's APIs, either after one click from the seller or on its own under rules the seller sets.

## Features

| Problem | What the agent does | PayPal API |
|---|---|---|
| Buyer opens a dispute | Reads the dispute and the seller's order record, decides **FIGHT** or **ACCEPT** with a win-confidence score, writes the evidence (tracking, delivery date) | Disputes API: list, get, `provide-evidence`, `accept-claim` |
| Funds on hold | Finds shipped orders whose tracking never reached PayPal and adds it, which can trigger early release | Tracking API: `POST /v1/shipping/trackers-batch` |
| Overdue invoice | Writes a reminder whose tone fits how late it is (friendly, firm, final) and sends it | Invoicing API: list, `remind`; create + send for demo data |

- **Autopilot:** the seller sets a max amount and minimum confidence. The agent acts alone inside those limits and queues everything else for review.
- **Chat agent:** a Claude tool-use agent (`get_money_at_risk`, `scan`, `execute_proposal`) answers questions about the account and takes action when asked.
- **Human in the loop:** every draft is editable. Nothing reaches PayPal without approval or an autopilot rule.
- **AG Grid dashboards:** money at risk, plus a full audit log of every action, who triggered it, and exactly what was sent.
- **KPIs:** money at risk, money protected, hours saved, actions taken.

## AI tools used

- **Claude (Anthropic API)** in `lib/ai.js`:
  - Dispute triage: FIGHT vs ACCEPT, confidence, reasoning, evidence text.
  - Reminder writing with tone matched to days overdue.
  - Tool-use agent loop for the chat, which calls the app's own PayPal functions.
- Without an Anthropic key, a rule-based fallback runs so the app still works.

## Quick start

Requires Node 18+.

```bash
git clone https://github.com/mahak867/sellershield && cd sellershield
npm install
npm start
```

Open http://localhost:3000 and click **Run agent**. With no keys, everything runs on built-in demo data.

### Real PayPal sandbox + live Claude

```bash
cp .env.example .env
```

Fill in:
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: a sandbox REST app from developer.paypal.com. Enable **Invoicing** in the app's features.
- `ANTHROPIC_API_KEY`: for live Claude.

Then `npm start`, click **Load sandbox data** to create real overdue invoices in your sandbox, and click **Run agent**.

Data sources in sandbox mode:
- Invoices: live from PayPal.
- Disputes: live from PayPal. Sellers cannot create disputes through the API, so when the sandbox has none, demo disputes fill in. They are tagged **demo** and actions on them are simulated. Set `DEMO_FILL=0` to turn this off.
- Held orders: demo records from the seller's own order book, tagged **demo**.
- The audit log marks each action as `live` or `simulated`.

## Deploy on Render

The repo includes `render.yaml`. In Render: **New, Blueprint**, pick this repo, then fill in the three secret env vars.

## Project layout

```
server.js        API: scan, approve, autopilot, chat agent, demo seeding
lib/paypal.js    PayPal REST client (OAuth, Disputes, Invoicing, Tracking)
lib/ai.js        Claude prompts, tool-use agent loop, rule-based fallback
lib/store.js     In-memory order book, proposals, autopilot policy, audit log
public/          Dashboard (AG Grid)
```

## License

MIT
