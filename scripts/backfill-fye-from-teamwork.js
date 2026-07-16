/**
 * Backfill companies.fye_month from TeamWork for active CSS clients where it
 * is null. Only Singapore-UEN companies with a TeamWork internal_id are
 * candidates (offshore entities/L.P.s have no ACRA AR cycle and are skipped).
 *
 * Source of truth: each company's AGM/AR event history
 * (company_agm/agm_list_ajax) — the FYE date on the newest event row.
 *
 * Login uses a real browser once (reCAPTCHA v3 on the login page), then every
 * company is fetched over plain HTTP with the session cookie.
 *
 * Usage: node scripts/backfill-fye-from-teamwork.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY = process.argv.includes('--dry-run');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME;
const PASSWORD = process.env.TEAMWORK_PASSWORD;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function getSessionCookie() {
  if (!USERNAME || !PASSWORD) throw new Error('TEAMWORK_USERNAME and TEAMWORK_PASSWORD are required.');
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('welcome')) {
      await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
      await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
      await page.getByRole('button', { name: ' Login' }).click();
      // waitForURL can race a fast redirect — tolerate it; the PHPSESSID check
      // below is the real gate.
      await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const c = (await ctx.cookies()).find(c => c.name === 'PHPSESSID');
    if (!c) throw new Error('No PHPSESSID after login');
    return `PHPSESSID=${c.value}`;
  } finally { await browser.close(); }
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
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function parseDmy(s) {
  const m = (s || '').replace(/<[^>]+>/g, '').trim().match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

(async () => {
  const sgUen = /^(19|20)\d{7,8}[A-Z]$/;
  const { data: missing } = await sb.from('companies')
    .select('id, company_name, registration_no, internal_id')
    .eq('client_type', 'CSS Client').eq('is_active', true).is('fye_month', null);
  const targets = (missing ?? []).filter(c =>
    sgUen.test(String(c.registration_no ?? '').trim()) && c.internal_id);
  console.log(`${DRY ? '[DRY RUN] ' : ''}candidates: ${targets.length} SG companies with internal_id (of ${missing.length} missing fye_month)`);

  const cookie = await getSessionCookie();
  console.log('TeamWork session obtained');

  let updated = 0, noEvents = 0, errors = 0;
  for (const c of targets) {
    let rows;
    try { rows = (await fetchAgmList(cookie, String(c.internal_id))).data ?? []; }
    catch (e) { errors++; console.log(`  ERR ${c.company_name}: ${e.message}`); continue; }

    // newest FYE date across AGM/AR events
    let best = null;
    for (const row of rows) {
      const [event, , fyeRaw] = row;
      if (!['AGM', 'AR'].includes(event)) continue;
      const d = parseDmy(fyeRaw);
      if (d && (!best || d > best)) best = d;
    }
    if (!best) { noEvents++; console.log(`  no AGM/AR events: ${c.company_name}`); continue; }

    const month = MONTHS[best.getMonth()];
    console.log(`  ${c.company_name.slice(0, 48).padEnd(50)} -> ${month} (latest FYE ${best.toISOString().slice(0, 10)})`);
    if (!DRY) {
      const { error } = await sb.from('companies').update({ fye_month: month }).eq('id', c.id);
      if (error) { errors++; console.log(`  UPDATE ERR: ${error.message}`); continue; }
    }
    updated++;
  }
  console.log(`\n${DRY ? '[DRY RUN] ' : ''}done: ${updated} updated, ${noEvents} without events, ${errors} errors`);
})();
