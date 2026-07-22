import { NextRequest, NextResponse } from 'next/server';
import { getValidToken, qbQuery, type QbCompany } from '@/lib/quickbooks';

// Temporary, one-off fix route — clears the erroneous GivenName/MiddleName/
// FamilyName on a QB Customer that was set up as an Individual with the
// company name duplicated across those fields AND CompanyName, causing the
// name to print twice on the invoice PDF's Bill To block. CompanyName/
// DisplayName/PrintOnCheckName are left untouched. Delete after use.
export const dynamic = 'force-dynamic';

const QB_BASE = 'https://quickbooks.api.intuit.com';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const company = (req.nextUrl.searchParams.get('company') === 'TAC' ? 'TAC' : 'TAB') as QbCompany;
  const name = req.nextUrl.searchParams.get('name') ?? 'JZ.M Shipping Pte. Ltd.';
  const apply = req.nextUrl.searchParams.get('apply') === 'true';

  const found = await qbQuery(`SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`, company);
  if (!found || !found.rows.length) return NextResponse.json({ error: 'customer not found' }, { status: 404 });

  const customer = found.rows[0] as Record<string, unknown>;
  const before = {
    Id: customer.Id, SyncToken: customer.SyncToken,
    GivenName: customer.GivenName, MiddleName: customer.MiddleName, FamilyName: customer.FamilyName,
    CompanyName: customer.CompanyName, DisplayName: customer.DisplayName,
  };

  if (!apply) return NextResponse.json({ dryRun: true, before });

  const token = await getValidToken(company);
  if (!token) return NextResponse.json({ error: `QuickBooks ${company} not connected.` }, { status: 503 });

  const payload = {
    Id: customer.Id,
    SyncToken: customer.SyncToken,
    sparse: true,
    GivenName: '',
    MiddleName: '',
    FamilyName: '',
  };

  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/customer?minorversion=65`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return NextResponse.json({ status: res.status, before, raw: json });
}
