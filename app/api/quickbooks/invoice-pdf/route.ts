import { NextRequest } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const company: QbCompany = req.nextUrl.searchParams.get('company') === 'TAC' ? 'TAC' : 'TAB';
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
