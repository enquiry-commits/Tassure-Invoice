import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, parseLatestDmy, toIsoDate, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { AutomationRun, withAutomationRun, replaceAutomationExceptions } from '@/lib/automation-sync';
import { normalize } from '@/lib/company-name';
import { pageAll } from '@/lib/page-all';
import {
  buildLifecycleIndex, planArAutoExclusions, planArAutoRestores, findActiveCompaniesWithAllArHidden, onlyTeamworkActiveCompanies,
  ENDED_MASTER_LIST_TYPES,
  AR_SYSTEM_EXCLUDER, AR_SYSTEM_RESTORER, MAX_AUTO_EXCLUSIONS_PER_RUN, MAX_AUTO_RESTORES_PER_RUN,
} from '@/lib/company-lifecycle';
import { todaySGT } from '@/lib/date';
import { companySecretaryPic, MAX_PIC_FILLS_PER_RUN, planMirrorPicFills } from '@/lib/late-filing-pic';
import { assessFye, findLeftoverCycles, leftoverReminder, MAX_LEFTOVER_COMPANIES_PER_RUN, parseDmyStrict, parseTwCycles, type LeftoverCycle } from '@/lib/ar-fye-resolve';

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
  pic: string | null;
  sec_pic: string | null;
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

    // Same corporate-secretarial roster as AR Generate — the ONE shared
    // definition (lib/company-lifecycle.ts). The old `is_active AND tw_status
    // NOT IN (...)` only excluded status-less companies by the accident of SQL
    // NULL semantics; identical 904-company set, now on purpose.
    const { data: companies, error: companiesError } = await onlyTeamworkActiveCompanies(supabase
      .from('companies')
      .select('id, company_name, internal_id, registration_no, pic, sec_pic'))
      .not('internal_id', 'is', null);
    if (companiesError) throw new Error(`Unable to load active companies: ${companiesError.message}`);

    const targets: CompanyTarget[] = (companies ?? []).map(company => ({
      id: company.id,
      company_name: company.company_name,
      internal_id: String(company.internal_id),
      registration_no: company.registration_no ?? null,
      pic: company.pic ?? null,
      sec_pic: company.sec_pic ?? null,
    }));
    const evaluations = await evaluateCompanies(targets, cookie, run, controller.signal);

    // INV-AR-021 (7): a cycle TeamWork left behind that cannot be real (lib/ar-fye-resolve.ts findLeftoverCycles — the ONE definition;
    // ORBITEZ's AGM for FYE 30/06/2025 with no AR event inside its filed Dec 2024 -> Dec 2025 year) is dropped from `rows` below, at the
    // single place they enter, so overdue days, the next AGM due, the EOT pass, the mirror into AR Reminder and the FYE month all follow
    // the latest cycle (Vincent: "ORBITEZ 就按照最新的跑"). The rule is narrow; if MORE than MAX_LEFTOVER_COMPANIES_PER_RUN companies match in
    // one run something is wrong (a TeamWork glitch, a parsing change) and NOTHING is ignored tonight — a real overdue cycle is never
    // dropped in bulk, and the run says so.
    const leftoverAll = new Map<number, LeftoverCycle[]>();
    for (const ev of evaluations) {
      if (ev.error) continue;
      const found = findLeftoverCycles(parseTwCycles(ev.rows ?? []).cycles);
      if (found.length) leftoverAll.set(ev.company.id, found);
    }
    const leftoverTripped = leftoverAll.size > MAX_LEFTOVER_COMPANIES_PER_RUN;
    const leftoverByCompany = leftoverTripped ? new Map<number, LeftoverCycle[]>() : leftoverAll;

    const { data: existingManual, error: existingError } = await supabase
      .from('late_filing_companies')
      .select('id, uen, company_name, remarks, financial_year_end, next_agm_due_date, manual_fields, resolved_but_still_overdue_since, mirrored_ar_reminder_id');
    if (existingError) throw new Error(`Unable to load Late Filing records: ${existingError.message}`);

    const byUen = new Map((existingManual ?? [])
      .filter(row => row.uen)
      .map(row => [row.uen as string, row]));
    const byName = new Map((existingManual ?? [])
      .map(row => [row.company_name.toLowerCase(), row]));

    // Preload AR Reminder rows once so each company's outstanding cycle can
    // be looked up by UEN (preferred) or normalized name, keyed by its own
    // FYE cycle — same exact-match approach used across the rest of the app.
    // Vincent, 2026-10-04, pointing at "Late Filing never": the real cause
    // (found via writeErrors, see this file's own `noteWriteError` comment
    // above) was this query's own `.or('status.is.null,status.neq.Excluded')`
    // filter — it excludes Excluded rows from `arByKey` on purpose (an
    // Excluded/terminated cycle must never be silently un-hidden by being
    // treated as "the same cycle to update"), but that left NOTHING to stop
    // the insert fallback below from trying to create a SECOND row for a
    // cycle that already has one sitting Excluded. `ar_reminder` has a real
    // UNIQUE(entity_name, fye_month, fye_year) constraint
    // ("ar_reminder_entity_month_year_uniq"), so every such insert failed —
    // confirmed live: 5 companies (INVENTA TECHNOLOGIES, HUASHENG GLOBAL
    // TRADING, Q & E ENERGY EFFICIENT, ZJJ FAMILY OFFICE, ENGAREAT), all
    // already struck off/terminated (no row left in `companies`, which is
    // exactly why they reach the "manual/legacy" loop below rather than the
    // main one), every single day since 2026-09-23. Now fetched unfiltered:
    // `arByKey` (update-eligibility) keeps the exact same Excluded-row
    // exclusion as before; `arKeyExists` is a parallel, status-blind set
    // used ONLY to decide insert-vs-skip, so a cycle that already has a row
    // in ANY status is never inserted again.
    const { data: arRows, error: arRowsError } = await supabase
      .from('ar_reminder')
      .select('id, entity_name, uen, fye_month, fye_year, remarks, status');
    if (arRowsError) throw new Error(`Unable to load AR Reminder rows: ${arRowsError.message}`);
    const arByKey = new Map<string, { id: number; remarks: string | null }>();
    const arKeyExists = new Set<string>();
    for (const row of arRows ?? []) {
      const cycleKey = `${row.fye_month}|${row.fye_year}`;
      const uenKey = row.uen ? String(row.uen).trim().toUpperCase() : null;
      const nameKey = `name:${normalize(row.entity_name)}|${cycleKey}`;
      const uenMapKey = uenKey ? `uen:${uenKey}|${cycleKey}` : null;
      if (uenMapKey) arKeyExists.add(uenMapKey);
      arKeyExists.add(nameKey);
      if (row.status === 'Excluded') continue;
      const entry = { id: row.id, remarks: row.remarks };
      if (uenMapKey) arByKey.set(uenMapKey, entry);
      arByKey.set(nameKey, entry);
    }
    let arInserted = 0;
    let arNoted = 0;
    let arInsertsSkippedExcluded = 0;

    // EOT (Extension of Time) auto-detection (Pass 3 inside the main loop
    // below) reuses arByKey directly — TeamWork renders a Due Date as
    // "<strike>ORIGINAL</strike> <br> REVISED" once staff grant an
    // extension (confirmed live: FOMO PAY PTE. LTD.), and the four eot_*
    // columns it writes live on ar_reminder itself (see that block's own
    // comment for why), so no separate preload is needed here — zero
    // extra TeamWork calls either way.
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
    // Vincent, 2026-10-04, pointing at the Automation Health dashboard's
    // "Late Filing never" badge: every run since 2026-09-23 has completed
    // real work (hundreds of companies checked/refreshed/reconciled) but
    // logged a handful of silent `errors++` from one of ~16 write sites
    // below, with no detail ever captured — withAutomationRun marks the
    // WHOLE run 'failed' the moment errors > 0 (see lib/automation-sync.ts),
    // so it has never once recorded a success despite being almost entirely
    // working. Investigated directly against production data (ruled out:
    // TeamWork fetch errors — fetchErrors is empty; EOT errors — eot_errors
    // is 0; a UEN-casing mismatch blocking the late_filing_companies insert
    // — none found; no Vercel log access in this environment to read the
    // real error text another way). This captures the actual Postgres/
    // Supabase error message at every write site — same shape as
    // `fetchErrors` above — so the NEXT run's summary finally shows exactly
    // which write is failing and why, instead of staying a bare count.
    const writeErrors: Array<{ step: string; error: string }> = [];
    const noteWriteError = (step: string, message: string | undefined) => {
      errors++;
      if (writeErrors.length < 20) writeErrors.push({ step, error: message ?? 'unknown error' });
    };
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

      const allRows = evaluation.rows ?? [];
      const leftover = leftoverByCompany.get(c.id) ?? [];
      const leftoverFyes = new Set(leftover.map(l => l.fyeIso));
      const rows = leftoverFyes.size ? allRows.filter(row => !leftoverFyes.has(parseDmyStrict(String(row[2] ?? '')) ?? '')) : allRows;
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
      // INV-AR-021 (2026-10-10): the month is now decided by lib/ar-fye-resolve.ts's assessFye — the same single definition AR
      // Reminder uses — so a keying slip in TeamWork (BEAUTY ASSET: 01/10/2027 for 30/09/2027) cannot make this page, or the
      // AR row it mirrors, say October.
      let latestFyeMonth: string | null = null;
      let lastAgmHeld: Date | null = null;
      let lastArFiled: Date | null = null;
      let earliestOutstandingDue: Date | null = null;
      let earliestOverdueDue: Date | null = null;
      // The EXACT FYE date of the cycle that earliestOverdueDue belongs to (strictly read; null when TeamWork's cell is unreadable).
      let earliestOverdueFyeIso: string | null = null;
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
        if (completionDate && fyeIso && (!latestCompletionFyeIso || fyeIso > latestCompletionFyeIso)) {
          latestCompletionFyeIso = fyeIso;
        }
        if (event === 'AGM' && heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
        if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) lastArFiled = filingDate;
      }
      const monthAssessment = assessFye(parseTwCycles(rows).cycles);
      latestFyeMonth = monthAssessment.month ? MONTH_ABBR[FULL_MONTH_NAMES.indexOf(monthAssessment.month)] : null;

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
            if (!earliestOverdueDue || dueDate < earliestOverdueDue) { earliestOverdueDue = dueDate; earliestOverdueFyeIso = parseDmyStrict(fyeDateRaw); }
          }
        }
      }

      // Pass 3 (2026-08-28, reworked same day): auto-detect EOT (Extension
      // of Time) and record it directly on the matching ar_reminder row,
      // not a separate list — first built as a standalone master_list
      // category, reconsidered once Vincent's own EOT column list turned
      // out to be ~60% identical to ar_reminder's EXISTING columns
      // (Reminder/Report Ready/To Client/Signed/XBRL/DPO/ROND RONS/SEC-
      // ACC-TAX PIC/Remarks): an EOT company is fundamentally an ALREADY-
      // tracked ar_reminder cycle whose due date TeamWork shows as
      // extended, not a new set of companies — writing the four eot_*
      // date columns onto that SAME row (scripts/add-ar-reminder-eot-
      // fields.sql) keeps Reminder/PIC/Remarks the one copy AR Reminder
      // already maintains, not a second, disconnected one that drifts.
      // Reuses the SAME `rows` this company's loop already fetched above
      // for the overdue check (zero extra TeamWork calls) and the SAME
      // arByKey map built for the late-filing mirror below. Runs
      // independent of isLate — an active EOT is exactly what can make a
      // company NOT late despite an old due date having already passed,
      // so gating this on isLate would skip the very companies it exists
      // to track. Only tracked while the cycle is still open (no held/
      // filing date yet): once actually filed, this history stops being
      // operationally relevant — Late Filing/AR Reminder/Active Client's
      // own due-date reads already use the revised date correctly via
      // parseLatestDmy regardless of whether it's tracked here.
      for (const row of rows) {
        const [eotEventRaw, , eotFyeDateRaw, , eotDueDateRaw, eotHeldDateRaw, eotFilingDateRaw] = row;
        if (!['AGM', 'AR'].includes(eotEventRaw)) continue;
        if (!/<strike>|<s>|<del>/i.test(eotDueDateRaw)) continue;
        if (parseDmy(eotHeldDateRaw) || parseDmy(eotFilingDateRaw)) continue;
        const eotFyeDate = parseDmy(eotFyeDateRaw);
        const eotOriginalDue = parseDmy(eotDueDateRaw);
        const eotRevisedDue = parseLatestDmy(eotDueDateRaw);
        if (!eotFyeDate || !eotOriginalDue || !eotRevisedDue) continue;
        const eotFyeMonthIdx0 = eotFyeDate.getMonth();
        const eotFyeYear = eotFyeDate.getFullYear();
        const eotFyeMonthFull = FULL_MONTH_NAMES[eotFyeMonthIdx0];

        const originalField = eotEventRaw === 'AR' ? 'ar_original_due_date' : 'agm_original_due_date';
        const revisedField = eotEventRaw === 'AR' ? 'ar_revised_due_date' : 'agm_revised_due_date';
        const eotCycleKey = `${eotFyeMonthFull}|${eotFyeYear}`;
        const eotUenKey = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
        const arMatchForEot = (eotUenKey ? arByKey.get(`uen:${eotUenKey}|${eotCycleKey}`) : null)
          ?? arByKey.get(`name:${normalize(c.company_name)}|${eotCycleKey}`);

        if (arMatchForEot) {
          const { error } = await supabase.from('ar_reminder').update({
            [originalField]: toIsoDate(eotOriginalDue),
            [revisedField]: toIsoDate(eotRevisedDue),
          }).eq('id', arMatchForEot.id);
          if (error) eotErrors++; else eotRefreshed++;
        } else {
          // No live ar_reminder row exists for this exact cycle yet (rare
          // — most companies already have one via /generate's rolling
          // window). Same minimal insert shape the late-filing mirror
          // below already uses for the identical situation — no PIC
          // resolution here either, matching that existing precedent.
          // TeamWork's own FYE date for the cycle (INV-AR-021 (9)) — the month-end of that month is only the fallback for an unreadable cell:
          // a computed date is what made generate's rows differ from TeamWork's, and the exact-date row sync then never connects them.
          const eotFyeDateIso = parseDmyStrict(eotFyeDateRaw) ?? new Date(eotFyeYear, eotFyeMonthIdx0 + 1, 0).toISOString().slice(0, 10);
          const { error } = await supabase.from('ar_reminder').insert({
            entity_name: c.company_name,
            company_id: c.id,
            uen: c.registration_no,
            fye_month: eotFyeMonthFull,
            fye_year: eotFyeYear,
            fye_date: eotFyeDateIso,
            due_date: toIsoDate(eotRevisedDue),
            [originalField]: toIsoDate(eotOriginalDue),
            [revisedField]: toIsoDate(eotRevisedDue),
            pic: companySecretaryPic(c) || null,   // INV-AR-021 (8): a row with no PIC is on nobody's My Tasks
            updated_by_email: 'system:late-filing',
            updated_by_name: 'Late Filing Sync',
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
          if (flagError) noteWriteError(`resolved_but_still_overdue_since set (${c.company_name})`, flagError.message);
        } else if (!isLate && alreadyFlagged) {
          const { error: clearError } = await supabase.from('late_filing_companies')
            .update({ resolved_but_still_overdue_since: null })
            .eq('id', existing.id);
          if (clearError) noteWriteError(`resolved_but_still_overdue_since clear (${c.company_name})`, clearError.message);
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
          if (dueError) noteWriteError(`next_agm_due_date refresh (${c.company_name})`, dueError.message);
        }
      }

      if (!isLate) continue;
      flagged++;

      const reasons: string[] = [];
      if (currentOverdueDays > OVERDUE_THRESHOLD_DAYS) reasons.push(`Overdue ${currentOverdueDays} days`);
      // The reminder staff actually see: this text goes into the Late Filing page's remark AND, through the reconciliation pass, into the
      // AR Reminder row's "⚠ LATE FILING" line and its LATE badge tooltip. (The Dashboard's exception register is Vincent-only.) It must
      // never contain "Overdue N days" (lib/late-filing-categorize.ts reads the first one) or "STRIKE OFF".
      for (const l of leftover) reasons.push(leftoverReminder(l));
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
      // INV-AR-021 (2026-10-10): the mirrored row is the cycle's OWN, by its exact FYE date as TeamWork shows it. This used to guess
      // the cycle from the company's LATEST FYE month and the due date ("FYE = 9 months before the due date"), which labelled the
      // row with the wrong month whenever the outstanding cycle's month was not the latest one — BEAUTY ASSET's "October 2025" (#867)
      // and MAPLE GROVE's "June 2021" (#866) are such rows. A cycle whose FYE cell is unreadable is not mirrored.
      if (outstandingDue && earliestOverdueFyeIso) {
        const fyeYear = Number(earliestOverdueFyeIso.slice(0, 4));
        const fyeMonthFull = FULL_MONTH_NAMES[Number(earliestOverdueFyeIso.slice(5, 7)) - 1];
        const fyeDateIso = earliestOverdueFyeIso;
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
            if (noteError) noteWriteError(`ar_reminder marker note (${c.company_name})`, noteError.message); else arNoted++;
          }
        } else if ((uenKey && arKeyExists.has(`uen:${uenKey}|${cycleKey}`)) || arKeyExists.has(`name:${normalize(c.company_name)}|${cycleKey}`)) {
          // A row for this exact cycle already exists but wasn't picked up
          // by arByKey above — the only way that happens is it's sitting
          // Excluded (terminated). Inserting a second row for the same
          // (entity_name, fye_month, fye_year) would violate
          // ar_reminder_entity_month_year_uniq every time; skip it rather
          // than retry-and-fail forever.
          arInsertsSkippedExcluded++;
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
            // INV-AR-021 (8): the company's TeamWork PIC (as AR Generate gives it). Without one the row is on nobody's My Tasks.
            pic: companySecretaryPic(c) || null,
            updated_by_email: 'system:late-filing',
            updated_by_name: 'Late Filing Sync',
          }).select('id').single();
          if (insertError) noteWriteError(`ar_reminder insert (${c.company_name})`, insertError.message); else { arInserted++; mirroredArReminderId = insertedAr?.id ?? null; }
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
          if (error) noteWriteError(`late_filing_companies refresh (${c.company_name})`, error.message);
          else refreshed++;
        }
        continue;
      }

      const { error } = await supabase.from('late_filing_companies').insert(values);
      if (error) noteWriteError(`late_filing_companies insert (${c.company_name})`, error.message);
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
          if (noteError) noteWriteError(`ar_reminder marker note, legacy (${m.company_name})`, noteError.message); else arNoted++;
        }
      } else if ((uenKey && arKeyExists.has(`uen:${uenKey}|${cycleKey}`)) || arKeyExists.has(`name:${normalize(m.company_name)}|${cycleKey}`)) {
        // Same guard as the main loop above — this is the exact pattern that
        // was failing every single day (confirmed live, 2026-10-04): 5
        // already-struck-off companies (hence reaching THIS legacy loop, not
        // the main one) each had their only ar_reminder row for this cycle
        // sitting Excluded, so arByKey missed it and the insert below kept
        // violating ar_reminder_entity_month_year_uniq.
        arInsertsSkippedExcluded++;
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
        if (insertError) noteWriteError(`ar_reminder insert, legacy (${m.company_name})`, insertError.message); else { arInserted++; mirroredArReminderId = insertedAr?.id ?? null; }
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
      if (error) noteWriteError(`moved to review (${row.company_name})`, error.message);
      else movedToReview++;
    }

    // Vincent, 2026-09-23: this used to walk FORWARD from late_filing_
    // companies rows (`.not('mirrored_ar_reminder_id', 'is', null)`), which
    // silently skipped two real cases confirmed live — (a) a row marked
    // Resolved whose mirrored_ar_reminder_id was never backfilled (a legacy
    // row, or one Resolved before ever passing through the "currently
    // flagged" branch that sets that column — confirmed: MITRADE GROUP,
    // Resolved on Late Filing since 2026-08-21 but still showing "⚠ LATE
    // FILING: Overdue 1678 days" on AR Reminder to this day), and (b) a
    // marker whose late_filing_companies source row no longer exists at all
    // because the company left the active roster (confirmed: TAFOS CAPITAL
    // F.K.A. LWL EDUCATION CONSULTANCY — companies.tw_status='Terminated',
    // no late_filing_companies row, yet AR Reminder still showed "⚠ LATE
    // FILING: Overdue 2439 days" from before it was terminated). Walking
    // the OTHER direction — every ar_reminder row that currently HAS the
    // marker — can never again depend on a link column staying populated,
    // and doubles as this run's backfill for that same link column (so
    // lib/my-tasks-data.ts's own `.not('mirrored_ar_reminder_id', 'is',
    // null)` staff-task query stops missing the exact same rows).
    //
    // Also implements Vincent's own decision (2026-09-23, in response to
    // this exact bug report): once a company is Terminated/Striking Off —
    // checked against `companies` first, falling back to `master_list`'s
    // own lifecycle category per INV-DATA-030 for the companies TeamWork
    // sync has already removed entirely from the `companies` table — any
    // outstanding LATE FILING marker on it auto-clears. Staff no longer
    // need to manually notice and Resolve a company that's already gone.
    // This only ever touches the auto-written marker LINE; INV-DATA-014's
    // separate, staff-typed TERMINATED/STRIKE OFF exact-match remarks
    // convention is untouched.
    let reconciled = 0;
    let excludedTerminated = 0;

    // Shared termination lookup for both passes below — built once,
    // regardless of whether any marker currently exists, since Step C
    // (excluding a terminated company's AR Reminder rows entirely) must run
    // even for a company whose rows never carried a marker in the first
    // place (e.g. a fresh cycle AR Generate inserted before the company
    // later terminated).
    //
    // Since 2026-09-28 (INV-AR-017) "is this company terminated" is answered
    // ONLY by lib/company-lifecycle.ts's buildLifecycleIndex() — the one shared
    // rule (explicit non-Active TeamWork status; blank/unknown is NEVER
    // terminated; several rows for one UEN count as terminated only if all of
    // them are; Master List only when no companies row exists). This file used
    // to carry its own copies of that rule, and a copy that drifted
    // (INV-AR-016) hid 14 live clients' AR cycles. Do not re-derive it here.
    const { data: allCompanies, error: allCompaniesError } = await supabase
      .from('companies')
      .select('id, registration_no, company_name, tw_status, pic, sec_pic');
    // A failed read must never be mistaken for "no companies" — with an empty
    // index, the Master List fallback would decide for everyone.
    if (allCompaniesError) throw new Error(`Unable to load companies for the termination check: ${allCompaniesError.message}`);
    // Fallback for companies TeamWork sync already removed from
    // `companies` entirely (INV-DATA-030: "routinely REMOVED ... while
    // master_list keeps its full historical record") — "is this company
    // terminated" must still be answerable from master_list's own
    // lifecycle category in that case, not silently treated as active.
    const { data: terminatedMasterList, error: terminatedMasterListError } = await supabase
      .from('master_list')
      .select('roc_no')
      .in('list_type', [...ENDED_MASTER_LIST_TYPES]);
    if (terminatedMasterListError) throw new Error(`Unable to load Master List lifecycle rows: ${terminatedMasterListError.message}`);
    const lifecycle = buildLifecycleIndex(allCompanies ?? [], (terminatedMasterList ?? []).map(r => r.roc_no as string | null));

    const { data: markedRows, error: markedError } = await supabase
      .from('ar_reminder')
      .select('id, entity_name, uen, remarks, pic, status, company_id')
      .ilike('remarks', `%${LATE_FILING_MARKER}%`);
    if (markedError) noteWriteError('marked ar_reminder rows select', markedError.message);

    // INV-AR-021 (8) — Vincent, 2026-10-10 ("这个可以做"): a marker row with a BLANK Secretary PIC is on nobody's My Tasks (it lists a
    // Late Filing item only for the PIC of the mirrored AR row), so it gets the company's TeamWork PIC — the same value AR Generate
    // gives a new row. Only a blank PIC is ever filled (never one a person typed), never a hidden row or a terminated company's, and
    // if more than MAX_PIC_FILLS_PER_RUN rows would be filled NOTHING is (a bug or a mass change) and the run says so.
    let picFilled = 0;
    const picFillPlan = planMirrorPicFills(
      markedRows ?? [],
      (allCompanies ?? []).map(c => ({ id: c.id as number, company_name: c.company_name as string, registration_no: (c.registration_no as string | null) ?? null, pic: (c.pic as string | null) ?? null, sec_pic: (c.sec_pic as string | null) ?? null })),
      (uen, name) => lifecycle.isTerminated(uen ? String(uen).trim().toUpperCase() : null, name),
    );
    for (const fill of picFillPlan.fills) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const base = supabase.from('ar_reminder')
        .update({ pic: fill.pic, updated_by_email: 'system:late-filing', updated_by_name: 'Late Filing Sync (PIC filled from TeamWork)' })
        .eq('id', fill.rowId);
      // guarded to a row that is STILL blank (a person may have typed one since the read), and counted only when exactly one row changed
      const { data: filled, error: fillError } = await (fill.had === 'null' ? base.is('pic', null) : base.eq('pic', '')).select('id');
      if (fillError) noteWriteError(`marker row PIC fill (${fill.entity})`, fillError.message);
      else if ((filled?.length ?? 0) === 1) picFilled++;
    }

    if (markedRows?.length) {
      // Fresh query, not the byUen/byName maps built at the top of this
      // function before the main loop ran — a company flagged for the
      // FIRST time this very run only exists in late_filing_companies from
      // here on, so reusing the pre-loop snapshot would see no matching row
      // for it and wrongly treat its brand-new marker as an orphan.
      const { data: freshManual } = await supabase
        .from('late_filing_companies')
        .select('id, uen, company_name, remarks, mirrored_ar_reminder_id');
      const freshByUen = new Map((freshManual ?? [])
        .filter(row => row.uen)
        .map(row => [String(row.uen).trim().toUpperCase(), row]));
      const freshByName = new Map((freshManual ?? [])
        .map(row => [row.company_name.toLowerCase(), row]));

      for (const row of markedRows) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        const uenKey = row.uen ? String(row.uen).trim().toUpperCase() : null;
        const isTerminated = lifecycle.isTerminated(uenKey, row.entity_name);

        const lfExisting = (uenKey ? freshByUen.get(uenKey) : undefined) ?? freshByName.get(row.entity_name.toLowerCase());
        const lfRemarks = lfExisting?.remarks ?? '';
        const resolved = /^Resolved:/i.test(lfRemarks);

        // AUTO:/Review: both keep the marker showing — Review means "looks
        // clear but not yet confirmed," so stay cautious and keep it visible
        // until a human actually resolves it (or the company terminates).
        // No matching late_filing_companies row AND not confirmed
        // terminated is an orphan with nothing left to re-derive text from —
        // clear it rather than leave an unexplained, unmaintainable marker.
        const desired = (isTerminated || resolved || !lfExisting) ? null
          : `${LATE_FILING_MARKER} ${lfRemarks.replace(/^(AUTO|Review):\s*/i, '')}`;

        const lines = (row.remarks ?? '').split('\n');
        const hasMarker = lines[0]?.startsWith(LATE_FILING_MARKER);
        const rest = hasMarker ? lines.slice(1) : lines;

        let next: string | null | undefined;
        if (desired === null) {
          if (hasMarker) next = rest.join('\n') || null;
        } else if (!hasMarker || lines[0] !== desired) {
          next = [desired, ...rest].join('\n');
        }

        if (next !== undefined) {
          const { error: reconcileError } = await supabase.from('ar_reminder').update({
            remarks: next,
            updated_by_email: 'system:late-filing',
            updated_by_name: 'Late Filing Sync',
          }).eq('id', row.id);
          if (reconcileError) noteWriteError(`marker reconcile (${row.entity_name})`, reconcileError.message); else reconciled++;
        }

        // Self-heal the link column so it can never again silently stop
        // pointing at this row's real mirror (see this block's own header
        // comment) — independent of whether the marker text itself changed
        // above.
        if (lfExisting && lfExisting.mirrored_ar_reminder_id !== row.id) {
          await supabase.from('late_filing_companies')
            .update({ mirrored_ar_reminder_id: row.id })
            .eq('id', lfExisting.id);
        }
      }
    }

    // Vincent, 2026-09-23, direct follow-up to the INV-AR-013/014 bug
    // report: clearing the marker text isn't enough — "terminated了，就不
    // 可能要做AR了" (once terminated, there's no AR left to do at all), so a
    // Terminated/Striking Off company's AR Reminder rows must not appear on
    // the page AT ALL, not just show up unflagged. `status = 'Excluded'` is
    // the exact same reversible soft-hide the trash-can button on this page
    // already uses (DELETE /api/ar-reminder sets this, and re-adding the
    // same entity/cycle restores it — see that route) — never a hard
    // delete, and every other field on the row (remarks, dates, PIC) is
    // left untouched in case a company is un-terminated later.
    //
    // Scoped to UEN matches only (never the fuzzy normalized-name fallback
    // the marker-reconciliation pass above uses) — a bulk hide is much
    // higher-consequence than clearing a badge's text if it ever matched
    // the wrong company, so this only acts where the match is exact.
    // Confirmed necessary, not just cosmetic: ZJJ FAMILY OFFICE and TAFOS
    // CAPITAL (F.K.A. LWL EDUCATION CONSULTANCY) are both genuinely
    // Terminated yet were still fully visible, dated rows on the AR
    // Reminder tab.
    //
    // Found 2026-09-28 (INV-AR-016): this pass once built its own terminated
    // set that trusted a stale Master List row over a live, Active company —
    // 14 real AR cycles across 11 companies were hidden, XGC SINGAPORE's
    // March 2026 cycle days before its deadline among them. Since INV-AR-017
    // the DECISION comes only from the shared lifecycle index above, and the
    // ACTION is guarded three ways (all rules in lib/company-lifecycle.ts):
    //   1. circuit breaker — more than MAX_AUTO_EXCLUSIONS_PER_RUN rows to
    //      hide in one run hides NOTHING and raises an alert: a mass hide
    //      always needs a person, and the safe failure is "a terminated
    //      company's AR stays visible a little longer";
    //   2. auto-restore — a row THIS pass hid comes back the next run once its
    //      company is no longer terminated; anything a person (or another
    //      process) excluded is never touched;
    //   3. safety net — an Active company whose AR rows are ALL hidden raises
    //      an alert every run, whatever the cause.
    const terminatedUenKeys = lifecycle.terminatedUens();
    let exclusionCandidates: Array<{ id: number; uen: string | null; entity_name: string | null }> = [];
    if (terminatedUenKeys.length) {
      const { data: terminatedArRows, error: terminatedArError } = await supabase
        .from('ar_reminder')
        .select('id, uen, entity_name')
        .in('uen', terminatedUenKeys)
        .or('status.is.null,status.neq.Excluded');
      if (terminatedArError) noteWriteError('terminated ar_reminder rows select', terminatedArError.message);
      exclusionCandidates = terminatedArRows ?? [];
    }
    const exclusionPlan = planArAutoExclusions(exclusionCandidates, lifecycle);
    for (const row of exclusionPlan.toExclude) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const { error: excludeError } = await supabase.from('ar_reminder').update({
        status: 'Excluded',
        updated_by_email: AR_SYSTEM_EXCLUDER,
        updated_by_name: 'Late Filing Sync',
      }).eq('id', row.id);
      if (excludeError) noteWriteError(`terminated exclude (${row.entity_name})`, excludeError.message); else excludedTerminated++;
    }

    // Auto-restore: which pass hid each Excluded row is read from
    // ar_reminder_audit (written by a DB trigger on EVERY update, so it can't
    // be skipped by a code path) — the LATEST transition to 'Excluded' decides.
    // Rows hidden by staff (trash can), by the FYE-correction pass
    // (system:teamwork) or by anything else keep their state.
    let restoredExcluded = 0;
    const { data: excludedRows, error: excludedRowsError } = await supabase
      .from('ar_reminder')
      .select('id, uen, entity_name')
      .eq('status', 'Excluded')
      .not('uen', 'is', null);
    if (excludedRowsError) noteWriteError('excluded ar_reminder rows select', excludedRowsError.message);
    const excludedIds = (excludedRows ?? []).map(r => r.id as number);
    const lastExclusion = new Map<number, { by: string | null; statusBefore: string | null; at: string }>();
    if (excludedIds.length) {
      const transitions = await pageAll(() => supabase.from('ar_reminder_audit')
        .select('id, ar_reminder_id, old_value, changed_by_email, changed_at')
        .in('ar_reminder_id', excludedIds)
        .eq('field_name', 'status')
        .eq('new_value', 'Excluded')) as Array<{ ar_reminder_id: number; old_value: string | null; changed_by_email: string | null; changed_at: string }>;
      for (const t of transitions) {
        const prev = lastExclusion.get(t.ar_reminder_id);
        if (!prev || t.changed_at > prev.at) lastExclusion.set(t.ar_reminder_id, { by: t.changed_by_email, statusBefore: t.old_value, at: t.changed_at });
      }
    }
    const restorePlan = planArAutoRestores((excludedRows ?? []).map(r => ({
      id: r.id as number, uen: r.uen as string | null, entity_name: r.entity_name as string | null,
      lastExclusion: lastExclusion.get(r.id as number) ?? null,
    })), lifecycle);
    for (const r of restorePlan.toRestore) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const { error: restoreError } = await supabase.from('ar_reminder').update({
        status: r.restoreTo,
        updated_by_email: AR_SYSTEM_RESTORER,
        updated_by_name: 'Late Filing Sync (auto-restore)',
      }).eq('id', r.id).eq('status', 'Excluded');
      if (restoreError) noteWriteError(`terminated restore (ar_reminder id ${r.id}, restoreTo=${JSON.stringify(r.restoreTo)})`, restoreError.message); else restoredExcluded++;
    }

    // Safety net — judge the OUTCOME after every change above.
    const arForSafetyNet = await pageAll(() => supabase.from('ar_reminder').select('id, uen, status')) as Array<{ uen: string | null; status: string | null }>;
    const activeWithAllArHidden = findActiveCompaniesWithAllArHidden(allCompanies ?? [], arForSafetyNet);
    await Promise.all([
      replaceAutomationExceptions('late_filing', 'ar_mass_exclusion_blocked', exclusionPlan.blocked
        ? exclusionPlan.candidates.map(r => ({ key: String(r.id), name: r.entity_name ?? null, details: { uen: r.uen, limit: MAX_AUTO_EXCLUSIONS_PER_RUN, candidates: exclusionPlan.candidates.length } }))
        : []),
      replaceAutomationExceptions('late_filing', 'ar_mass_restore_blocked', restorePlan.blocked
        ? restorePlan.candidates.map(r => ({ key: String(r.id), name: r.entity_name ?? null, details: { uen: r.uen, limit: MAX_AUTO_RESTORES_PER_RUN, candidates: restorePlan.candidates.length } }))
        : []),
      replaceAutomationExceptions('late_filing', 'active_company_ar_all_hidden', activeWithAllArHidden.map(c => ({
        key: c.uen, name: c.name, details: { hidden_rows: c.hiddenRows },
      }))),
      // INV-AR-021 (8): more blank-PIC marker rows than the limit would have been filled, so none was (a bug or a mass change).
      replaceAutomationExceptions('late_filing', 'pic_fill_blocked', picFillPlan.blocked
        ? [{ key: 'pic-fill', name: 'Late Filing PIC fill', details: { would_fill: picFillPlan.wouldFill, limit: MAX_PIC_FILLS_PER_RUN, message: `The Late Filing sync would have filled the Secretary PIC of ${picFillPlan.wouldFill} AR rows in one run (limit ${MAX_PIC_FILLS_PER_RUN}), so it filled NONE. Check lib/late-filing-pic.ts and the companies' PICs in TeamWork.` } }]
        : []),
      // INV-AR-021 (7): the leftover-cycle rule matched too many companies for one run, so it ignored none (see leftoverTripped above).
      replaceAutomationExceptions('late_filing', 'leftover_rule_tripped', leftoverTripped
        ? [{ key: 'leftover-rule', name: 'Leftover TeamWork cycles', details: { companies: leftoverAll.size, limit: MAX_LEFTOVER_COMPANIES_PER_RUN, message: `The rule for TeamWork leftover cycles matched ${leftoverAll.size} companies in one run (limit ${MAX_LEFTOVER_COMPANIES_PER_RUN}), so tonight it ignored NONE of them. Check TeamWork for a mass data change, or the rule in lib/ar-fye-resolve.ts findLeftoverCycles.` } }]
        : []),
    ]);

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
      excludedTerminated,
      // INV-AR-017 — reversible hiding, circuit breakers, safety net.
      restoredExcluded,
      exclusionBlocked: exclusionPlan.blocked ? exclusionPlan.candidates.length : 0,
      restoreBlocked: restorePlan.blocked ? restorePlan.candidates.length : 0,
      activeCompaniesWithAllArHidden: activeWithAllArHidden.length,
      // INV-AR-021 (7): companies whose leftover TeamWork cycle was ignored tonight (empty when the rule tripped).
      leftoverCycles: [...leftoverByCompany.entries()].map(([id, list]) => ({ companyId: id, fye: list.map(l => l.fyeIso) })),
      leftoverRuleTripped: leftoverTripped,
      // INV-AR-021 (8): blank Secretary PICs of marker rows filled from TeamWork (so My Tasks can list them).
      picFilled,
      picFillWouldFill: picFillPlan.wouldFill,
      picFillSkipped: picFillPlan.skipped.length,
      picFillBlocked: picFillPlan.blocked,
      insertedNames,
      ar_reminder_rows_inserted: arInserted,
      ar_reminder_rows_noted: arNoted,
      ar_reminder_inserts_skipped_excluded: arInsertsSkippedExcluded,
      eot_inserted: eotInserted,
      eot_refreshed: eotRefreshed,
      eot_errors: eotErrors,
      errors,
      fetchErrors,
      writeErrors,
    };
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    clearTimeout(deadline);
  }
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'late_filing', syncLateFiling);
}
