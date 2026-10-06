import { NextRequest, NextResponse } from 'next/server';
import { canAccountOpen } from '@/lib/approved-accounts';
import { getRequestAccount } from '@/lib/request-account';
import { loadOriginalsQueue } from '@/lib/original-status';

// GET /api/billing/originals — the Invoice Originals queue (INV-QB-037): the open
// invoices accounting has split that still have NO original the system accepts,
// with the files attached to each and why none is accepted. An invoice whose
// original is in use is not listed. Read only (no write to QuickBooks or to any
// table); the proof is the SOA's own (lib/original-copy.ts). Needs an account that
// may open the page — the proxy only checks sign-in on /api.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!canAccountOpen(account, '/billing/soa/originals', new URLSearchParams())) {
    return NextResponse.json({ error: 'Your account does not have access to Invoice Originals.' }, { status: 403 });
  }
  try {
    return NextResponse.json(await loadOriginalsQueue(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
