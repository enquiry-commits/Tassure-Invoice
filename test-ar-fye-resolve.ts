// Run: npx tsx test-ar-fye-resolve.ts — which FYE month AR follows (lib/ar-fye-resolve.ts, INV-AR-021).
import { readdirSync, readFileSync } from 'node:fs';
import { addMonthsClamped } from './lib/ar-coverage';
import { categorizeLateFilingRow } from './lib/late-filing-categorize';
import {
  addYearsIso, allDmyStrict, assessFye, clampFyeDay, findLeftoverCycles, fyeDayToWrite, fyeMonthName, isUsualFyeDay, leftoverExceptionMessage, leftoverFyeDates, leftoverReminder, isMonthEndIso, isPersonActor, manualFyeFromMaster, parseDmyStrict, parseLatestDmyStrict,
  parseTwCycles, pickFyeDay, profileFyePatch, resolveEffectiveFye, sameFyeDay, STATUTORY_AGM_MONTHS, STATUTORY_AR_MONTHS, type TwCycle,
} from './lib/ar-fye-resolve';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

console.log('--- strict dates: a date that does not exist is not a date ---');
check('a real date parses', parseDmyStrict('30/09/2026') === '2026-09-30');
check('HTML around it is ignored', parseDmyStrict('<span class="x">30/09/2026</span>') === '2026-09-30');
check('31/09/2026 is NOT rolled over to 1 Oct (the old parseDmy did)', parseDmyStrict('31/09/2026') === null);
check('31/06 and 29/02/2027 are not rolled over either; 29/02/2028 is real', parseDmyStrict('31/06/2026') === null && parseDmyStrict('29/02/2027') === null && parseDmyStrict('29/02/2028') === '2028-02-29');
check('32/01/2026, 00/01/1900 and month 13 are unreadable, never an exception', parseDmyStrict('32/01/2026') === null && parseDmyStrict('00/01/1900') === null && parseDmyStrict('10/13/2026') === null);
check('empty / null / text', parseDmyStrict('') === null && parseDmyStrict(null) === null && parseDmyStrict('n/a') === null);
check('an extended due date shows both; the latest valid one wins', parseLatestDmyStrict('<strike>30/06/2026</strike> <br> 29/08/2026') === '2026-08-29');
check('an invalid second date is reported, the valid one still used', (() => { const r = allDmyStrict('30/06/2026 <br> 31/09/2026'); return r.valid.join() === '2026-06-30' && r.invalid.join() === '31/09/2026'; })());

console.log('\n--- a Master List FYE cell -> a month ---');
check('SEP / Sep / September / SEPT / dates', fyeMonthName('SEP') === 'September' && fyeMonthName('Sep') === 'September' && fyeMonthName(' september ') === 'September' && fyeMonthName('SEPT') === 'September' && fyeMonthName('30/09/2026') === 'September' && fyeMonthName('2026-09-30') === 'September');
check('a word that merely starts like a month is NOT a month (MAYBE, MARKET, DECIDE)', fyeMonthName('MAYBE') === null && fyeMonthName('MARKET') === null && fyeMonthName('DECIDE') === null);
check('blank / null / junk', fyeMonthName('') === null && fyeMonthName(null) === null && fyeMonthName('13/13/2026') === null && fyeMonthName('-') === null);

console.log('\n--- TeamWork rows -> cycles ---');
const row = (event: string, label: string, fye: string, due = '', held = '', filing = '') => [event, label, fye, '', due, held, filing, ''];
const parsed = parseTwCycles([
  row('AGM', '2025', '30/09/2025', '30/03/2026', '12/03/2026', ''),
  row('AR', '2025', '30/09/2025', '30/04/2026', '', '20/04/2026'),
  row('AGM', '2026', '30/09/2026', '<strike>30/03/2027</strike> <br> 29/05/2027'),
  row('AR', '2026', '30/09/2026', '30/04/2027'),
  row('XYZ', '2026', '30/09/2026'),                                   // not an AGM / AR event
]);
check('AGM and AR rows with the same FYE date are ONE cycle', parsed.cycles.length === 2 && parsed.cycles[0].hasAgm && parsed.cycles[0].hasAr);
check('held / filing dates make the cycle done; neither makes it open', parsed.cycles[0].agmDone && parsed.cycles[0].arDone && !parsed.cycles[1].agmDone && !parsed.cycles[1].arDone);
check('the extended due date is kept (the later one)', parsed.cycles[1].dueIso === '2027-05-29');
check('TeamWork\'s own year label is kept, separately from the date', parsed.cycles[0].yearLabel === 2025);
const odd = parseTwCycles([row('AGM', '2026', '31/09/2026'), row('AGM', '2026', '30/09/2026', '', '31/02/2027')]);
check('an impossible FYE cell is reported and skipped (not rolled to another date)', odd.bad.some(b => b.column === 'fye' && b.raw.includes('31/09/2026')) && odd.cycles.length === 1);
check('an unreadable HELD cell makes the cycle uncertain (never decide on it) and is reported', odd.cycles[0].uncertain && odd.bad.some(b => b.column === 'held'));
check('an empty history is not an error', parseTwCycles([]).cycles.length === 0);

console.log('\n--- the FYE month TeamWork implies, with the keying-slip gate ---');
const cyc = (fyeIso: string, done = false, label: number | null = null): TwCycle => ({ fyeIso, yearLabel: label ?? Number(fyeIso.slice(0, 4)), hasAgm: true, hasAr: true, agmDone: done, arDone: done, dueIso: null, uncertain: false });
const beauty = [cyc('2023-09-30', true), cyc('2024-09-30', true), cyc('2025-09-30'), cyc('2027-10-01')];
const b = assessFye(beauty);
check('BEAUTY ASSET: the cycle typed 01/10/2027 (30/09/2027 meant) does NOT move the FYE to October', b.month === 'September', b);
check('...and it is reported as a keying slip', b.suspects.length === 1 && b.suspects[0].fyeIso === '2027-10-01' && b.suspects[0].kind === 'slip', b.suspects);
check('the exact BEAUTY shape from the 17 Jun snapshot (only two pending cycles) is still caught', assessFye([cyc('2025-09-30'), cyc('2027-10-01')]).month === 'September');
check('a plain later cycle in the same month changes nothing', assessFye([cyc('2025-09-30', true), cyc('2026-09-30')]).month === 'September');
check('a GENUINE change (June -> December, month-end, unfiled) is accepted at once: "DEC is the latest, JUN must go"', assessFye([cyc('2024-06-30', true), cyc('2025-06-30', true), cyc('2025-12-31')]).month === 'December');
check('a change whose new cycle was already held / filed is accepted', assessFye([cyc('2024-06-30', true), cyc('2025-10-01', true)]).month === 'October');
check('a non-month-end date in another month, when every earlier FYE is a month-end, is refused (odd-day)', (() => { const r = assessFye([cyc('2024-06-30', true), cyc('2025-06-30', true), cyc('2026-11-15')]); return r.month === 'June' && r.suspects[0]?.kind === 'odd-day'; })());
check('a company whose FYE is ALWAYS a non-month-end (2 Feb) is not suspected', assessFye([cyc('2024-02-02', true), cyc('2025-02-02', true), cyc('2026-02-02')]).month === 'February');
check('two suspects in a row are both skipped; the latest credible cycle decides', (() => { const r = assessFye([cyc('2024-09-30', true), cyc('2026-10-01'), cyc('2027-10-02')]); return r.month === 'September' && r.suspects.length === 2; })());
check('no cycle at all -> no month (an empty answer is never a change)', assessFye([]).month === null);
check('a single cycle decides', assessFye([cyc('2026-03-31')]).month === 'March');
check('29 Feb anniversaries clamp (2024-02-29 + 1 year = 2025-02-28)', addYearsIso('2024-02-29', 1) === '2025-02-28' && isMonthEndIso('2025-02-28') && !isMonthEndIso('2025-02-27'));
check('ORBITEZ shape (Jun and Dec both month-end, nothing held) keeps the old rule: the latest wins', assessFye([cyc('2025-06-30'), cyc('2025-12-31')]).month === 'December');

console.log('\n--- what counts as a deliberate Master List edit ---');
const audit = (changedBy: string, newValue: string, changedAt = '2026-08-05T07:53:00Z') => ({ changedBy, newValue, changedAt });
check('a person typed the value that is there now -> deliberate', manualFyeFromMaster({ fye: 'SEP', lastAudit: audit('hoechyi@tassure.com', 'SEP') })?.month === 'September');
check('...with who and when', (() => { const m = manualFyeFromMaster({ fye: 'SEP', lastAudit: audit('hoechyi@tassure.com', 'SEP') }); return m?.by === 'hoechyi@tassure.com' && m.basis === 'audit'; })());
check('a value nobody ever edited here (imported with the sheet) is NOT deliberate', manualFyeFromMaster({ fye: 'JUN', manualFields: {}, lastAudit: null }) === null);
check('automation wrote the current value last -> NOT deliberate', manualFyeFromMaster({ fye: 'DEC', lastAudit: audit('system:teamwork-agm-history', 'DEC') }) === null);
check('the old manual flag (from the time FYE was auto-synced) counts when there is no newer audit entry', manualFyeFromMaster({ fye: 'MAR', manualFields: { fye: true }, lastAudit: null })?.basis === 'flag');
check('an edit by "unknown" (no account) is not a person', manualFyeFromMaster({ fye: 'SEP', lastAudit: audit('unknown', 'SEP') }) === null && !isPersonActor('system:late-filing') && !isPersonActor('unknown') && isPersonActor('vincent@tassure.com'));
check('the audit entry is about another value than the cell holds (changed some other way since) -> falls back to the flag, else nothing', manualFyeFromMaster({ fye: 'OCT', lastAudit: audit('vincent@tassure.com', 'SEP') }) === null);
check('a cleared / unreadable cell is never a manual month', manualFyeFromMaster({ fye: '', lastAudit: audit('vincent@tassure.com', '') }) === null && manualFyeFromMaster({ fye: 'MAYBE', manualFields: { fye: true } }) === null);

console.log('\n--- the month AR runs on ---');
const man = manualFyeFromMaster({ fye: 'SEP', lastAudit: audit('hoechyi@tassure.com', 'SEP') });
const r1 = resolveEffectiveFye({ stored: 'October', derived: 'October', manual: man });
check('Vincent\'s rule: staff typed SEP, TeamWork still shows October -> AR runs on September, flagged as different', r1.effective === 'September' && r1.source === 'master-list' && r1.differs && r1.teamworkMonth === 'October', r1);
check('staff typed the same month TeamWork shows -> nothing differs', (() => { const r = resolveEffectiveFye({ stored: 'September', derived: 'September', manual: man }); return r.effective === 'September' && !r.differs; })());
check('no deliberate edit -> TeamWork (gated) month', resolveEffectiveFye({ stored: 'October', derived: 'September', manual: null }).effective === 'September');
check('TeamWork gave nothing -> what companies.fye_month holds', resolveEffectiveFye({ stored: 'March', derived: null, manual: null }).effective === 'March');
check('nothing known -> none (the caller skips the company)', resolveEffectiveFye({ stored: null, derived: null, manual: null }).effective === null);
check('garbage month names are ignored', resolveEffectiveFye({ stored: 'Sept', derived: 'Smarch', manual: null }).effective === null);

console.log('\n--- the real 17 Jun TeamWork snapshot (pending cycles of 784 companies) ---');
const snap = JSON.parse(readFileSync('data/annual_returns.json', 'utf8')) as { records: Array<{ entityName: string; year: number; fye: string; event: string }> };
const by = new Map<string, TwCycle[]>();
for (const r of snap.records) {
  const list = by.get(r.entityName) ?? by.set(r.entityName, []).get(r.entityName)!;
  if (!list.some(c => c.fyeIso === r.fye)) list.push(cyc(r.fye, false, r.year));
}
let changedByGate = 0; const names: string[] = [];
for (const [name, list] of by) {
  const latestMonth = [...list].sort((a, c) => a.fyeIso.localeCompare(c.fyeIso)).at(-1)!.fyeIso.slice(5, 7);
  const g = assessFye(list);
  if (g.month && g.month !== ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(latestMonth) - 1]) { changedByGate++; names.push(name); }
}
check('the gate overrules the old "latest FYE wins" rule for exactly ONE of 784 companies — BEAUTY ASSET', changedByGate === 1 && names[0] === 'BEAUTY ASSET PTE LTD', { changedByGate, names });

console.log('\n--- Late Filing follows the statutory dates (AGM FYE + 6, AR FYE + 7), INV-TW-006 superseded ---');
check('the statutory months are 6 and 7', STATUTORY_AGM_MONTHS === 6 && STATUTORY_AR_MONTHS === 7);
check('BEAUTY ASSET: FYE 30 Sep 2026 -> AGM 30 Mar 2027, AR 30 Apr 2027 — exactly what TeamWork shows', addMonthsClamped('2026-09-30', STATUTORY_AGM_MONTHS) === '2027-03-30' && addMonthsClamped('2026-09-30', STATUTORY_AR_MONTHS) === '2027-04-30');
check('a 31 Aug FYE is clamped to 28 Feb, never rolled to 3 Mar', addMonthsClamped('2026-08-31', STATUTORY_AGM_MONTHS) === '2027-02-28');
const lfRoute = readFileSync('app/api/late-filing/route.ts', 'utf8');
const lfSync = readFileSync('app/api/late-filing/sync/route.ts', 'utf8');
check('the Late Filing list uses the statutory months and no longer adds 9', /STATUTORY_AGM_MONTHS/.test(lfRoute) && !/getMonth\(\)\s*\+\s*9/.test(lfRoute));
check('the Late Filing sync mirrors the cycle by its EXACT FYE date, not by guessing from the latest month', /earliestOverdueFyeIso = parseDmyStrict\(fyeDateRaw\)/.test(lfSync) && /if \(outstandingDue && earliestOverdueFyeIso\)/.test(lfSync) && (lfSync.match(/fyeMonthIdx0 > dueMonthIdx0/g) ?? []).length === 1);
check('...and takes its FYE month from assessFye (no private "latest FYE date wins")', /assessFye\(parseTwCycles\(rows\)\.cycles\)/.test(lfSync) && !/latestFyeIso/.test(lfSync));

console.log('\n--- a TeamWork cycle that cannot be real: ORBITEZ\'s leftover June 2025 AGM (Vincent: "ORBITEZ 就按照最新的跑") ---');
// ORBITEZ PTE. LTD.'s AGM/AR list exactly as TeamWork returned it on 2026-10-10 (column 8 trimmed to the edit link)
const edit = (id: number) => `<a target="_blank" href="https://apps.teamworkcss.com/tassure_asia/company_agm/edit_agm/${id}">Edit</a>`;
const ORBITEZ_RAW: string[][] = [
  ['AGM', '2025', '31/12/2025', null as unknown as string, '30/06/2026', '', '', '25/01/2026<br>', edit(7519)],
  ['AGM', '2025', '30/06/2025', null as unknown as string, '30/12/2025', '', '', '27/07/2025<br>', edit(8033)],
  ['AR', '2025', '31/12/2025', null as unknown as string, '31/07/2026', '', '', '', edit(7520)],
  ['AGM', '2024', '31/12/2024', null as unknown as string, '30/06/2025', '01/09/2025', '01/09/2025', '25/01/2025<br>', edit(6821)],
  ['AGM', '2024', '30/06/2024', '01/09/2025', '31/12/2024', '31/12/2024', '31/12/2024', '28/07/2024<br>', edit(5258)],
  ['AR', '2024', '31/12/2024', '01/09/2025', '31/07/2025', '01/09/2025', '01/09/2025', '', edit(6822)],
  ['AR', '2024', '30/06/2024', null as unknown as string, '31/01/2025', '31/12/2024', '23/01/2025', '', edit(5300)],
  ['AGM', '2023', '30/06/2023', null as unknown as string, '31/12/2023', '31/12/2023', '31/12/2023', '28/07/2023<br>', edit(2603)],
  ['AR', '2023', '30/06/2023', null as unknown as string, '31/01/2024', '31/12/2023', '09/01/2024', '', edit(2604)],
  ['AGM', '2021', '30/06/2022', null as unknown as string, '31/12/2022', '31/12/2022', '31/12/2022', '28/07/2022<br>', edit(2601)],
  ['AR', '2021', '30/06/2022', null as unknown as string, '31/01/2023', '31/12/2022', '16/01/2023', '', edit(2602)],
];
const orb = parseTwCycles(ORBITEZ_RAW).cycles;
const found = findLeftoverCycles(orb);
check('ORBITEZ: exactly ONE leftover — the AGM for FYE 30/06/2025 — with TeamWork\'s event number to delete', found.length === 1 && found[0].fyeIso === '2025-06-30' && found[0].agmEventId === 8033 && found[0].dueIso === '2025-12-30', found);
check('...anchored on the filed December 2024 year and the December 2025 cycle one year later', found[0]?.anchorFye === '2024-12-31' && found[0]?.nextFye === '2025-12-31', found[0]);
check('the company\'s FYE month stays December (the latest cycle decides, the leftover does not)', assessFye(orb).month === 'December');
check('the leftover\'s FYE date is what the callers skip', leftoverFyeDates(ORBITEZ_RAW).has('2025-06-30') && leftoverFyeDates(ORBITEZ_RAW).size === 1);
check('the real cycles are untouched: 31/12/2025 is still open and keeps both events', (() => { const c = orb.find(x => x.fyeIso === '2025-12-31'); return !!c && c.hasAgm && c.hasAr && !c.agmDone && !c.arDone; })());

const cx = (fyeIso: string, o: Partial<TwCycle> & { filed?: boolean } = {}): TwCycle => ({
  fyeIso, yearLabel: Number(fyeIso.slice(0, 4)), hasAgm: true, hasAr: true, agmDone: !!o.filed, arDone: !!o.filed, dueIso: null, uncertain: false, extended: false, agmEventId: null, ...o,
});
const agmOnly = (fyeIso: string, o: Partial<TwCycle> = {}) => cx(fyeIso, { hasAr: false, ...o });
const baseYear = [cx('2023-12-31', { filed: true }), cx('2024-12-31', { filed: true })];
const lo = (list: TwCycle[]) => findLeftoverCycles(list).map(l => l.fyeIso).join();
check('the same shape but the June 2025 cycle HAS an AR event -> a real period, never ignored', lo([...baseYear, cx('2025-06-30'), cx('2025-12-31')]) === '');
check('...it was held or filed -> never ignored', lo([...baseYear, agmOnly('2025-06-30', { agmDone: true }), cx('2025-12-31')]) === '');
check('...an EOT was applied to it -> never ignored', lo([...baseYear, agmOnly('2025-06-30', { extended: true }), cx('2025-12-31')]) === '');
check('...its cell is unreadable (uncertain) -> never ignored', lo([...baseYear, agmOnly('2025-06-30', { uncertain: true }), cx('2025-12-31')]) === '');
check('...the year before it was NOT filed (only the AGM was held) -> TeamWork cannot prove the leftover is fake', lo([cx('2023-12-31', { filed: true }), cx('2024-12-31', { agmDone: true }), agmOnly('2025-06-30'), cx('2025-12-31')]) === '');
check('an 18-month transition with a stray AGM (the earlier filed cycle is in JUNE) is only reported, never ignored', lo([cx('2023-06-30', { filed: true }), cx('2024-06-30', { filed: true }), agmOnly('2025-06-30'), cx('2025-12-31')]) === '');
check('a genuine change of FYE with an unfiled old-month year (both events) is never ignored', lo([cx('2023-06-30', { filed: true }), cx('2024-06-30'), cx('2024-12-31')]) === '');
check('no cycle one year after the anchor yet -> nothing to sit inside, never ignored', lo([...baseYear, agmOnly('2025-06-30')]) === '');
check('the next cycle in the company\'s month is NOT exactly one year after the anchor (a longer period) -> never ignored', lo([...baseYear, agmOnly('2025-06-30'), cx('2026-12-31')]) === '');
check('DIN FUNG / HUO SHAN / SHOU HANG / XPEL shape: an AGM-only next-year cycle in the company\'s OWN month is not a leftover', lo([cx('2024-06-30', { filed: true }), cx('2025-06-30', { filed: true }), agmOnly('2026-06-30')]) === '');
check('a single cycle, or no cycle, is never a leftover', lo([agmOnly('2025-06-30')]) === '' && lo([]) === '');
check('two stray AGMs inside the same filed year are both found', lo([...baseYear, agmOnly('2025-03-31'), agmOnly('2025-06-30'), cx('2025-12-31')]) === '2025-03-31,2025-06-30');
check('the leftover cannot MOVE the FYE month: delete ORBITEZ\'s real 31/12/2025 cycle by mistake and the company is still December', (() => {
  const wrong = parseTwCycles(ORBITEZ_RAW.filter(r => r[2] !== '31/12/2025')).cycles;
  const a = assessFye(wrong);
  return a.month === 'December' && a.suspects.some(s => s.kind === 'agm-only' && s.fyeIso === '2025-06-30');
})());
check('an AGM-only cycle in the SAME month as the company is accepted as before (it moves nothing)', assessFye([cx('2024-06-30', { filed: true }), cx('2025-06-30', { filed: true }), agmOnly('2026-06-30')]).month === 'June');
check('a company\'s first cycle decides even if it has only an AGM event', assessFye([agmOnly('2026-03-31')]).month === 'March');

const reminder = leftoverReminder(found[0]);
check('the reminder staff see names the FYE and the TeamWork event to delete, in English and Chinese', /30\/06\/2025/.test(reminder) && /event 8033/.test(reminder) && /不存在/.test(reminder) && /delete it in TeamWork/.test(reminder), reminder);
check('...and can never be mistaken for an overdue count or a strike-off note (lib/late-filing-categorize.ts reads those)', !/Overdue\s+\d/i.test(reminder) && !/STRIKE OFF/i.test(reminder) && reminder.length < 200, reminder);
check('...Late Filing\'s own category for the row is unchanged by it', categorizeLateFilingRow({ remarks: `AUTO: Overdue 102 days; ${reminder}`, next_agm_due_date: '2026-06-30' } as never) === 'recent');
const long = leftoverExceptionMessage('ORBITEZ PTE. LTD.', found[0]);
check('Vincent\'s exception says, in Chinese first, which row to delete, which to leave alone and that it clears itself', /30\/06\/2025/.test(long) && /31\/12\/2025/.test(long) && /8033/.test(long) && /只删/.test(long) && /自动消失/.test(long) && /Delete only that AGM event/.test(long), long);

console.log('\n--- the one definition is used by every path that derives "what is outstanding" ---');
const srcOf = (f: string) => readFileSync(f, 'utf8');
const lfSync2 = srcOf('app/api/late-filing/sync/route.ts');
const wfSync = srcOf('app/api/ar-reminder/sync-workflow/route.ts');
const genSrc = srcOf('app/api/ar-reminder/generate/route.ts');
check('Late Filing sync drops the leftover events at the single place rows enter, behind a breaker (more than 3 companies -> ignore none)', /findLeftoverCycles\(parseTwCycles\(ev\.rows/.test(lfSync2) && /leftoverAll\.size > MAX_LEFTOVER_COMPANIES_PER_RUN/.test(lfSync2) && /allRows\.filter\(row => !leftoverFyes\.has\(parseDmyStrict/.test(lfSync2) && /'leftover_rule_tripped'/.test(lfSync2));
check('...and writes the reminder into the AUTO reasons (so it reaches the Late Filing page and the AR row\'s LATE FILING line)', /for \(const l of leftover\) reasons\.push\(leftoverReminder\(l\)\)/.test(lfSync2));
check('sync-workflow skips it for Master List\'s Next AGM Due, the FYE-change backfill and the plan, and raises Vincent\'s exception', /!leftoverFyes\.has\(fyeDate\)\) unheldAgmCandidates/.test(wfSync) && /leftoverFyes\.has\(evFyeIso\)/.test(wfSync) && /leftoverDates: leftoverFyes/.test(wfSync) && /'teamwork_leftover_cycle'/.test(wfSync));
check('generate\'s catch-up never picks it as the earliest open cycle', /leftoverFyeDates\(result\.data/.test(genSrc) && /leftoverFyes\.has\(fyeDate\)/.test(genSrc));
const defs = ['app', 'lib'].flatMap(d => { const out: string[] = []; const walk = (p: string) => { for (const e of readdirSync(p, { withFileTypes: true })) { const f = `${p}/${e.name}`; if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && /function findLeftoverCycles/.test(readFileSync(f, 'utf8'))) out.push(f); } }; walk(d); return out; });
check('exactly ONE definition of the rule exists', defs.length === 1 && defs[0].endsWith('lib/ar-fye-resolve.ts'), defs);

console.log('\n--- the year-end DAY has one owner: the cycles (INV-AR-021 (9); Vincent 2026-10-11: "为什么早 1-3 天") ---');
const dayOf = (cycles: TwCycle[]) => pickFyeDay(cycles, assessFye(cycles).chosen);
{
  const bytes = [cx('2024-12-31', { filed: true }), cx('2025-12-31', { filed: true }), cx('2026-12-31')];   // BYTESFORCE: profile 28/02, every cycle 31/12
  check('assessFye returns the cycle that decided the month', assessFye(bytes).chosen?.fyeIso === '2026-12-31' && assessFye([]).chosen === null);
  check('BYTESFORCE: the cycles say 31, the profile\'s 28 is replaced', dayOf(bytes).day === 31 && fyeDayToWrite(28, 'December', dayOf(bytes)) === 31);
  check('FREEFLOW / NXDOOR / LEENDEN / EASYBOOK (stored 30 against 31/12): replaced; a correct 31 is left alone; an empty day already means "month-end"', fyeDayToWrite(30, 'December', dayOf(bytes)) === 31 && fyeDayToWrite(31, 'December', dayOf(bytes)) === null && fyeDayToWrite(null, 'December', dayOf(bytes)) === null);
  const sfs = [cx('2024-03-31', { filed: true }), cx('2025-03-31', { filed: true }), cx('2026-03-31', { filed: true }), cx('2027-03-31')];   // SFS CARE / GOLDHILL: profile 30/06, every cycle 31/03
  check('SFS CARE / GOLDHILL / LIFE: stored 30, cycles 31 March -> 31', fyeDayToWrite(30, 'March', dayOf(sfs)) === 31);
  check('INNOSAVV: stored 21, cycles 31/12 -> 31', fyeDayToWrite(21, 'December', dayOf([cx('2025-12-31', { filed: true }), cx('2026-12-31')])) === 31);
  check('YAN BIN: a stored 31 for June becomes 30 (and is never shown as "June 31")', fyeDayToWrite(31, 'June', dayOf([cx('2025-06-30', { filed: true }), cx('2026-06-30')])) === 30 && clampFyeDay('June', 31) === 30);
  check('BEAUTY: the keying-slip cycle (01/10/2027) never supplies the day — the day is the credible 30th', dayOf(beauty).day === 30 && dayOf(beauty).basis === 'month-end');
  check('ORBITEZ: the leftover June AGM does not decide the day either — the December cycle does', pickFyeDay(orb, assessFye(orb).chosen).day === 31);
  const slipInMonth = [cx('2024-12-31', { filed: true }), cx('2025-12-31', { filed: true }), cx('2026-12-21')];   // assessFye guards the MONTH, not a same-month day
  check('a lone odd day in the same month (21/12 typed for 31/12) is "unclear": nothing is written', dayOf(slipInMonth).basis === 'unclear' && dayOf(slipInMonth).day === null && fyeDayToWrite(31, 'December', dayOf(slipInMonth)) === null && fyeDayToWrite(null, 'December', dayOf(slipInMonth)) === null);
  const fifteenth = [cx('2024-03-15', { filed: true }), cx('2025-03-15', { filed: true }), cx('2026-03-15')];
  check('a company whose year end really is the 15th (its cycles agree) keeps it — and an empty stored day is filled, because empty would mean the 31st', dayOf(fifteenth).day === 15 && dayOf(fifteenth).basis === 'habitual' && fyeDayToWrite(null, 'March', dayOf(fifteenth)) === 15 && fyeDayToWrite(31, 'March', dayOf(fifteenth)) === 15 && fyeDayToWrite(15, 'March', dayOf(fifteenth)) === null);
  check('isUsualFyeDay: a month-end, or a day another cycle of the same month used', isUsualFyeDay(bytes, cx('2026-12-31')) && isUsualFyeDay(fifteenth, cx('2026-03-15')) && !isUsualFyeDay(slipInMonth, cx('2026-12-21')) && !isUsualFyeDay([cx('2025-03-15'), cx('2026-06-15')], cx('2026-06-15')));
  check('28 and 29 February are the same year end (no write between them), 28 and 29 of another month are not', sameFyeDay('February', 28, 29) && sameFyeDay('February', 29, 28) && !sameFyeDay('March', 28, 29) && fyeDayToWrite(28, 'February', pickFyeDay([cx('2028-02-29')], cx('2028-02-29'))) === null);
  check('no credible cycle -> nothing to write', pickFyeDay([], null).day === null && fyeDayToWrite(30, 'December', pickFyeDay([], null)) === null);
  check('clampFyeDay: cuts to what the month can have, passes the rest through', clampFyeDay('February', 30) === 29 && clampFyeDay('December', 31) === 31 && clampFyeDay('April', 31) === 30 && clampFyeDay('December', null) === null && clampFyeDay('December', 0) === null && clampFyeDay('Smarch', 31) === 31 && clampFyeDay(null, 28) === 28);
}
console.log('\n--- teamwork/sync may only BOOTSTRAP the year end from the profile (month and day together) ---');
check('a company that already has a month: the profile changes nothing — neither the month nor the day', JSON.stringify(profileFyePatch({ fye_month: 'December' }, { month: 'February', day: 28 })) === '{}');
check('...not even a missing day is "filled in" (the stale 28 would be pasted back onto a December company)', JSON.stringify(profileFyePatch({ fye_month: 'December' }, { month: 'December', day: 28 })) === '{}');
check('a company with no month yet gets the profile\'s month AND day', JSON.stringify(profileFyePatch({ fye_month: null }, { month: 'February', day: 28 })) === '{"fye_month":"February","fye_day":28}' && JSON.stringify(profileFyePatch({ fye_month: '' }, { month: 'June', day: 30 })) === '{"fye_month":"June","fye_day":30}');
check('...the day only when the profile has one; nothing at all when it has no month', JSON.stringify(profileFyePatch({}, { month: 'June', day: null })) === '{"fye_month":"June"}' && JSON.stringify(profileFyePatch({}, { month: null, day: 30 })) === '{}');
{
  const tw = srcOf('app/api/teamwork/sync/route.ts');
  check('teamwork/sync takes the profile year end ONLY through profileFyePatch (no direct patch.fye_day / patch.fye_month assignment survives)', /Object\.assign\(patch, profileFyePatch\(row,/.test(tw) && !/patch\.fye_day\s*=/.test(tw) && !/patch\.fye_month\s*=/.test(tw));
  check('sync-workflow is the owner: it writes {fye_day} from pickFyeDay(twParsed.cycles, assessFye\'s chosen cycle), guarded by the month and the day it read, behind a breaker', /pickFyeDay\(twParsed\.cycles, fyeAssessment\.chosen\)/.test(wfSync) && /update\(\{ fye_day: cand\.day \}\)\.eq\('id', cand\.companyId\)\.eq\('fye_month', cand\.month\)/.test(wfSync) && /fyeDayCandidates\.length > MAX_FYE_DAY_WRITES_PER_RUN/.test(wfSync));
  const writers = ['app', 'lib'].flatMap(d => { const out: string[] = []; const walk = (p: string) => { for (const e of readdirSync(p, { withFileTypes: true })) { const f = `${p}/${e.name}`; if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && /\.update\(\{[^}]*\bfye_day\b/.test(readFileSync(f, 'utf8'))) out.push(f); } }; walk(d); return out; });
  check('exactly ONE place updates companies.fye_day: sync-workflow', writers.length === 1 && writers[0].endsWith('ar-reminder/sync-workflow/route.ts'), writers);
  check('Company 360 and the post-incorporate form print a year-end day the month can have (never "June 31")', /clampFyeDay\(companyRow\.fye_month, companyRow\.fye_day\)/.test(srcOf('lib/company-360.ts')) && /clampFyeDay\(MONTH_NAMES\[fyeMonthIndex\], fyeDay\)/.test(srcOf('app/api/post-incorporate/enrich/route.ts')));
  check('Late Filing\'s EOT insert takes TeamWork\'s exact FYE date (the month-end is only the fallback for an unreadable cell)', /eotFyeDateIso = parseDmyStrict\(eotFyeDateRaw\) \?\?/.test(lfSync2));
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
