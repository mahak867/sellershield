// Browser smoke test: clicks through every main dashboard flow and reports PASS/FAIL per step.
// Meant for demo mode (no keys), where the data is known:
//   npm start                       (in one terminal, without PayPal or Anthropic keys)
//   npm i -D playwright && npx playwright install chromium   (once)
//   npm run smoke                   (or: node scripts/smoke.cjs http://localhost:3000)
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const { chromium } = require('playwright');
const out = []; const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const txt = (s) => p.textContent(s);
  await p.goto(BASE); await p.waitForTimeout(1500);
  ok('initial readiness', (await txt('#kReady')) === '3 of 6');
  await p.click('#run'); await p.waitForFunction(() => document.querySelector('#run').textContent === 'Run agent'); await p.waitForTimeout(800);
  ok('8 proposals', (await p.locator('.prop').count()) === 8, await txt('#kReview'));
  // citation guard
  const d = p.locator('.prop').filter({ hasText: 'PP-D-1001' }); const ta = d.locator('textarea'); const orig = await ta.inputValue();
  await ta.fill('The buyer signed on 2026-01-01.'); await p.waitForTimeout(700);
  ok('bad draft blocks approve', await d.locator('button.approve').isDisabled());
  await ta.fill(orig); await p.waitForTimeout(700);
  ok('restored draft enables approve', !(await d.locator('button.approve').isDisabled()));
  await d.locator('button.approve').click(); await p.waitForTimeout(1000);
  ok('dispute approved', (await txt('#kActs')) === '1', await txt('#kSaved'));
  // evidence pdf endpoint
  const pdf = await p.evaluate(async () => { const r = await fetch('/api/risk').then((x) => x.json()); const q = r.proposals.find((x) => x.kind === 'dispute'); const f = await fetch('/api/agent/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: q.id }) }); const buf = new Uint8Array(await f.arrayBuffer()); return String.fromCharCode(...buf.slice(0, 5)) + ' ' + buf.length; });
  ok('evidence pdf', pdf.startsWith('%PDF-'), pdf);
  // fix all
  await p.click('#fixAll'); await p.waitForTimeout(2500);
  ok('fix all -> 4 of 6', (await txt('#kReady')) === '4 of 6');
  // autopilot + simulate
  await p.click('.switch span'); await p.waitForTimeout(400);
  await p.click('#simDispute'); await p.waitForTimeout(2500);
  const feed = await txt('#feed');
  ok('autopilot acted on simulated dispute', /autopilot handled/.test(feed), feed.slice(0, 160));
  // chat
  for (const q of ['Are all my sales protected?', "What's my biggest risk right now?"]) {
    await p.click(`[data-q="${q}"]`); await p.waitForFunction(() => !document.querySelector('#chatlog').textContent.includes('Thinking...')); 
  }
  const chat = await txt('#chatlog');
  ok('chat readiness', /of 6 sales/.test(chat)); ok('chat risk', /at risk/.test(chat));
  // timeline rendered
  ok('timeline events', (await p.locator('#timeline .b-sch-event').count()) > 5, String(await p.locator('#timeline .b-sch-event').count()));
  ok('timeline task + dependency', (await p.locator('#timeline .ss-task').count()) >= 1);
  // grid edit: in-grid draft edit recheck
  const res = await p.evaluate(async () => { const r = await fetch('/api/risk').then((x) => x.json()); const q = r.proposals.find((x) => x.kind === 'dispute' && x.decision === 'FIGHT'); const c = await fetch('/api/agent/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: q.id, draft: 'Refunded $999.00 [R1].' }) }).then((x) => x.json()); return c.issues.map((i) => i.code).join(); });
  ok('check endpoint flags wrong amount', res === 'VALUE_NOT_IN_CITED_RECORD', res);
  ok('audit rows', (await p.locator('#logGrid .ag-center-cols-container .ag-row').count()) >= 4);
  ok('charts drawn', (await p.locator('#chartRisk canvas').count()) === 1);
  // reset
  await p.click('#reset'); await p.waitForTimeout(1200);
  ok('reset restores', (await txt('#kReady')) === '3 of 6' && (await txt('#kActs')) === '0');
  // mobile: no horizontal overflow
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(800);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('mobile no sideways scroll', over <= 1, `overflow ${over}px`);
  // store page in mock mode
  const s = await ctx.newPage(); await s.goto(BASE + '/shop.html'); await s.waitForTimeout(800);
  ok('store shows clear message without keys', /Add PayPal sandbox keys/.test(await s.textContent('#items')));
  ok('no console errors', errs.length === 0, JSON.stringify(errs).slice(0, 400));
  console.log(out.join('\n')); await b.close(); if (out.some((l) => l.startsWith('FAIL'))) process.exit(1);
})().catch((e) => { console.log(out.join('\n')); console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
