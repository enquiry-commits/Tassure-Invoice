// Which of a user's memories go into the assistant's prompt, and how they
// are labelled (docs/INVARIANTS.md INV-AI-011). Pure, so
// test-prompt-memories.ts can pin it.
//
// Found 2026-10-05 on real data: Vincent's account had 10 memories and the
// prompt took the 8 most recently seen, so his only 2 explicit "remember
// this" requests (2026-09-08) were dropped behind 8 inferred habits that the
// nightly AI Learning keeps refreshing. The header then told the model those
// inferred items were things he had "explicitly asked to be remembered" — 20
// of all 22 memories were inferred.

export type PromptMemory = { memory_type: string; content: string; source: 'explicit' | 'inferred'; last_seen: string };

export const PROMPT_MEMORY_LIMIT = 8;

const seenAt = (memory: PromptMemory) => Date.parse(memory.last_seen) || 0;

// What the user asked to remember always outranks what the system inferred;
// within each group, most recently seen first.
export function pickPromptMemories<T extends PromptMemory>(memories: T[], limit = PROMPT_MEMORY_LIMIT): T[] {
  const byRecency = (a: T, b: T) => seenAt(b) - seenAt(a);
  const explicit = memories.filter(m => m.source === 'explicit').sort(byRecency);
  const inferred = memories.filter(m => m.source !== 'explicit').sort(byRecency);
  return [...explicit, ...inferred].slice(0, limit);
}

export function promptMemoryBlock(memories: PromptMemory[]): string {
  if (!memories.length) return '';
  const lines = memories.map(m => `- [${m.memory_type}, ${m.source === 'explicit' ? 'asked' : 'inferred'}] ${m.content}`);
  return `\nWhat you know about this user. "asked" = they told you to remember it; "inferred" = the system guessed it from how they use the app, so hold it more loosely. Either way it is context, not fact — live system data wins:\n${lines.join('\n')}\n`;
}
