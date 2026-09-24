import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { loadQuotationData, QuotationDataError } from '@/lib/quotation-data';

export type { QuotationData, QuotationBookStatus } from '@/lib/quotation-data';
export type { QuotationRow, QuotationTraceInvoice, QuotationStatusGroup } from '@/lib/quotation-trace';

// GET /api/billing/quotation — backs app/billing/quotation/page.tsx: every
// QuickBooks Estimate ("Quotation") across TAB/TAC/TAO, read live, and — for a
// Closed one — which book(s) its invoice(s) were issued in. Gated on
// canViewQuotation (Vincent-only for now): proxy.ts guards the PAGE path, but
// never API routes by permission, so this route must check for itself.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewQuotation) return NextResponse.json({ error: 'Your account cannot view quotations.' }, { status: 403 });

  try {
    const data = await loadQuotationData();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: err instanceof QuotationDataError ? 503 : 500 });
  }
}
