import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getSessionCookie } from '@/lib/teamwork-agm';
import { fetchCompanyProfiles } from '@/lib/teamwork-company-profile';
import { withAutomationRun } from '@/lib/automation-sync';
import { logFieldChange } from '@/lib/audit-log';

/**
 * Active Client "Secretary" auto-sync — rotating batch, not a full sweep.
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

  const { results, errors } = await fetchCompanyProfiles(cookie, [...acRowByInternalId.keys()]);

  const now = new Date().toISOString();
  let updated = 0, unchanged = 0, updateErrors = 0;
  for (let i = 0; i < results.length; i += 10) {
    const batchResults = await Promise.all(results.slice(i, i + 10).map(async profile => {
      const acRow = acRowByInternalId.get(profile.companyId);
      if (!acRow) return 'skip' as const;
      const newSecretary = profile.secretaries.length ? profile.secretaries.join(', ') : null;
      const patch: Record<string, string | null> = { secretary_synced_at: now };
      // secretary_synced_at still advances even when manual — otherwise this
      // row would permanently sort first and get re-fetched (for nothing)
      // every single night instead of the rest of the roster taking a turn.
      const isManual = !!(acRow.manual_fields as Record<string, boolean> | null)?.secretary;
      const changed = !isManual && newSecretary !== null && newSecretary !== acRow.secretary;
      if (changed) patch.secretary = newSecretary;
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
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'teamwork_secretary', () => syncSecretaries(req), 10);
}
