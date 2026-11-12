# Devpost submission kit

Paste these sections into the Devpost form. Replace `<YOUTUBE_URL>` first.

**For judges in a hurry:** open the live demo and click **Guided tour**. It walks the real app in 11 steps (about two minutes), pressing the real buttons.

---

## Project name

SellerShield

## Tagline (short description)

Get paid sooner, keep what you earn: an AI agent that makes every PayPal sale protection-ready the moment it lands, collects late invoices and answers disputes within limits you set.

## Inspiration

Small sellers and freelancers don't lose money because they sell bad products. They lose it to paperwork.

- A buyer opens a dispute, and the seller has days to write a convincing response with the right evidence. Many never do.
- New sellers' funds can be held for about 21 days. Adding tracking can get them released earlier, but most sellers don't know that.
- Freelancers chase late invoices by hand. In one study of over 100,000 freelancers, 29% of invoices were paid late. Most late payments get paid after a single reminder, but nobody enjoys sending them.

Big merchants pay for chargeback teams and collections tools. Small sellers have nobody. We built them an agent.

## The problem, in PayPal's own words

- **Holds:** "Your funds are usually held for up to 21 days." The first step PayPal lists to avoid that delay is "Uploading tracking information of our supported carriers or printing a shipping label through PayPal." ([PayPal: funds on hold](https://www.paypal.com/au/brc/article/funds-on-hold))
- **Disputes:** Seller Protection doesn't cover buyer claims for items received that are "Significantly Not As Described". Item-not-received claims need proof of delivery to the address on the transaction. ([PayPal: Seller Protection](https://www.paypal.com/ca/brc/article/seller-protection), [Seller Protection policy](https://www.paypal.com/legalhub/seller-protection))
- **Unpaid invoices:** in Bonsai's analysis of 100,000+ freelancers, 29% of invoices were paid late ([Bonsai](https://www.hellobonsai.com/blog/late-freelance-payment)).

So a small seller has to know which disputes PayPal will cover, add tracking before trouble starts, and chase late invoices, all while running the business. SellerShield does that work and shows its reasoning.

## Where it fits

Most seller tools start working after a buyer has opened a dispute. By then the proof is either on PayPal or it isn't.

SellerShield starts at the sale:
- **Every sale is checked against Seller Protection the moment it lands**, before any dispute exists. The dashboard shows how many sales are protection-ready and who has to act on the rest: the agent, the carrier or the seller.
- **The agent closes the gaps it can.** It sends tracking to PayPal, which PayPal lists as the first step to avoid a payment hold and which is the proof an "item not received" claim needs.
- **Late invoices are collected** with reminders matched to how late they are.
- **Disputes that still arrive** are answered from records that are already in place.

- **Agent-made purchases are defensible.** A buyer's AI agent can shop the store inside a spending limit. If the buyer later disputes the purchase, SellerShield works out whose mistake it was and cites the buyer's own instructions.

One autopilot policy and one audit log cover all of it, and the **Story** button follows any single sale from payment to dispute. Most tools handle one moment of a sale; SellerShield follows the whole sale, on both sides.

How it works:
- **Seller Protection checklist** for every dispute (claim type, tracking, delivered status, address, deadline), computed in code from PayPal's published rules. Claude decides on top of those facts.
- **Prevention:** when a PayPal Checkout sale lands without tracking, the agent flags it and posts tracking to the capture.
- **Real time:** signature-verified PayPal webhooks and new sales trigger the agent at once.
- **Facts must be cited:** a dispute response may only state facts from numbered records:
  - the PayPal dispute,
  - the PayPal capture and order,
  - the seller's order book.

  Code checks that every amount, date and ID matches its cited record, and refuses to send anything that doesn't.
- **One evidence PDF:** the response, the Seller Protection checklist and the cited records go to PayPal as one document. The seller can download it too.
- **Approvals bound to the exact text:** every approval carries a SHA-256 fingerprint of what will be sent. Change a word and it needs a new approval. The audit log keeps the fingerprint.
- **Measured:** 157 automated tests (`npm test`) plus a 30-case policy suite (`npm run bench`). These caught two real bugs, both fixed:
  - the planner fought a dispute with no evidence,
  - an Approve button was wired to the wrong element.

## What it does

SellerShield connects to a seller's PayPal account and watches three places money gets stuck:

1. **Disputes:** reads each dispute and the seller's order record, runs the Seller Protection check, decides whether to FIGHT or ACCEPT with a win-confidence score, writes the evidence (carrier, tracking number, delivery date), and submits it through the PayPal Disputes API. For small claims it will lose, it recommends accepting, so the seller doesn't waste time.
2. **Orders missing tracking / held funds:** finds paid, shipped orders whose tracking never reached PayPal and adds it through the Orders v2 tracking API. That wins "item not received" disputes and can release held funds early. Our demo store takes real PayPal Checkout payments, so these orders are real sandbox captures.
3. **Overdue invoices:** writes a reminder whose tone matches how late the invoice is (friendly, firm, final notice) and sends it through the PayPal Invoicing API.

The seller stays in control:

- **Approve mode:** every action is a drafted proposal the seller can edit and approve with one click.
- **Autopilot:** the seller sets two rules, a max amount and a minimum confidence. The agent acts alone inside those limits and queues everything else.
- **Chat agent built on PayPal's Agent Toolkit:** ask "what's my biggest risk?" or say "handle it". Claude reads the account through `@paypal/agent-toolkit` tools and acts through SellerShield's guarded actions.
- **Both sides of the sale, handled by agents:** on the buyer page, an AI agent shops the store inside a spending limit the buyer sets, and the buyer approves the payment in PayPal. The agent can never create an order outside the limit. The buyer's instructions travel with the sale, so if they later claim the agent bought the wrong thing, the seller's response cites exactly what was asked for and approved.
- **Works with any store:** one call after checkout (`POST /api/orders`, or the small client in `sdk/`) registers a sale from any PayPal storefront, and SellerShield starts protecting it.
- **Open to other agents (MCP):** SellerShield is an MCP server. A seller's own assistant can check which sales are protected and act, but only inside the autopilot limits the seller set. Anything else is refused and waits for the seller, and every action is logged as `mcp agent`.
- **Live activity feed:** webhooks and sales appear as they happen, followed by what the agent did about them.
- **Audit log:** every action, who triggered it (seller, autopilot or chat agent), and exactly what was sent to PayPal.

The dashboard shows money at risk, money protected, hours saved and actions taken.

## How we built it

- **Backend:** Node.js + Express. A thin PayPal REST client handles OAuth and calls the Disputes, Invoicing, Orders v2 (create, capture, track) and Tracking APIs on the PayPal sandbox.
- **PayPal Agent Toolkit:** `@paypal/agent-toolkit` tools for invoices, disputes, orders, transactions and shipment tracking, converted to Claude tool definitions. Reads go straight through the toolkit. Writes go through SellerShield's approval and autopilot guardrails.
- **Storefront:** a small demo shop using the PayPal JavaScript SDK Buttons, with orders created and captured server-side.
- **AI:** Claude through the Anthropic API.
  - Structured JSON plans for each dispute and invoice: decision, confidence, reasoning and draft.
  - A tool-use agent loop for chat, with three tools: `get_money_at_risk`, `scan`, `execute_proposal`.
  - Every plan is validated. If Claude errors or returns bad output, a rule-based planner takes over, so the agent never stalls.
- **Frontend:** **AG Grid** is the seller's command center.
  - Rows are ranked by an urgency score (custom bar renderer), each showing the agent's decision and an Approve button.
  - Checkbox bulk approve, quick search, number filters, a pinned totals row and CSV export.
  - A second grid holds the audit log.
  - Light and dark mode, works on phones.
- **Seller Protection engine:** `lib/protection.js` encodes PayPal's published rules as a checklist. Its output is shown to the seller and passed to Claude.
- **Real time:** a PayPal webhook endpoint verifies signatures with `verify-webhook-signature`, then runs the agent. The dashboard receives events over Server-Sent Events.
- **Guardrails in code:**
  - `lib/evidence.js` builds the citable records, checks every value in a draft against its cited record, and fingerprints the exact payload.
  - The server refuses stale fingerprints (409) and uncited facts (422).
  - Autopilot skips anything that fails these checks.
- **Testing:** 157 automated tests (Node's test runner, mock mode, no keys), plus 30 labelled dispute cases with a runner that reports agreement for Claude or the rules fallback.
- **Hosting:** **Render** via a `render.yaml` blueprint.

## How each sponsor tool is used

| Tool | What it does in SellerShield | Code |
|---|---|---|
| **PayPal** (Disputes, Invoicing, Orders v2, Tracking, Webhooks, JS SDK) | The whole product: reads money at risk and acts on it in the sandbox | `lib/paypal.js`, `public/shop.html` |
| **PayPal Agent Toolkit** | Claude's read-only PayPal tools (invoices, disputes, orders, transactions, tracking) | `lib/toolkit.js` |
| **APIMatic** | 1. **Consumes** APIMatic's PayPal Server SDK for every Orders and Payments call (idempotent captures, PayPal's own `seller_protection` flag). 2. **Publishes** SellerShield's own OpenAPI spec in APIMatic's `src/spec` layout, so APIMatic can generate SDKs, a docs portal and an AI context plugin for other agents and storefronts to call SellerShield. The spec is lint-clean, served at `/api/openapi.yaml`, and a test keeps it in sync with the server. | `lib/paypal-sdk.js`, `apimatic/src/spec/openapi.yaml`, `test/openapi.test.js` |
| **Bryntum Scheduler** | **Sale journeys:** one row per sale with no-proof, transit and protection-ready bars linked by dependency arrows. **The agent calendar.** Every PayPal deadline, overdue period and hold is on one timeline. Each action the agent proposes is a bar: **dragging it onto a day approves it for that day**, bound to its SHA-256 fingerprint. PayPal's response deadline is enforced, and a background scheduler runs it on that day. The calendar is the approval interface. When a dispute is missing proof of delivery, the calendar shows a **two-step evidence plan**: a seller task ("📦 proof") linked by a **dependency arrow** to the agent's action. Clicking the task records the carrier's delivery date; the agent re-runs, Seller Protection flips to covered, and the draft cites the new fact. | `public/timeline.js`, `server.js` (`/api/schedule`, `runSchedule`) |
| **AG Grid** | **Sale readiness grid:** every sale against Seller Protection, expandable full-width proof checklists, missing proof typed into cells and validated by the server, one-click bulk tracking upload. **Money-at-risk command center:** urgency ranking, the agent's call per row, per-row and bulk approve, quick search, number filters, totals row, CSV export. Cells flash on live updates. **Drafts can be edited inside the grid**: each edit is re-fingerprinted and citation-checked on the server before Approve unlocks. Draft edits support undo and redo, and column layout is saved per browser. | `public/index.html` |
| **AG Charts** | Where the money is stuck (at risk vs protected), a running total of money protected over time (hover shows who acted: seller, autopilot, calendar or chat), and dispute dollars by Seller Protection status | `public/app.js` (`renderCharts`) |
| **Channel3** | **Collected for every sale on the day it is made**, shown in the sale's checklist, and reused in disputes. **Independent product facts for "not as described" disputes.** Seller Protection doesn't cover these, so the seller must show the item matched its listing. The agent looks the item up in Channel3's catalog with the official `@channel3/sdk`. Brand, materials, key features and attributes such as size and color become a numbered evidence record. Claude may cite it, and the citation checker verifies it. Without a key, clearly labelled demo facts are used. | `lib/channel3.js`, `lib/evidence.js`, `test/channel3.test.js` |
| **Render** | One Blueprint (`render.yaml`) creates the web service **and a Key Value instance** wired in as `REDIS_URL`, so state survives the free service sleeping. Health check; webhooks point at the Render URL | `render.yaml`, `lib/persist.js` |
| **Zapier** | Outbound alerts to a Zapier Catch Hook: `needs_your_review` and `autopilot_acted` events | `lib/notify.js` |
| **Postman** | A collection generated from the OpenAPI spec, grouped by tag, with a `baseUrl` variable | `postman/` |

## Challenges we ran into

- Sellers can't create disputes through the API. A sandbox buyer can open a real one against a store order: SellerShield then handles it live and can ask PayPal's sandbox to decide it. To keep the zero-setup demo honest, sample disputes are clearly tagged **demo**, and the audit log marks each action **live** or **simulated**. Invoices are fully live: one button creates real overdue invoices in the sandbox, and reminders go out through the real Invoicing API. Orders are live when bought through our PayPal Checkout store.
- PayPal's Agent Toolkit ESM build failed to import lodash under Node 22, so we load its CommonJS build.
- Seller Protection rules have many conditions, and models can blur them. We made the rules deterministic code and let Claude reason on top. Our test suite then caught the rules planner fighting a case with no evidence, which we fixed.
- Letting an AI move money needs guardrails. We combined human approval, autopilot limits the seller controls, and a full audit trail.

## Accomplishments we're proud of

- The agent does real work through real PayPal APIs, not just chat. The audit log names the PayPal API behind every action and says whether the call was live or simulated.
- Autopilot turns "AI suggestions" into delegated, bounded autonomy, which is what agentic commerce needs to be safe. The same limits bind any outside agent that connects over MCP.
- The buyer agent can't be talked out of its limit. "Try to break it" runs eight attacks (prompt injection, an over-limit or invented pick, bait and switch, a swapped order, a reused or forged mandate, impossible limits) through the same checks a real purchase uses, and all eight are blocked. A test keeps it that way.
- Every claim is checked: 157 tests, a 30-case policy suite, and a 30-step browser test (including the guided tour and an accessibility audit) that runs in GitHub CI on every push.
- It runs with zero setup: without keys it starts in demo mode, so anyone can try it in a minute.

## What we learned

The hard part of agentic commerce isn't the model. It's trust: clear limits, editable drafts, and a log that shows exactly what the agent did with your money.

## What's next

- Pull carrier delivery status automatically so "evidence missing" cases fix themselves.
- Per-country Seller Protection rules.
- Pulling real orders and shipments from Shopify and other stores to fill in the order book.
- Learning from outcomes: tracking which disputes were won and tuning the fight-or-accept threshold per seller.
- Notifications by WhatsApp or email: "A $120 dispute came in. I drafted a response. Approve?"

## Built with

node.js, express, javascript, paypal-agent-toolkit, paypal-server-sdk, paypal-checkout, paypal-orders-api, paypal-disputes-api, paypal-invoicing-api, paypal-tracking-api, paypal-webhooks, paypal-sandbox, claude, anthropic-api, mcp, ag-grid, ag-charts, bryntum-scheduler, apimatic, channel3, render, redis, zapier, postman, playwright, axe-core

## Tools used (AI section)

- **Claude Opus 5.5 (Anthropic API; override with `ANTHROPIC_MODEL`), with structured outputs, strict tools and server-side refusal fallback:**
  - decides fight or accept on each dispute, scores its confidence and writes the cited evidence;
  - writes invoice reminders matched to how late they are;
  - is the buyer agent: picks one item from the store for a buyer's mandate (the pick is then checked in code);
  - powers the chat agent through tool use.

  Whatever Claude returns is validated in code. If it fails, a rule-based planner takes over, and the dashboard badge says how many plans came from each.
- **PayPal Agent Toolkit (`@paypal/agent-toolkit`):** gives the Claude chat agent read access to invoices, disputes, orders, transactions and shipment tracking.
- **MCP:** SellerShield is itself an MCP server, so other AI agents can use it inside the seller's limits.
- **Claude Code:** an AI coding assistant, used to help write and test the code.

## Try it

- Live demo: https://sellershield-7qfd.onrender.com (the first load after idle can take about a minute)
- Code: https://github.com/mahak867/sellershield
- Video: `<YOUTUBE_URL>`

Fastest way: click **Guided tour** in the dashboard header. Or try it yourself:
1. **Is every sale protected?** Open a row, then click **Send tracking to PayPal**.
2. **Run agent**, then type a made-up date into a dispute draft: sending is blocked.
3. Turn on **Autopilot** and click **Simulate dispute**.
4. Click **Story** on a sale.
5. Click **Buyer agent**: let it shop, approve the payment, then click **Run all 8 attacks**.
6. **Open store** and pay with a PayPal sandbox buyer account.

Each browser gets its own isolated workspace. **Reset** starts over.

## For sponsor judges

**AG Grid.** Three grids carry the product. The **sale readiness grid** checks every sale against Seller Protection; each row expands (full-width rows) into its checklist, the seller types a missing carrier, tracking number or delivery date straight into the cells (validated on the server, locked once on PayPal), and one button sends tracking for every sale the agent can fix. The **money-at-risk grid** ranks items by urgency with a custom bar renderer, shows the agent's decision per row, lets the seller edit a draft inside the grid (each edit is re-fingerprinted and citation-checked before Approve unlocks, with undo and redo), and has bulk approve, quick search, number filters, a pinned totals row and CSV export. The **audit log grid** shows who acted, which PayPal API was used, live or simulated, and the approval fingerprint. AG Charts adds three charts with colour-blind-checked colours and screen-reader summaries.

**Bryntum Scheduler.** The calendar is an approval interface, not just a view. Every PayPal deadline, overdue invoice and hold is on one timeline, and each action the agent proposes is a bar: **dragging it onto a day approves it for that day**, bound to a fingerprint of the exact text, with PayPal's response deadline enforced and a background scheduler that runs it on the day. When a dispute is missing proof of delivery, the calendar shows a two-step plan, a seller task linked by a **dependency arrow** to the agent's action. Every sale also has a **journey row** (no proof on PayPal, in transit, protection-ready) linked by dependency arrows.

**APIMatic.** SellerShield uses APIMatic in both directions. It **consumes** APIMatic's PayPal Server SDK for every Orders and Payments call (with idempotent captures and PayPal's own `seller_protection` flag). It **publishes** its own OpenAPI spec in APIMatic's `src/spec` layout (validated, kept in sync with the server by a test, 30+ operations including the MCP endpoint and the buyer agent), so APIMatic can generate SDKs, a docs portal and an AI context plugin for other agents and storefronts. `<APIMATIC_PORTAL_URL>`

**Channel3.** "Not as described" claims are never covered by PayPal Seller Protection, so the seller has to show the item matched its listing. SellerShield looks up an independent product record in Channel3's catalog (official `@channel3/sdk`) for **every sale on the day it is first seen**, shows it in the sale's checklist, and turns it into a numbered evidence record if a dispute arrives. Claude may cite it, and the citation checker verifies every value.

**Render.** One Blueprint (`render.yaml`) creates the web service and a **Key Value** instance wired in as `REDIS_URL`, so orders, proposals, the autopilot policy and the audit log survive the free service sleeping and restarting. A test restarts the server against a real Redis to prove it. A GitHub Actions job keeps the demo awake for judges.

---

# Demo video

**Automatic recording (recommended).** `scripts/record-demo.cjs` drives the app, shows captions and a cursor, and saves `demo/sellershield-demo.mp4` (about 2:00, no audio, no music). Run it against the deployed app with Claude live:

```bash
npm i -D playwright && npx playwright install chromium
node scripts/record-demo.cjs https://<your-app>.onrender.com
```

It needs `ffmpeg` installed. You can add a voiceover in any editor, reading the captions. Upload the MP4 to YouTube as **Public**.

# Manual demo video script (target 2:45)

Record the live site at 1080p in your own voice, with no copyrighted music. Click **Reset** before each take. The header badges should read **PayPal sandbox** and **Claude live**. Keep sponsor tools to a few seconds each; the story is one sale.

**0:00-0:15 The problem**
Over the dashboard: "PayPal says a new seller's money is usually held for up to 21 days. And if a buyer says an item never arrived, the seller only wins with proof of delivery on PayPal. Most tools start after the dispute. SellerShield starts at the sale."

**0:15-0:35 A real sale (record beforehand, cut it in)**
**Open store**, buy the mug set with the sandbox buyer account.
"This is Clay and Thread, a small shop taking real PayPal Checkout payments. The order ships, but the tracking never reaches PayPal."

**0:35-1:00 Every sale, protected (the main moment)**
Point at **Is every sale protected?** Open the new sale's row. Click **Send tracking to PayPal**. Point at the headline number as it goes up.
"SellerShield checks every sale against Seller Protection before any dispute exists. This one isn't ready: PayPal has no tracking. One click, and the agent sends it through the PayPal Orders API."

**1:00-1:25 A dispute still arrives**
**Run agent**. Open a dispute card. Type a fake date into the draft, show the block, undo, approve. Point at the audit log row.
"When a dispute does arrive, the proof is already there. Claude decides fight or accept and can only state facts it can cite from PayPal's records. If I type something it can't back up, it won't send. The log shows which PayPal API was called, and my approval is tied to the exact text."

**1:25-1:45 Autopilot**
Turn on **Autopilot** (max $100, 80%), click **Simulate dispute**, point at Live activity.
"Now I set limits and walk away. A covered dispute under a hundred dollars comes in, and the agent answers it on its own. Anything bigger waits for me."

**1:45-2:15 The other side: a buyer's AI agent**
Open **Buyer agent**. Run "Wallet, only $40" (it buys nothing), then "Coffee gift, $70" and approve. Click **Run all 8 attacks**.
"Buyers are starting to shop through AI agents. Here an agent shops inside the buyer's limit, and you can't talk it past that limit: eight attacks, eight blocked."

**2:15-2:35 Whose mistake was it?**
Click **Demo: dispute this purchase**, then in the dashboard point at the dispute card's "Whose mistake was it?" box. Click **Story** on that sale.
"If that buyer disputes the purchase, SellerShield works out whose mistake it was: did the buyer authorize it, did the agent stay inside its limit, did we deliver. And the story shows the whole sale, from payment to dispute."

**2:35-2:45 Close**
Show the calendar for two seconds, then the KPIs.
"SellerShield. Every sale protection-ready from day one, on both sides of the sale. Get paid sooner, keep what you earn."

---

# Final checklist

- [ ] Render deployed, URL works, **Claude live** badge is green
- [ ] Webhook added in PayPal app pointing to `https://sellershield-7qfd.onrender.com/api/webhooks/paypal`, `PAYPAL_WEBHOOK_ID` set on Render
- [ ] Run `npm run bench` locally with your Anthropic key and commit `bench/RESULTS.md` (shows the Claude result)
- [ ] Repo is public, and **MIT** shows in the About sidebar
- [ ] Video under 3:00, public on YouTube
- [ ] Devpost: description, tools section, repo link, demo URL, video link
- [ ] Submit before **Nov 12, 2026 @ 8:00pm UTC** (aim for 12:00 UTC)
- [ ] After judging: rotate the PayPal sandbox secret
