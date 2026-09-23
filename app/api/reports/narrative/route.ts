import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import type { ReportsNarrative } from '@/lib/reports-narrative';

export const preferredRegion = 'sin1';

// GET /api/reports/narrative — the AI-written analysis card on the Reports
// page. Same access gate as /api/reports itself (canViewReports) — this
// exposes the identical business data, just narrated.
//
// PURE CACHE READ ONLY, since 2026-09-23 — this route used to also
// generate on a cache miss/staleness and had a `?refresh=true` manual
// bypass. Vincent: "为了不要浪费Token，这个AI Analysis，一周只做一次更新
// 描述，不能refresh, 并且这个更新是按照每星期一早上6点更新" (to avoid
// wasting tokens, update once a week only, no manual refresh, every Monday
// 6am SGT). The ONLY writer to reports_narrative_cache now is the weekly
// cron at app/api/reports/narrative-cron/route.ts — removing the on-demand
// generation path here, not just hiding the UI button, is deliberate: a
// button-only fix would still let anyone hit this URL with `?refresh=true`
// and burn a real API call, which is exactly what Vincent asked to stop.
// If no row exists yet (fresh deploy, before the first Monday run) or the
// only row is shape-stale, this returns `narrative: null` with 200 — a
// normal, expected state for the page to render around, not an error.
function parseCachedNarrative(raw: string): ReportsNarrative | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.insights) || !parsed.insights.length) return null;
    const shapeOk = parsed.insights.every((i: Record<string, unknown>) =>
      typeof i.observedZh === 'string' && typeof i.observedEn === 'string'
      && Array.isArray(i.metricRefs) && Array.isArray(i.notYetProvenZh) && Array.isArray(i.notYetProvenEn)
      && typeof i.nextActionZh === 'string' && typeof i.nextActionEn === 'string'
      && typeof i.confidence === 'string' && (i.driverZh === null || typeof i.driverZh === 'string'));
    return shapeOk ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot view Reports.' }, { status: 403 });

  const sb = createAdminClient();
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

  const parsed = cached ? parseCachedNarrative(cached.narrative) : null;
  if (!parsed) return NextResponse.json({ narrative: null, generatedAt: null });
  return NextResponse.json({ narrative: parsed, generatedAt: cached!.generated_at });
}
