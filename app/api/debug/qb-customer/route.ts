import { NextRequest, NextResponse } from 'next/server';
import { qbQuery } from '@/lib/quickbooks';

// TEMPORARY — checking whether QB Customer records carry a UEN/ROC field
// anywhere (ResaleNum, CustomField, Notes, etc). Delete after use.
export async function GET(req: NextRequest) {
  const count = Number(req.nextUrl.searchParams.get('count') ?? '15');
  const result = await qbQuery(`SELECT * FROM Customer MAXRESULTS ${count}`, 'TAB');
  return NextResponse.json(result);
}
