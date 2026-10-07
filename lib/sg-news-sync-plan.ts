// The decisions of the nightly SG Latest News sync, kept apart from the database and the browser so
// they can be tested on their own (test-sg-news.ts). No server-only imports. Council review and an
// independent code review of 2026-10-07 (docs/INVARIANTS.md INV-DATA-077, INV-CRON-019).
import { attachLinks, contestedAddresses, planLinkBackfill, urlIdentity, type PageLink } from './sg-news-links';

// ── what the fetch saw, per source ─────────────────────────────────────────────────────────────
// Saved in automation_sync_runs.summary (withAutomationRun stores the route's JSON), so a real
// Vercel run documents itself and can be read back without triggering anything. Vercel Hobby keeps
// runtime logs for only 1 hour, so this is the only record that survives to the next morning.
export type FetchFacts = {
  status: number | null;      // HTTP status of the page itself (page.goto does NOT throw on 403 / 404)
  finalUrl: string | null;    // where the browser ended up after redirects
  chars: number;              // length of the page text the extractor read
  links: number;              // anchors collected from the page
  headingLinks: number;       // of those, links that carry their own heading (card links)
  fetchMs: number;
  attempts: number;           // browser launches the fetch needed (3 = all retries used)
  blockedHeavy: boolean | null; // the successful attempt blocked image / media / font requests (the last retry does not)
  tmpFreeMB: number | null;   // free space in /tmp — Chromium's shared memory lives there (INV-CRON-013)
  rssMB: number | null;       // memory of the function
};

export type SourceReport = {
  source: string;
  ok: boolean;
  error?: string;
  facts?: FetchFacts;
  extracted?: number;         // items the extractor returned (everything relevant on the page, not just new)
  linked?: number;            // of those, items that got an article link
  newItems?: number;          // never seen before
  reported?: number;          // of the new ones, how many went into the daily report
  firstRun?: boolean;         // nothing was stored for this source yet: its page was the backlog
  backfilled?: number;        // stored items that had no link and got one this run
  totalMs?: number;
};

// A page that came back with an HTTP error or almost no text was not read. Without this check the
// extractor was handed CSIS's "403 - Forbidden" page (50 characters) and the run was recorded as
// "success, 0 items": page.goto only throws on network errors. Every real source gives well over
// 1,800 characters.
export const MIN_PAGE_CHARS = 300;
export function pageProblem(facts: { status: number | null; chars: number }): string | null {
  if (facts.status !== null && facts.status >= 400) return `HTTP ${facts.status}`;
  if (facts.chars < MIN_PAGE_CHARS) return `almost no text on the page (${facts.chars} characters)`;
  return null;
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export type RenderedPageInput = {
  status: number | null; text: string; links: PageLink[]; finalUrl: string; ms: number; attempts: number; blockedHeavy: boolean;
};

export function factsOfPage(page: RenderedPageInput, env: { tmpFreeMB: number | null; rssMB: number | null }): FetchFacts {
  return {
    status: page.status, finalUrl: page.finalUrl, chars: page.text.trim().length, links: page.links.length,
    headingLinks: page.links.filter(l => l.heading).length, fetchMs: page.ms, attempts: page.attempts, blockedHeavy: page.blockedHeavy,
    tmpFreeMB: env.tmpFreeMB, rssMB: env.rssMB,
  };
}

/**
 * What to do with a page the browser returned: record the facts, refuse a page that was not really
 * read (the extractor is never called for it — a blocked page is a failure, not "0 items"), and
 * otherwise extract and attach each headline's article link. The extractor is a parameter so this can
 * be tested without a model; the links are matched against the configured AND the final address.
 */
export async function readRenderedPage<T extends { title: string; url: string | null }>(input: {
  source: { url: string };
  page: RenderedPageInput;
  env: { tmpFreeMB: number | null; rssMB: number | null };
  extract: (text: string) => Promise<T[]>;
}): Promise<{ facts: FetchFacts; error: string } | { facts: FetchFacts; items: T[]; links: PageLink[]; finalUrl: string }> {
  const { page } = input;
  const facts = factsOfPage(page, input.env);
  const problem = pageProblem(facts);
  if (problem) {
    const said = page.text.replace(/\s+/g, ' ').trim().slice(0, 100);
    return { facts, error: `${problem} from ${hostOf(input.source.url)}${said ? ` — the page says: "${said}"` : ''}` };
  }
  const items = attachLinks(await input.extract(page.text), page.links, [input.source.url, page.finalUrl]);
  return { facts, items, links: page.links, finalUrl: page.finalUrl };
}

// ── what to do with one source's extraction ────────────────────────────────────────────────────
export type StoredNewsItem = { item_hash: string; title: string; url: string | null; first_seen_at?: string | null };

export type SourcePlan<T> = {
  touch: string[];                                        // stored items seen again: refresh last_seen_at
  backfill: Array<{ item_hash: string; url: string }>;    // stored items without a link that now get one
  insert: T[];                                            // items never seen before: to be stored (with their link, if one is safe)
  report: T[];                                            // the part of `insert` that goes into the daily report
  firstRun: boolean;                                      // nothing stored for this source yet, and the page gave items
};

// A stored item without a link is given one in hindsight only while its card can still be on the page
// (the page lists 7 days of reports). An older item whose headline happens to recur would otherwise
// take today's article for last week's card, and every night's work would grow with the backlog.
export const BACKFILL_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * The first time a source is read, EVERYTHING on its page is "new" — but it is the page's backlog,
 * not today's news (IRAS's newest 20 run back to Nov 2025, ISCA's newest is 04 Sep). It is stored, so
 * it never shows up later, but only `firstRunReportLimit` of it goes into the report; the digest has a
 * token ceiling and the backlog would push the day's real news out of it. A source that normally has
 * nothing to report (CSIS) passes Infinity: anything it ever shows is news.
 * `stored` must come from a read that SUCCEEDED: an empty list from a failed read is not "first run".
 *
 * ONE page, ONE headline holds across everything this run writes — the stored items that already have a
 * link, the links being filled in, and the new items — not just within each list: an older headline that
 * only matched inside a newer headline's link text used to get the newer headline's article.
 */
export function planSourceSync<T extends { title: string; url: string | null }>(input: {
  stored: StoredNewsItem[];
  extracted: T[];
  links: PageLink[];
  listingUrls: string[];
  hashOf: (title: string) => string;
  firstRunReportLimit: number;
  now?: number;
  backfillWindowMs?: number;
}): SourcePlan<T> {
  const known = new Set(input.stored.map(s => s.item_hash));
  const seen = new Set<string>();
  const touch: string[] = [];
  let insert: T[] = [];
  for (const item of input.extracted) {
    const hash = input.hashOf(item.title);
    if (!hash || seen.has(hash)) continue;      // the same item twice on one page is one item
    seen.add(hash);
    if (known.has(hash)) touch.push(hash); else insert.push(item);
  }

  const now = input.now ?? Date.now();
  const windowMs = input.backfillWindowMs ?? BACKFILL_WINDOW_MS;
  const recent = (s: StoredNewsItem) => {
    const seenAt = s.first_seen_at ? Date.parse(s.first_seen_at) : NaN;
    return Number.isNaN(seenAt) || now - seenAt <= windowMs;
  };
  // Items that already have a link stay in the list: they are the "taken" addresses.
  let backfill = planLinkBackfill(input.stored.filter(s => s.url || recent(s)), input.links, input.listingUrls);

  const titleOf = new Map(input.stored.map(s => [s.item_hash, s.title]));
  const contested = contestedAddresses([
    ...input.stored.flatMap(s => (s.url ? [{ title: s.title, url: s.url }] : [])),
    ...backfill.map(b => ({ title: titleOf.get(b.item_hash) ?? b.item_hash, url: b.url })),
    ...insert.flatMap(i => (i.url ? [{ title: i.title, url: i.url }] : [])),
  ]);
  backfill = backfill.filter(b => !contested.has(urlIdentity(b.url)));
  insert = insert.map(i => (i.url && contested.has(urlIdentity(i.url)) ? { ...i, url: null } : i));

  const firstRun = input.stored.length === 0 && insert.length > 0;
  return {
    touch,
    backfill,
    insert,
    report: firstRun ? insert.slice(0, Math.max(0, input.firstRunReportLimit)) : insert,
    firstRun,
  };
}

// ── a source that has gone quiet ───────────────────────────────────────────────────────────────
// "success, 0 items" looks exactly like a quiet day, and was the whole story of IRAS and ISCA (their
// URLs were menu pages) — no item was ever stored for two weeks and nothing said so. The extractor
// lists everything relevant on the page, not only what is new, so every healthy source refreshes
// `last_seen_at` on its stored items every night; a source whose newest `last_seen_at` is empty or
// older than `afterMs` has not been read successfully for that long. (A source whose page really has
// nothing relevant for 3 nights is flagged too, and clears itself — that is the price of the check.)
export const SILENT_AFTER_MS = 3 * 24 * 3600 * 1000;

export function silentSources(input: {
  sources: Array<{ key: string; name: string; mayBeEmpty?: boolean }>;
  lastSeenAt: Record<string, string | null | undefined>;
  now: number;
  afterMs?: number;
}): Array<{ key: string; name: string; lastSeenAt: string | null; silentDays: number | null }> {
  const after = input.afterMs ?? SILENT_AFTER_MS;
  return input.sources.flatMap(s => {
    if (s.mayBeEmpty) return [];
    const last = input.lastSeenAt[s.key] ?? null;
    const age = last ? input.now - Date.parse(last) : null;
    if (age !== null && !Number.isNaN(age) && age <= after) return [];
    return [{ key: s.key, name: s.name, lastSeenAt: last, silentDays: age === null || Number.isNaN(age) ? null : Math.floor(age / 86_400_000) }];
  });
}
