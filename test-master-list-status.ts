// lib/master-list-status.ts — the Master List `status` rules (docs/INVARIANTS.md
// INV-DATA-067). The real-data shapes below are the ones found on 2026-09-24 in
// the Terminated Services list (269 rows): 180 kept a legacy "YES", a few had
// hand-typed junk ("NO", "terminate", "Mary"), 7 are still "Active" in TeamWork.
//
// The two words are different on purpose: "Terminate" is the placeholder (filed
// here, TeamWork has not confirmed), "Terminated" is TeamWork's own word and
// only ever arrives from TeamWork (Vincent: "Move 到 Terminated 现在放的
// 'Terminate'…和TW确认后才变成 Terminated").
//
// Run: npx tsx test-master-list-status.ts
import { readFileSync } from 'fs';
import {
  TERMINATED_STATUS, TERMINATE_PLACEHOLDER, STRIKING_OFF_STATUS, placeholderStatusForMove, isTerminateOrTerminated,
  planMasterListStatusPatches, type MasterListStatusRow,
} from './lib/master-list-status';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

let nextId = 1;
const row = (over: Partial<MasterListStatusRow> = {}): MasterListStatusRow => ({
  id: nextId++, list_type: 'terminated', roc_no: '200000001A', status: 'YES', manual_fields: null, ...over,
});
const tw = (entries: Array<[string, string]> = []) => new Map(entries);
const plan = (rows: MasterListStatusRow[], mirror: Array<[string, string]> = [], known: string[] = []) =>
  planMasterListStatusPatches(rows, tw(mirror), new Set([...known, ...mirror.map(([u]) => u)]));

console.log('--- the two words ---');
{
  const placeholder: string = TERMINATE_PLACEHOLDER, confirmed: string = TERMINATED_STATUS;   // widened: the point IS that they differ
  check('the placeholder and TeamWork\'s word are different strings', placeholder !== confirmed && placeholder === 'Terminate' && confirmed === 'Terminated');
}

console.log('\n--- rule 1: TeamWork wins (unchanged behaviour) ---');
{
  const r = row({ list_type: 'strike_off', roc_no: '199900001B', status: 'STRUCK OFF' });
  const p = plan([r], [['199900001B', 'Striking Off']]);
  check('a TeamWork status different from the row is mirrored', p.length === 1 && p[0].newValue === 'Striking Off' && p[0].reason === 'teamwork');
  check('… and an identical one is left alone', plan([row({ status: 'Terminated', roc_no: '199900001B' })], [['199900001B', 'Terminated']]).length === 0);
  check('the UEN match ignores case and spaces', plan([row({ roc_no: ' 200000001a ', status: 'YES' })], [['200000001A', 'Terminated']]).length === 1);
  check('a manual lock beats TeamWork', plan([row({ manual_fields: { status: true }, status: 'YES' })], [['200000001A', 'Terminated']]).length === 0);
  check('a row with no UEN gets nothing from TeamWork', plan([row({ list_type: 'active_client', roc_no: null, status: 'YES' })], [['200000001A', 'Active']]).length === 0);
  check('TeamWork confirming turns the "Terminate" placeholder into "Terminated" — that change IS the confirmation', (() => {
    const p = plan([row({ status: 'Terminate' })], [['200000001A', 'Terminated']]);
    return p.length === 1 && p[0].oldValue === 'Terminate' && p[0].newValue === 'Terminated' && p[0].reason === 'teamwork';
  })());
}

console.log('\n--- rule 2: Terminated Services rows TeamWork cannot inform -> "Terminate" ---');
{
  const legacy = ['YES', 'NO', 'terminated by client', 'to be terminate', 'RENAMED', 'Mary', 'Active', 'Struck Off', null, '', '  '];
  for (const status of legacy) {
    const p = plan([row({ status })]);
    check(`status ${JSON.stringify(status)} -> "Terminate"`, p.length === 1 && p[0].newValue === TERMINATE_PLACEHOLDER && p[0].reason === 'terminated_list_default' && p[0].oldValue === status);
  }
  check('"Terminate" (the placeholder) is left alone', plan([row({ status: 'Terminate' })]).length === 0);
  check('"terminate" (any case) is left alone', plan([row({ status: 'terminate' })]).length === 0);
  check('"Terminated" is left alone — never turned back into the placeholder', plan([row({ status: 'Terminated' })]).length === 0);
  check('"TERMINATED" (the old Move placeholder) is left alone — no rewrite just to change case', plan([row({ status: 'TERMINATED' })]).length === 0);
  check('the rule never writes TeamWork\'s final word', plan([row({ status: 'YES' })]).every(p => p.newValue !== TERMINATED_STATUS));
  check('a row with no UEN at all still gets the placeholder', plan([row({ roc_no: null, status: 'YES' })]).length === 1);
  check('a manual lock beats the placeholder too', plan([row({ manual_fields: { status: true }, status: 'YES' })]).length === 0);
  check('TeamWork "Active" for a Terminated Services row is NOT forced (follow TeamWork)', (() => {
    const p = plan([row({ status: 'Terminate' })], [['200000001A', 'Active']]);
    return p.length === 1 && p[0].newValue === 'Active' && p[0].reason === 'teamwork';
  })());
  check('TeamWork knows the company (status present) but the sync skipped its record -> no placeholder', plan([row({ status: 'YES' })], [], ['200000001A']).length === 0);
  check('only the Terminated Services list gets the placeholder', ['strike_off', 'active_client', 'ad_hoc', 'name_change', 'mas', 'inactive_old', null].every(list_type => plan([row({ list_type, status: 'YES' })]).length === 0));
}

console.log('\n--- the real 2026-09-24 shape of the Terminated Services list ---');
{
  const mirror: Array<[string, string]> = [['U-TERM', 'Terminated'], ['U-ACT', 'Active'], ['U-STRK', 'Striking Off']];
  const rows: MasterListStatusRow[] = [
    ...Array.from({ length: 178 }, (_, i) => row({ roc_no: `U-GONE-${i}`, status: 'YES' })),
    row({ roc_no: 'U-BLANK-1', status: 'YES' }), row({ roc_no: 'U-BLANK-2', status: 'YES' }),   // in TeamWork, blank status
    ...Array.from({ length: 63 }, () => row({ roc_no: 'U-TERM', status: 'Terminated' })),
    ...Array.from({ length: 10 }, (_, i) => row({ roc_no: `U-OLD-${i}`, status: 'TERMINATED' })),
    ...Array.from({ length: 7 }, () => row({ roc_no: 'U-ACT', status: 'Active' })),
    ...Array.from({ length: 2 }, () => row({ roc_no: 'U-STRK', status: 'Striking Off' })),
    row({ status: 'RENAMED', roc_no: 'U-R' }), row({ status: 'to be terminate', roc_no: 'U-T1' }), row({ status: 'terminate', roc_no: 'U-T2' }),
    row({ status: null, roc_no: 'U-N' }), row({ status: 'Mary', roc_no: 'U-M' }), row({ status: 'NO', roc_no: 'U-NO' }), row({ status: 'Terminated', roc_no: 'U-OK' }),
  ];
  // The two "in TeamWork, blank status" rows are deliberately NOT in `known`: a
  // TeamWork record without a status tells the sync nothing.
  const p = plan(rows, mirror);
  // 178 + 2 "YES", plus RENAMED / "to be terminate" / blank / "Mary" / "NO" = 185; the existing "terminate" is already the placeholder
  check('269 rows in, exactly 185 rewritten to "Terminate" (180 YES + RENAMED, "to be terminate", blank, Mary, NO)', rows.length === 269 && p.filter(x => x.reason === 'terminated_list_default').length === 185 && p.every(x => x.newValue === 'Terminate'));
  check('the 9 rows TeamWork still reports as Active / Striking Off are untouched', p.filter(x => x.reason === 'teamwork').length === 0);
  check('the 63 confirmed "Terminated" rows and the 10 old "TERMINATED" ones are untouched', p.length === 185);
}

console.log('\n--- rule 3: the Move placeholder ---');
{
  check('Terminated Services -> "Terminate" (NOT TeamWork\'s final "Terminated")', placeholderStatusForMove('terminated') === 'Terminate' && placeholderStatusForMove('terminated') !== TERMINATED_STATUS);
  check('Strike Off -> "Striking Off", never the final "STRUCK OFF" (INV-DATA-064)', placeholderStatusForMove('strike_off') === 'Striking Off' && STRIKING_OFF_STATUS === 'Striking Off');
  check('other targets are left to the caller', ['active_client', 'ad_hoc', 'mas', '', 'constructor', '__proto__', 'toString'].every(t => placeholderStatusForMove(t) === undefined));
  check('isTerminateOrTerminated: both words, any case, nothing fuzzy', isTerminateOrTerminated('TERMINATED') && isTerminateOrTerminated(' terminate ') && isTerminateOrTerminated('Terminated') && !isTerminateOrTerminated('to be terminate') && !isTerminateOrTerminated('terminating') && !isTerminateOrTerminated(null));
}

console.log('\n--- source guards: nothing bypasses the shared rules ---');
{
  const read = (p: string) => readFileSync(p, 'utf8');
  const move = read('app/api/master-list/move/route.ts');
  check('the Move route takes the Strike Off / Terminated placeholder from the shared file', /placeholderStatusForMove\(/.test(move) && /lib\/master-list-status/.test(move));
  check('… and does not trust the client-sent statusValue over it', /placeholderStatusForMove\(targetType\)\s*\?\?\s*statusValue/.test(move));
  const page = read('app/master-list/active-clients/page.tsx');
  check('the Active Client page uses the shared constants, not string literals, for its two Move targets',
    /type:\s*'strike_off'[^}]*statusValue:\s*STRIKING_OFF_STATUS/.test(page) && /type:\s*'terminated'[^}]*statusValue:\s*TERMINATE_PLACEHOLDER/.test(page)
    && !/statusValue:\s*'(TERMINATED|Terminated|Terminate|STRUCK OFF|Striking Off)'/.test(page));
  check('… and the Terminated Services Move target is not TeamWork\'s final word', !/type:\s*'terminated'[^}]*statusValue:\s*TERMINATED_STATUS/.test(page));
  const sync = read('app/api/teamwork/sync/route.ts');
  check('the nightly sync plans status patches through planMasterListStatusPatches', /planMasterListStatusPatches\(/.test(sync));
  check('… and no longer carries its own inline copy of the rule', !/statusByRegNo\.get\(String\(r\.roc_no\)/.test(sync));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
