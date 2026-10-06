import { NextRequest, NextResponse } from 'next/server';
import { checkInvoiceOriginal } from '@/lib/original-status';
import type { QbCompany } from '@/lib/quickbooks';

// GET /api/billing/originals/check?company=TAB&id=123 — opens the files attached
// to ONE invoice and says what the real client-PDF path (lib/client-invoice-pdf.ts)
// would do with them: use the original, or redraw and why each file was not
// accepted (INV-QB-037). Read only — it downloads and reads, never writes to
// QuickBooks. Signed-in only (proxy.ts).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

const BOOKS = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!company || !BOOKS.has(company)) return NextResponse.json({ error: 'company must be TAB, TAC or TAO' }, { status: 400 });
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'A valid QuickBooks invoice id is required.' }, { status: 400 });
  try {
    return NextResponse.json(await checkInvoiceOriginal(company, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
