import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { qbQuery, getValidToken, type QbCompany } from '@/lib/quickbooks';
import { classify } from '@/lib/quickbooks-invoice-incremental';

// GET /api/quickbooks/invoice-lines?company=TAB&id={qbInvoiceId} — live read
// of an invoice's current line items, for pre-filling the edit panel.
// Deliberately has no "not yet sent" gate: reading is safe any time, only
// the update route needs that gate.
export async function GET(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const company = searchParams.get('company');
  const id = searchParams.get('id');
  if (company !== 'TAB' && company !== 'TAC') {
    return NextResponse.json({ error: 'company must be TAB or TAC.' }, { status: 400 });
  }
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'id must be a valid QuickBooks invoice id.' }, { status: 400 });
  }

  const tokenRow = await getValidToken(company as QbCompany);
  if (!tokenRow) return NextResponse.json({ error: `QuickBooks ${company} not connected` }, { status: 503 });

  const result = await qbQuery(`SELECT * FROM Invoice WHERE Id = '${id}'`, company as QbCompany);
  const invoice = result?.rows?.[0];
  if (!invoice) return NextResponse.json({ error: 'Invoice not found in QuickBooks.' }, { status: 404 });

  const rawLines = (invoice.Line as Record<string, unknown>[] | undefined) ?? [];
  const lines = rawLines
    .filter(line => line.DetailType === 'SalesItemLineDetail')
    .map(line => {
      const detail = (line.SalesItemLineDetail as Record<string, unknown>) ?? {};
      const itemRef = (detail.ItemRef as Record<string, unknown>) ?? {};
      const product = String(itemRef.name ?? '');
      const description = String(line.Description ?? '');
      const { type: service } = classify(description, product);
      return {
        service,
        productService: product,
        description,
        qty: Number(detail.Qty ?? 1),
        rate: Number(detail.UnitPrice ?? 0),
      };
    });

  return NextResponse.json({
    syncToken: String(invoice.SyncToken ?? ''),
    docNumber: String(invoice.DocNumber ?? ''),
    txnDate: String(invoice.TxnDate ?? ''),
    total: Number(invoice.TotalAmt ?? 0),
    lines,
  });
}
