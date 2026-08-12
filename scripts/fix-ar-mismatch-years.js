/**
 * Corrects the ar_reminder rows found wrong by audit-ar-reminder-years.js.
 * For the clean "single real year, exactly stored_year+1" cases (company's
 * only real TeamWork cycle is next year, not this year — a newly-
 * incorporated company whose first cycle hasn't happened this year), fetch
 * the real fye_date/due_date from TeamWork and UPDATE the row in place.
 * For anything else (ambiguous — multiple real years, or a single real
 * year that isn't simply +1), do NOT guess: set status='Excluded' with a
 * note so it stops showing as if it were a normal Pending row, and leave
 * it for manual review.
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

function parseDmy(s) {
  const clean = (s || '').replace(/<[^>]+>/g, '').trim();
  const m = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`);
}
const iso = d => d ? d.toISOString().slice(0, 10) : null;
function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

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
  const mismatches = JSON.parse(require('fs').readFileSync(path.join(__dirname, '../tmp-ar-mismatches.json'), 'utf8'));
  const { data: rows } = await sb.from('ar_reminder').select('id, company_id, entity_name').in('id', mismatches.map(m => m.id));
  const { data: companies } = await sb.from('companies').select('id, internal_id').in('id', rows.map(r => r.company_id).filter(Boolean));
  const internalIdByCompanyId = new Map(companies.map(c => [c.id, c.internal_id]));
  const companyIdByRowId = new Map(rows.map(r => [r.id, r.company_id]));

  const cookie = await getSessionCookie();

  const clean = mismatches.filter(m => m.real_years.length === 1 && Number(m.real_years[0]) === m.stored_year + 1);
  const ambiguous = mismatches.filter(m => !(m.real_years.length === 1 && Number(m.real_years[0]) === m.stored_year + 1));

  console.log(`Clean fixes (single real year = stored+1): ${clean.length}`);
  console.log(`Ambiguous (leaving alone, excluding instead): ${ambiguous.length}`);
  ambiguous.forEach(m => console.log(`  - ${m.entity_name} | stored: ${m.stored_year} | real: ${m.real_years.join(', ')}`));

  let fixed = 0;
  const fixErrors = [];
  for (const m of clean) {
    const companyId = companyIdByRowId.get(m.id);
    const internalId = internalIdByCompanyId.get(companyId);
    if (!internalId) { fixErrors.push(`${m.entity_name}: no internal_id`); continue; }
    try {
      const result = await fetchAgmList(cookie, internalId);
      const targetYear = m.real_years[0];
      let fyeDate = null;
      for (const ev of result.data ?? []) {
        const [event, yearLabel, fyeRaw] = ev;
        if ((event === 'AGM' || event === 'AR') && yearLabel === targetYear) {
          const f = iso(parseDmy(fyeRaw));
          if (f && (!fyeDate || f < fyeDate)) fyeDate = f;
        }
      }
      if (!fyeDate) { fixErrors.push(`${m.entity_name}: could not find real fye date for ${targetYear}`); continue; }
      // Always FYE+7 (this system's own convention), never the scraped "due
      // date" column directly — AGM shows FYE+6mo, AR shows FYE+7mo, and
      // trusting whichever event matched first got all 27 real rows wrong
      // by a month the first time this script ran. See /generate's
      // catch-up pass for the same fix applied to the live route.
      const dueDate = addMonths(fyeDate, 7);
      const { error: updErr } = await sb.from('ar_reminder').update({ fye_year: Number(targetYear), fye_date: fyeDate, due_date: dueDate }).eq('id', m.id);
      if (updErr) { fixErrors.push(`${m.entity_name}: ${updErr.message}`); continue; }
      console.log(`Fixed: ${m.entity_name} -> ${targetYear}, FYE ${fyeDate}, Due ${dueDate}`);
      fixed++;
    } catch (e) {
      fixErrors.push(`${m.entity_name}: ${e.message}`);
    }
  }

  let excluded = 0;
  for (const m of ambiguous) {
    const { error: exclErr } = await sb.from('ar_reminder').update({
      status: 'Excluded',
      updated_by_email: 'system:ar-generate-audit',
      updated_by_name: 'AR year audit (ambiguous — manual review needed)',
    }).eq('id', m.id);
    if (exclErr) { fixErrors.push(`${m.entity_name} (exclude): ${exclErr.message}`); continue; }
    excluded++;
  }

  console.log(`\nFixed: ${fixed}, Excluded (ambiguous): ${excluded}, Errors: ${fixErrors.length}`);
  fixErrors.forEach(e => console.log(' -', e));
})();
