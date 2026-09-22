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
 * has CLIENT-BASE and TOP-LINE BILLING data (active/new/churned clients,
 * service mix, revenue by year, staff workload) — no COGS, no balance
 * sheet, no cash flow. Forcing those ratios in would mean inventing the
 * missing inputs, which breaks this file's own no-invented-facts rule
 * below. What DOES transfer: the skill's rigor and format, applied to the
 * data that genuinely exists — not its ratio formulas applied to data that
 * doesn't.
 *
 * Direct Anthropic call, same reliable model/endpoint app/api/assistant/
 * route.ts's claudeAnswer() already uses in production (confirmed live via
 * real ai_agent_runs rows) — NOT lib/ai/openai.ts's multi-model path, whose
 * own production config was still unconfirmed as of 2026-09-21
 * (docs/CURRENT_STATE.md: "a fresh deployment is still needed to load it").
 * A narrative that's supposed to always be there when the page loads should
 * not depend on a still-uncertain second provider — this can gain OpenAI
 * polish later (mirroring lib/ai/orchestrator.ts's synthesizeWithOpenAI
 * pattern) once that path is confirmed live, without changing this file's
 * own contract.
 */

const NARRATIVE_MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null; // undefined growth rate off a zero base — let the model say "no prior-year base", never divide by zero itself
  return Math.round(((curr - prev) / prev) * 1000) / 10; // 1 decimal, matches the skill's own percentage convention
}

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
function summarizeForPrompt(data: ReportsData) {
  const flowByYear = data.flow.years.map((y, i) => ({
    year: y, newClients: data.flow.newClientsTrend[i]?.value ?? 0, churned: data.flow.churnedTrend[i]?.value ?? 0,
  }));
  const revenueByYear = data.revenue.years.map((y, i) => ({
    year: y, invoiceCount: data.revenue.invoiceCountTrend[i]?.value ?? 0, revenueThousandsSGD: data.revenue.revenueTrendThousands[i]?.value ?? 0,
  }));
  const lastIdx = revenueByYear.length - 1;
  const revenueYoyPct = lastIdx > 0 ? pctChange(revenueByYear[lastIdx].revenueThousandsSGD, revenueByYear[lastIdx - 1].revenueThousandsSGD) : null;
  const invoiceCountYoyPct = lastIdx > 0 ? pctChange(revenueByYear[lastIdx].invoiceCount, revenueByYear[lastIdx - 1].invoiceCount) : null;
  const avgInvoiceValueByYear = revenueByYear.map(r => ({ year: r.year, avgInvoiceValueSGD: r.invoiceCount > 0 ? Math.round((r.revenueThousandsSGD * 1000) / r.invoiceCount) : null }));

  return {
    generatedAt: data.generatedAt,
    kpis: data.kpis,
    clientTypeMix: data.clientTypeDonut,
    serviceMix: data.serviceMix,
    customerSourceMix: data.sourceDonut,
    clientFlowByYear: flowByYear,
    revenueByYear,
    // Pre-computed, not for the model to derive — see this function's own
    // header comment.
    computedTrends: {
      revenueYoyPct, invoiceCountYoyPct, avgInvoiceValueByYear,
      note: revenueYoyPct === null ? 'Not enough prior-year data yet to compute YoY growth.' : undefined,
    },
    staffWorkload: data.picWorkload,
    dataScopeCaveat: 'This is CLIENT-BASE and TOP-LINE BILLING data only (active/new/churned client counts, service mix, revenue by year from invoicing, staff workload). There is no cost/expense data, no balance sheet, and no cash flow statement anywhere in this system — never infer or state a profit margin, profitability, asset/liability position, or liquidity ratio; none of those can be computed from what is provided.',
  };
}

export async function generateReportsNarrative(data: ReportsData): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured — the AI analysis cannot run.');

  const evidence = summarizeForPrompt(data);
  const system = `你是 Tassure（新加坡企业服务公司，做公司秘书、提名董事、账目/税务等业务）的资深财务分析师与企业规划顾问，直接向老板 Vincent 汇报。你的分析方法遵循新加坡财务分析的专业规范（信号灯快速评估、同比趋势分析纪律、新加坡数字格式惯例、免责声明），但只应用在下面真正给你的数据范围内。

你会拿到公司 Reports 页面上真实的汇总数据（客户数、新增/流失、服务组合、收入趋势、员工工作量，以及已经算好的同比增长率）。基于这些真实数字写一段面向老板的分析，帮他做前瞻性规划、及早发现风险和机会——不是重复数字，是解读数字背后的含义。

专业规范（来自新加坡财务分析方法论，应用于本次数据范围）：
- 信号灯思维：判断每个关键信号是 🟢健康 / 🟡需关注 / 🟢🟡🔴 挑一个最贴切的放在段落开头对应的地方，不用每句话都加，但至少覆盖1-2个最关键的信号。
- 同比分析纪律：涉及增长率时，直接使用 computedTrends 里已经算好的数字，不要自己心算或重新推导；如果 computedTrends 里某项是 null 或有 note 说明数据不够，就照实说数据不够，不要硬编一个百分比。
- 数字格式：金额用 S$ 前缀（如 S$1.23M 或 S$123,000），百分比保留1位小数（如 12.3%），不用整数估算百分比。
- 范围边界：dataScopeCaveat 字段说明了这份数据不包含什么（成本、利润率、资产负债表、现金流）——绝对不要评论"盈利能力""利润率""财务健康"这类需要成本/资产负债数据才能判断的话题，只分析客户基础、服务结构、收入趋势、人力配置这些真正有数据支撑的方面。
- 免责边界：如果某个判断已经接近"应该怎么做决策"的程度，用"值得进一步核实"或类似措辞，不要说得像最终结论——这是方向性分析，不是正式的审计或会计意见。

硬性规则：
- 只根据给你的真实数据做判断，绝不编造数据里没有的事实、没有的客户名、没有的原因。
- 如果某个结论只是可能性而不是确定的，要明确说"可能是""值得关注"，不要说得像确定的事实。
- 数据不足以支撑判断的地方，直接说数据不够、需要补充什么，不要硬编一个分析出来。
- 语言：中文，直接、简洁、像在跟老板面对面汇报，不要用"首先/其次/总之"这种模板腔调，不要写成正式报告的八股格式，不用 markdown 标题。
- 长度：350-550字，分3-4个自然段（可以在段落开头很自然地带出🟢/🟡/🔴信号，不用刻意做成列表）。
- 覆盖角度尽量包含：这期数据里最值得注意的一两个信号（好的或坏的，带同比数字支撑）、一个具体的风险提醒、一个具体的机会或建议方向。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: NARRATIVE_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `这是本次 Reports 的真实数据：\n\n${JSON.stringify(evidence, null, 2)}\n\n请写你的分析。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = (json.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('Claude returned an empty analysis.');
  return text;
}
