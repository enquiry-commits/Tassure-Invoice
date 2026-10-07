// Pins SG Latest News page behaviour (docs/INVARIANTS.md INV-DATA-077, Vincent 2026-10-07):
//   1. Cards sit on a fixed 4-column grid: a section with only 2 items keeps them at the 4-column
//      width and leaves the right-hand slots empty — it never stretches them to half the row each.
//      That is `repeat(auto-fill, …)`; `auto-fit` collapses the empty tracks and stretches.
//      (Measured in a real browser at 1668px: auto-fit gave 2 cards of 827px, auto-fill 407px — the
//      same width as a full row of 4.)
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
const syncSrc = readFileSync('app/api/sg-news/sync/route.ts', 'utf8');
check('the sync route reads today\'s stored report and saves only the merged one (no direct upsert of the fresh digest)', /mergeDailyReport\(stored as/.test(syncSrc) && /report: merged\.report/.test(syncSrc) && !/report, new_items_count: totalNew/.test(syncSrc));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
