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
 * Also fills Master List's Active Client "Last AGM Date"/"Last AR Date"
 * columns (master_list.last_agm_date/last_ar_date) — a DIFFERENT, always-
 * automated pair from ar_reminder's date_of_agm/filling_date above, which
 * stay staff-editable (Vincent: Active Client's columns should be the fully
 * automated source of truth; AR Reminder's stay manual, and any drift
 * between the two shows as a mismatch badge — see app/api/master-list's
 * GET). Reuses the same per-company TeamWork event fetch already done for
 * the ar_reminder pass above rather than a second scrape: for each company,
 * the LATEST AGM "Held Date" and LATEST AR "Filing Date" across its whole
 * history (not scoped to one FYE cycle, since Active Client has no cycle
 * dimension) is written to the matching Active Client row, keyed by UEN.
 *
 * Cron: 20:00 UTC / SGT 04:00 daily (after the 19:00 UTC generator so new
 * rows sync same-day; the whole nightly chain targets finishing by SGT
 * 05:00, before business hours — see vercel.json).
 * Manual: GET /api/ar-reminder/sync-workflow?month=April&year=2026 (one cycle).
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

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
    .select('id, company_name, internal_id, registration_no')
    .not('internal_id', 'is', null);

  // entity_name → TeamWork company_id. Fuzzy matching is allowed only when
  // there is one unique best candidate; ties are sent to the exception count.
  const companyCandidates = companies ?? [];
  const internalByCompanyId = new Map(companyCandidates.map(company => [company.id, company.internal_id as string]));

  // TeamWork company_id -> UEN, so the per-company event fetch below can also
  // patch the matching Active Client row (master_list keys its own rows by
  // UEN, not TeamWork's internal_id).
  const uenByInternalId = new Map<string, string>();
  for (const company of companyCandidates) {
    if (company.internal_id && company.registration_no) {
      uenByInternalId.set(company.internal_id as string, String(company.registration_no).trim().toUpperCase());
    }
  }
  const { data: activeClientRows } = await supabase
    .from('master_list')
    .select('id, roc_no, last_agm_date, last_ar_date')
    .eq('list_type', 'active_client');
  const activeClientByUen = new Map<string, { id: number; last_agm_date: string | null; last_ar_date: string | null }>();
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

  const cookie = await getSessionCookie();

  let updated = 0, checked = 0, fetchErrors = 0, updateErrors = 0, conflicts = 0;
  let activeClientUpdated = 0, activeClientErrors = 0;
  const changes: { entity: string; patch: Record<string, string> }[] = [];

  for (const [companyId, companyRows] of byCompany) {
    checked++;
    let result: { data: string[][] } = { data: [] };
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          result = await fetchAgmList(cookie, companyId);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
      }
      if (lastError) throw lastError;
    } catch {
      fetchErrors++;
      continue;
    }

    // Active Client's Last AGM/AR Date — the latest event of each type across
    // this company's WHOLE history (not scoped to one ar_reminder row's FYE
    // cycle, unlike the per-row patch below), always overwritten with
    // whatever TeamWork currently shows since this column is meant to be
    // fully automated, not staff-editable.
    const uen = uenByInternalId.get(companyId);
    if (uen) {
      const acRow = activeClientByUen.get(uen);
      if (acRow) {
        let latestAgmHeld: string | null = null;
        let latestArFiled: string | null = null;
        for (const ev of result.data ?? []) {
          const [event, , , , , heldRaw, filingRaw] = ev;
          if (event === 'AGM') {
            const held = toIsoDate(parseDmy(heldRaw));
            if (held && (!latestAgmHeld || held > latestAgmHeld)) latestAgmHeld = held;
          } else if (event === 'AR') {
            const filing = toIsoDate(parseDmy(filingRaw));
            if (filing && (!latestArFiled || filing > latestArFiled)) latestArFiled = filing;
          }
        }
        const acPatch: Record<string, string> = {};
        if (latestAgmHeld && latestAgmHeld !== acRow.last_agm_date) acPatch.last_agm_date = latestAgmHeld;
        if (latestArFiled && latestArFiled !== acRow.last_ar_date) acPatch.last_ar_date = latestArFiled;
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
                oldValue: field === 'last_agm_date' ? acRow.last_agm_date : acRow.last_ar_date,
                newValue: value, changedBy: 'system:teamwork',
              });
            }
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

  const result = {
    ok: fetchErrors === 0 && updateErrors === 0 && activeClientErrors === 0,
    rows: rows.length,
    companies_checked: checked,
    unmatched_names: unmatched,
    ambiguous_names: ambiguous,
    fetch_errors: fetchErrors,
    update_errors: updateErrors,
    version_conflicts: conflicts,
    updated,
    active_client_last_dates_updated: activeClientUpdated,
    active_client_errors: activeClientErrors,
    changes: changes.slice(0, 30),
  };
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ar_workflow', () => syncArWorkflow(req));
}
