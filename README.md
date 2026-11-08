# SellerShield

**An AI agent that knows PayPal Seller Protection and defends a small seller's money.**

Small sellers lose money three ways:
- buyer disputes they don't have time to fight,
- funds held for weeks,
- invoices clients never pay.

SellerShield reacts the moment one of these happens: a PayPal webhook fires or a sale lands. It checks the case against PayPal's Seller Protection rules, decides what to do, writes the response, and executes it through PayPal's APIs. It acts either after one click from the seller or on its own under limits the seller sets.

## How to judge in 5 minutes

1. Open the hosted demo (link at the top of the Devpost page). It runs on the real PayPal sandbox.
2. Click **Load sandbox data**: real overdue invoices are created in the sandbox.
3. Click **Run agent**. Every item gets a proposal, and every dispute shows a **Seller Protection checklist**.
4. Turn on **Autopilot** (max $100, 80%), then click **Simulate dispute**. The **Live activity** feed shows the agent reacting and acting within the limits.
5. Click **Open store** and buy something with a PayPal sandbox buyer account. The sale triggers the agent, which flags the missing tracking. Approve it to post tracking to that real capture.
6. Open the **Agent audit log**: each action shows who triggered it and whether the PayPal call was **live** or **simulated**.

Disputes tagged **demo** are sample data, and actions on them are simulated. A real sandbox dispute (see "Real dispute, end to end" below) is handled live.

## Where SellerShield fits

The PayPal AI Hackathon has many strong single-purpose entries. Some go deeper than SellerShield on disputes alone, and some on invoice collection alone.

SellerShield's angle is **one agent and one inbox for all the seller's money at risk**:
- disputes, checked against Seller Protection rules,
- paid orders missing tracking,
- overdue invoices.

These are ranked by urgency, handled under one autopilot policy, and recorded in one audit log. A small seller doesn't want three tools; they want one place that tells them where their money is stuck and fixes it.

## Features

| Problem | What the agent does | PayPal API |
|---|---|---|
| Buyer opens a dispute | Reads the dispute and the seller's order record, decides **FIGHT** or **ACCEPT** with a win-confidence score, writes the evidence (tracking, delivery date) | Disputes API: list, get, `provide-evidence`, `accept-claim` |
| Paid orders with no tracking / held funds | Finds shipped orders whose tracking never reached PayPal and adds it. That protects the seller in "item not received" disputes and can trigger early release of held funds | Orders v2: `POST /v2/checkout/orders/{id}/track`; Tracking API: `trackers-batch` |
| Overdue invoice | Writes a reminder whose tone fits how late it is (friendly, firm, final) and sends it | Invoicing API: list, `remind`; create + send for demo data |

- **Live activity feed:** PayPal webhooks (`CUSTOMER.DISPUTE.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, ...) and storefront sales trigger the agent instantly. **Simulate dispute** shows the loop without a buyer account.
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

## Real dispute, end to end (sandbox)

PayPal's API doesn't let a seller create a dispute, but a sandbox buyer can open one:

1. Buy something in **Open store** with your sandbox buyer account.
2. Log in to sandbox.paypal.com as that buyer, open the payment, and report a problem (item not received).
3. In SellerShield, click **Run agent**. The real dispute appears, without a **demo** tag, linked to the order. The agent runs the Seller Protection check and drafts a response.
4. Approve it. If PayPal isn't accepting evidence yet (inquiry stage), SellerShield sends the same facts as a message to the buyer and logs that it did so.
5. Click **PayPal decides** (sandbox only). SellerShield asks PayPal's sandbox to settle the dispute, escalating it first if needed, and shows PayPal's outcome in the live feed.

## Policy test suite

```bash
npm run bench
```

The suite runs 30 hand-labelled disputes through the Seller Protection check and the planner. It uses Claude if `ANTHROPIC_API_KEY` is set, and rules otherwise. Results go to [`bench/RESULTS.md`](bench/RESULTS.md).

- The labels come from PayPal's published rules, so this checks policy fidelity, not real-world win rates.
- The suite already caught one bug: the planner recommended fighting with no tracking at all.

## Webhooks (real-time)

1. In your PayPal app, open **Webhooks** and add `https://<your-app>/api/webhooks/paypal`.
2. Subscribe it to Customer dispute created/updated, Payment capture completed, and Invoice paid.
3. Put the webhook ID in `PAYPAL_WEBHOOK_ID`.

Every event is checked with PayPal's `verify-webhook-signature` API before the agent runs. Unverified events are rejected.

## Deploy on Render

The repo includes `render.yaml`. In Render: **New, Blueprint**, pick this repo, then fill in the three secret env vars.

## Project layout

```
server.js        API: scan, approve, autopilot, chat agent, demo seeding
lib/paypal.js    PayPal REST client (OAuth, Disputes, Invoicing, Tracking)
lib/ai.js        Claude prompts, tool-use agent loop, rule-based fallback
lib/toolkit.js   PayPal Agent Toolkit tools exposed to the Claude agent
lib/protection.js  PayPal Seller Protection eligibility check
bench/           Policy test suite: 30 labelled disputes, runner, results
lib/store.js     In-memory order book, proposals, autopilot policy, audit log
public/          Dashboard (AG Grid) and demo storefront (PayPal Checkout)
```

## License

MIT
