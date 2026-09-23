import 'server-only';
import type { ReportsData } from '@/app/api/reports/route';
import { METRIC_CATALOGUE, getMetric } from '@/lib/metric-catalogue';

/**
 * Turns Reports' own numbers into a written analysis — Vincent, after
 * saying the page's raw charts "没有多大用处" (not very useful) to him as
 * the business owner: "能不能...装好一个金融分析师和企业规划师的Ai分析助手
 * ...让这些数据不会只是单单的数字了...帮我企业进行前瞻性的规划和发现预知"
 * (an AI financial-analyst/enterprise-planner assistant, so the data isn't
 * just numbers — forward-looking planning and early signals). He picked
 * "auto-generated narrative" over a chat panel: this always shows something
 * the moment the page loads, no question required.
 *
 * "上面的金融方面的我需要是有专业Skills的支撑和背书的" — the system prompt
 * below deliberately follows the anthropic-skills:sg-financial-report
 * skill's own methodology (its signal-light 🟢🟡🔴 system, YoY-analysis
 * discipline, S$/percentage formatting conventions, Executive-Summary-
 * style structure, and its professional disclaimer), NOT that skill's full
 * ratio suite verbatim — that skill is written for a company's own P&L/
 * balance sheet/cash-flow statement (gross margin, ROE, current ratio,
 * DSO/DPO...), none of which exists anywhere in this system: Reports only
 * has CLIENT-BASE and TOP-LINE BILLING data. Forcing those ratios in would
 * mean inventing the missing inputs.
 *
 * Direct Anthropic call, same reliable model/endpoint app/api/assistant/
 * route.ts's claudeAnswer() already uses in production. Bilingual — both
 * languages come back in the same call and cache together.
 *
 * Reports V3 Phase 1 (2026-09-23, Vincent's approved plan +
 * refinements) — this file's own schema was rewritten a second time in
 * the same phase: FACT/INFERENCE/HYPOTHESIS/ACTION structure
 * (observed/driver/notYetProven/nextAction), confidence split out from
 * signal (never renamed to "severity" — Vincent: "'good' is not
 * semantically a severity level"), driver made NULLABLE (the model must
 * never invent a causal driver just to satisfy the schema), every insight
 * now carries `metricRefs` citing real lib/metric-catalogue.ts entries,
 * and comparable-period validation is now METRIC-SPECIFIC — only an
 * insight that actually cites revenue_yoy/invoice_count_yoy while
 * comparableYoy.comparable is false gets rejected; an unrelated
 * percentage (e.g. "Tax usage = 49.8%", a point-in-time service_mix
 * figure) must never be flagged just for containing a "%" sign.
 */

const NARRATIVE_MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';

export type ReportsSignal = 'good' | 'watch' | 'warning';
export type ReportsConfidence = 'high' | 'medium' | 'low';
export type ReportsInsight = {
  signal: ReportsSignal;
  confidence: ReportsConfidence;
  titleZh: string; titleEn: string;
  observedZh: string; observedEn: string;
  metricRefs: string[];
  driverZh: string | null; driverEn: string | null;
  notYetProvenZh: string[]; notYetProvenEn: string[];
  nextActionZh: string; nextActionEn: string;
};
export type ReportsNarrative = { insights: ReportsInsight[]; summaryZh: string; summaryEn: string };

// Only metrics the model is actually allowed to cite — 'planned' entries
// (nothing computes them yet) are deliberately excluded from what's shown
// to the model at all, not just flagged after the fact, so there is
// nothing in its own context tempting it to reference one.
const CITABLE_METRICS = METRIC_CATALOGUE.filter(m => m.status !== 'planned');

// Deliberately NOT the full companyRows array (900+ objects, mostly
// irrelevant to a narrative and a real prompt-size/cost concern) — just the
// same aggregates already rendered on the page, so the model can never
// surface a number the reader can't also see right next to the text.
//
// YoY growth rates are computed HERE, in code, not left for the model to
// calculate from the raw year-by-year series — same "tool facts are
// authoritative, the model never recomputes them" discipline docs/
// INVARIANTS.md INV-AI-003 already requires of the My Tasks assistant's own
// OpenAI synthesis step; an LLM doing its own arithmetic on 5 data points is
// exactly the kind of thing that occasionally comes out subtly wrong.
//
// Fixed 2026-09-22 (Reports V3 spec, docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md
// §0) — this used to derive "YoY" from the trend series' own last two
// year-buckets, comparing 2026 YTD against all of 2025. Now uses
// data.revenue.comparableYoy — a real YTD-vs-previous-YTD figure
// (lib/reporting-period.ts, same day-count both sides by construction).
function summarizeForPrompt(data: ReportsData) {
  const flowByYear = data.flow.years.map((y, i) => ({
    year: y, newClients: data.flow.newClientsTrend[i]?.value ?? null, churned: data.flow.churnedTrend[i]?.value ?? null,
  }));
  const revenueByYear = data.revenue.years.map((y, i) => ({
    year: y, invoiceCount: data.revenue.invoiceCountTrend[i]?.value ?? null, revenueThousandsSGD: data.revenue.revenueTrendThousands[i]?.value ?? null,
  }));
  const avgInvoiceValueByYear = revenueByYear.map(r => ({
    year: r.year,
    avgInvoiceValueSGD: r.invoiceCount && r.revenueThousandsSGD !== null && r.invoiceCount > 0 ? Math.round((r.revenueThousandsSGD * 1000) / r.invoiceCount) : null,
  }));

  const yoy = data.revenue.comparableYoy;

  return {
    generatedAt: data.generatedAt,
    // The full set of metricIds the model is allowed to cite in any
    // insight's metricRefs — 'partial' entries carry their own
    // `limitation` text, which the model must repeat whenever it cites
    // that metric (enforced by the system prompt, not just documented).
    citableMetrics: CITABLE_METRICS.map(m => ({ metricId: m.metricId, name: m.name, status: m.status, limitation: m.limitation ?? null })),
    kpis: data.kpis,
    clientTypeMix: data.clientTypeDonut,
    serviceMix: data.serviceMix,
    customerSourceMix: data.sourceDonut,
    clientFlowByYear: flowByYear,
    clientFlowDataQuality: { newClients: data.flow.newQuality, churnedClients: data.flow.churnedQuality },
    revenueByYear,
    // The ONLY period-over-period figure this prompt hands the model —
    // already validated comparable (or explicitly marked not comparable,
    // with a reason) by lib/reporting-period.ts before it ever gets here.
    comparableRevenueYoy: {
      currentPeriod: yoy.periodLabel, comparisonPeriod: yoy.comparisonLabel,
      currentRevenueSGD: yoy.currentRevenue, priorRevenueSGD: yoy.priorRevenue,
      currentInvoiceCount: yoy.currentInvoiceCount, priorInvoiceCount: yoy.priorInvoiceCount,
      revenuePctChange: yoy.revenuePctChange, invoiceCountPctChange: yoy.invoiceCountPctChange,
      comparable: yoy.comparable, comparabilityReason: yoy.comparabilityReason,
    },
    avgInvoiceValueByYear,
    staffWorkload: data.picWorkload,
    dataScopeCaveat: 'This is CLIENT-BASE and TOP-LINE BILLING data only (active/new/churned client counts, service mix, revenue by year from invoicing, staff workload). There is no cost/expense data, no balance sheet, and no cash flow statement anywhere in this system — never infer or state a profit margin, profitability, asset/liability position, or liquidity ratio; none of those can be computed from what is provided.',
  };
}

const ANALYSIS_TOOL = {
  name: 'submit_analysis',
  description: 'Submit the structured financial/business analysis for the Reports page.',
  input_schema: {
    type: 'object' as const,
    properties: {
      // First property, and first in `required` below — with `tool_choice`
      // forced, Claude never gets an unconstrained chain-of-thought pass
      // before generating arguments; it plans and writes at the same time.
      // insights[] asks for a lot per item (14 required fields, bilingual,
      // FACT/INFERENCE/HYPOTHESIS/ACTION structure) with zero scratch
      // space — a documented weakness of forced tool-use on complex
      // schemas. This field exists only to give the model somewhere to
      // plan before committing to the structured fields; it is stripped
      // out of the result before anything (validation, cache, the page)
      // ever sees it. Added 2026-09-23 as a SECOND attempt at "Claude
      // returned an empty analysis" — the first attempt (removing the
      // driverZh/En union type, raising max_tokens 2600->4096) did NOT
      // resolve it: Vincent reported the identical error afterward. This
      // is a reasoned guess, not a confirmed fix — nothing here could be
      // verified against a real API call (see callClaude()'s new logging
      // below, added specifically because this file had NO server-side
      // diagnostics at all for this failure before now).
      planningNotes: {
        type: 'string' as const,
        description: '内部草稿区，不会展示给用户——正式填写 insights 之前，先在这里用几句话想清楚：这次数据里最值得报告的2-4个方向分别是什么、每个大致的 signal/confidence、driver 有没有把握（没把握就打算留空）。想清楚了再往下正式填写。',
      },
      insights: {
        type: 'array' as const,
        minItems: 2, maxItems: 4,
        items: {
          type: 'object' as const,
          properties: {
            signal: { type: 'string' as const, enum: ['good', 'watch', 'warning'], description: '这条洞察本身重不重要/要不要关注——good=健康, watch=需要留意, warning=需要注意的风险' },
            confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'], description: '独立于 signal 的判断：这个结论本身有多可靠？一条 warning 级别的信号完全可以只有 medium/low 置信度（问题真实存在，但原因还不确定）' },
            titleZh: { type: 'string' as const, description: '一句话标题，不超过16个汉字，不是完整句子，是标签式短语' },
            titleEn: { type: 'string' as const, description: 'Short headline, under 8 words, phrase not a sentence' },
            observedZh: { type: 'string' as const, description: 'FACT——直接来自数据的客观陈述，带具体数字，不包含任何解读或原因推测' },
            observedEn: { type: 'string' as const, description: 'FACT — an objective, data-grounded statement with specific numbers, no interpretation or causal reasoning' },
            metricRefs: { type: 'array' as const, items: { type: 'string' as const }, description: '这条 insight 引用的真实 metricId 列表（必须来自下面给你的 citableMetrics，不能编造）——observed 里提到的每个数字都应该能在这里找到对应的 metricId' },
            // Kept as a required plain string (never `type: ['string','null']`)
            // — a union-type JSON Schema field is technically valid but is
            // exactly the kind of thing that risks going wrong silently
            // inside a forced tool-call: found live 2026-09-23 (Vincent's
            // screenshot, "Claude returned an empty analysis") immediately
            // after this schema shipped. The nullable CONTRACT is kept via
            // an explicit empty-string convention instead — universally
            // supported, no ambiguity — and normalizeInsight() below
            // converts "" back to a real `null` before this ever reaches a
            // caller, so ReportsInsight's own `driverZh: string | null`
            // type is unaffected.
            driverZh: { type: 'string' as const, description: 'INFERENCE——对 observed 事实的合理解读，必须有把握才写；如果证据不足以支撑任何解读，就填空字符串 ""，绝不为了填满这个字段而编一个原因' },
            driverEn: { type: 'string' as const, description: 'INFERENCE — a reasonable read of the observed fact; use an empty string "" if the evidence does not actually support any interpretation, never invent one to fill the field' },
            notYetProvenZh: { type: 'array' as const, items: { type: 'string' as const }, description: 'HYPOTHESIS——尚未证实的可能解释列表，每条都是一个具体的、未来可以去验证的可能性' },
            notYetProvenEn: { type: 'array' as const, items: { type: 'string' as const }, description: 'HYPOTHESIS — a list of specific, not-yet-proven possible explanations, each independently verifiable later' },
            nextActionZh: { type: 'string' as const, description: 'ACTION——具体的下一步分析或操作建议，不是泛泛的"持续关注"' },
            nextActionEn: { type: 'string' as const, description: 'ACTION — a concrete next analysis or operational step, not generic "keep monitoring"' },
          },
          required: ['signal', 'confidence', 'titleZh', 'titleEn', 'observedZh', 'observedEn', 'metricRefs', 'driverZh', 'driverEn', 'notYetProvenZh', 'notYetProvenEn', 'nextActionZh', 'nextActionEn'],
        },
      },
      summaryZh: { type: 'string' as const, description: '1句话范围说明：这份分析基于什么数据，不涉及什么（成本/利润率等）' },
      summaryEn: { type: 'string' as const, description: '1-sentence scope note: what this analysis is based on and what it does not cover (cost/margin etc.)' },
    },
    required: ['planningNotes', 'insights', 'summaryZh', 'summaryEn'],
  },
};

function buildSystemPrompt(): string {
  return `你是 Tassure（新加坡企业服务公司，做公司秘书、提名董事、账目/税务等业务）的资深财务分析师与企业规划顾问，直接向老板 Vincent 汇报。你的分析方法遵循新加坡财务分析的专业规范（信号灯快速评估、同比趋势分析纪律、新加坡数字格式惯例、免责声明），但只应用在下面真正给你的数据范围内。

你会拿到公司 Reports 页面上真实的汇总数据。你要通过 submit_analysis 这个工具提交结构化的分析结果——每条 insight 必须按 FACT → INFERENCE → HYPOTHESIS → ACTION 的顺序组织，不是把所有内容揉成一段话：

- observed（FACT）：直接来自数据的客观陈述，带具体数字。绝不能包含"因为/所以/说明/反映了"这类解读词——纯陈述事实。
- driver（INFERENCE，可以留空）：对 observed 事实的合理解读。**如果证据不足以支撑任何解读，driverZh/driverEn 必须提交空字符串 ""，绝不能为了填满这个字段编一个听起来合理的原因**——没有把握就是没有把握，留空比编一个不确定的解读更诚实。
- notYetProven（HYPOTHESIS）：尚未证实的可能解释，列出具体的、未来可验证的可能性（不是"可能有很多原因"这种空话）。
- nextAction（ACTION）：具体的下一步分析或操作建议。

metricRefs 规则（硬性）：
- 每条 insight 的 metricRefs 必须引用下面 citableMetrics 里真实存在的 metricId，不能编造一个不存在的 id。
- observed 里提到的每一个数字，都应该能在 metricRefs 里找到对应支撑它的 metricId。
- citableMetrics 里 status 为 "partial" 的指标，如果引用了，必须在 observed 或 driver 里原样带出它自己的 limitation 说明（例如日期解析覆盖率不是100%），不能假装它是精确数字。
- citableMetrics 里没有出现的任何指标（比如 GRR/NRR/service_attach_rate 这些还没做出来的）绝对不能引用或提及为"我们算出的数据"——如果某个分析方向理论上有价值但系统里没有这个指标，在 nextAction 里说"需要先建立这个指标"，不要假装引用了它。

同比分析纪律（硬性，且是 metricRefs 级别的规则，不是"看到百分号就拦"）：
- 唯一允许说成"同比/YoY"的数字是 comparableRevenueYoy 里已经算好的 revenuePctChange/invoiceCountPctChange——只有当 comparableRevenueYoy.comparable 为 true 时，引用了 metricRefs 里 "revenue_yoy" 或 "invoice_count_yoy" 的 insight 才能把这个数字说成"同比增长/下降 X%"。
- 如果 comparableRevenueYoy.comparable 为 false，任何引用 "revenue_yoy"/"invoice_count_yoy" 的 insight 都必须改用 comparabilityReason 原样说明数据不可比，不能给出任何"同比"百分比。
- 这条规则只约束 revenue_yoy/invoice_count_yoy 这两个指标本身——**其他指标里出现的百分比（比如 service_mix 里"Tax 使用率 49.8%"这种时点占比）跟同比可比性完全无关，正常引用，不要因为看到百分号就联想到同比规则**。
- revenueByYear/clientFlowByYear 里任何一年的 value 是 null，代表这个系统对那一年完全没有数据，必须原样说"这一年没有数据"，不能说成"零"或跳过不提。

专业规范：
- 每条 insight 先判断 signal（good/watch/warning，按重要性排序，最值得老板先看到的排第一条）和独立的 confidence（high/medium/low）——这两个是不同的轴：一条 warning 信号完全可以只有 medium 甚至 low 的置信度（问题真实存在，但原因还不确定），不要把两者混为一谈。
- 数字格式：金额用 S$ 前缀（如 S$1.23M），百分比保留1位小数（如 12.3%）。
- 范围边界：dataScopeCaveat 说明了这份数据不包含成本、利润率、资产负债表、现金流——绝对不要评论"盈利能力""利润率""财务健康"。
- titleZh/titleEn 是短标签，不是句子。每条 insight 都需要中文和英文两个版本，内容对应一致。

硬性规则：
- 只根据给你的真实数据做判断，绝不编造数据里没有的事实、没有的客户名、没有的原因。
- notYetProven 里的每一条都要是具体的可能性，不要写"可能有很多因素"这种空话。
- 提交 2-4 条 insights，不要重复内容相近的信号。
- summaryZh/summaryEn 是最后的范围说明，不是又一条 insight。`;
}

// Reports V3 Phase 1 — deterministic validation, applied to the FINAL
// output before it is ever returned/cached (same "guard the final text,
// not an intermediate draft" lesson INV-AI-004 already established for the
// chat assistant). Two independent checks:
//
// 1. metricRefs integrity — every cited id must be a real catalogue entry,
//    and a 'planned' (not yet built) metric must never be cited at all,
//    per Vincent's explicit instruction.
// 2. Metric-SPECIFIC comparable-period enforcement — only an insight
//    citing revenue_yoy/invoice_count_yoy while comparableYoy.comparable
//    is false is rejected; an insight with an unrelated percentage (e.g.
//    a service_mix attach share) must never be flagged just for
//    containing a "%" — this replaced an earlier, cruder "any percentage
//    + comparable:false = reject" design specifically because it would
//    have wrongly rejected exactly that kind of claim (Vincent's own
//    worked example, "Tax usage = 49.8%").
export type NarrativeValidation = { valid: boolean; errors: string[] };

export function validateNarrative(narrative: ReportsNarrative, data: ReportsData): NarrativeValidation {
  const errors: string[] = [];
  const yoyComparable = data.revenue.comparableYoy.comparable;
  for (const insight of narrative.insights) {
    for (const ref of insight.metricRefs) {
      const metric = getMetric(ref);
      if (!metric) { errors.push(`Insight "${insight.titleEn}" cites unknown metricRef "${ref}" — not a real catalogue entry.`); continue; }
      if (metric.status === 'planned') errors.push(`Insight "${insight.titleEn}" cites "${ref}", a PLANNED metric with nothing computing it yet — must never be cited by the production narrative.`);
    }
    const citesRevenueYoy = insight.metricRefs.includes('revenue_yoy') || insight.metricRefs.includes('invoice_count_yoy');
    if (citesRevenueYoy && !yoyComparable) {
      errors.push(`Insight "${insight.titleEn}" cites revenue_yoy/invoice_count_yoy while comparableRevenueYoy.comparable is false — a YoY figure was presented without a valid comparable period.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// "" -> null for driverZh/driverEn — see the comment on ANALYSIS_TOOL's
// driverZh field above for why the wire format uses an empty string. Every
// caller (validateNarrative, app/reports/page.tsx's {driver && (...)}
// rendering, the cache-shape check in app/api/reports/narrative/route.ts)
// gets the real `string | null` the exported ReportsInsight type promises.
function normalizeInsight(insight: ReportsInsight): ReportsInsight {
  return {
    ...insight,
    driverZh: insight.driverZh === '' ? null : insight.driverZh,
    driverEn: insight.driverEn === '' ? null : insight.driverEn,
  };
}

async function callClaude(system: string, evidence: unknown): Promise<ReportsNarrative> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: NARRATIVE_MODEL,
      // 4096, not the original 2600 — matches app/api/assistant/route.ts's
      // own claudeAnswer() (INV-DATA-047: the exact same "output silently
      // truncated by too-small max_tokens" failure mode, fixed there by
      // raising 1024 -> 4096). The Phase 1 schema is ~3x the old one (14
      // required fields incl. two bilingual arrays per insight, up to 4
      // insights) — 2600 was sized for the OLD, smaller schema and is a
      // second plausible contributor (alongside the driverZh/En union-type
      // schema fix above) to the live "Claude returned an empty analysis"
      // bug: a response cut off mid-JSON by hitting max_tokens can come
      // back with no usable tool_use.input at all.
      max_tokens: 4096,
      system,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_analysis' },
      messages: [{ role: 'user', content: `这是本次 Reports 的真实数据：\n\n${JSON.stringify(evidence, null, 2)}\n\n请调用 submit_analysis 提交你的分析。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const content = Array.isArray(json.content) ? (json.content as Array<{ type: string; input?: unknown }>) : [];
  const toolUse = content.find(b => b.type === 'tool_use');
  // This file previously logged NOTHING server-side on either failure path
  // below — a real gap, confirmed 2026-09-23 when "Claude returned an
  // empty analysis" recurred in production after a first fix attempt and
  // there was nothing in Vercel's function logs to diagnose WHY beyond the
  // generic message the user already sees. Logging the actual shape of
  // Claude's response (never the full evidence/system prompt — no need,
  // and evidence includes real business figures) so the next occurrence is
  // diagnosable from Vercel's logs instead of requiring another guess.
  if (!toolUse?.input) {
    console.error('[reports-narrative] no usable tool_use block', {
      stopReason: json.stop_reason,
      contentBlockTypes: content.map(b => b.type),
    });
    throw new Error('Claude did not return a structured analysis.');
  }
  // `planningNotes` (a scratchpad field, see ANALYSIS_TOOL above) is
  // deliberately NOT part of ReportsNarrative — dropped here rather than
  // destructured-and-discarded so no unused-binding lint warning either.
  const result = toolUse.input as ReportsNarrative & { planningNotes?: string };
  if (!Array.isArray(result.insights) || !result.insights.length) {
    console.error('[reports-narrative] tool_use.input has no usable insights', {
      stopReason: json.stop_reason,
      inputKeys: Object.keys(toolUse.input as object),
      rawInput: JSON.stringify(toolUse.input).slice(0, 3000),
    });
    throw new Error('Claude returned an empty analysis.');
  }
  const narrative: ReportsNarrative = { insights: result.insights, summaryZh: result.summaryZh, summaryEn: result.summaryEn };
  return { ...narrative, insights: narrative.insights.map(normalizeInsight) };
}

// One attempt: call Claude, then validate. Returns the narrative on success,
// or the reason it failed (a thrown error from callClaude — API error,
// malformed/empty tool-use response — OR a validateNarrative() rule
// violation) so generateReportsNarrative() can retry EITHER kind uniformly.
// Previously only a validation failure retried; a thrown error propagated
// immediately with zero retry attempts, so a one-off transient/malformed
// response (the more recoverable case, not a substantive rule violation)
// got the worse treatment. Found live 2026-09-23 alongside the driverZh/En
// schema bug via the same screenshot ("Claude returned an empty analysis").
async function attempt(system: string, evidence: unknown, data: ReportsData): Promise<{ narrative: ReportsNarrative } | { narrative: null; errors: string[] }> {
  let narrative: ReportsNarrative;
  try {
    narrative = await callClaude(system, evidence);
  } catch (err) {
    return { narrative: null, errors: [err instanceof Error ? err.message : String(err)] };
  }
  const check = validateNarrative(narrative, data);
  if (check.valid) return { narrative };
  return { narrative: null, errors: check.errors };
}

export async function generateReportsNarrative(data: ReportsData): Promise<ReportsNarrative> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured — the AI analysis cannot run.');

  const evidence = summarizeForPrompt(data);
  const system = buildSystemPrompt();

  const first = await attempt(system, evidence, data);
  if (first.narrative) return first.narrative;

  // One retry, with the SPECIFIC failure reason fed back as an explicit
  // correction instruction — "reject / regenerate", per Vincent's own
  // instruction, not a silent text patch over a wrong claim. Works the same
  // whether the first attempt threw or just failed validation.
  const retrySystem = `${system}\n\n上一次提交的分析未能通过校验，请重新生成，这次务必遵守：\n${first.errors.map(e => `- ${e}`).join('\n')}`;
  const second = await attempt(retrySystem, evidence, data);
  if (second.narrative) return second.narrative;

  throw new Error(`AI analysis failed after retry: ${second.errors.join('; ')}`);
}
