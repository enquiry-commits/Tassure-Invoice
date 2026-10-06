import { NextRequest } from 'next/server';
import { getClientInvoicePdf } from '@/lib/client-invoice-pdf';
import { headerDetail } from '@/lib/content-disposition';
import type { QbCompany } from '@/lib/quickbooks';

// GET /api/billing/client-invoice-pdf?company=TAB&id=123 — the invoice PDF a
// CLIENT receives (lib/client-invoice-pdf.ts, INV-QB-029): each service once
// at its full amount when accounting has split it, QuickBooks' own PDF
// otherwise. Email Drafts attachments and Billing Drafts' Save PDF use it;
// staff-only invoice chips keep /api/quickbooks/invoice-pdf (the original).
// X-Client-Invoice-Fallback (URI-encoded) is set when the invoice IS split
// but QuickBooks' own PDF is being sent anyway, so staff can be told why.
// Signed-in only (proxy.ts guards every /api route).
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';
// A split invoice first looks for its original among the files attached in
// QuickBooks (INV-QB-037), which adds a few QuickBooks calls.
export const maxDuration = 60;

const BOOKS = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!company || !BOOKS.has(company)) return Response.json({ error: 'company must be TAB, TAC or TAO' }, { status: 400 });
  if (!/^\d+$/.test(id)) return Response.json({ error: 'A valid QuickBooks invoice id is required.' }, { status: 400 });
  try {
    const pdf = await getClientInvoicePdf(company, id);
    return new Response(Buffer.from(pdf.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Client-Invoice-Source': pdf.source,
        ...(pdf.fallbackReason ? { 'X-Client-Invoice-Fallback': headerDetail(pdf.fallbackReason) } : {}),
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unable to load the invoice PDF.' }, { status: 502 });
  }
}
