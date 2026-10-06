// Pins Company 360's "no confident QuickBooks match" warning (docs/INVARIANTS.md
// INV-DATA-074, Vincent 2026-10-06): it appears only when the closest QuickBooks
// customer is a plausible near miss (70-84% similar), and it names that customer.
// Real cases: 1 Midas Ventures (a client with no invoices yet, whose search word
// "ventures" pulled in 5 unrelated companies) must NOT warn; Soon & Guan (Training
// vs Trading — possibly the same company) must, and must name the customer.
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
// SOON & GUAN is the real near miss today (75): "Training" vs "Trading" is a
// different word, so a person must look. ACG INTERIOR AND EXHIBITION used to be
// the other one (75, "and" vs "&"); since the "and"-insensitive equality upgrade
// (INV-DATA-076) it scores 99, is a real match, and no longer warns.
const soon = closestNearMiss('SOON & GUAN MANPOWER TRAINING PTE. LTD.', ['A Plus Manpower Services Pte Ltd', 'Soon & Guan Manpower Trading Pte Ltd', 'Y&G Manpower Agency Pte Ltd']);
check('SOON & GUAN: names "Soon & Guan Manpower Trading Pte Ltd", the closest of several', soon?.name === 'Soon & Guan Manpower Trading Pte Ltd' && soon.score >= 70 && soon.score < 85, JSON.stringify(soon));

console.log('\n--- rule 3: a real match is not a "near miss" ---');
check('an identical name (any case) scores 100, so it is a match, not a near miss', closestNearMiss('Exclave Ventures Pte. Ltd.', ['EXCLAVE VENTURES PTE. LTD.']) === null);
check('ACG INTERIOR AND EXHIBITION ~ "ACG Interior & Exhibition" is now a real match, so no warning', closestNearMiss('ACG INTERIOR AND EXHIBITION PTE. LTD.', ['ACG Interior & Exhibition Pte Ltd']) === null);
const soonName = 'Soon & Guan Manpower Trading Pte Ltd';
check('the floor and ceiling are honoured', closestNearMiss('SOON & GUAN MANPOWER TRAINING PTE. LTD.', [soonName], 80, 85) === null
  && closestNearMiss('SOON & GUAN MANPOWER TRAINING PTE. LTD.', [soonName], 50, 75) === null
  && closestNearMiss('SOON & GUAN MANPOWER TRAINING PTE. LTD.', [soonName], 70, 85)?.name === soonName);

console.log('\n--- rule 4: the page uses it (source-level) ---');
const src = readFileSync('lib/company-360.ts', 'utf8');
check('Company 360 warns through closestNearMiss with the 70 floor and the 85 match threshold', /closestNearMiss\(companyName,[^;]*QB_NEAR_MISS_MIN_SCORE, FUZZY_MATCH_THRESHOLD\)/.test(src) && /QB_NEAR_MISS_MIN_SCORE = 70/.test(src) && /FUZZY_MATCH_THRESHOLD = 85/.test(src));
check('the warning names the closest customer and its score', /Closest QuickBooks customer: "\$\{near\.name\}" \(\$\{near\.score\}% similar\)/.test(src));
check('the old catch-all warning is gone', !/none scored high enough to confidently match/.test(src));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
