// scripts/merge-project-status.js — the entry-by-entry three-way merge of PROJECT_STATUS.md that scripts/push-local-commits.sh uses when a
// replayed commit conflicts there. PROJECT_STATUS.md is a stack of entries, newest first, each starting with "Last updated:"; every session
// adds one at the top, so line-based merges conflict on every replay, and `git merge-file --union` kept BOTH versions of an edited paragraph
// (a stale "Open" paragraph next to its replacement and a missing separator reached origin on 2026-10-07).
//
// Run: npx tsx test-merge-project-status.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (!cond && detail ? `\n       ${detail}` : ''));
  if (!cond) fail++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-status-'));
const entry = (title: string, ...paragraphs: string[]) => `Last updated: ${title}\n\n${paragraphs.join('\n\n')}\n\nPrevious entry follows.\n\n`;
const file = (...entries: string[]) => `# Project Status\n\n${entries.join('')}`;
const merge = (base: string, ours: string, theirs: string) => {
  const [b, o, t, out] = ['base', 'ours', 'theirs', 'out'].map(n => path.join(dir, n));
  fs.writeFileSync(b, base); fs.writeFileSync(o, ours); fs.writeFileSync(t, theirs);
  const r = spawnSync('node', [path.join(process.cwd(), 'scripts', 'merge-project-status.js'), b, o, t, out], { encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr, text: r.status === 0 ? fs.readFileSync(out, 'utf8') : '' };
};
const titles = (text: string) => text.split('\n').filter(l => l.startsWith('Last updated:')).map(l => l.slice('Last updated: '.length));
const count = (text: string, needle: string) => text.split(needle).length - 1;

const A = entry('A (older)', 'A body', '**Open.** A open');
const B = entry('B (oldest)', 'B body');

console.log('--- new entries ---');
{
  const T = entry('T (replayed, new)', 'T body');
  const O = entry('O (somebody else, new, pushed meanwhile)', 'O body');
  const r = merge(file(A, B), file(O, A, B), file(T, A, B));
  check('the replayed new entry is added and nobody else\'s is lost, each exactly once', r.code === 0 && titles(r.text).length === 4 && count(r.text, 'T body') === 1 && count(r.text, 'O body') === 1
    && count(r.text, 'A body') === 1 && count(r.text, 'B body') === 1, r.text);
  check('… newest first: the replayed entry sits just above the entry that follows it', JSON.stringify(titles(r.text)) === JSON.stringify(['O (somebody else, new, pushed meanwhile)', 'T (replayed, new)', 'A (older)', 'B (oldest)']), JSON.stringify(titles(r.text)));
  check('… a replayed entry with nothing else on origin goes to the very top', JSON.stringify(titles(merge(file(A, B), file(A, B), file(T, A, B)).text)) === JSON.stringify(['T (replayed, new)', 'A (older)', 'B (oldest)']));
  check('the "Previous entry follows." separators and the blank lines are intact', count(r.text, 'Previous entry follows.\n\nLast updated:') === 3 && r.text.startsWith('# Project Status\n\nLast updated:'));
}

console.log('\n--- an entry the replayed commit edited ---');
{
  const A2 = entry('A (older)', 'A body', '**Open.** A open — DONE, see the newer entry');
  const r = merge(file(A, B), file(A, B), file(A2, B));
  check('the edited entry replaces origin\'s copy: one "Open" paragraph, the new one (no stale paragraph next to its replacement)', r.code === 0 && count(r.text, '**Open.**') === 1 && r.text.includes('DONE, see the newer entry') && !r.text.includes('A open\n'), r.text);
  const O = entry('O (new)', 'O body');
  const r2 = merge(file(A, B), file(O, A, B), file(A2, B));
  check('… also when origin has added entries since', r2.code === 0 && JSON.stringify(titles(r2.text)) === JSON.stringify(['O (new)', 'A (older)', 'B (oldest)']) && r2.text.includes('DONE, see the newer entry'));
  // origin's copy is a corrupted union (two paragraphs, no separator) — the author's replay wins, and says so
  const Acorrupt = `Last updated: A (older)\n\nA body\n\n**Open.** A open\n**Open.** A open (second copy)\nLast updated: B (oldest)\n\nB body\n\nPrevious entry follows.\n\n`;
  const r3 = merge(file(A, B), `# Project Status\n\n${Acorrupt}`, file(A2, B));
  check('… even when origin\'s copy differs from the base (a corrupted earlier merge is repaired, with a note)', r3.code === 0 && count(r3.text, '**Open.**') === 1 && /replaced although origin's copy differs/.test(r3.stderr) && titles(r3.text).length === 2, r3.stderr + r3.text);
}

console.log('\n--- what only origin changed stays ---');
{
  const B2 = entry('B (oldest)', 'B body', 'B edited by another session');
  const T = entry('T (new)', 'T body');
  const r = merge(file(A, B), file(A, B2), file(T, A, B));
  check('an entry only origin edited keeps origin\'s version', r.code === 0 && r.text.includes('B edited by another session') && count(r.text, 'T body') === 1);
  const r2 = merge(file(A, B), file(A, B2), file(A, B));
  check('a replay that changes nothing here changes nothing', r2.code === 0 && r2.text === file(A, B2));
}

console.log('\n--- an entry the replayed commit deleted ---');
{
  const r = merge(file(A, B), file(A, B), file(A));
  check('deleted by the replay and untouched on origin → removed', r.code === 0 && titles(r.text).join() === 'A (older)');
  const B2 = entry('B (oldest)', 'B body', 'B edited by another session');
  const r2 = merge(file(A, B), file(A, B2), file(A));
  check('deleted by the replay but edited on origin → kept', r2.code === 0 && titles(r2.text).join() === 'A (older),B (oldest)');
}

console.log('\n--- bytes ---');
{
  // origin\'s file ends with lines that have a different line ending; untouched entries must come through byte for byte
  const tailLf = 'Last updated: Z (old, LF only)\n\nZ body\n\nPrevious entry follows.\n\n';
  const ours = `# Project Status\n\n${A}${B}${tailLf}`;
  const T = entry('T (new)', 'T body');
  const r = merge(`# Project Status\n\n${A}${B}${tailLf}`, ours, `# Project Status\n\n${T}${A}${B}${tailLf}`);
  check('entries nobody touched are byte-identical', r.code === 0 && r.text.endsWith(A + B + tailLf) && r.text.startsWith(`# Project Status\n\n${T}`));
  check('a file without a trailing newline stays without one', merge(file(A), file(A).trimEnd(), file(A).trimEnd()).text === file(A).trimEnd());
  check('missing input files do not crash it (a first-ever file)', merge('', '', file(A)).code === 0);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
