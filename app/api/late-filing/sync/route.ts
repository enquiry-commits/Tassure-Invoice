import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { withAutomationRun } from '@/lib/automation-sync';

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
 * Auto-owned rows (remarks beginning with AUTO:) are refreshed each run.
 * When their risk clears they move to Review: for a human to verify. Manual,
 * Review and Resolved remarks are never overwritten by automation.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const OVERDUE_THRESHOLD_DAYS = 90;
const HISTORICAL_AVG_THRESHOLD_DAYS = 90;
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

async function syncLateFiling() {
  const supabase = createAdminClient();

  const cookie = await getSessionCookie();

  const { data: companies } = await supabase
    .from('companies')
    .select('company_name, internal_id, registration_no')
    .eq('is_active', true)
    .not('tw_status', 'in', '("Striking Off","Terminated")')
    .not('internal_id', 'is', null);

  const targets = companies ?? [];

  const { data: existingManual } = await supabase.from('late_filing_companies').select('id, uen, company_name, remarks');
  const byUen = new Map((existingManual ?? []).filter(row => row.uen).map(row => [row.uen as string, row]));
  const byName = new Map((existingManual ?? []).map(row => [row.company_name.toLowerCase(), row]));

  const today = new Date();
  let flagged = 0, inserted = 0, refreshed = 0, movedToReview = 0, errors = 0;
  const insertedNames: string[] = [];
  const evaluatedIds = new Set<number>();
  const stillFlaggedIds = new Set<number>();

  for (const c of targets) {
    let result;
    try {
      result = await fetchAgmList(cookie, c.internal_id as string);
    } catch {
      errors++;
      continue;
    }
    const rows = result.data ?? [];
    const existing = (c.registration_no ? byUen.get(c.registration_no) : null)
      ?? byName.get(c.company_name.toLowerCase());
    if (existing) evaluatedIds.add(existing.id);

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

    const reasons: string[] = [];
    if (currentOverdueDays > OVERDUE_THRESHOLD_DAYS) reasons.push(`Overdue ${currentOverdueDays} days`);
    if (avgGap > HISTORICAL_AVG_THRESHOLD_DAYS) reasons.push(`Avg ${avgGap} days late over ${gaps.length} cycles`);

    const toIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const values = {
      company_name: c.company_name,
      uen: c.registration_no || null,
      financial_year_end: latestFyeMonth,
      last_agm_date: toIso(lastAgmHeld),
      last_annual_return_date: toIso(lastArFiled),
      next_agm_due_date: toIso(earliestOutstandingDue) || toIso(newestAgmDue),
      remarks: `AUTO: ${reasons.join('；')}`,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      stillFlaggedIds.add(existing.id);
      if (/^AUTO:/i.test(existing.remarks ?? '')) {
        const { error } = await supabase.from('late_filing_companies').update(values).eq('id', existing.id);
        if (error) errors++;
        else refreshed++;
      }
      continue;
    }

    const { error } = await supabase.from('late_filing_companies').insert(values);
    if (error) errors++;
    else { inserted++; insertedNames.push(c.company_name); }
  }

  const reviewDate = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore',
  }).format(new Date());
  for (const row of existingManual ?? []) {
    if (!evaluatedIds.has(row.id) || stillFlaggedIds.has(row.id) || !/^AUTO:/i.test(row.remarks ?? '')) continue;
    const { error } = await supabase.from('late_filing_companies').update({
      remarks: `Review: Auto condition cleared on ${reviewDate} — verify before resolving. Previous: ${row.remarks}`,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) errors++;
    else movedToReview++;
  }

  const result = { ok: errors === 0, checked: targets.length, flagged, inserted, refreshed, movedToReview, insertedNames, errors };
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'late_filing', syncLateFiling);
}
