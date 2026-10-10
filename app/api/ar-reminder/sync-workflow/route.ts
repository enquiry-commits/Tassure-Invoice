import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { restoreFyeExcludedRows, newRestoreBudget, type Slot } from '@/lib/ar-fye-restore';
import { parseDmy, parseLatestDmy, toIsoDate, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { withAutomationRun, replaceAutomationExceptions } from '@/lib/automation-sync';
import { logFieldChange } from '@/lib/audit-log';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { loadCarriedForwardPics } from '@/lib/pic-sync';
import { toDateStr, addMonths } from '@/lib/date';
import { isTeamworkActiveCompany } from '@/lib/company-lifecycle';
import { MONTHS as FYE_MONTHS, assessFye, findLeftoverCycles, leftoverExceptionMessage, parseTwCycles, type BadCell, type LeftoverCycle, type SuspectCycle } from '@/lib/ar-fye-resolve';
import { loadManualFyeByUen, effectiveFyeForCompany, type ManualFyeEntry } from '@/lib/ar-fye-manual';
import { planCompanyAr, type PlanRow } from '@/lib/ar-cycle-plan';
import { executeArPlans, emptyOutcome, type PlanItem, type PlanOutcome } from '@/lib/ar-plan-apply';

/**
 * Daily AR-workflow sync: fill ar_reminder rows' AGM/filing dates from
 * TeamWork's per-company event history (company_agm/agm_list_ajax — the same
 * authoritative source the late-filing detector uses).
 *
 * Why: the AR Filed / In Progress / Overdue stats were computed from workflow
 * date fields that had NO live data source — staff track the real workflow in
 * TeamWork, so the fields here stayed frozen at whatever a one-off import
 * captured. This cron makes the stats real.
 *
 * Field mapping per (company, FYE cycle):
 *   AR  event → filling_date (Filing Date), due_date (Due Date)
 *   AGM event → agm_held_date (Held Date), date_of_agm (Held Date, if empty),
 *               reminder_note (Reminder dates — AGM-only in TeamWork's own
 *               feed, AR events always leave it blank)
 *
 * Write rules (consistent with the other syncs):
 *   - TeamWork is the source of truth for date_of_agm/filling_date/
 *     reminder_note UNTIL a human edits that cell directly (tracked via
 *     date_of_agm_manual/filling_date_manual/reminder_note_manual, set by
 *     the PATCH handler in ../route.ts) — a manual value is never
 *     overwritten by this sync. Clearing the cell
 *     (PATCH with an empty value) unsets the manual flag, handing control
 *     back to automation on the next run.
 *   - agm_held_date (the internal "AGM was held" progress signal, distinct
 *     from the user-facing date_of_agm column) always mirrors TeamWork.
 *   - Reconciles in BOTH directions, not just fill-forward: when this run
 *     finds the matching same-cycle TeamWork event, that event's own
 *     Held/Filing field is authoritative — present writes the date, blank
 *     clears any previously-synced (non-manual) value back to null. Root
 *     cause found 2026-08-13 (KANG HUA CONSTRUCTION, reported by Vincent as
 *     Master List's AGM/AR columns looking "放错了"): a Held/Filing date
 *     got synced in from a real TeamWork event, TeamWork's own entry was
 *     later corrected back to blank (a mis-keyed date on the wrong FYE
 *     cycle), but the old fill-forward-only logic never re-checked — the
 *     stale value sat in ar_reminder forever with no manual flag to explain
 *     it, showing a false AGM/AR mismatch badge on Master List AND making
 *     billing/page.tsx's workflow stages think that cycle's AGM/AR was
 *     already done. Only clears when a same-cycle event was actually found
 *     this run (never guesses a clear from a fetch that matched nothing).
 *   - prepared/sent/received dates are NOT in this feed and stay manual.
 *
 * Also corrects companies.fye_month when it's stale. Root cause found
 * 2026-08-05: companies.fye_month is synced from TeamWork's getCompanies
 * API field `fye_date` (app/api/teamwork/sync/route.ts) — but that field
 * doesn't reliably update when a company's FYE changes; verified live
 * against TeamWork's API that it can sit stale for years after the actual
 * AGM/AR cycles (and TeamWork's own "List of Companies" UI) have already
 * moved on. The real current FYE is the FYE month of this company's most
 * recent AGM/AR cycle in its own event history — the exact same per-
 * company fetch already done below for the Active Client dates, so no
 * extra TeamWork call. Takes the event with the latest FYE date across
 * the whole history (never the first one in the list — a company that
 * changed FYE has OLDER cycles under its old month still sitting earlier
 * in the history).
 *
 * Whenever this correction actually changes companies.fye_month, it also
 * excludes (soft-deletes, same reversible status the manual delete button
 * uses) any of that company's still-pending (filling_date empty)
 * ar_reminder rows left under the OLD month — those rows are immutable
 * snapshots /generate created before the correction and nothing else ever
 * revisits them, so without this a company shows up under BOTH its old and
 * new FYE month at once (the stale row never disappears, and /generate's
 * daily run creates a fresh row under the new month since it only checks
 * for an existing row in that SAME month, not any other). Already-filed
 * rows under the old month are real history and are never touched. Caught
 * directly by Vincent from a real company that had already self-corrected
 * JUN→DEC but still showed under JUN too: "明明DEC才是最新的，JUN不应该再
 * 出现了."
 *
 * Whenever fye_month actually changes, ALSO checks (2026-08-27) for a
 * genuinely still-open OLDER cycle under the new month that isn't covered
 * by any live ar_reminder row, and backfills it if found — closing a
 * related, narrower version of the gap /generate's own catch-up pass has:
 * that pass only ever runs for a company with ZERO rows under its current
 * fye_month, so once /generate's plain forward-window loop creates a row
 * for this company's upcoming cycle under the newly-corrected month (now,
 * or on an earlier run), that pass will never look at this company again —
 * even if an older cycle under that same month was never itself resolved.
 * Confirmed real: 20 companies found this way in December 2025 alone, all
 * sharing this exact shape (found via a one-off manual audit script, not
 * this mechanism — see /generate's own docstring for that full story and
 * the 20-company backfill it describes). Deliberately scoped to fire ONLY
 * at the moment fye_month changes, not as a standing daily check across
 * every company — Vincent, 2026-08-27: a full daily re-scan would cover
 * most companies most of the time (897 eligible system-wide; the December
 * sample alone had 359/369 with only a future row), which risked this
 * route's own time budget for no ongoing benefit once the historical
 * backlog is cleared. "Is this cycle open" uses the SAME cross-referenced
 * AGM+AR grouping /generate's own catch-up now uses (its own docstring
 * has the full story of the mistake that fix corrects) — reuses
 * result.data, this company's TeamWork history already fetched this same
 * iteration for the work above, so no extra TeamWork call. Wrapped in its
 * own try/catch so a failure here can never block the FYE
 * correction/stale-row-exclusion work above it, which has already
 * succeeded by the time this runs.
 *
 * Also fills Master List's Active Client "Last AGM Date"/"Last AR Date"/
 * "Last Accts Date"/"Next AGM Due" columns (master_list.last_agm_date/
 * last_ar_date/last_accounts_date/next_agm_due_date) — a DIFFERENT, always-
 * automated set from ar_reminder's date_of_agm/filling_date above, which
 * stay staff-editable (Vincent: Active Client's columns should be the fully
 * automated source of truth; AR Reminder's stay manual, and any drift
 * between the two shows as a mismatch badge — see app/api/master-list's
 * GET). Reuses the same per-company TeamWork event fetch already done for
 * the ar_reminder pass above rather than a second scrape: for each company,
 * the LATEST AGM "Held Date" and LATEST AR "Filing Date" across its whole
 * history (not scoped to one FYE cycle, since Active Client has no cycle
 * dimension) is written to the matching Active Client row, keyed by UEN.
 * Last Accts Date is the FYE Date of that same latest-filed AR row (not
 * just the newest FYE on file); Next AGM Due is the Due Date of the
 * nearest not-yet-held AGM event.
 *
 * Cron: 20:00 UTC / SGT 04:00 daily (after the 19:00 UTC generator so new
 * rows sync same-day; the whole nightly chain targets finishing by SGT
 * 05:00, before business hours — see vercel.json).
 * Manual: GET /api/ar-reminder/sync-workflow?month=April&year=2026 (one cycle).
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Stop our own work before Vercel's 300-second hard limit so the run can be
// marked failed and its lock can always be released — same pattern as
// late-filing/sync's WORK_DEADLINE_MS. Added 2026-08-06 after this route got
// stuck at "running" for 2+ days straight (Vercel's hard kill never lets a
// function reach its own cleanup code, so the lease sat until it naturally
// expired, and every scheduled run after that hit "Another run already owns
// the automation lease" or "Previous run lease expired" — meanwhile
// teamwork/sync's fye_month write (unprotected, always-overwrite) kept
// running every night with nothing to correct it back, quietly reopening
// the FYE Mismatch bug this route exists to fix).
// 270s, not late-filing/sync's 230s: this route runs one company at a time
// (no worker-pool concurrency), and its last known-good run (2026-08-04)
// took 244s — already past 230s. 270s leaves 30s margin to Vercel's 300s
// hard cap while actually fitting the real workload; confirmed by re-
// running after this change (see PROJECT_STATUS.md).
const WORK_DEADLINE_MS = 270_000;

// INV-AR-021 — the nightly STATE-BASED plan (lib/ar-cycle-plan.ts): every night, for every active company, compare TeamWork's
// open cycles with the company's AR rows and fix what differs (restore a row the system hid, insert a missing one, hide a ghost),
// instead of correcting only at the moment fye_month changes. It ships in SHADOW mode: the plan is computed and recorded in this
// run's summary (`ar_plan`) but changes nothing; one night's result is read, then this constant is flipped to true. When true the
// edge-triggered "hide every unfiled old-month row" + "backfill the earliest open cycle" blocks below are skipped — the plan
// replaces them (it keeps a real overdue cycle of the old month, which the old block hid).
const AR_PLAN_APPLY = false;
// How many example lines of each plan list go into the run summary (the counts are always complete).
const PLAN_SUMMARY_EXAMPLES = 25;

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('AR workflow sync was cancelled.');
}

interface ArRow {
  id: number; company_id: number | null; entity_name: string; fye_month: string; fye_year: number;
  fye_date: string | null; due_date: string | null;
  date_of_agm: string | null; agm_held_date: string | null; filling_date: string | null;
  date_of_agm_manual: boolean; filling_date_manual: boolean;
  reminder_note: string | null; reminder_note_manual: boolean;
  status: string | null; version: number;
}

// TeamWork's per-company AGM/AR event row carries a "Reminder dates" column
// (company_agm/agm_list_ajax's 8th field, index 7) only on AGM-type events —
// AR events always leave it blank (confirmed against a real TeamWork
// screenshot, Vincent 2026-08-13). Can hold more than one dd/mm/yyyy date
// (HTML <br>-joined); the Reminder column here is a single value, so the
// latest one wins, matching how every other "pick the real current value"
// field in this route already behaves.
function latestReminderIso(raw: string | undefined): string | null {
  if (!raw) return null;
  let latest: string | null = null;
  for (const part of raw.split(/<br\s*\/?>/i)) {
    const iso = toIsoDate(parseDmy(part));
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  return latest;
}

async function syncArWorkflow(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const onlyMonth = searchParams.get('month');
  const onlyYear = searchParams.get('year');

  let q = supabase
    .from('ar_reminder')
    .select('id, company_id, entity_name, fye_month, fye_year, fye_date, due_date, date_of_agm, agm_held_date, filling_date, date_of_agm_manual, filling_date_manual, reminder_note, reminder_note_manual, status, version')
    .or('status.is.null,status.neq.Excluded');
  if (onlyMonth) q = q.eq('fye_month', onlyMonth);
  if (onlyYear)  q = q.eq('fye_year', parseInt(onlyYear, 10));
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ ok: true, rows: 0, updated: 0 });
  // A run limited to one cycle (?month=&year=) sees only part of the rows: it must not plan, or every other row would look missing.
  const fullRun = !onlyMonth && !onlyYear;

  const { data: companies } = await supabase
    .from('companies')
    .select('id, company_name, internal_id, registration_no, fye_month, pic, sec_pic, is_active, tw_status')
    .not('internal_id', 'is', null);

  // entity_name → TeamWork company_id. Fuzzy matching is allowed only when
  // there is one unique best candidate; ties are sent to the exception count.
  const companyCandidates = companies ?? [];
  const internalByCompanyId = new Map(companyCandidates.map(company => [company.id, company.internal_id as string]));
  // Full company record by companies.id — the FYE-correction catch-up below
  // (2026-08-27) needs pic/sec_pic/registration_no to build a complete new
  // ar_reminder row, which companyByInternalId's own {id, fye_month} pair
  // doesn't carry.
  const companyById = new Map(companyCandidates.map(company => [company.id, company]));
  // Same carry-forward suggestion /generate's own catch-up pass uses for a
  // freshly-inserted row's acc_pic/tax_pic — loaded once here, not per
  // company, for the same reason /generate loads it once.
  const { accFor, taxFor } = await loadCarriedForwardPics(supabase);

  // TeamWork company_id -> UEN, so the per-company event fetch below can also
  // patch the matching Active Client row (master_list keys its own rows by
  // UEN, not TeamWork's internal_id).
  const uenByInternalId = new Map<string, string>();
  // TeamWork company_id -> {companies.id, fye_month}, so the per-company
  // event fetch below can also correct companies.fye_month — see the FYE
  // Mismatch fix further down.
  const companyByInternalId = new Map<string, { id: number; fye_month: string | null }>();
  for (const company of companyCandidates) {
    if (company.internal_id && company.registration_no) {
      uenByInternalId.set(company.internal_id as string, String(company.registration_no).trim().toUpperCase());
    }
    if (company.internal_id) {
      companyByInternalId.set(company.internal_id as string, { id: company.id, fye_month: company.fye_month });
    }
  }
  const { data: activeClientRows } = await supabase
    .from('master_list')
    .select('id, roc_no, last_agm_date, last_ar_date, last_accounts_date, next_agm_due_date, manual_fields')
    .eq('list_type', 'active_client');
  const activeClientByUen = new Map<string, {
    id: number; last_agm_date: string | null; last_ar_date: string | null;
    last_accounts_date: string | null; next_agm_due_date: string | null;
    manual_fields: Record<string, boolean> | null;
  }>();
  for (const row of activeClientRows ?? []) {
    if (!row.roc_no) continue;
    activeClientByUen.set(String(row.roc_no).trim().toUpperCase(), row);
  }
  // INV-AR-021 inputs, read once per run: which Master List FYEs staff typed by hand (they win over TeamWork's month), and the
  // rows the system or a person hid (the plan must see them to restore instead of colliding with their unique key). If any of this
  // cannot be read the plan is simply not made tonight — it never plans on partial information.
  let manualByUen = new Map<string, ManualFyeEntry>();
  const excludedByCompany = new Map<number, PlanRow[]>();
  const excludedByName = new Map<string, PlanRow[]>();
  let planInputError: string | null = null;
  if (fullRun) {
    try {
      manualByUen = await loadManualFyeByUen(supabase);
      const { data: excluded, error: excludedError } = await supabase.from('ar_reminder')
        .select('id, company_id, entity_name, fye_month, fye_year, fye_date, status, filling_date, agm_held_date')
        .eq('status', 'Excluded');
      if (excludedError) throw new Error(excludedError.message);
      for (const r of (excluded ?? []) as PlanRow[]) {
        if (r.company_id != null) (excludedByCompany.get(r.company_id) ?? excludedByCompany.set(r.company_id, []).get(r.company_id)!).push(r);
        const nameKey = r.entity_name.trim().toUpperCase();
        (excludedByName.get(nameKey) ?? excludedByName.set(nameKey, []).get(nameKey)!).push(r);
      }
    } catch (e) {
      planInputError = e instanceof Error ? e.message : String(e);
    }
  }
  const planEnabled = fullRun && !planInputError;

  const idOf = (companyId: number | null, name: string): { id: string | null; ambiguous: boolean } => {
    if (companyId && internalByCompanyId.has(companyId)) return { id: internalByCompanyId.get(companyId)!, ambiguous: false };
    const direct = companyCandidates.filter(company => normalize(company.company_name) === normalize(name));
    if (direct.length === 1) return { id: direct[0].internal_id as string, ambiguous: false };
    if (direct.length > 1) return { id: null, ambiguous: true };
    const match = findUniqueBestMatch(name, companyCandidates, company => company.company_name);
    return { id: match.value?.internal_id as string ?? null, ambiguous: match.ambiguous };
  };

  // Group rows by company so each company is fetched once.
  const byCompany = new Map<string, ArRow[]>();
  let unmatched = 0, ambiguous = 0;
  for (const r of rows as ArRow[]) {
    const match = idOf(r.company_id, r.entity_name);
    if (!match.id) {
      if (match.ambiguous) ambiguous++;
      else unmatched++;
      continue;
    }
    const id = match.id;
    if (!byCompany.has(id)) byCompany.set(id, []);
    byCompany.get(id)!.push(r);
  }

  // The Active Client date sync and FYE Month correction below both key off
  // `companyId`/`companyByInternalId`, independent of whether there's any
  // ar_reminder row at all — but until now they only ever ran for companies
  // that DID have one, because that's the only way a company entered this
  // loop. A company with zero ar_reminder rows (e.g. newly onboarded, or
  // never generated a cycle) silently never got its fye_month re-checked,
  // no matter how many times this sync ran successfully (caught 2026-08-06:
  // BYTESFORCE INTERNATIONAL PTE. LTD. sat wrong for days because it has no
  // ar_reminder rows at all). Add every remaining company with a TeamWork
  // internal_id with an empty row list — the ar_reminder-specific patch
  // loop at the bottom is already a no-op for an empty array, so this only
  // extends the Active Client/FYE coverage, changing nothing else.
  let extraCompaniesAdded = 0;
  for (const company of companyCandidates) {
    if (!company.internal_id) continue;
    const id = company.internal_id as string;
    if (byCompany.has(id)) continue;
    byCompany.set(id, []);
    extraCompaniesAdded++;
  }

  const cookie = await getSessionCookie();

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(
      `AR workflow sync stopped safely before the Vercel timeout because TeamWork did not finish within ${WORK_DEADLINE_MS / 1000} seconds.`,
    ));
  }, WORK_DEADLINE_MS);

  try {
  let updated = 0, checked = 0, fetchErrors = 0, updateErrors = 0, conflicts = 0;
  let activeClientUpdated = 0, activeClientErrors = 0;
  let fyeMonthCorrected = 0, fyeMonthErrors = 0;
  let staleArRowsExcluded = 0, staleArRowsErrors = 0;
  let fyeCorrectionBackfilled = 0, fyeCorrectionBackfillErrors = 0;
  const restoreBudget = newRestoreBudget(); // INV-AR-019: ONE circuit-breaker budget for the whole run (this loop calls once per company)
  const changes: { entity: string; patch: Record<string, string | null> }[] = [];
  // Skipped only when the plan is really being applied tonight (see AR_PLAN_APPLY) — otherwise the old edge-triggered blocks stay.
  const legacyFyeCorrection = !(AR_PLAN_APPLY && planEnabled);
  const fyeSuspects: Array<SuspectCycle & { companyId: number; company: string }> = [];
  const leftoverFound: Array<LeftoverCycle & { companyId: number; company: string }> = [];
  const badCells: Array<BadCell & { companyId: number; company: string }> = [];
  const planItems: PlanItem[] = [];
  const overrideDiffs: Array<{ companyId: number; company: string; masterListMonth: string; teamworkMonth: string | null; by: string | null; at: string | null }> = [];
  const todayIso = new Date().toISOString().slice(0, 10);   // UTC, like /generate's window

  // Concurrency 15 — same proven range as late-filing/sync's worker pool
  // (up to MAX_CONCURRENCY 20) for the exact same fetchAgmList call. This
  // route used to process one company at a time; that took 244s+ even
  // before today's added Active Client/FYE work, leaving no real margin
  // under Vercel's 300s cap (see WORK_DEADLINE_MS above). Raised from the
  // first pass's 10 after extending coverage to every company with a
  // TeamWork internal_id (926) instead of just ones with ar_reminder rows
  // (743) — extra headroom for the larger workload.
  const companyEntries = [...byCompany.entries()];
  const CONCURRENCY = Math.min(15, Math.max(1, companyEntries.length));
  let nextIndex = 0;
  const worker = async () => {
  while (nextIndex < companyEntries.length) {
    if (controller.signal.aborted) throw abortError(controller.signal);
    const [companyId, companyRows] = companyEntries[nextIndex++];
    checked++;
    let result: { data: string[][] } = { data: [] };
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        try {
          result = await fetchAgmList(cookie, companyId, controller.signal);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
      }
      if (lastError) throw lastError;
    } catch {
      if (controller.signal.aborted) throw abortError(controller.signal);
      fetchErrors++;
      continue;
    }

    // Active Client's Last AGM/AR/Accounts Date and Next AGM Due Date — the
    // latest/next event of each type across this company's WHOLE history (not
    // scoped to one ar_reminder row's FYE cycle, unlike the per-row patch
    // below), always overwritten with whatever TeamWork currently shows since
    // these columns are meant to be fully automated, not staff-editable.
    //
    // Field mapping confirmed against a real TeamWork AGM/AR history screenshot
    // (Vincent, 2026-08-06): Last Accounts Date is the FYE Date on the SAME AR
    // row as the latest filing (not just the newest FYE date on file — that
    // could belong to a future, not-yet-filed cycle); Next AGM Due Date is the
    // Due Date of the nearest not-yet-held AGM (the soonest deadline, so a
    // company with more than one overdue year still gets the most urgent one).
    // INV-AR-021 (7): cycles TeamWork left behind that cannot be real (lib/ar-fye-resolve.ts findLeftoverCycles — the ONE definition;
    // ORBITEZ's AGM for FYE 30/06/2025 with no AR event inside its filed Dec 2024 -> Dec 2025 year) are skipped by FYE date wherever
    // this iteration derives "what is outstanding": Master List's Next AGM Due, the FYE-change backfill, the nightly plan. Vincent:
    // "ORBITEZ 就按照最新的跑，但是可以有一个提醒在系统" — the reminder is the exception raised below and the Late Filing remark.
    const leftoverCycles = findLeftoverCycles(parseTwCycles(result.data ?? []).cycles);
    const leftoverFyes = new Set(leftoverCycles.map(l => l.fyeIso));

    const uen = uenByInternalId.get(companyId);
    if (uen) {
      const acRow = activeClientByUen.get(uen);
      if (acRow) {
        let latestAgmHeld: string | null = null;
        let latestHeldAgmFye: string | null = null;
        let latestArFiled: string | null = null;
        let latestArFiledFye: string | null = null;
        const unheldAgmCandidates: { fyeDate: string; due: string }[] = [];
        for (const ev of result.data ?? []) {
          const [event, , fyeRaw, , dueRaw, heldRaw, filingRaw] = ev;
          if (event === 'AGM') {
            const held = toIsoDate(parseDmy(heldRaw));
            const fyeDate = toIsoDate(parseDmy(fyeRaw));
            if (held) {
              if (!latestAgmHeld || held > latestAgmHeld) latestAgmHeld = held;
              if (fyeDate && (!latestHeldAgmFye || fyeDate > latestHeldAgmFye)) latestHeldAgmFye = fyeDate;
            } else {
              // parseLatestDmy: an EOT renders this raw field as
              // "<strike>ORIGINAL</strike> <br> REVISED" — see
              // lib/teamwork-agm.ts's own comment (2026-08-28).
              const due = toIsoDate(parseLatestDmy(dueRaw));
              if (due && fyeDate && !leftoverFyes.has(fyeDate)) unheldAgmCandidates.push({ fyeDate, due });
            }
          } else if (event === 'AR') {
            const filing = toIsoDate(parseDmy(filingRaw));
            if (filing && (!latestArFiled || filing > latestArFiled)) {
              latestArFiled = filing;
              latestArFiledFye = toIsoDate(parseDmy(fyeRaw));
            }
          }
        }
        // Next AGM Due: the earliest still-open cycle — but only among
        // cycles not already superseded by a later one confirmed held.
        // TeamWork's own historical data sometimes leaves an OLD AGM's Held
        // Date blank even though every cycle since has a real held date
        // (confirmed live: GERITO TECHNOLOGY's 2018 and 2021 AGM rows both
        // have a blank Held Date despite 2022-2025 all being properly held
        // — a legacy TeamWork data-entry gap, not a real open item).
        // Naively taking the global-earliest unheld due date picks up that
        // ancient gap (reported "next due" 2019 for a company whose AGMs
        // are current through 2026) instead of the real next cycle. Only
        // count an unheld cycle if its own FYE date is after the latest
        // cycle actually confirmed held — Vincent caught this from the
        // Active Client table: "至少33家是读错的...你读取最上方的日期，不
        // 是读取最新的."
        let nextAgmDue: string | null = null;
        for (const c of unheldAgmCandidates) {
          if (latestHeldAgmFye && c.fyeDate <= latestHeldAgmFye) continue;
          if (!nextAgmDue || c.due < nextAgmDue) nextAgmDue = c.due;
        }
        // A field flagged manual in master_list.manual_fields was edited by
        // staff directly on this row — skip it here so this sync never
        // fights that edit; clearing the cell back to empty removes the
        // flag (see app/api/master-list's PATCH) and lets it resume here.
        const manual = acRow.manual_fields ?? {};
        const acPatch: Record<string, string> = {};
        if (latestAgmHeld && latestAgmHeld !== acRow.last_agm_date && !manual.last_agm_date) acPatch.last_agm_date = latestAgmHeld;
        if (latestArFiled && latestArFiled !== acRow.last_ar_date && !manual.last_ar_date) acPatch.last_ar_date = latestArFiled;
        if (latestArFiledFye && latestArFiledFye !== acRow.last_accounts_date && !manual.last_accounts_date) acPatch.last_accounts_date = latestArFiledFye;
        if (nextAgmDue && nextAgmDue !== acRow.next_agm_due_date && !manual.next_agm_due_date) acPatch.next_agm_due_date = nextAgmDue;
        if (Object.keys(acPatch).length) {
          const { error: acErr } = await supabase.from('master_list')
            .update({ ...acPatch, updated_at: new Date().toISOString() })
            .eq('id', acRow.id);
          if (acErr) activeClientErrors++;
          else {
            activeClientUpdated++;
            for (const [field, value] of Object.entries(acPatch)) {
              await logFieldChange(supabase, {
                tableName: 'master_list', rowId: acRow.id, field,
                oldValue: acRow[field as keyof typeof acRow] as string | null,
                newValue: value, changedBy: 'system:teamwork',
              });
            }
          }
        }
      }
    }

    // FYE Month correction — see docstring above. Takes the FYE date of the
    // most recent cycle (highest date, any event type) in this company's
    // whole event history, never the first one — a company that changed
    // FYE partway through has older cycles under its old month sitting
    // earlier in the history, exactly what was silently trusted before.
    const companyInfo = companyByInternalId.get(companyId);
    if (companyInfo) {
      // INV-AR-021: the month TeamWork implies is that of the company's LATEST cycle — unless that cycle is a keying slip
      // (BEAUTY ASSET: 01/10/2027 typed for 30/09/2027 flipped the FYE to October four times in August and each flip hid its
      // real September row). Dates are read strictly: 31/09 is unreadable, not 1 October. A company whose TeamWork history gave
      // no readable cycle keeps its month — an empty answer is never a change.
      const twParsed = parseTwCycles(result.data ?? []);
      const fyeAssessment = assessFye(twParsed.cycles);
      const companyLabel = companyById.get(companyInfo.id)?.company_name ?? String(companyInfo.id);
      for (const s of fyeAssessment.suspects) fyeSuspects.push({ companyId: companyInfo.id, company: companyLabel, ...s });
      for (const l of leftoverCycles) leftoverFound.push({ companyId: companyInfo.id, company: companyLabel, ...l });
      for (const b of twParsed.bad) badCells.push({ companyId: companyInfo.id, company: companyLabel, ...b });
      const latestFyeMonthIdx: number | null = fyeAssessment.month ? FYE_MONTHS.indexOf(fyeAssessment.month as typeof FYE_MONTHS[number]) : null;
      if (latestFyeMonthIdx !== null && latestFyeMonthIdx >= 0) {
        const correctMonth = MONTH_NAMES[latestFyeMonthIdx];
        if (correctMonth !== companyInfo.fye_month) {
          const { error: fyeErr } = await supabase.from('companies')
            .update({ fye_month: correctMonth })
            .eq('id', companyInfo.id);
          if (fyeErr) fyeMonthErrors++;
          else {
            fyeMonthCorrected++;
            await logFieldChange(supabase, {
              tableName: 'companies', rowId: companyInfo.id, field: 'fye_month',
              oldValue: companyInfo.fye_month, newValue: correctMonth, changedBy: 'system:teamwork-agm-history',
            });

            // ar_reminder rows are immutable snapshots — nothing else ever
            // touches a row's OWN fye_month once /generate creates it, so a
            // row generated under the OLD month before this correction just
            // sits there forever. Meanwhile /generate's window keeps running
            // daily and, seeing no row yet under the NEW (correct) month,
            // creates a fresh one — leaving the same company visible under
            // BOTH months at once. Caught by Vincent directly, from a real
            // company that had already self-corrected JUN→DEC but still
            // showed under JUN too: "明明DEC才是最新的，JUN不应该再出现了."
            // Exclude (soft-delete, same reversible status the manual
            // delete button already uses) only rows still genuinely
            // pending under the stale month — a row that's already been
            // filed (filling_date set) is real history, not a phantom
            // future cycle, and must never be touched here.
            // (skipped once the state-based plan is applied — it hides ghosts nightly and keeps a real overdue cycle of the old month)
            const { data: staleRows, error: staleErr } = !legacyFyeCorrection ? { data: null, error: null } : await supabase
              .from('ar_reminder')
              .update({ status: 'Excluded', updated_by_email: 'system:teamwork', updated_by_name: 'TeamWork Sync (FYE corrected)' })
              .eq('company_id', companyInfo.id)
              .eq('fye_month', companyInfo.fye_month)
              .is('filling_date', null)
              .or('status.is.null,status.neq.Excluded')
              .select('id, fye_year');
            if (staleErr) staleArRowsErrors++;
            else if (staleRows?.length) {
              staleArRowsExcluded += staleRows.length;
              for (const row of staleRows) {
                await logFieldChange(supabase, {
                  tableName: 'ar_reminder', rowId: row.id, field: 'status',
                  oldValue: null, newValue: 'Excluded', changedBy: 'system:teamwork-agm-history',
                });
              }
            }

            // New 2026-08-27, closing a related gap Vincent found: once
            // /generate's plain forward-window loop creates (now, or on an
            // earlier run) a row for this company's CURRENT/upcoming cycle
            // under correctMonth, /generate's OWN catch-up pass will never
            // look at this company again — that pass only ever fires for a
            // company with ZERO rows under its current fye_month, and this
            // one now has (or is about to have) exactly one. Meanwhile an
            // OLDER, genuinely still-open cycle under correctMonth — one
            // TeamWork shows as never held/filed, that predates this
            // correction — would sit invisible forever. Confirmed real: 20
            // companies found this way in December 2025 alone, all sharing
            // this exact shape (see /generate's own docstring for the full
            // story and the manual sweep that closed that specific batch).
            // This closes the same class of gap right when it can first
            // arise — the moment fye_month actually changes — instead of
            // requiring another manual sweep later. Reuses result.data
            // (this company's TeamWork history), already fetched this
            // iteration — no extra TeamWork call.
            // (skipped once the state-based plan is applied: it wants every open cycle nightly, not only at the moment of a change)
            if (legacyFyeCorrection) try {
              // Same cross-referenced "is this cycle open" grouping
              // /generate's own catch-up now uses (2026-08-27 fix, after
              // the wrong conclusion it used to reach reading an AGM or AR
              // event's own two columns in isolation — see SCIENCE IN
              // SPORT SINGAPORE in that file's docstring): open only if
              // NEITHER the AGM nor the AR event for a cycle shows a
              // held/filing date.
              const openCycles = new Map<string, { yearLabel: string; agmDone: boolean; arDone: boolean }>();
              for (const ev of result.data ?? []) {
                const [ev0, ev1, ev2, , , ev5, ev6] = ev;
                if (ev0 !== 'AGM' && ev0 !== 'AR') continue;
                const evFyeIso = toIsoDate(parseDmy(ev2));
                if (!evFyeIso || leftoverFyes.has(evFyeIso)) continue;
                if (!openCycles.has(evFyeIso)) openCycles.set(evFyeIso, { yearLabel: ev1, agmDone: false, arDone: false });
                const evDone = !!(toIsoDate(parseDmy(ev5)) || toIsoDate(parseDmy(ev6)));
                const g = openCycles.get(evFyeIso)!;
                if (ev0 === 'AGM') g.agmDone = g.agmDone || evDone; else g.arDone = g.arDone || evDone;
              }

              // Fresh, targeted query — NOT companyRows (this run's own
              // OWN ar_reminder fetch at the top, scoped to whatever
              // ?month=/&year= this specific call used, which could
              // silently miss a live row under correctMonth if this run
              // wasn't scoped to it) — correct regardless of how this
              // route was invoked.
              const { data: liveUnderNewMonth, error: liveErr } = await supabase
                .from('ar_reminder')
                .select('fye_year')
                .eq('company_id', companyInfo.id)
                .eq('fye_month', correctMonth)
                .or('status.is.null,status.neq.Excluded');
              if (liveErr) {
                fyeCorrectionBackfillErrors++;
              } else {
                const coveredYears = new Set((liveUnderNewMonth ?? []).map(r => r.fye_year));
                let openYearLabel: string | null = null;
                let openFyeIso: string | null = null;
                for (const [fyeIso, g] of openCycles) {
                  if (g.agmDone || g.arDone) continue; // already completed
                  if (coveredYears.has(Number(g.yearLabel))) continue; // some row already tracks this one
                  if (!openFyeIso || fyeIso < openFyeIso) { openYearLabel = g.yearLabel; openFyeIso = fyeIso; }
                }
                if (openYearLabel && openFyeIso) {
                  const fullCompany = companyById.get(companyInfo.id);
                  // Same source as companyByInternalId, so this should
                  // always resolve — guarded anyway (an if/else, not an
                  // early return: this whole block runs inside a while
                  // loop processing many companies, and a bare return here
                  // would abort the rest of THIS WORKER'S queue, not just
                  // skip this one company) rather than ever inserting a
                  // row with a blank entity_name.
                  if (!fullCompany) {
                    fyeCorrectionBackfillErrors++;
                  } else {
                    // The FYE just came BACK to this month: the system's own earlier exclusion may hold this exact
                    // slot (the unique key) — restore it instead of failing the insert (INV-AR-019). A person's
                    // exclusion is never overridden; it counts as an error here and is reported by the nightly run.
                    const slot: Slot = { entity_name: fullCompany.company_name as string, fye_month: correctMonth as string, fye_year: Number(openYearLabel), fye_date: openFyeIso, company_id: companyInfo.id };
                    let restoredHere: Awaited<ReturnType<typeof restoreFyeExcludedRows>> | null = null;
                    try {
                      restoredHere = await restoreFyeExcludedRows(supabase, [slot], restoreBudget);
                    } catch {
                      fyeCorrectionBackfillErrors++; // fail open: fall through to the plain insert below, exactly as before
                    }
                    const backfillErr = restoredHere && restoredHere.handled.size
                      ? (restoredHere.failed.length || restoredHere.blocked.length ? { message: 'slot held by an Excluded row that was not restored' } : null)
                      : (await supabase.from('ar_reminder').insert({
                      entity_name: fullCompany.company_name,
                      company_id: companyInfo.id,
                      uen: fullCompany.registration_no || '',
                      fye_month: correctMonth,
                      fye_year: Number(openYearLabel),
                      fye_date: openFyeIso,
                      due_date: toDateStr(addMonths(new Date(`${openFyeIso}T00:00:00Z`), 7)),
                      pic: resolveTeamworkPic(fullCompany.sec_pic ?? fullCompany.pic ?? null),
                      acc_pic: accFor(companyInfo.id, fullCompany.registration_no ?? null),
                      tax_pic: taxFor(companyInfo.id, fullCompany.registration_no ?? null),
                      acc_pic_manual: false,
                      tax_pic_manual: false,
                      status: 'Pending',
                    })).error;
                    if (backfillErr) fyeCorrectionBackfillErrors++;
                    else fyeCorrectionBackfilled++;
                  }
                }
              }
            } catch {
              // Never let this new, narrower catch-up block the FYE
              // correction and stale-row-exclusion work above it, which
              // already succeeded by this point — just count it and move on.
              fyeCorrectionBackfillErrors++;
            }
          }
        }

        // Active Client's own FYE column was mirrored here per an earlier
        // request ("CODE / EMAIL / FYE(FYE MONTH) 都要做自动化处理") — Vincent
        // later reversed that specifically for FYE: keep it staff-editable,
        // stop auto-correcting it, but leave whatever automation had already
        // written in place ("之前自动化的数据保留，只是以后不需要自动化"). CODE
        // and EMAIL automation are unaffected; only this FYE mirror was
        // removed. See also AUTO_SYNCED_FIELDS/LIVE_COMPARISON_FIELDS in
        // app/api/master-list/route.ts and AUTO_SYNCED_FIELDS_UI in
        // components/MasterListTable.tsx, where 'fye' was removed to match.
      }

      // INV-AR-021: tonight's state-based plan for this company. Pure — nothing is written here; executeArPlans runs after the
      // loop. Skipped for a company that is not on the active corporate-secretarial roster (a terminated client gets no rows).
      const planCompany = companyById.get(companyInfo.id);
      if (planEnabled && planCompany && isTeamworkActiveCompany(planCompany)) {
        const eff = effectiveFyeForCompany(planCompany, manualByUen, fyeAssessment.month);
        if (eff.effective) {
          const name = planCompany.company_name as string;
          const rowsOfCompany: PlanRow[] = [
            ...(companyRows as PlanRow[]),
            ...(excludedByCompany.get(companyInfo.id) ?? []),
            ...(excludedByName.get(name.trim().toUpperCase()) ?? []).filter(r => r.company_id == null),
          ];
          planItems.push({
            company: { id: companyInfo.id, name },
            plan: planCompanyAr({
              company: { id: companyInfo.id, name },
              effectiveMonth: eff.effective, teamworkMonth: eff.teamworkMonth,
              cycles: twParsed.cycles, suspectDates: new Set(fyeAssessment.suspects.map(s => s.fyeIso)), leftoverDates: leftoverFyes,
              rows: rowsOfCompany, today: todayIso,
            }),
          });
          const manual = manualByUen.get(String(planCompany.registration_no ?? '').trim().toUpperCase());
          if (eff.differs && manual) overrideDiffs.push({ companyId: companyInfo.id, company: name, masterListMonth: manual.month, teamworkMonth: eff.teamworkMonth, by: manual.by, at: manual.at });
        }
      }
    }

    for (const r of companyRows) {
      // The row's cycle key: exact FYE date if present, else month+year.
      const rowFyeIso = r.fye_date ? String(r.fye_date).slice(0, 10) : null;
      const patch: Record<string, string | null> = {};

      for (const ev of result.data ?? []) {
        const [event, , fyeRaw, , dueRaw, heldRaw, filingRaw, reminderRaw] = ev;
        if (!['AGM', 'AR'].includes(event)) continue;
        const evFye = toIsoDate(parseDmy(fyeRaw));
        if (!evFye) continue;
        const sameCycle = rowFyeIso
          ? evFye === rowFyeIso
          : evFye.slice(0, 7) === `${r.fye_year}-${String(new Date(`1 ${r.fye_month} 2000`).getMonth() + 1).padStart(2, '0')}`;
        if (!sameCycle) continue;

        // Reconcile in both directions, not just fill-forward. Root cause
        // (KANG HUA CONSTRUCTION, found 2026-08-13): a Held/Filing date can
        // get written here from a real TeamWork event, then TeamWork's own
        // entry is later corrected back to blank (e.g. staff had mis-keyed
        // a date onto the wrong FYE cycle) — but the old fill-forward-only
        // logic below never re-checked, so the stale value sat in our DB
        // forever with no manual flag to explain it, silently mismatching
        // Active Client's real values AND making billing/page.tsx think the
        // AGM/AR for that cycle was already done when it wasn't. Since we
        // found a matching same-cycle event this run, its own held/filing
        // field (blank or not) is now authoritative for this pass — clear
        // a previously-synced value the same way a new one gets written.
        if (event === 'AR') {
          const filing = toIsoDate(parseDmy(filingRaw));
          // parseLatestDmy: an EOT renders this raw field as
          // "<strike>ORIGINAL</strike> <br> REVISED" — see
          // lib/teamwork-agm.ts's own comment (2026-08-28).
          const due = toIsoDate(parseLatestDmy(dueRaw));
          if (!r.filling_date_manual) {
            if (filing && filing !== r.filling_date) patch.filling_date = filing;
            else if (!filing && r.filling_date !== null) patch.filling_date = null;
          }
          if (due && due !== (r.due_date ? String(r.due_date).slice(0, 10) : null)) patch.due_date = due;
        } else { // AGM
          const held = toIsoDate(parseDmy(heldRaw));
          if (held) {
            if (held !== (r.agm_held_date ? String(r.agm_held_date).slice(0, 10) : null)) patch.agm_held_date = held;
            if (!r.date_of_agm_manual && held !== r.date_of_agm) patch.date_of_agm = held;
          } else {
            if (r.agm_held_date !== null) patch.agm_held_date = null;
            if (!r.date_of_agm_manual && r.date_of_agm !== null) patch.date_of_agm = null;
          }

          // Reminder column — see latestReminderIso() above (Vincent,
          // 2026-08-13: "AGM-REMINDER DATES... 我要系统自动化去 AR REMINDER
          // 页面中TABLE的REMINDER列"). Same manual/reconcile-both-ways
          // treatment as date_of_agm.
          if (!r.reminder_note_manual) {
            const reminder = latestReminderIso(reminderRaw);
            if (reminder && reminder !== r.reminder_note) patch.reminder_note = reminder;
            else if (!reminder && r.reminder_note !== null) patch.reminder_note = null;
          }
        }
      }

      if (Object.keys(patch).length) {
        const { data: updatedRows, error: upErr } = await supabase.from('ar_reminder').update({
          ...patch,
          updated_by_email: 'system:teamwork',
          updated_by_name: 'TeamWork Sync',
        }).eq('id', r.id).eq('version', r.version).select('id');
        if (upErr) updateErrors++;
        else if (!updatedRows?.length) conflicts++;
        else { updated++; changes.push({ entity: r.entity_name, patch }); }
      }
    }
  }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // INV-AR-021: carry out (shadow: only describe) tonight's plan. A company whose TeamWork fetch failed has no plan item, so it is
  // simply not touched tonight.
  let planOutcome: PlanOutcome = emptyOutcome(AR_PLAN_APPLY ? 'apply' : 'shadow');
  let planError: string | null = planInputError;
  if (planEnabled) {
    try {
      planOutcome = await executeArPlans(supabase, planItems, {
        apply: AR_PLAN_APPLY,
        restoreBudget,
        buildInsert: (companyId, w) => {
          const c = companyById.get(companyId)!;   // planItems only hold companies of this map
          return {
            entity_name: w.slot.entity_name,
            company_id: companyId,
            uen: c.registration_no || '',
            fye_month: w.slot.fye_month,
            fye_year: w.slot.fye_year,
            fye_date: w.slot.fye_date,
            due_date: toDateStr(addMonths(new Date(`${w.slot.fye_date}T00:00:00Z`), 7)),
            pic: resolveTeamworkPic(c.sec_pic ?? c.pic ?? null),
            acc_pic: accFor(companyId, c.registration_no ?? null),
            tax_pic: taxFor(companyId, c.registration_no ?? null),
            acc_pic_manual: false,
            tax_pic_manual: false,
            status: 'Pending',
          };
        },
      });
    } catch (e) {
      planError = e instanceof Error ? e.message : String(e);
    }
  }

  // Things only a person can fix or should know about. A run that missed companies (fetch errors) must not close open ones.
  let exceptionsError: string | null = null;
  try {
    const grace = fetchErrors > 0 ? { graceMs: 400 * 86_400_000 } : {};
    await replaceAutomationExceptions('ar_workflow', 'fye_slip_cycle', fyeSuspects.map(s => ({
      key: `${s.companyId}:${s.fyeIso}`, name: s.company,
      details: { company_id: s.companyId, fye_date: s.fyeIso, kind: s.kind, message: `TeamWork has a cycle dated ${s.fyeIso} that looks like a keying slip. AR ignored it and keeps the company's FYE month. Correct the date in TeamWork. (${s.note})` },
    })), grace);
    // INV-AR-021 (7) — Vincent's reminder for a TeamWork cycle that cannot be real (he reads this register; staff get the Late Filing remark).
    await replaceAutomationExceptions('ar_workflow', 'teamwork_leftover_cycle', leftoverFound.map(l => ({
      key: `${l.companyId}:${l.fyeIso}`, name: l.company,
      details: { company_id: l.companyId, fye_date: l.fyeIso, due_date: l.dueIso, agm_event_id: l.agmEventId, message: leftoverExceptionMessage(l.company, l) },
    })), grace);
    await replaceAutomationExceptions('ar_workflow', 'fye_master_list_differs', overrideDiffs.map(d => ({
      key: String(d.companyId), name: d.company,
      details: { company_id: d.companyId, master_list_fye: d.masterListMonth, teamwork_fye: d.teamworkMonth, edited_by: d.by, edited_at: d.at, message: `AR Reminder follows the FYE month typed in Master List (${d.masterListMonth}), because staff edited it by hand; TeamWork shows ${d.teamworkMonth ?? 'another month'}. Make TeamWork match, or change the Master List FYE.` },
    })), grace);
    await replaceAutomationExceptions('ar_workflow', 'teamwork_bad_date', badCells.map(b => ({
      key: `${b.companyId}:${b.column}:${b.event}:${b.yearLabel}:${b.raw}`.slice(0, 200), name: b.company,
      details: { company_id: b.companyId, column: b.column, event: b.event, year: b.yearLabel, value: b.raw, message: `TeamWork's ${b.event} ${b.yearLabel} row has a ${b.column} date that is not a real calendar date ("${b.raw}"). It was ignored — correct it in TeamWork.` },
    })), grace);
    if (AR_PLAN_APPLY && !planOutcome.tripped) {
      await replaceAutomationExceptions('ar_workflow', 'ar_row_not_restored', planOutcome.blocked.map(b => ({
        key: String(b.id), name: b.company,
        details: { ar_reminder_id: b.id, slot: b.slot, reason: b.why, hidden_by: b.by, message: `TeamWork has this cycle open, but its AR Reminder row (#${b.id}, ${b.slot}) is hidden and was NOT restored automatically (${b.why}). Restore it in AR Reminder if it should be back.` },
      })), grace);
    }
    if (planOutcome.tripped) {
      await replaceAutomationExceptions('ar_workflow', 'ar_plan_tripped', [{
        key: 'plan', name: 'AR nightly plan',
        details: { wanted: planOutcome.wanted, hidden: planOutcome.hidden.length, message: 'Tonight\'s AR plan asked for more changes than the safety limit allows, so NOTHING was applied. Check TeamWork for a mass data change before the next run.' },
      }], grace);
    } else {
      await replaceAutomationExceptions('ar_workflow', 'ar_plan_tripped', [], grace);
    }
  } catch (e) {
    exceptionsError = e instanceof Error ? e.message : String(e);
  }

  const head = <T,>(list: readonly T[]) => list.slice(0, PLAN_SUMMARY_EXAMPLES);
  const result = {
    ok: fetchErrors === 0 && updateErrors === 0 && activeClientErrors === 0 && fyeMonthErrors === 0 && staleArRowsErrors === 0 && fyeCorrectionBackfillErrors === 0
      && (!AR_PLAN_APPLY || (!planError && planOutcome.failed.length === 0)),
    ar_plan: {
      mode: planOutcome.mode, ran: planEnabled, error: planError, tripped: planOutcome.tripped, exceeds_limit: planOutcome.exceedsLimit,
      companies: planOutcome.companies, wanted: planOutcome.wanted, covered: planOutcome.covered,
      restored: planOutcome.restored.length, inserted: planOutcome.inserted.length, hidden: planOutcome.hidden.length,
      blocked: planOutcome.blocked.length, failed: planOutcome.failed.length,
      reports: planOutcome.reports,
      examples: {
        restored: head(planOutcome.restored), inserted: head(planOutcome.inserted), hidden: head(planOutcome.hidden),
        blocked: head(planOutcome.blocked), failed: head(planOutcome.failed),
      },
    },
    teamwork_leftover_cycles: leftoverFound.length,
    teamwork_leftover_examples: head(leftoverFound.map(l => ({ company: l.company, fye_date: l.fyeIso, agm_event_id: l.agmEventId }))),
    fye_slip_cycles: fyeSuspects.length,
    fye_slip_examples: head(fyeSuspects.map(s => ({ company: s.company, fye_date: s.fyeIso, kind: s.kind }))),
    fye_master_list_differs: overrideDiffs.length,
    fye_master_list_examples: head(overrideDiffs),
    teamwork_bad_date_cells: badCells.length,
    teamwork_bad_date_examples: head(badCells.map(b => ({ company: b.company, column: b.column, value: b.raw }))),
    exceptions_error: exceptionsError,
    rows: rows.length,
    companies_checked: checked,
    extra_companies_added: extraCompaniesAdded,
    unmatched_names: unmatched,
    ambiguous_names: ambiguous,
    fetch_errors: fetchErrors,
    update_errors: updateErrors,
    version_conflicts: conflicts,
    updated,
    active_client_last_dates_updated: activeClientUpdated,
    active_client_errors: activeClientErrors,
    fye_month_corrected: fyeMonthCorrected,
    fye_month_errors: fyeMonthErrors,
    stale_ar_rows_excluded: staleArRowsExcluded,
    stale_ar_rows_errors: staleArRowsErrors,
    fye_correction_backfilled: fyeCorrectionBackfilled,
    fye_correction_backfill_errors: fyeCorrectionBackfillErrors,
    changes: changes.slice(0, 30),
  };
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    clearTimeout(deadline);
  }
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ar_workflow', () => syncArWorkflow(req));
}
