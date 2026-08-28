import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, parseLatestDmy, toIsoDate, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { AutomationRun, withAutomationRun } from '@/lib/automation-sync';
import { normalize } from '@/lib/company-name';
import { todaySGT } from '@/lib/date';

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
      .select('id, uen, company_name, remarks, financial_year_end, next_agm_due_date, manual_fields, resolved_but_still_overdue_since');
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

    // Preload existing EOT (Extension of Time) rows once — same pattern as
    // byUen/byName above, just against master_list's list_type='eot' slice.
    // Auto-detected from the SAME per-company TeamWork data this loop
    // already fetches for the overdue check below (see Pass 3 inside the
    // main loop) — Vincent, 2026-08-28: TeamWork renders a Due Date as
    // "<strike>ORIGINAL</strike> <br> REVISED" once staff grant an
    // extension (confirmed live: FOMO PAY PTE. LTD.), so this needs zero
    // extra TeamWork calls, only reading a field this loop already has.
    const { data: existingEot, error: existingEotError } = await supabase
      .from('master_list')
      .select('id, roc_no, company_name, eot_event, eot_fye_year, remark, manual_fields')
      .eq('list_type', 'eot');
    if (existingEotError) throw new Error(`Unable to load EOT records: ${existingEotError.message}`);
    const eotByKey = new Map((existingEot ?? []).map(row => [
      `${row.roc_no ? String(row.roc_no).trim().toUpperCase() : normalize(row.company_name)}|${row.eot_event}|${row.eot_fye_year}`,
      row,
    ]));
    let eotInserted = 0;
    let eotRefreshed = 0;
    let eotErrors = 0;

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

      // Pass 1: latest FYE month/cycle stats, plus the FYE of the most
      // recent cycle that's actually been completed (AGM held OR AR filed)
      // — needed before pass 2 can tell a genuinely-outstanding cycle apart
      // from an old superseded one (see below). A separate pass rather than
      // tracking this inline avoids depending on TeamWork's rows already
      // being newest-first, which pass 2's guard would otherwise silently
      // rely on.
      let latestCompletionFyeIso: string | null = null;
      for (const row of rows) {
        const [event, , fyeDateRaw, , , heldDateRaw, filingDateRaw] = row;
        if (!['AGM', 'AR'].includes(event)) continue;
        const heldDate = parseDmy(heldDateRaw);
        const filingDate = parseDmy(filingDateRaw);
        const completionDate = filingDate || heldDate;
        const fyeDate = parseDmy(fyeDateRaw);
        const fyeIso = fyeDate ? toIsoDate(fyeDate) : null;
        if (fyeDate && fyeIso && (!latestFyeIso || fyeIso > latestFyeIso)) {
          latestFyeIso = fyeIso;
          latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()];
        }
        if (completionDate && fyeIso && (!latestCompletionFyeIso || fyeIso > latestCompletionFyeIso)) {
          latestCompletionFyeIso = fyeIso;
        }
        if (event === 'AGM' && heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
        if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) lastArFiled = filingDate;
      }

      // Pass 2: outstanding/overdue detection. TeamWork's own historical
      // data sometimes leaves an OLD row's Held/Filing Date blank even
      // though every cycle since has a real completion date (confirmed
      // live: MITRADE GROUP/IUIGA RETAIL/COCOMELON/HAIPA INTERNATIONAL and
      // others all showed "Overdue 1000+ days" here despite a real AGM/AR
      // filed in 2026 — a legacy TeamWork data-entry gap, not a real open
      // item; same root cause as the Active Client "Next AGM Due Date" bug
      // fixed in ar-reminder/sync-workflow). Naively taking the earliest
      // due date among ALL incomplete rows picks up that ancient gap and
      // reports it as massively overdue. Only count a row as outstanding if
      // its own FYE date is after the latest cycle actually completed.
      for (const row of rows) {
        const [event, , fyeDateRaw, , dueDateRaw, heldDateRaw, filingDateRaw] = row;
        if (!['AGM', 'AR'].includes(event)) continue;
        // parseLatestDmy, not parseDmy: an EOT (Extension of Time) renders
        // this raw field as "<strike>ORIGINAL</strike> <br> REVISED" — see
        // lib/teamwork-agm.ts's own comment (2026-08-28, FOMO PAY PTE. LTD.).
        const dueDate = parseLatestDmy(dueDateRaw);
        if (!dueDate) continue;
        const heldDate = parseDmy(heldDateRaw);
        const filingDate = parseDmy(filingDateRaw);
        const completionDate = filingDate || heldDate;
        const fyeDate = parseDmy(fyeDateRaw);
        const fyeIso = fyeDate ? toIsoDate(fyeDate) : null;

        if (event === 'AGM' && (!newestAgmDue || dueDate > newestAgmDue)) newestAgmDue = dueDate;

        if (completionDate) {
          gaps.push(Math.round((completionDate.getTime() - dueDate.getTime()) / 86_400_000));
        } else if (!fyeIso || !latestCompletionFyeIso || fyeIso > latestCompletionFyeIso) {
          if (!earliestOutstandingDue || dueDate < earliestOutstandingDue) earliestOutstandingDue = dueDate;
          if (dueDate < today) {
            const overdueDays = Math.round((today.getTime() - dueDate.getTime()) / 86_400_000);
            if (overdueDays > currentOverdueDays) currentOverdueDays = overdueDays;
            if (!earliestOverdueDue || dueDate < earliestOverdueDue) earliestOverdueDue = dueDate;
          }
        }
      }

      // Pass 3 (2026-08-28): auto-detect and record EOT (Extension of Time)
      // rows into master_list (list_type='eot') — reuses the SAME `rows`
      // this company's loop already fetched above for the overdue check,
      // zero extra TeamWork calls. Runs regardless of isLate below — an
      // active EOT is exactly what can make a company NOT late despite an
      // old due date having already passed, so gating this on isLate would
      // skip the very companies it exists to track. Only tracked while the
      // cycle is still open (no held/filing date yet): once actually filed,
      // this row's EOT history stops being operationally relevant (Late
      // Filing/AR Reminder/Active Client's own due-date reads already use
      // the revised date correctly via parseLatestDmy regardless of whether
      // it's tracked here — this list is for staff visibility, not itself
      // the mechanism those other pages depend on). Never touches `remark`
      // — that field is left entirely for staff notes (e.g. marking one
      // "Resolved" once genuinely filed), the same way this sync never
      // touches late_filing_companies.remarks once staff has written one.
      for (const row of rows) {
        const [eotEventRaw, , eotFyeDateRaw, , eotDueDateRaw, eotHeldDateRaw, eotFilingDateRaw] = row;
        if (!['AGM', 'AR'].includes(eotEventRaw)) continue;
        if (!/<strike>|<s>|<del>/i.test(eotDueDateRaw)) continue;
        if (parseDmy(eotHeldDateRaw) || parseDmy(eotFilingDateRaw)) continue;
        const eotFyeDate = parseDmy(eotFyeDateRaw);
        const eotOriginalDue = parseDmy(eotDueDateRaw);
        const eotRevisedDue = parseLatestDmy(eotDueDateRaw);
        if (!eotFyeDate || !eotOriginalDue || !eotRevisedDue) continue;
        const eotFyeYear = eotFyeDate.getFullYear();

        const eotUenKey = c.registration_no ? String(c.registration_no).trim().toUpperCase() : normalize(c.company_name);
        const existingEotRow = eotByKey.get(`${eotUenKey}|${eotEventRaw}|${eotFyeYear}`);
        if (existingEotRow) {
          const { error } = await supabase.from('master_list').update({
            company_name: c.company_name,
            roc_no: c.registration_no,
            eot_original_due_date: toIsoDate(eotOriginalDue),
            eot_revised_due_date: toIsoDate(eotRevisedDue),
            update_date: todaySGT(),
          }).eq('id', existingEotRow.id);
          if (error) eotErrors++; else eotRefreshed++;
        } else {
          const { error } = await supabase.from('master_list').insert({
            list_type: 'eot',
            company_name: c.company_name,
            roc_no: c.registration_no,
            eot_event: eotEventRaw,
            eot_fye_year: String(eotFyeYear),
            eot_original_due_date: toIsoDate(eotOriginalDue),
            eot_revised_due_date: toIsoDate(eotRevisedDue),
            update_date: todaySGT(),
          });
          if (error) eotErrors++; else eotInserted++;
        }
      }

      const avgGap = gaps.length
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
        : 0;
      // Vincent, 2026-08-20: a bad historical average used to be enough to
      // flag a company on its own, even with no cycle actually overdue
      // right now ("habitual" — pre-emptive). Too easy to confuse with
      // companies genuinely late today, so it's no longer a standalone
      // trigger — only a currently-overdue cycle flags a company. Still
      // recorded as supplementary context in `reasons` below when a
      // company IS currently overdue and also has a bad average.
      const isLate = currentOverdueDays > OVERDUE_THRESHOLD_DAYS;

      // Vincent, 2026-08-24: a Resolved row is trusted forever by the rest
      // of this sync (remarks stays frozen via manual_fields.remarks) —
      // nothing ever re-checked whether that trust was actually correct
      // (confirmed live: CO-OPERATE ASSOCIATES was Resolved while still
      // genuinely overdue). Quietly re-verify every run regardless of
      // isLate's outcome below — set the flag once on first detection
      // (never re-stamp a new date every run the same way the old
      // Review-chain bug did), clear it the moment it's no longer overdue.
      if (existing && /^Resolved:/i.test(existing.remarks ?? '')) {
        const alreadyFlagged = !!existing.resolved_but_still_overdue_since;
        if (isLate && !alreadyFlagged) {
          const { error: flagError } = await supabase.from('late_filing_companies')
            .update({ resolved_but_still_overdue_since: todaySGT() })
            .eq('id', existing.id);
          if (flagError) errors++;
        } else if (!isLate && alreadyFlagged) {
          const { error: clearError } = await supabase.from('late_filing_companies')
            .update({ resolved_but_still_overdue_since: null })
            .eq('id', existing.id);
          if (clearError) errors++;
        }
      }

      // Vincent, 2026-08-28: a row that stops being isLate was never
      // touched again by anything below — next_agm_due_date froze at
      // whatever it was on the day it left isLate, even as the real due
      // date kept moving (e.g. a newly-recognized EOT, or simply rolling
      // into the next cycle). Confirmed live: EASYBOOK PAY/EASYBOOK.COM
      // PTE. LTD. both cleared isLate on 2026-08-21 (an unrelated change,
      // the historical-average-only trigger's removal that day) and had
      // shown a stale "30 Jun 2026 · OVERDUE" ever since, with no way for
      // a human to fix it short of manually re-typing the field — now
      // both have a confirmed EOT (see the Pass 3 block above) revising
      // that same due date to 29 Aug 2026, but the row never got a chance
      // to reflect it. Keep this ONE field fresh regardless of isLate/
      // Review/Resolved state — unlike remarks, which stays fully gated
      // behind the Review/Resolved workflow below; only the due date
      // display itself needs to never go stale.
      if (existing && !isLate) {
        const freshDue = (earliestOutstandingDue ?? newestAgmDue)?.toISOString().slice(0, 10) ?? null;
        const manual = (existing as { manual_fields?: Record<string, boolean> | null }).manual_fields ?? {};
        if (freshDue && freshDue !== existing.next_agm_due_date && !manual.next_agm_due_date) {
          const { error: dueError } = await supabase.from('late_filing_companies')
            .update({ next_agm_due_date: freshDue })
            .eq('id', existing.id);
          if (dueError) errors++;
        }
      }

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
      // Which ar_reminder row this company's marker was mirrored into
      // this run, if any — persisted onto its own late_filing_companies
      // row below (mirrored_ar_reminder_id) so the reconciliation pass
      // further down can keep that row's marker line in sync going
      // forward, independent of re-deriving cycle/date logic that stops
      // making sense once the company is later resolved.
      let mirroredArReminderId: number | null = null;
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
          mirroredArReminderId = arMatch.id;
          // First-write only here; the reconciliation pass further down
          // is what keeps this line in sync afterward (updated as Late
          // Filing's own remarks change, removed once Resolved) — see
          // that pass's own comment for why it's allowed to keep
          // re-asserting over a staff edit, unlike every other AR
          // Reminder field this sync touches.
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
          const { data: insertedAr, error: insertError } = await supabase.from('ar_reminder').insert({
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
          }).select('id').single();
          if (insertError) errors++; else { arInserted++; mirroredArReminderId = insertedAr?.id ?? null; }
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
        mirrored_ar_reminder_id: mirroredArReminderId,
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

      let mirroredArReminderId: number | null = null;
      if (arMatch) {
        mirroredArReminderId = arMatch.id;
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
        const { data: insertedAr, error: insertError } = await supabase.from('ar_reminder').insert({
          entity_name: m.company_name,
          uen: m.uen,
          fye_month: fyeMonthFull,
          fye_year: fyeYear,
          fye_date: fyeDateIso,
          due_date: m.next_agm_due_date,
          remarks: lateNote,
          updated_by_email: 'system:late-filing',
          updated_by_name: 'Late Filing Sync',
        }).select('id').single();
        if (insertError) errors++; else { arInserted++; mirroredArReminderId = insertedAr?.id ?? null; }
      }

      if (mirroredArReminderId !== null) {
        await supabase.from('late_filing_companies')
          .update({ mirrored_ar_reminder_id: mirroredArReminderId })
          .eq('id', m.id);
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
      // Vincent, 2026-08-20: this used to re-stamp a fresh "Review: ...
      // Previous: {remarks}" note EVERY run the condition stayed cleared —
      // with no staff action needed to stop it, a company that stayed
      // cleared for two weeks grew an 11-layer nested "Previous: Previous:
      // ..." chain (confirmed live: 12 companies affected, chain depth up
      // to 12). Only stamp it once, on the actual flagged->cleared
      // transition — a remarks value that already starts with "Review:"
      // or "Resolved:" means that already happened; leave it alone
      // (whether still under Review or since promoted to Resolved by
      // staff editing the text) until a real re-flag clears manual.remarks
      // or the row leaves this loop via stillFlaggedIds.
      if (!evaluatedIds.has(row.id)
        || stillFlaggedIds.has(row.id)
        || manual.remarks
        || /^(Review|Resolved):/.test(row.remarks ?? '')) continue;
      const { error } = await supabase.from('late_filing_companies').update({
        remarks: `Review: Auto condition cleared on ${reviewDate} — verify before resolving. Previous: ${row.remarks}`,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (error) errors++;
      else movedToReview++;
    }

    // Vincent, 2026-08-20: late_filing_companies.remarks is authoritative
    // over ar_reminder's mirrored "⚠ LATE FILING:" line, continuously —
    // not just at first-write time. Runs over EVERY row ever mirrored
    // (mirrored_ar_reminder_id set), not only ones this run evaluated, so
    // a staff "Resolved" click made directly on the Late Filing page
    // (outside a sync run) and a staff edit that wiped the marker line on
    // the AR Reminder side both get corrected on the next run. Only the
    // marker LINE is ever touched — whatever else staff wrote in that
    // remarks field is preserved.
    let reconciled = 0;
    const { data: mirroredRows, error: mirroredError } = await supabase
      .from('late_filing_companies')
      .select('id, remarks, mirrored_ar_reminder_id')
      .not('mirrored_ar_reminder_id', 'is', null);
    if (mirroredError) errors++;
    for (const lf of mirroredRows ?? []) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const { data: arRow } = await supabase.from('ar_reminder')
        .select('id, remarks').eq('id', lf.mirrored_ar_reminder_id).maybeSingle();
      if (!arRow) continue; // mirrored row deleted since — nothing to reconcile

      const lfRemarks = lf.remarks ?? '';
      const resolved = /^Resolved:/i.test(lfRemarks);
      // AUTO:/Review: both keep the marker showing — Review means "looks
      // clear but not yet confirmed," so stay cautious and keep it
      // visible until a human actually resolves it. Strip whichever
      // label prefix is present so the marker's trailing text always
      // reflects Late Filing's OWN current wording.
      const desired = resolved ? null
        : `${LATE_FILING_MARKER} ${lfRemarks.replace(/^(AUTO|Review):\s*/i, '')}`;

      const lines = (arRow.remarks ?? '').split('\n');
      const hasMarker = lines[0]?.startsWith(LATE_FILING_MARKER);
      const rest = hasMarker ? lines.slice(1) : lines;

      let next: string | null;
      if (desired === null) {
        if (!hasMarker) continue; // already absent
        next = rest.join('\n') || null;
      } else {
        if (hasMarker && lines[0] === desired) continue; // already in sync
        next = [desired, ...rest].join('\n');
      }

      const { error: reconcileError } = await supabase.from('ar_reminder').update({
        remarks: next,
        updated_by_email: 'system:late-filing',
        updated_by_name: 'Late Filing Sync',
      }).eq('id', arRow.id);
      if (reconcileError) errors++; else reconciled++;
    }

    const result = {
      ok: errors === 0 && eotErrors === 0,
      checked: targets.length,
      evaluated: successfullyEvaluated,
      concurrency: configuredConcurrency(),
      flagged,
      inserted,
      refreshed,
      movedToReview,
      reconciled,
      insertedNames,
      ar_reminder_rows_inserted: arInserted,
      ar_reminder_rows_noted: arNoted,
      eot_inserted: eotInserted,
      eot_refreshed: eotRefreshed,
      eot_errors: eotErrors,
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
