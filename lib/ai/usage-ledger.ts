// The AI usage ledger's pure part (docs/INVARIANTS.md INV-AI-010): what a
// call is tagged with, how both providers' usage blocks become the same
// four token buckets, and the exact row each call becomes. Kept free of
// server-only imports so test-ai-usage.ts can check it directly;
// lib/ai/usage.ts does the writing.
import { estimateCostUsd, PRICE_VERSION } from './pricing';

export type AiProvider = 'anthropic' | 'openai';

/** Which part of the system made the call. */
export type AiFeature =
  | 'assistant'          // the AI assistant chat (router, Claude rounds, synthesis, general answers)
  | 'ai_learning'        // conversation learning (after a chat, the nightly pass, or /ai-learning)
  | 'turnover_ai'        // reading an uploaded receipt file
  | 'my_tasks_brief'     // the daily sentence at the top of My Tasks
  | 'reports_narrative'  // the Reports page's AI analysis
  | 'reports_explore'    // the Reports Explore helper that turns a typed request into Explore settings
  | 'ai_quality_review'  // the AI quality spot-check
  | 'sg_news';           // SG Latest News

/**
 * How the call started. Vincent, 2026-10-05: automatic calls that happen
 * because of a person (the learning pass after their chat) count under that
 * person but are shown apart from what they asked for ("算本人，单独标「自动」").
 * Exception, 2026-10-07: the My Tasks reminder is the system's, not the
 * person's, whoever opened the page (SYSTEM_OWNED_FEATURES in usage-report.ts).
 */
export type AiTrigger = 'chat' | 'auto' | 'upload' | 'manual' | 'cron';

export type AiUsageTag = {
  feature: AiFeature;
  trigger: AiTrigger;
  /**
   * The real signed-in person whose action caused the call — under View As
   * this is still the person who pressed the button, never the account
   * being viewed (Vincent: "算真正操作的人"). null = a scheduled job, or a
   * caller the app could not identify.
   */
  actorEmail: string | null;
  /** The account being viewed under View As, when it differs from the actor. */
  subjectEmail?: string | null;
  /** Which call within the feature, e.g. 'router', 'round_2', 'synthesis'. */
  step?: string;
  /** Groups every call made for one chat question. */
  turnKey?: string;
};

/**
 * One call's usage in the same four non-overlapping buckets for both
 * providers. They count differently: Anthropic's input_tokens EXCLUDES the
 * cache (reads and writes come separately), while OpenAI's input_tokens
 * INCLUDES cached tokens and its output_tokens includes reasoning. The
 * assistant re-sends a large cached system prompt and ~30 tool definitions
 * on every round, so logging input_tokens alone would miss most of its
 * input, and adding the buckets up naively would make cheap cache reads
 * (0.1x) look like the bulk — hence tokens AND estimated cost.
 */
export type NormalizedUsage = {
  model: string | null;
  requestId: string | null;
  /** Input not served from the cache. */
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  /** All output, reasoning included. */
  outputTokens: number;
  /** The reasoning share of outputTokens (OpenAI); for information only. */
  reasoningTokens: number;
  webSearchRequests: number;
  /** The provider's own usage block, kept as-is. Never any prompt or reply text. */
  raw: unknown;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function normalizeUsage(provider: AiProvider, payload: unknown): NormalizedUsage | null {
  if (!isObj(payload) || !isObj(payload.usage)) return null;
  const u = payload.usage;
  if (provider === 'anthropic') {
    // When Anthropic reports the 5-minute/1-hour split it is authoritative;
    // without it, every write is the default 5-minute cache (this app never
    // asks for a 1-hour TTL).
    const written = count(u.cache_creation_input_tokens);
    const oneHour = Math.min(isObj(u.cache_creation) ? count(u.cache_creation.ephemeral_1h_input_tokens) : 0, written);
    return {
      model: text(payload.model),
      requestId: text(payload.id),
      inputTokens: count(u.input_tokens),
      cacheWrite5mTokens: written - oneHour,
      cacheWrite1hTokens: oneHour,
      cacheReadTokens: count(u.cache_read_input_tokens),
      outputTokens: count(u.output_tokens),
      reasoningTokens: 0,
      webSearchRequests: isObj(u.server_tool_use) ? count(u.server_tool_use.web_search_requests) : 0,
      raw: u,
    };
  }
  const input = count(u.input_tokens);
  const cached = Math.min(isObj(u.input_tokens_details) ? count(u.input_tokens_details.cached_tokens) : 0, input);
  return {
    model: text(payload.model),
    requestId: text(payload.id),
    inputTokens: input - cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: cached,
    outputTokens: count(u.output_tokens),
    reasoningTokens: isObj(u.output_tokens_details) ? count(u.output_tokens_details.reasoning_tokens) : 0,
    // OpenAI reports each web search as an output item, not in usage.
    webSearchRequests: Array.isArray(payload.output) ? payload.output.filter(item => isObj(item) && item.type === 'web_search_call').length : 0,
    raw: u,
  };
}

/** The ai_usage_events row a call becomes (scripts/add-ai-usage-events.sql). */
export function usageRow(tag: AiUsageTag, provider: AiProvider, usage: NormalizedUsage) {
  const actor = tag.actorEmail?.trim().toLowerCase() || null;
  const subject = tag.subjectEmail?.trim().toLowerCase() || null;
  const cost = estimateCostUsd(provider, usage);
  return {
    actor_email: actor,
    subject_email: subject && subject !== actor ? subject : null,
    feature: tag.feature,
    trigger: tag.trigger,
    step: tag.step ?? null,
    turn_key: tag.turnKey ?? null,
    provider,
    model: usage.model,
    request_id: usage.requestId,
    input_tokens: usage.inputTokens,
    cache_write_tokens: usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
    cache_read_tokens: usage.cacheReadTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    web_search_requests: usage.webSearchRequests,
    cost_usd: cost,
    price_version: cost === null ? null : PRICE_VERSION,
    raw_usage: usage.raw,
  };
}
