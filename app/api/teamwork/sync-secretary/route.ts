import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getSessionCookie } from '@/lib/teamwork-agm';
import { fetchCompanyProfilesFull, inferIdType } from '@/lib/teamwork-company-profile';
import { withAutomationRun } from '@/lib/automation-sync';
import { logFieldChange } from '@/lib/audit-log';

/**
 * Active Client "Secretary" auto-sync — three runs per day now cover every
 * company within the same day, not a multi-night rotation. ALSO writes the
 * full officials list and shareholder share register to teamwork_company_
 * officials/teamwork_shareholder_shares for every company fetched this run
 * (added 2026-08-09, per Vincent: "这些可以做每天更新吗？...可以记录在数据库，
 * 更方便调用在post incorp") — reuses this route's existing per-company
 * profile fetch rather than hitting TeamWork a second time for the same
 * page, since Post Incorporate's UEN lookup only needs Director/Shareholder
 * data, not a live fetch on every request.
 *
 * TeamWork's per-company profile page (view_company/<id>/?comp) has the real
 * Secretary appointment (its bulk company API does not — company_secretary_
 * staff came back empty for every company checked). But that page is slow
 * and TeamWork throttles it at a roughly fixed total throughput regardless
 * of concurrency (measured 2026-08-06: ~500ms/company whether concurrency is
 * 5, 10, or 20) — ~783 current Active Client companies take ~390s to fetch
 * alone. This originally meant capping each run at 250 companies and
 * rotating oldest-first over several nights, but that left Post
 * Incorporate's per-person data up to several days stale — a real problem
 * Vincent flagged directly: "我要的是每一天都能分批轮完，但是一天内要轮完全部
 * 公司，不是一天只轮250家，这样数据就很难同步了." First tried removing the
 * batch cap entirely and raising maxDuration, reasoning Fluid Compute
 * (confirmed enabled via the project API, resourceConfig.fluid: true) would
 * cover a single ~390s run — wrong: the actual plan is Hobby, which hard-
 * caps maxDuration at 300 regardless of Fluid Compute (confirmed by a real
 * failed deployment: "Serverless Functions must have a maxDuration between 1
 * and 300 for plan hobby"). A single run genuinely cannot fit all ~783
 * companies under that ceiling, so instead: three cron-triggered runs per
 * day (originally 18:45, 22:45, 02:45 UTC; the first moved to 15:00 UTC on
 * 2026-08-31 — a real collision was found with teamwork/sync (Companies)
 * and teamwork/sync-nd both also sitting in hour 18, see
 * docs/INVARIANTS.md INV-CRON-013 — still comfortably within Singapore's
 * overnight-into-morning window, each run well-separated from the others),
 * each comfortably within 300s, together covering the full roster with
 * real headroom for it to keep growing.
 *
 * This run now ALSO fetches TeamWork's own Shares module (shares/
 * share_list/<id> — the real, current share register; see lib/teamwork-
 * company-profile.ts's fetchShareRegister for why the profile page's own
 * "Shareholders Information" table turned out to be a stale source) per
 * company, in parallel with the existing profile-page fetch rather than
 * after it, so the added latency costs roughly max(profile, shares), not
 * their sum. Measured end-to-end through the real fetchCompanyProfileFull
 * (not just the shares request alone): ~750-800ms/company sequentially —
 * higher than the ~500ms profile-only baseline, since this also includes
 * officials/officerDetails HTML parsing on top of two parallel network
 * calls. That number is NOT a measurement of real 10-worker concurrent
 * throughput under production load (only sequential single-company
 * timing) — TeamWork's own server-side throttling behavior for this new
 * endpoint at full concurrency hasn't been observed yet, unlike the
 * profile page's (measured 2026-08-06: ~500ms/company fixed regardless of
 * concurrency 5/10/20). BATCH_SIZE below is deliberately conservative
 * given that uncertainty; check automation_sync_runs' actual duration
 * after the first few real nightly runs and tighten or loosen from there
 * rather than trusting this estimate indefinitely.
 *
 * Cron: 15:00, 22:45, and 02:45 UTC / SGT 23:00, 06:45, and 10:45 daily.
 *
 * Also writes SSIC (added 2026-09-03, per Vincent, after confirming
 * director/shareholder data was already being captured this same way and
 * asking for the same treatment: "这个SSIC也可以加到 360里面") — the company
 * profile page's "Principal Activities" table (lib/teamwork-company-
 * profile.ts's extractSsic, verified against real HTML from 3 live
 * companies before writing, not guessed from a screenshot), written
 * straight onto companies.ssic_code_1/description_1/remarks_1 (and _2 for
 * the optional second activity) — plain scalar fields, not a side table
 * like officials/shares, since it's a handful of fixed columns per
 * company. Same page visit already being fetched for Secretary/Officials/
 * Shareholders — no new TeamWork request, no new cron.
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// ~280 companies * ~800ms (conservative, real end-to-end measurement, not
// the optimistic parallel-fetch estimate) ≈ 224s, leaving real margin
// under the 300s Hobby-plan ceiling for login + DB writes even if
// concurrent-load throughput turns out worse than sequential timing
// suggested. Three runs/night at this size (840 total) still comfortably
// cover the current ~783-company roster with real headroom to grow.
const BATCH_SIZE = 280;

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
    .select('id, internal_id, registration_no')
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
  const companyIdByInternalId = new Map((companies ?? []).map(c => [c.internal_id as string, c.id as number]));
  const fetchedInternalIds = results.map(p => p.companyId);
  if (fetchedInternalIds.length) {
    await supabase.from('teamwork_company_officials').delete().in('internal_id', fetchedInternalIds);
    await supabase.from('teamwork_shareholder_shares').delete().in('internal_id', fetchedInternalIds);
    const officialRows = results.flatMap(p => {
      // officerDetails (the rich per-person cards) has no shared row key with
      // officials (the plain summary table) other than name — join on that,
      // same as every other name-based match already used across this file.
      const detailByName = new Map(p.officerDetails.map(d => [d.name.trim().toUpperCase(), d]));
      const fromOfficialsTable = p.officials
        .filter(o => o.name)
        .map(o => {
          const detail = detailByName.get(o.name.trim().toUpperCase());
          return {
            internal_id: p.companyId, uen: uenByInternalId.get(p.companyId) ?? null,
            name: o.name, role: o.role, id_no: o.idNo, id_type: o.idNo ? inferIdType(o.idNo) : null,
            address: o.address, date_of_appointment: o.dateOfAppointment, synced_at: now,
            dob: detail?.dob || null, email: detail?.email || null, mobile: detail?.mobile || null,
            telephone: detail?.telephone || null,
            sub_roles: detail?.roles.length ? detail.roles.map(r => r.role).join(', ') : null,
          };
        });
      // Individual shareholders never appear on the plain "Active Officials"
      // summary table above — confirmed 2026-08-06 it has no Shareholder
      // role or share-count column at all — but DO have their own rich
      // detail card under the Shareholders tab specifically (cardType
      // "Individual", distinct from "IndividualDirector"), already scraped
      // by extractOfficerDetails and, until now, simply discarded rather
      // than persisted — real dob/email/mobile TeamWork has on file getting
      // thrown away. Caught with real evidence, not assumed: Vincent's own
      // screenshot of a shareholder's full TeamWork card (D.O.B/Individual
      // Email/Individual Mobile No # all populated) next to the system
      // showing nothing for that same person ("你检测到的结果和我在TW直接看到
      // 的结果完全不同"). Corporate shareholder cards ("Corporate
      // Shareholders" cardType) use an entirely different field set (Reg.No,
      // no D.O.B/nationality/personal email — it's a company, not a person)
      // that extractOfficerDetails doesn't parse at all yet; out of scope
      // here, individual shareholders only.
      const individualShareholders = p.officerDetails
        .filter(d => d.cardType === 'Individual' && d.name)
        .map(d => ({
          internal_id: p.companyId, uen: uenByInternalId.get(p.companyId) ?? null,
          name: d.name, role: 'Shareholder', id_no: d.idNo, id_type: d.idNo ? inferIdType(d.idNo) : null,
          address: d.address, date_of_appointment: d.dateOfAppointment, synced_at: now,
          dob: d.dob || null, email: d.email || null, mobile: d.mobile || null,
          telephone: d.telephone || null,
          sub_roles: d.roles.length ? d.roles.map(r => r.role).join(', ') : null,
        }));
      return [...fromOfficialsTable, ...individualShareholders];
    });
    // p.shareholderShares now comes from TeamWork's own Shares module
    // (fetchShareRegister) — the current, accurate register, not the
    // company profile page's "Shareholders Information" table this used
    // to read (confirmed stale 2026-08-11: showed people/numbers that
    // don't match the real register at all for a real test company).
    // share_type/share_class aren't available from this source at all
    // (nothing to map them from) — left null rather than carrying over
    // the old source's now-untrustworthy values.
    const shareRows = results.flatMap(p => p.shareholderShares
      .filter(s => s.name)
      .map(s => ({
        internal_id: p.companyId, uen: uenByInternalId.get(p.companyId) ?? null,
        shareholder_name: s.name, issued_share_capital: s.issuedShareCapital, paid_up_capital: s.paidUpCapital,
        consideration_paid_up_capital: s.paidUpCapital, number_of_shares: s.numberOfShares,
        currency: s.currency, share_type: null, share_class: null,
        share_certificate_no: s.shareCertificateNo || null, synced_at: now,
      })));
    for (let i = 0; i < officialRows.length; i += 500) {
      await supabase.from('teamwork_company_officials').insert(officialRows.slice(i, i + 500));
    }
    for (let i = 0; i < shareRows.length; i += 500) {
      await supabase.from('teamwork_shareholder_shares').insert(shareRows.slice(i, i + 500));
    }
  }

  // SSIC — plain columns on companies (2026-09-03, Vincent: "这个SSIC也可以
  // 加到 360里面"), not a side table like officials/shares, since it's a
  // handful of fixed scalar fields per company, same shape as has_xbrl/
  // has_agm etc. already living directly on companies. Same non-destructive
  // principle teamwork/sync (Companies) already documents for this table:
  // skip the write when the scrape found nothing at all — a fetch that came
  // back empty (page hiccup, HTML shape drift, or a genuinely
  // unclassified entity like an offshore L.P. — confirmed real via a
  // 15-company spot check, e.g. "500 DURIANS II, L.P" has no SSIC on
  // TeamWork at all) must never blank out a previously-good value. Gated
  // on code1 OR code2 (not code1 alone) — that same spot check also turned
  // up a real company with Activity I's code blank but Activity II's
  // populated (and Activity I's own remarks field non-empty); requiring
  // code1 specifically would have silently discarded a company that
  // clearly does have real SSIC data on file.
  // Caught live 2026-09-03: this loop originally never checked the
  // update's own `error` — before the ssic_* columns existed in
  // production (Vincent hadn't run scripts/add-companies-ssic-fields.sql
  // yet), every single write here failed with "column companies.ssic_code_1
  // does not exist", completely silently — `ssicUpdated` kept incrementing
  // regardless, so this route's own response claimed success while writing
  // nothing at all. Now tracked and surfaced properly.
  let ssicUpdated = 0, ssicSkippedEmpty = 0, ssicWriteErrors = 0;
  let firstSsicError: string | null = null;
  for (let i = 0; i < results.length; i += 10) {
    const batch = results.slice(i, i + 10);
    await Promise.all(batch.map(async profile => {
      const companyId = companyIdByInternalId.get(profile.companyId);
      if (!companyId || !profile.ssic || (!profile.ssic.code1 && !profile.ssic.code2)) { ssicSkippedEmpty++; return; }
      const s = profile.ssic;
      const { error } = await supabase.from('companies').update({
        ssic_code_1: s.code1 || null, ssic_description_1: s.description1 || null, ssic_remarks_1: s.remarks1 || null,
        ssic_code_2: s.code2 || null, ssic_description_2: s.description2 || null, ssic_remarks_2: s.remarks2 || null,
        ssic_synced_at: now,
      }).eq('id', companyId);
      if (error) { ssicWriteErrors++; firstSsicError ??= error.message; return; }
      ssicUpdated++;
    }));
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
    individual_shareholders_synced: results.reduce((n, p) => n + p.officerDetails.filter(d => d.cardType === 'Individual' && d.name).length, 0),
    shareholders_synced: results.reduce((n, p) => n + p.shareholderShares.filter(s => s.name).length, 0),
    ssic_updated: ssicUpdated,
    ssic_skipped_empty: ssicSkippedEmpty,
    ssic_write_errors: ssicWriteErrors,
    ssic_first_error: firstSsicError,
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'teamwork_secretary', () => syncSecretaries(req), 10);
}
