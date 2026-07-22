import { NextRequest, NextResponse } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';

// Temporary, one-off diagnostic route — inspecting a QB Customer's stored
// BillAddr to find why "JZ.M Shipping Pte. Ltd." prints twice on the
// invoice PDF's Bill To block. Delete after use.
export const dynamic = 'force-dynamic';

const QB_BASE = 'https://quickbooks.api.intuit.com';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const company = (req.nextUrl.searchParams.get('company') === 'TAC' ? 'TAC' : 'TAB') as QbCompany;
  const name = req.nextUrl.searchParams.get('name') ?? 'JZ.M Shipping Pte. Ltd.';

  const token = await getValidToken(company);
  if (!token) return NextResponse.json({ error: `QuickBooks ${company} not connected.` }, { status: 503 });

  const query = `SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`;
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  const json = await res.json();
  return NextResponse.json({ status: res.status, raw: json });
}
