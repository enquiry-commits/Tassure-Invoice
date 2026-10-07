// Source links for SG Latest News (2026-10-07). The page text the extractor reads
// (`document.body.innerText`) carries no hrefs, so every stored item had `url: null`
// and the cards could not link to their source. The fetch now also collects the
// page's real anchors, and these helpers match them to the extracted headlines by
// title — deterministically, never by asking the model to produce a URL. No imports:
// shared by the fetcher, the sync route and the API, and testable on its own.

export type PageLink = { text: string; href: string };

// Same normalisation the de-dup hash uses (sync route), so a stored item and a
// freshly extracted one with the same title always compare equal.
export function normalizeNewsTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const MIN_CONTAINMENT_CHARS = 20; // avoid a short link text ("News") matching inside a long title

export function findLinkForTitle(title: string, links: PageLink[], listingUrl?: string): string | null {
  const wanted = normalizeNewsTitle(title);
  if (!wanted) return null;
  const usable = links.filter(l => /^https?:\/\//i.test(l.href) && l.href !== listingUrl && !l.href.endsWith('#'));

  // 1. exact (normalised) match
  const exact = usable.find(l => normalizeNewsTitle(l.text) === wanted);
  if (exact) return exact.href;

  // 2. one contains the other (a link often carries an extra date/category prefix or suffix)
  let best: { href: string; overlap: number } | null = null;
  for (const l of usable) {
    const t = normalizeNewsTitle(l.text);
    if (!t) continue;
    const overlap = Math.min(t.length, wanted.length);
    if (overlap < MIN_CONTAINMENT_CHARS) continue;
    if ((t.includes(wanted) || wanted.includes(t)) && (!best || overlap > best.overlap)) best = { href: l.href, overlap };
  }
  return best?.href ?? null;
}

// Fills `url` on items that have none; never overwrites a url already present.
export function attachLinks<T extends { title: string; url: string | null }>(items: T[], links: PageLink[], listingUrl?: string): T[] {
  return items.map(it => (it.url && /^https?:\/\//i.test(it.url) ? it : { ...it, url: findLinkForTitle(it.title, links, listingUrl) }));
}
