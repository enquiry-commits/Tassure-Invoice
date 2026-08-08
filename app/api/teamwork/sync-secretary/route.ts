import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getSessionCookie } from '@/lib/teamwork-agm';
import { fetchCompanyProfilesFull, inferIdType } from '@/lib/teamwork-company-profile';
import { withAutomationRun } from '@/lib/automation-sync';
import { logFieldChange } from '@/lib/audit-log';

/**
 * Active Client "Secretary" auto-sync — rotating batch, not a full sweep.
 * ALSO writes the full officials list and shareholder share register to
 * teamwork_company_officials/teamwork_shareholder_shares for every company
 * fetched this run (added 2026-08-09, per Vincent: "这些可以做每天更新吗？
 * ...可以记录在数据库，更方便调用在post incorp") — reuses this route's
 * existing per-company profile fetch rather than hitting TeamWork a second
 * time for the same page, since Post Incorporate's UEN lookup only needs
 * Director/Shareholder data, not a live fetch on every request.
 *
 * TeamWork's per-company profile page (view_company/<id>/?comp) has the real
 * Secretary appointment (its bulk company API does not — company_secretary_
 * staff came back empty for every company checked). But that page is slow
 * and TeamWork throttles it at a roughly fixed total throughput regardless
 * of concurrency (measured 2026-08-06: ~500ms/company whether concurrency is
 * 5, 10, or 20) — all ~900+ Active Client companies in one run would take
 * ~450s, over Vercel's 300s cap. A one-time full backfill ran locally
 * (bypassing that cap, same pattern as the FYE-month backfill); this route
 * processes a bounded batch per run, oldest-checked-first via
 * master_list.secretary_synced_at (NULLS FIRST), so the whole roster cycles
 * through over a few nights rather than needing to fit in one invocation.
 *
 * Cron: 18:45 UTC / SGT 02:45 daily (between teamwork/sync at 18:30 and
 * ar-reminder/generate at 19:00).
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const BATCH_SIZE = 250;

async function syncSecretaries(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '', 10) || BATCH_SIZE, 900);

  const supabase = createAdminClient();

  const { data: acRows, error: acError } = await supabase
    .from('master_list')
    .select('id, roc_no, secretary, secretary_synced_at, manual_fields')
    .eq('list_type', 'active_client')
    .not('roc_no', 'is', null)
    .order('secretary_synced_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (acError) return NextResponse.json({ error: acError.message }, { status: 500 });
  if (!acRows?.length) return NextResponse.json({ ok: true, checked: 0, updated: 0 });

  const { data: companies } = await supabase
    .from('companies')
    .select('internal_id, registration_no')
    .not('internal_id', 'is', null)
    .not('registration_no', 'is', null);
  const internalIdByUen = new Map((companies ?? []).map(c => [String(c.registration_no).trim().toUpperCase(), c.internal_id as string]));

  const acRowByInternalId = new Map<string, typeof acRows[number]>();
  let noTeamworkMatch = 0;
  for (const row of acRows) {
    const internalId = internalIdByUen.get(String(row.roc_no).trim().toUpperCase());
    if (!internalId) { noTeamworkMatch++; continue; }
    acRowByInternalId.set(internalId, row);
  }

  let cookie: string;
  try {
    cookie = await getSessionCookie();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }

  const { results, errors } = await fetchCompanyProfilesFull(cookie, [...acRowByInternalId.keys()]);

  const now = new Date().toISOString();

  // Officials + share register: wholesale replace per company (delete then
  // insert), so each company's rows are always a full, current snapshot as
  // of this sync, not a partial merge with whatever was there before.
  const uenByInternalId = new Map((companies ?? []).map(c => [c.internal_id as string, String(c.registration_no).trim().toUpperCase()]));
  const fetchedInternalIds = results.map(p => p.companyId);
  if (fetchedInternalIds.length) {
    await supabase.from('teamwork_company_officials').delete().in('internal_id', fetchedInternalIds);
    await supabase.from('teamwork_shareholder_shares').delete().in('internal_id', fetchedInternalIds);
    const officialRows = results.flatMap(p => p.officials
      .filter(o => o.name)
      .map(o => ({
        internal_id: p.companyId, uen: uenByInternalId.get(p.companyId) ?? null,
        name: o.name, role: o.role, id_no: o.idNo, id_type: o.idNo ? inferIdType(o.idNo) : null,
        address: o.address, date_of_appointment: o.dateOfAppointment, synced_at: now,
      })));
    const shareRows = results.flatMap(p => p.shareholderShares
      .filter(s => s.name)
      .map(s => ({
        internal_id: p.companyId, uen: uenByInternalId.get(p.companyId) ?? null,
        shareholder_name: s.name, issued_share_capital: s.issuedShareCapital, paid_up_capital: s.paidUpCapital,
        consideration_paid_up_capital: s.considerationPaidUpCapital, number_of_shares: s.numberOfShares,
        currency: s.currency, share_type: s.shareType, share_class: s.shareClass, synced_at: now,
      })));
    for (let i = 0; i < officialRows.length; i += 500) {
      await supabase.from('teamwork_company_officials').insert(officialRows.slice(i, i + 500));
    }
    for (let i = 0; i < shareRows.length; i += 500) {
      await supabase.from('teamwork_shareholder_shares').insert(shareRows.slice(i, i + 500));
    }
  }

  let updated = 0, unchanged = 0, updateErrors = 0;
  for (let i = 0; i < results.length; i += 10) {
    const batchResults = await Promise.all(results.slice(i, i + 10).map(async profile => {
      const acRow = acRowByInternalId.get(profile.companyId);
      if (!acRow) return 'skip' as const;
      const newSecretary = profile.secretaries.length ? profile.secretaries.join(', ') : null;
      const patch: Record<string, string | boolean | null> = { secretary_synced_at: now };
      // secretary_synced_at still advances even when manual — otherwise this
      // row would permanently sort first and get re-fetched (for nothing)
      // every single night instead of the rest of the roster taking a turn.
      const isManual = !!(acRow.manual_fields as Record<string, boolean> | null)?.secretary;
      const changed = !isManual && newSecretary !== null && newSecretary !== acRow.secretary;
      if (changed) {
        patch.secretary = newSecretary;
        // The checkbox next to Secretary is purely a "does this cell have
        // content" indicator for staff to scan the table (Vincent: "有内容
        // 就需要打勾...那个打勾只是为了让我方便辨认那些是有内容的") — it has
        // no automation of its own, so it must be driven here every time
        // this route actually writes a real name, or it silently drifts out
        // of sync with the text the moment automation (not a staff click)
        // is what puts a name in the cell.
        patch.secretary_active = true;
      }
      const { error: updErr } = await supabase.from('master_list').update(patch).eq('id', acRow.id);
      if (updErr) return 'error' as const;
      if (changed) {
        await logFieldChange(supabase, {
          tableName: 'master_list', rowId: acRow.id, field: 'secretary',
          oldValue: acRow.secretary, newValue: newSecretary, changedBy: 'system:teamwork',
        });
      }
      return changed ? 'updated' as const : 'unchanged' as const;
    }));
    for (const r of batchResults) {
      if (r === 'updated') updated++;
      else if (r === 'unchanged') unchanged++;
      else if (r === 'error') updateErrors++;
    }
  }

  // Rows that errored out on the fetch (not the DB write) still get their
  // secretary_synced_at bumped, otherwise a company TeamWork can't currently
  // serve would permanently sort first and starve the rest of the rotation.
  const erroredIds = errors.map(e => acRowByInternalId.get(e.companyId)?.id).filter((id): id is number => id != null);
  if (erroredIds.length) {
    await supabase.from('master_list').update({ secretary_synced_at: now }).in('id', erroredIds);
  }

  return NextResponse.json({
    ok: true,
    checked: acRows.length,
    no_teamwork_match: noTeamworkMatch,
    fetched: results.length,
    fetch_errors: errors.length,
    updated,
    unchanged,
    update_errors: updateErrors,
    officials_synced: results.reduce((n, p) => n + p.officials.filter(o => o.name).length, 0),
    shareholders_synced: results.reduce((n, p) => n + p.shareholderShares.filter(s => s.name).length, 0),
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'teamwork_secretary', () => syncSecretaries(req), 10);
}
