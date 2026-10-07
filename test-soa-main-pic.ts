// SOA Main PIC rule (lib/soa-main-pic.ts, docs/INVARIANTS.md INV-PIC-009).
// Vincent, 2026-10-07: "Main PIC 也应该是默认是 Jenny" → "最新一轮的直接按照系统
// 逻辑走了，以后要手动才手动" → "BD就先继续放 MAIN PIC 是 BD".
//
// Run: npx tsx test-soa-main-pic.ts
import { readFileSync } from 'fs';
import { effectiveOwner, derivedOwner, storedOwnerSource, classOwnerFor, type MainPicRow } from './lib/soa-main-pic';

let fail = 0;
const check = (name: string, cond: boolean, got = '') => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `  (got ${got})`)); if (!cond) fail++; };
const row = (o: Partial<MainPicRow>): MainPicRow => ({ soaPic: null, soaPicSource: null, classOwner: null, suggestedOwner: null, picShown: [], picOptions: [], ...o });

console.log('--- the real 2026-10-07 cases ---');
const finsightsBefore = row({ soaPic: 'Chin Kah Ye', soaPicSource: 'import', classOwner: 'Jenny Lai', suggestedOwner: 'Jenny Lai', picShown: ['Jenny Lai'], picOptions: ['Chin Kah Ye', 'Jenny Lai'] });
check('FINSIGHTS TAB: the Sept import (Kah Ye) no longer beats QuickBooks\' Class (Jenny)', effectiveOwner(finsightsBefore) === 'Jenny Lai', String(effectiveOwner(finsightsBefore)));
check('a pick a person made in the app still wins', effectiveOwner({ ...finsightsBefore, soaPicSource: 'person' }) === 'Chin Kah Ye');
check('"BD" (Bad Debt) stays the Main PIC even when the import wrote it', effectiveOwner(row({ soaPic: 'BD', soaPicSource: 'import', classOwner: 'Lee Jing Fei', picShown: ['Lee Jing Fei'] })) === 'BD');
check('no Class: Main PIC follows the PIC column\'s only person, not who keyed the invoice', effectiveOwner(row({ soaPic: 'Lim Hoe Chyi', soaPicSource: 'import', suggestedOwner: 'Chelsea Ang', picShown: ['Ang Shi Ming'] })) === 'Ang Shi Ming');
check('several people in the PIC column: the suggestion decides', effectiveOwner(row({ suggestedOwner: 'Quinnie Tan', picShown: ['Victoria Yap', 'Quinnie Tan'] })) === 'Quinnie Tan');
check('nothing at all: a lone TeamWork PIC, else empty', effectiveOwner(row({ picOptions: ['Tey Shemin'] })) === 'Tey Shemin' && effectiveOwner(row({ soaPic: 'X', soaPicSource: 'import' })) === null);
check('the page\'s filters use the same order without the TeamWork fallback', derivedOwner(row({ picOptions: ['Tey Shemin'] })) === null && derivedOwner(finsightsBefore) === 'Jenny Lai');

console.log('\n--- helpers ---');
check('the backfill account is an import, anyone else a person', storedOwnerSource('backfill@internal') === 'import' && storedOwnerSource('chelsea@tassure.com') === 'person' && storedOwnerSource(null) === 'person');
check('classOwnerFor: the suggestion if it is a Class person, else the only one', classOwnerFor('A', ['B', 'A']) === 'A' && classOwnerFor('Z', ['B']) === 'B' && classOwnerFor('Z', ['B', 'C']) === null);

console.log('\n--- one copy, used everywhere ---');
const read = (p: string) => readFileSync(p, 'utf8');
check('lib/soa-data.ts re-exports the shared rule (no private copy)', /export \{ effectiveOwner \} from '\.\/soa-main-pic';/.test(read('lib/soa-data.ts')) && !/row\.soaPic \?\? row\.suggestedOwner/.test(read('lib/soa-data.ts')));
const page = read('app/billing/soa/_components.tsx');
check('the SOA page\'s dropdown and filters use the shared rule', /const displayedOwner = mainPicFor\(row\);/.test(page) && /derivedOwner\(c\)/.test(page) && !/c\.soaPic \?\? c\.suggestedOwner/.test(page));
check('the daily audit only checks picks people made', /neq\('updated_by_email', 'backfill@internal'\)/.test(read('app/api/soa-owners/audit/route.ts')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
