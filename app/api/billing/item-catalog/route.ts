import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { fetchBookItemCatalog } from '@/lib/qb-item-catalog';

// GET /api/billing/item-catalog?book=TAB|TAC — the book's live QuickBooks
// item list for Billing Drafts' "Add line" (lib/qb-item-catalog.ts, INV-QB-034).
// A failed QuickBooks read answers 502, never an empty list.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const book = req.nextUrl.searchParams.get('book');
  if (book !== 'TAB' && book !== 'TAC') return NextResponse.json({ error: 'book must be TAB or TAC.' }, { status: 400 });
  try {
    return NextResponse.json({ groups: await fetchBookItemCatalog(book) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : `QuickBooks ${book}'s item list could not be read.` }, { status: 502 });
  }
}
