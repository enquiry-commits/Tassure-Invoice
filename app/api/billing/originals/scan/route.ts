import { NextResponse } from 'next/server';
import { loadOpenSplitInvoices, scanAttachments } from '@/lib/original-status';

// GET /api/billing/originals/scan — which files are attached in QuickBooks to
// each of those invoices: one paged read per book, no file opened. The page
// shows "Nothing attached" straight away for the rows without any and opens
// only the others (/check). Read only; signed-in only (proxy.ts).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

export async function GET() {
  try {
    const result = await scanAttachments(await loadOpenSplitInvoices());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
