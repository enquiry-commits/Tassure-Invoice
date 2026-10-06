// Pins Company 360's "no confident QuickBooks match" warning (docs/INVARIANTS.md
// INV-DATA-074, Vincent 2026-10-06): it appears only when the closest QuickBooks
// customer is a plausible near miss (70-84% similar), and it names that customer.
// Real cases: 1 Midas Ventures (a client with no invoices yet, whose search word
// "ventures" pulled in 5 unrelated companies) must NOT warn; ACG Interior and
// Soon & Guan (the same company spelled differently in QuickBooks) must.
//
// Run: npx tsx test-company-near-miss.ts
import { readFileSync } from 'fs';
import { closestNearMiss } from './lib/company-name';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

console.log('--- rule 1: a shared common word is not a near miss ---');
const midasCandidates = ['Higo Ventures Pte. Ltd.', 'Lakefill Ventures Pte. Ltd.', 'Agentic Ventures Pte. Ltd.', 'Exclave Ventures Pte. Ltd.', 'YHS Ventures (Cambodia) Pte. Ltd.'];
check('1 MIDAS VENTURES vs 5 unrelated "Ventures" companies: no warning', closestNearMiss('1 MIDAS VENTURES PTE. LTD.', midasCandidates) === null);
check('no candidates: no warning', closestNearMiss('1 MIDAS VENTURES PTE. LTD.', []) === null);

console.log('\n--- rule 2: a real near miss warns and is named ---');
// The scores are the matcher's today (both 75). If the matcher is ever taught
// that "&" = "and", ACG becomes a real match (>= 85), this check fails, and
// the case should then move to the "matched" side — that is the right signal.
const acg = closestNearMiss('ACG INTERIOR AND EXHIBITION PTE. LTD.', ['ACG Interior & Exhibition Pte Ltd']);
check('ACG INTERIOR AND EXHIBITION: names "ACG Interior & Exhibition Pte Ltd"', acg?.name === 'ACG Interior & Exhibition Pte Ltd' && acg.score >= 70 && acg.score < 85, JSON.stringify(acg));
const soon = closestNearMiss('SOON & GUAN MANPOWER TRAINING PTE. LTD.', ['A Plus Manpower Services Pte Ltd', 'Soon & Guan Manpower Trading Pte Ltd', 'Y&G Manpower Agency Pte Ltd']);
check('SOON & GUAN: picks the closest of several (Trading, not the other Manpower companies)', soon?.name === 'Soon & Guan Manpower Trading Pte Ltd', JSON.stringify(soon));

console.log('\n--- rule 3: a real match is not a "near miss" ---');
check('an identical name (any case) scores 100, so it is a match, not a near miss', closestNearMiss('Exclave Ventures Pte. Ltd.', ['EXCLAVE VENTURES PTE. LTD.']) === null);
check('the floor and ceiling are honoured', closestNearMiss('ACG INTERIOR AND EXHIBITION PTE. LTD.', ['ACG Interior & Exhibition Pte Ltd'], 80, 85) === null
  && closestNearMiss('ACG INTERIOR AND EXHIBITION PTE. LTD.', ['ACG Interior & Exhibition Pte Ltd'], 50, 75) === null);

console.log('\n--- rule 4: the page uses it (source-level) ---');
const src = readFileSync('lib/company-360.ts', 'utf8');
check('Company 360 warns through closestNearMiss with the 70 floor and the 85 match threshold', /closestNearMiss\(companyName,[^;]*QB_NEAR_MISS_MIN_SCORE, FUZZY_MATCH_THRESHOLD\)/.test(src) && /QB_NEAR_MISS_MIN_SCORE = 70/.test(src) && /FUZZY_MATCH_THRESHOLD = 85/.test(src));
check('the warning names the closest customer and its score', /Closest QuickBooks customer: "\$\{near\.name\}" \(\$\{near\.score\}% similar\)/.test(src));
check('the old catch-all warning is gone', !/none scored high enough to confidently match/.test(src));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
