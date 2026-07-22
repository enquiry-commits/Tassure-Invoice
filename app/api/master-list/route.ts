import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';

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
  // Active Client Services section — the ND/Secretary/ACC/TAX checkboxes are
  // manually toggleable, independent of whether a name is on file; ACC/TAX's
  // name is a manual override that takes precedence over AR Reminder's
  // synced value once set (see GET below).
  'nd_active', 'secretary_active', 'acc_pic_override', 'acc_active', 'tax_pic_override', 'tax_active',
]);

// These store true/false, not text — `value || null` (used for every other
// field) would turn `false` into `null`, so they need their own coercion.
const BOOLEAN_FIELDS = new Set(['nd_active', 'secretary_active', 'acc_active', 'tax_active']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type   = searchParams.get('type') ?? 'strike_off';
  const search = searchParams.get('search') ?? '';

  const supabase = createAdminClient();
  let q = supabase.from('master_list').select('*').eq('list_type', type);

  if (search) {
    q = q.or(`company_name.ilike.%${search}%,roc_no.ilike.%${search}%`);
  }

  const { data, error } = await q.order('row_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cross-check against the TeamWork-synced companies table, by UEN only:
  //  - tw_fye: authoritative FYE month, to flag mismatches vs the manual fye
  //  - in_teamwork: this row's UEN exists in TeamWork. The master list is
  //    maintained by hand and normally has MORE companies than TeamWork —
  //    in_teamwork=false marks the ones TeamWork has no record of.
  const { data: companies } = await supabase.from('companies').select('registration_no, fye_month, client_type');
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
  const accByUen = new Map<string, string>();
  const taxByUen = new Map<string, string>();
  if (type === 'active_client') {
    const { data: arRows } = await supabase.from('ar_reminder').select('uen, acc_pic, tax_pic');
    for (const a of arRows ?? []) {
      const uen = a.uen ? String(a.uen).trim().toUpperCase() : null;
      if (!uen) continue;
      const acc = resolveTeamworkPic(a.acc_pic);
      const tax = resolveTeamworkPic(a.tax_pic);
      if (acc) accByUen.set(uen, acc);
      if (tax) taxByUen.set(uen, tax);
    }
  }

  const enriched = (data ?? []).map(r => {
    const uen = r.roc_no ? String(r.roc_no).trim().toUpperCase() : null;
    return {
      ...r,
      tw_fye: uen ? (twFyeByUen.get(uen) ?? null) : null,
      in_teamwork: uen !== null && twUens.has(uen),
      is_css_client: uen ? (cssClientByUen.get(uen) ?? null) : null,
      acc_pic: r.acc_pic_override?.trim() || (uen ? (accByUen.get(uen) ?? null) : null),
      tax_pic: r.tax_pic_override?.trim() || (uen ? (taxByUen.get(uen) ?? null) : null),
    };
  });

  return NextResponse.json({ type, total: enriched.length, data: enriched });
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
  const { id, field, value } = await req.json();
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'Field not editable' }, { status: 400 });

  const supabase = createAdminClient();
  const stored = BOOLEAN_FIELDS.has(field) ? !!value : (value || null);
  const { error } = await supabase
    .from('master_list')
    .update({ [field]: stored, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
