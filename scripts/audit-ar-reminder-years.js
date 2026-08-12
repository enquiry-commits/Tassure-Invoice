/**
 * Read-only audit: for a given set of ar_reminder rows, fetch each
 * company's REAL TeamWork AGM/AR event history and compare against the
 * stored fye_year. Flags rows whose stored fye_year doesn't match ANY real
 * TeamWork cycle for that fye_month, and reports what the real year(s) are.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const https = require('https');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
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

async function pageAll(table, select, filter) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    let q = sb.from(table).select(select).range(start, start + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

(async () => {
  // The two batches under suspicion: the 2026-07-07 bulk batch (86 rows)
  // and today's catch-up insert (created_at = today's date, UTC).
  const { data: batch1 } = await sb.from('ar_reminder').select('id, entity_name, company_id, fye_month, fye_year, fye_date, due_date').eq('created_at', '2026-07-07T07:32:47.922208+00:00');
  const today = new Date().toISOString().slice(0, 10);
  const { data: batch2 } = await sb.from('ar_reminder').select('id, entity_name, company_id, fye_month, fye_year, fye_date, due_date').gte('created_at', `${today}T00:00:00Z`);

  const rows = [...(batch1 ?? []), ...(batch2 ?? [])];
  console.log(`Auditing ${rows.length} rows (${batch1?.length ?? 0} from 2026-07-07 batch, ${batch2?.length ?? 0} from today's catch-up)`);

  const companies = await pageAll('companies', 'id, internal_id, company_name');
  const internalIdByCompanyId = new Map(companies.map(c => [c.id, c.internal_id]));

  const cookie = await getSessionCookie();
  const CONCURRENCY = 12;
  let nextIndex = 0;
  const mismatches = [];
  const errors = [];
  const worker = async () => {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++];
      const internalId = internalIdByCompanyId.get(row.company_id);
      if (!internalId) { errors.push(`${row.entity_name}: no internal_id`); continue; }
      try {
        const result = await fetchAgmList(cookie, internalId);
        const years = new Set();
        for (const ev of result.data ?? []) {
          const [event, yearLabel] = ev;
          if (event === 'AGM' || event === 'AR') years.add(yearLabel);
        }
        if (!years.has(String(row.fye_year))) {
          mismatches.push({ entity_name: row.entity_name, id: row.id, stored_year: row.fye_year, real_years: [...years], stored_fye_date: row.fye_date, stored_due_date: row.due_date });
        }
      } catch (e) {
        errors.push(`${row.entity_name}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n=== MISMATCHES: ${mismatches.length} / ${rows.length} ===`);
  mismatches.forEach(m => console.log(` - ${m.entity_name} | stored: ${m.stored_year} | TeamWork real cycle year(s): ${m.real_years.join(', ')}`));
  console.log(`\n=== FETCH ERRORS: ${errors.length} ===`);
  errors.forEach(e => console.log(' -', e));

  require('fs').writeFileSync(path.join(__dirname, '../tmp-ar-mismatches.json'), JSON.stringify(mismatches, null, 2));
  console.log('\nWrote mismatch details to tmp-ar-mismatches.json');
})();
