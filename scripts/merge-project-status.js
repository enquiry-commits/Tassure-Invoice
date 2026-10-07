#!/usr/bin/env node
// Three-way merge of PROJECT_STATUS.md by ENTRY, used by scripts/push-local-commits.sh when replaying a commit onto origin/main.
//
// PROJECT_STATUS.md is a stack of entries, newest first; every entry starts with a line "Last updated: …" and runs up to the next
// one (its "Previous entry follows." separator belongs to it). Every session adds its entry at the top, so a line-based merge
// conflicts on every replay, and `git merge-file --union` keeps BOTH versions of any paragraph that was edited (a stale paragraph next
// to its replacement, a missing separator — seen on 2026-10-07). This merges whole entries instead:
//   - an entry only the replayed commit ("theirs") has is inserted just above the entry that follows it there;
//   - an entry the replayed commit changed replaces the one on origin ("ours") — also when origin's copy differs from the base
//     (the replay is the author's own, newer text; a note says so);
//   - an entry only origin changed (or added) stays as it is;
//   - an entry the replayed commit deleted is removed when origin did not change it.
// Usage: node merge-project-status.js <base> <ours> <theirs> <out>      (exit 0 = merged; 1 = unusable input)
const fs = require('fs');

const [, , basePath, oursPath, theirsPath, outPath] = process.argv;
if (!basePath || !oursPath || !theirsPath || !outPath) { console.error('usage: merge-project-status.js <base> <ours> <theirs> <out>'); process.exit(1); }

const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const oursRaw = read(oursPath);
const eol = oursRaw.includes('\r\n') ? '\r\n' : '\n';
const norm = s => s.replace(/\r\n/g, '\n');

// → { head, entries: [{ key, text }] }
function parse(text) {
  const lines = norm(text).split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^Last updated:/.test(l)) starts.push(i); });
  const head = lines.slice(0, starts.length ? starts[0] : lines.length).join('\n');
  const entries = starts.map((s, i) => {
    const block = lines.slice(s, i + 1 < starts.length ? starts[i + 1] : lines.length).join('\n');
    return { key: lines[s], text: block };
  });
  return { head, entries };
}

const base = parse(read(basePath)), ours = parse(oursRaw), theirs = parse(read(theirsPath));
const byKey = list => new Map(list.map(e => [e.key, e]));
const baseBy = byKey(base.entries), oursBy = byKey(ours.entries), theirsBy = byKey(theirs.entries);
const notes = [];

// 1. start from origin's entries, in its order
const out = ours.entries.map(e => ({ ...e }));
const indexOf = key => out.findIndex(e => e.key === key);

// 2. entries the replayed commit changed or deleted
for (const [key, b] of baseBy) {
  const o = oursBy.get(key), t = theirsBy.get(key);
  if (!o) continue;
  if (!t) { if (o.text === b.text) out.splice(indexOf(key), 1); continue; }              // deleted by the replay
  if (t.text !== b.text && o.text !== t.text) {
    out[indexOf(key)].text = t.text;                                                    // changed by the replay
    if (o.text !== b.text) notes.push(`entry replaced although origin's copy differs from the base: ${key.slice(0, 100)}`);
  }
}

// 3. entries only the replayed commit has: insert above the entry that follows them in the replay (else at the top)
const added = theirs.entries.filter(e => !baseBy.has(e.key) && !oursBy.has(e.key));
for (const e of added) {
  const pos = theirs.entries.findIndex(x => x.key === e.key);
  let at = 0;
  for (let i = pos + 1; i < theirs.entries.length; i++) { const j = indexOf(theirs.entries[i].key); if (j >= 0) { at = j; break; } }
  out.splice(at, 0, { ...e });
}

const head = ours.head || theirs.head || base.head;
const merged = [head, ...out.map(e => e.text)].join('\n');
fs.writeFileSync(outPath, merged.split('\n').join(eol));
for (const n of notes) console.error('   note: ' + n);
console.error(`   merged by entry: ${out.length} entries (${added.length} added by the replay)`);
