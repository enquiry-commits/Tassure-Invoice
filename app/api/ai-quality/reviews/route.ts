import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { listQualityReviews } from '@/lib/ai-quality/review';

// Same gate as /api/ai-learning/candidates (account.admin — effectively
// Vincent-only today, see components/Sidebar.tsx's ADMIN_NODE comment).
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.admin) return NextResponse.json({ error: 'System administrator access required' }, { status: 403 });
  const onlyOpen = req.nextUrl.searchParams.get('all') !== '1';
  try {
    const reviews = await listQualityReviews({ onlyOpen });
    return NextResponse.json({ reviews });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
