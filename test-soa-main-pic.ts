// "Who is responsible" for an SOA row (lib/soa-main-pic.ts, docs/INVARIANTS.md INV-PIC-011).
// Vincent, 2026-10-07: "过后就没有 Main PIC 了 … PIC 就是 Main PIC … 3 个人都是 MAIN PIC，不管我在上面选择 3 个人的其中
// 一个人这个公司都要出现" — replaces the single-person Main PIC rule of INV-PIC-009. BD (Bad Debt) is kept as a status.
//
// Run: npx tsx test-soa-main-pic.ts
import { readFileSync } from 'fs';
import { responsiblePeople, peopleLabel, isBadDebt, storedOwnerSource, classOwnerFor, type MainPicRow } from './lib/soa-main-pic';

let fail = 0;
const check = (name: string, cond: boolean, got = '') => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `  (got ${got})`)); if (!cond) fail++; };
const row = (o: Partial<MainPicRow>): MainPicRow => ({ soaPic: null, soaPicSource: null, classOwner: null, suggestedOwner: null, picShown: [], picOptions: [], ndFollowsTab: false, tabPeople: [], ...o });

console.log('--- the real 2026-10-07 case: CO-OPERATE ASSOCIATES ---');
const coop = row({ picShown: ['Ang Shi Ming', 'Jay Tay', 'Clarence Saw'], suggestedOwner: 'Chelsea Ang' });
check('every person the PIC column lists is responsible — three people, no "Main PIC"', responsiblePeople(coop).join() === 'Ang Shi Ming,Jay Tay,Clarence Saw', responsiblePeople(coop).join());
check('the label for the screen / Excel is the people, comma separated', peopleLabel(responsiblePeople(coop)) === 'Ang Shi Ming, Jay Tay, Clarence Saw');
check('a person\'s old pick in soa_owners is ignored (the Sept import, or anyone\'s)', responsiblePeople(row({ ...coop, soaPic: 'Chin Kah Ye', soaPicSource: 'import' })).join() === 'Ang Shi Ming,Jay Tay,Clarence Saw' && responsiblePeople(row({ ...coop, soaPic: 'Chin Kah Ye', soaPicSource: 'person' })).join() === 'Ang Shi Ming,Jay Tay,Clarence Saw');
check('the same person twice is listed once', responsiblePeople(row({ picShown: ['Jay Tay', 'Jay Tay'] })).join() === 'Jay Tay');

console.log('\n--- Bad Debt stays ---');
check('"BD" is the only stored value still read — and it is the whole answer', responsiblePeople(row({ soaPic: 'BD', soaPicSource: 'import', picShown: ['Lee Jing Fei'] })).join() === 'BD');
check('isBadDebt: BD whoever stored it, nothing else', isBadDebt({ soaPic: 'BD' }) && !isBadDebt({ soaPic: 'Jay Tay' }) && !isBadDebt({ soaPic: null }));
check('BD reads as Bad Debt', peopleLabel(['BD']) === 'Bad Debt');

console.log('\n--- a manual PIC pick (soa_pic_overrides, INV-PIC-012) ---');
check('the manual pick is the whole answer - it beats QuickBooks people', responsiblePeople(row({ picShown: ['Ang Shi Ming', 'Jay Tay'], picOverride: 'Chin Kah Ye' })).join() === 'Chin Kah Ye');
check('...and beats a TAC Nominee Director row following TAB', responsiblePeople(row({ ndFollowsTab: true, tabPeople: ['Jenny Lai'], picOverride: 'Chelsea Ang' })).join() === 'Chelsea Ang');
check('...and beats the Location suggestion when QuickBooks has no PIC (the OPNG JE case)', responsiblePeople(row({ suggestedOwner: 'Chelsea Ang', picOverride: 'Hoo Seng Xin' })).join() === 'Hoo Seng Xin');
check('Bad Debt still wins over a manual pick', responsiblePeople(row({ soaPic: 'BD', picOverride: 'Chin Kah Ye' })).join() === 'BD');
check('no pick: the system answer as before', responsiblePeople(row({ picShown: ['Jay Tay'], picOverride: null })).join() === 'Jay Tay');
check('old soa_owners picks are STILL ignored (only the new table counts)', responsiblePeople(row({ picShown: ['Jay Tay'], soaPic: 'Chin Kah Ye', soaPicSource: 'person' })).join() === 'Jay Tay');

console.log('\n--- nobody in the PIC column ---');
check('the invoice Location\'s suggestion (who keyed it) so the company is not left unowned', responsiblePeople(row({ suggestedOwner: 'Chelsea Ang' })).join() === 'Chelsea Ang');
check('nothing at all: nobody', responsiblePeople(row({})).length === 0);

console.log('\n--- TAC Nominee Director rows follow TAB\'s people (INV-PIC-010) ---');
const advanceTac = row({ suggestedOwner: 'Chelsea Ang', picOptions: ['Lim Hoe Chyi'], ndFollowsTab: true, tabPeople: ['Jenny Lai', 'Tey Shemin'] });
check('an ND-only TAC row is the responsibility of the same company\'s TAB people, not who keyed it', responsiblePeople(advanceTac).join() === 'Jenny Lai,Tey Shemin', responsiblePeople(advanceTac).join());
check('...and with no TAB answer: nobody — never the person who keyed it', responsiblePeople({ ...advanceTac, tabPeople: [] }).length === 0);
check('a non-ND TAC row is unchanged', responsiblePeople(row({ suggestedOwner: 'Chelsea Ang', picShown: ['Hoo Seng Xin'], tabPeople: ['Jenny Lai'] })).join() === 'Hoo Seng Xin');

console.log('\n--- helpers ---');
check('the backfill account is an import, anyone else a person', storedOwnerSource('backfill@internal') === 'import' && storedOwnerSource('chelsea@tassure.com') === 'person' && storedOwnerSource(null) === 'person');
check('classOwnerFor: the suggestion if it is a Class person, else the only one', classOwnerFor('A', ['B', 'A']) === 'A' && classOwnerFor('Z', ['B']) === 'B' && classOwnerFor('Z', ['B', 'C']) === null);

console.log('\n--- one copy, used everywhere; the Main PIC column is gone ---');
const read = (p: string) => readFileSync(p, 'utf8');
const data = read('lib/soa-data.ts');
check('lib/soa-data.ts re-exports the shared rule (no private copy)', /export \{ responsiblePeople, peopleLabel, isBadDebt \} from '\.\/soa-main-pic';/.test(data) && !/effectiveOwner|derivedOwner/.test(data));
const page = read('app/billing/soa/_components.tsx');
check('the SOA page filters on everyone responsible (any one of them shows the company)', /const peopleOf = \(c: SoaCompanyRow\): string\[\] => responsiblePeople\(c\);/.test(page) && /\(people\.length \? people : c\.picShown\)\.some\(p => selectedSet\.has\(p\)\)/.test(page));
check('the page has no Main PIC column or owner dropdown any more', !/'Main PIC'/.test(page) && !/SoaOwnerSelect/.test(page) && !/derivedOwner|mainPicFor/.test(page));
check('both row builders apply the overrides before the TAC/TAB attach', (data.match(/await applyPicOverrides\(rows, qbKeyByRow, company\);/g) ?? []).length === 2);
check('both SOA row builders mark TAC ND rows, blank their PIC column and attach TAB\'s people', (data.match(/picShown: ndFollowsTab \? \[\] : picShownFor\(picFromInvoices, picFromCompanies\),/g) ?? []).length === 2 && (data.match(/tabPeople: \[\],/g) ?? []).length >= 2);
check('ND = every product line is service_type ND', /&& line\.service_type === 'ND'\);/.test(data) && /if \(!line\.product_service\) continue;/.test(data));
check('My Tasks gives the chase to EVERY responsible person', /responsiblePeople\(row\)\.some\(person => findStaffEmails\(person\)\.includes\(account\.email\)\)/.test(read('lib/my-tasks-data.ts')));
check('the daily audit only checks picks people made', /neq\('updated_by_email', 'backfill@internal'\)/.test(read('app/api/soa-owners/audit/route.ts')));
check('nothing reads the removed functions any more', !/effectiveOwner|derivedOwner|tabMainPic/.test([read('lib/my-tasks-data.ts'), read('lib/outstanding-lookup.ts'), read('lib/soa-export.ts'), read('lib/company-360.ts'), read('app/companies/[id]/_components.tsx'), read('app/api/billing/soa/export-all/route.ts')].join('\n')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
