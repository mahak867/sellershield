# SellerShield

[![tests](https://github.com/mahak867/sellershield/actions/workflows/test.yml/badge.svg)](https://github.com/mahak867/sellershield/actions/workflows/test.yml) ![license](https://img.shields.io/badge/license-MIT-blue)

**Get paid sooner. Keep what you earn.** An AI agent that makes every PayPal sale protection-ready the moment it lands, collects late invoices and answers disputes, within limits the seller sets.

Small sellers lose money three ways:
- buyer disputes they don't have time to fight,
- funds held for weeks,
- invoices clients never pay.

SellerShield reacts the moment one of these happens: a PayPal webhook fires or a sale lands. It checks the case against PayPal's Seller Protection rules, decides what to do, writes the response, and executes it through PayPal's APIs. It acts either after one click from the seller or on its own under limits the seller sets.

![SellerShield dashboard](docs/screenshots/1-dashboard.png)

## The problem, in PayPal's own words

- **Holds:** "Your funds are usually held for up to 21 days." The first step PayPal lists to avoid that delay is "Uploading tracking information of our supported carriers or printing a shipping label through PayPal." ([PayPal: funds on hold](https://www.paypal.com/au/brc/article/funds-on-hold))
- **Disputes:** Seller Protection doesn't cover buyer claims for items received that are "Significantly Not As Described". Item-not-received claims need proof of delivery to the address on the transaction. ([PayPal: Seller Protection](https://www.paypal.com/ca/brc/article/seller-protection), [Seller Protection policy](https://www.paypal.com/legalhub/seller-protection))
- **Unpaid invoices:** in Bonsai's analysis of 100,000+ freelancers, 29% of invoices were paid late ([Bonsai](https://www.hellobonsai.com/blog/late-freelance-payment)).

So a small seller has to know which disputes PayPal will cover, add tracking before trouble starts, and chase late invoices, all while running the business. SellerShield does that work and shows its reasoning.

## How to judge in 5 minutes

1. Open the hosted demo (link at the top of the Devpost page). On Render's free tier, the first load after idle can take about a minute while the server wakes up. It runs on the real PayPal sandbox, and your browser gets its own isolated workspace, so other judges can't reset or approve your items.
2. Click **Load sandbox data**: real overdue invoices are created in the sandbox.
3. Look at **Is every sale protected?**: each sale is already checked against Seller Protection, with what is missing and who fixes it. Then click **Run agent**. Every item gets a proposal, and every dispute shows a **Seller Protection checklist**.
4. Turn on **Autopilot** (max $100, 80%), then click **Simulate dispute**. The **Live activity** feed shows the agent reacting and acting within the limits.
5. Click **Open store** and buy something with a PayPal sandbox buyer account. The sale triggers the agent, which flags the missing tracking. Approve it to post tracking to that real capture.
6. Open the **Agent audit log**: each action shows who triggered it and whether the PayPal call was **live** or **simulated**.

Disputes tagged **demo** are sample data, and actions on them are simulated. A real sandbox dispute (see "Real dispute, end to end" below) is handled live.

## Where SellerShield fits

Most seller tools start working after a buyer has opened a dispute. By then the proof is either on PayPal or it isn't.

SellerShield starts at the sale:
- **Every sale is checked against Seller Protection the moment it lands**, before any dispute exists. The dashboard shows how many sales are protection-ready and who has to act on the rest: the agent, the carrier or the seller.
- **The agent closes the gaps it can.** It sends tracking to PayPal, which PayPal lists as the first step to avoid a payment hold and which is the proof an "item not received" claim needs.
- **Late invoices are collected** with reminders matched to how late they are.
- **Disputes that still arrive** are answered from records that are already in place.

One autopilot policy and one audit log cover all of it. A small seller doesn't want three tools; they want to get paid sooner and keep what they earn.

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
- **Record-cited evidence:** each dispute response may only state facts from numbered records:
  - the PayPal dispute,
  - the PayPal capture and order (fetched live),
  - the seller's order book.

  Any sentence with an amount, date or ID must cite a record, like `[R2]`, and every value in it must appear in that record. Otherwise the Approve button is disabled and the API refuses with `422`. PayPal receives the text plus a records appendix.
- **Evidence PDF pack:** one document holding the response, the Seller Protection checklist and every cited record. It's attached to the Disputes API `provide-evidence` call; if PayPal won't take a file at that stage, the text is sent alone. Sellers can also download it from the dispute card. It's generated with a small, dependency-free PDF writer (`lib/pdf.js`).
- **Approval fingerprints:** each proposal carries a SHA-256 fingerprint of exactly what will be sent. An approval must present the fingerprint of the current text: edit one character and it's a different payload (`409` if stale). The audit log records the approved fingerprint. Autopilot and the chat agent can only send the exact draft they proposed, and never one that fails the citation check.
- **AG Grid dashboards:**
  - Money at risk is ranked by an urgency score with colored bars, shows the agent's decision in each row, and has per-row Approve buttons.
  - Checkbox bulk approve, quick search, number filters, a pinned totals row and CSV export.
  - A full audit log shows every action, who triggered it, live or simulated, and exactly what was sent.
- **Protection-ready check on every sale:** `assessReadiness` in `lib/protection.js` runs the Seller Protection proof requirements on each order before any dispute. Each sale is Ready, Agent can fix, Waiting on carrier or Needs you.
- **Proof typed straight into AG Grid:** in the readiness grid, the seller types a missing carrier, tracking number or delivery date into the shaded cells. The server validates it, the sale's status updates, and tracking locks once it is on PayPal. Each row opens into a full-width checklist of every Seller Protection rule and who fixes it.
- **Channel3 record collected at sale time:** "not as described" is never covered by Seller Protection, so SellerShield looks up an independent product record for every sale when it first sees it, shows it in the sale's checklist, and reuses it if a dispute arrives.
- **Works with any store:** `POST /api/orders` and a small client library let any PayPal storefront register a sale (details below).
- **Audit log names the PayPal API** each action used, such as `Disputes: provide-evidence` or `Orders v2: track`.
- **One click to make sales ready:** the readiness grid has a button that sends tracking to PayPal for every sale the agent can fix. Each upload is an agent proposal approved by its fingerprint.
- **MCP server for other agents:** `POST /api/mcp` lets another AI agent check readiness, review the account and act, only inside the seller's autopilot limits (details below).
- **Visible AI source:** every plan is labelled Claude or rules, and the header badge counts how many plans Claude wrote and how many fell back, with the last error on hover.
- **KPIs:** sales protection-ready, money stuck or at risk, money protected, hours saved (an estimate: 45 minutes per dispute, 15 per tracking fix, 10 per reminder), actions taken.
- **AG Charts:** a "where your money is stuck" chart (at risk vs protected by category) and a donut of dispute dollars by Seller Protection status.
- **Bryntum Scheduler agent calendar:** each item at risk is a row. Drag a proposed action onto a day to approve it for that day (details below).
  - Dispute response windows are colored by Seller Protection status.
  - Overdue invoice periods and held funds (with an estimated release) are shown as bars.
  - The agent's actions appear on the rows they acted on.
  - Drag a **reminder** to reschedule it. The agent and autopilot wait until that day.

## AI tools used

- **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) in `lib/toolkit.js`: PayPal's tools are handed to Claude.
- **APIMatic: the PayPal Server SDK** (`@paypal/paypal-server-sdk`, generated by APIMatic) in `lib/paypal-sdk.js`. Every Orders and Payments call goes through it: create, capture, get order, get capture, add tracking. Captures use a fixed idempotency key per order, so a retried capture can't charge a buyer twice.
- **Claude Opus 5.5 (Anthropic API, `@anthropic-ai/sdk`)** in `lib/ai.js`:
  - Dispute and invoice plans use **structured outputs** (a JSON schema), so the output is always valid JSON. Low effort keeps them fast.
  - The chat agent runs at medium effort with **strict** tool schemas.
  - The server-side **refusal fallback** (`fallbacks: "default"`) is on. If anything still fails, the rules planner takes over.
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

## How each sponsor tool is used

| Tool | What it does in SellerShield | Code |
|---|---|---|
| **PayPal** (Disputes, Invoicing, Orders v2, Tracking, Webhooks, JS SDK) | The whole product: reads money at risk and acts on it in the sandbox | `lib/paypal.js`, `public/shop.html` |
| **PayPal Agent Toolkit** | Claude's read-only PayPal tools (invoices, disputes, orders, transactions, tracking) | `lib/toolkit.js` |
| **APIMatic** | 1. **Consumes** APIMatic's PayPal Server SDK for every Orders and Payments call (idempotent captures, PayPal's own `seller_protection` flag). 2. **Publishes** SellerShield's own OpenAPI spec in APIMatic's `src/spec` layout, so APIMatic can generate SDKs, a docs portal and an AI context plugin for other agents and storefronts to call SellerShield. The spec is lint-clean, served at `/api/openapi.yaml`, and a test keeps it in sync with the server. | `lib/paypal-sdk.js`, `apimatic/src/spec/openapi.yaml`, `test/openapi.test.js` |
| **Bryntum Scheduler** | **The agent calendar.** Every PayPal deadline, overdue period and hold is on one timeline. Each action the agent proposes is a bar: **dragging it onto a day approves it for that day**, bound to its SHA-256 fingerprint. PayPal's response deadline is enforced, and a background scheduler runs it on that day. The calendar is the approval interface. When a dispute is missing proof of delivery, the calendar shows a **two-step evidence plan**: a seller task ("📦 proof") linked by a **dependency arrow** to the agent's action. Clicking the task records the carrier's delivery date; the agent re-runs, Seller Protection flips to covered, and the draft cites the new fact. | `public/index.html` (module script), `server.js` (`/api/schedule`, `runSchedule`) |
| **AG Grid** | **Sale readiness grid:** every sale against Seller Protection, expandable full-width proof checklists, missing proof typed into cells and validated by the server, one-click bulk tracking upload. **Money-at-risk command center:** urgency ranking, the agent's call per row, per-row and bulk approve, quick search, number filters, totals row, CSV export. Cells flash on live updates. **Drafts can be edited inside the grid**: each edit is re-fingerprinted and citation-checked on the server before Approve unlocks. Draft edits support undo and redo, and column layout is saved per browser. | `public/index.html` |
| **AG Charts** | Where the money is stuck (at risk vs protected), a running total of money protected over time (hover shows who acted: seller, autopilot, calendar or chat), and dispute dollars by Seller Protection status | `public/index.html` (`renderCharts`) |
| **Channel3** | **Collected for every sale on the day it is made**, shown in the sale's checklist, and reused in disputes. **Independent product facts for "not as described" disputes.** Seller Protection doesn't cover these, so the seller must show the item matched its listing. The agent looks the item up in Channel3's catalog with the official `@channel3/sdk`. Brand, materials, key features and attributes such as size and color become a numbered evidence record. Claude may cite it, and the citation checker verifies it. Without a key, clearly labelled demo facts are used. | `lib/channel3.js`, `lib/evidence.js`, `test/channel3.test.js` |
| **Render** | One-click Blueprint deploy (`render.yaml`) with health check; webhooks point at the Render URL | `render.yaml` |

### Generate a SellerShield SDK, docs portal or AI context plugin with APIMatic

```bash
npm i -g @apimatic/cli && apimatic auth login
```

Then run any of:

```bash
npm run apimatic:validate
```

```bash
npm run apimatic:sdk
```

```bash
npm run apimatic:portal
```

```bash
npm run apimatic:plugin
```

## For developers: protect any store's sales in one call

SellerShield is not tied to its demo shop. Any storefront that takes PayPal can register a sale after checkout, and SellerShield starts watching it: the sale is checked against Seller Protection at once and the agent proposes sending the tracking to PayPal.

```js
import { SellerShield } from './sdk/sellershield.mjs';

const shield = new SellerShield({ baseUrl: 'https://<your-app>' });
const { readiness } = await shield.registerSale({
  transactionId: capture.id,          // the PayPal capture id
  item: 'Ceramic mug set', amount: 64,
  carrier: 'USPS', trackingNumber: '9400111899223197428490',
});
// readiness.status: READY | AGENT_CAN_FIX | WAITING | AT_RISK
```

- `sdk/sellershield.mjs` is a small client with no dependencies: `registerSale`, `readiness`, `review`, `approve`.
- The same call over HTTP is `POST /api/orders`, documented in the OpenAPI spec, so APIMatic can generate clients in other languages.
- Against the real sandbox, the capture must exist on the PayPal account. Its amount and Seller Protection eligibility are read from PayPal, not trusted from the caller.
- A sale registered without a tracking number shows as **Needs you**: the agent has nothing to send.

## Use SellerShield from another agent (MCP)

SellerShield is also a Model Context Protocol server, so a seller's own assistant or a storefront agent can use it. It is one route, `POST /api/mcp` (Streamable HTTP, JSON-RPC 2.0), with no extra dependency (`lib/mcp.js`).

| Tool | What it does |
|---|---|
| `get_protection_readiness` | Every sale checked against Seller Protection proof requirements, before any dispute |
| `get_money_at_risk` | Open disputes, overdue invoices and orders whose tracking never reached PayPal |
| `review_account` | Runs the agent: one proposal per item, each with a fingerprint and `withinPolicy` |
| `approve_action` | Executes one proposal on PayPal, if the seller allows it |

The outside agent gets no more power than the seller delegated:
- It can only send the exact draft SellerShield proposed, named by its SHA-256 fingerprint.
- `approve_action` is refused unless the seller has turned autopilot on **and** the proposal is inside the seller's limits and passes the citation check. A refused action stays queued for the seller.
- Every action it takes is in the audit log as `mcp agent`.

Copy the URL from **Connect your own agent** in the dashboard (it carries your demo workspace), then add it to an MCP client. For Claude Code:

```bash
claude mcp add --transport http sellershield "https://<your-app>/api/mcp?ws=<workspace-id>"
```

Then ask "Are my PayPal sales protected?". With autopilot off, the agent can report but not act.

## Real dispute, end to end (sandbox)

PayPal's API doesn't let a seller create a dispute, but a sandbox buyer can open one:

1. Buy something in **Open store** with your sandbox buyer account.
2. Log in to sandbox.paypal.com as that buyer, open the payment, and report a problem (item not received).
3. In SellerShield, click **Run agent**. The real dispute appears, without a **demo** tag, linked to the order. The agent runs the Seller Protection check and drafts a response.
4. Approve it. If PayPal isn't accepting evidence yet (inquiry stage), SellerShield sends the same facts as a message to the buyer and logs that it did so.
5. Click **PayPal decides** (sandbox only). SellerShield asks PayPal's sandbox to settle the dispute, escalating it first if needed, and shows PayPal's outcome in the live feed.

## Tests

```bash
npm test         # 50 tests: Seller Protection rules, sale readiness, proof entry, storefront client, MCP limits, plan reuse, citation checker, fingerprints, API guardrails, autopilot limits
npm run bench    # 30-case policy suite, uses Claude if ANTHROPIC_API_KEY is set
```

A browser smoke test clicks through every main flow (run agent, citation block, approve, evidence PDF, one-click tracking, autopilot on a simulated dispute, chat, calendar, reset, phone width) and prints PASS or FAIL per step. Start the app without keys, then:

```bash
npm run smoke
```

It needs Playwright (`npm i -D playwright && npx playwright install chromium`).

## Screenshots

| | |
|---|---|
| ![Seller Protection checklist and cited evidence](docs/screenshots/2-seller-protection-and-citations.png) | ![Bryntum money timeline](docs/screenshots/4-bryntum-timeline.png) |
| Seller Protection checklist, evidence records, fingerprint | Bryntum Scheduler money timeline |
| ![AG Grid money at risk](docs/screenshots/5-ag-grid-money-at-risk.png) | ![AG Charts](docs/screenshots/3-ag-charts.png) |
| AG Grid: urgency, agent decision, inline and bulk approve | AG Charts: where the money is stuck |

## Architecture

![Architecture](docs/screenshots/0-architecture.png)

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

Every event is checked with PayPal's `verify-webhook-signature` API before the agent runs. Unverified events are rejected, and retried deliveries of the same event are handled only once.

## Safety on a public demo

- **Rate limits:** API writes are capped per IP. "Load sandbox data" (which creates real sandbox invoices) is capped per IP and per day.
- **No double-sends:** one in-flight execution per item. For real PayPal objects, there's one write per item per 10 minutes across all visitors, so two judges can't both answer the same dispute.
- **Capped AI spend:** routes that make Claude think are limited to 20 calls a minute per IP, and the same dispute or invoice is planned once an hour, so a re-scan reuses the plan instead of paying for it again.
- **Demo data never goes stale:** demo deadlines and delivery dates are relative to today.
- **Bounded AI:** the AI never sends anything directly. Every write goes through the fingerprint and citation checks, and autopilot limits.

## Deploy on Render

The repo includes `render.yaml`. In Render: **New, Blueprint**, pick this repo, then fill in the secret env vars.

Render's free tier sleeps after about 15 idle minutes. To keep the demo awake for judges, and the agent calendar's scheduler running, set the GitHub repository variable `RENDER_URL` (Settings, Secrets and variables, Actions, Variables). `.github/workflows/keepalive.yml` then pings `/api/status` every 10 minutes.

## Project layout

```
server.js        API: scan, approve, autopilot, chat agent, demo seeding
lib/paypal.js    PayPal REST client (OAuth, Disputes, Invoicing, Tracking)
lib/ai.js        Claude prompts, tool-use agent loop, rule-based fallback
lib/toolkit.js   PayPal Agent Toolkit tools exposed to the Claude agent
lib/paypal-sdk.js  Orders + Payments via the APIMatic-generated PayPal Server SDK
lib/protection.js  PayPal Seller Protection eligibility check
lib/evidence.js  Evidence records, citation checker, approval fingerprints
lib/mcp.js       MCP endpoint: other agents act only inside the seller's limits
sdk/             Client library for storefronts (register a sale, check readiness, approve)
lib/workspace.js Per-visitor isolated demo workspaces
test/            npm test: unit + API tests (mock mode, no keys)
bench/           Policy test suite: 30 labelled disputes, runner, results
lib/store.js     In-memory order book, proposals, autopilot policy, audit log
public/          Dashboard (AG Grid, AG Charts, Bryntum Scheduler) and demo storefront (PayPal Checkout)
```

## License

MIT
