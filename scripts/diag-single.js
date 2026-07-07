const { chromium } = require('playwright');
const path = require('path');

const STORAGE_STATE_PATH = path.join(__dirname, '..', 'data', 'teamwork-scrape', 'auth-state.json');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
  const page = await context.newPage();

  page.on('console', msg => console.log('  [console]', msg.type(), msg.text().slice(0, 200)));
  page.on('requestfailed', req => console.log('  [reqfail]', req.url().slice(0, 100), req.failure()?.errorText));

  const id = 18;
  console.log(`Navigating to view_member/${id} — NO route blocking, concurrency=1...`);
  const t0 = Date.now();
  try {
    const resp = await page.goto(`https://apps.teamworkcss.com/tassure_asia/view_member/${id}/?var1=alldirector`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`✅ Loaded in ${Date.now() - t0}ms, status=${resp?.status()}`);
    const title = await page.title();
    console.log('Title:', title);
    const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    console.log('Body HTML length:', bodyLen);
  } catch (e) {
    console.log(`❌ FAILED after ${Date.now() - t0}ms:`, e.message);
  }

  await browser.close();
}

main();
