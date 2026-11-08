# SellerShield

**An AI agent that defends a small seller's money on PayPal.**

Small sellers lose money three ways: buyer disputes they don't have time to fight, funds held for weeks, and invoices clients never pay. SellerShield watches all three, decides what to do, writes the response, and executes it through PayPal's APIs, either after one click from the seller or on its own under rules the seller sets.

## Features

| Problem | What the agent does | PayPal API |
|---|---|---|
| Buyer opens a dispute | Reads the dispute and the seller's order record, decides **FIGHT** or **ACCEPT** with a win-confidence score, writes the evidence (tracking, delivery date) | Disputes API: list, get, `provide-evidence`, `accept-claim` |
| Paid orders with no tracking / held funds | Finds shipped orders whose tracking never reached PayPal and adds it. That protects the seller in "item not received" disputes and can trigger early release of held funds | Orders v2: `POST /v2/checkout/orders/{id}/track`; Tracking API: `trackers-batch` |
| Overdue invoice | Writes a reminder whose tone fits how late it is (friendly, firm, final) and sends it | Invoicing API: list, `remind`; create + send for demo data |

- **Autopilot:** the seller sets a max amount and minimum confidence. The agent acts alone inside those limits and queues everything else for review.
- **Chat agent built on the PayPal Agent Toolkit:** a Claude tool-use agent combines `@paypal/agent-toolkit` (read-only: invoices, disputes, orders, transactions, shipment tracking) with SellerShield's own guarded actions (`scan`, `execute_proposal`).
- **Real storefront:** `/shop.html` is a demo store with PayPal Checkout buttons. A sandbox buyer pays for real (Orders v2 create + capture), and the paid order appears in SellerShield needing tracking.
- **Human in the loop:** every draft is editable. Nothing reaches PayPal without approval or an autopilot rule.
- **AG Grid dashboards:**
  - Money at risk is ranked by an urgency score with colored bars, shows the agent's decision in each row, and has per-row Approve buttons.
  - Checkbox bulk approve, quick search, number filters, a pinned totals row and CSV export.
  - A full audit log shows every action, who triggered it, live or simulated, and exactly what was sent.
- **KPIs:** money at risk, money protected, hours saved, actions taken.

## AI tools used

- **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) in `lib/toolkit.js`: PayPal's tools are handed to Claude.
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

To make a real sale: click **Open store**, pay with your sandbox buyer account (developer.paypal.com, Testing Tools, Sandbox Accounts), then return to the dashboard and click **Run agent**. The order appears as **Needs tracking**, and approving it posts tracking to PayPal on that real capture.

Data sources in sandbox mode:
- Invoices: live from PayPal.
- Disputes: live from PayPal. Sellers cannot create disputes through the API, so when the sandbox has none, demo disputes fill in. They are tagged **demo** and actions on them are simulated. Set `DEMO_FILL=0` to turn this off.
- Orders: real when bought through `/shop.html`. Pre-loaded held-funds examples are demo records, tagged **demo**.
- The audit log marks each action as `live` or `simulated`.

## Deploy on Render

The repo includes `render.yaml`. In Render: **New, Blueprint**, pick this repo, then fill in the three secret env vars.

## Project layout

```
server.js        API: scan, approve, autopilot, chat agent, demo seeding
lib/paypal.js    PayPal REST client (OAuth, Disputes, Invoicing, Tracking)
lib/ai.js        Claude prompts, tool-use agent loop, rule-based fallback
lib/toolkit.js   PayPal Agent Toolkit tools exposed to the Claude agent
lib/store.js     In-memory order book, proposals, autopilot policy, audit log
public/          Dashboard (AG Grid) and demo storefront (PayPal Checkout)
```

## License

MIT
