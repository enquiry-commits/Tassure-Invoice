import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import type { Browser } from 'playwright-core';
import https from 'https';

/**
 * Auto-detects late filers directly from TeamWork's own per-company event
 * history (company_agm/agm_list_ajax), which is the authoritative source —
 * it reflects TeamWork staff's real AGM/AR Held/Filed dates, unlike our own
 * ar_reminder.filling_date (a separate shadow-copy staff have to remember
 * to update).
 *
 * Validated against 16 originally hand-curated late filers: neither "any
 * overdue cycle" nor "count of pending cycles" nor "current overdue days
 * alone" correctly reproduces that list. The real rule (confirmed by
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
 * Companies with ZERO event history (already fully Struck
 * Off/de-registered) can't be detected this way — they remain manual-only.
 *
 * Approach: log in once via a real browser (TeamWork's login page has
 * Google reCAPTCHA v3, so a pure-HTTP login isn't viable), extract the
 * PHPSESSID cookie, then close the browser and fetch every active
 * company's event history via plain HTTP POST to /company_agm/agm_list_ajax
 * (one lightweight call per company — no further browser use).
 *
 * Only INSERTS newly-detected late companies into late_filing_companies
 * (matched by UEN/name) — never overwrites existing manual entries.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = 'Vincent';
const PASSWORD = 'Pass@123';
const OVERDUE_THRESHOLD_DAYS = 90;
const HISTORICAL_AVG_THRESHOLD_DAYS = 90;
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDmy(s: string): Date | null {
  const clean = (s || '').replace(/<[^>]+>/g, '').trim();
  const m = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`);
}

async function getBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: pwChromium } = await import('playwright-core');
    return pwChromium.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const { chromium: localChromium } = await import('playwright');
  return localChromium.launch({ headless: true }) as unknown as Browser;
}

async function getSessionCookie(): Promise<string> {
  const browser = await getBrowser();
  try {
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
    const phpsessid = cookies.find(c => c.name === 'PHPSESSID');
    if (!phpsessid) throw new Error('Login failed — no PHPSESSID cookie obtained');
    return `PHPSESSID=${phpsessid.value}`;
  } finally {
    await browser.close();
  }
}

function fetchAgmList(cookie: string, companyId: string): Promise<{ data: string[][] }> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = {
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

export async function GET() {
  const supabase = createAdminClient();

  const cookie = await getSessionCookie();

  const { data: companies } = await supabase
    .from('companies')
    .select('company_name, internal_id, registration_no')
    .eq('is_active', true)
    .not('tw_status', 'in', '("Striking Off","Terminated")')
    .not('internal_id', 'is', null);

  const targets = companies ?? [];

  const { data: existingManual } = await supabase.from('late_filing_companies').select('uen, company_name');
  const existingUens = new Set((existingManual ?? []).map(r => r.uen).filter(Boolean));
  const existingNames = new Set((existingManual ?? []).map(r => r.company_name.toLowerCase()));

  const today = new Date();
  let flagged = 0, inserted = 0, errors = 0;
  const insertedNames: string[] = [];

  for (const c of targets) {
    let result;
    try {
      result = await fetchAgmList(cookie, c.internal_id as string);
    } catch {
      errors++;
      continue;
    }
    const rows = result.data ?? [];

    const gaps: number[] = [];
    let currentOverdueDays = 0;
    let latestFyeMonth: string | null = null;
    let lastAgmHeld: Date | null = null;
    let lastArFiled: Date | null = null;
    let earliestOutstandingDue: Date | null = null;
    let newestAgmDue: Date | null = null;

    for (const row of rows) {
      const [event, , fyeDateRaw, , dueDateRaw, heldDateRaw, filingDateRaw] = row;
      if (!['AGM', 'AR'].includes(event)) continue;
      const dueDate = parseDmy(dueDateRaw);
      if (!dueDate) continue;
      const heldDate = parseDmy(heldDateRaw);
      const filingDate = parseDmy(filingDateRaw);
      const completionDate = filingDate || heldDate;
      const fyeDate = parseDmy(fyeDateRaw);
      if (fyeDate && !latestFyeMonth) latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()];

      if (event === 'AGM') {
        if (heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
        if (!newestAgmDue || dueDate > newestAgmDue) newestAgmDue = dueDate;
      }
      if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) lastArFiled = filingDate;

      if (completionDate) {
        gaps.push(Math.round((completionDate.getTime() - dueDate.getTime()) / 86400000));
      } else {
        if (!earliestOutstandingDue || dueDate < earliestOutstandingDue) earliestOutstandingDue = dueDate;
        if (dueDate < today) {
          const overdueDays = Math.round((today.getTime() - dueDate.getTime()) / 86400000);
          if (overdueDays > currentOverdueDays) currentOverdueDays = overdueDays;
        }
      }
    }

    const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    const isLate = currentOverdueDays > OVERDUE_THRESHOLD_DAYS || avgGap > HISTORICAL_AVG_THRESHOLD_DAYS;
    if (!isLate) continue;
    flagged++;

    const alreadyExists = (c.registration_no && existingUens.has(c.registration_no)) || existingNames.has(c.company_name.toLowerCase());
    if (alreadyExists) continue;

    const reasons: string[] = [];
    if (currentOverdueDays > OVERDUE_THRESHOLD_DAYS) reasons.push(`Overdue ${currentOverdueDays} days`);
    if (avgGap > HISTORICAL_AVG_THRESHOLD_DAYS) reasons.push(`Avg ${avgGap} days late over ${gaps.length} cycles`);

    const toIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const { error } = await supabase.from('late_filing_companies').insert({
      company_name: c.company_name,
      uen: c.registration_no || null,
      financial_year_end: latestFyeMonth,
      last_agm_date: toIso(lastAgmHeld),
      last_annual_return_date: toIso(lastArFiled),
      next_agm_due_date: toIso(earliestOutstandingDue) || toIso(newestAgmDue),
      remarks: `AUTO: ${reasons.join('；')}`,
    });
    if (!error) { inserted++; insertedNames.push(c.company_name); }
  }

  return NextResponse.json({ ok: true, checked: targets.length, flagged, inserted, insertedNames, errors });
}
