import 'server-only';
import { statfs } from 'fs/promises';
import { tmpdir } from 'os';
import { type PageLink } from './sg-news-links';
import { MIN_PAGE_CHARS, factsOfPage, readRenderedPage, type FetchFacts } from './sg-news-sync-plan';
import type { Browser } from 'playwright-core';
import { removeStalePlaywrightTempDirs, withPlaywrightRetry } from './playwright-tmp-cleanup';
import type { SgNewsSource } from './sg-news-sources';
import { claudeMessages } from './ai/anthropic';
import type { AiUsageTag } from './ai/usage';

/**
 * Fetches one SG News source's real, rendered page and asks Claude to pull
 * out a structured list of real items from it. Two real, separately
 * fallible steps — a Playwright render (lib/teamwork-nd.ts's own proven
 * `launchBrowser()` pattern, deliberately duplicated rather than imported:
 * that file's copy is private and TeamWork-login-specific, and this
 * codebase already tolerates one duplicate of this exact function
 * (lib/teamwork-agm.ts has its own too) rather than risk an unrelated
 * refactor of working scraping code — see docs/INVARIANTS.md INV-CRON-013
 * for why `removeStalePlaywrightTempDirs`/`withPlaywrightRetry` specifically
 * ARE still imported, not duplicated: that shared-/tmp-exhaustion incident
 * is real and applies here identically) and a Claude extraction call.
 */

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    await removeStalePlaywrightTempDirs();
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: playwrightChromium } = await import('playwright-core');
    return playwrightChromium.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        // Same three flags as lib/teamwork-agm.ts's launcher, which runs daily on the same Vercel
        // instances. The package defaults to a 32 MB disk cache per launch (visible in the stored
        // 2026-09-23 launch line: --disk-cache-size=33554432); in 6 of the 9 daily reports from
        // 2026-09-29 to 2026-10-07 at least one source failed with ERR_INSUFFICIENT_RESOURCES or
        // "browser has been closed" — Chromium running out of shared memory in /tmp (INV-CRON-013,
        // INV-CRON-019). Not reproducible locally, so this is a likely fix, not a proven one: every
        // run now records /tmp and memory per source (lib/sg-news-sync-plan.ts FetchFacts).
        '--disk-cache-size=0',
        '--media-cache-size=0',
        '--disable-gpu-shader-disk-cache',
      ],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  }) as unknown as Browser;
}

// Confirmed live 2026-09-23 (browser check ahead of building this): every
// one of the 9 real source sites needs actual JS execution before its real
// content is in the DOM — straitstimes.com and csis.org.sg specifically
// showed an empty body / "Loading..." on the very first read, real content
// only after a short wait. 2.5s is comfortably past what either needed live.
const RENDER_SETTLE_MS = 2500;
// A page that still has almost no text after the settle (a slow Vercel CPU, a script still running)
// gets ONE more look before it is called empty. A blocked page (HTTP 4xx) is not given one.
const SECOND_LOOK_MS = 3000;
// Real page text can run long (ACRA's own listing alone was 372 items deep
// before pagination) — capped well before Claude's own context limits
// matter, and recent items are always first on every source checked.
const MAX_RAW_CHARS = 20_000;
// The links never go to the model, so the cap only bounds memory. IRAS's own page has 731 links
// (a mega-menu) with its 20 article links at positions 698–717 — the old cap of 800 was one
// redesign away from cutting them off. Identical (text, address, heading) triples are collapsed.
const MAX_LINKS = 2500;
// withPlaywrightRetry's default: 3 attempts. The LAST one does not block resources (see below).
const RETRY_ATTEMPTS = 3;

export type RenderedPage = {
  text: string;
  links: PageLink[];
  status: number | null;   // HTTP status of the page: page.goto does NOT throw on 403 / 404
  finalUrl: string;        // where the browser ended up (zaobao and ICA redirect)
  ms: number;
  attempts: number;
  blockedHeavy: boolean;   // the attempt that worked had image / media / font requests blocked
};

// Image, media and font requests are aborted by default. The extractor reads text and anchors only,
// and these three are what fill a serverless Chromium's memory on the news sites. CSS and scripts are
// NEVER blocked: innerText depends on CSS (it is what keeps IRAS's huge hidden menu out of the page
// text) and the pages need their scripts to render. Request interception has not been run under the
// Vercel build's `--single-process` Chromium, so the LAST retry does not block anything: if interception
// were what breaks a page there, the source still gets exactly the fetch it had before. `blockHeavy`
// forces it on or off (the check script compares both); `userAgent` overrides the declared browser.
export async function fetchRenderedText(
  url: string,
  options: { blockHeavy?: boolean; userAgent?: string; stats?: { attempts: number } } = {},
): Promise<RenderedPage> {
  const started = Date.now();
  const stats = options.stats ?? { attempts: 0 };
  const page = await withPlaywrightRetry(async () => {
    stats.attempts++;
    const blockHeavy = options.blockHeavy ?? stats.attempts < RETRY_ATTEMPTS;
    const browser = await launchBrowser();
    try {
      // The declared version must be the real one. This used to say "Chrome/124" while running
      // Chromium 149, and csis.org.sg answers that outdated string with "403 - Forbidden" (the real
      // version, or no override at all, gets the full page — tested 2026-10-07).
      const major = browser.version().split('.')[0];
      const context = await browser.newContext({
        userAgent: options.userAgent ?? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
      });
      if (blockHeavy) {
        await context.route('**/*', route => {
          const type = route.request().resourceType();
          return type === 'image' || type === 'media' || type === 'font' ? route.abort() : route.continue();
        });
      }
      const tab = await context.newPage();
      const response = await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = response?.status() ?? null;
      // A server error may pass by itself: let the retry wrapper try again. A 4xx will not (and is
      // reported by the caller, not retried).
      if (status !== null && status >= 500) throw new Error(`HTTP ${status} from ${new URL(url).host}`);

      // The text has no hrefs, so also take the page's real anchors; each extracted headline is matched
      // to one by title afterwards (lib/sg-news-links.ts). A card link wraps a date, tags and a
      // description around its headline (ACRA, ISCA), so when the anchor holds exactly ONE heading
      // element that heading is passed along too — it is the headline itself.
      const readTab = async () => {
        const text = await tab.evaluate(() => document.body.innerText);
        const links = await tab.evaluate((max: number) => {
          const seen = new Set<string>();
          const out: Array<{ text: string; href: string; heading?: string }> = [];
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const text = ((a as HTMLElement).innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
            const href = (a as HTMLAnchorElement).href;
            if (text.length < 12 || !/^https?:/i.test(href)) continue;
            const headings = a.querySelectorAll('h1,h2,h3,h4,h5,h6');
            const heading = headings.length === 1 ? ((headings[0] as HTMLElement).innerText || headings[0].textContent || '').trim().replace(/\s+/g, ' ') : '';
            const key = `${href}\n${text}\n${heading}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(heading ? { text, href, heading } : { text, href });
            if (out.length >= max) break;
          }
          return out;
        }, MAX_LINKS);
        return { text, links };
      };
      await tab.waitForTimeout(RENDER_SETTLE_MS);
      let read = await readTab();
      if ((status === null || status < 400) && read.text.trim().length < MIN_PAGE_CHARS) {
        await tab.waitForTimeout(SECOND_LOOK_MS);
        read = await readTab();
      }
      return { text: read.text.slice(0, MAX_RAW_CHARS), links: read.links, status, finalUrl: tab.url(), blockedHeavy: blockHeavy };
    } finally {
      await browser.close();
    }
  });
  return { ...page, ms: Date.now() - started, attempts: stats.attempts };
}

// Free space in /tmp and the function's memory: the two things Chromium runs out of on Vercel. Recorded
// with every source so that the next failure explains itself (Hobby keeps runtime logs for 1 hour).
async function environmentFacts(): Promise<{ tmpFreeMB: number | null; rssMB: number | null }> {
  let tmpFreeMB: number | null = null;
  let rssMB: number | null = null;
  try { const s = await statfs(tmpdir()); tmpFreeMB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1_048_576); } catch { /* not available on every platform */ }
  try { rssMB = Math.round(process.memoryUsage().rss / 1_048_576); } catch { /* ignore */ }
  return { tmpFreeMB, rssMB };
}

export type ExtractedNewsItem = { title: string; url: string | null; publishedLabel: string | null; teaser: string | null };

// Deliberately NO `url` property: the text the model reads has no hrefs, so any address it returned
// would be recalled or invented — and a stored address is never re-checked and is copied into the
// report. Article links come only from the page's real anchors (lib/sg-news-links.ts).
const EXTRACT_TOOL = {
  name: 'submit_items',
  description: 'Submit the real news/announcement items found on this page.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array' as const,
        maxItems: 20,
        items: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' as const, description: 'The real headline/title, verbatim from the page' },
            publishedLabel: { type: 'string' as const, description: 'The date/time label exactly as shown on the page (e.g. "21 September 2026", "53 mins ago") — never invent or normalize it' },
            teaser: { type: 'string' as const, description: 'The short summary/first line shown with the item, if any — otherwise omit' },
          },
          required: ['title'],
        },
      },
    },
    required: ['items'],
  },
};

const EXTRACT_MAX_TOKENS = 4000;

async function extractItems(source: SgNewsSource, rawText: string, usage: AiUsageTag): Promise<ExtractedNewsItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const system = `你在从一个真实网页的纯文本内容里提取新闻/公告条目列表。这是 ${source.name} 的页面，我们关心的范围是：${source.focus}。

规则：
- 只提取页面上真实存在的条目，绝不编造。标题必须是页面上的原文，不要改写。
- 优先选择看起来是最近的（页面通常按时间倒序排列，靠前的更新）、且与上面关心范围相关的条目——一个专门给新闻网站导航/页脚/广告用的文字不是条目。
- 如果页面上完全没有找到任何相关条目（比如页面加载失败，或者这个来源本来内容就很少），提交一个空数组，不要为了凑数硬编。
- 最多提取20条，标题要和页面上完全一致，不要翻译或改写。`;

  const res = await claudeMessages({ ...usage, step: `extract_${source.key}` }, {
    model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5',
    max_tokens: EXTRACT_MAX_TOKENS,
    system,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_items' },
    messages: [{ role: 'user', content: `网页纯文本内容（可能包含导航、广告等无关内容，请自行判断）：\n\n${rawText}` }],
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  // A list cut off at the ceiling is cut off mid-JSON and would read as "0 items" — the very thing this
  // job must never mistake for a quiet day. Fail the source instead.
  if (json.stop_reason === 'max_tokens') throw new Error(`The extraction for ${source.key} was cut off at ${EXTRACT_MAX_TOKENS} tokens.`);
  const toolUse = (json.content as Array<{ type: string; input?: unknown }>).find(b => b.type === 'tool_use');
  const items = (toolUse?.input as { items?: Array<Partial<ExtractedNewsItem>> } | undefined)?.items;
  // Whatever else came back, the address is dropped here (see EXTRACT_TOOL).
  return Array.isArray(items)
    ? items.filter(i => typeof i?.title === 'string' && i.title.trim()).map(i => ({ title: String(i.title), url: null, publishedLabel: i.publishedLabel ?? null, teaser: i.teaser ?? null }))
    : [];
}

export type FetchedSource = { items: ExtractedNewsItem[]; links: PageLink[]; finalUrl: string; facts: FetchFacts };
export type FailedSource = { error: string; facts: FetchFacts };

// `usage`: the daily cron (system) or a manual run, for the AI usage ledger (INV-AI-010).
export async function fetchAndExtractSource(source: SgNewsSource, usage: AiUsageTag): Promise<FetchedSource | FailedSource> {
  const started = Date.now();
  const stats = { attempts: 0 };
  let page: RenderedPage | null = null;
  try {
    page = await fetchRenderedText(source.url, { stats });
    return await readRenderedPage({ source, page, env: await environmentFacts(), extract: text => extractItems(source, text, usage) });
  } catch (err) {
    // The fetch (browser crash, timeout) or the extraction failed: whatever we know is still worth recording.
    const env = await environmentFacts();
    const facts: FetchFacts = page
      ? factsOfPage(page, env)
      : { status: null, finalUrl: null, chars: 0, links: 0, headingLinks: 0, fetchMs: Date.now() - started, attempts: stats.attempts, blockedHeavy: null, ...env };
    return { error: err instanceof Error ? err.message : String(err), facts };
  }
}
