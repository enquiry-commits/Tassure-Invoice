import { NextRequest } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { nextDocNumber } from '@/lib/qb-invoice-conventions';

export const dynamic = 'force-dynamic';

async function getNext(company: QbCompany, txnDate: string) {
  const token = await getValidToken(company);
  if (!token) return { number: null, connected: false };
  const number = await nextDocNumber(token.access_token, token.realm_id, company, txnDate);
  return { number, connected: true };
}

export async function GET(req: NextRequest) {
  const txnDate = req.nextUrl.searchParams.get('txnDate') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) {
    return Response.json({ error: 'txnDate must be YYYY-MM-DD' }, { status: 400 });
  }

  const [tab, tac, tao] = await Promise.all([getNext('TAB', txnDate), getNext('TAC', txnDate), getNext('TAO', txnDate)]);
  return Response.json({ txnDate, TAB: tab, TAC: tac, TAO: tao }, { headers: { 'Cache-Control': 'no-store' } });
}
