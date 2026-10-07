// The SG Latest News daily report is stored once per Singapore day (`report_date`). The nightly cron
// is the normal writer, but the page also has a 「手动运行一次」 button that runs the SAME sync again
// in the middle of the day. A second run only sees what is NEW since the first, so its digest used to
// REPLACE the day's report: with nothing new it became "今天9个来源都没有发现新的…", and the cards Vincent
// was looking at disappeared (found 2026-10-07 while checking why 「来源页」 showed a front page).
// A later run on the same day therefore ADDS to the report and never replaces it. No server-only
// imports: testable on its own (test-sg-news.ts).
import type { SgNewsDailyReport } from './sg-news-digest';
import { normalizeNewsTitle } from './sg-news-links';

type Titled = { title: string };

// Existing items first, then any new ones whose headline is not already there.
function union<T extends Titled>(existing: T[] = [], fresh: T[] = []): T[] {
  const seen = new Set(existing.map(i => normalizeNewsTitle(i.title)));
  return [...existing, ...fresh.filter(i => {
    const key = normalizeNewsTitle(i.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

/**
 * What to store for a day's report after a run.
 * - nothing stored yet: the fresh digest as is;
 * - already stored and this run found nothing new: keep the stored report untouched;
 * - already stored and this run found new items: the stored report plus the new items. The stored
 *   summary is kept as it was (it cannot be rewritten without another AI call), so it may not
 *   mention the late additions.
 */
export function mergeDailyReport(
  existing: { report: SgNewsDailyReport; new_items_count: number } | null,
  fresh: SgNewsDailyReport,
  freshCount: number,
): { report: SgNewsDailyReport; newItemsCount: number; changed: boolean } {
  if (!existing?.report) return { report: fresh, newItemsCount: freshCount, changed: true };
  if (freshCount === 0) return { report: existing.report, newItemsCount: existing.new_items_count ?? 0, changed: false };
  return {
    report: {
      ...existing.report,
      policyItems: union(existing.report.policyItems, fresh.policyItems),
      newsItems: union(existing.report.newsItems, fresh.newsItems),
    },
    newItemsCount: (existing.new_items_count ?? 0) + freshCount,
    changed: true,
  };
}
