import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from '@/lib/teamwork-agm';

// Temporary, one-off diagnostic route — deployed to locate the raw field
// name behind TeamWork's "Internal CSS Status" (visible on the
// view_company/{id} particulars page, distinct from the "Entity Status"
// field already synced as companies.tw_status). Delete after use.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id') ?? '1075';

  const cookie = await getSessionCookie();
  const res = await fetch(`https://apps.teamworkcss.com/tassure_asia/view_company/${id}/?comp`, {
    headers: { Cookie: cookie },
  });
  const html = await res.text();

  const idx = html.indexOf('Internal CSS Status');
  const snippet = idx >= 0 ? html.slice(Math.max(0, idx - 400), idx + 800) : null;

  return NextResponse.json({
    status: res.status,
    foundLabel: idx >= 0,
    snippet,
    htmlLength: html.length,
  });
}
