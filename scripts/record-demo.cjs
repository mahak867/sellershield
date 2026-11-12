// Records the demo video automatically: drives the app, shows captions and a cursor, saves an MP4.
//
//   npm i -D playwright && npx playwright install chromium     (once)
//   node scripts/record-demo.cjs https://your-app.onrender.com  (needs ffmpeg on PATH)
//
// Output: demo/sellershield-demo.mp4 (about 2:00, 1280x720, no audio).
// Record against the deployed app with ANTHROPIC_API_KEY set, so the badge reads "Claude live".
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'demo');
const W = 1280, H = 720;

const CAPTION_CSS = `
#ss-cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1080px;z-index:99999;
  background:rgba(17,24,39,.92);color:#fff;font:600 21px/1.35 system-ui,sans-serif;padding:12px 20px;border-radius:12px;
  box-shadow:0 8px 30px rgba(0,0,0,.25);text-align:center;transition:opacity .25s}
#ss-cur{position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(11,87,208,.35);border:2px solid #0b57d0;
  z-index:99998;pointer-events:none;transform:translate(-50%,-50%);transition:left .55s ease,top .55s ease;left:640px;top:360px}
#ss-cur.click{background:rgba(11,87,208,.75)}`;

async function overlay(page) {
  await page.evaluate((css) => {
    if (document.getElementById('ss-cap')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'ss-cap'; c.style.opacity = 0; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'ss-cur'; document.body.appendChild(k);
  }, CAPTION_CSS);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function cap(page, text, ms = 3500) {
  await overlay(page);
  await page.evaluate((t) => { const c = document.getElementById('ss-cap'); c.textContent = t; c.style.opacity = t ? 1 : 0; }, text);
  if (ms) await wait(ms);
}
async function point(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => { const k = document.getElementById('ss-cur'); k.style.left = x + 'px'; k.style.top = y + 'px'; }, [b.x + b.width / 2, b.y + b.height / 2]);
  await wait(650);
}
async function click(page, locator) {
  await point(page, locator);
  await page.evaluate(() => document.getElementById('ss-cur').classList.add('click'));
  await locator.click();
  await wait(250);
  await page.evaluate(() => document.getElementById('ss-cur').classList.remove('click'));
}
async function scrollTo(page, selector, offset = 90) {
  // Blur first: a focused widget (e.g. the timeline after a drag) can pull the page back.
  await page.evaluate(([s, o]) => {
    document.activeElement?.blur?.();
    const el = document.querySelector(s);
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy(0, -o);
  }, [selector, offset]);
  await wait(900);
}
async function card(page, html, ms) {
  await page.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f1218;color:#e8eaee;font-family:system-ui,sans-serif">
    <div style="max-width:1000px;padding:40px;text-align:center">${html}</div></body></html>`);
  await wait(ms);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, colorScheme: 'light' });
  const page = await ctx.newPage();

  // 1. Title + problem
  await card(page, `<div style="font-size:56px;font-weight:800">SellerShield</div>
    <div style="font-size:28px;margin-top:14px;color:#9aa3b2">Get paid sooner. Keep what you earn.<br>An AI agent for small PayPal sellers</div>`, 3500);
  await card(page, `<div style="font-size:26px;line-height:1.6;text-align:left">
    <div style="font-size:64px;font-weight:800;line-height:1.1">Up to 21 days</div>
    <div style="font-size:20px;color:#9aa3b2;margin:6px 0 16px">is how long PayPal says a new seller's funds are usually held. PayPal's first fix: upload tracking.</div>
    <b>Disputes:</b> "item not received" is covered only with proof of delivery. "Not as described" is never covered.<br>
    <b>Invoices:</b> 29% of freelance invoices are paid late.<br>
    <div style="margin-top:18px;color:#7aa7ff">Most tools start after a dispute. SellerShield starts at the sale.</div></div>`, 7500);

  // 2. Dashboard: is every sale protected?
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await overlay(page);
  await page.evaluate(() => fetch('/api/demo/reset', { method: 'POST' }));
  await page.reload({ waitUntil: 'networkidle' }); await overlay(page);
  await cap(page, 'This is the dashboard of Clay & Thread, a small shop taking PayPal payments.', 3000);
  const seed = page.locator('#seed');
  if (await seed.isVisible()) {
    await click(page, seed);
    await cap(page, 'One click creates real overdue invoices through the PayPal Invoicing API.', 3500);
  }
  await scrollTo(page, '#readyGrid', 170);
  await point(page, page.locator('#readyGrid'));
  await cap(page, 'Every sale is checked against PayPal Seller Protection before any dispute exists. Only some are ready.', 4500);
  await click(page, page.locator('#readyGrid .ag-center-cols-container .ag-row button').first());
  await cap(page, 'Open a sale to see every rule, what is missing, and who has to fix it: the agent, the carrier or the seller.', 4500);
  await click(page, page.locator('#fixAll'));
  await page.waitForFunction(() => !document.querySelector('#fixAll').textContent.includes('Sending'), null, { timeout: 90000 });
  await scrollTo(page, '.kpis', 120);
  await point(page, page.locator('#kReady'));
  await cap(page, 'One click: the agent sends the tracking it has to PayPal. That is the proof PayPal asks for to avoid a hold.', 5000);

  // 3. The agent reviews everything; citations guard what it may say
  await click(page, page.locator('#run'));
  await page.waitForFunction(() => document.querySelector('#run').textContent === 'Run agent', null, { timeout: 90000 });
  const d = page.locator('.prop').filter({ hasText: 'PP-D-1001' });
  if (await d.count()) {
    await point(page, d.locator('.prot'));
    await cap(page, 'Disputes that still arrive are checked rule by rule. Claude decides FIGHT or ACCEPT and may only state facts it can cite.', 5000);
    const ta = d.locator('textarea');
    const original = await ta.inputValue();
    await point(page, ta);
    await ta.fill('The buyer signed for the parcel on 2026-01-01.');
    await wait(900);
    await point(page, d.locator('.issues'));
    await cap(page, 'Type a fact it cannot back up: sending is blocked, and the approval fingerprint changes.', 4500);
    await ta.fill(original); await wait(900);
    await click(page, d.locator('button.approve'));
    await cap(page, 'Approve: the evidence goes to the PayPal Disputes API, tied to a fingerprint of the exact text.', 4000);
  }

  // 4. Autopilot + real time
  await scrollTo(page, '.ap', 120);
  await click(page, page.locator('.switch span'));
  await cap(page, 'Now give the agent limits: act alone under $100 when at least 80% confident.', 3500);
  await click(page, page.locator('#simDispute'));
  await wait(2500);
  await point(page, page.locator('#feed .ev').first());
  await cap(page, 'A buyer opens a dispute. The agent checks coverage and acts inside the limits. Bigger cases wait for you.', 5500);

  // 5. Bryntum calendar
  await scrollTo(page, '#timeline', 120);
  await cap(page, 'The Bryntum calendar: deadlines, holds, and each sale\'s journey from no proof to protection-ready.', 4500);
  const task = page.locator('#timeline .ss-task').first();
  if (await task.count()) {
    page.once('dialog', (dlg) => dlg.accept(new Date().toISOString().slice(0, 10)));
    await point(page, task);
    await cap(page, 'This dispute is missing proof of delivery: first the carrier confirmation, then the agent submits.', 4000);
    await click(page, task); await wait(2500);
    await cap(page, 'Record the delivery date and the agent re-checks: Seller Protection now covers it.', 4000);
  }
  const plan = page.locator('#timeline .ss-plan').first();
  if (await plan.count()) {
    const b = await plan.boundingBox();
    await point(page, plan);
    await page.mouse.move(b.x + 8, b.y + b.height / 2); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + 8 + i * 17, b.y + b.height / 2); await wait(45); }
    await page.mouse.up(); await wait(1200);
    await cap(page, 'Drag an action onto a day to approve it for that day. The agent runs it then.', 4500);
  }

  // 6. Audit log
  await scrollTo(page, '#logGrid', 160);
  await cap(page, 'Every action is logged in AG Grid: who triggered it, which PayPal API it used, live or simulated, and its fingerprint.', 5000);

  // 7. Chat agent + other agents
  await scrollTo(page, '#chatlog', 260);
  await click(page, page.locator('[data-q="Are all my sales protected?"]'));
  await page.waitForFunction(() => !document.querySelector('#chatlog').textContent.includes('Thinking...'), null, { timeout: 90000 });
  await wait(600);
  await point(page, page.locator('#chatlog .msg.bot').last());
  await cap(page, 'Or just ask. The chat agent reads the account through PayPal\'s Agent Toolkit.', 4500);
  await scrollTo(page, '#mcpUrl', 320);
  await point(page, page.locator('#mcpUrl'));
  await cap(page, 'Other AI agents can connect over MCP, and can act only inside the limits the seller set.', 5000);
  await cap(page, '', 0);

  // 8. End card
  await card(page, `<div style="font-size:44px;font-weight:800">SellerShield</div>
    <div style="font-size:24px;margin-top:12px;color:#9aa3b2">Every sale protection-ready from day one.<br>Get paid sooner. Keep what you earn.</div>
    <div style="font-size:18px;margin-top:26px;line-height:1.7;color:#c9ced8">PayPal Disputes · Invoicing · Orders · Tracking · Webhooks · Agent Toolkit · Server SDK (APIMatic)<br>
    Claude · AG Grid · AG Charts · Bryntum Scheduler · Channel3 · Render</div>
    <div style="font-size:18px;margin-top:22px;color:#7aa7ff">github.com/mahak867/sellershield</div>`, 5000);

  const video = page.video();
  await ctx.close(); await browser.close();
  const webm = await video.path();
  const mp4 = path.join(OUT, 'sellershield-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-t', '175', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', mp4]);
  fs.unlinkSync(webm);
  const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
  console.log(`Saved ${mp4} (${Math.round(secs)}s)`);
})();
