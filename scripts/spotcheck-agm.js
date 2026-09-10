/**
 * Read-only spot-check: fetch raw TeamWork AGM/AR history for a few specific
 * company_ids, to confirm whether "NA" last_agm_date on Active Client is a
 * genuine "no history yet" case or a real automation gap.
 * Usage: node scripts/spotcheck-agm.js <company_id> [company_id...]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const https = require('https');
const { chromium } = require('playwright');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME;
const PASSWORD = process.env.TEAMWORK_PASSWORD;

async function getSessionCookie() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('welcome')) {
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: ' Login' }).click();
    await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' });
  }
  const cookies = await context.cookies();
  await browser.close();
  const phpsessid = cookies.find(c => c.name === 'PHPSESSID');
  if (!phpsessid) throw new Error('Login failed');
  return `PHPSESSID=${phpsessid.value}`;
}

function fetchAgmList(cookie, companyId) {
  return new Promise((resolve, reject) => {
    const params = {
      draw: '1', start: '0', length: '50',
      'search[value]': '', 'search[regex]': 'false',
      'order[0][column]': '1', 'order[0][dir]': 'desc',
      ci_csrf_token: '', company_id: companyId,
    };
    for (let i = 0; i < 9; i++) {
      params[`columns[${i}][data]`] = String(i);
      params[`columns[${i}][searchable]`] = 'true';
      params[`columns[${i}][orderable]`] = 'true';
      params[`columns[${i}][search][value]`] = '';
      params[`columns[${i}][search][regex]`] = 'false';
    }
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'apps.teamworkcss.com', path: '/tassure_asia/company_agm/agm_list_ajax', method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const ids = process.argv.slice(2);
  const cookie = await getSessionCookie();
  for (const id of ids) {
    const result = await fetchAgmList(cookie, id);
    console.log(`\n=== company_id ${id} — ${(result.data ?? []).length} event rows ===`);
    (result.data ?? []).forEach(row => console.log(JSON.stringify(row)));
  }
})();
