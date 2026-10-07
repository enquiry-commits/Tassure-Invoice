// The nightly SG Latest News sync, as a plain function with its collaborators passed in (the database,
// the fetch, the digest, the clock, the Automation Health exceptions), so that its ORDER and its failure
// paths can be run in tests with fakes (test-sg-news.ts rule 7). app/api/sg-news/sync/route.ts only wires
// the real ones in. No server-only imports here: types only. docs/INVARIANTS.md INV-DATA-077, INV-CRON-019.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNewsTitle, type PageLink } from './sg-news-links';
import { pageAll } from './page-all';
import { mergeDailyReport } from './sg-news-report';
import { planSourceSync, silentSources, type FetchFacts, type SourceReport, type StoredNewsItem } from './sg-news-sync-plan';
import type { SgNewsSource } from './sg-news-sources';
import type { ExtractedNewsItem } from './sg-news-fetch';
import type { SgNewsDailyReport } from './sg-news-digest';

// No new source is started after this: the digest call and the saves still need ~100 s of the route's
// 280 s. A run that is killed at the ceiling saves nothing at all (INV-CRON-019). Normal nights take
// 80–155 s in total, so the last source of a normal night starts well before this.
export const SOURCE_START_DEADLINE_MS = 170_000;

// The first time a source is read, everything on its page is "new" — but it is the page's backlog, not
// today's news (IRAS's newest 20 run back to Nov 2025, ISCA's newest is 04 Sep). The backlog is stored, so
// it never shows up later, but this many of its newest items go into the report: NONE (Vincent, 2026-10-07,
// via AskUserQuestion — "只记录、不进报告"). A source marked mayBeEmpty (CSIS) is exempt: anything it ever
// shows is news. See lib/sg-news-sync-plan.ts planSourceSync.
export const FIRST_RUN_REPORT_LIMIT = 0;

// Items already stored are refreshed in batches of this many (one round trip each) instead of one by one.
const TOUCH_CHUNK = 10;

export type FetchOutcome =
  | { items: ExtractedNewsItem[]; links: PageLink[]; finalUrl: string; facts: FetchFacts }
  | { error: string; facts: FetchFacts };

export type SyncDeps = {
  db: SupabaseClient;
  sources: SgNewsSource[];
  today: string;                                   // the SGT date the report belongs to
  now: () => number;
  heartbeat: () => Promise<void>;
  fetchSource: (source: SgNewsSource) => Promise<FetchOutcome>;
  digest: (items: { source: SgNewsSource; items: ExtractedNewsItem[] }[]) => Promise<SgNewsDailyReport>;
  raiseExceptions: (type: string, items: Array<{ key: string; name: string; details: Record<string, unknown> }>) => Promise<void>;
};

export type SyncResult = { status: number; body: Record<string, unknown> };

export async function runSgNewsSync(deps: SyncDeps): Promise<SyncResult> {
  const { db, today } = deps;
  const startedAt = deps.now();
  const sourcesChecked: string[] = [];
  const sourcesFailed: { source: string; error: string }[] = [];
  const reports: SourceReport[] = [];
  const warnings: string[] = [];
  const forDigest: { source: SgNewsSource; items: ExtractedNewsItem[] }[] = [];   // what the report is written about
  const toStore: { source: SgNewsSource; items: ExtractedNewsItem[] }[] = [];     // what is stored once the report is safe

  // Every way out of this function carries what each source showed — including the failures, which are the
  // runs whose facts matter most (withAutomationRun saves the whole reply in automation_sync_runs.summary).
  const failure = (error: string, status: number): SyncResult => ({
    status,
    body: { error, date: today, sourcesChecked: sourcesChecked.length, sourcesFailed: sourcesFailed.length, failures: sourcesFailed, totalMs: deps.now() - startedAt, sources: reports },
  });

  const recordState = async (row: Record<string, unknown>) => {
    const { error } = await db.from('sg_news_sync_state').upsert(row, { onConflict: 'source' });
    if (error) warnings.push(`sync state ${String(row.source)}: ${error.message}`);
  };
  const failSource = async (source: SgNewsSource, error: string, extra: Partial<SourceReport> = {}) => {
    sourcesFailed.push({ source: source.key, error });
    reports.push({ source: source.key, ok: false, error, ...extra });
    await recordState({ source: source.key, last_status: 'error', last_synced_at: new Date(deps.now()).toISOString(), last_error: error });
  };

  for (const source of deps.sources) {
    const sourceStart = deps.now();
    if (sourceStart - startedAt > SOURCE_START_DEADLINE_MS) {
      await failSource(source, 'Not started: the run had already used its time budget (a run killed at the 280 s limit would have saved nothing).');
      continue;
    }
    const result = await deps.fetchSource(source);
    await deps.heartbeat();

    if ('error' in result) {
      await failSource(source, result.error, { facts: result.facts, totalMs: deps.now() - sourceStart });
      continue;
    }

    // Everything stored for THIS source only — a title colliding across two different sources is not a real
    // duplicate. The read must SUCCEED: an empty answer from a failed read would look like a first run.
    let stored: StoredNewsItem[];
    try {
      stored = await pageAll(() => db.from('sg_news_items').select('item_hash, title, url, first_seen_at').eq('source', source.key)) as StoredNewsItem[];
    } catch (err) {
      await failSource(source, `Could not read the stored items: ${err instanceof Error ? err.message : String(err)}`, { facts: result.facts, totalMs: deps.now() - sourceStart });
      continue;
    }

    const plan = planSourceSync({
      stored, extracted: result.items, links: result.links, listingUrls: [source.url, result.finalUrl],
      hashOf: normalizeNewsTitle, firstRunReportLimit: source.mayBeEmpty ? Infinity : FIRST_RUN_REPORT_LIMIT, now: deps.now(),
    });
    const stamp = new Date(deps.now()).toISOString();
    // Safe to repeat, and nothing here can lose anything: items seen again are only touched, and a stored item
    // that never had a link gets the one its headline has on the page right now — never replacing a link.
    for (let i = 0; i < plan.touch.length; i += TOUCH_CHUNK) {
      const { error } = await db.from('sg_news_items').update({ last_seen_at: stamp }).eq('source', source.key).in('item_hash', plan.touch.slice(i, i + TOUCH_CHUNK));
      if (error) warnings.push(`touch ${source.key}: ${error.message}`);
    }
    for (const fill of plan.backfill) {
      const { error } = await db.from('sg_news_items').update({ url: fill.url }).eq('source', source.key).eq('item_hash', fill.item_hash).is('url', null);
      if (error) warnings.push(`link ${source.key}: ${error.message}`);
    }
    if (plan.insert.length) toStore.push({ source, items: plan.insert });
    if (plan.report.length) forDigest.push({ source, items: plan.report });

    sourcesChecked.push(source.key);
    await recordState({ source: source.key, last_status: 'success', last_synced_at: stamp, last_item_count: result.items.length, last_error: null });
    reports.push({
      source: source.key, ok: true, facts: result.facts, extracted: result.items.length, linked: result.items.filter(i => i.url).length,
      newItems: plan.insert.length, reported: plan.report.length, firstRun: plan.firstRun, backfilled: plan.backfill.length, totalMs: deps.now() - sourceStart,
    });
  }

  const totalNew = forDigest.reduce((s, si) => s + si.items.length, 0);
  let merged: ReturnType<typeof mergeDailyReport>;
  try {
    const fresh = await deps.digest(forDigest);
    await deps.heartbeat();

    // A later run on the same day (the page's 「手动运行一次」 button) only sees what is new since the first
    // one, so it must ADD to the day's report, never replace it — see lib/sg-news-report.ts.
    const { data: storedReport, error: storedErr } = await db.from('sg_news_daily_reports').select('report, new_items_count').eq('report_date', today).maybeSingle();
    if (storedErr) return failure(`Could not read today's report: ${storedErr.message}`, 503);
    merged = mergeDailyReport(storedReport as { report: SgNewsDailyReport; new_items_count: number } | null, fresh, totalNew);

    if (merged.changed) {
      const { error: reportErr } = await db.from('sg_news_daily_reports').upsert({
        report_date: today, report: merged.report, new_items_count: merged.newItemsCount,
        sources_checked: sourcesChecked, sources_failed: sourcesFailed, generated_at: new Date(deps.now()).toISOString(),
      }, { onConflict: 'report_date' });
      if (reportErr) return failure(`Report save failed: ${reportErr.message}`, 503);
    }
  } catch (err) {
    // The new items are NOT stored yet, so tomorrow's run finds them again: nothing is lost by failing here.
    return failure(`The report could not be written: ${err instanceof Error ? err.message : String(err)}`, 500);
  }

  // The new items are stored only NOW, once the report that mentions them is saved. Before 2026-10-07 they
  // were stored first, so a digest that failed (or a run killed at the time limit) left them "seen" but in
  // no report — lost for good, since tomorrow's run no longer finds them new. Now the worst case is that
  // they are found and reported again. ignoreDuplicates: a repeated insert is not an error.
  const storeErrors: string[] = [];
  let storedCount = 0;
  const storedAt = new Date(deps.now()).toISOString();
  for (const { source, items } of toStore) {
    const rows = items.map(item => ({
      source: source.key, category: source.category, title: item.title, url: item.url ?? null,
      published_label: item.publishedLabel ?? null, teaser: item.teaser ?? null,
      item_hash: normalizeNewsTitle(item.title), first_seen_at: storedAt, last_seen_at: storedAt,
    }));
    const { error } = await db.from('sg_news_items').upsert(rows, { onConflict: 'source,item_hash', ignoreDuplicates: true });
    if (error) storeErrors.push(`${source.key}: ${error.message}`); else storedCount += rows.length;
  }

  // "success, 0 items" looks exactly like a quiet day (IRAS and ISCA were pointed at menu pages and stored
  // nothing for two weeks). A source that has not refreshed any stored item for 3 days is raised on
  // Automation Health as `source_silent`, and clears itself once items flow again. A health check that
  // cannot read its data raises NOTHING (an unreadable table must not read as "every source is silent")
  // and never fails the run.
  let silent: string[] = [];
  try {
    const lastSeenAt: Record<string, string | null> = {};
    let readable = true;
    for (const s of deps.sources) {
      const { data, error } = await db.from('sg_news_items').select('last_seen_at').eq('source', s.key).order('last_seen_at', { ascending: false }).limit(1);
      if (error) { warnings.push(`silent-source check: ${error.message}`); readable = false; break; }
      lastSeenAt[s.key] = data?.[0]?.last_seen_at ?? null;
    }
    if (readable) {
      const quiet = silentSources({ sources: deps.sources, lastSeenAt, now: deps.now() });
      silent = quiet.map(q => q.key);
      await deps.raiseExceptions('source_silent', quiet.map(q => ({ key: q.key, name: q.name, details: { lastSeenAt: q.lastSeenAt, silentDays: q.silentDays } })));
    }
  } catch (err) {
    warnings.push(`silent-source check: ${err instanceof Error ? err.message : String(err)}`);
  }

  // `sources` is what makes a real run documentable: withAutomationRun saves this whole reply in
  // automation_sync_runs.summary, and Vercel keeps runtime logs for only an hour. A store failure fails the
  // RUN (the report itself is saved): left green, the same items would be reported again every night.
  return {
    status: 200,
    body: {
      ok: storeErrors.length === 0, date: today, sourcesChecked: sourcesChecked.length, sourcesFailed: sourcesFailed.length,
      newItems: totalNew, failures: sourcesFailed, reportKept: !merged.changed,
      stored: storedCount, silent, warnings, totalMs: deps.now() - startedAt, sources: reports,
      ...(storeErrors.length ? { error: `Stored ${storedCount} new items; could not store the rest (${storeErrors.join('; ')}). The report was saved, so they will be found and reported again.` } : {}),
    },
  };
}
