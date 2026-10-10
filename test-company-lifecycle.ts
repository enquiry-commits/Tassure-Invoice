// lib/company-lifecycle.ts — the single source of truth for a company's
// lifecycle (docs/INVARIANTS.md INV-TW-024 / INV-AR-017 / INV-AR-018). Every
// scenario below is a real incident from 2026-09-23..28 replayed against the
// rules, plus source guards that fail if any feature goes back to keeping its
// own private copy of "is this company active / terminated".
//
// Run: npx tsx test-company-lifecycle.ts
// Negative control (guard must FAIL on the pre-consolidation code):
//   LIFECYCLE_GUARD_ROOT=<a checkout of 5423360> npx tsx test-company-lifecycle.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  explicitStatus, isActiveStatus, isTeamworkStub, planCompanyStatusPatch, statusFieldsForNewCompany, isTerminatedStatus,
  buildLifecycleIndex, planArAutoExclusions, planArAutoRestores, findActiveCompaniesWithAllArHidden,
  isActiveCompany, isTeamworkActiveCompany, isActiveCssClient, isTrackedByTeamwork, NEW_UNTRACKED_CLIENT,
  onlyActiveCompanies, onlyTeamworkActiveCompanies, findLifecycleInconsistencies,
  ENDED_MASTER_LIST_TYPES, isEndedMasterListType, lifecycleVerdict, statusChartBucket,
  AR_SYSTEM_EXCLUDER, MAX_AUTO_EXCLUSIONS_PER_RUN, MAX_AUTO_RESTORES_PER_RUN,
  type LifecycleCompany, type ExcludedArRow,
} from './lib/company-lifecycle';

const ROOT = process.env.LIFECYCLE_GUARD_ROOT ?? process.cwd();

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const co = (uen: string | null, tw_status: string | null, company_name: string | null = uen): LifecycleCompany => ({ registration_no: uen, company_name, tw_status });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- 1. what counts as REAL TeamWork evidence ---');
check('blank / whitespace / null status is "unknown", not a status', explicitStatus('') === null && explicitStatus('   ') === null && explicitStatus(null) === null && explicitStatus(' Active ') === 'Active');
check('isActiveStatus: "Active" in any case / padding; nothing else', isActiveStatus('Active') && isActiveStatus(' ACTIVE ') && isActiveStatus('active')
  && !isActiveStatus('') && !isActiveStatus(null) && !isActiveStatus('Inactive') && !isActiveStatus('Terminated') && !isActiveStatus('Active - Dormant'));
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
  // A NEW company: both fields explicit, because companies.is_active DEFAULTs
  // to true in the database — a new Terminated company must not land "active".
  check('new company from TeamWork: Active → { Active, true } (what the old literal wrote)', same(statusFieldsForNewCompany('Active'), { tw_status: 'Active', is_active: true }) && same(statusFieldsForNewCompany(' Active '), { tw_status: 'Active', is_active: true }));
  check('new company: a non-Active status sets is_active FALSE explicitly (never the DB default true)', same(statusFieldsForNewCompany('Terminated'), { tw_status: 'Terminated', is_active: false }));
  check('new company: a blank status writes nothing', same(statusFieldsForNewCompany(''), {}) && same(statusFieldsForNewCompany(null), {}));
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
const ex = (id: number, uen: string | null, by: string | null, statusBefore: string | null = 'Pending'): ExcludedArRow => ({ id, uen, lastExclusion: { by, statusBefore } });
{
  const idx = buildLifecycleIndex([co('202006514R', 'Active'), co('T1', 'Terminated')], []);
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
{
  // Pinned policy (2026-09-28): hide and restore are ONE predicate — an AR row
  // is visible unless its company is PROVEN terminated. When the evidence
  // degrades to "unknown", the system's own exclusion is undone: a stray
  // reminder is visible and can be trashed; a vanished one misses a deadline.
  // Do NOT tighten this to "only once proven Active" (lib/company-lifecycle.ts).
  const unknownRow = buildLifecycleIndex([co('EVOP', null)], []);   // blank TeamWork status (EVOP-style)
  const noEvidence = buildLifecycleIndex([], []);                    // Master List row gone, no companies row
  check('pinned: evidence degrades to "unknown" (blank status) → the system\'s exclusion is undone', planArAutoRestores([ex(1, 'EVOP', AR_SYSTEM_EXCLUDER)], unknownRow).toRestore.length === 1);
  check('pinned: no evidence left at all → the system\'s exclusion is undone', planArAutoRestores([ex(2, 'GONE', AR_SYSTEM_EXCLUDER)], noEvidence).toRestore.length === 1);
  check('pinned: … and exclusion needs PROOF — unknown never hides', planArAutoExclusions([{ id: 3, uen: 'EVOP' }, { id: 4, uen: 'GONE' }], unknownRow).candidates.length === 0);
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
  const cased = findActiveCompaniesWithAllArHidden([co('C', 'ACTIVE')], [{ uen: 'C', status: 'Excluded' }]);
  check('"ACTIVE" in another case is still Active for the safety net', cased.length === 1);
}

console.log('\n--- 7. roster membership — the ONE definition of "active company" ---');
// Every lifecycle state the shared writers can produce (planCompanyStatusPatch,
// statusFieldsForNewCompany, NEW_UNTRACKED_CLIENT), with its real 2026-09-28 count.
type Row = { tw_status: string | null; is_active: boolean | null; client_type?: string | null; internal_id?: string | null };
const STATES: Array<[string, Row]> = [
  ['TeamWork Active (904)', { tw_status: 'Active', is_active: true }],
  ['untracked legacy / TAO-only client, no status (9: YHS group, HAN KUN LLP…)', { tw_status: null, is_active: true }],
  ['Terminated (24)', { tw_status: 'Terminated', is_active: false }],
  ['Striking Off (9)', { tw_status: 'Striking Off', is_active: false }],
  ['Liquidation in Progress (3)', { tw_status: 'Liquidation in Progress', is_active: false }],
  ['Struck-Off (1)', { tw_status: 'Struck-Off', is_active: false }],
  ['blank TeamWork record, never known (2: EVOP, WORLD PRECISION MACHINERY)', { tw_status: null, is_active: false, internal_id: '1725' }],
];
{
  check('isActiveCompany: exactly is_active === true', isActiveCompany({ is_active: true }) && !isActiveCompany({ is_active: false }) && !isActiveCompany({ is_active: null }) && !isActiveCompany({}));
  check('isTeamworkActiveCompany needs BOTH is_active and an explicit Active (any case)', isTeamworkActiveCompany({ is_active: true, tw_status: 'Active' }) && isTeamworkActiveCompany({ is_active: true, tw_status: 'ACTIVE' })
    && !isTeamworkActiveCompany({ is_active: true, tw_status: null }) && !isTeamworkActiveCompany({ is_active: false, tw_status: 'Active' }));
  check('isActiveCssClient = active AND TeamWork\'s Client column says "CSS Client"', isActiveCssClient({ is_active: true, client_type: 'CSS Client' })
    && !isActiveCssClient({ is_active: false, client_type: 'CSS Client' }) && !isActiveCssClient({ is_active: true, client_type: 'Shareholder' }) && !isActiveCssClient({ is_active: true, client_type: null }));
  check('isTrackedByTeamwork: EVOP (TeamWork id, blank status) IS a TeamWork company — the TAO delete-guard bug', isTrackedByTeamwork({ internal_id: '1725', tw_status: null }) && isTrackedByTeamwork({ internal_id: 1725, tw_status: null }));
  check('isTrackedByTeamwork: a status alone also counts; nothing / blanks do not', isTrackedByTeamwork({ internal_id: null, tw_status: 'Active' }) && !isTrackedByTeamwork({ internal_id: null, tw_status: null }) && !isTrackedByTeamwork({ internal_id: '  ', tw_status: '  ' }));
  check('NEW_UNTRACKED_CLIENT (TAO "+ Add new company") is on the active roster but not TeamWork-tracked', isActiveCompany(NEW_UNTRACKED_CLIENT) && !isTeamworkActiveCompany({ ...NEW_UNTRACKED_CLIENT, tw_status: null }) && !isTrackedByTeamwork({ ...NEW_UNTRACKED_CLIENT, internal_id: null, tw_status: null }));

  // The query twins hand back the builder with exactly these filters.
  const calls: unknown[][] = [];
  const fake = { eq(c: string, v: unknown) { calls.push(['eq', c, v]); return fake; }, ilike(c: string, p: string) { calls.push(['ilike', c, p]); return fake; } };
  check('onlyActiveCompanies(q) = q.eq(is_active, true)', onlyActiveCompanies(fake) === fake && same(calls, [['eq', 'is_active', true]]));
  calls.length = 0;
  onlyTeamworkActiveCompanies(fake);
  check('onlyTeamworkActiveCompanies(q) = is_active AND tw_status ILIKE "active" (no wildcard = case-insensitive equality)', same(calls, [['eq', 'is_active', true], ['ilike', 'tw_status', 'active']]) && !/[%_*]/.test(String(calls[1][2])));

  // SQL three-valued-logic model of the filters, to prove the twins agree with
  // the JS predicates — and to pin the SQL NULL trap found on 2026-09-28.
  const sqlNotIn = (v: string | null, list: string[]) => (v === null ? null : !list.includes(v)); // NULL NOT IN (…) → NULL (row dropped)
  const sqlIlike = (v: string | null, p: string) => (v === null ? null : v.toLowerCase() === p.toLowerCase());
  const oldArRoster = (r: Row) => r.is_active === true && sqlNotIn(r.tw_status, ['Striking Off', 'Terminated']) === true;
  const dbActive = (r: Row) => r.is_active === true;
  const dbTwActive = (r: Row) => r.is_active === true && sqlIlike(r.tw_status, 'active') === true;
  check('JS twins agree with their SQL filters on every reachable state', STATES.every(([, r]) => isActiveCompany(r) === dbActive(r) && isTeamworkActiveCompany(r) === dbTwActive(r)));
  check('the OLD AR/late-filing filter (is_active AND tw_status NOT IN …) = onlyTeamworkActiveCompanies on every reachable state', STATES.every(([, r]) => oldArRoster(r) === dbTwActive(r)));
  check('SQL NULL trap: moving that roster onto onlyActiveCompanies would have ADDED the untracked no-status clients', oldArRoster(STATES[1][1]) === false && dbActive(STATES[1][1]) === true);

  const inconsistent = findLifecycleInconsistencies([
    { id: 1, tw_status: 'Active', is_active: true }, { id: 2, tw_status: 'Active', is_active: false }, { id: 3, tw_status: 'Terminated', is_active: true },
    { id: 4, tw_status: null, is_active: true }, { id: 5, tw_status: null, is_active: false }, { id: 6, tw_status: ' active ', is_active: true },
  ]);
  check('findLifecycleInconsistencies: only explicit-status rows whose two fields disagree', inconsistent.map(r => r.id).join() === '2,3', JSON.stringify(inconsistent));
  check('… and no state the shared writers produce is inconsistent', findLifecycleInconsistencies(STATES.map(([, r]) => r)).length === 0);
  // Round-trip: whatever TeamWork says, applying the shared patch never leaves a row inconsistent.
  const incoming = ['Active', 'ACTIVE', 'Terminated', 'Striking Off', '', null];
  check('applying planCompanyStatusPatch to any state never produces an inconsistent row', STATES.every(([, r]) => incoming.every(s => findLifecycleInconsistencies([{ ...r, ...planCompanyStatusPatch(r, s).patch }]).length === 0)));
}

console.log('\n--- 8. Master List lifecycle categories ---');
check('the "ended" categories are exactly terminated + strike_off', same([...ENDED_MASTER_LIST_TYPES], ['terminated', 'strike_off']));
check('isEndedMasterListType: exact category keys only', isEndedMasterListType('terminated') && isEndedMasterListType('strike_off')
  && !isEndedMasterListType('active_client') && !isEndedMasterListType('Terminated') && !isEndedMasterListType(null) && !isEndedMasterListType(''));

console.log('\n--- 9. the one verdict shown to people ---');
{
  check('lifecycleVerdict: row wins — Active / Terminated / untracked-active / blank-unknown', lifecycleVerdict({ is_active: true, tw_status: 'Active' }) === 'active'
    && lifecycleVerdict({ is_active: false, tw_status: 'Terminated' }) === 'terminated' && lifecycleVerdict({ is_active: true, tw_status: null }) === 'active'
    && lifecycleVerdict({ is_active: false, tw_status: null }) === 'unknown');
  check('INV-AR-016 for people too: a live Active row beats a stale Master List "terminated" category', lifecycleVerdict({ is_active: true, tw_status: 'Active' }, ['terminated']) === 'active');
  check('no companies row: Master List decides — ended → terminated, anything else → unknown', lifecycleVerdict(null, ['strike_off']) === 'terminated'
    && lifecycleVerdict(null, ['active_client']) === 'unknown' && lifecycleVerdict(null, []) === 'unknown' && lifecycleVerdict(undefined, ['(uncategorised)']) === 'unknown');
  // One definition: the verdict people see is the SAME rule the workflows act on.
  const agree = STATES.every(([, r]) => {
    const v = lifecycleVerdict(r);
    const idx = buildLifecycleIndex([{ registration_no: 'U', company_name: 'X', tw_status: r.tw_status }], []);
    return (v === 'terminated') === isTerminatedStatus(r.tw_status) && (v === 'terminated') === idx.isTerminated('U') && (v === 'active') === isActiveCompany(r);
  });
  check('verdict ⇔ isTerminatedStatus ⇔ the AR index ⇔ the roster, on every reachable state', agree);
  check('dashboard chart: TeamWork\'s own word for the 3 common states, everything else "Untracked" (unchanged)', statusChartBucket('Active') === 'Active'
    && statusChartBucket('Striking Off') === 'Striking Off' && statusChartBucket('Terminated') === 'Terminated'
    && statusChartBucket('Struck-Off') === 'Untracked' && statusChartBucket(null) === 'Untracked' && statusChartBucket('') === 'Untracked');
}

console.log('\n--- source guards: no feature may keep its own copy of these rules ---');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    if (['node_modules', '.next', '.git'].includes(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
};
const sourceFiles = ['app', 'lib', 'components'].flatMap(d => walk(join(ROOT, d))).map(f => relative(ROOT, f).replace(/\\/g, '/')).sort();
{
  const tw = read('app/api/teamwork/sync/route.ts');
  check('teamwork/sync writes status ONLY through planCompanyStatusPatch() / statusFieldsForNewCompany()', /planCompanyStatusPatch\(row, tw\.status\)/.test(tw)
    && /\.\.\.statusFieldsForNewCompany\(tw\.status\)/.test(tw) && !/patch\.tw_status\s*=/.test(tw) && !/patch\.is_active\s*=/.test(tw));
  check('teamwork/sync: a stub can never heal-match by name', /if \(cand && stub\) stubRecordsIgnored\.push/.test(tw) && /else if \(cand\) \{ row = cand; backfilled\+\+; \}/.test(tw));
  check('teamwork/sync: a stub can never re-key a row by UEN', /if \(stub\) \{\s*stubRecordsIgnored\.push\([^)]*via: 'uen'/.test(tw));
  check('teamwork/sync reports contradictory lifecycle fields on the run\'s END state', /findLifecycleInconsistencies\(\s*\(rows \?\? \[\]\)\.map\(r => \(\{ \.\.\.r, \.\.\.\(patchById\.get\(r\.id\)/.test(tw) && /'lifecycle_fields_inconsistent'/.test(tw));
  const lf = read('app/api/late-filing/sync/route.ts');
  check('late-filing/sync decides "terminated" ONLY through buildLifecycleIndex()', /buildLifecycleIndex\(/.test(lf) && /lifecycle\.isTerminated\(uenKey, row\.entity_name\)/.test(lf) && /lifecycle\.terminatedUens\(\)/.test(lf));
  check('… with no private copy of the rule left behind', !/isTerminatedCompany/.test(lf) && !/!info\.is_active/.test(lf) && !/companyByUen/.test(lf) && !/\['Terminated', 'Striking Off'\]\.includes/.test(lf));
  check('late-filing/sync hides rows only through the breaker-guarded plan', /planArAutoExclusions\(/.test(lf) && /for \(const row of exclusionPlan\.toExclude\)/.test(lf));
  check('late-filing/sync runs the auto-restore and the safety net', /planArAutoRestores\(/.test(lf) && /findActiveCompaniesWithAllArHidden\(/.test(lf) && /'active_company_ar_all_hidden'/.test(lf));

  // The rosters that matter most MUST use the shared definition — a filter
  // that simply disappeared would slip past the "no private copy" guard below.
  const roster = /onlyTeamworkActiveCompanies\(supabase\s*\.from\('companies'\)/;
  for (const [file, what] of [
    ['app/api/ar-reminder/generate/route.ts', 'AR Generate'],
    ['app/api/late-filing/sync/route.ts', 'Late Filing sync'],
    ['app/api/billing/renewals/route.ts', 'Billing Drafts'],
    ['app/api/companies/route.ts', 'Companies page'],
  ] as const) check(`${what} reads its roster through onlyTeamworkActiveCompanies() — the same set as AR`, roster.test(read(file)));
  check('late-filing/sync reads Master List\'s "ended" lists through ENDED_MASTER_LIST_TYPES', /\.in\('list_type', \[\.\.\.ENDED_MASTER_LIST_TYPES\]\)/.test(lf));
  const tao = read('app/api/billing/tao/route.ts');
  check('TAO: "tracked by TeamWork" (delete guard + list flag) is isTrackedByTeamwork(), new clients are NEW_UNTRACKED_CLIENT', /if \(isTrackedByTeamwork\(company\)\)/.test(tao)
    && /trackedByTeamWork: !!companyMatch && isTrackedByTeamwork\(companyMatch\)/.test(tao) && /\.\.\.NEW_UNTRACKED_CLIENT/.test(tao));

  // Tripwire: every live code path that hides an AR Reminder row is one of the
  // three reviewed ones. A NEW one must be checked against INV-AR-017 (is it
  // reversible? does the safety net still cover it?) before it joins this list.
  const writers = sourceFiles.filter(f => (f.startsWith('app/') || f.startsWith('lib/')) && /status:\s*'Excluded'/.test(read(f)));
  // 2026-10-10 (INV-AR-021): lib/ar-plan-apply.ts (the nightly state-based plan) and lib/ar-fye-reanchor.ts (a Master List FYE edit moves
  // AR at once) joined the list after review against INV-AR-017: each hides a row only with the system's own FYE-exclusion actor
  // (restorable by lib/ar-fye-restore.ts, read from ar_reminder_audit), behind per-run breakers (15 hides, 60 changes in total), never a
  // row under the company's FYE month, and a replaced row only AFTER its replacement exists; the INV-AR-017 safety net still applies.
  const reviewed = ['app/api/ar-reminder/route.ts', 'app/api/ar-reminder/sync-workflow/route.ts', 'app/api/late-filing/sync/route.ts', 'lib/ar-fye-reanchor.ts', 'lib/ar-plan-apply.ts'];
  check('only the 5 reviewed code paths can hide an AR row (INV-AR-017 tripwire)', same(writers, reviewed), `found: ${writers.join(', ')}`);
}

// ── The "one definition" guard (INV-AR-018) ──────────────────────────────
// Outside lib/company-lifecycle.ts, no file may judge a company's lifecycle
// itself: no query filter or literal on is_active / tw_status, no hand-kept
// list of TeamWork status words, no "is it Active" string test, no spelled-out
// Master List "ended" categories. A pure DISPLAY read of the two fields is
// allowed only at the reviewed sites below (exact count per file) — a new
// read fails here until someone confirms it only displays, never decides.
{
  // code: comments removed + string/template TEXT blanked (template ${…} kept).
  // raw:  comments removed, strings intact.
  const lex = (src: string) => {
    let code = '', raw = '';
    const put = (a: string, b: string) => { code += a; raw += b; };
    const modes: Array<'code' | 'tpl'> = ['code'];
    const depth = [0];
    let i = 0;
    while (i < src.length) {
      const mode = modes[modes.length - 1], c = src[i], n = src[i + 1];
      if (mode === 'tpl') {
        if (c === '\\') { put('  ', c + (n ?? '')); i += 2; continue; }
        if (c === '`') { put(c, c); modes.pop(); i++; continue; }
        if (c === '$' && n === '{') { put('${', '${'); modes.push('code'); depth.push(0); i += 2; continue; }
        put(c === '\n' ? '\n' : ' ', c); i++; continue;
      }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { put(' ', ' '); i++; } continue; }
      if (c === '/' && n === '*') {
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { const ch = src[i] === '\n' ? '\n' : ' '; put(ch, ch); i++; }
        if (i < src.length) { put('  ', '  '); i += 2; }
        continue;
      }
      if (c === "'" || c === '"') {
        put(c, c); i++;
        while (i < src.length && src[i] !== c && src[i] !== '\n') {
          if (src[i] === '\\') { put('  ', src[i] + (src[i + 1] ?? '')); i += 2; continue; }
          put(' ', src[i]); i++;
        }
        if (i < src.length && src[i] === c) { put(c, c); i++; }
        continue;
      }
      if (c === '`') { put(c, c); modes.push('tpl'); i++; continue; }
      if (c === '{') { depth[depth.length - 1]++; put(c, c); i++; continue; }
      if (c === '}') {
        if (modes.length > 1 && depth[depth.length - 1] === 0) { put(c, c); modes.pop(); depth.pop(); i++; continue; }
        depth[depth.length - 1]--; put(c, c); i++; continue;
      }
      put(c, c); i++;
    }
    return { code, raw };
  };

  const MODULE = 'lib/company-lifecycle.ts';
  // Master List STATUS TEXT vocabulary (INV-DATA-067) — itself one shared module.
  const VOCAB = ['lib/master-list-status.ts'];
  // Files whose own `is_active` is NOT the company-status column: a different
  // table with a column of the same name. Exempt ONLY from the query-filter
  // rule below, and only while the file provably reads nothing but that table
  // (asserted after the scan) — the moment it touches a company table the
  // exemption is void. Added 2026-10-06: the Client Since / Referred By work
  // (adfcb1c) read relationship_contacts.is_active and the guard flagged it.
  const OTHER_TABLE_IS_ACTIVE: Record<string, { table: string; why: string }> = {
    'lib/relationship-contacts.ts': { table: 'relationship_contacts', why: 'a retired referrer/RM is is_active=false on its own contacts table' },
  };
  const FORBIDDEN: Array<{ re: RegExp; why: string; except?: string[] }> = [
    { re: /\.(eq|neq|is|not|in|ilike|like|filter|match|contains|gt|gte|lt|lte)\(\s*(['"`])(is_active|tw_status)\2/, why: 'query filter on is_active/tw_status — use onlyActiveCompanies() / onlyTeamworkActiveCompanies()', except: Object.keys(OTHER_TABLE_IS_ACTIVE) },
    { re: /\b(is_active|tw_status)\.(eq|neq|is|in|ilike|like|not|gt|gte|lt|lte)\./, why: 'PostgREST string filter on is_active/tw_status' },
    { re: /\.match\(\s*\{[^}]*\b(is_active|tw_status)\b/, why: '.match({…}) on is_active/tw_status' },
    { re: /\[\s*(['"`])(is_active|tw_status)\1\s*\]/, why: 'bracket access to is_active/tw_status' },
    { re: /\b(const|let|var)\s*\{[^}]*\b(is_active|tw_status)\b[^}]*\}\s*=|\(\s*\{[^}]*\b(is_active|tw_status)\b[^}]*\}\s*(:[^)]*)?\)\s*=>/, why: 'destructured is_active/tw_status' },
    { re: /(?<![.\w])(is_active|tw_status)\s*:\s*(true|false|null|['"`])/, why: 'literal is_active/tw_status value — use planCompanyStatusPatch() / statusFieldsForNewCompany() / NEW_UNTRACKED_CLIENT' },
    { re: /[!=]==?\s*(['"`])(Terminated|Striking Off|Struck-Off|Struck Off|Liquidat[^'"`]*)\1|(['"`])(Terminated|Striking Off|Struck-Off|Struck Off)\3\s*[!=]==?/, why: 'comparison with a TeamWork status word — use isTerminatedStatus() / lifecycleVerdict()', except: VOCAB },
    { re: /\[(?=[^\]\n]*,)[^\]\n]*(['"`])(Terminated|Striking Off|Struck-Off|Struck Off)\1[^\]\n]*\]/, why: 'hand-kept list of TeamWork status words', except: VOCAB },
    { re: /\.toLowerCase\(\)\s*[!=]==?\s*(['"`])active\1|[!=]==?\s*(['"`])Active\2|(['"`])Active\3\s*[!=]==?/, why: '"is it Active" string test — use isActiveStatus() / isActiveCompany()' },
    { re: /\blist_type\b[^\n;]*?[!=]==?\s*(['"`])(terminated|strike_off)\1|(['"`])(terminated|strike_off)\3\s*[!=]==?[^\n;]*\blist_type\b/, why: 'Master List lifecycle-category comparison — use isEndedMasterListType()', except: VOCAB },
    { re: /\.(eq|neq|in)\(\s*(['"`])list_type\2\s*,\s*\[?\s*(['"`])(terminated|strike_off)\3/, why: 'Master List lifecycle-category query filter — use ENDED_MASTER_LIST_TYPES' },
    { re: /(['"`])terminated\1[^\n]*(['"`])strike_off\2|(['"`])strike_off\3[^\n]*(['"`])terminated\4/, why: 'both "ended" Master List categories spelled out — use ENDED_MASTER_LIST_TYPES / isEndedMasterListType()', except: VOCAB },
  ];
  const REVIEWED_READS: Record<string, [number, string]> = {
    'app/api/assistant/route.ts': [2, 'raw status/active echoed to the model beside system_lifecycle'],
    'app/api/automation/health/route.ts': [2, 'exception rows show the company\'s raw TeamWork status/flag'],
    'app/api/billing/tao/route.ts': [2, 'delete-refusal message text'],
    'app/api/companies/route.ts': [1, 'Companies page status column'],
    'app/api/dashboard/route.ts': [1, 'passed straight into statusChartBucket()'],
    'app/api/teamwork/sync/route.ts': [3, 'exception details (kept_status, inconsistency report)'],
    'lib/company-360.ts': [2, 'Company 360 display fields'],
    'lib/reports-data.ts': [1, 'Reports "Roster Status" display column'],
  };

  const violations: string[] = [];
  const readCounts: Record<string, number> = {};
  const readLines: Record<string, string[]> = {};
  for (const rel of sourceFiles) {
    if (rel === MODULE) continue;
    const src = read(rel);
    const { code, raw } = lex(src);
    const codeLines = code.split('\n'), rawLines = raw.split('\n'), srcLines = src.split('\n');
    rawLines.forEach((l, i) => {
      for (const f of FORBIDDEN) if (!f.except?.includes(rel) && f.re.test(l)) violations.push(`${rel}:${i + 1} — ${f.why}\n         ${srcLines[i].trim().slice(0, 140)}`);
    });
    codeLines.forEach((l, i) => {
      const m = l.match(/\.(is_active|tw_status)\b/g);
      if (m) { readCounts[rel] = (readCounts[rel] ?? 0) + m.length; (readLines[rel] ??= []).push(`${rel}:${i + 1}  ${srcLines[i].trim().slice(0, 120)}`); }
    });
  }
  check('no file outside lib/company-lifecycle.ts keeps its own lifecycle rule', violations.length === 0, `${violations.length} found:\n       ${violations.join('\n       ')}`);
  for (const [rel, { table, why }] of Object.entries(OTHER_TABLE_IS_ACTIVE)) {
    const tables = [...read(rel).matchAll(/\.from\(\s*(['"`])([a-z_]+)\1/g)].map(m => m[2]);
    check(`${rel} is exempt from the is_active filter rule only because it reads nothing but ${table} (${why})`,
      tables.length > 0 && tables.every(t => t === table), `reads: ${[...new Set(tables)].join(', ') || '(no .from() found)'}`);
  }
  const drift = [...new Set([...Object.keys(readCounts), ...Object.keys(REVIEWED_READS)])].sort()
    .filter(f => (readCounts[f] ?? 0) !== (REVIEWED_READS[f]?.[0] ?? 0))
    .map(f => `${f}: ${readCounts[f] ?? 0} raw read(s), ${REVIEWED_READS[f]?.[0] ?? 0} reviewed${REVIEWED_READS[f] ? ` (${REVIEWED_READS[f][1]})` : ''}\n         ${(readLines[f] ?? []).join('\n         ')}`);
  check('raw is_active/tw_status reads exist only at the reviewed DISPLAY sites (exact counts)', drift.length === 0,
    `a read was added/removed — if it only DISPLAYS the value, update REVIEWED_READS; if it DECIDES anything, use lib/company-lifecycle.ts:\n       ${drift.join('\n       ')}`);
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
