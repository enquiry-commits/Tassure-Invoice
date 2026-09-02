import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { CUSTOMER_SOURCE_OPTIONS } from '@/lib/customer-source';

// Edits companies.customer_source from Company 360 (see
// scripts/add-companies-customer-source.sql, lib/customer-source.ts). A
// plain top-level column, not a JSON-merge field like services_manual — no
// concurrency-merge concern the way that RPC exists for, so a direct
// .update() is enough here.
const VALID_VALUES = new Set(CUSTOMER_SOURCE_OPTIONS.map(o => o.value));

export async function PATCH(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyId, value } = await req.json();
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  if (value !== null && !VALID_VALUES.has(value)) {
    return NextResponse.json({ error: `value must be one of: ${[...VALID_VALUES].join(', ')}, or null` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('companies').update({ customer_source: value }).eq('id', companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, customerSource: value });
}
