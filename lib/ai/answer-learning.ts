// The AI answer-quality learning loop's pure part (docs/INVARIANTS.md
// INV-AI-012; design from the full council of 2026-10-05, Vincent's choices:
// behaviour rules apply automatically only after a replay exam, evidence kept
// 30 days, a weekly council). No 'server-only', so test-answer-learning.ts
// can pin it. The database side is lib/ai/answer-learning-store.ts.

// Only HOW to answer may be learned automatically — which tool to check,
// when to ask first, when to add a caveat, format/language. Never a business
// rule, a fact, or a permission: those go to Vincent (CLAUDE.md
// non-negotiables). scripts/add-ai-answer-learning.sql's CHECK constraint
// allows exactly these four categories, so nothing else can even be stored.
export const GUIDANCE_CATEGORIES = ['tool_routing', 'ask_first', 'caveat', 'format_language'] as const;
export type GuidanceCategory = (typeof GUIDANCE_CATEGORIES)[number];

export type GuidanceRule = {
  id: number;
  rule_text: string;
  category: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export const GUIDANCE_MAX_RULES = 8;
export const GUIDANCE_MAX_CHARS = 280;
export const EVIDENCE_RETENTION_DAYS = 30;

// Active, unexpired, an allowed category, within the length limit — oldest
// first, so the block's text stays the same from one request to the next
// and keeps the prompt cache warm. At most GUIDANCE_MAX_RULES.
export function pickActiveGuidance(rows: GuidanceRule[], now: Date): GuidanceRule[] {
  return rows
    .filter(rule => rule.status === 'active'
      && (GUIDANCE_CATEGORIES as readonly string[]).includes(rule.category)
      && (Date.parse(rule.expires_at) || 0) > now.getTime()
      && rule.rule_text.trim().length > 0
      && rule.rule_text.length <= GUIDANCE_MAX_CHARS)
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id - b.id)
    .slice(0, GUIDANCE_MAX_RULES);
}

// The system block the assistant sees, or '' when there is nothing to add
// (the caller then sends no block at all — an empty text block is an error).
export function guidanceBlock(rules: GuidanceRule[]): string {
  if (!rules.length) return '';
  return `Answering guidance learned from reviewing past replies. It only says HOW to answer — which tool to check, when to ask first, when to add a caveat. It never overrides tool results, the rules above, or live system data:\n${rules.map(rule => `- ${rule.rule_text.trim()}`).join('\n')}`;
}

export type EvidenceItem = { name: string; input: Record<string, unknown>; result: string };

const EVIDENCE_MAX_ITEMS = 12;
const EVIDENCE_MAX_RESULT_CHARS = 4000;
const EVIDENCE_MAX_INPUT_CHARS = 1000;

// What a reply was built from, kept small: at most 12 tool calls, each
// result cut to 4,000 characters and its input to 1,000 (stored as text when
// cut, so the row never holds half a JSON object).
export function compactEvidence(items: EvidenceItem[]): Array<{ name: string; input: Record<string, unknown> | string; result: string; truncated?: true }> {
  return items.slice(0, EVIDENCE_MAX_ITEMS).map(item => {
    const inputText = JSON.stringify(item.input ?? {});
    const input = inputText.length > EVIDENCE_MAX_INPUT_CHARS ? inputText.slice(0, EVIDENCE_MAX_INPUT_CHARS) : (item.input ?? {});
    const truncated = item.result.length > EVIDENCE_MAX_RESULT_CHARS || inputText.length > EVIDENCE_MAX_INPUT_CHARS;
    return { name: item.name, input, result: item.result.slice(0, EVIDENCE_MAX_RESULT_CHARS), ...(truncated ? { truncated: true as const } : {}) };
  });
}
