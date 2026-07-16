/**
 * Backfills missing detail columns on auto-inserted late_filing_companies
 * rows (and refreshes stale ones), using each company's full event history
 * from TeamWork's company_agm/agm_list_ajax:
 *
 *   - financial_year_end:      FYE month of the most recent cycle
 *   - last_agm_date:           most recent AGM Held Date
 *   - last_annual_return_date: most recent AR Filling/Completed Date
 *   - next_agm_due_date:       due date of the earliest UNCOMPLETED AGM/AR cycle
 *                              (or the newest cycle's AGM due date if none outstanding)
 *   - remarks:                 auto-detection reason (current overdue days and/or
 *                              historical average gap) — only written when remarks
 *                              is empty, never overwrites manual notes
 *
 * Only touches rows whose UEN matches a company with a TeamWork internal_id.
 * Manual-only entries (fully struck-off companies with no event history)
 * are left as-is.
 *
 * Usage: node scripts/backfill-late-filing-details.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const https = require('https');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME;
const PASSWORD = process.env.TEAMWORK_PASSWORD;
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDmy(s) {
  const clean = (s || '').replace(/<[^>]+>/g, '').trim();
  const m = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`);
}
const iso = d => d ? d.toISOString().slice(0, 10) : null;

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

function analyse(rows, today) {
  let lastAgmHeld = null, lastArFiled = null, latestFyeMonth = null;
  let earliestOutstandingDue = null, newestAgmDue = null;
  const gaps = [];
  let currentOverdueDays = 0;

  for (const row of rows) {
    const [event, , fyeDateRaw, , dueDateRaw, heldDateRaw, filingDateRaw] = row;
    if (!['AGM', 'AR'].includes(event)) continue;
    const dueDate = parseDmy(dueDateRaw);
    if (!dueDate) continue;
    const heldDate = parseDmy(heldDateRaw);
    const filingDate = parseDmy(filingDateRaw);
    const completionDate = filingDate || heldDate;
    const fyeDate = parseDmy(fyeDateRaw);
    if (fyeDate && !latestFyeMonth) latestFyeMonth = MONTH_ABB_SAFE(fyeDate);

    if (event === 'AGM') {
      if (heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
      if (!newestAgmDue || dueDate > newestAgmDue) newestAgmDue = dueDate;
    }
    if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) lastArFiled = filingDate;

    if (completionDate) {
      gaps.push(Math.round((completionDate - dueDate) / 86400000));
    } else {
      if (!earliestOutstandingDue || dueDate < earliestOutstandingDue) earliestOutstandingDue = dueDate;
      if (dueDate < today) {
        const od = Math.round((today - dueDate) / 86400000);
        if (od > currentOverdueDays) currentOverdueDays = od;
      }
    }
  }

  const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
  return { lastAgmHeld, lastArFiled, latestFyeMonth, earliestOutstandingDue, newestAgmDue, avgGap, currentOverdueDays, cycles: gaps.length };
}

function MONTH_ABB_SAFE(d) { return MONTH_ABBR[d.getMonth()]; }

async function main() {
  if (!USERNAME || !PASSWORD) throw new Error('TEAMWORK_USERNAME and TEAMWORK_PASSWORD are required.');
  console.log('Logging in...');
  const cookie = await getSessionCookie();

  const { data: lateRows } = await sb.from('late_filing_companies').select('*').order('id');
  const { data: companies } = await sb.from('companies').select('company_name, internal_id, registration_no');
  const idByUen = new Map((companies ?? []).filter(c => c.registration_no).map(c => [c.registration_no, c.internal_id]));
  const idByName = new Map((companies ?? []).map(c => [c.company_name.toUpperCase(), c.internal_id]));

  const today = new Date();
  let updated = 0, skipped = 0;

  for (const row of lateRows) {
    const companyId = (row.uen && idByUen.get(row.uen)) || idByName.get(row.company_name.toUpperCase());
    if (!companyId) { console.log(`  SKIP (no TeamWork id): ${row.company_name}`); skipped++; continue; }

    let result;
    try { result = await fetchAgmList(cookie, companyId); }
    catch (e) { console.log(`  SKIP (fetch error): ${row.company_name}`); skipped++; continue; }

    const a = analyse(result.data ?? [], today);
    if (!a.cycles && !a.earliestOutstandingDue) { console.log(`  SKIP (no event history): ${row.company_name}`); skipped++; continue; }

    const reasons = [];
    if (a.currentOverdueDays > 90) reasons.push(`Overdue ${a.currentOverdueDays} days`);
    if (a.avgGap > 90) reasons.push(`Avg ${a.avgGap} days late over ${a.cycles} cycles`);
    const autoRemark = reasons.length ? `AUTO: ${reasons.join('; ')}` : null;

    const updates = {
      financial_year_end: row.financial_year_end || a.latestFyeMonth,
      last_agm_date: row.last_agm_date || iso(a.lastAgmHeld),
      last_annual_return_date: row.last_annual_return_date || iso(a.lastArFiled),
      next_agm_due_date: row.next_agm_due_date || iso(a.earliestOutstandingDue) || iso(a.newestAgmDue),
      remarks: row.remarks || autoRemark,
      updated_at: new Date().toISOString(),
    };

    console.log(`  UPDATE ${row.company_name}: fye=${updates.financial_year_end} lastAGM=${updates.last_agm_date} lastAR=${updates.last_annual_return_date} nextDue=${updates.next_agm_due_date} remarks=${JSON.stringify(updates.remarks)}`);
    if (!DRY_RUN) {
      const { error } = await sb.from('late_filing_companies').update(updates).eq('id', row.id);
      if (error) { console.error('    ERROR:', error.message); continue; }
    }
    updated++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Updated: ${updated}, skipped: ${skipped}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
