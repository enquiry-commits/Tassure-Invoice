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

export type PageLink = { text: string; href: string };

// Same normalisation the de-dup hash uses (sync route), so a stored item and a
// freshly extracted one with the same title always compare equal.
export function normalizeNewsTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const MIN_CONTAINMENT_CHARS = 20; // avoid a short link text ("News") matching inside a long title
const MAX_EXTRA_LINK_TEXT = 2;    // link text up to 2x the headline = headline + date/category/"min read"
const MIN_TRUNCATED_SHARE = 0.7;  // a cut-short link text must still carry 70% of the headline

function pathSegments(href: string): string[] {
  try { return new URL(href).pathname.split('/').filter(Boolean); } catch { return []; }
}

// A link that cannot be THE article: the site's front page, or the listing page itself or a
// parent of it (a menu / breadcrumb link). The listing's own children are exactly what we want.
function isSectionLink(href: string, listingUrl?: string): boolean {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, '');
    if (!path) return true;
    if (listingUrl) {
      const l = new URL(listingUrl);
      const listingPath = l.pathname.replace(/\/+$/, '');
      if (u.hostname === l.hostname && (path === listingPath || listingPath.startsWith(`${path}/`))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// When several links carry the same headline (a featured block and the list entry, say),
// the most specific URL — the deepest path — is the article; ties keep the page order.
function mostSpecific(candidates: PageLink[]): PageLink {
  return candidates.reduce((best, l) => (pathSegments(l.href).length > pathSegments(best.href).length ? l : best));
}

export function findLinkForTitle(title: string, links: PageLink[], listingUrl?: string): string | null {
  const wanted = normalizeNewsTitle(title);
  if (!wanted) return null;
  const usable = links.filter(l => /^https?:\/\//i.test(l.href) && l.href !== listingUrl && !l.href.endsWith('#') && !isSectionLink(l.href, listingUrl));

  // 1. exact (normalised) match
  const exact = usable.filter(l => normalizeNewsTitle(l.text) === wanted);
  if (exact.length) return mostSpecific(exact).href;

  // 2. near-exact: the closest by length wins, then the more specific URL
  let best: { link: PageLink; closeness: number } | null = null;
  for (const l of usable) {
    const t = normalizeNewsTitle(l.text);
    if (!t) continue;
    const headlinePlusExtras = wanted.length >= MIN_CONTAINMENT_CHARS && t.length > wanted.length && t.length <= wanted.length * MAX_EXTRA_LINK_TEXT && t.includes(wanted);
    const cutShort = t.length >= MIN_CONTAINMENT_CHARS && wanted.length > t.length && t.length >= wanted.length * MIN_TRUNCATED_SHARE && wanted.startsWith(t);
    if (!headlinePlusExtras && !cutShort) continue;
    const closeness = Math.min(t.length, wanted.length) / Math.max(t.length, wanted.length);
    if (!best || closeness > best.closeness || (closeness === best.closeness && pathSegments(l.href).length > pathSegments(best.link.href).length)) best = { link: l, closeness };
  }
  return best?.link.href ?? null;
}

// Fills `url` on items that have none; never overwrites a url already present.
export function attachLinks<T extends { title: string; url: string | null }>(items: T[], links: PageLink[], listingUrl?: string): T[] {
  return items.map(it => (it.url && /^https?:\/\//i.test(it.url) ? it : { ...it, url: findLinkForTitle(it.title, links, listingUrl) }));
}
