# Devpost submission kit

Paste these sections into the Devpost form. Replace `<RENDER_URL>` and `<YOUTUBE_URL>` first.

---

## Project name

SellerShield

## Tagline (short description)

An AI agent that defends small sellers' money on PayPal: it fights disputes, releases held funds and chases unpaid invoices for you.

## Inspiration

Small sellers and freelancers don't lose money because they sell bad products. They lose it to paperwork.

- A buyer opens a dispute, and the seller has days to write a convincing response with the right evidence. Many never do.
- New sellers' funds can be held for about 21 days. Adding tracking can get them released earlier, but most sellers don't know that.
- Freelancers chase late invoices by hand. In one study of over 100,000 freelancers, 29% of invoices were paid late. Most late payments get paid after a single reminder, but nobody enjoys sending them.

Big merchants pay for chargeback teams and collections tools. Small sellers have nobody. We built them an agent.

## What it does

SellerShield connects to a seller's PayPal account and watches three places money gets stuck:

1. **Disputes:** reads each dispute and the seller's order record, decides whether to FIGHT or ACCEPT with a win-confidence score, writes the evidence (carrier, tracking number, delivery date), and submits it through the PayPal Disputes API. For small claims it will lose, it recommends accepting, so the seller doesn't waste time.
2. **Held funds:** finds shipped orders whose tracking never reached PayPal and adds it through the Tracking API, which can trigger early release.
3. **Overdue invoices:** writes a reminder whose tone matches how late the invoice is (friendly, firm, final notice) and sends it through the PayPal Invoicing API.

The seller stays in control:

- **Approve mode:** every action is a drafted proposal the seller can edit and approve with one click.
- **Autopilot:** the seller sets two rules, a max amount and a minimum confidence. The agent acts alone inside those limits and queues everything else.
- **Chat agent:** ask "what's my biggest risk?" or say "handle it". A Claude tool-using agent inspects the account and acts.
- **Audit log:** every action, who triggered it (seller, autopilot or chat agent), and exactly what was sent to PayPal.

The dashboard shows money at risk, money protected, hours saved and actions taken.

## How we built it

- **Backend:** Node.js + Express. A thin PayPal REST client handles OAuth and calls the Disputes, Invoicing and Tracking APIs on the PayPal sandbox.
- **AI:** Claude through the Anthropic API.
  - Structured JSON plans for each dispute and invoice: decision, confidence, reasoning and draft.
  - A tool-use agent loop for chat, with three tools: `get_money_at_risk`, `scan`, `execute_proposal`.
  - Every plan is validated. If Claude errors or returns bad output, a rule-based planner takes over, so the agent never stalls.
- **Frontend:** a single page with **AG Grid** for the money-at-risk table and the audit log. Light and dark mode, works on phones.
- **Hosting:** **Render** via a `render.yaml` blueprint.

## Challenges we ran into

- Sellers can't create disputes through the API, and held funds need real paid orders. To keep the demo honest, those items are clearly tagged **demo**, and the audit log marks each action **live** or **simulated**. Invoices are fully live: one button creates real overdue invoices in the sandbox, and reminders go out through the real Invoicing API.
- Letting an AI move money needs guardrails. We combined human approval, autopilot limits the seller controls, and a full audit trail.

## Accomplishments we're proud of

- The agent does real work through real PayPal APIs, not just chat.
- Autopilot turns "AI suggestions" into delegated, bounded autonomy, which is what agentic commerce needs to be safe.
- It runs with zero setup: without keys it starts in demo mode, so anyone can try it in a minute.

## What we learned

The hard part of agentic commerce isn't the model. It's trust: clear limits, editable drafts, and a log that shows exactly what the agent did with your money.

## What's next

- PayPal webhooks, so the agent reacts the moment a dispute opens instead of on a scan.
- Pulling real orders and shipments from Shopify and other stores to fill in the order book.
- Learning from outcomes: tracking which disputes were won and tuning the fight-or-accept threshold per seller.
- Notifications by WhatsApp or email: "A $120 dispute came in. I drafted a response. Approve?"

## Built with

node.js, express, javascript, paypal-disputes-api, paypal-invoicing-api, paypal-tracking-api, paypal-sandbox, claude, anthropic-api, ag-grid, render

## Tools used (AI section)

- **Claude (Anthropic API, model set by `ANTHROPIC_MODEL`):** decides fight or accept on each dispute and scores its confidence, writes evidence notes and invoice reminders, and powers the chat agent through tool use. It calls the app's own PayPal functions to inspect and act on the account.
- **AG Grid Community:** data grids for money at risk and the agent audit log.
- **Render:** hosting via blueprint.
- **Claude Code:** an AI coding assistant, used to help write and test the code.

## Try it

- Live demo: `<RENDER_URL>`
- Code: https://github.com/mahak867/sellershield
- Video: `<YOUTUBE_URL>`

How to try the live demo: click **Load sandbox data**, then **Run agent**. Turn on **Autopilot** and run again. In chat, try "Handle it". Click **Reset** to start over.

---

# Demo video script (target 2:45)

Record your screen at 1080p. Use your own voice or a free AI voice, and no copyrighted music. Click **Reset** before each take.

**0:00–0:20 Hook (talking over the dashboard)**
"Small sellers on PayPal lose money in three ways: disputes they don't have time to fight, funds held for weeks, and invoices nobody pays. Big companies have teams for this. Small sellers have no one. So we built them an agent. This is SellerShield."

**0:20–0:40 The problem on screen**
Click **Load sandbox data**. Point at the Money at risk grid.
"These invoices are real, in the PayPal sandbox, created through the Invoicing API. Over three thousand dollars is stuck here, across disputes, overdue invoices and held payments."

**0:40–1:20 The agent thinks**
Click **Run agent**. Scroll through the proposals.
"The agent reviews everything. Here's a dispute where the buyer says the item never arrived. Claude checked the order: tracking shows delivery, so it says fight, with high confidence, and it already wrote the evidence. Here's an $18 dispute it says to accept: fighting costs more than it's worth. And here's an invoice that's 19 days late, with a firm reminder ready to go."

**1:20–1:45 Human in the loop**
Edit one word in a draft, then click **Approve & send to PayPal**. Show the audit log row marked **live**.
"I can edit anything, and one click sends it through PayPal's API. The audit log shows exactly what went out, and that it was a live PayPal call."

**1:45–2:15 Autopilot (the agentic part)**
Click **Reset**. Turn on **Autopilot**, set max $100 and 80% confidence, then click **Run agent**.
"Now I give the agent a budget. Under $100 and over 80% confidence, act on your own. It handles three cases instantly, and everything bigger waits for me. That's bounded autonomy: the agent works, and I keep control."

**2:15–2:35 Chat agent**
Type "What's my biggest risk?", then click **Handle it**. Point at "Tools used".
"I can just talk to it. It looks up my account with real tools and acts when I ask."

**2:35–2:45 Close**
Show the KPIs.
"Money protected, hours saved, every action logged. SellerShield: your money, defended by an AI agent. Built on PayPal and Claude."

---

# Final checklist

- [ ] Render deployed, URL works, **Claude live** badge is green
- [ ] Repo is public, and **MIT** shows in the About sidebar
- [ ] Video under 3:00, public on YouTube
- [ ] Devpost: description, tools section, repo link, demo URL, video link
- [ ] Submit before **Nov 12, 2026 @ 8:00pm UTC** (aim for 12:00 UTC)
- [ ] After judging: rotate the PayPal sandbox secret
