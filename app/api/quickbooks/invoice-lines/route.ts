import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { type QbCompany } from '@/lib/quickbooks';
import { getLiveInvoice } from '@/lib/quickbooks-invoice-lines';

// GET /api/quickbooks/invoice-lines?company=TAB&id={qbInvoiceId} — live read
// of an invoice's current line items, for pre-filling the edit panel.
// Deliberately has no "not yet sent" gate: reading is safe any time, only
// the update route needs that gate.
//
// 2026-09-09: the actual QuickBooks read moved to lib/quickbooks-invoice-
// lines.ts's getLiveInvoice() (copied verbatim, not retyped) so the
// assistant chat's invoice-edit preview can reuse the exact same call
// instead of re-deriving it — this route is now just the HTTP wrapper.
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

  let invoice;
  try {
    invoice = await getLiveInvoice(company as QbCompany, id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
  if (!invoice) return NextResponse.json({ error: 'Invoice not found in QuickBooks.' }, { status: 404 });

  return NextResponse.json(invoice);
}
