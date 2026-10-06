import { NextResponse } from 'next/server';
import { loadOpenSplitInvoices } from '@/lib/original-status';

// GET /api/billing/originals — the open invoices accounting has split (they carry
// a Deferred Revenue line), from the synced rows: the list the "Invoice originals"
// page shows (INV-QB-037). No QuickBooks call; read only. Signed-in only
// (proxy.ts guards every /api route).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

export async function GET() {
  try {
    const rows = await loadOpenSplitInvoices();
    return NextResponse.json({ rows, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
