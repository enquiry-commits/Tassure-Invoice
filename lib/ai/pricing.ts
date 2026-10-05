// What one AI API call cost, in USD, at the providers' published standard
// prices — written onto each ai_usage_events row when it is recorded
// (lib/ai/usage.ts), so a later price change never rewrites past costs
// (the project's historical-values rule). Vincent chose USD (2026-10-05):
// both providers bill in USD, so the figure lines up with their invoices
// with no exchange rate involved.
//
// Read from the official pages on 2026-10-05:
//   https://platform.claude.com/docs/en/about-claude/pricing
//   https://developers.openai.com/api/docs/pricing
// A model that is not listed here gets NO cost (null) — tokens are still
// recorded and the usage page says the price is unconfirmed. Never guess a
// price: add the model here from the provider's own page instead.
//
// Assumptions this table relies on, all true of this app's calls today:
// standard tier (no Batch, no fast mode), global routing (no
// inference_geo, which would add 1.1x), Claude's default 5-minute cache.
import type { AiProvider, NormalizedUsage } from './usage-ledger';

export const PRICE_VERSION = '2026-10-05';

/** USD per 1M tokens. */
type Rate = { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number; maxInputTokens?: number };

const ANTHROPIC_RATES: ReadonlyArray<readonly [RegExp, Rate]> = [
  // Claude Sonnet 5 and 5.5 (the $2/$10 launch price is now standard).
  [/^claude-sonnet-5/, { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 }],
  [/^claude-sonnet-4-6/, { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 }],
  [/^claude-haiku-4-5/, { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 }],
];

const OPENAI_RATES: ReadonlyArray<readonly [RegExp, Rate]> = [
  // OpenAI has no cache-write charge; cached input is its "cached input"
  // price. Inputs over 272K tokens are priced differently, so they get no
  // estimate rather than a wrong one.
  [/^gpt-5\.6-luna/, { input: 0.2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0.02, output: 1.2, maxInputTokens: 272_000 }],
  [/^gpt-5\.6-terra/, { input: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0.2, output: 12, maxInputTokens: 272_000 }],
  [/^gpt-5\.6-sol/, { input: 4, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0.4, output: 20, maxInputTokens: 272_000 }],
];

/** Both providers charge $10 per 1,000 web searches, on top of tokens. */
const WEB_SEARCH_USD_EACH = 10 / 1000;

export function priceFor(provider: AiProvider, model: string | null): Rate | null {
  if (!model) return null;
  const table = provider === 'anthropic' ? ANTHROPIC_RATES : OPENAI_RATES;
  return table.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

/** Estimated USD for one call, or null when the model's price isn't known. */
export function estimateCostUsd(provider: AiProvider, usage: NormalizedUsage): number | null {
  const rate = priceFor(provider, usage.model);
  if (!rate) return null;
  const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  if (rate.maxInputTokens && totalInput > rate.maxInputTokens) return null;
  const tokenUsd = (
    usage.inputTokens * rate.input
    + usage.cacheWrite5mTokens * rate.cacheWrite5m
    + usage.cacheWrite1hTokens * rate.cacheWrite1h
    + usage.cacheReadTokens * rate.cacheRead
    + usage.outputTokens * rate.output
  ) / 1_000_000;
  return Math.round((tokenUsd + usage.webSearchRequests * WEB_SEARCH_USD_EACH) * 1_000_000) / 1_000_000;
}
