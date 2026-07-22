import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from '@/lib/teamwork-agm';

// Temporary, one-off diagnostic route — raw HTML snippets around "Internal
// CSS Status" / "Entity Status" for two companies, for manual comparison.
// Delete after use.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const ids = (req.nextUrl.searchParams.get('ids') ?? '1075').split(',');

  try {
    const cookie = await getSessionCookie();
    const results: Record<string, unknown> = {};
    for (const id of ids) {
      const res = await fetch(`https://apps.teamworkcss.com/tassure_asia/view_company/${id.trim()}/?comp`, {
        headers: { Cookie: cookie },
      });
      const html = await res.text();
      const idx = html.indexOf('Internal CSS Status');
      results[id.trim()] = {
        status: res.status,
        snippet: idx >= 0 ? html.slice(Math.max(0, idx - 600), idx + 900).replace(/\s+/g, ' ') : 'NOT FOUND',
      };
    }
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
