// Source list for "SG Latest News" (Vincent, 2026-09-23): "关注 acra, iras,
// mom, ica, isca, chartered secretary (csis), straits time, business
// times, 联合早报" — 6 government/professional-body sources (policy) + 3
// newspapers (news). See lib/sg-news-fetch.ts for how each URL is actually
// fetched and lib/sg-news-digest.ts for how a day's new items become the
// written report.
//
// Every `url` below was checked LIVE in the browser before being written
// here (2026-09-23) — none are guessed. Real, useful findings from that
// check, worth knowing before touching this list again:
// - ACRA/MOM/ICA resolve to genuinely rich, well-structured
//   "News & Events"/"Newsroom" pages with real dates and categories.
// - POINT AT THE PAGE THAT LISTS THE ITEMS, not at the menu above it (found
//   2026-10-07). IRAS's `/news-events` and ISCA's `/about-us/newsroom` are only
//   hub pages — a few blurbs linking to the real lists — so no item from either
//   was ever stored while every nightly run reported "success, 0 items", which
//   looks exactly like a quiet day. The lists are IRAS `/news-events/newsroom`
//   (headlines with dates, newest first) and ISCA `/about-us/newsroom/media-releases`
//   (10 per page, 181 in all). ISCA's `/newsroom/speeches` is the other half of its
//   newsroom and is not watched.
// - CSIS (a small professional body, not a statutory board) has no news at all:
//   checked in a real browser 2026-10-07, its homepage is only navigation,
//   banners and one job advert, and /csis-event/ is empty ("VIEW MORE" buttons
//   with nothing behind them). 0 items from CSIS is the right answer, not a
//   sign the fetch is broken (`mayBeEmpty`). The "403 Forbidden" the fetch got from
//   it on 2026-09-23 was NOT bot protection: the fetch declared itself as
//   "Chrome/124" while running Chromium 149, and CSIS answers that outdated string
//   with 403 and the real version (or no override) with the full page — tested
//   2026-10-07, same browser, same site. page.goto does not throw on a 403, so the
//   run was also recorded as "success, 0 items" (lib/sg-news-sync-plan.ts pageProblem).
// - ALL NINE sites needed real JS rendering to show their actual content
//   (a plain HTTP fetch would see an empty/near-empty shell for at least
//   Straits Times and CSIS, confirmed live) — so every source here uses
//   the SAME Playwright fetch path, not a "simple sites vs JS sites"
//   split. Simpler and more robust than betting per-site on which ones
//   are safe to fetch without a real browser.
export type SgNewsCategory = 'policy' | 'news';

export type SgNewsSource = {
  key: string;
  name: string;
  category: SgNewsCategory;
  url: string;
  // What this source is being watched FOR — feeds directly into the
  // per-source extraction prompt (lib/sg-news-fetch.ts) so Claude knows
  // which items on a busy page are actually relevant to Tassure's work,
  // not just "list everything on the page".
  focus: string;
  // A source with genuinely nothing to report (CSIS). Every other source refreshes `last_seen_at`
  // on its stored items every night; one that stops doing so for 3 days is raised on Automation
  // Health as `source_silent` (lib/sg-news-sync-plan.ts) — unless it is marked here.
  mayBeEmpty?: boolean;
};

export const SG_NEWS_SOURCES: SgNewsSource[] = [
  {
    key: 'acra', name: 'ACRA', category: 'policy',
    url: 'https://www.acra.gov.sg/news-events/news-announcements/',
    focus: 'company registration, corporate secretarial practice, director/officer duties and regulation, filing requirements',
  },
  {
    key: 'iras', name: 'IRAS', category: 'policy',
    url: 'https://www.iras.gov.sg/news-events/newsroom', // the list; `/news-events` is only a menu of 4 blurbs
    focus: 'corporate income tax, GST, tax filing deadlines, tax rate or scheme changes',
  },
  {
    key: 'mom', name: 'MOM', category: 'policy',
    url: 'https://www.mom.gov.sg/newsroom',
    focus: 'work passes, employment regulation, CPF-adjacent policy — anything a corporate-services firm advising employer clients would need to know',
  },
  {
    key: 'ica', name: 'ICA', category: 'policy',
    url: 'https://www.ica.gov.sg/news-and-publications/media-releases',
    focus: 'immigration, entry/exit and work-pass-adjacent regulation relevant to foreign directors/staff of client companies',
  },
  {
    key: 'isca', name: 'ISCA', category: 'policy',
    url: 'https://www.isca.org.sg/about-us/newsroom/media-releases', // the list; `/about-us/newsroom` is only a menu
    focus: 'accounting and auditing standards, the accountancy profession in Singapore',
  },
  {
    key: 'csis', name: 'CSIS (Chartered Secretaries)', category: 'policy',
    url: 'https://csis.org.sg/',
    // Deliberately narrower expectation than the other 5 — see this
    // file's own header comment on why this source is weaker.
    focus: 'corporate secretarial profession and qualification — this source has thin, infrequent public content; report genuinely nothing found rather than stretching to fill a slot',
    mayBeEmpty: true,
  },
  {
    key: 'straitstimes', name: 'The Straits Times', category: 'news',
    url: 'https://www.straitstimes.com/singapore',
    focus: 'Singapore current affairs, social change, livelihood/policy shifts, broader future-trend signals — headlines and teasers only, not full paywalled articles',
  },
  {
    key: 'businesstimes', name: 'The Business Times', category: 'news',
    url: 'https://www.businesstimes.com.sg/singapore',
    focus: 'Singapore business and economic news — headlines and teasers only, not full paywalled articles',
  },
  {
    key: 'zaobao', name: '联合早报', category: 'news',
    url: 'https://www.zaobao.com.sg/realtime/singapore',
    focus: '新加坡时事、社会变化、生活政策变化——只取标题与简介，不取付费全文',
  },
];

// A report card's `source` text is written by the model, not copied from this list: 1 of the 60 stored
// cards (2026-10-07) says "Straits Times" for "The Straits Times", and with an exact-name lookup that card
// got neither its article link nor the source-page fallback. So a card finds its source by a tolerant
// comparison — case and punctuation ignored, the short key accepted ("Straits Times" is "straitstimes"),
// and a label that is the start of one longer name ("CSIS" for "CSIS (Chartered Secretaries)") — and only
// when exactly ONE source fits.
const labelKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function findSourceByLabel(label: string): SgNewsSource | undefined {
  const k = labelKey(String(label ?? ''));
  if (!k) return undefined;
  const exact = SG_NEWS_SOURCES.filter(s => labelKey(s.name) === k || s.key === k);
  if (exact.length === 1) return exact[0];
  const prefix = SG_NEWS_SOURCES.filter(s => labelKey(s.name).startsWith(k));
  return prefix.length === 1 ? prefix[0] : undefined;
}
