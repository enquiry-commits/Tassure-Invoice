import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { computeReportsData } from '@/app/api/reports/route';
import { generateReportsNarrative, ACTIVE_NARRATIVE_MODEL, type ReportsNarrative } from '@/lib/reports-narrative';

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

// The `narrative` column is plain `text` (no migration needed for round 2's
// structured/bilingual rework, or round 3's Reports V3 Phase 1 schema
// change — see lib/reports-narrative.ts's own header): stores
// JSON.stringify(ReportsNarrative), parsed back on read. A row written by
// an EARLIER schema version is not valid against the CURRENT shape —
// caught and treated as a cache miss rather than crashing or rendering
// with missing fields, so an old cached row never needs manual cleanup; it
// just naturally gets replaced by the next real generation. Round 3
// (2026-09-23) added required observed/metricRefs/notYetProven/nextAction
// fields and made driver nullable — a round-2 cached row has `bodyZh`
// instead, which the new shape check below correctly rejects.
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
    const parsed = cached ? parseCachedNarrative(cached.narrative) : null;
    if (parsed && Date.now() - new Date(cached!.generated_at).getTime() < NARRATIVE_STALE_MS) {
      return NextResponse.json({ narrative: parsed, generatedAt: cached!.generated_at, cached: true });
    }
  }

  try {
    const data = await computeReportsData();
    const narrative = await generateReportsNarrative(data);
    const now = new Date().toISOString();
    const { error: insertErr } = await sb.from('reports_narrative_cache').insert({ narrative: JSON.stringify(narrative), model: ACTIVE_NARRATIVE_MODEL, generated_at: now });
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
