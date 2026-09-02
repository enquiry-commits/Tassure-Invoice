import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { getCompany360 } from '@/lib/company-360';

// Thin wrapper around lib/company-360.ts's getCompany360 — the page itself
// (app/companies/[id]/page.tsx) calls that function directly (server
// component, no HTTP hop needed); this route exists for any future
// non-page consumer (e.g. the assistant, an export) that needs the same
// aggregation over HTTP.
//
// preferredRegion: same reasoning as the page's own pin — getCompany360
// issues ~11 Supabase queries; Supabase is Tokyo-hosted, so keep this
// route in Singapore rather than Vercel's default region.
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
  }

  const result = await getCompany360(createAdminClient(), id);
  if (!result) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  return NextResponse.json(result);
}
