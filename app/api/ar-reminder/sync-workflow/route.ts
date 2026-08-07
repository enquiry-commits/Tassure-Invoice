import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, toIsoDate, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { withAutomationRun } from '@/lib/automation-sync';
import { logFieldChange } from '@/lib/audit-log';

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
 *   AGM event → agm_held_date (Held Date), date_of_agm (Held Date, if empty)
 *
 * Write rules (consistent with the other syncs):
 *   - TeamWork is the source of truth for date_of_agm/filling_date UNTIL a
 *     human edits that cell directly (tracked via date_of_agm_manual/
 *     filling_date_manual, set by the PATCH handler in ../route.ts) — a
 *     manual value is never overwritten by this sync. Clearing the cell
 *     (PATCH with an empty value) unsets the manual flag, handing control
 *     back to automation on the next run.
 *   - agm_held_date (the internal "AGM was held" progress signal, distinct
 *     from the user-facing date_of_agm column) always mirrors TeamWork.
 *   - prepared/sent/received dates are NOT in this feed and stay manual.
 *   - Already-filed rows are skipped (filing is terminal).
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
  status: string | null; version: number;
}

async function syncArWorkflow(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const onlyMonth = searchParams.get('month');
  const onlyYear = searchParams.get('year');

  let q = supabase
    .from('ar_reminder')
    .select('id, company_id, entity_name, fye_month, fye_year, fye_date, due_date, date_of_agm, agm_held_date, filling_date, date_of_agm_manual, filling_date_manual, status, version')
    .or('status.is.null,status.neq.Excluded');
  if (onlyMonth) q = q.eq('fye_month', onlyMonth);
  if (onlyYear)  q = q.eq('fye_year', parseInt(onlyYear, 10));
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ ok: true, rows: 0, updated: 0 });

  const { data: companies } = await supabase
    .from('companies')
    .select('id, company_name, internal_id, registration_no, fye_month')
    .not('internal_id', 'is', null);

  // entity_name → TeamWork company_id. Fuzzy matching is allowed only when
  // there is one unique best candidate; ties are sent to the exception count.
  const companyCandidates = companies ?? [];
  const internalByCompanyId = new Map(companyCandidates.map(company => [company.id, company.internal_id as string]));

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
    .select('id, roc_no, last_agm_date, last_ar_date, last_accounts_date, next_agm_due_date, fye, manual_fields')
    .eq('list_type', 'active_client');
  const activeClientByUen = new Map<string, {
    id: number; last_agm_date: string | null; last_ar_date: string | null;
    last_accounts_date: string | null; next_agm_due_date: string | null;
    fye: string | null; manual_fields: Record<string, boolean> | null;
  }>();
  for (const row of activeClientRows ?? []) {
    if (!row.roc_no) continue;
    activeClientByUen.set(String(row.roc_no).trim().toUpperCase(), row);
  }
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
  let activeClientFyeUpdated = 0, activeClientFyeErrors = 0;
  const changes: { entity: string; patch: Record<string, string> }[] = [];

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
    const uen = uenByInternalId.get(companyId);
    if (uen) {
      const acRow = activeClientByUen.get(uen);
      if (acRow) {
        let latestAgmHeld: string | null = null;
        let latestArFiled: string | null = null;
        let latestArFiledFye: string | null = null;
        let nextAgmDue: string | null = null;
        for (const ev of result.data ?? []) {
          const [event, , fyeRaw, , dueRaw, heldRaw, filingRaw] = ev;
          if (event === 'AGM') {
            const held = toIsoDate(parseDmy(heldRaw));
            if (held && (!latestAgmHeld || held > latestAgmHeld)) latestAgmHeld = held;
            if (!held) {
              const due = toIsoDate(parseDmy(dueRaw));
              if (due && (!nextAgmDue || due < nextAgmDue)) nextAgmDue = due;
            }
          } else if (event === 'AR') {
            const filing = toIsoDate(parseDmy(filingRaw));
            if (filing && (!latestArFiled || filing > latestArFiled)) {
              latestArFiled = filing;
              latestArFiledFye = toIsoDate(parseDmy(fyeRaw));
            }
          }
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
      let latestFyeIso: string | null = null;
      let latestFyeMonthIdx: number | null = null;
      for (const ev of result.data ?? []) {
        const evFyeDate = parseDmy(ev[2]);
        const evFyeIso = evFyeDate ? toIsoDate(evFyeDate) : null;
        if (!evFyeDate || !evFyeIso) continue;
        if (!latestFyeIso || evFyeIso > latestFyeIso) {
          latestFyeIso = evFyeIso;
          latestFyeMonthIdx = evFyeDate.getMonth();
        }
      }
      if (latestFyeMonthIdx !== null) {
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
          }
        }

        // Mirror the same (now self-corrected) FYE month onto Active
        // Client's own FYE column — per Vincent: "CODE / EMAIL / FYE(FYE
        // MONTH) 都要做自动化处理". Uses correctMonth if it was just
        // corrected above, else companyInfo.fye_month if already right —
        // either way this is always today's true latest FYE, never stale.
        const fyeAbbr = correctMonth.slice(0, 3).toUpperCase();
        const uenForFye = uenByInternalId.get(companyId);
        const acRowForFye = uenForFye ? activeClientByUen.get(uenForFye) : undefined;
        if (acRowForFye && !acRowForFye.manual_fields?.fye && fyeAbbr !== acRowForFye.fye) {
          const { error: fyeMirrorErr } = await supabase.from('master_list')
            .update({ fye: fyeAbbr, updated_at: new Date().toISOString() })
            .eq('id', acRowForFye.id);
          if (fyeMirrorErr) activeClientFyeErrors++;
          else {
            activeClientFyeUpdated++;
            await logFieldChange(supabase, {
              tableName: 'master_list', rowId: acRowForFye.id, field: 'fye',
              oldValue: acRowForFye.fye, newValue: fyeAbbr, changedBy: 'system:teamwork-agm-history',
            });
          }
        }
      }
    }

    for (const r of companyRows) {
      // The row's cycle key: exact FYE date if present, else month+year.
      const rowFyeIso = r.fye_date ? String(r.fye_date).slice(0, 10) : null;
      const patch: Record<string, string> = {};

      for (const ev of result.data ?? []) {
        const [event, , fyeRaw, , dueRaw, heldRaw, filingRaw] = ev;
        if (!['AGM', 'AR'].includes(event)) continue;
        const evFye = toIsoDate(parseDmy(fyeRaw));
        if (!evFye) continue;
        const sameCycle = rowFyeIso
          ? evFye === rowFyeIso
          : evFye.slice(0, 7) === `${r.fye_year}-${String(new Date(`1 ${r.fye_month} 2000`).getMonth() + 1).padStart(2, '0')}`;
        if (!sameCycle) continue;

        if (event === 'AR') {
          const filing = toIsoDate(parseDmy(filingRaw));
          const due = toIsoDate(parseDmy(dueRaw));
          if (filing && !r.filling_date_manual && filing !== r.filling_date) patch.filling_date = filing;
          if (due && due !== (r.due_date ? String(r.due_date).slice(0, 10) : null)) patch.due_date = due;
        } else { // AGM
          const held = toIsoDate(parseDmy(heldRaw));
          if (held) {
            if (held !== (r.agm_held_date ? String(r.agm_held_date).slice(0, 10) : null)) patch.agm_held_date = held;
            if (!r.date_of_agm_manual && held !== r.date_of_agm) patch.date_of_agm = held;
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

  const result = {
    ok: fetchErrors === 0 && updateErrors === 0 && activeClientErrors === 0 && fyeMonthErrors === 0 && activeClientFyeErrors === 0,
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
    active_client_fye_updated: activeClientFyeUpdated,
    active_client_fye_errors: activeClientFyeErrors,
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
