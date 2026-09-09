import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { getCompanyActivitySummary, getPersonActivitySummary } from '@/lib/activity-data';

// Real behavioral analytics for leadership — Vincent, 2026-09-08: "Vincent
// 和管理层，可以调用全部的数据来继续单独人员的了解，又或者是整体公司人员
// 的了解" (Vincent and management can pull all the data to understand an
// individual staff member, or the whole company). Originally gated on
// ApprovedAccount.canViewActivityInsights (given to Vincent/Cindy/Samuell/
// Yee Soon); narrowed to `admin` (Vincent only) 2026-09-09 per Vincent
// moving this into the Admin nav group ("只有Vincent 可以看到") — a real
// server-side 403, not just hidden UI, same enforcement pattern as
// /api/reports. `canViewActivityInsights` itself is untouched and still
// gates the unrelated AI Learning candidates cross-staff view for those 3
// accounts — only this route's own guard changed.
//
// ?email=<address> returns that one person's own summary; omitted returns
// the whole-company summary. Both read the exact same
// user_activity_events rows via lib/activity-data.ts, so there's no
// separate "individual" vs "company" computation to drift apart.
const STAFF_DIRECTORY = APPROVED_ACCOUNTS.map(a => ({ email: a.email, name: a.name }));

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.admin) return NextResponse.json({ error: 'Your account cannot view Activity Insights.' }, { status: 403 });

  const email = req.nextUrl.searchParams.get('email');
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30, 1), 180);

  try {
    if (email) {
      const summary = await getPersonActivitySummary(email, days);
      return NextResponse.json({ scope: 'person' as const, summary, staffDirectory: STAFF_DIRECTORY });
    }
    const summary = await getCompanyActivitySummary(days);
    return NextResponse.json({ scope: 'company' as const, summary, staffDirectory: STAFF_DIRECTORY });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
