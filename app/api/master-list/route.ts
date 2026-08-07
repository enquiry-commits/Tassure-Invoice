import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { loadRenameMap } from '@/lib/company-rename';
import { getRequestAccount } from '@/lib/request-account';
import { logFieldChange } from '@/lib/audit-log';
import { syncPicToArReminder, type PicField } from '@/lib/pic-sync';
import { toIsoDateValue } from '@/lib/date';

const EDITABLE_FIELDS = new Set([
  'update_date', 'internal_code', 'company_name', 'roc_no', 'status',
  'join_date', 'sec_agent', 'kyc_year', 'register_of_controllers', 'corporate_tax',
  'efiling_authorization', 'ac', 'audit', 'gst', 'compil_report', 'cpf_submit',
  'add_here', 'invoice_address', 'mailing_address', 'contact_window', 'mailing_list',
  'email', 'tel', 'inc_date', 'shareholders', 'directors',
  'nominee_director', 'secretary', 'annual_return', 'fye', 'last_ar_date',
  'last_agm_date', 'last_accounts_date', 'next_agm_due_date', 'months_from_last_accounts', 'remark',
  'referral', 'risk_level', 'incorp_with_us', 'acra_update',
  'mas', 'grade',
  // Change Co Name only: the new legal name after the rename — see
  // lib/company-rename.ts for how other pages surface this by UEN.
  'new_company_name',
  // Active Client Services section — the ND/Secretary/ACC/TAX checkboxes are
  // manually toggleable, independent of whether a name is on file; ACC/TAX's
  // name is a manual override that takes precedence over AR Reminder's
  // synced value once set (see GET below).
  'nd_active', 'secretary_active', 'acc_pic_override', 'acc_active', 'tax_pic_override', 'tax_active',
]);

// These store true/false, not text — `value || null` (used for every other
// field) would turn `false` into `null`, so they need their own coercion.
const BOOLEAN_FIELDS = new Set(['nd_active', 'secretary_active', 'acc_active', 'tax_active']);

// Active Client only: fields a nightly TeamWork sync also writes (see
// ar-reminder/sync-workflow, teamwork/sync, teamwork/sync-secretary) — a
// manual edit here must win from now on, tracked in master_list.manual_fields
// (a JSONB map, not one column per field — see
// scripts/add-master-list-manual-fields.sql). Clearing a cell empty hands
// control back to automation, same as AR Reminder's date_of_agm/filling_date
// `_manual` columns. nd_active is included here for the resumeAutomation
// action's field validation only (see below) — it's no longer independently
// PATCHable from the UI, always derived from nominee_director's own write
// (see the secretary_active/nd_active derivation a few lines below).
const AUTO_SYNCED_FIELDS = new Set([
  'last_agm_date', 'last_ar_date', 'last_accounts_date', 'next_agm_due_date',
  'invoice_address', 'secretary', 'nominee_director', 'nd_active',
  // Added per Vincent: "CODE / EMAIL / FYE(FYE MONTH) 都要做自动化处理" —
  // internal_code mirrors companies.internal_code (TeamWork's own client_id,
  // already synced there), email mirrors companies.best_email/tw_to_emails
  // (already populated by the existing upcoming-events + contact-person-
  // report fill-in, see lib/teamwork-contact-report.ts), fye mirrors
  // companies.fye_month (the same self-corrected value ar-reminder/sync-
  // workflow already proved reliable today) — all three had a real,
  // already-computed automation source sitting unused.
  'internal_code', 'email', 'fye',
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type   = searchParams.get('type') ?? 'strike_off';
  const search = searchParams.get('search') ?? '';

  const supabase = createAdminClient();
  let q = supabase.from('master_list').select('*').eq('list_type', type);

  if (search) {
    q = q.or(`company_name.ilike.%${search}%,roc_no.ilike.%${search}%`);
  }

  // Sorted by the staff-assigned Code (e.g. CA001, CA003, ... CB003, CB010),
  // not insertion order — row_order was only ever "append to the end", which
  // is why newly-added companies used to fall out of Code order even though
  // the original imported rows (row_order seeded in Code order) looked
  // correctly sorted. Rows without a Code yet sort after ones that have it.
  const { data, error } = await q
    .order('internal_code', { ascending: true, nullsFirst: false })
    .order('company_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Strike Off / Terminated: Vincent wants newest Update Date at the top
  // ("我要这两个TABLE的排序是按照最新的日期在最上方") — update_date is
  // free-text with genuinely mixed formats across this dataset (DD/MM/YYYY,
  // DD.MM.YYYY, "14 Nov 2019", even stray trailing text like "15/11/2023
  // Resigned" or placeholder junk like "00/01/1900"), so a plain SQL sort
  // would order it as text, not chronologically. Re-sorted here in JS using
  // the same date parser already calibrated to this exact dataset's
  // ambiguous dd/mm-vs-mm/dd conventions (lib/date.ts's toIsoDateValue,
  // shared with the display formatter). Unparseable/missing dates sort last
  // rather than being silently dropped or crashing the page.
  if (type === 'strike_off' || type === 'terminated') {
    (data ?? []).sort((a, b) => {
      const isoA = toIsoDateValue(a.update_date);
      const isoB = toIsoDateValue(b.update_date);
      if (isoA && isoB) return isoB.localeCompare(isoA);
      if (isoA) return -1;
      if (isoB) return 1;
      return 0;
    });
  }

  // Cross-check against the TeamWork-synced companies table, by UEN only:
  //  - tw_fye: authoritative FYE month, to flag mismatches vs the manual fye
  //  - in_teamwork: this row's UEN exists in TeamWork. The master list is
  //    maintained by hand and normally has MORE companies than TeamWork —
  //    in_teamwork=false marks the ones TeamWork has no record of.
  const { data: companies } = await supabase.from('companies').select('company_name, registration_no, fye_month, client_type, internal_code');
  const twFyeByUen = new Map<string, string>();
  const twUens = new Set<string>();
  const cssClientByUen = new Map<string, boolean>();
  for (const c of companies ?? []) {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    if (!uen) continue;
    twUens.add(uen);
    if (c.fye_month) twFyeByUen.set(uen, c.fye_month);
    cssClientByUen.set(uen, c.client_type === 'CSS Client');
  }

  // Active Client only: pull ACC/TAX PIC from ar_reminder (joined by UEN —
  // same exact-match approach as tw_fye above). This is the only list type
  // that shows the checkbox+PIC columns, so skip the extra query elsewhere.
  // `acc_pic_override`/`tax_pic_override` (a master_list column staff can
  // edit directly) wins when set — AR Reminder's value is only the default
  // shown until someone overrides it here.
  //
  // Also pulls AR Reminder's date_of_agm/filling_date (its most recent FYE
  // cycle per company) purely to cross-check against Active Client's own
  // last_agm_date/last_ar_date (auto-filled by ar_workflow — see that
  // route) — a mismatch means TeamWork's latest event and whatever's on the
  // AR Reminder row (which staff can freely type over) have drifted apart.
  // Same "flag it, don't resolve it" treatment as the existing FYE mismatch.
  const accByUen = new Map<string, string>();
  const taxByUen = new Map<string, string>();
  const arAgmByUen = new Map<string, string>();
  const arFilingByUen = new Map<string, string>();
  if (type === 'active_client') {
    const { data: arRows } = await supabase.from('ar_reminder')
      .select('uen, acc_pic, tax_pic, date_of_agm, filling_date, fye_year');
    const latestCycleYearByUen = new Map<string, number>();
    for (const a of arRows ?? []) {
      const uen = a.uen ? String(a.uen).trim().toUpperCase() : null;
      if (!uen) continue;
      const acc = resolveTeamworkPic(a.acc_pic);
      const tax = resolveTeamworkPic(a.tax_pic);
      if (acc) accByUen.set(uen, acc);
      if (tax) taxByUen.set(uen, tax);

      const year = a.fye_year ?? 0;
      if (!latestCycleYearByUen.has(uen) || year >= latestCycleYearByUen.get(uen)!) {
        latestCycleYearByUen.set(uen, year);
        if (a.date_of_agm) arAgmByUen.set(uen, a.date_of_agm); else arAgmByUen.delete(uen);
        if (a.filling_date) arFilingByUen.set(uen, a.filling_date); else arFilingByUen.delete(uen);
      }
    }
  }

  // Change Co Name's own rows are the source of truth for a rename — every
  // OTHER list type gets a "formerly known as" hint by matching UEN against
  // them, instead of a note that would need to be copied onto each row by
  // hand and can drift out of date.
  const renameByUen = type === 'name_change' ? new Map<string, { oldName: string; newName: string }>() : await loadRenameMap(supabase);

  const enriched = (data ?? []).map(r => {
    const uen = r.roc_no ? String(r.roc_no).trim().toUpperCase() : null;
    const rename = uen ? renameByUen.get(uen) : undefined;
    return {
      ...r,
      tw_fye: uen ? (twFyeByUen.get(uen) ?? null) : null,
      in_teamwork: uen !== null && twUens.has(uen),
      is_css_client: uen ? (cssClientByUen.get(uen) ?? null) : null,
      acc_pic: r.acc_pic_override?.trim() || (uen ? (accByUen.get(uen) ?? null) : null),
      tax_pic: r.tax_pic_override?.trim() || (uen ? (taxByUen.get(uen) ?? null) : null),
      ar_date_of_agm: uen ? (arAgmByUen.get(uen) ?? null) : null,
      ar_filling_date: uen ? (arFilingByUen.get(uen) ?? null) : null,
      renamed_from: rename?.oldName ?? null,
      renamed_to: rename?.newName ?? null,
    };
  });

  // Active Client only: TeamWork companies confirmed as a genuine CSS Client
  // (same field the Companies page's "Client (CSS Client)" card uses) that
  // have no row at ALL anywhere in master_list — independent of the `search`
  // box, since this checks against the full roster either way. Checks every
  // list_type, not just active_client: a company TeamWork still tags CSS
  // Client but that staff have already filed under Strike Off/Terminated
  // (TeamWork's own status not yet updated to match) is already accounted
  // for, not a real gap — flagging it here too was a false positive Vincent
  // caught directly (14 shown, only 5 genuinely missing; the other 9 were
  // already sitting in Strike Off/Terminated).
  let missingCssClients: { company_name: string; registration_no: string | null; internal_code: string | null }[] = [];
  if (type === 'active_client') {
    // master_list has more rows than PostgREST's default page size (1000),
    // so an unpaginated select silently truncates — page through it
    // explicitly (same pattern already used elsewhere, e.g. teamwork/sync's
    // mlRows). Missed this the first time and it would have made the panel
    // show hundreds of false positives instead of fixing the false
    // positives it already had — caught by testing against real data
    // before deploying, not assumed correct from the diff alone.
    const allMasterListRows: { roc_no: string | null }[] = [];
    for (let start = 0; ; start += 1000) {
      const { data: page } = await supabase.from('master_list').select('roc_no').range(start, start + 999);
      allMasterListRows.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    const knownUens = new Set(
      allMasterListRows.map(r => (r.roc_no ? String(r.roc_no).trim().toUpperCase() : null)).filter((v): v is string => !!v),
    );
    missingCssClients = (companies ?? [])
      .filter(c => c.client_type === 'CSS Client')
      .filter(c => {
        const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
        return !uen || !knownUens.has(uen);
      })
      .map(c => ({ company_name: c.company_name, registration_no: c.registration_no, internal_code: c.internal_code ?? null }))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }

  return NextResponse.json({ type, total: enriched.length, data: enriched, missingCssClients });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { list_type, company_name } = body;
  if (!list_type) return NextResponse.json({ error: 'list_type required' }, { status: 400 });
  if (!company_name) return NextResponse.json({ error: 'company_name required' }, { status: 400 });

  const supabase = createAdminClient();

  // New manual rows go to the end of that list's ordering
  const { data: maxRow } = await supabase
    .from('master_list')
    .select('row_order')
    .eq('list_type', list_type)
    .order('row_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.row_order ?? 0) + 1;

  const record: Record<string, unknown> = { list_type, row_order: nextOrder };
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) record[field] = body[field] || null;
  }

  const { data, error } = await supabase.from('master_list').insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('master_list').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, field } = body;
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'Field not editable' }, { status: 400 });

  // A distinct, lightweight action: only clears the manual_fields flag,
  // never touches the field's own stored value — lets staff hand a
  // checkbox like nd_active back to automation without needing to "clear"
  // it (there's no empty state for a checkbox, unlike the text/date fields).
  if (body.resumeAutomation === true) {
    if (!AUTO_SYNCED_FIELDS.has(field)) return NextResponse.json({ error: 'Field is not auto-synced' }, { status: 400 });
    const supabase = createAdminClient();
    const { error } = await supabase.rpc('set_master_list_manual_field', { p_row_id: id, p_field: field, p_manual: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { value } = body;
  if (!Object.prototype.hasOwnProperty.call(body, 'previousValue')) {
    return NextResponse.json({ error: 'previousValue is required for conflict-safe updates' }, { status: 428 });
  }

  const supabase = createAdminClient();
  const account = await getRequestAccount(req);
  const stored = BOOLEAN_FIELDS.has(field) ? !!value : (value || null);
  const prevStored = BOOLEAN_FIELDS.has(field) ? !!body.previousValue : (body.previousValue || null);
  const needsRoc = field === 'acc_pic_override' || field === 'tax_pic_override';
  const cols = field === 'roc_no' ? 'id,roc_no' : `id,roc_no,${field}`;
  const updatedAt = new Date().toISOString();

  // Compare-and-swap on the field's own previous value — same technique
  // ar_reminder's PATCH already uses (see app/api/ar-reminder/route.ts),
  // now mirrored here (Vincent: Master List had no equivalent of AR
  // Reminder's version-conflict detection, so two staff editing the same
  // cell around the same time could silently overwrite each other). The
  // UPDATE only matches a row if `field` still holds exactly what the
  // client last saw; if someone else already changed it, 0 rows match and
  // .maybeSingle() returns null — that's the conflict signal. Also folds
  // what used to be a separate SELECT-before-UPDATE (roc_no for the PIC
  // sync below) into UPDATE...RETURNING, so this stays a single round trip
  // on the common (non-conflicting) path. updated_by_email/name (Vincent:
  // wants a persistent "last edited by" trace, not a checkmark that just
  // vanishes) are written here too — same round trip, no extra cost.
  let updateQuery = supabase
    .from('master_list')
    .update({
      [field]: stored, updated_at: updatedAt,
      updated_by_email: account?.email ?? null, updated_by_name: account?.name ?? null,
      // The Nominee Dir. and Secretary checkboxes are purely "does this
      // cell have content" indicators for staff (Vincent: "有内容就需要打
      // 勾...那个打勾只是为了让我方便辨认那些是有内容的"; ND given the same
      // treatment per "ND的打勾也做一样的处理") — unlike acc_active/
      // tax_active, which remain genuine independent service-status flags —
      // so a manual edit to either name must always keep its checkbox in
      // sync, not leave it to drift.
      ...(field === 'secretary' ? { secretary_active: stored !== null } : {}),
      ...(field === 'nominee_director' ? { nd_active: stored !== null } : {}),
    })
    .eq('id', id);
  if (BOOLEAN_FIELDS.has(field) && prevStored === false) {
    // A checkbox that's never been touched stores NULL, not false, in
    // Postgres — but reads back as unchecked either way (`!!null` and
    // `!!false` are both false), so the CAS check must accept BOTH as "the
    // client saw this unchecked": matching only `= false` made every
    // first-ever click on a still-NULL row look like a conflict (`NULL =
    // false` is never true in SQL), reverting the checkbox right back to
    // unchecked despite nothing else having touched it. `= true` stays an
    // exact match — no such ambiguity once a value has actually been set.
    updateQuery = updateQuery.or(`${field}.is.null,${field}.eq.false`);
  } else {
    updateQuery = prevStored === null
      ? updateQuery.is(field, null)
      : updateQuery.filter(field, 'eq', prevStored as string | boolean);
  }

  const { data, error } = await updateQuery.select(cols).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    const { data: current, error: currentError } = await supabase.from('master_list').select('*').eq('id', id).maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    const { data: lastChange } = await supabase
      .from('audit_log')
      .select('changed_by, changed_at')
      .eq('table_name', 'master_list').eq('row_id', id).eq('field', field)
      .order('changed_at', { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({
      error: 'conflict',
      currentValue: (current as Record<string, unknown>)[field] ?? null,
      changedBy: lastChange?.changed_by ?? null,
      changedAt: lastChange?.changed_at ?? null,
    }, { status: 409 });
  }

  const row = data as unknown as Record<string, unknown>;
  await logFieldChange(supabase, {
    tableName: 'master_list', rowId: id, field,
    oldValue: prevStored, newValue: stored, changedBy: account?.email ?? 'unknown',
  });

  // ACC/TAX PIC is two-way synced with AR Reminder — whichever page it was
  // most recently edited on wins and mirrors onto the other.
  if (needsRoc && account) {
    const picField: PicField = field === 'acc_pic_override' ? 'acc_pic' : 'tax_pic';
    const roc = row.roc_no as string | null;
    await syncPicToArReminder(supabase, roc, picField, stored as string | null, account.email, account.name);
  }

  // Mark this field manual so tonight's TeamWork sync skips it — an edit
  // back to empty hands control back to automation automatically. (nd_active
  // itself is never patched directly anymore, only nominee_director — see
  // AUTO_SYNCED_FIELDS comment above — but this stays correct if it ever is.)
  if (AUTO_SYNCED_FIELDS.has(field)) {
    const isManual = BOOLEAN_FIELDS.has(field) ? true : stored !== null;
    await supabase.rpc('set_master_list_manual_field', { p_row_id: id, p_field: field, p_manual: isManual });
  }

  return NextResponse.json({ ok: true, updatedAt, updatedByName: account?.name ?? null });
}
