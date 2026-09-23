import 'server-only';
import type { SgNewsSource } from './sg-news-sources';
import type { ExtractedNewsItem } from './sg-news-fetch';

/**
 * Turns a day's NEW items (already deduped against everything seen before —
 * see app/api/sg-news/sync/route.ts) into the detailed daily report Vincent
 * asked for: "详细而且完整的描述具体的对比和变化...不是给我们客户看，而是
 * 给我们公司的专业人士看的" (detailed, describing the specific comparison/
 * change, written for Tassure's own professionals, not clients).
 *
 * Same structured-tool-call discipline as lib/reports-narrative.ts (forced
 * JSON via `tool_choice`, never "ask for JSON in prose") and the same
 * no-invented-facts rule: every `whatChanged`/`whyItMatters` line must stay
 * grounded in the real title/teaser/date this source actually showed —
 * these come from headlines and short teasers, not full paywalled
 * articles, so the prompt is explicit that inventing detail beyond what
 * the teaser supports is worse than a shorter, honest line.
 */

export type SgNewsDigestItem = {
  source: string; category: 'policy' | 'news';
  title: string; url: string | null; publishedLabel: string | null;
  whatChanged: string; whyItMatters: string;
};
export type SgNewsDailyReport = {
  summary: string;
  policyItems: SgNewsDigestItem[];
  newsItems: SgNewsDigestItem[];
};

type SourceItems = { source: SgNewsSource; items: ExtractedNewsItem[] };

const DIGEST_TOOL = {
  name: 'submit_report',
  description: 'Submit the structured daily SG News report.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string' as const, description: '2-3 sentences: what today’s real haul across all sources adds up to, in plain terms' },
      items: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            source: { type: 'string' as const },
            category: { type: 'string' as const, enum: ['policy', 'news'] },
            title: { type: 'string' as const, description: 'Verbatim from the source' },
            whatChanged: { type: 'string' as const, description: '2-4 detailed sentences: what specifically is new/changed, grounded only in the real title+teaser given — never invent detail beyond what was actually provided' },
            whyItMatters: { type: 'string' as const, description: '1-3 sentences: why a Tassure secretarial/accounting/audit/tax professional should care, or (for news items) what social/business trend this signals' },
          },
          required: ['source', 'category', 'title', 'whatChanged', 'whyItMatters'],
        },
      },
    },
    required: ['summary', 'items'],
  },
};

export async function generateDailyDigest(sourceItems: SourceItems[]): Promise<SgNewsDailyReport> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const totalItems = sourceItems.reduce((s, si) => s + si.items.length, 0);
  if (totalItems === 0) {
    return { summary: '今天9个来源都没有发现新的、之前没见过的条目。', policyItems: [], newsItems: [] };
  }

  const evidence = sourceItems.map(si => ({
    source: si.source.name, category: si.source.category, focus: si.source.focus,
    items: si.items.map(i => ({ title: i.title, url: i.url ?? null, publishedLabel: i.publishedLabel ?? null, teaser: i.teaser ?? null })),
  }));

  const system = `你是 Tassure（新加坡企业服务公司——公司秘书、提名董事、账目、审计、税务）的专业顾问，每天早上给公司内部专业人士（不是客户）写一份详细的监管与时事变化报告。

你会拿到今天从9个来源新发现的真实条目（之前没见过的，已经去重）——ACRA/IRAS/MOM/ICA/ISCA/CSIS 是政策类来源，Straits Times/Business Times/联合早报 是新闻类来源。

硬性规则：
- 每条只能根据给你的真实 title/teaser/publishedLabel 来写，绝不能编造标题里没提到的具体细节、数字、生效日期——如果 teaser 信息不够详细，就诚实地写"具体细节需要点进原文查看"，不要编。
- whatChanged 要写得详细、具体，这是给专业人士看的内部报告，不是给客户看的简化版——但详细不等于编造，是把已知信息讲透、讲清楚这次的变化点在哪。
- whyItMatters 对政策类条目要点出具体对 秘书服务/会计/审计/税务 哪个领域有影响；对新闻类条目要点出社会趋势或生活政策信号。
- 不是每条给的原始条目都值得写进报告——真正跟 Tassure 专业范围无关的（纯粹的活动海报、职位招聘等）可以跳过，不用为了凑数硬塞。
- summary 是开头的整体概述，2-3句话，让老板一眼看出今天有没有大事。
- 语言：中文，专业、直接。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5',
      max_tokens: 4000,
      system,
      tools: [DIGEST_TOOL],
      tool_choice: { type: 'tool', name: 'submit_report' },
      messages: [{ role: 'user', content: `今天新发现的条目：\n\n${JSON.stringify(evidence, null, 2)}\n\n请提交今天的报告。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const toolUse = (json.content as Array<{ type: string; input?: unknown }>).find(b => b.type === 'tool_use');
  const result = toolUse?.input as { summary?: string; items?: (Omit<SgNewsDigestItem, 'url' | 'publishedLabel'> & { url?: string; publishedLabel?: string })[] } | undefined;
  if (!result?.summary) throw new Error('Claude did not return a structured report.');

  // Keyed by title alone, not `${source}|${title}` — Claude only needs to
  // echo the title back exactly (it's told to, and titles are already the
  // de-dup key upstream in app/api/sg-news/sync/route.ts), so this doesn't
  // also depend on it echoing the source name string byte-for-byte, which
  // was a real silent-data-loss risk: a near-miss like "ACRA" vs "The
  // Straits Times" not matching what evidence.source was set to would
  // silently drop a real url/publishedLabel down to null with no error.
  const byTitle = new Map(sourceItems.flatMap(si => si.items.map(i => [i.title, i])));
  const items = (result.items ?? []).map(it => {
    const orig = byTitle.get(it.title);
    return { ...it, url: orig?.url ?? null, publishedLabel: orig?.publishedLabel ?? null } as SgNewsDigestItem;
  });

  return {
    summary: result.summary,
    policyItems: items.filter(i => i.category === 'policy'),
    newsItems: items.filter(i => i.category === 'news'),
  };
}
