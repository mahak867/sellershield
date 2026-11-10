# Devpost submission kit

Paste these sections into the Devpost form. Replace `<RENDER_URL>` and `<YOUTUBE_URL>` first.

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

One autopilot policy and one audit log cover all of it. A small seller doesn't want three tools; they want to get paid sooner and keep what they earn.

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
- **Measured:** 56 automated tests (`npm test`) plus a 30-case policy suite (`npm run bench`). These caught two real bugs, both fixed:
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
- **Testing:** 56 automated tests (Node's test runner, mock mode, no keys), plus 30 labelled dispute cases with a runner that reports agreement for Claude or the rules fallback.
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

- The agent does real work through real PayPal APIs, not just chat.
- Autopilot turns "AI suggestions" into delegated, bounded autonomy, which is what agentic commerce needs to be safe. The same limits bind any outside agent that connects over MCP.
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

node.js, express, javascript, paypal-agent-toolkit, paypal-checkout, paypal-orders-api, paypal-disputes-api, paypal-invoicing-api, paypal-tracking-api, paypal-sandbox, claude, anthropic-api, ag-grid, render

## Tools used (AI section)

- **Claude Opus 5.5 (Anthropic API; override with `ANTHROPIC_MODEL`), with structured outputs, strict tools and server-side refusal fallback:** decides fight or accept on each dispute and scores its confidence, writes evidence notes and invoice reminders, and powers the chat agent through tool use. It calls the app's own PayPal functions to inspect and act on the account.
- **PayPal Agent Toolkit (`@paypal/agent-toolkit`):** gives the Claude agent direct read access to invoices, disputes, orders, transactions and shipment tracking.
- **AG Grid Community:** the money-at-risk command center (urgency ranking, inline and bulk approve, search, totals, CSV export) and the audit log.
- **Render:** hosting via blueprint.
- **Claude Code:** an AI coding assistant, used to help write and test the code.

## Try it

- Live demo: `<RENDER_URL>`
- Code: https://github.com/mahak867/sellershield
- Video: `<YOUTUBE_URL>`

Each browser gets its own isolated workspace. How to try the live demo: click **Load sandbox data**, then **Run agent**. To make a real sale, click **Open store** and pay with a PayPal sandbox buyer account. Turn on **Autopilot** and run again. In chat, try "Handle it". Click **Reset** to start over.

---

# Demo video

**Automatic recording (recommended).** `scripts/record-demo.cjs` drives the app, shows captions and a cursor, and saves `demo/sellershield-demo.mp4` (about 2:00, no audio, no music). Run it against the deployed app with Claude live:

```bash
npm i -D playwright && npx playwright install chromium
node scripts/record-demo.cjs https://<your-app>.onrender.com
```

It needs `ffmpeg` installed. You can add a voiceover in any editor, reading the captions. Upload the MP4 to YouTube as **Public**.

# Manual demo video script (target 2:40)

Record your screen at 1080p. Use your own voice, and no copyrighted music. Click **Reset** before each take. Record against the deployed app so the badges read **PayPal sandbox** and **Claude live**.

**0:00-0:15 Hook (over the dashboard)**
"PayPal says a new seller's money is usually held for up to 21 days. And if a buyer says an item never arrived, the seller only wins with proof of delivery on PayPal. Most tools start after the dispute. SellerShield starts at the sale."

**0:15-0:35 A real sale (record beforehand, then cut it in)**
Click **Open store** and buy the wallet with the sandbox buyer account.
"This is Clay and Thread, a small shop taking real PayPal Checkout payments. The seller ships the order, but the tracking never reaches PayPal."

**0:35-1:05 Is every sale protected? (the main moment)**
Point at **Is every sale protected?**. Open the new sale's row. Click **Send tracking to PayPal**. Point at the **Sales protection-ready** number as it goes up.
"SellerShield checks every sale against PayPal's Seller Protection rules before any dispute exists. This sale is not ready: PayPal has no tracking. One click, and the agent sends it through the PayPal Orders API. That is the first thing PayPal asks for to avoid a hold, and the proof that wins an item-not-received claim."

**1:05-1:35 A dispute still arrives**
Click **Run agent**. Open a dispute card. Type a fake date into the draft, show the block, undo it, approve. Show the audit log row.
"When a dispute does arrive, the proof is already in place. Claude decides fight or accept, and can only state facts it can cite from PayPal's records. If I type something it can't back up, it won't send. My approval is tied to the exact text, and the log shows which PayPal API was called."

**1:35-2:00 Autopilot (the agentic part)**
Turn on **Autopilot** (max $100, 80%). Click **Simulate dispute**. Point at Live activity.
"Now I give the agent limits and walk away. A new dispute comes in, it's covered and under a hundred dollars, so the agent answers it on its own. Anything bigger waits for me."

**2:00-2:20 Calendar**
Scroll to the calendar. Point at a sale journey, then drag a purple action onto a day.
"Every sale's journey is on one timeline: no proof, in transit, protected. And I approve an action for a given day by dragging it there."

**2:20-2:35 Other agents**
Ask "Are all my sales protected?" in chat. Point at **Connect your own agent**.
"I can ask it in plain words. And my own AI assistant can connect to SellerShield too, and can act only inside the same limits."

**2:35-2:40 Close**
Show the KPIs.
"SellerShield. Every sale protection-ready from day one. Get paid sooner, keep what you earn."

---

# Final checklist

- [ ] Render deployed, URL works, **Claude live** badge is green
- [ ] Webhook added in PayPal app pointing to `<RENDER_URL>/api/webhooks/paypal`, `PAYPAL_WEBHOOK_ID` set on Render
- [ ] Run `npm run bench` locally with your Anthropic key and commit `bench/RESULTS.md` (shows the Claude result)
- [ ] Repo is public, and **MIT** shows in the About sidebar
- [ ] Video under 3:00, public on YouTube
- [ ] Devpost: description, tools section, repo link, demo URL, video link
- [ ] Submit before **Nov 12, 2026 @ 8:00pm UTC** (aim for 12:00 UTC)
- [ ] After judging: rotate the PayPal sandbox secret
