import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

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

  const { data, error } = await q.order('row_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cross-check against the TeamWork-synced companies table, by UEN only:
  //  - tw_fye: authoritative FYE month, to flag mismatches vs the manual fye
  //  - in_teamwork: this row's UEN exists in TeamWork. The master list is
  //    maintained by hand and normally has MORE companies than TeamWork —
  //    in_teamwork=false marks the ones TeamWork has no record of.
  const { data: companies } = await supabase.from('companies').select('registration_no, fye_month');
  const twFyeByUen = new Map<string, string>();
  const twUens = new Set<string>();
  for (const c of companies ?? []) {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    if (!uen) continue;
    twUens.add(uen);
    if (c.fye_month) twFyeByUen.set(uen, c.fye_month);
  }
  const enriched = (data ?? []).map(r => {
    const uen = r.roc_no ? String(r.roc_no).trim().toUpperCase() : null;
    return {
      ...r,
      tw_fye: uen ? (twFyeByUen.get(uen) ?? null) : null,
      in_teamwork: uen !== null && twUens.has(uen),
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
  const { error } = await supabase
    .from('master_list')
    .update({ [field]: value || null, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
