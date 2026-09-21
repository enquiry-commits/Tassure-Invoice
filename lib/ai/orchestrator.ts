import 'server-only';

import { openAIConfigured, openAIJson, openAIModel, openAIText } from './openai';

export type AgentRoute = 'claude_only' | 'claude_then_openai' | 'openai_only';

export type RouteDecision = {
  route: AgentRoute;
  reason: string;
  risk: 'low' | 'medium' | 'high';
};

export type ToolEvidence = {
  name: string;
  input: Record<string, unknown>;
  result: string;
};

const INTERNAL_TERMS = /(Tassure|My Tasks|Billing|QuickBooks|SOA|outstanding|欠款|公司|客户|发票|开单|PIC|AR Reminder|Late Filing|TeamWork|TAB|TAC|TAO|邮件|email|年报|AGM|XBRL|商标|nominee|director)/i;
const MUTATION_TERMS = /(修改|更新|生成|开单|指派|标记|发送|draft|create|update|change|assign|mark|resolve|confirm)/i;
const COMPLEX_TERMS = /(分析|比较|总结|判断|为什么|趋势|风险|优先|建议|综合|大家|团队|最近.*做|analy[sz]e|compare|summari[sz]e|trend|risk|priorit|recommend)/i;

function fallbackRoute(text: string, hasAttachments: boolean): RouteDecision {
  if (hasAttachments) return { route: 'claude_only', reason: 'attachments stay on the established Claude path', risk: 'medium' };
  if (MUTATION_TERMS.test(text)) return { route: 'claude_then_openai', reason: 'operation preview requires a second-model wording and safety review', risk: 'high' };
  if (INTERNAL_TERMS.test(text) && COMPLEX_TERMS.test(text)) return { route: 'claude_then_openai', reason: 'complex internal analysis benefits from synthesis over live tool evidence', risk: 'medium' };
  if (INTERNAL_TERMS.test(text)) return { route: 'claude_only', reason: 'direct internal lookup uses the mature live-data tool path', risk: 'medium' };
  return { route: 'openai_only', reason: 'general external question does not require Tassure data', risk: 'low' };
}

export async function routeAssistantTurn(params: {
  transcript: string;
  latestText: string;
  hasAttachments: boolean;
  accountEmail?: string | null;
}): Promise<RouteDecision> {
  const fallback = fallbackRoute(params.latestText, params.hasAttachments);
  if (!openAIConfigured() || params.hasAttachments) return fallback;
  // Do not spend a model round-trip classifying a turn whose internal or
  // mutating intent is already explicit. Besides being cheaper, this keeps
  // enough of the route's 60-second budget for Claude's real tool calls and
  // an optional final synthesis.
  if (INTERNAL_TERMS.test(params.latestText) || MUTATION_TERMS.test(params.latestText)) return fallback;
  // Short follow-ups such as "这个呢？" inherit an internal conversation's
  // trust boundary even when the latest sentence contains no system noun.
  if (params.latestText.trim().length < 80 && INTERNAL_TERMS.test(params.transcript)) {
    return { route: 'claude_only', reason: 'ambiguous follow-up remains on the internal-data path', risk: 'medium' };
  }
  try {
    const decision = await openAIJson<RouteDecision>({
      model: openAIModel('router'),
      accountEmail: params.accountEmail,
      schemaName: 'assistant_route',
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          route: { type: 'string', enum: ['claude_only', 'claude_then_openai', 'openai_only'] },
          reason: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['route', 'reason', 'risk'],
      },
      instructions: `You route turns for an internal corporate-services assistant.
- claude_only: direct lookup in Tassure live data or an ordinary system question.
- claude_then_openai: multi-company/person synthesis, management analysis, ambiguity, or any proposed data-changing action. Claude executes the established internal tools; OpenAI reviews and synthesizes.
- openai_only: ONLY a clearly general/external knowledge question that needs no Tassure, company, customer, invoice, staff, task, email, or other internal data.
Be conservative: ambiguous references and follow-ups stay on Claude. Attachments never reach this router. Return only the schema.`,
      input: params.transcript.slice(-12_000),
      maxOutputTokens: 300,
      timeoutMs: 5_000,
    });
    // A deterministic boundary overrides an unsafe model route. Internal
    // data and mutations must never be sent to an OpenAI-only answer path.
    if ((INTERNAL_TERMS.test(params.latestText) || MUTATION_TERMS.test(params.latestText)) && decision.route === 'openai_only') return fallback;
    return decision;
  } catch {
    return fallback;
  }
}

export async function openAIGeneralAnswer(params: {
  transcript: string;
  accountEmail?: string | null;
  currentDate: string;
}): Promise<string> {
  return openAIText({
    accountEmail: params.accountEmail,
    webSearch: true,
    instructions: `You answer general/external questions for a Tassure staff member. Answer in the user's language, usually Chinese. It is ${params.currentDate} in Singapore. You have NO access to Tassure's internal companies, customers, invoices, staff, email, tasks or database. If the request actually needs internal data, say that the internal-system agent must handle it; never invent internal facts. Be concise and cite web sources when web search is used.`,
    input: params.transcript.slice(-18_000),
  });
}

export async function synthesizeWithOpenAI(params: {
  transcript: string;
  claudeDraft: string;
  evidence: ToolEvidence[];
  accountEmail?: string | null;
  hasActionPreview: boolean;
  timeoutMs?: number;
}): Promise<string> {
  if (!openAIConfigured()) return params.claudeDraft;
  const evidence = params.evidence.map(item => ({
    tool: item.name,
    input: item.input,
    result: item.result.slice(0, 6000),
  }));
  try {
    return await openAIText({
      accountEmail: params.accountEmail,
      instructions: `You are the final synthesis and quality-control layer for an internal Tassure assistant. The Claude draft was produced after calling live internal tools. Improve clarity and synthesis, but NEVER invent, change or recompute a name, date, amount, count, permission, status or link. Tool evidence is authoritative over prose. Preserve useful Markdown links and all safety warnings. Answer in the user's language. If an action preview exists, state that nothing has changed yet and the user must click Confirm; never claim execution. Return only the final user-facing answer.`,
      input: JSON.stringify({ conversation: params.transcript.slice(-12_000), claude_draft: params.claudeDraft, tool_evidence: evidence, action_preview_present: params.hasActionPreview }),
      maxOutputTokens: 3000,
      timeoutMs: Math.max(5_000, Math.min(params.timeoutMs ?? 25_000, 25_000)),
    });
  } catch {
    return params.claudeDraft;
  }
}
