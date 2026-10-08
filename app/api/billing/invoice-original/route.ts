import { NextRequest } from 'next/server';
import { getOriginalInvoicePdf } from '@/lib/invoice-versions';
import { headerDetail } from '@/lib/content-disposition';
import type { QbCompany } from '@/lib/quickbooks';

// GET /api/billing/invoice-original?company=TAB&id=123 — the invoice as the client FIRST received it (lib/invoice-versions.ts):
// QuickBooks' current PDF when accounting has not split it, else the PDF attached in QuickBooks that proves it is the original.
// 404 (with the reason) when a split invoice has no proven original — never a redraw. The assistant card and the monthly
// originals ZIP both use this. Signed-in only (proxy.ts guards every /api route).
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';
export const maxDuration = 60;

const BOOKS = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!company || !BOOKS.has(company)) return Response.json({ error: 'company must be TAB, TAC or TAO' }, { status: 400 });
  if (!/^\d+$/.test(id)) return Response.json({ error: 'A valid QuickBooks invoice id is required.' }, { status: 400 });
  try {
    const result = await getOriginalInvoicePdf(company, id);
    // 404 = no proven original on file; 503 = QuickBooks itself failed/timed out (ask again later — NOT "missing")
    if (!result.ok) return Response.json({ error: result.reason, split: result.split, missing: !result.transient, transient: result.transient }, { status: result.transient ? 503 : 404 });
    return new Response(Buffer.from(result.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(result.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Invoice-Original-Source': result.source,
        'X-Invoice-Split': result.split ? '1' : '0',
        ...(result.source === 'attachment' ? { 'X-Invoice-Note': headerDetail('original attached in QuickBooks') } : {}),
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unable to load the invoice PDF.' }, { status: 502 });
  }
}
