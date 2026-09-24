// lib/teamwork-duplicate-uen.ts — picks the real TeamWork record when two live
// records share one UEN (INV-TW-023). Fixtures are the 3 real duplicates found
// in TeamWork's bulk company feed on 2026-09-24.
//
// Run: npx tsx test-teamwork-duplicate-uen.ts
import { findDuplicateUenRecords, type TwRecordLite } from './lib/teamwork-duplicate-uen';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fail++;
};
const rec = (company_id: string, client_id: string, status: string, uen: string): TwRecordLite =>
  ({ company_id, client_id, status, company_registration_Num: uen });

// SHENGYA: stub 1462 listed BEFORE the real 1522 — order in the feed must not matter.
const shengya = [rec('1462', '', '', '201838454D'), rec('1522', 'CS168', 'Active', '201838454D')];
// A.I.R.: real 1534 listed first, stub 1468 second.
const air = [rec('1534', 'CA088', 'Active', '202123740K'), rec('1468', '', '', '202123740K')];
// XGC/YANGGU: stub 976 first.
const xgc = [rec('976', '', '', '202006514R'), rec('978', 'CX015', 'Active', '202006514R')];
// Ordinary companies + one with no UEN at all + a lowercase/space-padded UEN of a real one.
const others = [rec('1', 'CA001', 'Active', '200000001A'), rec('2', '', 'Terminated', '200000002B'), rec('3', '', '', '')];

const all = [...shengya, ...others, ...air, ...xgc];
const { canonicalIdByUen, recordsByUen } = findDuplicateUenRecords(all);

check('SHENGYA -> real record 1522 (has code + Active)', canonicalIdByUen.get('201838454D') === '1522');
check('A.I.R. -> real record 1534', canonicalIdByUen.get('202123740K') === '1534');
check('XGC -> real record 978', canonicalIdByUen.get('202006514R') === '978');
check('exactly the 3 duplicate UENs are reported', recordsByUen.size === 3 && canonicalIdByUen.size === 3);
check('normal single-record UEN is never reported', !canonicalIdByUen.has('200000001A'));
check('blank UEN is never grouped', !canonicalIdByUen.has(''));

// Same result regardless of feed order.
const reversed = findDuplicateUenRecords([...all].reverse());
check('result is independent of feed order', ['201838454D', '202123740K', '202006514R'].every(u => reversed.canonicalIdByUen.get(u) === canonicalIdByUen.get(u)));

// UEN case / whitespace differences still group together.
const messy = findDuplicateUenRecords([rec('10', '', '', ' 201838454d '), rec('11', 'CS168', 'Active', '201838454D')]);
check('UEN compared trimmed + case-insensitive', messy.canonicalIdByUen.get('201838454D') === '11');

// No client code on either: fall back to Active, then any status, then higher id.
const noCode = findDuplicateUenRecords([rec('20', '', '', 'X1'), rec('21', '', 'Active', 'X1')]);
check('without codes, Active beats blank', noCode.canonicalIdByUen.get('X1') === '21');
const tie = findDuplicateUenRecords([rec('30', '', 'Active', 'X2'), rec('31', '', 'Active', 'X2')]);
check('full tie -> higher id, deterministically', tie.canonicalIdByUen.get('X2') === '31');

if (fail) { console.error(`\n${fail} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
