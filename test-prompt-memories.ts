// Pins which memories reach the assistant's prompt and how they are labelled
// (docs/INVARIANTS.md INV-AI-011): explicit "remember this" requests always
// come first, every line says asked or inferred, at most 8. The first case
// is the shape of Vincent's real account on 2026-10-05 — 2 explicit memories
// from 2026-09-08 behind 8 newer inferred ones — where the old recency-only
// top 8 dropped both explicit ones.
//
// Run: npx tsx test-prompt-memories.ts
import { readFileSync } from 'fs';
import { PROMPT_MEMORY_LIMIT, pickPromptMemories, promptMemoryBlock, type PromptMemory } from './lib/prompt-memories';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const mem = (source: PromptMemory['source'], lastSeen: string, content: string): PromptMemory => ({
  memory_type: source === 'explicit' ? 'preference' : 'behaviour',
  content,
  source,
  last_seen: lastSeen,
});

console.log('--- rule 1: explicit requests first, then the newest inferred ---');
const account = [
  mem('inferred', '2026-09-28T05:02:00+00:00', 'i1'),
  mem('inferred', '2026-09-28T07:57:00+00:00', 'i2'),
  mem('inferred', '2026-10-04T09:54:00+00:00', 'i3'),
  mem('inferred', '2026-10-04T10:44:00+00:00', 'i4'),
  mem('inferred', '2026-10-04T17:12:00+00:00', 'i5'),
  mem('inferred', '2026-10-04T17:13:00+00:00', 'i6'),
  mem('inferred', '2026-10-04T17:14:00+00:00', 'i7'),
  mem('inferred', '2026-10-04T17:15:00+00:00', 'i8'),
  mem('explicit', '2026-09-08T10:08:00+00:00', 'e1'),
  mem('explicit', '2026-09-08T10:09:00+00:00', 'e2'),
];
const picked = pickPromptMemories(account);
const order = picked.map(m => m.content).join(',');
check(`at most ${PROMPT_MEMORY_LIMIT} kept`, picked.length === PROMPT_MEMORY_LIMIT, `got ${picked.length}`);
check('both explicit requests kept, though older than every inferred one', picked.filter(m => m.source === 'explicit').length === 2, order);
check('explicit first, newest first', order.startsWith('e2,e1,'), order);
check('then inferred, newest first; the 2 oldest inferred drop', order === 'e2,e1,i8,i7,i6,i5,i4,i3', order);
check('under the cap, everything is kept', pickPromptMemories(account.slice(0, 3)).length === 3);
check('an unreadable timestamp does not throw', pickPromptMemories([mem('inferred', 'not a date', 'x'), mem('explicit', '', 'y')]).map(m => m.content).join(',') === 'y,x');

console.log('\n--- rule 2: every line says where it came from ---');
const block = promptMemoryBlock(picked);
const lines = block.split('\n').filter(l => l.startsWith('- '));
check('one line per memory', lines.length === picked.length);
check('every line is labelled asked or inferred', lines.every(l => /^- \[[a-z]+, (asked|inferred)\] /.test(l)), lines.join(' | '));
check('explicit lines say asked, inferred lines say inferred', lines[0].includes(', asked]') && lines[2].includes(', inferred]'));
check('the header no longer calls every memory an explicit request', !/explicitly asked/i.test(block));
check('no memories, no block', promptMemoryBlock([]) === '');

console.log('\n--- rule 3: the assistant prompt uses it ---');
const route = readFileSync('app/api/assistant/route.ts', 'utf8');
check('route picks with pickPromptMemories and formats with promptMemoryBlock', /pickPromptMemories\(await listMemories\(/.test(route) && /promptMemoryBlock\(memories\)/.test(route));
check('the recency-only top 8 and its "explicitly asked" header are gone', !/listMemories\(account\.email, 8\)/.test(route) && !/explicitly asked to be remembered/.test(route));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
