// Run: npx tsx test-ar-fye-resolve.ts — which FYE month AR follows (lib/ar-fye-resolve.ts, INV-AR-021).
import { readFileSync } from 'node:fs';
import {
  addYearsIso, allDmyStrict, assessFye, fyeMonthName, isMonthEndIso, isPersonActor, manualFyeFromMaster, parseDmyStrict, parseLatestDmyStrict,
  parseTwCycles, resolveEffectiveFye, type TwCycle,
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

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
