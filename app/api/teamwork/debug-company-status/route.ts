import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from '@/lib/teamwork-agm';

// Temporary, one-off diagnostic route — comparing "Internal CSS Status" for
// a known-Active company against a known-Shareholder company, to see if the
// value ever differs from the bulk getCompanies API's other status-like
// fields. Delete after use.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function extractLabelValue(html: string, label: string): string | null {
  const idx = html.indexOf(`${label}:`);
  if (idx < 0) return null;
  const after = html.slice(idx, idx + 600);
  const m = after.match(/<label[^>]*>\s*([\s\S]*?)\s*<\/label>/g);
  if (!m || m.length < 2) return null;
  const valueLabel = m[1];
  const text = valueLabel.replace(/<[^>]+>/g, '').trim();
  return text;
}

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
      results[id.trim()] = {
        status: res.status,
        internalCssStatus: extractLabelValue(html, 'Internal CSS Status'),
        entityStatus: extractLabelValue(html, 'Entity Status'),
      };
    }
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
