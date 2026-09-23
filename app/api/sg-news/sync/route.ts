import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun, type AutomationRun } from '@/lib/automation-sync';
import { SG_NEWS_SOURCES } from '@/lib/sg-news-sources';
import { fetchAndExtractSource, type ExtractedNewsItem } from '@/lib/sg-news-fetch';
import { generateDailyDigest } from '@/lib/sg-news-digest';
import { todaySGT } from '@/lib/date';

// GET /api/sg-news/sync — the daily "SG Latest News" job (Vincent,
// 2026-09-23: "每天早上走一轮...每天要写出一份报告出来给我"). Cron-only in
// practice (see proxy.ts's CRON_PATHS + vercel.json), same
// withAutomationRun wrapper every other daily job in this app uses.
//
// Real work budget: 9 sources x (Playwright render + 1 Claude extraction
// call) + 1 Claude digest call. Each Playwright fetch alone can take
// 10-20s with the render-settle wait (lib/sg-news-fetch.ts), so this
// genuinely needs Vercel's full ceiling, not the 60s soa_owners/audit gets
// by with — run sequentially, not in parallel, deliberately: 9 concurrent
// Chromium launches on one Vercel invocation is exactly the kind of thing
// docs/INVARIANTS.md INV-CRON-013 already burned this app on once (shared
// /tmp exhaustion) — sequential is slower but the proven-safe shape.
export const maxDuration = 280;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// Lowercased, punctuation-collapsed — the de-dup key. Deliberately NOT
// lib/company-name.ts's normalize(): that function strips "Pte Ltd"/"Sdn
// Bhd"/FKA-clauses, which is company-name-specific and irrelevant (and
// could even wrongly collide two different real headlines) for arbitrary
// news titles from 9 unrelated sites.
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function syncSgNews(run: AutomationRun): Promise<NextResponse> {
  const supabase = createAdminClient();
  const today = todaySGT();
  const sourcesChecked: string[] = [];
  const sourcesFailed: { source: string; error: string }[] = [];
  const newItemsBySource: { source: typeof SG_NEWS_SOURCES[number]; items: ExtractedNewsItem[] }[] = [];

  for (const source of SG_NEWS_SOURCES) {
    const result = await fetchAndExtractSource(source);
    await run.heartbeat();

    if ('error' in result) {
      sourcesFailed.push({ source: source.key, error: result.error });
      await supabase.from('sg_news_sync_state').upsert({
        source: source.key, last_status: 'error', last_synced_at: new Date().toISOString(), last_error: result.error,
      }, { onConflict: 'source' });
      continue;
    }
    sourcesChecked.push(source.key);

    // Existing hashes for THIS source only — a title colliding across two
    // different sources is not a real duplicate.
    const { data: existing } = await supabase.from('sg_news_items').select('item_hash').eq('source', source.key);
    const knownHashes = new Set((existing ?? []).map(r => r.item_hash));

    const freshItems: ExtractedNewsItem[] = [];
    const now = new Date().toISOString();
    for (const item of result.items) {
      const hash = normalizeTitle(item.title);
      if (!hash) continue;
      if (knownHashes.has(hash)) {
        // Seen before — just touch last_seen_at, not a new item for today's digest.
        await supabase.from('sg_news_items').update({ last_seen_at: now }).eq('source', source.key).eq('item_hash', hash);
        continue;
      }
      freshItems.push(item);
      knownHashes.add(hash); // guards against the same item appearing twice in one page's own extraction
      await supabase.from('sg_news_items').insert({
        source: source.key, category: source.category, title: item.title, url: item.url ?? null,
        published_label: item.publishedLabel ?? null, teaser: item.teaser ?? null,
        item_hash: hash, first_seen_at: now, last_seen_at: now,
      });
    }
    if (freshItems.length) newItemsBySource.push({ source, items: freshItems });

    await supabase.from('sg_news_sync_state').upsert({
      source: source.key, last_status: 'success', last_synced_at: now, last_item_count: result.items.length, last_error: null,
    }, { onConflict: 'source' });
  }

  const totalNew = newItemsBySource.reduce((s, si) => s + si.items.length, 0);
  const report = await generateDailyDigest(newItemsBySource);
  await run.heartbeat();

  const { error: reportErr } = await supabase.from('sg_news_daily_reports').upsert({
    report_date: today, report, new_items_count: totalNew,
    sources_checked: sourcesChecked, sources_failed: sourcesFailed, generated_at: new Date().toISOString(),
  }, { onConflict: 'report_date' });
  if (reportErr) return NextResponse.json({ error: `Report save failed: ${reportErr.message}` }, { status: 503 });

  return NextResponse.json({
    ok: true, date: today, sourcesChecked: sourcesChecked.length, sourcesFailed: sourcesFailed.length,
    newItems: totalNew, failures: sourcesFailed,
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'sg_news_sync', syncSgNews, 15);
}
