// Retakes the README screenshots in docs/screenshots from a running app.
//   npm start                                  (demo mode, or with keys for live badges)
//   node scripts/screenshots.cjs [base-url]    (needs Playwright: npm i -D playwright)
const { chromium } = require('playwright');
const path = require('path');

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const shot = async (name, selector) => {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded(); await wait(500);
    await el.screenshot({ path: path.join(OUT, name) });
    console.log('saved', name);
  };
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => fetch('/api/demo/reset', { method: 'POST' }));
  await page.reload({ waitUntil: 'networkidle' }); await wait(800);

  // Sale readiness, with one checklist open.
  await page.locator('#readyGrid .ag-center-cols-container .ag-row button').first().click(); await wait(500);
  await shot('7-sale-readiness.png', 'section.card:has(#readyGrid)');
  await page.locator('#readyGrid .ag-center-cols-container .ag-row button').first().click();

  // Run the agent, approve one tracking fix and one dispute so charts and the log have data.
  await page.click('#run');
  await page.waitForFunction(() => document.querySelector('#run').textContent === 'Run agent', null, { timeout: 90000 }); await wait(800);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(300);
  await page.screenshot({ path: path.join(OUT, '1-dashboard.png') }); console.log('saved 1-dashboard.png');
  const dispute = page.locator('.prop').filter({ hasText: 'dispute' }).first();
  await dispute.locator('details.recs summary').click().catch(() => {});
  await shot('2-seller-protection-and-citations.png', '.prop:has(.prot)');
  await page.locator('.prop').filter({ hasText: 'ADD_TRACKING' }).first().locator('button.approve').click(); await wait(900);
  await page.locator('.prop').filter({ hasText: 'FIGHT' }).first().locator('button.approve').click(); await wait(1200);
  await shot('3-ag-charts.png', 'section.charts');
  await shot('4-bryntum-timeline.png', 'section.card:has(#timeline)');
  await shot('5-ag-grid-money-at-risk.png', 'section.card:has(#riskGrid)');
  await shot('6-audit-log.png', 'section.card:has(#logGrid)');
  await page.evaluate(() => fetch('/api/demo/reset', { method: 'POST' }));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
