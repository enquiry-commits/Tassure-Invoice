// lib/company-lifecycle.ts — the single source of truth for a company's
// lifecycle (docs/INVARIANTS.md INV-TW-024 / INV-AR-017). Every scenario below
// is a real incident from 2026-09-23..28 replayed against the rules, plus
// source guards that fail if any route goes back to its own private copy.
//
// Run: npx tsx test-company-lifecycle.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  explicitStatus, isTeamworkStub, planCompanyStatusPatch, isTerminatedStatus, buildLifecycleIndex,
  planArAutoExclusions, planArAutoRestores, findActiveCompaniesWithAllArHidden,
  AR_SYSTEM_EXCLUDER, MAX_AUTO_EXCLUSIONS_PER_RUN, MAX_AUTO_RESTORES_PER_RUN,
  type LifecycleCompany, type ExcludedArRow,
} from './lib/company-lifecycle';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const co = (uen: string | null, tw_status: string | null, company_name: string | null = uen): LifecycleCompany => ({ registration_no: uen, company_name, tw_status });

console.log('--- 1. what counts as REAL TeamWork evidence ---');
check('blank / whitespace / null status is "unknown", not a status', explicitStatus('') === null && explicitStatus('   ') === null && explicitStatus(null) === null && explicitStatus(' Active ') === 'Active');
check('a stub = no client code AND no status (XGC\'s real twin, TeamWork id 976)', isTeamworkStub({ client_id: '', status: '' }) && isTeamworkStub({ client_id: null, status: '  ' }));
check('a record with a client code is not a stub, even with a blank status', !isTeamworkStub({ client_id: 'CX015', status: '' }));
check('a record with a status is not a stub, even without a code', !isTeamworkStub({ client_id: '', status: 'Terminated' }));

console.log('\n--- 2. the ONE rule for writing companies.tw_status / is_active ---');
{
  const active = { tw_status: 'Active', is_active: true };
  const p1 = planCompanyStatusPatch(active, '');
  check('XGC 2026-09-23: blank status can NOT demote a known Active company', JSON.stringify(p1.patch) === '{}' && p1.blankIgnored, JSON.stringify(p1));
  const p2 = planCompanyStatusPatch(active, null);
  check('… nor can a missing status', JSON.stringify(p2.patch) === '{}' && p2.blankIgnored);
  const p3 = planCompanyStatusPatch({ tw_status: null, is_active: false }, '  ');
  check('blank on a never-known company changes nothing and is reported as "complete TeamWork", not "held"', JSON.stringify(p3.patch) === '{}' && !p3.blankIgnored);
  const p4 = planCompanyStatusPatch(active, 'Terminated');
  check('an explicit Terminated still goes straight through', p4.patch.tw_status === 'Terminated' && p4.patch.is_active === false && !p4.blankIgnored);
  const p5 = planCompanyStatusPatch({ tw_status: 'Terminated', is_active: false }, 'Active');
  check('a revival (explicit Active) goes straight through', p5.patch.tw_status === 'Active' && p5.patch.is_active === true);
  const p6 = planCompanyStatusPatch(active, 'Active');
  check('same status → no write at all', JSON.stringify(p6.patch) === '{}');
  const p7 = planCompanyStatusPatch({ tw_status: 'Active', is_active: false }, 'active');
  check('"Active" is case-insensitive for is_active', p7.patch.is_active === true);
}

console.log('\n--- 3. the ONE rule for "is this company terminated" ---');
check('blank / null / unknown is NEVER terminated', !isTerminatedStatus(null) && !isTerminatedStatus('') && !isTerminatedStatus('  ') && !isTerminatedStatus(undefined));
check('Active (any case) is not terminated', !isTerminatedStatus('Active') && !isTerminatedStatus('ACTIVE'));
check('every explicit non-Active TeamWork status is terminated', ['Terminated', 'Striking Off', 'Struck-Off', 'Liquidation in Progress', 'Liquidated', 'Dissolved'].every(isTerminatedStatus));
{
  const idx = buildLifecycleIndex([co('202415722M', 'Active', 'ARK PARTNERS MANAGEMENT PTE. LTD.')], ['202415722M']);
  check('INV-AR-016: a live Active company wins over a stale Master List "terminated" row (ARK PARTNERS)', !idx.isTerminated('202415722M'));
  check('… and it is not in terminatedUens()', !idx.terminatedUens().includes('202415722M'));
}
{
  const idx = buildLifecycleIndex([co('202006514R', null, 'XGC SINGAPORE PTE. LTD.')], []);
  check('a company whose status went blank is NOT terminated (old rule: !is_active → terminated)', !idx.isTerminated('202006514R'));
}
{
  const a = buildLifecycleIndex([co('U1', 'Active'), co('U1', 'Terminated')], []);
  const b = buildLifecycleIndex([co('U1', 'Terminated'), co('U1', 'Active')], []);
  check('duplicate rows for one UEN: terminated only if ALL are — in either order (INV-TW-023)', !a.isTerminated('U1') && !b.isTerminated('U1'));
  const c = buildLifecycleIndex([co('U2', 'Terminated'), co('U2', 'Striking Off')], []);
  check('… and genuinely terminated when every row says so', c.isTerminated('U2'));
}
{
  const idx = buildLifecycleIndex([], ['201611291N', ' 202409909z ']);
  check('no companies row + Master List strike_off → terminated (ADVANCE BRIGHT GLOBAL)', idx.isTerminated('201611291N'));
  check('Master List UENs are normalised (case/space)', idx.isTerminated('202409909Z'));
  check('no companies row and not in Master List → not terminated', !idx.isTerminated('999999999X'));
  check('no UEN at all → not terminated', !idx.isTerminated(null) && !idx.isTerminated(''));
}
{
  const idx = buildLifecycleIndex([co(null, 'Terminated', 'TAFOS CAPITAL PTE. LTD.')], []);
  check('name fallback is used only when asked (marker pass), never for a UEN-only lookup', idx.isTerminated(null, 'TAFOS CAPITAL PTE. LTD.') && !idx.isTerminated(null));
}

console.log('\n--- 4 & 5. AR auto-exclusion / auto-restore and the circuit breakers ---');
{
  const idx = buildLifecycleIndex([co('T1', 'Terminated'), co('A1', 'Active')], []);
  const plan = planArAutoExclusions([{ id: 1, uen: 'T1' }, { id: 2, uen: 'A1' }, { id: 3, uen: null }], idx);
  check('only terminated companies\' rows are hidden; Active ones and UEN-less rows never', plan.toExclude.map(r => r.id).join() === '1' && !plan.blocked);
  const many = Array.from({ length: MAX_AUTO_EXCLUSIONS_PER_RUN + 1 }, (_, i) => ({ id: i, uen: 'T1' }));
  const big = planArAutoExclusions(many, idx);
  check(`circuit breaker: ${MAX_AUTO_EXCLUSIONS_PER_RUN + 1} rows in one run → hide NOTHING, report all`, big.blocked && big.toExclude.length === 0 && big.candidates.length === MAX_AUTO_EXCLUSIONS_PER_RUN + 1);
  const edge = planArAutoExclusions(many.slice(0, MAX_AUTO_EXCLUSIONS_PER_RUN), idx);
  check(`exactly ${MAX_AUTO_EXCLUSIONS_PER_RUN} is still allowed`, !edge.blocked && edge.toExclude.length === MAX_AUTO_EXCLUSIONS_PER_RUN);
}
{
  const idx = buildLifecycleIndex([co('202006514R', 'Active'), co('T1', 'Terminated')], []);
  const ex = (id: number, uen: string | null, by: string | null, statusBefore: string | null = 'Pending'): ExcludedArRow => ({ id, uen, lastExclusion: by === undefined ? null : { by, statusBefore } });
  const plan = planArAutoRestores([
    ex(823, '202006514R', AR_SYSTEM_EXCLUDER),               // XGC — the system hid it, company is Active → restore
    ex(900, '202006514R', 'hoechyi@tassure.com'),            // a PERSON trashed it → never
    ex(901, '202006514R', 'system:teamwork'),                // FYE-correction exclusion → never
    ex(902, 'T1', AR_SYSTEM_EXCLUDER),                       // still terminated → stays hidden
    { id: 903, uen: '202006514R', lastExclusion: null },      // no audit trail → never guess
    ex(904, null, AR_SYSTEM_EXCLUDER),                       // no UEN → never
    ex(905, '202006514R', AR_SYSTEM_EXCLUDER, null),         // was status NULL before → restored to exactly NULL
  ], idx);
  check('XGC replay: a row the SYSTEM hid comes back once its company is Active again', plan.toRestore.some(r => r.id === 823 && r.restoreTo === 'Pending'));
  check('a person\'s trash-can exclusion is never touched', !plan.toRestore.some(r => r.id === 900));
  check('another process\'s exclusion (FYE correction) is never touched', !plan.toRestore.some(r => r.id === 901));
  check('a row whose company is still terminated stays hidden', !plan.toRestore.some(r => r.id === 902));
  check('no audit trail / no UEN → never guessed', !plan.toRestore.some(r => r.id === 903 || r.id === 904));
  check('restores the EXACT pre-exclusion status, even NULL', plan.toRestore.some(r => r.id === 905 && r.restoreTo === null));
  check('nothing else restored', plan.toRestore.length === 2 && !plan.blocked);
  const many = Array.from({ length: MAX_AUTO_RESTORES_PER_RUN + 1 }, (_, i) => ex(i, '202006514R', AR_SYSTEM_EXCLUDER));
  const big = planArAutoRestores(many, idx);
  check(`restore circuit breaker: ${MAX_AUTO_RESTORES_PER_RUN + 1} in one run → restore NOTHING, report all`, big.blocked && big.toRestore.length === 0);
}

console.log('\n--- 6. the safety net judges the OUTCOME ---');
{
  const companies = [co('XGC', 'Active', 'XGC SINGAPORE PTE. LTD.'), co('OK1', 'Active'), co('DEAD', 'Terminated'), co('NEW', 'Active'), co('NULL', null)];
  const ar = [
    { uen: 'XGC', status: 'Excluded' },                                   // the 2026-09-23 state of XGC → must alert
    { uen: 'OK1', status: 'Excluded' }, { uen: 'OK1', status: 'Pending' }, // one still visible → fine
    { uen: 'DEAD', status: 'Excluded' },                                  // terminated company, hidden → fine
    { uen: 'NULL', status: 'Excluded' },                                  // unknown status → not "Active", not flagged
  ];
  const hits = findActiveCompaniesWithAllArHidden(companies, ar);
  check('XGC\'s 2026-09-23 state (Active, only AR row hidden) raises the alarm', hits.length === 1 && hits[0].uen === 'XGC' && hits[0].hiddenRows === 1, JSON.stringify(hits));
  check('an Active company with no AR rows at all is not flagged here (catch-up\'s job)', !hits.some(h => h.uen === 'NEW'));
  const dup = findActiveCompaniesWithAllArHidden([co('D', 'Terminated'), co('D', 'Active')], [{ uen: 'D', status: 'Excluded' }]);
  check('a UEN counts as Active if ANY of its rows is — order-independent', dup.length === 1);
}

console.log('\n--- source guards: no route may keep its own copy of these rules ---');
{
  const read = (p: string) => readFileSync(p, 'utf8');
  const tw = read('app/api/teamwork/sync/route.ts');
  check('teamwork/sync writes status ONLY through planCompanyStatusPatch()', /planCompanyStatusPatch\(row, tw\.status\)/.test(tw)
    && !/patch\.tw_status\s*=/.test(tw) && !/patch\.is_active\s*=/.test(tw));
  check('teamwork/sync: a stub can never heal-match by name', /if \(cand && stub\) stubRecordsIgnored\.push/.test(tw) && /else if \(cand\) \{ row = cand; backfilled\+\+; \}/.test(tw));
  check('teamwork/sync: a stub can never re-key a row by UEN', /if \(stub\) \{\s*stubRecordsIgnored\.push\([^)]*via: 'uen'/.test(tw));
  const lf = read('app/api/late-filing/sync/route.ts');
  check('late-filing/sync decides "terminated" ONLY through buildLifecycleIndex()', /buildLifecycleIndex\(/.test(lf) && /lifecycle\.isTerminated\(uenKey, row\.entity_name\)/.test(lf) && /lifecycle\.terminatedUens\(\)/.test(lf));
  check('… with no private copy of the rule left behind', !/isTerminatedCompany/.test(lf) && !/!info\.is_active/.test(lf) && !/companyByUen/.test(lf) && !/\['Terminated', 'Striking Off'\]\.includes/.test(lf));
  check('late-filing/sync hides rows only through the breaker-guarded plan', /planArAutoExclusions\(/.test(lf) && /for \(const row of exclusionPlan\.toExclude\)/.test(lf));
  check('late-filing/sync runs the auto-restore and the safety net', /planArAutoRestores\(/.test(lf) && /findActiveCompaniesWithAllArHidden\(/.test(lf) && /'active_company_ar_all_hidden'/.test(lf));

  // Tripwire: every live code path that hides an AR Reminder row is one of the
  // three reviewed ones. A NEW one must be checked against INV-AR-017 (is it
  // reversible? does the safety net still cover it?) before it joins this list.
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.next', '.git'].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  const writers = ['app', 'lib'].flatMap(d => walk(d))
    .filter(f => /status:\s*'Excluded'/.test(read(f)))
    .map(f => relative(process.cwd(), f).replace(/\\/g, '/')).sort();
  const reviewed = ['app/api/ar-reminder/route.ts', 'app/api/ar-reminder/sync-workflow/route.ts', 'app/api/late-filing/sync/route.ts'];
  check('only the 3 reviewed code paths can hide an AR row (INV-AR-017 tripwire)', JSON.stringify(writers) === JSON.stringify(reviewed), `found: ${writers.join(', ')}`);
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
