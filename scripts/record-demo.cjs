// Records the demo video automatically: drives the app, shows captions and a cursor, saves an MP4.
//
//   npm i -D playwright && npx playwright install chromium     (once)
//   node scripts/record-demo.cjs https://your-app.onrender.com  (needs ffmpeg on PATH)
//
// Output: demo/sellershield-demo.mp4 (about 2:45, 1280x720, no audio).
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
    <div style="font-size:28px;margin-top:14px;color:#9aa3b2">An AI agent that knows PayPal Seller Protection<br>and defends a small seller's money</div>`, 4000);
  await card(page, `<div style="font-size:26px;line-height:1.6;text-align:left">
    <div style="font-size:20px;color:#9aa3b2;margin-bottom:10px">Where small sellers lose money on PayPal</div>
    <b>Holds:</b> "Your funds are usually held for up to 21 days." PayPal's fix: upload tracking.<br>
    <b>Disputes:</b> Seller Protection covers "item not received" with proof of delivery, and never "not as described".<br>
    <b>Invoices:</b> 29% of freelance invoices are paid late.<br>
    <div style="margin-top:18px;color:#7aa7ff">Big merchants have teams for this. Small sellers have SellerShield.</div></div>`, 9000);

  // 2. Dashboard
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await overlay(page);
  await page.evaluate(() => fetch('/api/demo/reset', { method: 'POST' }));
  await page.reload({ waitUntil: 'networkidle' }); await overlay(page);
  await cap(page, 'This is the seller\'s dashboard, running on the real PayPal sandbox.', 3500);
  const seed = page.locator('#seed');
  if (await seed.isVisible()) {
    await click(page, seed);
    await cap(page, 'One click creates real overdue invoices through the PayPal Invoicing API.', 4500);
  }
  await click(page, page.locator('#run'));
  await page.waitForFunction(() => document.querySelector('#run').textContent === 'Run agent', null, { timeout: 90000 });
  await cap(page, 'The agent reviews every dispute, overdue invoice and order missing tracking, and proposes one action each.', 4500);

  // 3. Seller Protection + citations
  const d = page.locator('.prop').filter({ hasText: 'PP-D-1001' });
  await point(page, d.locator('.prot'));
  await cap(page, 'For each dispute it checks PayPal Seller Protection rule by rule: covered, tracked, delivered, right address, on time.', 5500);
  await click(page, d.locator('details.recs summary'));
  await cap(page, 'Claude decides FIGHT or ACCEPT on top of those facts, and may only state facts it can cite from these records.', 5500);
  const ta = d.locator('textarea');
  const original = await ta.inputValue();
  await point(page, ta);
  await ta.fill('The buyer signed for the parcel on 2026-01-01.');
  await wait(900);
  await point(page, d.locator('.issues'));
  await cap(page, 'Type a fact it can\'t back up: the citation check blocks sending, and the approval fingerprint changes.', 5000);
  await ta.fill(original); await wait(900);
  await click(page, d.locator('button.approve'));
  await cap(page, 'Approve: the evidence goes to PayPal\'s Disputes API, tied to a SHA-256 fingerprint of the exact text.', 4500);

  // 4. Autopilot + real time
  await scrollTo(page, '.ap', 120);
  await click(page, page.locator('.switch span'));
  await cap(page, 'Now give the agent limits: act alone under $100 when at least 80% confident.', 4000);
  await click(page, page.locator('#simDispute'));
  await wait(2500);
  await point(page, page.locator('#feed .ev').first());
  await cap(page, 'A buyer opens a dispute. The webhook fires, the agent checks coverage and acts within the limits. Bigger cases wait for you.', 6500);

  // 5. Charts + timeline
  await scrollTo(page, '.charts');
  await cap(page, 'AG Charts: where the money is stuck, and how much of it Seller Protection covers.', 4500);
  await scrollTo(page, '#timeline', 120);
  await cap(page, 'The Bryntum agent calendar: every PayPal deadline, overdue invoice and hold on one timeline.', 4000);
  const plan = page.locator('#timeline .ss-plan').first();
  if (await plan.count()) {
    await cap(page, 'Each purple bar is an action the agent proposes, placed before PayPal\'s deadline.', 4000);
    const b = await plan.boundingBox();
    await point(page, plan);
    await page.mouse.move(b.x + 8, b.y + b.height / 2); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + 8 + i * 17, b.y + b.height / 2); await wait(45); }
    await page.mouse.up(); await wait(1200);
    await cap(page, 'Drag it onto a day to approve it for that day. It turns green and the agent runs it then, tied to its fingerprint.', 5500);
  }

  // 6. Grid + audit
  await scrollTo(page, '#riskGrid', 160);
  await cap(page, 'AG Grid ranks everything by urgency, with the agent\'s call and one-click or bulk approval.', 5000);
  await scrollTo(page, '#logGrid', 160);
  await cap(page, 'Every action is logged: who triggered it, live or simulated, the fingerprint, and exactly what PayPal received.', 5500);

  // 7. Chat agent
  await scrollTo(page, '#chatlog', 260);
  await click(page, page.locator('[data-q="What\'s my biggest risk right now?"]'));
  await page.waitForFunction(() => !document.querySelector('#chatlog').textContent.includes('Thinking...'), null, { timeout: 90000 });
  await wait(600);
  await point(page, page.locator('#chatlog .msg.bot').last());
  await cap(page, 'Or just ask. The chat agent reads the account through PayPal\'s Agent Toolkit and acts when asked.', 6000);
  await cap(page, '', 0);

  // 8. End card
  await card(page, `<div style="font-size:44px;font-weight:800">SellerShield</div>
    <div style="font-size:24px;margin-top:12px;color:#9aa3b2">One agent, one inbox for every way a small seller's PayPal money gets stuck.</div>
    <div style="font-size:18px;margin-top:26px;line-height:1.7;color:#c9ced8">PayPal Disputes · Invoicing · Orders · Tracking · Webhooks · Agent Toolkit · Server SDK (APIMatic)<br>
    Claude · AG Grid · AG Charts · Bryntum Scheduler · Render</div>
    <div style="font-size:18px;margin-top:22px;color:#7aa7ff">github.com/mahak867/sellershield</div>`, 6000);

  const video = page.video();
  await ctx.close(); await browser.close();
  const webm = await video.path();
  const mp4 = path.join(OUT, 'sellershield-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-t', '175', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', mp4]);
  fs.unlinkSync(webm);
  const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
  console.log(`Saved ${mp4} (${Math.round(secs)}s)`);
})();
