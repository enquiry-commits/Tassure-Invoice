import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { computeReportsData } from '@/app/api/reports/route';
import { generateReportsNarrative } from '@/lib/reports-narrative';

export const preferredRegion = 'sin1';

// GET /api/reports/narrative — the AI-written analysis card on the Reports
// page. Same access gate as /api/reports itself (canViewReports) — this
// exposes the identical business data, just narrated.
//
// Cached (reports_narrative_cache, newest row wins) for 24h so the page
// doesn't pay for a fresh Claude call on every single view — Reports'
// underlying numbers don't meaningfully shift within a day. `?refresh=true`
// forces regeneration (the page's own manual refresh button).
const NARRATIVE_STALE_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot view Reports.' }, { status: 403 });

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const sb = createAdminClient();

  if (!forceRefresh) {
    const { data: cached, error: cacheErr } = await sb
      .from('reports_narrative_cache')
      .select('narrative, generated_at')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cacheErr) {
      const hint = /reports_narrative_cache/.test(cacheErr.message)
        ? ' — run scripts/add-reports-narrative-cache.sql in the Supabase SQL editor first'
        : '';
      return NextResponse.json({ error: cacheErr.message + hint }, { status: 503 });
    }
    if (cached && Date.now() - new Date(cached.generated_at).getTime() < NARRATIVE_STALE_MS) {
      return NextResponse.json({ narrative: cached.narrative, generatedAt: cached.generated_at, cached: true });
    }
  }

  try {
    const data = await computeReportsData();
    const narrative = await generateReportsNarrative(data);
    const now = new Date().toISOString();
    const { error: insertErr } = await sb.from('reports_narrative_cache').insert({ narrative, model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5', generated_at: now });
    if (insertErr) {
      // A failed cache WRITE must not throw away a real, already-generated
      // analysis — the reader still gets today's write-up, it just won't be
      // reused on the next view (regenerates again, extra cost but not
      // broken). Only a READ failure above (table genuinely missing) blocks.
      return NextResponse.json({ narrative, generatedAt: now, cached: false, cacheWriteError: insertErr.message });
    }
    return NextResponse.json({ narrative, generatedAt: now, cached: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
