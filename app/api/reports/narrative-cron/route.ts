import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun } from '@/lib/automation-sync';
import { computeReportsData } from '@/app/api/reports/route';
import { generateReportsNarrative, ACTIVE_NARRATIVE_MODEL } from '@/lib/reports-narrative';

// GET /api/reports/narrative-cron — the ONLY thing that ever calls
// generateReportsNarrative() now. Cron-only in practice (see proxy.ts's
// CRON_PATHS + vercel.json's weekly schedule), same withAutomationRun
// wrapper every other scheduled job in this app uses.
//
// Added 2026-09-23 per Vincent: "为了不要浪费Token，这个AI Analysis，一周
// 只做一次更新描述，不能refresh, 并且这个更新是按照每星期一早上6点更新" (to
// avoid wasting tokens, update once a week only, no manual refresh, every
// Monday 6am SGT). app/api/reports/narrative/route.ts — the page's own read
// endpoint — is now a PURE cache read with no generation path at all; this
// route is the only writer to reports_narrative_cache. vercel.json's
// schedule is "0 22 * * 0" (22:00 UTC Sunday = 06:00 SGT Monday, the same
// UTC+8 conversion every other cron in this file already uses).
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

async function runReportsNarrativeCron(): Promise<NextResponse> {
  const data = await computeReportsData();
  const narrative = await generateReportsNarrative(data);
  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { error: insertErr } = await supabase
    .from('reports_narrative_cache')
    .insert({ narrative: JSON.stringify(narrative), model: ACTIVE_NARRATIVE_MODEL, generated_at: now });
  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, generatedAt: now, insightCount: narrative.insights.length });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'reports_narrative', () => runReportsNarrativeCron());
}
