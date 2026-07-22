import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { AutomationRun, automationTrigger, replaceAutomationExceptions } from '@/lib/automation-sync';
import { todaySGT } from '@/lib/date';
import { syncTeamworkCampaignRecipients } from '@/lib/teamwork-recipients';

// Daily TeamWork -> companies sync (see vercel.json cron, 00:30 UTC — before
// the 01:00 ar-reminder generator so new clients enter that day's AR window).
//
// TeamWork is the source of truth for the company roster. Before this route
// existed the table was only refreshed by hand-run scripts (last: 2026-06-26),
// so clients created in TeamWork after that never entered Billing/AR at all.
//
// Write rules:
//  - Match by companies.internal_id === TeamWork company_id (authoritative).
//  - Rows without internal_id are matched by normalized name once, which
//    backfills internal_id so the next run matches directly.
//  - Only overwrite most fields with a NON-EMPTY TeamWork value; never blank
//    registration_no / fye_month / best_email because TeamWork has a gap.
//    Internal CSS Status is the exception: it is always authoritative, and
//    an empty value means Not Specified (therefore not Active).
//  - Never touch company_name on existing rows (manual typo fixes live here)
//    and never touch QB-derived service fields (has_*, *_pic, …).
//  - Unmatched TeamWork records are inserted only when Internal CSS Status is
//    Active. `client`, `non_client`, and Entity Status are not roster gates.
//  - TeamWork's Client column is derived from two independent flags:
//      corporate_shareholder_client="1" => CSS Client
//      corporate_shareholder="1"        => Shareholder
//    A company may be both. The legacy is_non_client column stores the
//    Shareholder flag so existing deployments do not need a schema migration.
//  - Nothing is ever deleted; rows whose internal_id vanished from TeamWork
//    are only counted in the summary.
export const maxDuration = 300;

const TW_URL = 'https://apps.teamworkcss.com/dev/apiservice';
const ENV_KEYS = ['TEAMWORK_BASIC_USER', 'TEAMWORK_BASIC_PASS', 'TEAMWORK_API_KEY', 'TEAMWORK_LOGIN_EMAIL', 'TEAMWORK_LOGIN_PASSWORD'] as const;

interface TwCompany {
  company_id: string;
  company_name: string | null;
  company_registration_Num: string | null;
  type: string | null;
  status: string | null;
  fye_date: string | null;            // "DD/MM"
  company_email_address: string | null;
  person_in_charge: string | null;
  client: string;                     // "1" | "0" — NOT reliable for "is a real client"; several genuinely Active
                                       // corp-sec clients carry client="0". Kept only for reference.
  non_client: string;                 // "1" | "0" — TeamWork Non-Client flag; not the Shareholder indicator.
  corporate_shareholder: string;      // "1" => Client column includes "(Shareholder)".
  corporate_shareholder_client: string; // "1" => Client column includes "CSS Client".
  company_reg_Office_address: string | null;
}

// A client "uses our address service" iff its registered office in TeamWork
// is Tassure's own office (10 Anson Road #12-08 International Plaza).
// Validated against all 319 flagged clients: 317 match this rule, and the 2
// that don't turned out to be genuine cancellations (address moved away).
// TeamWork is the source of truth here — QB history only proves a PAST bill.
const usesOurAddress = (regAddr: string) => /10\s+ANSON/i.test(regAddr) && /12-08/.test(regAddr);

function twHeaders(token = '') {
  const basic = Buffer.from(`${process.env.TEAMWORK_BASIC_USER}:${process.env.TEAMWORK_BASIC_PASS}`).toString('base64');
  return { Authorization: `Basic ${basic}`, 'x-api-key': process.env.TEAMWORK_API_KEY!, authtoken: token };
}

async function twLogin(): Promise<string> {
  const form = new FormData();
  form.set('memail', process.env.TEAMWORK_LOGIN_EMAIL!);
  form.set('mpassword', process.env.TEAMWORK_LOGIN_PASSWORD!);
  const res = await fetch(`${TW_URL}/api/user_auth/login`, { method: 'POST', headers: twHeaders(), body: form });
  const json = await res.json();
  if (!json.token) throw new Error(`TeamWork login failed: ${JSON.stringify(json).slice(0, 200)}`);
  return json.token;
}

async function fetchAllCompanies(token: string): Promise<TwCompany[]> {
  const PAGE = 100;
  const all: TwCompany[] = [];
  for (let start = 0; ; start += PAGE) {
    const form = new FormData();
    form.set('start', String(start));
    form.set('length', String(PAGE));
    const res = await fetch(`${TW_URL}/api/corpsec/companies/getCompanies`, { method: 'POST', headers: twHeaders(token), body: form });
    if (!res.ok) throw new Error(`getCompanies HTTP ${res.status} at start=${start}`);
    const json = await res.json();
    const batch: TwCompany[] = json.data?.data?.companyinfo ?? [];
    all.push(...batch);
    const total: number = json.data?.recordsTotal ?? 0;
    if (!batch.length || all.length >= total) break;
  }
  return all;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fyeMonthOf(fyeDate: string | null): string | null {
  const m = (fyeDate ?? '').match(/^\d{1,2}\/(\d{1,2})$/);   // "31/12" = DD/MM
  return m ? MONTH_NAMES[parseInt(m[1], 10) - 1] ?? null : null;
}
function fyeDayOf(fyeDate: string | null): number | null {
  const match = (fyeDate ?? '').match(/^(\d{1,2})\/\d{1,2}$/);
  const day = match ? parseInt(match[1], 10) : NaN;
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

async function syncTeamworkCompanies() {
  const missing = ENV_KEYS.filter(k => !process.env[k]);
  if (missing.length) return NextResponse.json({ error: `Missing env vars: ${missing.join(', ')}` }, { status: 500 });

  let twList: TwCompany[];
  try {
    twList = await fetchAllCompanies(await twLogin());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  // A truncated/broken TeamWork response must not drive DB writes.
  if (twList.length < 500) {
    return NextResponse.json({ error: `TeamWork returned only ${twList.length} companies — aborting as suspicious` }, { status: 502 });
  }

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from('companies')
    .select('id, internal_id, company_name, registration_no, company_type, tw_status, is_active, fye_month, fye_day, best_email, uses_address, has_nd, pic, sec_pic, client_type, is_non_client');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byInternal = new Map((rows ?? []).filter(r => r.internal_id).map(r => [r.internal_id as string, r]));
  // Name lookup ONLY for rows that still lack an internal_id (one-time healing).
  const AMBIG = Symbol('ambiguous');
  const byName = new Map<string, typeof rows extends (infer R)[] | null ? R : never | typeof AMBIG>();
  for (const r of rows ?? []) {
    if (r.internal_id) continue;
    const n = normalize(r.company_name);
    byName.set(n, byName.has(n) ? (AMBIG as never) : (r as never));
  }

  const now = new Date().toISOString();
  const updates: { id: number; patch: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const unknownPicIds: Array<{ key: string; name: string; details: Record<string, unknown> }> = [];
  const ambiguousNames: Array<{ key: string; name: string; details: Record<string, unknown> }> = [];
  let matched = 0, backfilled = 0, skippedAmbiguous = 0;

  for (const tw of twList) {
    const twName = (tw.company_name ?? '').trim();
    let row = byInternal.get(tw.company_id) ?? null;

    if (!row && twName) {
      const cand = byName.get(normalize(twName));
      if (cand === (AMBIG as never)) {
        skippedAmbiguous++;
        ambiguousNames.push({ key: tw.company_id, name: twName, details: { normalized_name: normalize(twName) } });
        continue;
      }
      if (cand) { row = cand; backfilled++; }
    }

    const regNo   = (tw.company_registration_Num ?? '').trim() || null;
    const type    = (tw.type ?? '').trim() || null;
    const status  = (tw.status ?? '').trim() || null;
    const internalCssActive = (status ?? '').toLowerCase() === 'active';
    const fyeMon  = fyeMonthOf(tw.fye_date);
    const fyeDay  = fyeDayOf(tw.fye_date);
    const email   = (tw.company_email_address ?? '').trim() || null;
    const regAddr = (tw.company_reg_Office_address ?? '').trim();
    const isCssClient = tw.corporate_shareholder_client === '1';
    const isShareholder = tw.corporate_shareholder === '1';
    const clientType = isCssClient ? 'CSS Client' : isShareholder ? 'Shareholder' : 'Other';
    const resolvedPic = resolveTeamworkPic(tw.person_in_charge);
    const rawPic = String(tw.person_in_charge ?? '').trim();
    if (/^\d+$/.test(rawPic) && !resolvedPic) {
      unknownPicIds.push({ key: tw.company_id, name: twName, details: { teamwork_pic_id: rawPic } });
    }

    if (row) {
      matched++;
      const patch: Record<string, unknown> = {};
      if (!row.internal_id)                                          patch.internal_id = tw.company_id;
      if (regNo  && regNo  !== (row.registration_no ?? '').trim())   patch.registration_no = regNo;
      if (type   && type   !== row.company_type)                     patch.company_type = type;
      if (status !== row.tw_status)                                  patch.tw_status = status;
      if (internalCssActive !== (row.is_active === true))             patch.is_active = internalCssActive;
      if (fyeMon && fyeMon !== row.fye_month)                        patch.fye_month = fyeMon;
      if (fyeDay && fyeDay !== row.fye_day)                          patch.fye_day = fyeDay;
      if (email  && email.toLowerCase() !== (row.best_email ?? '').toLowerCase()) patch.best_email = email;
      const currentPic = String(row.sec_pic ?? row.pic ?? '').trim();
      if (/^\d+$/.test(currentPic)) patch.pic = resolvedPic || null;
      // Address service follows the CURRENT TeamWork registered address (both
      // directions — cancelled service flips off, new service flips on). Only
      // when TeamWork actually has an address on file.
      if (regAddr && usesOurAddress(regAddr) !== (row.uses_address === true)) patch.uses_address = usesOurAddress(regAddr);
      // Mirror TeamWork's displayed Client column. CSS Client and Shareholder
      // are independent identities, so a company can appear in both filters.
      if (clientType !== row.client_type) patch.client_type = clientType;
      if (isShareholder !== (row.is_non_client === true)) patch.is_non_client = isShareholder;
      if (Object.keys(patch).length) { patch.synced_at = now; updates.push({ id: row.id, patch }); }
    } else if (internalCssActive && twName) {
      inserts.push({
        company_name: twName,
        internal_id: tw.company_id,
        registration_no: regNo,
        company_type: type,
        fye_month: fyeMon,
        fye_day: fyeDay,
        best_email: email,
        pic: resolvedPic && !/^\d+$/.test(resolvedPic) ? resolvedPic : null,
        // Client classification mirrors TeamWork's Client column; roster
        // inclusion remains governed only by Internal CSS Status.
        client_type: clientType,
        tw_status: 'Active',
        is_active: true,
        is_non_client: isShareholder,
        uses_address: regAddr ? usesOurAddress(regAddr) : false,
        synced_at: now,
      });
    }
  }

  // Guard against TeamWork-side duplicate names creating duplicate rows.
  const seen = new Set<string>();
  const dedupedInserts = inserts.filter(r => {
    const n = normalize(r.company_name as string);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  // ── has_nd / master_list.nd_active follow the ND appointments register ────
  // Same principle as uses_address: QB history only proves a PAST bill; the
  // Nominee Directors page's own data is the truth. "Active" here uses the
  // exact same rule as that page (app/api/nominee-directors/route.ts):
  // no cessation_date, or a cessation_date still in the future. Previously
  // this used a stricter "cessation_date IS NULL" check, and Master List's
  // "Has Nominee Dir" card read a free-text field that staff don't keep in
  // sync with actual resignations — both are now tied to this one set so
  // every page agrees with the ND page's number.
  let ndFlagUpdates = 0;
  let ndActiveUpdates = 0;
  {
    const t = todaySGT();
    const { data: appts } = await supabase
      .from('nd_appointments')
      .select('company_name, cessation_date')
      .eq('sub_role', 'Nominee Director')
      .not('appointment_date', 'is', null);
    const ndSet = new Set(
      (appts ?? [])
        .filter(a => !a.cessation_date || a.cessation_date > t)
        .map(a => normalize(a.company_name)),
    );
    const ndPatches = (rows ?? [])
      .filter(r => ndSet.has(normalize(r.company_name)) !== (r.has_nd === true))
      .map(r => ({ id: r.id, has_nd: ndSet.has(normalize(r.company_name)) }));
    for (let i = 0; i < ndPatches.length; i += 10) {
      const results = await Promise.all(ndPatches.slice(i, i + 10).map(p =>
        supabase.from('companies').update({ has_nd: p.has_nd, synced_at: now }).eq('id', p.id).then(r => r.error?.message ?? null)
      ));
      ndFlagUpdates += results.filter(e => !e).length;
    }

    const { data: mlRows } = await supabase.from('master_list').select('id, company_name, nd_active');
    const mlPatches = (mlRows ?? [])
      .filter(r => ndSet.has(normalize(r.company_name)) !== (r.nd_active === true))
      .map(r => ({ id: r.id, nd_active: ndSet.has(normalize(r.company_name)) }));
    for (let i = 0; i < mlPatches.length; i += 10) {
      const results = await Promise.all(mlPatches.slice(i, i + 10).map(p =>
        supabase.from('master_list').update({ nd_active: p.nd_active }).eq('id', p.id).then(r => r.error?.message ?? null)
      ));
      ndActiveUpdates += results.filter(e => !e).length;
    }
  }

  let updatedCount = 0;
  const updateErrors: string[] = [];
  for (let i = 0; i < updates.length; i += 10) {
    const results = await Promise.all(updates.slice(i, i + 10).map(u =>
      supabase.from('companies').update(u.patch).eq('id', u.id).then(r => r.error?.message ?? null)
    ));
    for (const err of results) {
      if (err) updateErrors.push(err);
      else updatedCount++;
    }
  }

  let insertedCount = 0, insertError: string | null = null;
  if (dedupedInserts.length) {
    const { error: insErr } = await supabase.from('companies').insert(dedupedInserts);
    if (insErr) insertError = insErr.message;
    else insertedCount = dedupedInserts.length;
  }

  const teamworkIds = new Set(twList.map(item => item.company_id));
  const missingRows = (rows ?? []).filter(r => r.internal_id && !teamworkIds.has(r.internal_id));
  const missingFromTw = missingRows.length;
  await Promise.all([
    replaceAutomationExceptions('teamwork_companies', 'missing_from_teamwork', missingRows.map(row => ({
      key: String(row.internal_id), name: row.company_name, details: { company_id: row.id },
    }))),
    replaceAutomationExceptions('teamwork_companies', 'unknown_pic_id', unknownPicIds),
    replaceAutomationExceptions('teamwork_companies', 'ambiguous_company_name', ambiguousNames),
  ]);

  let recipientSync: Awaited<ReturnType<typeof syncTeamworkCampaignRecipients>> | null = null;
  let recipientSyncError: string | null = null;
  try {
    recipientSync = await syncTeamworkCampaignRecipients(supabase);
  } catch (error) {
    recipientSyncError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    ok: !insertError && !updateErrors.length && !recipientSyncError,
    tw_total: twList.length,
    matched,
    internal_id_backfilled: backfilled,
    updated: updatedCount,
    nd_flag_updates: ndFlagUpdates,
    nd_active_updates: ndActiveUpdates,
    inserted: insertedCount,
    inserted_names: dedupedInserts.map(r => r.company_name),
    skipped_ambiguous_names: skippedAmbiguous,
    rows_missing_from_teamwork: missingFromTw,
    campaign_recipients: recipientSync,
    ...(recipientSyncError ? { campaign_recipient_error: recipientSyncError } : {}),
    ...(insertError ? { insert_error: insertError } : {}),
    ...(updateErrors.length ? { update_errors: updateErrors.slice(0, 5) } : {}),
  });
}

export async function GET(req: NextRequest) {
  let run: AutomationRun;
  try {
    run = await AutomationRun.begin('teamwork_companies', automationTrigger(req.headers.get('authorization')));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
  if (!run.acquired) {
    return NextResponse.json({ ok: false, skipped: true, error: 'TeamWork company sync is already running.' }, { status: 409 });
  }

  try {
    const response = await syncTeamworkCompanies();
    const summary = await response.clone().json() as Record<string, unknown>;
    if (response.ok && summary.ok !== false) await run.succeed(summary);
    else await run.fail(String(summary.error ?? 'TeamWork company sync failed.'), summary);
    return response;
  } catch (error) {
    await run.fail(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
