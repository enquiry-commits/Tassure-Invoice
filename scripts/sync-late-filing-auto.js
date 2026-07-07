/**
 * Auto-detects late filers directly from TeamWork's own "Due Date Tracker"
 * (Event Tracker > Due Date Tracker), which is the authoritative source —
 * it reflects TeamWork staff's real AGM/AR Held/Filed status, unlike our
 * own ar_reminder.filling_date (a separate shadow-copy staff have to
 * remember to update).
 *
 * Approach: log in once via a real browser (TeamWork's login page has
 * Google reCAPTCHA v3, so a pure-HTTP login isn't viable), extract the
 * PHPSESSID cookie, then close the browser and fetch the Due Date
 * Tracker's data via plain HTTP POST to /mainadmin/duedate_listing
 * (a DataTables server-side endpoint) — no further browser use needed.
 *
 * A row is "late" if Status === 'Pending' (not yet Held/Filed) AND its
 * Due Date has already passed. Only INSERTS newly-detected late companies
 * into late_filing_companies (matched by UEN) — never overwrites existing
 * manual entries (which may carry hand-written remarks like "ACRA STRIKE
 * OFF" that must be preserved).
 *
 * Usage: node scripts/sync-late-filing-auto.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const https = require('https');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = 'Vincent';
const PASSWORD = 'Pass@123';

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDmy(s) {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { iso: `${m[3]}-${m[2]}-${m[1]}`, month: parseInt(m[2], 10) };
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
  if (!phpsessid) throw new Error('Login failed — no PHPSESSID cookie obtained');
  return `PHPSESSID=${phpsessid.value}`;
}

function fetchDueDateTracker(cookie) {
  return new Promise((resolve, reject) => {
    const params = {
      draw: '1', start: '0', length: '3000',
      'search[value]': '', 'search[regex]': 'false',
      'order[0][column]': '0', 'order[0][dir]': 'asc',
      ci_csrf_token: '', comid: '', statu: 'Pending', month: '', eventval: '', year: '', cli: 'all',
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
      hostname: 'apps.teamworkcss.com',
      path: '/tassure_asia/mainadmin/duedate_listing',
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Logging in via browser to get session cookie...');
  const cookie = await getSessionCookie();
  console.log('Got session cookie.');

  console.log('Fetching Due Date Tracker (all Pending events)...');
  const result = await fetchDueDateTracker(cookie);
  console.log(`recordsTotal: ${result.recordsTotal}`);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = [];
  for (const row of result.data) {
    const [, entityName, , fyeDateRaw, event, dueDateRaw, , status, actionsHtml] = row;
    if (status !== 'Pending') continue;
    if (!['AGM', 'AR'].includes(event)) continue;
    const dueDate = parseDmy(dueDateRaw);
    if (!dueDate || dueDate.iso >= today) continue; // not yet overdue

    const companyIdMatch = actionsHtml.match(/company_id="(\d+)"/);
    const fyeDate = parseDmy(fyeDateRaw);
    overdue.push({
      entityName,
      companyId: companyIdMatch ? companyIdMatch[1] : null,
      event,
      dueDateIso: dueDate.iso,
      fyeMonth: fyeDate ? MONTH_ABBR[fyeDate.month - 1] : null,
    });
  }
  console.log(`\nFound ${overdue.length} overdue AGM/AR events (past due, still Pending).`);

  // One row per company — keep the earliest (most overdue) due date
  const byCompany = new Map();
  for (const o of overdue) {
    const existing = byCompany.get(o.entityName);
    if (!existing || o.dueDateIso < existing.dueDateIso) byCompany.set(o.entityName, o);
  }
  console.log(`Distinct overdue companies: ${byCompany.size}`);

  const { data: companies } = await sb.from('companies').select('internal_id, registration_no, company_name');
  const uenByInternalId = new Map((companies ?? []).map(c => [c.internal_id, c.registration_no]));

  const { data: existingManual } = await sb.from('late_filing_companies').select('uen, company_name');
  const existingUens = new Set((existingManual ?? []).map(r => r.uen).filter(Boolean));
  const existingNames = new Set((existingManual ?? []).map(r => r.company_name.toLowerCase()));

  let inserted = 0, skipped = 0;
  for (const [entityName, o] of byCompany) {
    const uen = o.companyId ? uenByInternalId.get(o.companyId) : null;
    const alreadyExists = (uen && existingUens.has(uen)) || existingNames.has(entityName.toLowerCase());
    if (alreadyExists) { skipped++; continue; }

    console.log(`  INSERT: ${entityName} (${o.event} overdue since ${o.dueDateIso}, FYE ${o.fyeMonth})`);
    if (!DRY_RUN) {
      const { error } = await sb.from('late_filing_companies').insert({
        company_name: entityName,
        uen: uen || null,
        financial_year_end: o.fyeMonth,
        next_agm_due_date: o.dueDateIso,
        remarks: null,
      });
      if (error) console.error('    ERROR:', error.message);
    }
    inserted++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Inserted: ${inserted}, already tracked (skipped): ${skipped}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
