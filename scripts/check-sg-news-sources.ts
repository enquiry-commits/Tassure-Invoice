// READ-ONLY check of SG Latest News against the LIVE source pages (docs/INVARIANTS.md INV-DATA-077,
// docs/REGRESSION_CHECKLIST.md REG-042). It runs the app's REAL fetch code (lib/sg-news-fetch.ts
// `fetchRenderedText`: headless Chromium, the same 2.5s settle, user agent and link collection) on each
// source and the app's REAL matcher (lib/sg-news-links.ts) over the stored headlines, and reports per source:
//   - what the page gave: HTTP status, final address, text length, links, links that carry a heading;
//     an HTTP error or an almost empty page is a PROBLEM (the sync records it as a failed source);
//   - for each stored headline: linked to an article, "not on the page" (an older item, expected), or
//     "ON the page but not linked" (a matcher miss — the number that matters; exit code 1 if any);
//   - links whose address shares almost no words with the headline ("check by eye"), and two headlines
//     sharing one address (a wrong match shows up exactly like this);
//   - for a source with no stored items: the headline links the page offers, to judge by eye.
// `--compare-old` also fetches every page the way the code did before 2026-10-07 (no blocking of
// images / media / fonts, the hard-coded "Chrome/124" user agent) and says whether the new fetch sees less.
// No model call, no writes anywhere: the stored headlines are read with a plain GET.
// NOT covered: the Vercel Lambda itself (its Chromium build, memory, /tmp, how the sites treat its
// addresses) — only the real nightly run shows that; it records every source's facts in
// automation_sync_runs.summary (docs/REGRESSION_CHECKLIST.md REG-042).
//   npx tsx scripts/check-sg-news-sources.ts [--compare-old] [source-key ...]
// Needs .env.local for the stored headlines (ENV_FILE=<path> to point elsewhere); without it only the
// page-side facts are printed. It stubs `server-only` for itself by re-running under a temporary NODE_PATH.
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// `lib/sg-news-fetch.ts` imports 'server-only', which throws outside Next.js; give it an empty stand-in.
if (!process.env.SG_NEWS_CHECK_CHILD) {
  const stub = join(tmpdir(), 'sg-news-check-stub');
  mkdirSync(join(stub, 'node_modules', 'server-only'), { recursive: true });
  writeFileSync(join(stub, 'node_modules', 'server-only', 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(stub, 'node_modules', 'server-only', 'package.json'), '{"name":"server-only","version":"0.0.0","main":"index.js"}\n');
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, SG_NEWS_CHECK_CHILD: '1', NODE_PATH: join(stub, 'node_modules') },
  });
  process.exit(r.status ?? 1);
}

try {
  for (const line of readFileSync(process.env.ENV_FILE ?? '.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no env file: page-side facts only */ }

const STORED_PER_SOURCE = 40;
const OLD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function storedHeadlines(key: string): Promise<string[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  const res = await fetch(`${url}/rest/v1/sg_news_items?select=title&source=eq.${encodeURIComponent(key)}&order=first_seen_at.desc&limit=${STORED_PER_SOURCE}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) return null;
  const rows = await res.json() as Array<{ title: string }>;
  return rows.map(r => r.title);
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
const pathOf = (href: string) => { try { const u = new URL(href); return u.pathname + u.search; } catch { return href; } };

(async () => {
  const { SG_NEWS_SOURCES } = await import('../lib/sg-news-sources');
  const { fetchRenderedText } = await import('../lib/sg-news-fetch');
  const { findLinkForTitle, normalizeNewsTitle } = await import('../lib/sg-news-links');
  const { pageProblem } = await import('../lib/sg-news-sync-plan');

  const compareOld = process.argv.includes('--compare-old');
  const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const sources = wanted.length ? SG_NEWS_SOURCES.filter(s => wanted.includes(s.key)) : SG_NEWS_SOURCES;
  let problems = 0;
  const summary: string[] = [];

  for (const source of sources) {
    console.log(`\n== ${source.key}  ${source.url}`);
    let page: Awaited<ReturnType<typeof fetchRenderedText>>;
    try {
      page = await fetchRenderedText(source.url);
    } catch (err) {
      console.log(`   FETCH FAILED: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      summary.push(`${source.key.padEnd(14)} fetch failed`);
      problems++;
      continue;
    }
    const { text, links } = page;
    const chars = text.trim().length;
    const withHeading = links.filter(l => l.heading).length;
    console.log(`   page: HTTP ${page.status} -> ${page.finalUrl}`);
    console.log(`         ${chars} chars of text, ${links.length} links (${withHeading} carry a heading), ${page.ms} ms, ${page.attempts} attempt(s)`);

    if (compareOld) {
      try {
        const old = await fetchRenderedText(source.url, { blockHeavy: false, userAgent: OLD_USER_AGENT });
        const oldChars = old.text.trim().length;
        const same = old.status === page.status && Math.abs(oldChars - chars) <= Math.max(50, chars * 0.05) && Math.abs(old.links.length - links.length) <= Math.max(5, links.length * 0.05);
        console.log(`   old fetch (no blocking, Chrome/124): HTTP ${old.status}, ${oldChars} chars, ${old.links.length} links (${old.links.filter(l => l.heading).length} headings)  ->  ${same ? 'SAME as the new fetch' : 'DIFFERENT from the new fetch'}`);
        if (!same && (chars < oldChars * 0.95 || links.length < old.links.length * 0.95)) { console.log('   PROBLEM: the new fetch sees LESS than the old one'); problems++; }
      } catch (err) {
        console.log(`   old fetch failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      }
    }

    const problem = pageProblem({ status: page.status, chars });
    if (problem) {
      console.log(`   PROBLEM: ${problem} — the sync would record this source as failed. The page says: ${JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 100))}`);
      summary.push(`${source.key.padEnd(14)} PROBLEM: ${problem}`);
      problems++;
      continue;
    }

    const listings = [source.url, page.finalUrl];
    const titles = await storedHeadlines(source.key);
    if (!titles?.length) {
      const listingPath = new URL(page.finalUrl).pathname.replace(/\/+$/, '');
      // Card links hand over their heading; plain links are judged by their text and by sitting under the listing.
      const offered = links.filter(l => {
        if (l.heading && l.heading.length >= 20) return true;
        let p = '';
        try { p = new URL(l.href).pathname.replace(/\/+$/, ''); } catch { return false; }
        return l.text.length >= 25 && p !== listingPath && p.startsWith(listingPath + '/');
      });
      console.log(titles === null ? '   (no stored headlines available: no env or read failed)' : '   no stored items for this source.');
      console.log(`   headline links the page offers (${offered.length}):`);
      for (const l of offered.slice(0, 8)) console.log(`     ${(l.heading ?? l.text).slice(0, 78)}  ->  ${pathOf(l.href).slice(0, 80)}`);
      if (!offered.length && !source.mayBeEmpty) { console.log('   PROBLEM: no headline links at all — this URL is probably a menu, not the list'); problems++; }
      summary.push(`${source.key.padEnd(14)} ${String(links.length).padStart(4)} links | no stored items | ${offered.length} headline links offered`);
      continue;
    }

    const pageText = normalizeNewsTitle(text);
    let linked = 0, offPage = 0;
    const missOnPage: string[] = [], suspect: string[] = [];
    const byUrl = new Map<string, string[]>();
    for (const title of titles) {
      const href = findLinkForTitle(title, links, listings);
      if (!href) {
        if (pageText.includes(normalizeNewsTitle(title))) missOnPage.push(title); else offPage++;
        continue;
      }
      linked++;
      byUrl.set(href, [...(byUrl.get(href) ?? []), title]);
      const slug = words(decodeURIComponent(pathOf(href)).replace(/[-_/?=.]+/g, ' '));
      const tw = words(title);
      if (slug.size >= 3) {
        const shared = [...tw].filter(w => slug.has(w)).length;
        if (tw.size && shared / tw.size < 0.4) suspect.push(`${title.slice(0, 60)}  ->  ${pathOf(href).slice(0, 70)}`);
      }
    }
    const shared = [...byUrl.entries()].filter(([, ts]) => ts.length > 1);
    console.log(`   stored headlines checked: ${titles.length} | linked ${linked} | not on the page ${offPage} | ON the page but NOT linked ${missOnPage.length}`);
    if (linked === 0 && missOnPage.length === 0) {
      console.log(`   (every stored headline is off the page — compare by eye)  newest stored: ${JSON.stringify(titles[0]?.slice(0, 60))}  |  first on the page: ${JSON.stringify((links.find(l => l.heading) ?? links[0])?.text.slice(0, 60))}`);
    }
    for (const t of missOnPage) console.log(`     MISS  ${t.slice(0, 100)}`);
    for (const s of suspect) console.log(`     CHECK BY EYE (address shares few words with the headline)  ${s}`);
    for (const [href, ts] of shared) console.log(`     SAME ADDRESS FOR ${ts.length} HEADLINES  ${pathOf(href).slice(0, 80)}  <-  ${ts.map(t => t.slice(0, 40)).join(' | ')}`);
    problems += missOnPage.length + shared.length;
    summary.push(`${source.key.padEnd(14)} ${String(links.length).padStart(4)} links | ${String(titles.length).padStart(2)} stored: linked ${String(linked).padStart(2)}, off page ${String(offPage).padStart(2)}, MISS ${missOnPage.length}, by-eye ${suspect.length}, shared ${shared.length}`);
  }

  console.log('\n== summary');
  for (const s of summary) console.log('   ' + s);
  console.log(problems === 0 ? '\nOK: no matcher miss, no shared address, every source fetched and readable' : `\n${problems} problem(s) above`);
  // exitCode, not process.exit(): exiting while Chromium's pipes are still closing aborts Node on Windows.
  process.exitCode = problems === 0 ? 0 : 1;
})().catch(err => { console.error(err); process.exitCode = 2; });
