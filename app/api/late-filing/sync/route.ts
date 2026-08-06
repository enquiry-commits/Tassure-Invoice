import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, toIsoDate, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { AutomationRun, withAutomationRun } from '@/lib/automation-sync';
import { normalize } from '@/lib/company-name';

/**
 * Detects late filers from TeamWork's per-company AGM/AR history.
 *
 * A company is flagged when either its current outstanding cycle is more
 * than 90 days overdue, or its historical average completion delay is more
 * than 90 days. TeamWork is read with bounded concurrency because processing
 * every company sequentially can exceed Vercel's five-minute function limit.
 *
 * Also mirrors each flagged company's outstanding cycle into AR Reminder
 * (Vincent: Late Filing companies must be visible in AR Reminder too, under
 * their own FYE cycle, marked so staff can tell them apart, with the reason
 * noted in Remarks) — see syncIntoArReminder below. AR Reminder's own daily
 * sync only ever fills empty date fields for cycles that already have a
 * row; a company stuck 90+ days late sometimes has no ar_reminder row at
 * all for its outstanding cycle (e.g. it predates AR Generate's rolling
 * window), so this route creates one when missing.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const OVERDUE_THRESHOLD_DAYS = 90;
const HISTORICAL_AVG_THRESHOLD_DAYS = 90;
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DEFAULT_CONCURRENCY = 12;
const MAX_CONCURRENCY = 20;

// Prefixes the Remarks line this route writes so app/billing/page.tsx can
// render a "LATE" badge purely by checking the field's text — no extra
// column needed. Keep this string in sync with LATE_FILING_MARKER there.
const LATE_FILING_MARKER = '⚠ LATE FILING:';

// Stop our own work before Vercel's 300-second hard limit so the run can be
// marked failed and its lock can always be released.
const WORK_DEADLINE_MS = 230_000;

type CompanyTarget = {
  id: number;
  company_name: string;
  internal_id: string;
  registration_no: string | null;
};

type CompanyEvaluation = {
  company: CompanyTarget;
  rows?: string[][];
  error?: string;
};

function configuredConcurrency() {
  const parsed = Number(process.env.LATE_FILING_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.trunc(parsed)));
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Late Filing evaluation was cancelled.');
}

async function evaluateCompanies(
  targets: CompanyTarget[],
  cookie: string,
  run: AutomationRun,
  signal: AbortSignal,
): Promise<CompanyEvaluation[]> {
  const results = new Array<CompanyEvaluation>(targets.length);
  const concurrency = Math.min(configuredConcurrency(), Math.max(1, targets.length));
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      const index = nextIndex++;
      if (index >= targets.length) return;
      const company = targets[index];

      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await fetchAgmList(cookie, company.internal_id, signal);
          results[index] = { company, rows: result.data ?? [] };
          lastError = null;
          break;
        } catch (error) {
          if (signal.aborted) throw abortError(signal);
          lastError = error;
          if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 250));
        }
      }

      if (lastError) {
        results[index] = {
          company,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        };
      }

      completed++;
      if (completed % 100 === 0) await run.heartbeat(6);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function syncLateFiling(run: AutomationRun) {
  const supabase = createAdminClient();
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(
      'Late Filing stopped safely before the Vercel timeout because TeamWork did not finish within 230 seconds.',
    ));
  }, WORK_DEADLINE_MS);

  try {
    const cookie = await getSessionCookie();

    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('id, company_name, internal_id, registration_no')
      .eq('is_active', true)
      .not('tw_status', 'in', '("Striking Off","Terminated")')
      .not('internal_id', 'is', null);
    if (companiesError) throw new Error(`Unable to load active companies: ${companiesError.message}`);

    const targets: CompanyTarget[] = (companies ?? []).map(company => ({
      id: company.id,
      company_name: company.company_name,
      internal_id: String(company.internal_id),
      registration_no: company.registration_no ?? null,
    }));
    const evaluations = await evaluateCompanies(targets, cookie, run, controller.signal);

    const { data: existingManual, error: existingError } = await supabase
      .from('late_filing_companies')
      .select('id, uen, company_name, remarks, financial_year_end, next_agm_due_date, manual_fields');
    if (existingError) throw new Error(`Unable to load Late Filing records: ${existingError.message}`);

    const byUen = new Map((existingManual ?? [])
      .filter(row => row.uen)
      .map(row => [row.uen as string, row]));
    const byName = new Map((existingManual ?? [])
      .map(row => [row.company_name.toLowerCase(), row]));

    // Preload AR Reminder rows once so each company's outstanding cycle can
    // be looked up by UEN (preferred) or normalized name, keyed by its own
    // FYE cycle — same exact-match approach used across the rest of the app.
    const { data: arRows, error: arRowsError } = await supabase
      .from('ar_reminder')
      .select('id, entity_name, uen, fye_month, fye_year, remarks')
      .or('status.is.null,status.neq.Excluded');
    if (arRowsError) throw new Error(`Unable to load AR Reminder rows: ${arRowsError.message}`);
    const arByKey = new Map<string, { id: number; remarks: string | null }>();
    for (const row of arRows ?? []) {
      const entry = { id: row.id, remarks: row.remarks };
      const cycleKey = `${row.fye_month}|${row.fye_year}`;
      const uenKey = row.uen ? String(row.uen).trim().toUpperCase() : null;
      if (uenKey) arByKey.set(`uen:${uenKey}|${cycleKey}`, entry);
      arByKey.set(`name:${normalize(row.entity_name)}|${cycleKey}`, entry);
    }
    let arInserted = 0;
    let arNoted = 0;

    const today = new Date();
    let flagged = 0;
    let inserted = 0;
    let refreshed = 0;
    let movedToReview = 0;
    let errors = 0;
    let successfullyEvaluated = 0;
    const insertedNames: string[] = [];
    const fetchErrors: Array<{ company: string; error: string }> = [];
    const evaluatedIds = new Set<number>();
    const stillFlaggedIds = new Set<number>();

    for (const evaluation of evaluations) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const c = evaluation.company;
      if (evaluation.error) {
        errors++;
        if (fetchErrors.length < 20) {
          fetchErrors.push({ company: c.company_name, error: evaluation.error });
        }
        continue;
      }
      successfullyEvaluated++;

      const rows = evaluation.rows ?? [];
      const existing = (c.registration_no ? byUen.get(c.registration_no) : null)
        ?? byName.get(c.company_name.toLowerCase());
      if (existing) evaluatedIds.add(existing.id);

      const gaps: number[] = [];
      let currentOverdueDays = 0;
      // Named "latest" but until 2026-08-06 this only ever kept the FIRST
      // fyeDate seen in the loop (`!latestFyeMonth` is only true before the
      // first assignment) — a company that changed FYE partway through has
      // older cycles under its old month sitting earlier in TeamWork's own
      // history, exactly the bug already found and fixed in ar-reminder/
      // sync-workflow's companies.fye_month correction (Vincent caught the
      // inconsistency directly: "这个FYE的逻辑是否有按照之前设置ACTIVE
      // CLIENT的逻辑一致"). Now genuinely compares ISO dates and keeps the
      // highest one, same as that route.
      let latestFyeMonth: string | null = null;
      let latestFyeIso: string | null = null;
      let lastAgmHeld: Date | null = null;
      let lastArFiled: Date | null = null;
      let earliestOutstandingDue: Date | null = null;
      let earliestOverdueDue: Date | null = null;
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
        const fyeIso = fyeDate ? toIsoDate(fyeDate) : null;
        if (fyeDate && fyeIso && (!latestFyeIso || fyeIso > latestFyeIso)) {
          latestFyeIso = fyeIso;
          latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()];
        }

        if (event === 'AGM') {
          if (heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
          if (!newestAgmDue || dueDate > newestAgmDue) newestAgmDue = dueDate;
        }
        if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) {
          lastArFiled = filingDate;
        }

        if (completionDate) {
          gaps.push(Math.round((completionDate.getTime() - dueDate.getTime()) / 86_400_000));
        } else {
          if (!earliestOutstandingDue || dueDate < earliestOutstandingDue) earliestOutstandingDue = dueDate;
          if (dueDate < today) {
            const overdueDays = Math.round((today.getTime() - dueDate.getTime()) / 86_400_000);
            if (overdueDays > currentOverdueDays) currentOverdueDays = overdueDays;
            if (!earliestOverdueDue || dueDate < earliestOverdueDue) earliestOverdueDue = dueDate;
          }
        }
      }

      const avgGap = gaps.length
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
        : 0;
      const isLate = currentOverdueDays > OVERDUE_THRESHOLD_DAYS
        || avgGap > HISTORICAL_AVG_THRESHOLD_DAYS;
      if (!isLate) continue;
      flagged++;

      const reasons: string[] = [];
      if (currentOverdueDays > OVERDUE_THRESHOLD_DAYS) reasons.push(`Overdue ${currentOverdueDays} days`);
      if (avgGap > HISTORICAL_AVG_THRESHOLD_DAYS) {
        reasons.push(`Avg ${avgGap} days late over ${gaps.length} cycles`);
      }

      // Mirror the outstanding cycle into AR Reminder — only when there's an
      // actual cycle that's overdue RIGHT NOW (earliestOverdueDue). A company
      // flagged purely on historical average (avgGap), with every cycle
      // either filed or not yet due, has no genuinely late cycle to attach a
      // row to — earliestOutstandingDue/newestAgmDue could still be a FUTURE
      // due date, which would misleadingly badge a not-yet-due cycle "late".
      const outstandingDue = earliestOverdueDue;
      if (outstandingDue && latestFyeMonth) {
        const fyeMonthIdx0 = MONTH_ABBR.indexOf(latestFyeMonth);
        const dueYear = outstandingDue.getFullYear();
        const dueMonthIdx0 = outstandingDue.getMonth();
        // AGM due = FYE + 9 months (SG private co. rule — same relationship
        // /api/late-filing/route.ts's nextAgmDue() encodes going forward).
        // Going backward, if the FYE month number is greater than the due
        // month number, the FYE fell in the calendar year before the due
        // date's year; otherwise same year. Exact for any ~9-month gap, and
        // avoids Date month-arithmetic overflow edge cases entirely.
        const fyeYear = dueYear - (fyeMonthIdx0 > dueMonthIdx0 ? 1 : 0);
        const fyeMonthFull = FULL_MONTH_NAMES[fyeMonthIdx0];
        const fyeDateIso = new Date(fyeYear, fyeMonthIdx0 + 1, 0).toISOString().slice(0, 10);
        // Describe THIS cycle's actual overdue days, not `reasons` — that
        // array only lists whichever conditions crossed the 90-day bar
        // that flags the company on the Late Filing page, so a company
        // flagged solely on historical average (avgGap) but with a milder
        // (e.g. 35-day) real overdue cycle would otherwise get a note
        // that never mentions the cycle it's actually attached to.
        const mirrorOverdueDays = Math.round((today.getTime() - outstandingDue.getTime()) / 86_400_000);
        const mirrorReasons = [`Overdue ${mirrorOverdueDays} days`];
        if (avgGap > HISTORICAL_AVG_THRESHOLD_DAYS) mirrorReasons.push(`Avg ${avgGap} days late over ${gaps.length} cycles`);
        const lateNote = `${LATE_FILING_MARKER} ${mirrorReasons.join('; ')}`;

        const cycleKey = `${fyeMonthFull}|${fyeYear}`;
        const uenKey = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
        const arMatch = (uenKey ? arByKey.get(`uen:${uenKey}|${cycleKey}`) : null)
          ?? arByKey.get(`name:${normalize(c.company_name)}|${cycleKey}`);

        if (arMatch) {
          // Write the note once; if staff has since edited it away, that's
          // a manual decision this sync must not fight (same "manual wins"
          // rule as the AGM/AR date columns).
          if (!arMatch.remarks?.includes(LATE_FILING_MARKER)) {
            const nextRemarks = arMatch.remarks ? `${lateNote}\n${arMatch.remarks}` : lateNote;
            const { error: noteError } = await supabase.from('ar_reminder').update({
              remarks: nextRemarks,
              updated_by_email: 'system:late-filing',
              updated_by_name: 'Late Filing Sync',
            }).eq('id', arMatch.id);
            if (noteError) errors++; else arNoted++;
          }
        } else {
          const { error: insertError } = await supabase.from('ar_reminder').insert({
            entity_name: c.company_name,
            company_id: c.id,
            uen: c.registration_no,
            fye_month: fyeMonthFull,
            fye_year: fyeYear,
            fye_date: fyeDateIso,
            due_date: outstandingDue.toISOString().slice(0, 10),
            remarks: lateNote,
            updated_by_email: 'system:late-filing',
            updated_by_name: 'Late Filing Sync',
          });
          if (insertError) errors++; else arInserted++;
        }
      }

      const toIso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;
      const values = {
        company_name: c.company_name,
        uen: c.registration_no,
        financial_year_end: latestFyeMonth,
        last_agm_date: toIso(lastAgmHeld),
        last_annual_return_date: toIso(lastArFiled),
        next_agm_due_date: toIso(earliestOutstandingDue) || toIso(newestAgmDue),
        remarks: `AUTO: ${reasons.join('; ')}`,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        stillFlaggedIds.add(existing.id);
        // Per-field manual protection (see scripts/add-late-filing-manual-
        // fields.sql) replaces the old row-level "does remarks start with
        // AUTO:" gate — company_name/uen are never staff-protected (see
        // PROTECTED_FIELDS in app/api/late-filing/route.ts), so they always
        // stay in the patch.
        const manual = (existing as { manual_fields?: Record<string, boolean> | null }).manual_fields ?? {};
        const PROTECTED_KEYS = ['financial_year_end', 'last_agm_date', 'last_annual_return_date', 'next_agm_due_date', 'remarks'];
        const anyFieldUnprotected = PROTECTED_KEYS.some(key => !manual[key]);
        if (anyFieldUnprotected) {
          const patch = Object.fromEntries(
            Object.entries(values).filter(([key]) => !PROTECTED_KEYS.includes(key) || !manual[key]),
          );
          const { error } = await supabase
            .from('late_filing_companies')
            .update(patch)
            .eq('id', existing.id);
          if (error) errors++;
          else refreshed++;
        }
        continue;
      }

      const { error } = await supabase.from('late_filing_companies').insert(values);
      if (error) errors++;
      else {
        inserted++;
        insertedNames.push(c.company_name);
      }
    }

    // Manual/legacy Late Filing entries with no row in `companies` at all
    // (e.g. already struck off and removed from the TeamWork roster, or
    // hand-added by staff) never appear in `targets` above, so the loop
    // never touches them — mirror them here from late_filing_companies'
    // own stored fields instead. evaluatedIds excludes exactly this set:
    // every row the main loop DID manage to match to an active company,
    // regardless of whether it's still late this run.
    for (const m of existingManual ?? []) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      if (evaluatedIds.has(m.id)) continue;
      if (!m.financial_year_end) continue;
      const fyeMonthIdx0 = MONTH_ABBR.indexOf(m.financial_year_end.toUpperCase());
      if (fyeMonthIdx0 < 0) continue;
      // Only signal available for "is this actually overdue" without a
      // TeamWork event history to check — same bar as the main loop.
      const dueDate = m.next_agm_due_date ? new Date(`${m.next_agm_due_date}T00:00:00`) : null;
      if (!dueDate || Number.isNaN(dueDate.getTime()) || dueDate >= today) continue;

      const dueYear = dueDate.getFullYear();
      const dueMonthIdx0 = dueDate.getMonth();
      const fyeYear = dueYear - (fyeMonthIdx0 > dueMonthIdx0 ? 1 : 0);
      const fyeMonthFull = FULL_MONTH_NAMES[fyeMonthIdx0];
      const fyeDateIso = new Date(fyeYear, fyeMonthIdx0 + 1, 0).toISOString().slice(0, 10);
      const lateNote = `${LATE_FILING_MARKER} ${m.remarks?.trim() || 'Flagged on the Late Filing page'}`;

      const cycleKey = `${fyeMonthFull}|${fyeYear}`;
      const uenKey = m.uen ? String(m.uen).trim().toUpperCase() : null;
      const arMatch = (uenKey ? arByKey.get(`uen:${uenKey}|${cycleKey}`) : null)
        ?? arByKey.get(`name:${normalize(m.company_name)}|${cycleKey}`);

      if (arMatch) {
        if (!arMatch.remarks?.includes(LATE_FILING_MARKER)) {
          const nextRemarks = arMatch.remarks ? `${lateNote}\n${arMatch.remarks}` : lateNote;
          const { error: noteError } = await supabase.from('ar_reminder').update({
            remarks: nextRemarks,
            updated_by_email: 'system:late-filing',
            updated_by_name: 'Late Filing Sync',
          }).eq('id', arMatch.id);
          if (noteError) errors++; else arNoted++;
        }
      } else {
        const { error: insertError } = await supabase.from('ar_reminder').insert({
          entity_name: m.company_name,
          uen: m.uen,
          fye_month: fyeMonthFull,
          fye_year: fyeYear,
          fye_date: fyeDateIso,
          due_date: m.next_agm_due_date,
          remarks: lateNote,
          updated_by_email: 'system:late-filing',
          updated_by_name: 'Late Filing Sync',
        });
        if (insertError) errors++; else arInserted++;
      }
    }

    const reviewDate = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Singapore',
    }).format(new Date());

    for (const row of existingManual ?? []) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const manual = (row as { manual_fields?: Record<string, boolean> | null }).manual_fields ?? {};
      if (!evaluatedIds.has(row.id)
        || stillFlaggedIds.has(row.id)
        || manual.remarks) continue;
      const { error } = await supabase.from('late_filing_companies').update({
        remarks: `Review: Auto condition cleared on ${reviewDate} — verify before resolving. Previous: ${row.remarks}`,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (error) errors++;
      else movedToReview++;
    }

    const result = {
      ok: errors === 0,
      checked: targets.length,
      evaluated: successfullyEvaluated,
      concurrency: configuredConcurrency(),
      flagged,
      inserted,
      refreshed,
      movedToReview,
      insertedNames,
      ar_reminder_rows_inserted: arInserted,
      ar_reminder_rows_noted: arNoted,
      errors,
      fetchErrors,
    };
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    clearTimeout(deadline);
  }
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'late_filing', syncLateFiling);
}
