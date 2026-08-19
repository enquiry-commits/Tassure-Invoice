import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// GET: the full company picklist for the parent-company picker
// (app/billing/page.tsx's ParentCompanyPicker) — unfiltered, since a parent
// need not be an active CSS client itself. Cheap: ~900 rows, id+name only.
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('companies').select('id, company_name').order('company_name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ companies: data ?? [] });
}

// PATCH { companyId, parentCompanyId }: set (or, with parentCompanyId:null,
// clear) the persistent parent-company link. Written ONLY here.
export async function PATCH(req: NextRequest) {
  const { companyId, parentCompanyId } = await req.json();
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  if (parentCompanyId !== null && typeof parentCompanyId !== 'number') {
    return NextResponse.json({ error: 'parentCompanyId must be a number or null' }, { status: 400 });
  }
  if (parentCompanyId === companyId) {
    return NextResponse.json({ error: 'A company cannot be its own parent' }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('companies').update({ parent_company_id: parentCompanyId }).eq('id', companyId);
  if (error) {
    const hint = /parent_company_id/.test(error.message)
      ? ' — run scripts/add-companies-parent-link.sql in the Supabase SQL editor first'
      : '';
    return NextResponse.json({ error: error.message + hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
