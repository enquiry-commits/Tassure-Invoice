import 'server-only';

import { after } from 'next/server';
import { createAdminClient } from '../supabase';
import { normalizeUsage, usageRow, type AiProvider, type AiUsageTag } from './usage-ledger';

export type { AiFeature, AiProvider, AiTrigger, AiUsageTag } from './usage-ledger';

// The AI usage ledger (docs/INVARIANTS.md INV-AI-010). Vincent, 2026-10-05:
// "因为我们有AI AGENT，并且全部员工都能用，因此为了准确的知道每个人使用了
// 多少TOKENS，我要有一个明确的实时记录". Every paid Claude/OpenAI API call
// this app makes becomes ONE row in ai_usage_events
// (scripts/add-ai-usage-events.sql), written the moment its response
// arrives — not once per chat question, because one question can be up to
// 7 billed calls on 2 providers, and a question that fails in a later round
// has already been billed for the earlier ones. The providers' own consoles
// cannot say which staff member used what (the app shares one key), so this
// is the only per-person record; their reports are for checking totals.
//
// Calls reach this file only through lib/ai/anthropic.ts and
// lib/ai/openai.ts, each of which requires an AiUsageTag — a call that
// doesn't say who and what it is for does not compile, and
// test-ai-usage.ts fails if any other file calls the APIs directly.

/** Writes one call's row. Never throws: recording usage must never break the call it records. */
export async function recordAiUsage(tag: AiUsageTag, provider: AiProvider, payload: unknown): Promise<void> {
  try {
    const usage = normalizeUsage(provider, payload);
    if (!usage) return;
    const { error } = await createAdminClient().from('ai_usage_events').insert(usageRow(tag, provider, usage));
    // Until Vincent runs scripts/add-ai-usage-events.sql the table doesn't
    // exist — skip quietly. Anything else goes to the server log, so a
    // ledger that silently stops filling can be found.
    if (error && error.code !== 'PGRST205' && error.code !== '42P01') console.error('[ai-usage] not recorded:', error.message);
  } catch (error) {
    console.error('[ai-usage] not recorded:', error instanceof Error ? error.message : error);
  }
}

/**
 * Records a call's usage from its response body. The write starts NOW, not
 * after the reply — a round that fails later, or a function killed at its
 * time limit, keeps the rows for calls already billed — and after() hands
 * it to the platform's waitUntil, keeping the serverless function alive
 * until it has landed without making the person wait for it. Outside a
 * request (scripts, tests) after() throws; the write still runs on its own.
 */
export function trackAiUsage(tag: AiUsageTag, provider: AiProvider, payload: Promise<unknown> | unknown): void {
  const work = Promise.resolve(payload).then(body => recordAiUsage(tag, provider, body), () => {});
  try {
    after(work);
  } catch {
    // not inside a request — nothing to keep alive
  }
}
