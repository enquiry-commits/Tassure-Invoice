import 'server-only';

import { trackAiUsage, type AiUsageTag } from './usage';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/**
 * The ONE way this app calls Claude (docs/INVARIANTS.md INV-AI-010): a
 * plain, non-streaming POST to the Messages API with the same headers every
 * call site used before, recording the call's token usage the moment the
 * response arrives (lib/ai/usage.ts). The request body is sent exactly as
 * the caller built it.
 *
 * Returns the raw Response, so each caller keeps its own error handling
 * (`if (!res.ok) …`, `await res.json()`) unchanged. Usage is read from a
 * clone before the caller touches the body, so it is recorded even when the
 * caller then rejects the reply (a max_tokens cut-off, a missing tool call)
 * — that call was billed all the same. A failed request (non-2xx) is not
 * billed and records nothing.
 */
export async function claudeMessages(tag: AiUsageTag, body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) trackAiUsage(tag, 'anthropic', res.clone().json());
  return res;
}
