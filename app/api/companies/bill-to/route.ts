import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

/**
 * The per-company Bill To defaults — c/o party, whose address prints under
 * it, and Attn (2026-09-10). See scripts/add-companies-bill-to-care-of.sql
 * for why these live on the company rather than only on an invoice.
 *
 * These values are printed on a real invoice the CLIENT receives, so each
 * field is validated rather than stored as whatever arrived: an address
 * source outside b/a/custom would silently fall back to 'b' at composition
 * time and quietly send the invoice somewhere nobody chose.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const FIELDS = new Set(['bill_to_care_of', 'bill_to_care_of_addr_source', 'bill_to_care_of_addr_custom', 'bill_to_attn']);
const ADDR_SOURCES = new Set(['b', 'a', 'custom']);

export async function PATCH(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyId, field, value } = await req.json();
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  if (!FIELDS.has(field)) return NextResponse.json({ error: `field must be one of: ${[...FIELDS].join(', ')}` }, { status: 400 });

  const trimmed = typeof value === 'string' ? value.trim() : null;
  const stored = trimmed ? trimmed : null;

  if (field === 'bill_to_care_of_addr_source' && stored !== null && !ADDR_SOURCES.has(stored)) {
    return NextResponse.json({ error: `bill_to_care_of_addr_source must be one of: ${[...ADDR_SOURCES].join(', ')}, or empty to clear it (which means 'b').` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('companies').update({ [field]: stored }).eq('id', companyId);
  if (error) {
    const hint = /bill_to_/.test(error.message)
      ? ' — run scripts/add-companies-bill-to-care-of.sql in the Supabase SQL editor first'
      : '';
    return NextResponse.json({ error: error.message + hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true, field, value: stored });
}
