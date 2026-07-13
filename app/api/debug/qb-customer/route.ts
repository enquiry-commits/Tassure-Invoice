import { NextRequest, NextResponse } from 'next/server';
import { qbQuery } from '@/lib/quickbooks';

// TEMPORARY — checking whether QB Customer records carry a UEN/ROC field.
// Delete after use.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? 'LOYANG BESTCONN TRADING & SERVICES PTE. LTD.';
  const escaped = name.replace(/'/g, "\\'");
  const result = await qbQuery(`SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 1`, 'TAB');
  return NextResponse.json(result);
}
