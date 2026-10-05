// The AI quality judge's pure part (docs/INVARIANTS.md INV-AI-006): the exact
// request it sends to Claude and how the reply becomes a verdict. Kept free
// of 'server-only' so test-ai-quality-judge.ts can pin both with canned
// replies — no network, no paid call.

export type QualityIssue = { category: string; description: string };
export type QualityVerdict = { verdict: 'pass' | 'flag'; issues: QualityIssue[] };

// Sonnet 5 thinks by default when `thinking` is left out, and that thinking
// counts toward max_tokens, so the original max_tokens 800 could cut the JSON
// verdict off mid-way (Anthropic's Sonnet 5 migration notes; found
// 2026-10-05, before the first real run). Thinking stays on, at low effort,
// with room to spare: a verdict is a few hundred tokens, and billing is per
// token used, not per token allowed. Low effort also keeps each call short
// enough for the route's 120s limit. Adaptive thinking and `effort` need a
// Claude 4.6+ model — an AI_QUALITY_JUDGE_MODEL override naming an older one
// fails every call (with its error shown on Automation Health).
export const JUDGE_MAX_TOKENS = 4000;

export function judgeRequestBody(model: string, system: string, input: string) {
  return {
    model,
    max_tokens: JUDGE_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: input }],
  };
}

export type JudgeApiReply = { stop_reason?: string | null; content?: Array<{ type: string; text?: string }> };

// Never guesses a verdict: a reply that was cut off, refused, or holds no
// JSON throws, so the caller counts it as an error and the message stays
// unreviewed (picked up again by a later run).
export function parseJudgeResponse(data: JudgeApiReply): QualityVerdict {
  if (data.stop_reason === 'max_tokens') throw new Error(`Judge reply cut off at max_tokens (${JUDGE_MAX_TOKENS})`);
  if (data.stop_reason === 'refusal') throw new Error('Judge declined to review this reply (refusal)');
  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error('Judge returned no parseable JSON');
  const parsed = JSON.parse(match[0]) as { verdict?: string; issues?: unknown };
  const verdict = parsed.verdict === 'flag' ? ('flag' as const) : ('pass' as const);
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((i): i is QualityIssue => !!i && typeof i === 'object' && typeof (i as QualityIssue).category === 'string' && typeof (i as QualityIssue).description === 'string')
        .slice(0, 8)
    : [];
  return { verdict, issues };
}
