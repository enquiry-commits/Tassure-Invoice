import { NextRequest } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export const dynamic = 'force-dynamic';

const VALID_COMPANIES = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

export async function GET(req: NextRequest) {
  // Was `=== 'TAC' ? 'TAC' : 'TAB'` — a real bug: any other value (including
  // a future ?company=TAO before this fix) silently fetched TAB's PDF with
  // no error, rather than the company actually asked for.
  const companyParam = req.nextUrl.searchParams.get('company');
  const company: QbCompany = companyParam === null ? 'TAB' : (companyParam as QbCompany);
  if (!VALID_COMPANIES.has(company)) {
    return Response.json({ error: 'A valid QuickBooks company (TAB, TAC, or TAO) is required.' }, { status: 400 });
  }
  const invoiceId = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!/^[A-Za-z0-9-]+$/.test(invoiceId)) {
    return Response.json({ error: 'A valid QuickBooks invoice id is required.' }, { status: 400 });
  }

  const token = await getValidToken(company);
  if (!token) return Response.json({ error: `QuickBooks ${company} not connected.` }, { status: 503 });

  const response = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/invoice/${invoiceId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text();
    return Response.json({ error: `QuickBooks ${company} PDF request failed: ${detail.slice(0, 240)}` }, { status: response.status });
  }

  const pdf = await response.arrayBuffer();
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
