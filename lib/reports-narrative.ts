import 'server-only';
import type { ReportsData } from '@/app/api/reports/route';

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
 * Structured output (added same day, round 2) — "文字没有优先级"/"排列也不
 * 整齐": the first version returned one prose blob, which rendered as an
 * undifferentiated wall of text no matter how the prompt asked it to read
 * as prioritized. A plain string can't GUARANTEE visual hierarchy — only
 * real structure can. Forced via an Anthropic tool call (input_schema,
 * tool_choice pinned to it) rather than asking for JSON in prose, which is
 * the reliable way to get structured output from the Messages API — the
 * page renders each `insights[]` entry as its own distinct row (signal
 * badge + title + body), not prose paragraphs. Bilingual for the same
 * reason as the requested toggle button: BOTH languages come back in the
 * same call and get cached together, so switching languages on the page is
 * instant (no second API round-trip, no regenerate).
 *
 * Direct Anthropic call, same reliable model/endpoint app/api/assistant/
 * route.ts's claudeAnswer() already uses in production (confirmed live via
 * real ai_agent_runs rows) — see docs/INVARIANTS.md INV-AI-006 for why this
 * is NOT lib/ai/openai.ts's multi-model path.
 */

const NARRATIVE_MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';

export type ReportsSignal = 'good' | 'watch' | 'warning';
export type ReportsInsight = { signal: ReportsSignal; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string };
export type ReportsNarrative = { insights: ReportsInsight[]; summaryZh: string; summaryEn: string };

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
// year-buckets: the current year's bucket is only ever partial-through-the-
// year (2026 = Jan-Sep so far) while every prior bucket is a full 12
// months, so that comparison was silently 2026 YTD vs all of 2025, exactly
// the failure mode the spec calls out by name. Now uses
// data.revenue.comparableYoy — a real YTD-vs-previous-YTD figure
// (lib/reporting-period.ts, same day-count both sides by construction) —
// and passes its own `comparable`/`comparabilityReason` straight through so
// the model is told explicitly when NOT to present a YoY number, rather
// than silently computing one anyway.
function summarizeForPrompt(data: ReportsData) {
  const flowByYear = data.flow.years.map((y, i) => ({
    year: y, newClients: data.flow.newClientsTrend[i]?.value ?? null, churned: data.flow.churnedTrend[i]?.value ?? null,
  }));
  // Raw multi-year series, null-preserving ("Missing Data Is Not Zero" —
  // a year with no QuickBooks data at all must never look like a real
  // S$0 year to the model). This is CONTEXT for the model to describe the
  // overall shape, not something it should compute a period-over-period
  // percentage from itself — that's exactly what comparableYoy below is
  // for, already validated.
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
    kpis: data.kpis,
    clientTypeMix: data.clientTypeDonut,
    serviceMix: data.serviceMix,
    customerSourceMix: data.sourceDonut,
    clientFlowByYear: flowByYear,
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
      insights: {
        type: 'array' as const,
        minItems: 2, maxItems: 4,
        items: {
          type: 'object' as const,
          properties: {
            signal: { type: 'string' as const, enum: ['good', 'watch', 'warning'] },
            titleZh: { type: 'string' as const, description: '一句话标题，不超过16个汉字，不是完整句子，是标签式短语' },
            titleEn: { type: 'string' as const, description: 'Short headline, under 8 words, phrase not a sentence' },
            bodyZh: { type: 'string' as const, description: '2-4句解读，带具体数字支撑' },
            bodyEn: { type: 'string' as const, description: '2-4 sentences of explanation, with specific supporting numbers' },
          },
          required: ['signal', 'titleZh', 'titleEn', 'bodyZh', 'bodyEn'],
        },
      },
      summaryZh: { type: 'string' as const, description: '1句话范围说明：这份分析基于什么数据，不涉及什么（成本/利润率等）' },
      summaryEn: { type: 'string' as const, description: '1-sentence scope note: what this analysis is based on and what it does not cover (cost/margin etc.)' },
    },
    required: ['insights', 'summaryZh', 'summaryEn'],
  },
};

export async function generateReportsNarrative(data: ReportsData): Promise<ReportsNarrative> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured — the AI analysis cannot run.');

  const evidence = summarizeForPrompt(data);
  const system = `你是 Tassure（新加坡企业服务公司，做公司秘书、提名董事、账目/税务等业务）的资深财务分析师与企业规划顾问，直接向老板 Vincent 汇报。你的分析方法遵循新加坡财务分析的专业规范（信号灯快速评估、同比趋势分析纪律、新加坡数字格式惯例、免责声明），但只应用在下面真正给你的数据范围内。

你会拿到公司 Reports 页面上真实的汇总数据（客户数、新增/流失、服务组合、收入趋势、员工工作量，以及已经算好的同比增长率）。你要通过 submit_analysis 这个工具提交结构化的分析结果——每条 insight 是一个独立的信号/发现，不是把所有内容揉成一段话。

专业规范（来自新加坡财务分析方法论，应用于本次数据范围）：
- 每条 insight 必须先判断信号：good（🟢健康/积极）、watch（🟡需要关注）、warning（🔴需要注意的风险）——按重要性排序，最值得老板先看到的排第一条。
- 同比分析纪律（硬性）：唯一允许提及的"同比/YoY"数字是 comparableRevenueYoy 里已经算好的——它是真正等长的两个区间（今年至今 vs 去年同一段日期，不是去年整年），只有当它的 comparable 字段为 true 时才能把 revenuePctChange/invoiceCountPctChange 说成"同比增长/下降 X%"；如果 comparable 为 false，必须照 comparabilityReason 原样说明数据不可比，绝对不能自己拿 revenueByYear 里任意两年的数字相减算百分比——那个数组只用来描述多年走势的形状（比如"逐年上升"），不能自己心算百分比或增长率。revenueByYear/clientFlowByYear 里任何一年的 value 是 null，代表这个系统对那一年完全没有数据（不是营收为0），必须原样说"这一年没有数据"，不能说成"零收入"或跳过不提。
- 数字格式：金额用 S$ 前缀（如 S$1.23M 或 S$123,000），百分比保留1位小数（如 12.3%），不用整数估算百分比。
- 范围边界：dataScopeCaveat 字段说明了这份数据不包含什么（成本、利润率、资产负债表、现金流）——绝对不要评论"盈利能力""利润率""财务健康"这类需要成本/资产负债数据才能判断的话题，只分析客户基础、服务结构、收入趋势、人力配置这些真正有数据支撑的方面。
- titleZh/titleEn 是短标签，不是句子——好比一个新闻标题，body 里才展开解释和数字。
- 每条 insight 都需要中文和英文两个版本，内容对应一致（不是逐字翻译，但传达同一个判断和同一组数字）。

硬性规则：
- 只根据给你的真实数据做判断，绝不编造数据里没有的事实、没有的客户名、没有的原因。
- 如果某个结论只是可能性而不是确定的，要明确说"可能是""值得关注"，不要说得像确定的事实。
- 数据不足以支撑判断的地方，直接说数据不够、需要补充什么，不要硬编一个分析出来。
- 提交 2-4 条 insights，覆盖：这期数据里最值得注意的信号（好的或坏的，带同比数字支撑）、一个具体的风险提醒、一个具体的机会或建议方向——不要重复内容相近的信号。
- summaryZh/summaryEn 是最后的范围说明（1句话：这是基于客户数/服务量/开票收入数据的判断，不涉及成本或利润率，这部分数据系统里没有），不是又一条 insight。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: NARRATIVE_MODEL,
      max_tokens: 2000,
      system,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_analysis' },
      messages: [{ role: 'user', content: `这是本次 Reports 的真实数据：\n\n${JSON.stringify(evidence, null, 2)}\n\n请调用 submit_analysis 提交你的分析。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const toolUse = (json.content as Array<{ type: string; input?: unknown }>).find(b => b.type === 'tool_use');
  if (!toolUse?.input) throw new Error('Claude did not return a structured analysis.');
  const result = toolUse.input as ReportsNarrative;
  if (!Array.isArray(result.insights) || !result.insights.length) throw new Error('Claude returned an empty analysis.');
  return result;
}
