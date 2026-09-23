import 'server-only';
import type { Browser } from 'playwright-core';
import { removeStalePlaywrightTempDirs, withPlaywrightRetry } from './playwright-tmp-cleanup';
import type { SgNewsSource } from './sg-news-sources';

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
      args: [...chromium.args, '--disable-dev-shm-usage'],
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
// Real page text can run long (ACRA's own listing alone was 372 items deep
// before pagination) — capped well before Claude's own context limits
// matter, and recent items are always first on every source checked.
const MAX_RAW_CHARS = 20_000;

async function fetchRenderedText(url: string): Promise<string> {
  return withPlaywrightRetry(async () => {
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(RENDER_SETTLE_MS);
      const text = await page.evaluate(() => document.body.innerText);
      return text.slice(0, MAX_RAW_CHARS);
    } finally {
      await browser.close();
    }
  });
}

export type ExtractedNewsItem = { title: string; url: string | null; publishedLabel: string | null; teaser: string | null };

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
            url: { type: 'string' as const, description: 'Full URL if findable on the page, otherwise omit' },
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

async function extractItems(source: SgNewsSource, rawText: string): Promise<ExtractedNewsItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const system = `你在从一个真实网页的纯文本内容里提取新闻/公告条目列表。这是 ${source.name} 的页面，我们关心的范围是：${source.focus}。

规则：
- 只提取页面上真实存在的条目，绝不编造。标题必须是页面上的原文，不要改写。
- 优先选择看起来是最近的（页面通常按时间倒序排列，靠前的更新）、且与上面关心范围相关的条目——一个专门给新闻网站导航/页脚/广告用的文字不是条目。
- 如果页面上完全没有找到任何相关条目（比如页面加载失败，或者这个来源本来内容就很少），提交一个空数组，不要为了凑数硬编。
- 最多提取20条，标题要和页面上完全一致，不要翻译或改写。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5',
      max_tokens: 3000,
      system,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'submit_items' },
      messages: [{ role: 'user', content: `网页纯文本内容（可能包含导航、广告等无关内容，请自行判断）：\n\n${rawText}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const toolUse = (json.content as Array<{ type: string; input?: unknown }>).find(b => b.type === 'tool_use');
  const items = (toolUse?.input as { items?: ExtractedNewsItem[] } | undefined)?.items;
  return Array.isArray(items) ? items : [];
}

export async function fetchAndExtractSource(source: SgNewsSource): Promise<{ items: ExtractedNewsItem[] } | { error: string }> {
  try {
    const rawText = await fetchRenderedText(source.url);
    if (!rawText.trim()) return { error: 'Page rendered empty content.' };
    const items = await extractItems(source, rawText);
    return { items };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
