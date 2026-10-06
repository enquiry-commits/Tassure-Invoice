// Pins how company-name matching treats "and" vs "&" (docs/INVARIANTS.md INV-DATA-076,
// Vincent 2026-10-06): a pair that is IDENTICAL once an interior word "and" is ignored scores
// 99 (never 100, so an exact spelling still wins), every other pair keeps the score it had,
// and normalize() — whose output is STORED in soa_owners / soa_remarks.customer_name_norm
// and used as exact Map keys — is unchanged. All names are real except the edge cases marked
// "(made up)". The two "must not move" pairs are the regressions an earlier design ("drop
// 'and' from the words when scoring") caused in the exhaustive old-vs-new diff.
//
// Run: npx tsx test-company-name-and.ts
import { readFileSync } from 'fs';
import { findUniqueBestMatch, matchScore, normalize } from './lib/company-name';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const score = (a: string, b: string) => matchScore(a, b);

console.log('--- rule 1: the same name spelled with "and" and with "&" scores 99 ---');
check('ACG INTERIOR AND EXHIBITION ~ ACG Interior & Exhibition (was 75; Company 360 needs 85)', score('ACG INTERIOR AND EXHIBITION PTE. LTD.', 'ACG Interior & Exhibition Pte Ltd') === 99);
check('GARY AND SEVEN FAMILY MUSIC TOGETHER ~ Gary & Seven Family Music Together (was 83)', score('GARY AND SEVEN FAMILY MUSIC TOGETHER PTE. LTD.', 'Gary & Seven Family Music Together Pte Ltd') === 99);
check('it works in both directions', score('ACG Interior & Exhibition Pte Ltd', 'ACG INTERIOR AND EXHIBITION PTE. LTD.') === 99);
check('single-letter names too ("A and B" ~ "A & B" was 0)', score('A and B Pte Ltd', 'A & B Pte Ltd') === 99);
check('LIM AND TAN ~ LIM TAN (made up; was 67)', score('LIM AND TAN PTE. LTD.', 'LIM TAN PTE. LTD.') === 99);
check('through an (F.K.A. …) alias', score('NEW NAME PTE. LTD. (F.K.A. ACG INTERIOR AND EXHIBITION PTE. LTD.)', 'ACG Interior & Exhibition Pte Ltd') === 99);

console.log('\n--- rule 2: the exact spelling still wins, so a unique best match survives ---');
const exact = 'ACG INTERIOR AND EXHIBITION PTE. LTD.', twin = 'ACG Interior & Exhibition Pte Ltd';
const both = findUniqueBestMatch(exact, [twin, exact], x => x, 70);
check('both spellings in the candidate list: the exact one is picked, not ambiguous (100 vs 99; two 100s would tie and findCustomer would return null)', both.value === exact && !both.ambiguous && both.score === 100, JSON.stringify(both));
const onlyTwin = findUniqueBestMatch(exact, [twin, 'ACG Holdings Pte Ltd'], x => x, 70);
check('only the "&" spelling exists: it is picked, not ambiguous', onlyTwin.value === twin && !onlyTwin.ambiguous, JSON.stringify(onlyTwin));

console.log('\n--- rule 3: every other pair keeps its score ---');
check('SOON & GUAN MANPOWER TRAINING ~ …TRADING stays 75 — a different word, a person must look', score('SOON & GUAN MANPOWER TRAINING PTE. LTD.', 'Soon & Guan Manpower Trading Pte Ltd') === 75);
check('ABC & Sons ~ XYZ & Sons stays 50 (not inflated by a shared "and")', score('ABC & Sons Pte Ltd', 'XYZ & Sons Pte Ltd') === 50);
check('A & B ~ C & D stays 0 (not 100 on the shared word "and")', score('A & B Pte Ltd', 'C & D Pte Ltd') === 0);
check('Alpha and Omega ~ Beta and Gamma stays 33', score('Alpha and Omega Pte Ltd', 'Beta and Gamma Pte Ltd') === 33);
check('TAN AND LEE ~ TAN AND LIM stays 67 (a shared "and" is not a twin)', score('TAN AND LEE PTE. LTD.', 'TAN AND LIM PTE. LTD.') === 67);
check('LIM AND TAN ~ LIM TAN HOLDINGS GROUP INTERNATIONAL stays 40', score('LIM AND TAN PTE. LTD.', 'LIM TAN HOLDINGS GROUP INTERNATIONAL PTE. LTD.') === 40);
check('a company named just "AND" still matches itself, and not an empty name', score('AND PTE. LTD.', 'AND PTE. LTD.') === 100 && score('AND PTE. LTD.', '& PTE. LTD.') === 0);

console.log('\n--- rule 4: only an INTERIOR "and", as a whole word, is ignored ---');
check('a leading "AND" is part of the name: AND TAN ~ TAN stays 85', score('AND TAN PTE. LTD.', 'TAN PTE. LTD.') === 85);
check('a trailing "AND" too: TAN AND ~ TAN stays 85', score('TAN AND PTE. LTD.', 'TAN PTE. LTD.') === 85);
check('"and" inside a word is untouched: GRAND ~ GR stays 50, SANDS ~ SS stays 0', score('GRAND HOLDINGS PTE. LTD.', 'GR HOLDINGS PTE. LTD.') === 50 && score('SANDS PTE. LTD.', 'SS PTE. LTD.') === 0);
check('"and" next to a non-ASCII letter or a slash is not the word "and": ANDÉ CAFÉ ~ É CAFÉ stays 85, AND/OR ~ /OR stays 67', score('ANDÉ CAFÉ PTE. LTD.', 'É CAFÉ PTE. LTD.') === 85 && score('ROCK AND/OR ROLL PTE. LTD.', 'ROCK /OR ROLL PTE. LTD.') === 67);

console.log('\n--- rule 5: the two regressions the rejected "drop and from the words" design caused ---');
check('NORTHWEST DESIGN AND BUILD ~ the renamed REZNOS DESIGN (原名 NORTHWEST DESIGN AND BUILD) stays 85 (the rejected design made it 43: the renamed company lost its old-name history)',
  score('NORTHWEST DESIGN AND BUILD PTE. LTD', 'REZNOS DESIGN PTE. LTD.  (NORTHWEST INTERIOR DESIGNZ PTE. LTD). 原名NORTHWEST DESIGN AND BUILD PTE. LTD') === 85);
check('HONG YANG CONSTRUCTION AND TRADING ~ HONG YANG CONTRACTOR (F.K.A. … CONSTRUCTION GROUP) stays 60, below the 70 match line (the rejected design made it 75: two sibling companies would match)',
  score('HONG YANG CONSTRUCTION AND TRADING PTE. LTD.', 'HONG YANG CONTRACTOR PTE. LTD. (F.K.A. HONG YANG CONSTRUCTION GROUP PTE.LTD)') === 60);

console.log('\n--- rule 6: normalize() is unchanged — its output is stored as soa_owners / soa_remarks keys ---');
const pinned: Array<[string, string]> = [
  ['ACG INTERIOR AND EXHIBITION PTE. LTD.', 'acg interior and exhibition'],
  ['ACG Interior & Exhibition Pte Ltd', 'acg interior exhibition'],
  ['GARY AND SEVEN FAMILY MUSIC TOGETHER PTE. LTD.', 'gary and seven family music together'],
  ['Gary & Seven Family Music Together Pte Ltd', 'gary seven family music together'],
  ['Q&E SMART HOME SYSTEM AND ELECTRICAL ENGINEERING PTE.LTD.', 'q e smart home system and electrical engineering'],
  ['SOON & GUAN MANPOWER TRAINING PTE. LTD.', 'soon guan manpower training'],
  ['HONG YANG CONSTRUCTION AND TRADING PTE. LTD.', 'hong yang construction and trading'],
  ['AND PTE. LTD.', 'and'],
];
for (const [input, expected] of pinned) check(`normalize(${JSON.stringify(input)}) = ${JSON.stringify(expected)}`, normalize(input) === expected, `got ${JSON.stringify(normalize(input))}`);

console.log('\n--- rule 7: the source file itself (source-level) ---');
const src = readFileSync('lib/company-name.ts', 'utf8');
// A Windows Bash heredoc once turned "\\b" into a backspace character in this file's regex and the
// fix silently did nothing (2026-10-06). No control characters may ever sit in it.
const controls = [...src].filter(ch => ch.charCodeAt(0) < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t');
check('lib/company-name.ts has no control characters', controls.length === 0, `found ${controls.length}`);
check('the upgrade lives in matchScore via sameIgnoringAnd, scored with max(best, 99) — no word-level change', /sameIgnoringAnd\(na, nb\)/.test(src) && /Math\.max\(best, TWIN_SCORE\)/.test(src) && /const TWIN_SCORE = 99;/.test(src) && !/matchKey/.test(src));
check('"and" is removed by whole space-separated token, never by a \\b regex', /tokens\.filter\(\(t, i\) => t !== 'and' \|\| i === 0 \|\| i === last\)/.test(src));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
