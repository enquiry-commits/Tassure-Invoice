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
// - ACRA/IRAS/MOM/ICA resolve to genuinely rich, well-structured
//   "News & Events"/"Newsroom" pages with real dates and categories.
// - ISCA and CSIS are WEAKER sources: ISCA's newsroom exists but is
//   thinner than ACRA/IRAS/MOM; CSIS (a small professional body, not a
//   statutory board) has no dedicated news/circulars page findable from
//   its own main nav at all — this points at its homepage, which mostly
//   shows events/careers content. A day with genuinely nothing new from
//   CSIS is the expected common case, not a sign the fetch is broken.
//   Confirmed again via a real local Playwright run (2026-09-23): CSIS
//   returned a hard "403 Forbidden" to headless Chrome (not just thin
//   content) — likely its own bot-protection. This is expected to show
//   up as a per-source failure in sg_news_sync_state / "本次未能成功检查"
//   some/most days; that's the designed degradation path (one source's
//   failure never blocks the other 8), not a bug to chase down.
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
};

export const SG_NEWS_SOURCES: SgNewsSource[] = [
  {
    key: 'acra', name: 'ACRA', category: 'policy',
    url: 'https://www.acra.gov.sg/news-events/news-announcements/',
    focus: 'company registration, corporate secretarial practice, director/officer duties and regulation, filing requirements',
  },
  {
    key: 'iras', name: 'IRAS', category: 'policy',
    url: 'https://www.iras.gov.sg/news-events',
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
    url: 'https://www.isca.org.sg/about-us/newsroom',
    focus: 'accounting and auditing standards, the accountancy profession in Singapore',
  },
  {
    key: 'csis', name: 'CSIS (Chartered Secretaries)', category: 'policy',
    url: 'https://csis.org.sg/',
    // Deliberately narrower expectation than the other 5 — see this
    // file's own header comment on why this source is weaker.
    focus: 'corporate secretarial profession and qualification — this source has thin, infrequent public content; report genuinely nothing found rather than stretching to fill a slot',
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
