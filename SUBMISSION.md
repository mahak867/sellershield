# Devpost submission kit

Paste these sections into the Devpost form. Replace `<RENDER_URL>` and `<YOUTUBE_URL>` first.

---

## Project name

SellerShield

## Tagline (short description)

An AI agent that knows PayPal Seller Protection: it checks every dispute against PayPal's rules, closes evidence gaps the moment a sale lands, and acts within limits you set.

## Inspiration

Small sellers and freelancers don't lose money because they sell bad products. They lose it to paperwork.

- A buyer opens a dispute, and the seller has days to write a convincing response with the right evidence. Many never do.
- New sellers' funds can be held for about 21 days. Adding tracking can get them released earlier, but most sellers don't know that.
- Freelancers chase late invoices by hand. In one study of over 100,000 freelancers, 29% of invoices were paid late. Most late payments get paid after a single reminder, but nobody enjoys sending them.

Big merchants pay for chargeback teams and collections tools. Small sellers have nobody. We built them an agent.

## Where it fits

This hackathon has strong single-purpose entries for disputes, for invoices and for fraud. SellerShield's angle is **one agent and one inbox for all of a small seller's money at risk**:
- disputes, checked against PayPal Seller Protection rules,
- paid orders still missing tracking,
- overdue invoices.

They're ranked by urgency, handled under a single autopilot policy the seller controls, and recorded in one audit log. A seller with ten orders a week won't run three tools. They need one place that says where their money is stuck, and fixes it.

How it works:
- **Seller Protection checklist** for every dispute (claim type, tracking, delivered status, address, deadline), computed in code from PayPal's published rules. Claude decides on top of those facts.
- **Prevention:** when a PayPal Checkout sale lands without tracking, the agent flags it and posts tracking to the capture.
- **Real time:** signature-verified PayPal webhooks and new sales trigger the agent at once.
- **Facts must be cited:** a dispute response may only state facts from numbered records:
  - the PayPal dispute,
  - the PayPal capture and order,
  - the seller's order book.

  Code checks that every amount, date and ID matches its cited record, and refuses to send anything that doesn't.
- **Approvals bound to the exact text:** every approval carries a SHA-256 fingerprint of what will be sent. Change a word and it needs a new approval. The audit log keeps the fingerprint.
- **Measured:** 20 automated tests (`npm test`) plus a 30-case policy suite (`npm run bench`). These caught two real bugs, both fixed:
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
- **Testing:** 20 automated tests (Node's test runner, mock mode, no keys), plus 30 labelled dispute cases with a runner that reports agreement for Claude or the rules fallback.
- **Hosting:** **Render** via a `render.yaml` blueprint.

## Challenges we ran into

- Sellers can't create disputes through the API. A sandbox buyer can open a real one against a store order: SellerShield then handles it live and can ask PayPal's sandbox to decide it. To keep the zero-setup demo honest, sample disputes are clearly tagged **demo**, and the audit log marks each action **live** or **simulated**. Invoices are fully live: one button creates real overdue invoices in the sandbox, and reminders go out through the real Invoicing API. Orders are live when bought through our PayPal Checkout store.
- PayPal's Agent Toolkit ESM build failed to import lodash under Node 22, so we load its CommonJS build.
- Seller Protection rules have many conditions, and models can blur them. We made the rules deterministic code and let Claude reason on top. Our test suite then caught the rules planner fighting a case with no evidence, which we fixed.
- Letting an AI move money needs guardrails. We combined human approval, autopilot limits the seller controls, and a full audit trail.

## Accomplishments we're proud of

- The agent does real work through real PayPal APIs, not just chat.
- Autopilot turns "AI suggestions" into delegated, bounded autonomy, which is what agentic commerce needs to be safe.
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

- **Claude (Anthropic API, model set by `ANTHROPIC_MODEL`):** decides fight or accept on each dispute and scores its confidence, writes evidence notes and invoice reminders, and powers the chat agent through tool use. It calls the app's own PayPal functions to inspect and act on the account.
- **PayPal Agent Toolkit (`@paypal/agent-toolkit`):** gives the Claude agent direct read access to invoices, disputes, orders, transactions and shipment tracking.
- **AG Grid Community:** the money-at-risk command center (urgency ranking, inline and bulk approve, search, totals, CSV export) and the audit log.
- **Render:** hosting via blueprint.
- **Claude Code:** an AI coding assistant, used to help write and test the code.

## Try it

- Live demo: `<RENDER_URL>`
- Code: https://github.com/mahak867/sellershield
- Video: `<YOUTUBE_URL>`

How to try the live demo: click **Load sandbox data**, then **Run agent**. To make a real sale, click **Open store** and pay with a PayPal sandbox buyer account. Turn on **Autopilot** and run again. In chat, try "Handle it". Click **Reset** to start over.

---

# Demo video script (target 2:45)

Record your screen at 1080p. Use your own voice or a free AI voice, and no copyrighted music. Click **Reset** before each take.

**0:00–0:20 Hook (talking over the dashboard)**
"Small sellers on PayPal lose money in three ways: disputes they don't have time to fight, funds held for weeks, and invoices nobody pays. Big companies have teams for this. Small sellers have no one. So we built them an agent. This is SellerShield."

**0:20–0:40 A real sale (record this part beforehand, then cut it in)**
Click **Open store** and buy the wallet with the sandbox buyer account in the PayPal popup.
"This is a small shop taking real PayPal Checkout payments in the sandbox. The seller ships it but forgets to add tracking, which is exactly how sellers lose 'item not received' disputes."

**0:40–0:55 The problem on screen**
Click **Load sandbox data**. Point at the Money at risk grid.
"These invoices are real, in the PayPal sandbox, created through the Invoicing API. Over three thousand dollars is stuck here, across disputes, overdue invoices and held payments."

**0:55–1:25 The agent thinks**
The agent already ran when the sale landed (point at Live activity). Point at the **Needs tracking** row, then at a dispute's Seller Protection checklist.
"The sale triggered the agent instantly. It caught the wallet order: paid, shipped, no tracking on PayPal. One click fixes it. And for every dispute it checks PayPal's Seller Protection rules line by line. Here's a dispute where the buyer says the item never arrived. Claude checked the order: tracking shows delivery, so it says fight, with high confidence, and it already wrote the evidence. Here's an $18 dispute it says to accept: fighting costs more than it's worth. And here's an invoice that's 19 days late, with a firm reminder ready to go."

**1:25–1:45 Human in the loop**
Open a dispute card's evidence records. Type a fake date into the draft: the citation check blocks it and the fingerprint changes. Undo it, approve, and show the audit log row with **live** and the fingerprint.
"The agent can only tell PayPal facts it can cite. If I type something it can't back up, it won't send. And every approval is tied to the exact text, so what I approved is exactly what PayPal got."

**1:45–2:15 Autopilot + real time (the agentic part)**
Click **Reset**. Turn on **Autopilot** (max $100, 80% confidence), then click **Simulate dispute**. Point at the Live activity feed.
"Now I give the agent limits and walk away. A buyer opens a dispute. A PayPal webhook fires, and the agent checks Seller Protection: delivered, tracked, right address, covered. It submits the evidence on its own, because it's under $100 and over 80% confident. Anything bigger waits for me. The agent works, and I keep control."

**2:15–2:35 Chat agent**
Type "What's my biggest risk?", then click **Handle it**. Point at "Tools used".
"I can just talk to it. It reads my account through PayPal's own Agent Toolkit and acts when I ask, within the same guardrails."

**2:35–2:45 Close**
Show the KPIs.
"Money protected, hours saved, every action logged. SellerShield: your money, defended by an AI agent. Built on PayPal and Claude."

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
