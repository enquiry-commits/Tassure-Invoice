// Source links for SG Latest News (2026-10-07). The page text the extractor reads
// (`document.body.innerText`) carries no hrefs, so every stored item had `url: null`
// and the cards could not link to their source. The fetch now also collects the
// page's real anchors, and these helpers match them to the extracted headlines by
// title — deterministically, never by asking the model to produce a URL. No imports:
// shared by the fetcher, the sync route and the API, and testable on its own.
//
// Matching rules (docs/INVARIANTS.md INV-DATA-077). Tested on the live pages the same day
// in a real browser: The Business Times, The Straits Times, 联合早报 and MOM all give
// exact headline matches to article URLs. The first version also matched when a SHORT link
// text was merely a piece of the headline — on MOM, the menu link "Workplace safety and
// health" matched "Opening Address at Workplace Safety and Health Awards 2026" and the card
// linked to a section page, the very thing this feature is meant to avoid. So now only
// these count: the exact headline; the headline plus a little extra link text (a date, a
// category, "5 min read"); or the site's own shortened link text (a prefix of the headline).
//
// Card links (ACRA, ISCA — checked live the same day): the whole card is ONE <a> wrapping a
// date, tags and a description around a heading, so its text is 175–424 characters against a
// headline of 13–120 and the rules above rightly refuse it (ACRA matched 1 of 11 headlines).
// The card's heading element IS the headline, so the fetcher also hands over that heading
// (only when the link holds exactly one) and an exact match on it counts like an exact link
// text. Nothing else is loosened: a long link text alone is still never enough.
//
// A wrong link is worse than a missing one (a card without a link falls back to its source
// page), so three more refusals (council review, 2026-10-07): ONE headline must point at ONE
// page — candidates that disagree give no link; ONE page must belong to ONE headline — an
// address two different headlines both matched is a section tile or a carousel, so neither
// gets it (`contestedAddresses`, applied by the sync across everything a run writes); and a
// tag / topic / category / author / search page is never an article.

export type PageLink = { text: string; href: string; heading?: string };

// The listing page may be given as a list: the address configured for the source AND the one
// the browser actually ended on — zaobao and ICA now redirect, so the configured path is no
// longer the page's own path and a link to the page itself would slip through as "an article".
export type ListingUrls = string | string[] | undefined;
const listingList = (u: ListingUrls): string[] => (Array.isArray(u) ? u : u ? [u] : []);

// Same normalisation the de-dup hash uses (sync route), so a stored item and a
// freshly extracted one with the same title always compare equal.
export function normalizeNewsTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const MIN_CONTAINMENT_CHARS = 20; // avoid a short link text ("News") matching inside a long title
const MAX_EXTRA_LINK_TEXT = 2;    // link text up to 2x the headline = headline + date/category/"min read"
const MIN_TRUNCATED_SHARE = 0.7;  // a cut-short link text must still carry 70% of the headline

// First path segments that are lists of articles, never an article: The Straits Times links a
// headline's tag ("Vaping crisis") to /tags/e-cigarettesvaping, with the tag as the link text.
const LISTING_SEGMENTS = new Set(['tag', 'tags', 'topic', 'topics', 'category', 'categories', 'author', 'authors', 'search']);

// A link that cannot be THE article: the site's front page, a tag / topic / author page, or the
// listing page itself or a parent of it (a menu / breadcrumb link). The listing's own children
// are exactly what we want.
function isSectionLink(href: string, listingUrls?: ListingUrls): boolean {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, '');
    if (!path) return true;
    if (LISTING_SEGMENTS.has((path.split('/')[1] ?? '').toLowerCase())) return true;
    for (const listing of listingList(listingUrls)) {
      const l = new URL(listing);
      const listingPath = l.pathname.replace(/\/+$/, '');
      if (u.hostname === l.hostname && (path === listingPath || listingPath.startsWith(`${path}/`))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Which PAGE an address is, for comparing two of them: no fragment, no trailing slash, no "www.",
// no scheme, no tracking parameters (?ref=latest-top-story, utm_*) — but a real parameter stays,
// because ISCA's articles are /content-item?id=<uuid> and the id IS the page.
const TRACKING_PARAM = /^(utm_.+|ref|fbclid|gclid|mc_cid|mc_eid|cmpid)$/i;
export function urlIdentity(href: string): string {
  try {
    const u = new URL(href);
    const query = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
  } catch {
    return href;
  }
}

function hasTrackingParam(href: string): boolean {
  try { return [...new URL(href).searchParams.keys()].some(k => TRACKING_PARAM.test(k)); } catch { return false; }
}

// A link list is prepared ONCE per page — the links are checked against the listing and normalised —
// and then looked up per headline. Doing that work inside the per-headline loop cost 2 s for 200
// stored headlines against 2,500 links and 17 s for 1,000, per source, every night.
type Prepared = { link: PageLink; text: string; heading: string; identity: string };
export type PreparedLinks = Prepared[];

export function prepareLinks(links: PageLink[], listingUrls?: ListingUrls): PreparedLinks {
  const skip = listingList(listingUrls);
  return links
    .filter(l => /^https?:\/\//i.test(l.href) && !skip.includes(l.href) && !l.href.endsWith('#') && !isSectionLink(l.href, listingUrls))
    .map(link => ({ link, text: normalizeNewsTitle(link.text), heading: link.heading ? normalizeNewsTitle(link.heading) : '', identity: urlIdentity(link.href) }));
}

// ONE headline, ONE page. Candidates that point at different pages cannot all be right, and which
// one is cannot be told from the page — so no link at all. (Before 2026-10-07 the deepest address
// won; ISCA's articles are /content-item?id=… — a single path segment — so any deeper link with the
// same title, a featured tile or a hidden menu entry, would have beaten the real article.) Several
// links to the SAME page (a featured block and the list entry, the same address with and without a
// tracking parameter or as http): the clean one, then the https one, then page order.
function pickUnique(candidates: Prepared[]): string | null {
  if (new Set(candidates.map(c => c.identity)).size !== 1) return null;
  const rank = (c: Prepared) => (hasTrackingParam(c.link.href) ? 2 : 0) + (/^https:/i.test(c.link.href) ? 0 : 1);
  return candidates.reduce((best, c) => (rank(c) < rank(best) ? c : best)).link.href;
}

export function findLinkInPrepared(title: string, prepared: PreparedLinks): string | null {
  const wanted = normalizeNewsTitle(title);
  if (!wanted) return null;

  // 1. exact (normalised) match on the link text, or on the heading inside a card link
  const exact = prepared.filter(p => p.text === wanted || (p.heading !== '' && p.heading === wanted));
  if (exact.length) return pickUnique(exact);

  // 2. near-exact: the closest by length wins; if the closest ones are different pages, no link
  let top: Prepared[] = [];
  let topCloseness = 0;
  for (const p of prepared) {
    const t = p.text;
    if (!t) continue;
    const headlinePlusExtras = wanted.length >= MIN_CONTAINMENT_CHARS && t.length > wanted.length && t.length <= wanted.length * MAX_EXTRA_LINK_TEXT && t.includes(wanted);
    const cutShort = t.length >= MIN_CONTAINMENT_CHARS && wanted.length > t.length && t.length >= wanted.length * MIN_TRUNCATED_SHARE && wanted.startsWith(t);
    if (!headlinePlusExtras && !cutShort) continue;
    const closeness = Math.min(t.length, wanted.length) / Math.max(t.length, wanted.length);
    if (closeness > topCloseness) { top = [p]; topCloseness = closeness; }
    else if (closeness === topCloseness) top.push(p);
  }
  return top.length ? pickUnique(top) : null;
}

export function findLinkForTitle(title: string, links: PageLink[], listingUrls?: ListingUrls): string | null {
  return findLinkInPrepared(title, prepareLinks(links, listingUrls));
}

// ONE page, ONE headline. The addresses that two or more DIFFERENT headlines (different normalised
// titles) claim: a section tile, a carousel — or a short headline that only matched inside a longer
// one's link text. Nobody gets such an address. The sync applies this across everything a run is
// about to write (stored items that already have a link, links being filled in, new items); the
// same headline twice is not a conflict.
export function contestedAddresses(claims: Array<{ title: string; url: string }>): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const c of claims) {
    const key = urlIdentity(c.url);
    owners.set(key, (owners.get(key) ?? new Set<string>()).add(normalizeNewsTitle(c.title)));
  }
  return new Set([...owners].filter(([, titles]) => titles.size > 1).map(([key]) => key));
}

function withoutContested(found: Array<{ title: string; url: string | null }>, taken: Array<{ title: string; url: string }> = []): Array<string | null> {
  const contested = contestedAddresses([...taken, ...found.flatMap(f => (f.url ? [{ title: f.title, url: f.url }] : []))]);
  return found.map(f => (f.url && !contested.has(urlIdentity(f.url)) ? f.url : null));
}

// Fills `url` on items that have none; never overwrites a url already present.
export function attachLinks<T extends { title: string; url: string | null }>(items: T[], links: PageLink[], listingUrls?: ListingUrls): T[] {
  const prepared = prepareLinks(links, listingUrls);
  const hasUrl = (it: T) => !!it.url && /^https?:\/\//i.test(it.url);
  const found = items.map(it => ({ title: it.title, url: hasUrl(it) ? null : findLinkInPrepared(it.title, prepared) }));
  const kept = withoutContested(found, items.filter(hasUrl).map(it => ({ title: it.title, url: it.url as string })));
  return items.map((it, i) => (hasUrl(it) ? it : { ...it, url: kept[i] }));
}

// Stored items that still have no url, matched to the page's real links right now. Independent of
// the model: an item the extractor did not pick again today still gets its link while its headline
// is on the page. Only ever fills a missing url — the caller must also write it with `url IS NULL`,
// and must check the result against what else the same run writes (planSourceSync does).
export function planLinkBackfill(stored: Array<{ item_hash: string; title: string; url: string | null }>, links: PageLink[], listingUrls?: ListingUrls): Array<{ item_hash: string; url: string }> {
  const prepared = prepareLinks(links, listingUrls);
  const missing = stored.filter(s => !s.url);
  const found = missing.map(s => ({ title: s.title, url: findLinkInPrepared(s.title, prepared) }));
  const kept = withoutContested(found, stored.filter(s => s.url).map(s => ({ title: s.title, url: s.url as string })));
  return missing.flatMap((s, i) => (kept[i] ? [{ item_hash: s.item_hash, url: kept[i] as string }] : []));
}
