/**
 * Auto-detects late filers directly from TeamWork's own per-company event
 * history (company_agm/agm_list_ajax), which is the authoritative source —
 * it reflects TeamWork staff's real AGM/AR Held/Filed dates, unlike our own
 * ar_reminder.filling_date (a separate shadow-copy staff have to remember
 * to update).
 *
 * Validated against the 16 originally hand-curated late filers: neither
 * "any overdue cycle" nor "count of pending cycles" nor "current overdue
 * days alone" correctly reproduces that list. The real rule (confirmed by
 * inspecting each company's full Due-Date-to-Completion-Date history):
 *
 *   flag as late if EITHER
 *     (a) the current outstanding cycle is overdue by > OVERDUE_THRESHOLD_DAYS, OR
 *     (b) the historical average (Completion Date - Due Date) across past
 *         completed cycles exceeds HISTORICAL_AVG_THRESHOLD_DAYS
 *
 * (a) alone misses companies with a consistently bad track record whose
 * current cycle just happens to have recently become due (e.g. MEGASTAR
 * SHIPPING: every past cycle 6-12 months late, but current cycle only 7
 * days overdue right now). (b) alone misses companies with a fine history
 * whose current cycle has been sitting unprocessed for a long time (e.g.
 * JETONE GLOBAL FREIGHT: history is fine, current cycle 11 months overdue).
 * Companies with neither signal (e.g. 1V CAPITAL: ~7 day gaps throughout)
 * are correctly excluded — a cycle a few days past due is normal
 * processing lag, not a late-filing risk.
 *
 * Companies with ZERO event history at all (already fully Struck
 * Off/de-registered, e.g. ADVANCE BRIGHT GLOBAL) can't be detected this
 * way — they remain manual-only entries.
 *
 * Approach: log in once via a real browser (TeamWork's login page has
 * Google reCAPTCHA v3, so a pure-HTTP login isn't viable), extract the
 * PHPSESSID cookie, then close the browser and fetch each company's event
 * history via plain HTTP POST to /company_agm/agm_list_ajax (a DataTables
 * server-side endpoint, one call per company) — no further browser use.
 *
 * Only INSERTS newly-detected late companies into late_filing_companies
 * (matched by UEN/name) — never overwrites existing manual entries.
 *
 * Usage: node scripts/sync-late-filing-auto.js [--dry-run] [--limit=N]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const https = require('https');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME || 'Vincent'; // TODO remove fallback once TEAMWORK_USERNAME is set in Vercel env
const PASSWORD = process.env.TEAMWORK_PASSWORD || 'Pass@123'; // TODO remove fallback once TEAMWORK_PASSWORD is set in Vercel env

const OVERDUE_THRESHOLD_DAYS = 90;
const HISTORICAL_AVG_THRESHOLD_DAYS = 90;
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDmy(s) {
  const clean = (s || '').replace(/<[^>]+>/g, '').trim();
  const m = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`);
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

async function main() {
  console.log('Logging in via browser to get session cookie...');
  const cookie = await getSessionCookie();
  console.log('Got session cookie.');

  const { data: companies } = await sb
    .from('companies')
    .select('company_name, internal_id, registration_no')
    .eq('is_active', true)
    .not('tw_status', 'in', '("Striking Off","Terminated")')
    .not('internal_id', 'is', null);

  const targets = companies.slice(0, LIMIT);
  console.log(`Checking ${targets.length} active companies (of ${companies.length} total)...`);

  const { data: existingManual } = await sb.from('late_filing_companies').select('uen, company_name');
  const existingUens = new Set((existingManual ?? []).map(r => r.uen).filter(Boolean));
  const existingNames = new Set((existingManual ?? []).map(r => r.company_name.toLowerCase()));

  const today = new Date();
  let checked = 0, flagged = 0, inserted = 0, errors = 0;

  for (const c of targets) {
    checked++;
    let result;
    try {
      result = await fetchAgmList(cookie, c.internal_id);
    } catch (e) {
      errors++;
      continue;
    }
    const rows = result.data ?? [];

    const gaps = [];
    let currentOverdueDays = 0;
    let currentDueDateIso = null;
    let currentFyeMonth = null;

    for (const row of rows) {
      const [event, , fyeDateRaw, , dueDateRaw, heldDateRaw, filingDateRaw] = row;
      if (!['AGM', 'AR'].includes(event)) continue;
      const dueDate = parseDmy(dueDateRaw);
      if (!dueDate) continue;
      const heldDate = parseDmy(heldDateRaw);
      const filingDate = parseDmy(filingDateRaw);
      const completionDate = filingDate || heldDate;

      if (completionDate) {
        gaps.push(Math.round((completionDate - dueDate) / 86400000));
      } else if (dueDate < today) {
        const overdueDays = Math.round((today - dueDate) / 86400000);
        if (overdueDays > currentOverdueDays) {
          currentOverdueDays = overdueDays;
          currentDueDateIso = dueDate.toISOString().slice(0, 10);
          const fyeDate = parseDmy(fyeDateRaw);
          currentFyeMonth = fyeDate ? MONTH_ABBR[fyeDate.getMonth()] : null;
        }
      }
    }

    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const isLate = currentOverdueDays > OVERDUE_THRESHOLD_DAYS || avgGap > HISTORICAL_AVG_THRESHOLD_DAYS;

    if (!isLate) continue;
    flagged++;

    const alreadyExists = (c.registration_no && existingUens.has(c.registration_no)) || existingNames.has(c.company_name.toLowerCase());
    if (alreadyExists) continue;

    console.log(`  LATE: ${c.company_name} | current overdue: ${currentOverdueDays}d | historical avg gap: ${Math.round(avgGap)}d (${gaps.length} cycles)`);
    if (!DRY_RUN) {
      const { error } = await sb.from('late_filing_companies').insert({
        company_name: c.company_name,
        uen: c.registration_no || null,
        financial_year_end: currentFyeMonth,
        next_agm_due_date: currentDueDateIso,
        remarks: null,
      });
      if (error) console.error('    ERROR:', error.message);
    }
    inserted++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Checked: ${checked}, flagged as late: ${flagged}, newly inserted: ${inserted}, fetch errors: ${errors}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
