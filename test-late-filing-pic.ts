// Run: npx tsx test-late-filing-pic.ts — the Secretary PIC of the AR rows the Late Filing sync mirrors (lib/late-filing-pic.ts, INV-AR-021 (8)).
import { readFileSync } from 'node:fs';
import { MAX_PIC_FILLS_PER_RUN, companySecretaryPic, planMirrorPicFills, type PicFillCompany, type PicFillRow } from './lib/late-filing-pic';
import { findStaffEmails } from './lib/staff-directory';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

const co = (id: number, name: string, uen: string | null, pic: string | null, sec_pic: string | null = null): PicFillCompany => ({ id, company_name: name, registration_no: uen, pic, sec_pic });
const row = (id: number, entity: string, o: Partial<PicFillRow> = {}): PicFillRow => ({ id, entity_name: entity, company_id: null, uen: null, pic: null, status: 'Pending', ...o });
const alive = () => false;

console.log('--- the company\'s PIC, exactly as AR Generate gives it to a new row ---');
check('TeamWork\'s person in charge, as names (ids 12 -> Seng Xin Hoo)', companySecretaryPic({ pic: '12' }) === 'Seng Xin Hoo');
check('two people stay two people (9,11)', companySecretaryPic({ pic: '9,11' }) === 'Kah Ye Chin, Shi Ming Ang');
check('the secretary sub-role comes first when there is one', companySecretaryPic({ sec_pic: 'Jenny Lai', pic: '12' }) === 'Jenny Lai');
check('nothing usable -> empty (an unknown numeric id never leaks through)', companySecretaryPic({ pic: '9999' }) === '' && companySecretaryPic({ pic: null }) === '');

console.log('\n--- ORBITEZ and the other blank rows of 2026-10-10 ---');
{
  const companies = [co(492, 'ORBITEZ PTE. LTD.', '202124820R', 'Seng Xin Hoo'), co(1, 'EASYBOOK PAY PTE. LTD.', '201111111A', 'Hoe Chyi Lim, Seng Xin Hoo')];
  const plan = planMirrorPicFills([row(886, 'ORBITEZ PTE. LTD.', { company_id: 492, uen: '202124820R' }), row(899, 'EASYBOOK PAY PTE. LTD.', { company_id: 1 })], companies, alive);
  check('ORBITEZ #886 gets Seng Xin Hoo, EASYBOOK PAY gets both secretaries', plan.fills.map(f => `${f.rowId}:${f.pic}`).join('|') === '886:Seng Xin Hoo|899:Hoe Chyi Lim, Seng Xin Hoo', plan.fills);
  check('every name it fills is a current staff member (so My Tasks can list the row)', plan.fills.every(f => f.pic.split(',').every(n => findStaffEmails(n.trim()).length === 1)), plan.fills);
}

console.log('\n--- what is NEVER filled ---');
{
  const companies = [co(1, 'A PTE. LTD.', 'U1', 'Jenny Lai'), co(2, 'B PTE. LTD.', 'U2', null), co(3, 'DUP PTE. LTD.', 'U3', '9'), co(4, 'DUP PTE. LTD.', 'U3', '10'), co(5, 'C PTE. LTD.', 'U5', 'Kah Ye Chin')];
  const rows = [
    row(10, 'A PTE. LTD.', { company_id: 1, pic: 'Seng Xin Hoo' }),       // a PIC a person typed
    row(11, 'A PTE. LTD.', { company_id: 1, pic: '9,11' }),               // even raw ids count as "has a PIC"
    row(12, 'A PTE. LTD.', { company_id: 1, status: 'Excluded' }),        // hidden
    row(13, 'B PTE. LTD.', { company_id: 2 }),                            // TeamWork gives the company no PIC
    row(14, 'DUP PTE. LTD.', { uen: 'U3' }),                              // two companies share the UEN: not guessed
    row(15, 'NOBODY PTE. LTD.', { uen: 'ZZZ' }),                          // no company at all
    row(16, 'C PTE. LTD.', { company_id: 5, uen: 'U5' }),                 // terminated company
  ];
  const plan = planMirrorPicFills(rows, companies, (uen) => uen === 'U5');
  const why = Object.fromEntries(plan.skipped.map(s => [s.rowId, s.why]));
  check('a typed PIC, raw ids, a hidden row, no company PIC, an ambiguous UEN, no company and a terminated company are all left alone', plan.fills.length === 0 && why[10] === 'has-pic' && why[11] === 'has-pic' && why[12] === 'hidden' && why[13] === 'no-pic' && why[14] === 'ambiguous-company' && why[15] === 'no-company' && why[16] === 'terminated', { fills: plan.fills, why });
  check('an empty-string PIC counts as blank and is filled', planMirrorPicFills([row(20, 'A PTE. LTD.', { company_id: 1, pic: '  ' })], companies, alive).fills[0]?.had === 'empty');
  check('a row without company_id is matched by its UEN when exactly one company has it', planMirrorPicFills([row(21, 'A PTE. LTD.', { uen: ' u1 ' })], companies, alive).fills[0]?.pic === 'Jenny Lai');
  check('...or by its exact name when it has no UEN', planMirrorPicFills([row(22, 'a pte. ltd.')], companies, alive).fills[0]?.pic === 'Jenny Lai');
}

console.log('\n--- the breaker ---');
{
  const companies = Array.from({ length: MAX_PIC_FILLS_PER_RUN + 1 }, (_, i) => co(i + 1, `CO ${i}`, `U${i}`, 'Jenny Lai'));
  const rows = companies.map(c => row(c.id, c.company_name, { company_id: c.id }));
  const plan = planMirrorPicFills(rows, companies, alive);
  check(`more than ${MAX_PIC_FILLS_PER_RUN} fills in one run fills NOTHING and says so`, plan.blocked && plan.fills.length === 0 && plan.wouldFill === MAX_PIC_FILLS_PER_RUN + 1);
  check('exactly the limit is allowed', !planMirrorPicFills(rows.slice(0, MAX_PIC_FILLS_PER_RUN), companies, alive).blocked);
}

console.log('\n--- wired into the sync, and only there ---');
const sync = readFileSync('app/api/late-filing/sync/route.ts', 'utf8');
check('both mirror inserts of the Late Filing sync (the cycle mirror and the EOT insert) carry the company PIC', (sync.match(/pic: companySecretaryPic\(c\) \|\| null/g) ?? []).length === 2, (sync.match(/pic: companySecretaryPic\(c\) \|\| null/g) ?? []).length);
check('the reconciliation pass fills blank PICs through the plan, guarded to a still-blank row and verified to change exactly one', /planMirrorPicFills\(/.test(sync) && /\.is\('pic', null\)/.test(sync) && /\.eq\('pic', ''\)/.test(sync) && /picFilled\+\+/.test(sync) && /'pic_fill_blocked'/.test(sync));
check('the legacy loop (companies TeamWork no longer lists) is not given a guessed PIC', !/legacy[^\n]*companySecretaryPic/.test(sync));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
