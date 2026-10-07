// Pins SG Latest News page behaviour (docs/INVARIANTS.md INV-DATA-077, Vincent 2026-10-07):
//   1. Cards sit on a fixed 4-column grid: a section with only 2 items keeps them at the 4-column
//      width and leaves the right-hand slots empty — it never stretches them to half the row each.
//      That is `repeat(auto-fill, …)`; `auto-fit` collapses the empty tracks and stretches.
//      (Measured in a real browser at 1668px: auto-fit gave 2 cards of 827px, auto-fill 407px — the
//      same width as a full row of 4.)
//   2. A card's source link is the ARTICLE, found by matching the headline to the page's real links:
//      exact text, a card's own single heading, a little extra text, or the site's cut-short text —
//      never a menu / section / front page, never a long link text on its own.
//   3. A second sync on the same SGT day adds to the day's report, it never replaces it.
//   4. The source list points at the page that LISTS items (IRAS and ISCA were pointed at menus and
//      returned "success, 0 items" every night until 2026-10-07).
//   5. A card finds its source (and so its article link or source-page fallback) even when the model
//      wrote the name its own way, and the stored links are read paged.
//   6. A page that was not really read (HTTP error, almost empty) is a failed source, the first read of a
//      new source is a silent backlog, a source gone quiet is raised.
//   7. The nightly run itself (lib/sg-news-run.ts), executed with fakes: the order of its writes, every
//      failure path, the time budget, and the findings of the independent review.
//
// Run: npx tsx test-sg-news.ts
import { readFileSync } from 'fs';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

// Code only: the explanatory comment next to CARD_GRID names "auto-fit" on purpose.
const page = readFileSync('app/sg-news/page.tsx', 'utf8').replace(/^\s*\/\/.*$/gm, '');
const grid = /const CARD_GRID = \{[^}]*gridTemplateColumns: '([^']+)'/.exec(page)?.[1] ?? '';

console.log('--- rule 1: the card grid ---');
check('the card grid is defined once, in CARD_GRID', grid !== '', 'CARD_GRID not found');
check('it is auto-FILL, so unused slots stay empty and 2 cards keep the 4-column width', /^repeat\(auto-fill,/.test(grid), grid);
check('it never uses auto-fit (which collapses empty tracks and stretches the cards)', !/auto-fit/.test(page), 'auto-fit found in app/sg-news/page.tsx');
check('four equal columns on a wide screen, never narrower than 240px', /minmax\(max\(240px, calc\(\(100% - 42px\) \/ 4\)\), 1fr\)/.test(grid), grid);
check('every section of cards uses CARD_GRID (no second hand-written grid)', !/gridTemplateColumns:/.test(page.replace(/const CARD_GRID = \{[^}]*\}/, '')), 'another gridTemplateColumns in the page');

// ── rule 2: the card's source link is the ARTICLE, never a menu / section page ─────────────
// Real anchors and headlines read from the live pages on 2026-10-07 (hrefs shortened).
import { attachLinks, findLinkForTitle, normalizeNewsTitle, type PageLink } from './lib/sg-news-links';

console.log('\n--- rule 2: matching a headline to its article link ---');
const BT = 'https://www.businesstimes.com.sg/singapore';
const MOM = 'https://www.mom.gov.sg/newsroom';
const L = (text: string, href: string): PageLink => ({ text, href });
const btLinks = [
  L('Singapore', 'https://www.businesstimes.com.sg/singapore'),
  L('The Business Times', 'https://www.businesstimes.com.sg/'),
  L('Retrenched PMETs who return on lower pay see median 25% wage cut', 'https://www.businesstimes.com.sg/singapore/economy-policy/retrenched-pmets-who-return-lower-pay-see-median-25-wage-cut'),
  L('Singapore firms’ payment delays worsen for third straight quarter in Q3: SCCB', 'https://www.businesstimes.com.sg/companies-markets/singapore-firms-payment-delays-worsen-third-straight-quarter-q3-sccb'),
  L('Daily Debrief: What Happened Today (Oct 6)', 'https://www.businesstimes.com.sg/singapore/daily-debrief-what-happened-today-oct-6'),
];
check('BT: the headline in the screenshot gets its ARTICLE page, not the site front page', findLinkForTitle('Retrenched PMETs who return on lower pay see median 25% wage cut', btLinks, BT)?.endsWith('/singapore/economy-policy/retrenched-pmets-who-return-lower-pay-see-median-25-wage-cut') === true);
check('BT: curly apostrophes and punctuation do not matter (the same normalisation as the de-dup hash)', findLinkForTitle("Singapore firms' payment delays worsen for third straight quarter in Q3: SCCB", btLinks, BT)?.includes('/companies-markets/singapore-firms-payment-delays') === true);
check('BT: another day\'s "Daily Debrief" never borrows today\'s link (Oct 2 vs Oct 6)', findLinkForTitle('Daily Debrief: What Happened Today (Oct 2)', btLinks, BT) === null);
check('a headline that is not on the page gets no link (the card then falls back to the source page)', findLinkForTitle('Singapore PMI ticks up to 51.7 on continued AI-related demand', btLinks, BT) === null);

const momLinks = [
  L('Workplace safety and health', 'https://www.mom.gov.sg/workplace-safety-and-health'),
  L('Workplace safety and health', 'https://www.mom.gov.sg/workplace-safety-and-health'),
  L('Updated Scaffold Fire Safety Requirements', 'https://www.mom.gov.sg/newsroom/press-releases/2026/0924-factsheet-on-updated-scaffold-fire-safety-requirements'),
  L('Maintenance of eServices on 7 - 8 October', 'https://www.mom.gov.sg/newsroom/announcements/2026/maintenance'),
  L('Recommendations by Tripartite Workgroup to Strengthen Human Capital Development 5 min read', 'https://www.mom.gov.sg/newsroom/press-releases/2026/2409-recommendations-by-twg-hc'),
  L('Opening Address by Minister of State for Manpower Foo Cexiang at the Safety Awards', 'https://www.mom.gov.sg/newsroom/speeches/2026/opening-address-foo-cexiang'),
];
check('MOM: a menu link that is only a PIECE of the headline never becomes its link ("Workplace safety and health" ⊂ "Opening Address at Workplace Safety and Health Awards 2026" linked to a section page)',
  findLinkForTitle('Opening Address at Workplace Safety and Health Awards 2026', momLinks, MOM) === null);
check('MOM: an exact headline still matches its article', findLinkForTitle('Updated Scaffold Fire Safety Requirements', momLinks, MOM)?.endsWith('/0924-factsheet-on-updated-scaffold-fire-safety-requirements') === true);
check('the link text may carry a little extra (a date, "5 min read"): MOM "Recommendations by Tripartite Workgroup to Strengthen Human Cap.." (the site\'s own cut-short title) still finds its article', findLinkForTitle('Recommendations by Tripartite Workgroup to Strengthen Human Cap..', momLinks, MOM)?.endsWith('/2409-recommendations-by-twg-hc') === true);
check('a title the site cut short matches by prefix: "Opening Address by Minister of State for Manpower Foo Cexiang a.."', findLinkForTitle('Opening Address by Minister of State for Manpower Foo Cexiang a..', momLinks, MOM)?.endsWith('/speeches/2026/opening-address-foo-cexiang') === true);
check('short link text never matches by containment ("Singapore", "News")', findLinkForTitle('Singapore economy grows 4.1% in the third quarter, MTI says', [L('Singapore', 'https://x.sg/singapore/economy'), L('Singapore economy', 'https://x.sg/economy')], 'https://x.sg/news') === null);

const dupLinks = [
  L('Seized Sentosa Cove bungalows owned by money launderers hit the market', 'https://www.businesstimes.com.sg/singapore'),
  L('Seized Sentosa Cove bungalows owned by money launderers hit the market', 'https://www.businesstimes.com.sg/singapore/seized-sentosa-cove-bungalows-owned-money-launderers-hit-market'),
];
check('the site front page and the listing page itself are never the answer; with the same headline twice the deeper URL wins', findLinkForTitle('Seized Sentosa Cove bungalows owned by money launderers hit the market', dupLinks, BT)?.endsWith('-hit-market') === true);
check('a link to the site front page is ignored even when its text is the headline', findLinkForTitle('Seized Sentosa Cove bungalows owned by money launderers hit the market', [L('Seized Sentosa Cove bungalows owned by money launderers hit the market', 'https://www.businesstimes.com.sg/')], BT) === null);
check('a parent of the listing (a breadcrumb) is ignored', findLinkForTitle('Government gazette notice for the quarter ended June 2026', [L('Government gazette notice for the quarter ended June 2026', 'https://www.mom.gov.sg/newsroom')], 'https://www.mom.gov.sg/newsroom/press-releases') === null);
const items = [{ title: 'Updated Scaffold Fire Safety Requirements', url: null as string | null }, { title: 'Maintenance of eServices on 7 - 8 October', url: 'https://example.sg/already-set' as string | null }];
const attached = attachLinks(items, momLinks, MOM);
check('attachLinks fills a missing url and never overwrites one already stored', attached[0].url?.endsWith('scaffold-fire-safety-requirements') === true && attached[1].url === 'https://example.sg/already-set');
check('the shared normalisation is unchanged (it is also the de-dup hash)', normalizeNewsTitle("Singapore firms’ payment delays — Q3: SCCB") === 'singapore firms payment delays q3 sccb');

// Card links: ONE <a> wraps date + heading + tags + description. Shapes read from the live ACRA
// and ISCA pages on 2026-10-07 (the descriptions are shortened; hrefs are the real ones).
const ACRA = 'https://www.acra.gov.sg/news-events/news-announcements/';
const ISCA = 'https://www.isca.org.sg/about-us/newsroom/media-releases';
const auditTitle = 'Audit Practice Guidance No. 1 of 2026: Using Artificial Intelligence Responsibly';
const auditHref = 'https://www.acra.gov.sg/news-events/news-announcements/audit-practice-guidance-no-1-of-2026-using-artificial-intelligence-responsibly/';
const auditText = `2 October 2026 ${auditTitle} Audience Accountants Accounting entities News Topic Accounting standards and sector regulation Category Announcement New practice guidance provides practical considerations`;
const ascText = '29 September 2026 2026 ASC News Audience Accountants Accounting entities News Topic Accounting standards and sector regulation Category Announcement News published by the ASC.';
const acraLinks: PageLink[] = [
  { text: 'Trusted websites (opens in new tab)', href: 'https://www.gov.sg/trusted-sites' },
  { text: auditText, href: auditHref, heading: auditTitle },
  { text: ascText, href: 'https://www.acra.gov.sg/news-events/news-announcements/2026-asc-news/', heading: '2026 ASC News' },
];
const iscaTitle = 'Singapore Advances Towards Building an AI Fluent Accountancy Profession';
const iscaHref = 'https://www.isca.org.sg/content-item?id=8d1ee666-0202-49e3-9627-2b166af231da';
const iscaLinks: PageLink[] = [
  { text: `Media Releases ${iscaTitle} 28 Aug 2026 More than 15,000 professionals join national AI capability effort within two months as employers build practical AI workforce capabilities`, href: iscaHref, heading: iscaTitle },
];
check('ACRA card: the headline finds its article through the card\'s heading (link text is 5x longer than the headline)', findLinkForTitle(auditTitle, acraLinks, ACRA) === auditHref);
check('the same card WITHOUT its heading matches nothing — a long link text alone is still never enough', findLinkForTitle(auditTitle, [{ text: auditText, href: auditHref }], ACRA) === null);
check('a short headline ("2026 ASC News", under the 20-character containment floor) still matches through its heading', findLinkForTitle('2026 ASC News', acraLinks, ACRA)?.endsWith('/2026-asc-news/') === true);
check('ISCA card: an article URL that is only a query string (/content-item?id=…) is returned whole', findLinkForTitle(iscaTitle, iscaLinks, ISCA) === iscaHref);
check('a headline no card heading and no link text equals gets no link', findLinkForTitle('Scheduled maintenance for selected eServices', acraLinks, ACRA) === null);
check('a heading never rescues a section link: the listing page and the site front page stay excluded', findLinkForTitle(auditTitle, [{ text: 'Newsroom latest announcements', href: ACRA, heading: auditTitle }, { text: 'Home page of the authority', href: 'https://www.acra.gov.sg/', heading: auditTitle }], ACRA) === null);
const carded = attachLinks([{ title: auditTitle, url: null as string | null }, { title: iscaTitle, url: null as string | null }], [...acraLinks, ...iscaLinks], ACRA);
check('attachLinks fills both card items from their headings', carded[0].url === auditHref && carded[1].url === iscaHref);
// ── a wrong link is worse than a missing one: ambiguity, one page per headline, no tag pages ──
import { planLinkBackfill, urlIdentity } from './lib/sg-news-links';
const ST = 'https://www.straitstimes.com/singapore';
check('urlIdentity: a tracking parameter, a trailing slash, "www." and a fragment do not make another page, but a real parameter does (ISCA\'s ?id=)',
  urlIdentity('https://www.straitstimes.com/singapore/a-story/?ref=latest-top-story#x') === urlIdentity('https://straitstimes.com/singapore/a-story') && urlIdentity('https://www.isca.org.sg/content-item?id=AAA') !== urlIdentity('https://www.isca.org.sg/content-item?id=BBB'));
const featured = [
  L('Quarterly Review of Accountancy Standards in Singapore', 'https://www.isca.org.sg/content-item?id=AAA'),
  L('Quarterly Review of Accountancy Standards in Singapore', 'https://www.isca.org.sg/events/summit/2026/agenda'),
];
check('ISCA: two links with the same headline that go to DIFFERENT pages give no link — the deeper one used to win and the real article (a single path segment) lost', findLinkForTitle('Quarterly Review of Accountancy Standards in Singapore', featured, ISCA) === null);
check('the same page linked twice (once with a tracking parameter) is no conflict, and the clean address is returned', findLinkForTitle('Retrenched PMETs who return on lower pay see median 25% wage cut', [
  L('Retrenched PMETs who return on lower pay see median 25% wage cut', 'https://www.businesstimes.com.sg/singapore/economy-policy/retrenched-pmets?ref=latest-top-story'),
  L('Retrenched PMETs who return on lower pay see median 25% wage cut', 'https://www.businesstimes.com.sg/singapore/economy-policy/retrenched-pmets'),
], BT) === 'https://www.businesstimes.com.sg/singapore/economy-policy/retrenched-pmets');
check('a tag page is never an article: The Straits Times links "Vaping crisis" to /tags/e-cigarettesvaping with the tag as the link text', findLinkForTitle('Vaping crisis', [L('Vaping crisis', 'https://www.straitstimes.com/tags/e-cigarettesvaping')], ST) === null && findLinkForTitle('Business', [L('Business', 'https://www.example.sg/topics/business')], 'https://www.example.sg/news') === null);
const icaLink = L('Media Releases and Newsroom of the Immigration & Checkpoints Authority', 'https://www.ica.gov.sg/news-and-publications/newsroom');
check('a page that redirects: its own address is excluded only when the FINAL address is given too (ICA /media-releases -> /newsroom?…)', findLinkForTitle(icaLink.text, [icaLink], 'https://www.ica.gov.sg/news-and-publications/media-releases') === icaLink.href
  && findLinkForTitle(icaLink.text, [icaLink], ['https://www.ica.gov.sg/news-and-publications/media-releases', 'https://www.ica.gov.sg/news-and-publications/newsroom?page=1&year=2026']) === null);
const alpha = 'Government unveils new support package for small businesses';
const beta = `${alpha} amid rising costs`;
const shared = attachLinks([{ title: alpha, url: null as string | null }, { title: beta, url: null as string | null }], [L(beta, 'https://www.example.sg/news/support-package-amid-rising-costs')], 'https://www.example.sg/news');
check('one page, one headline: two different headlines that both match the same page get NO link (the shorter one only matched inside the longer one\'s link text)', shared[0].url === null && shared[1].url === null);
const plan = planLinkBackfill([
  { item_hash: 'h1', title: 'Updated Scaffold Fire Safety Requirements', url: null },
  { item_hash: 'h2', title: 'Maintenance of eServices on 7 - 8 October', url: null },
  { item_hash: 'h3', title: 'Some other stored headline that is not on the page', url: null },
  { item_hash: 'h4', title: 'Earlier headline already linked', url: 'https://www.mom.gov.sg/newsroom/announcements/2026/maintenance' },
], momLinks, MOM);
check('stored items without a url get the page\'s link for their headline; one without a match gets nothing', plan.some(p => p.item_hash === 'h1' && p.url.endsWith('scaffold-fire-safety-requirements')) && !plan.some(p => p.item_hash === 'h3'));
check('a stored item never takes an address another stored headline already owns, and an item that has a url is never in the plan', !plan.some(p => p.item_hash === 'h2' || p.item_hash === 'h4'));
const fetchSrc = readFileSync('lib/sg-news-fetch.ts', 'utf8');
const fetchCode = fetchSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');   // comments name what the code must not do
check('the fetcher hands over a link\'s heading only when the link holds exactly one (ACRA/ISCA cards)', /headings\.length === 1/.test(fetchCode) && /querySelectorAll\('h1,h2,h3,h4,h5,h6'\)/.test(fetchCode) && /heading \? \{ text, href, heading \} : \{ text, href \}/.test(fetchCode));

// ── rule 3: a second run on the same day adds to the report, it never replaces it ──────────
import { mergeDailyReport } from './lib/sg-news-report';
import type { SgNewsDailyReport, SgNewsDigestItem } from './lib/sg-news-digest';

console.log('\n--- rule 3: the 「手动运行一次」 button must not wipe the day\'s report ---');
const di = (title: string, source = 'The Business Times'): SgNewsDigestItem => ({ source, category: 'news', title, url: null, publishedLabel: null, whatChanged: 'w', whyItMatters: 'm' });
const morning: SgNewsDailyReport = { summary: '今天的概述', policyItems: [{ ...di('Multi-Agency Enforcement Operations at Various Checkpoints', 'ICA'), category: 'policy' }], newsItems: [di('Retrenched PMETs who return on lower pay see median 25% wage cut'), di('North-South Corridor delay: Higher costs likely')] };
const nothingNew: SgNewsDailyReport = { summary: '今天9个来源都没有发现新的、之前没见过的条目。', policyItems: [], newsItems: [] };
const stored = { report: morning, new_items_count: 3 };
const kept = mergeDailyReport(stored, nothingNew, 0);
check('a run that finds nothing new leaves the day\'s report exactly as it was (the case that wiped Vincent\'s cards)', kept.report === morning && kept.changed === false && kept.newItemsCount === 3);
const added = mergeDailyReport(stored, { summary: 'later', policyItems: [], newsItems: [di('Singapore PMI ticks up to 51.7 on continued AI-related demand'), di('Retrenched PMETs who return on lower pay see median 25% wage cut')] }, 2);
check('a run with new items ADDS them: the morning\'s 3 items stay, the new one is appended, and a repeated headline is not duplicated', added.report.newsItems.length === 3 && added.report.policyItems.length === 1 && added.report.newsItems[2].title.startsWith('Singapore PMI') && added.changed === true);
check('the stored summary is kept (it cannot be rewritten without another AI call) and the count adds up', added.report.summary === '今天的概述' && added.newItemsCount === 5);
check('no report stored yet: the fresh digest is used as is', (() => { const r = mergeDailyReport(null, morning, 3); return r.report === morning && r.changed && r.newItemsCount === 3; })());
check('a stored item is never lost, whatever the new run found', morning.newsItems.every(i => added.report.newsItems.some(j => j.title === i.title)));
const syncSrc = readFileSync('lib/sg-news-run.ts', 'utf8');
const placeholder: SgNewsDailyReport = { summary: '今天9个来源都没有发现新的、之前没见过的条目。', policyItems: [], newsItems: [] };
const lateFirst = mergeDailyReport({ report: placeholder, new_items_count: 0 }, { summary: '上午没有新内容，现在有两条', policyItems: [], newsItems: [di('A real story that arrived after the quiet morning run')] }, 1);
check('a stored "nothing new today" placeholder is REPLACED by a later run that found something — its summary would otherwise say "nothing new" above a page of cards', lateFirst.report.summary.startsWith('上午') && lateFirst.report.newsItems.length === 1 && lateFirst.newItemsCount === 1 && lateFirst.changed);
check('the sync reads today\'s stored report and saves only the merged one (no direct upsert of the fresh digest)', /mergeDailyReport\(storedReport as/.test(syncSrc) && /report: merged\.report/.test(syncSrc) && !/report, new_items_count: totalNew/.test(syncSrc));

// ── rule 4: every source URL is the page that LISTS items, not the menu above it ───────────
import { SG_NEWS_SOURCES } from './lib/sg-news-sources';

console.log('\n--- rule 4: the source list ---');
const sourceUrl = (key: string) => SG_NEWS_SOURCES.find(s => s.key === key)?.url ?? '';
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, ''); } catch { return ''; } };
check('IRAS points at the newsroom LIST — /news-events is a menu of 4 blurbs and gave "success, 0 items" every night', pathOf(sourceUrl('iras')) === '/news-events/newsroom', sourceUrl('iras'));
check('ISCA points at the media-releases LIST — /about-us/newsroom is only a menu and gave "success, 0 items" every night', pathOf(sourceUrl('isca')) === '/about-us/newsroom/media-releases', sourceUrl('isca'));
check('every source has its own https URL', new Set(SG_NEWS_SOURCES.map(s => s.url)).size === SG_NEWS_SOURCES.length && SG_NEWS_SOURCES.every(s => /^https:\/\//.test(s.url)));

// ── rule 6: what the sync decides (lib/sg-news-sync-plan.ts) and how the fetch reads a page ─────
import { MIN_PAGE_CHARS, pageProblem, planSourceSync, silentSources } from './lib/sg-news-sync-plan';

console.log('\n--- rule 6: a blocked page is a failure, the first run is not a flood, a silent source is raised ---');
check('an HTTP error is a problem — CSIS\'s "403 - Forbidden" page (50 characters) was recorded as "success, 0 items"', pageProblem({ status: 403, chars: 50 }) !== null && pageProblem({ status: 404, chars: 5000 }) !== null && pageProblem({ status: 500, chars: 5000 }) !== null);
check('an almost empty page is a problem even with status 200, a normal page is not (every real source gives well over 1,800 characters)', pageProblem({ status: 200, chars: MIN_PAGE_CHARS - 1 }) !== null && pageProblem({ status: 200, chars: 1830 }) === null && pageProblem({ status: null, chars: 3000 }) === null);
const ex = (t: string) => ({ title: t, url: null as string | null });
const twelve = Array.from({ length: 12 }, (_, i) => ex(`Backlog headline number ${i + 1} from the newsroom`));
const first = planSourceSync({ stored: [], extracted: twelve, links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: 3 });
check('the FIRST run of a source stores its whole page but reports only the newest few (IRAS: 20 items back to Nov 2025 would push the day\'s real news out of the digest)', first.firstRun && first.insert.length === 12 && first.report.length === 3 && first.report[0].title === twelve[0].title);
check('with a limit of 0 the first run is silent: everything is stored as seen, nothing is reported', planSourceSync({ stored: [], extracted: twelve, links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: 0 }).report.length === 0);
const stored3 = [{ item_hash: normalizeNewsTitle(twelve[0].title), title: twelve[0].title, url: null }, { item_hash: 'other stored one', title: 'Other stored one', url: 'https://example.sg/a' }];
const later = planSourceSync({ stored: stored3, extracted: twelve.slice(0, 4), links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: 0 });
check('every later run reports ALL its new items, touches the ones seen again and stores only the new ones', !later.firstRun && later.report.length === 3 && later.insert.length === 3 && later.touch.length === 1 && later.touch[0] === stored3[0].item_hash);
check('the same item twice on one page is one item', planSourceSync({ stored: [], extracted: [ex('Same story twice'), ex('Same  story, twice!')], links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: 5 }).insert.length === 1);
const srcs = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }, { key: 'csis', name: 'CSIS', mayBeEmpty: true }, { key: 'd', name: 'D' }];
const NOW = Date.parse('2026-10-07T00:00:00Z');
const quiet = silentSources({ sources: srcs, now: NOW, lastSeenAt: { a: '2026-10-06T22:44:00Z', b: '2026-10-02T22:44:00Z', c: null, csis: null, d: 'not a date' } });
check('a source whose newest stored item was last seen over 3 days ago, or that never stored one, is silent — one seen last night is not', quiet.map(q => q.key).sort().join() === 'b,c,d' && quiet.find(q => q.key === 'b')?.silentDays === 4);
check('a source marked mayBeEmpty (CSIS) is never silent', !quiet.some(q => q.key === 'csis'));

check('the model is not asked for an address: EXTRACT_TOOL has no `url` property, and whatever comes back is dropped (a stored address is never re-checked and is copied into the report)',
  !/url: \{ type: 'string'/.test(fetchCode) && /url: null, publishedLabel/.test(fetchCode));
check('image, media and font requests are blocked — and never CSS or scripts (innerText depends on CSS; IRAS\'s hidden menu stays out of the text because of it)',
  /context\.route\('\*\*\/\*'/.test(fetchCode) && /type === 'image' \|\| type === 'media' \|\| type === 'font' \? route\.abort\(\)/.test(fetchCode) && !/stylesheet|'script'/.test(fetchCode));
check('the Vercel launcher uses the same no-disk-cache flags as lib/teamwork-agm.ts', ['--disk-cache-size=0', '--media-cache-size=0', '--disable-gpu-shader-disk-cache'].every(f => fetchCode.includes(`'${f}'`)));
check('the declared browser version is the real one (browser.version()), not a hard-coded "Chrome/124" that csis.org.sg answers with 403', /Chrome\/\$\{major\}\.0\.0\.0/.test(fetchCode) && /browser\.version\(\)/.test(fetchCode) && !/Chrome\/1\d\d\.0\.0\.0 Safari/.test(fetchCode));
check('the fetch keeps the page\'s HTTP status and final address, and a 5xx is retried while a 4xx is reported', /const response = await tab\.goto\(/.test(fetchCode) && /response\?\.status\(\)/.test(fetchCode) && /status >= 500\) throw/.test(fetchCode) && /finalUrl: tab\.url\(\)/.test(fetchCode));
check('the fetch hands every page to readRenderedPage (the check, the extractor and the link matching live there, where they are tested), and keeps the page\'s facts when the extraction fails', /readRenderedPage\(\{ source, page,/.test(fetchCode) && /factsOfPage\(page, env\)/.test(fetchCode));
check('the extraction is cut-off aware (a list cut at the ceiling must not read as "0 items") and is not asked for more than it needs', /stop_reason === 'max_tokens'\) throw/.test(fetchCode) && /EXTRACT_MAX_TOKENS = 4000/.test(fetchCode));
check('the LAST retry does not block anything: request interception has never run under the Vercel build\'s single-process Chromium, so if it were what breaks a page the source keeps the fetch it had before', /options\.blockHeavy \?\? stats\.attempts < RETRY_ATTEMPTS/.test(fetchCode) && /RETRY_ATTEMPTS = 3/.test(fetchCode));
check('a page still almost empty after the settle gets ONE more look before it is called empty — but a blocked (4xx) page does not', /status === null \|\| status < 400\) && read\.text\.trim\(\)\.length < MIN_PAGE_CHARS/.test(fetchCode) && /SECOND_LOOK_MS/.test(fetchCode));
check('links are collapsed (identical text + address) and capped at 2500, not 800 (IRAS has 731 with its articles at positions 698–717)', /MAX_LINKS = 2500/.test(fetchCode) && /seen\.has\(key\)/.test(fetchCode));
const digestSrc = readFileSync('lib/sg-news-digest.ts', 'utf8');
check('the digest says so when it is cut off, has room for twice the old 4,000 tokens, and re-attaches the configured source name and category (not the model\'s wording)',
  /stop_reason === 'max_tokens'\) throw/.test(digestSrc) && /DIGEST_MAX_TOKENS = 8000/.test(digestSrc) && /source: orig\?\.source\.name \?\? it\.source/.test(digestSrc) && /category: orig\?\.source\.category \?\? it\.category/.test(digestSrc));
check('the digest looks a title up WITH its source when two sources carry the same title, so one source\'s card never takes another\'s address, name or section', /bySourceTitle\.get\(`\$\{labelled\.key\}\|\$\{it\.title\}`\)/.test(digestSrc) && /byTitle\.set\(i\.title, byTitle\.has\(i\.title\) \? null :/.test(digestSrc));
const routeWiring = readFileSync('app/api/sg-news/sync/route.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '');
check('the route only wires the real collaborators into the runner (the work itself is tested below) and keeps the exact-secret gate, the usage tag and the 280 s ceiling',
  /runSgNewsSync\(\{/.test(routeWiring) && /scheduledJobUsage\(req, 'sg_news'\)/.test(routeWiring) && /replaceAutomationExceptions\('sg_news_sync', type, items\)/.test(routeWiring) && /heartbeat: \(\) => run\.heartbeat\(\)/.test(routeWiring) && /isCronRequest\(req\)/.test(routeWiring) && /maxDuration = 280/.test(routeWiring));
check('stored items only ever get a missing link: the backfill update carries `url IS NULL`', /\.update\(\{ url: fill\.url \}\)[^;]*\.is\('url', null\)/.test(syncSrc));

// ── findings of the independent review (2026-10-07), each reproduced before it was fixed ──────────────────
const S_TITLE = 'Singapore Q3 GDP grows 4.1% year on year';
const N_TITLE = `${S_TITLE} as manufacturing rebounds`;
const N_URL = 'https://www.example.sg/news/q3-gdp-manufacturing-rebounds';
const X_LISTING = 'https://www.example.sg/news';
const xLinks = [L(N_TITLE, N_URL)];
const crossRun = planSourceSync({
  stored: [{ item_hash: normalizeNewsTitle(S_TITLE), title: S_TITLE, url: null }],
  extracted: attachLinks([{ title: N_TITLE, url: null as string | null }], xLinks, X_LISTING), links: xLinks, listingUrls: [X_LISTING], hashOf: normalizeNewsTitle, firstRunReportLimit: 0,
});
check('ONE page, ONE headline across the whole run: an older url-less headline that only matches inside a NEW headline\'s link text no longer takes the new article (it did, and `url IS NULL` meant nothing could ever correct it)', crossRun.backfill.length === 0 && crossRun.insert[0].url === null);
const ownedRun = planSourceSync({
  stored: [{ item_hash: 'owner', title: 'The headline that already owns this article', url: N_URL }],
  extracted: attachLinks([{ title: N_TITLE, url: null as string | null }], xLinks, X_LISTING), links: xLinks, listingUrls: [X_LISTING], hashOf: normalizeNewsTitle, firstRunReportLimit: 0,
});
check('...and a new headline never takes an address a stored headline already owns', ownedRun.insert[0].url === null);
const recentFirst = planSourceSync({
  stored: [
    { item_hash: 'recent', title: 'A headline that is still on the page today', url: null, first_seen_at: '2026-10-06T22:44:00Z' },
    { item_hash: 'ancient', title: 'Another headline that is still on the page today', url: null, first_seen_at: '2026-09-01T22:44:00Z' },
  ],
  extracted: [], links: [L('A headline that is still on the page today', 'https://x.example.sg/news/a'), L('Another headline that is still on the page today', 'https://x.example.sg/news/b')],
  listingUrls: ['https://x.example.sg/news'], hashOf: normalizeNewsTitle, firstRunReportLimit: 0, now: Date.parse('2026-10-08T00:00:00Z'),
});
check('only items first seen in the last 7 days are given a link in hindsight (a recurring headline must not hand last month\'s card today\'s article, and the nightly work must not grow with the backlog)', recentFirst.backfill.length === 1 && recentFirst.backfill[0].item_hash === 'recent');
check('a source that normally has nothing to report (CSIS: limit Infinity) reports even its FIRST item, and "first run" needs the page to have given items', planSourceSync({ stored: [], extracted: [ex('One real item that CSIS posted')], links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: Infinity }).report.length === 1 && planSourceSync({ stored: [], extracted: [], links: [], listingUrls: [], hashOf: normalizeNewsTitle, firstRunReportLimit: 0 }).firstRun === false);
const bigLinks = Array.from({ length: 2500 }, (_, i) => L(`Some long headline number ${i} about Singapore business and policy`, `https://www.example.sg/news/story-${i}`));
const bigStored = Array.from({ length: 1000 }, (_, i) => ({ item_hash: `h${i}`, title: `An older stored headline ${i} that is not on the page any more`, url: null as string | null }));
const t0 = Date.now();
planLinkBackfill(bigStored, bigLinks, X_LISTING);
const backfillMs = Date.now() - t0;
check(`the links are prepared ONCE per page: 1,000 stored headlines against 2,500 links took ${backfillMs} ms (17,000 ms when every headline re-processed them)`, backfillMs < 3000);
check('the same page linked as http and as https gives the https address; a tracking parameter loses to the clean address', findLinkForTitle('Some story headline that is long enough here', [L('Some story headline that is long enough here', 'http://www.example.sg/news/a-story'), L('Some story headline that is long enough here', 'https://www.example.sg/news/a-story?ref=latest-top-story'), L('Some story headline that is long enough here', 'https://www.example.sg/news/a-story')], X_LISTING) === 'https://www.example.sg/news/a-story');

// ── rule 7: the nightly run itself (lib/sg-news-run.ts), executed with fakes ────────────────────────────────
import type { SupabaseClient } from '@supabase/supabase-js';
import { FIRST_RUN_REPORT_LIMIT, SOURCE_START_DEADLINE_MS, runSgNewsSync, type FetchOutcome, type SyncDeps } from './lib/sg-news-run';
import { readRenderedPage } from './lib/sg-news-sync-plan';
import type { SgNewsSource } from './lib/sg-news-sources';
import type { FetchFacts } from './lib/sg-news-sync-plan';

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { message: string } | null };
interface Query extends PromiseLike<QueryResult> {
  select(columns?: string): Query; eq(column: string, value: unknown): Query; in(column: string, values: unknown[]): Query; is(column: string, value: null): Query;
  order(column: string, options: { ascending: boolean }): Query; range(from: number, to: number): Query; limit(n: number): Query; maybeSingle(): Query;
  update(patch: Row): Query; upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Query;
}
type FailContext = { table: string; op: 'select' | 'update' | 'upsert'; eq: Record<string, unknown>; paged: boolean; limited: boolean };

// A tiny in-memory stand-in for the parts of supabase-js the run uses, with the semantics that matter here:
// `.is(col, null)` filters on NULL, an upsert with ignoreDuplicates leaves an existing key alone, an update changes
// matching rows only. `log` records the order in which the run touched the database.
function fakeDb(tables: Record<string, Row[]>, log: string[], fail: (c: FailContext) => string | null = () => null): SupabaseClient {
  let nextId = 1000;
  for (const rows of Object.values(tables)) for (const r of rows) if (r.id === undefined) r.id = nextId++;
  const from = (table: string): Query => {
    const rows = (tables[table] ??= []);
    const state = {
      op: 'select' as FailContext['op'], patch: {} as Row, input: [] as Row[], opts: {} as { onConflict?: string; ignoreDuplicates?: boolean },
      filters: [] as Array<(r: Row) => boolean>, eq: {} as Record<string, unknown>,
      order: null as null | { column: string; ascending: boolean }, range: null as null | [number, number], limit: null as null | number, single: false,
    };
    const run = (): QueryResult => {
      const message = fail({ table, op: state.op, eq: state.eq, paged: state.range !== null, limited: state.limit !== null });
      if (message) { log.push(`FAILED ${state.op} ${table}`); return { data: null, error: { message } }; }
      const matching = rows.filter(r => state.filters.every(f => f(r)));
      if (state.op === 'update') { for (const r of matching) Object.assign(r, state.patch); log.push(`update ${table}`); return { data: null, error: null }; }
      if (state.op === 'upsert') {
        const keys = (state.opts.onConflict ?? 'id').split(',');
        for (const row of state.input) {
          const existing = rows.find(r => keys.every(k => r[k] === row[k]));
          if (existing) { if (!state.opts.ignoreDuplicates) Object.assign(existing, row); } else rows.push({ id: nextId++, ...row });
        }
        log.push(`upsert ${table}`);
        return { data: null, error: null };
      }
      let out = [...matching];
      if (state.order) {
        const { column, ascending } = state.order;
        out.sort((a, b) => {
          const x = a[column], y = b[column];
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
          return ascending ? c : -c;
        });
      }
      if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
      if (state.limit !== null) out = out.slice(0, state.limit);
      log.push(`select ${table}`);
      return { data: state.single ? (out[0] ?? null) : out, error: null };
    };
    const q: Query = {
      select: () => q,
      eq: (c, v) => { state.eq[c] = v; state.filters.push(r => r[c] === v); return q; },
      in: (c, vs) => { state.filters.push(r => vs.includes(r[c])); return q; },
      is: (c, v) => { state.filters.push(r => (r[c] ?? null) === v); return q; },
      order: (column, o) => { state.order = { column, ascending: o.ascending }; return q; },
      range: (a, b) => { state.range = [a, b]; return q; },
      limit: n => { state.limit = n; return q; },
      maybeSingle: () => { state.single = true; return q; },
      update: patch => { state.op = 'update'; state.patch = patch; return q; },
      upsert: (input, opts) => { state.op = 'upsert'; state.input = Array.isArray(input) ? input : [input]; state.opts = opts ?? {}; return q; },
      then: ((resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)) as Query['then'],
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const mk = (key: string, name: string, category: 'policy' | 'news', extra: Partial<SgNewsSource> = {}): SgNewsSource => ({ key, name, category, url: `https://${key}.example.sg/news`, focus: 'x', ...extra });
const SRC = [mk('bt', 'The Business Times', 'news'), mk('iras', 'IRAS', 'policy'), mk('csis', 'CSIS', 'policy', { mayBeEmpty: true })];
const facts = (extra: Partial<FetchFacts> = {}): FetchFacts => ({ status: 200, finalUrl: null, chars: 3000, links: 50, headingLinks: 0, fetchMs: 100, attempts: 1, blockedHeavy: true, tmpFreeMB: 300, rssMB: 400, ...extra });
const got = (title: string, url: string | null = null) => ({ title, url, publishedLabel: null, teaser: null });
const okFetch = (items: ReturnType<typeof got>[], links: PageLink[] = [], key = 'x'): FetchOutcome => ({ items, links, finalUrl: `https://${key}.example.sg/news`, facts: facts() });

type Scenario = {
  tables?: Record<string, Row[]>; fetched: Record<string, FetchOutcome>; fail?: (c: FailContext) => string | null;
  digestThrows?: boolean; onFetch?: (key: string, clock: { value: number }) => void;
};
async function runScenario(s: Scenario) {
  const log: string[] = [];
  const tables = s.tables ?? {};
  const clock = { value: Date.parse('2026-10-08T22:44:00Z') };
  const digestSeen: Array<{ source: string; titles: string[] }> = [];
  const raised: Array<{ type: string; keys: string[] }> = [];
  const fetchedKeys: string[] = [];
  const deps: SyncDeps = {
    db: fakeDb(tables, log, s.fail), sources: SRC, today: '2026-10-09', now: () => clock.value, heartbeat: async () => {},
    fetchSource: async source => { fetchedKeys.push(source.key); log.push(`fetch ${source.key}`); s.onFetch?.(source.key, clock); return s.fetched[source.key] ?? { error: 'no fake outcome', facts: facts() }; },
    digest: async groups => {
      log.push('digest');
      if (s.digestThrows) throw new Error('digest down');
      for (const g of groups) digestSeen.push({ source: g.source.key, titles: g.items.map(i => i.title) });
      const cards = groups.flatMap(g => g.items.map(i => ({ source: g.source.name, category: g.source.category, title: i.title, url: i.url, publishedLabel: null, whatChanged: 'w', whyItMatters: 'm' })));
      return { summary: 'S', policyItems: cards.filter(c => c.category === 'policy'), newsItems: cards.filter(c => c.category === 'news') };
    },
    raiseExceptions: async (type, items) => { raised.push({ type, keys: items.map(i => i.key) }); },
  };
  const result = await runSgNewsSync(deps);
  const body = result.body as Record<string, unknown> & { sources?: Array<Record<string, unknown>>; warnings?: string[]; error?: string };
  return { status: result.status, body, log, tables, digestSeen, raised, fetchedKeys, clock };
}
const at = (log: string[], entry: string) => log.indexOf(entry);
const KNOWN = 'Known story one without a stored link yet, still on the page';
const FRESH = 'A brand new story that appeared overnight on the business pages';
const baseTables = (): Record<string, Row[]> => ({
  sg_news_items: [
    { source: 'bt', item_hash: normalizeNewsTitle(KNOWN), title: KNOWN, url: null, first_seen_at: '2026-10-07T22:44:00Z', last_seen_at: '2026-10-07T22:44:00Z' },
    { source: 'bt', item_hash: 'already linked story', title: 'Already linked story', url: 'https://bt.example.sg/news/linked', first_seen_at: '2026-10-07T22:44:00Z', last_seen_at: '2026-10-07T22:44:00Z' },
  ],
});
const btNightLinks = [L(KNOWN, 'https://bt.example.sg/news/known-one'), L(FRESH, 'https://bt.example.sg/news/brand-new')];

const asyncChecks = (async () => {
  console.log('\n--- rule 7: the nightly run, executed with fakes: order, failure paths, first run, silent sources ---');
  check('Vincent\'s decision is in the code: the first read of a new source reports NONE of its backlog, and the time budget leaves ~100 s of the 280 s for the digest and the saves', FIRST_RUN_REPORT_LIMIT === 0 && SOURCE_START_DEADLINE_MS === 170_000);

  // — a normal night —
  const night = await runScenario({
    tables: baseTables(),
    fetched: { bt: okFetch([got(KNOWN), got(FRESH, 'https://bt.example.sg/news/brand-new')], btNightLinks, 'bt'), iras: okFetch([got('IRAS backlog item one with enough words'), got('IRAS backlog item two with enough words')], [], 'iras'), csis: okFetch([], [], 'csis') },
  });
  const items = night.tables.sg_news_items;
  check('a normal night succeeds and every source\'s facts are in the reply (which withAutomationRun saves)', night.status === 200 && night.body.ok === true && night.body.sources?.length === 3 && night.body.sources.every(s => (s.facts as FetchFacts).status === 200));
  check('ORDER: the digest, then the day\'s report, and only THEN the new items (a failure before the report leaves nothing "seen" but unreported)', at(night.log, 'digest') > -1 && at(night.log, 'upsert sg_news_daily_reports') > at(night.log, 'digest') && at(night.log, 'upsert sg_news_items') > at(night.log, 'upsert sg_news_daily_reports'));
  check('the new item is stored with its article link; the stored item that had no link got the one its headline has on the page; the already linked one is untouched',
    items.find(r => r.title === FRESH)?.url === 'https://bt.example.sg/news/brand-new' && items.find(r => r.title === KNOWN)?.url === 'https://bt.example.sg/news/known-one' && items.find(r => r.title === 'Already linked story')?.url === 'https://bt.example.sg/news/linked');
  check('an item seen again is only touched (last_seen_at refreshed), not stored twice', items.filter(r => r.title === KNOWN).length === 1 && items.find(r => r.title === KNOWN)?.last_seen_at === new Date(night.clock.value).toISOString());
  const iras = night.body.sources?.find(s => s.source === 'iras');
  check('the FIRST read of IRAS stores its whole page and reports none of it: the digest only ever saw The Business Times', items.filter(r => r.source === 'iras').length === 2 && iras?.firstRun === true && iras?.newItems === 2 && iras?.reported === 0 && night.digestSeen.length === 1 && night.digestSeen[0].source === 'bt');
  check('every source ends the night with a state row, and a source with items is not raised as silent (CSIS is exempt)', night.tables.sg_news_sync_state.length === 3 && night.tables.sg_news_sync_state.every(r => r.last_status === 'success') && night.raised.length === 1 && night.raised[0].type === 'source_silent' && night.raised[0].keys.length === 0);
  const report = night.tables.sg_news_daily_reports[0] as { report: { newsItems: Array<{ title: string; url: string | null }> }; new_items_count: number };
  check('the day\'s report holds the new Business Times item with its link, counted as 1 new item (the IRAS backlog is not counted)', report.report.newsItems.length === 1 && report.report.newsItems[0].url === 'https://bt.example.sg/news/brand-new' && report.new_items_count === 1);

  // — the digest fails —
  const digestDown = await runScenario({ tables: baseTables(), digestThrows: true, fetched: { bt: okFetch([got(FRESH)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') } });
  check('a failed digest fails the run — and the reply still carries every source\'s facts, and NOTHING new was stored, so tomorrow finds the item again', digestDown.status === 500 && /digest down/.test(String(digestDown.body.error)) && digestDown.body.sources?.length === 3 && !digestDown.tables.sg_news_items.some(r => r.title === FRESH) && !digestDown.tables.sg_news_daily_reports);

  // — a first item from a source that normally has nothing —
  const csisNews = await runScenario({ tables: baseTables(), fetched: { bt: okFetch([], [], 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([got('CSIS announces its first circular in years')], [], 'csis') } });
  check('CSIS (mayBeEmpty) is never silent about a real item: even its very first one goes into the report', csisNews.digestSeen.some(d => d.source === 'csis' && d.titles.length === 1) && csisNews.body.sources?.find(s => s.source === 'csis')?.reported === 1);

  // — the stored items of one source cannot be read —
  const readFails = await runScenario({
    tables: baseTables(), fail: c => (c.table === 'sg_news_items' && c.op === 'select' && c.paged && c.eq.source === 'iras' ? 'connection reset' : null),
    fetched: { bt: okFetch([got(FRESH)], btNightLinks, 'bt'), iras: okFetch([got('IRAS item that must not be mistaken for a backlog')], [], 'iras'), csis: okFetch([], [], 'csis') },
  });
  const irasFailed = readFails.body.sources?.find(s => s.source === 'iras');
  check('a failed read of the stored items FAILS that source instead of passing as a first run: nothing stored, nothing hidden, the other sources go on', irasFailed?.ok === false && /Could not read the stored items/.test(String(irasFailed?.error)) && !readFails.tables.sg_news_items.some(r => r.source === 'iras') && readFails.tables.sg_news_items.some(r => r.title === FRESH) && readFails.tables.sg_news_sync_state.find(r => r.source === 'iras')?.last_status === 'error');

  // — the time budget —
  const slow = await runScenario({ tables: baseTables(), onFetch: (key, clock) => { if (key === 'bt') clock.value += 200_000; }, fetched: { bt: okFetch([got(FRESH)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') } });
  check('once the run has used its time budget no further source is started (they are recorded as failed), so the digest and the report still happen', slow.fetchedKeys.join() === 'bt' && slow.body.sourcesFailed === 2 && at(slow.log, 'upsert sg_news_daily_reports') > -1 && slow.body.sources?.filter(s => /Not started/.test(String(s.error))).length === 2);

  // — storing fails after the report is saved —
  const storeFails = await runScenario({ tables: baseTables(), fail: c => (c.table === 'sg_news_items' && c.op === 'upsert' ? 'permission denied' : null), fetched: { bt: okFetch([got(FRESH)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') } });
  check('items that cannot be stored FAIL the run (the report is saved, but they would be reported again every night under a green status)', storeFails.status === 200 && storeFails.body.ok === false && /could not store the rest/.test(String(storeFails.body.error)) && at(storeFails.log, 'upsert sg_news_daily_reports') > -1);

  // — the silent-source check —
  const quietIras = await runScenario({ tables: baseTables(), fetched: { bt: okFetch([got(KNOWN)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') } });
  check('a source that has never stored an item is raised as silent; the one that was just read, and CSIS, are not', quietIras.raised.length === 1 && quietIras.raised[0].keys.join() === 'iras' && quietIras.body.silent !== undefined && String(quietIras.body.silent) === 'iras');
  const healthBroken = await runScenario({ tables: baseTables(), fail: c => (c.table === 'sg_news_items' && c.op === 'select' && c.limited ? 'timeout' : null), fetched: { bt: okFetch([got(KNOWN)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') } });
  check('a health check that cannot read its data raises NOTHING (an unreadable table must not read as "every source is silent") and does not fail the run', healthBroken.raised.length === 0 && healthBroken.body.ok === true && (healthBroken.body.warnings ?? []).some(w => /silent-source check/.test(w)));

  // — a second run with nothing new —
  const secondRun = await runScenario({
    tables: { ...baseTables(), sg_news_daily_reports: [{ report_date: '2026-10-09', report: { summary: 'morning', policyItems: [], newsItems: [{ source: 'The Business Times', category: 'news', title: FRESH, url: null, publishedLabel: null, whatChanged: 'w', whyItMatters: 'm' }] }, new_items_count: 1 }] },
    fetched: { bt: okFetch([got(KNOWN)], btNightLinks, 'bt'), iras: okFetch([], [], 'iras'), csis: okFetch([], [], 'csis') },
  });
  check('a second run on the same day with nothing new leaves the morning\'s report exactly as it was', secondRun.body.reportKept === true && at(secondRun.log, 'upsert sg_news_daily_reports') === -1 && (secondRun.tables.sg_news_daily_reports[0].report as { summary: string }).summary === 'morning');

  // — what the fetch does with a page (lib/sg-news-sync-plan.ts readRenderedPage) —
  let extractCalls = 0;
  const page = { status: 200, text: 'x'.repeat(2000), links: [L('Real story headline for the redirect test', 'https://www.example.sg/news-new/real-story'), L('The listing page itself, linked with a long text', 'https://www.example.sg/news-new')], finalUrl: 'https://www.example.sg/news-new', ms: 1200, attempts: 2, blockedHeavy: true };
  const read = await readRenderedPage({ source: { url: 'https://www.example.sg/news-old' }, page, env: { tmpFreeMB: 321, rssMB: 456 }, extract: async () => { extractCalls++; return [{ title: 'Real story headline for the redirect test', url: null }, { title: 'The listing page itself, linked with a long text', url: null }]; } });
  check('a readable page: the extractor runs once, the article is linked, the listing page (its FINAL address, after the redirect) is not taken for an article, and the facts say what was seen',
    !('error' in read) && extractCalls === 1 && read.items[0].url === 'https://www.example.sg/news-new/real-story' && read.items[1].url === null && read.facts.chars === 2000 && read.facts.attempts === 2 && read.facts.tmpFreeMB === 321 && read.facts.finalUrl === 'https://www.example.sg/news-new');
  const forbidden = await readRenderedPage({ source: { url: 'https://csis.example.sg/' }, page: { ...page, status: 403, text: '403 - Forbidden\n\nAccess to this page is forbidden.', links: [] }, env: { tmpFreeMB: null, rssMB: null }, extract: async () => { extractCalls++; return []; } });
  check('a 403 page is a FAILURE that names the status and what the page said — and the extractor is never called for it', 'error' in forbidden && /HTTP 403/.test(forbidden.error) && /Forbidden/.test(forbidden.error) && extractCalls === 1);
  const tiny = await readRenderedPage({ source: { url: 'https://st.example.sg/' }, page: { ...page, text: 'Loading...', links: [] }, env: { tmpFreeMB: null, rssMB: null }, extract: async () => { extractCalls++; return []; } });
  check('a page that never finished rendering ("Loading...") is a failure too, not "0 items"', 'error' in tiny && /almost no text/.test(tiny.error) && extractCalls === 1);
})();


// ── rule 5: a card finds its source even when the model wrote the name its own way ─────────
import { findSourceByLabel } from './lib/sg-news-sources';

console.log('\n--- rule 5: card source labels and the stored-link read ---');
const keyFor = (label: string) => findSourceByLabel(label)?.key ?? null;
check('every configured source name finds its own source', SG_NEWS_SOURCES.every(s => findSourceByLabel(s.name)?.key === s.key));
check('the case from the real data: "Straits Times" (1 of 60 stored cards) is The Straits Times, not "no source"', keyFor('Straits Times') === 'straitstimes');
check('"the business times", "Business Times" and the short key all find The Business Times', keyFor('the business times') === 'businesstimes' && keyFor('Business Times') === 'businesstimes' && keyFor('businesstimes') === 'businesstimes');
check('"CSIS" finds "CSIS (Chartered Secretaries)", and Chinese / short names still work', keyFor('CSIS') === 'csis' && keyFor('联合早报') === 'zaobao' && keyFor('Zaobao') === 'zaobao' && keyFor('acra') === 'acra');
check('an unknown or empty label finds no source (the card then shows its plain source text)', keyFor('Reuters') === null && keyFor('') === null && keyFor('Times') === null);
check('a label that fits SEVERAL sources finds none rather than guessing ("I" is the start of IRAS, ICA and ISCA)', keyFor('I') === null);
const routeSrc = readFileSync('app/api/sg-news/route.ts', 'utf8');
check('the report API looks the card\'s source up tolerantly, not by exact configured name', /findSourceByLabel\(it\.source\)/.test(routeSrc) && !/s\.name\.toLowerCase\(\)/.test(routeSrc));
check('the report API survives a failed read of the stored links (the cards fall back to their source page) instead of answering an empty 500 that the page shows as "Unexpected end of JSON input"', /catch \(err\) \{\s*console\.error\('GET \/api\/sg-news: stored article links unavailable/.test(routeSrc));
check('the report API reads the stored links PAGED (a plain select stops at 1000 rows and would drop links silently)', /pageAll\(\(\) => supabase\.from\('sg_news_items'\)\.select\('source, item_hash, url'\)/.test(routeSrc) && !/await supabase\.from\('sg_news_items'\)\.select\('source, item_hash, url'\)/.test(routeSrc));

asyncChecks.then(() => {
  console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}).catch(err => {
  console.error(err);
  process.exit(2);
});
