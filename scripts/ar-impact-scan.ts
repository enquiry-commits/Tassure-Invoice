// READ-ONLY. One pass over every active company's LIVE TeamWork AGM/AR history plus the live AR / Master List / Late Filing rows, to
// name the companies that the 2026-10-10 AR changes (INV-AR-021) touch or that need a person's attention. Writes nothing anywhere.
//
//   NODE_PATH=<dir containing node_modules/server-only> npx tsx scripts/ar-impact-scan.ts
//
// One TeamWork login and one history fetch per company (the same ~900 reads the nightly sync makes), concurrency 8, about four minutes.
// Sections: (1) dates that do not exist (31/09 …) in any TeamWork cell, and what the lenient parser does with them; (2) Master List FYE
// cells staff typed by hand; (3) the nightly AR plan's reports (stale cycles, date drift …) and what it would restore / hide;
// (4) Late Filing: companies whose mirrored AR row would now be a different cycle; (5) recent runs / open exceptions that could be
// related.
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../lib/supabase';
import { fetchAgmList, getSessionCookie, parseDmy, parseLatestDmy } from '../lib/teamwork-agm';
import { MONTHS, assessFye, findLeftoverCycles, parseDmyStrict, parseTwCycles } from '../lib/ar-fye-resolve';
import { effectiveFyeForCompany, loadManualFyeByUen } from '../lib/ar-fye-manual';
import { planCompanyAr, type PlanRow } from '../lib/ar-cycle-plan';
import { executeArPlans, type PlanItem } from '../lib/ar-plan-apply';
import { onlyTeamworkActiveCompanies } from '../lib/company-lifecycle';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }

const COLS = ['event', 'year', 'FYE date', '(col 3)', 'due date', 'AGM held', 'AR filed', 'reminder dates', '(col 8)'];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (d: Date | null) => { try { return d ? d.toISOString().slice(0, 10) : null; } catch { return 'INVALID'; } };
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

(async () => {
  const sb = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(`${today}T00:00:00Z`);

  const { data: companiesRaw, error } = await onlyTeamworkActiveCompanies(sb.from('companies').select('id, company_name, internal_id, registration_no, fye_month, fye_day, is_active, tw_status'));
  if (error) throw new Error(error.message);
  const roster = (companiesRaw ?? []).filter(c => c.internal_id);
  const { data: allRows, error: rowsErr } = await sb.from('ar_reminder').select('id, company_id, entity_name, fye_month, fye_year, fye_date, status, filling_date, agm_held_date, remarks');
  if (rowsErr) throw new Error(rowsErr.message);
  const byCompany = new Map<number, PlanRow[]>();
  const byName = new Map<string, PlanRow[]>();
  const rowById = new Map<number, (typeof allRows)[number]>();
  for (const r of allRows ?? []) {
    rowById.set(r.id, r);
    if (r.company_id != null) (byCompany.get(r.company_id) ?? byCompany.set(r.company_id, []).get(r.company_id)!).push(r as PlanRow);
    const k = String(r.entity_name).trim().toUpperCase();
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(r as PlanRow);
  }
  const manualByUen = await loadManualFyeByUen(sb);
  const { data: lfRows } = await sb.from('late_filing_companies').select('id, company_name, uen, remarks, mirrored_ar_reminder_id, next_agm_due_date');
  const lfByUen = new Map((lfRows ?? []).filter(r => r.uen).map(r => [String(r.uen).trim().toUpperCase(), r]));
  const lfByName = new Map((lfRows ?? []).map(r => [String(r.company_name).trim().toUpperCase(), r]));

  console.log(`roster ${roster.length} | ar_reminder rows ${allRows?.length} | late_filing_companies ${lfRows?.length} | today ${today}`);
  const cookie = await getSessionCookie();

  const badCells: string[] = [];
  const planItems: PlanItem[] = [];
  const planReports: string[] = [];
  const lfDiffs: string[] = [];
  const leftoverList: string[] = [];
  const lfSame: string[] = [];
  let fetched = 0, fetchErrors = 0;
  let next = 0;

  const worker = async () => {
    while (next < roster.length) {
      const c = roster[next++];
      let history: { data: string[][] } | null = null;
      for (let attempt = 1; attempt <= 2 && !history; attempt++) {
        try { history = await fetchAgmList(cookie, String(c.internal_id)); } catch { await new Promise(r => setTimeout(r, 400)); }
      }
      if (!history) { fetchErrors++; continue; }
      fetched++;
      const allRows = history.data ?? [];
      // INV-AR-021 (7): TeamWork leftovers (findLeftoverCycles, the one definition) are dropped exactly as the Late Filing sync drops them
      const leftover = findLeftoverCycles(parseTwCycles(allRows).cycles);
      const leftoverFyes = new Set(leftover.map(l => l.fyeIso));
      for (const l of leftover) leftoverList.push(`${c.company_name} | AGM for FYE ${l.fyeIso} (due ${l.dueIso ?? '-'}, TeamWork event ${l.agmEventId ?? '?'}) inside the ${l.anchorFye} -> ${l.nextFye} year`);
      const rows = leftoverFyes.size ? allRows.filter(r => !leftoverFyes.has(parseDmyStrict(String(r[2] ?? '')) ?? '')) : allRows;

      // (1) every date-shaped text in every cell of every row: does it exist, and what does the lenient parser make of it?
      for (const row of allRows) {
        for (let col = 0; col < row.length; col++) {
          const text = String(row[col] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          for (const m of text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) {
            const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
            const real = y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
            if (real) continue;
            const lenient = iso(parseDmy(m[0]));
            badCells.push(`${c.company_name} | ${row[0]} ${String(row[1]).replace(/<[^>]+>/g, '')} | ${COLS[col] ?? 'col ' + col} | "${m[0]}" (cell text: "${text.slice(0, 60)}") | the lenient parser reads it as ${lenient === 'INVALID' ? 'an INVALID date (throws RangeError in toIsoDate)' : lenient}`);
          }
        }
      }

      // (3) the nightly plan, with details
      const parsed = parseTwCycles(allRows);
      const gate = assessFye(parsed.cycles);
      const eff = effectiveFyeForCompany(c, manualByUen, gate.month);
      if (eff.effective && parsed.cycles.length) {
        const planRows = [...(byCompany.get(c.id) ?? []), ...(byName.get(String(c.company_name).trim().toUpperCase()) ?? []).filter(r => r.company_id == null)];
        const plan = planCompanyAr({ company: { id: c.id, name: c.company_name }, effectiveMonth: eff.effective, teamworkMonth: eff.teamworkMonth, cycles: parsed.cycles, suspectDates: new Set(gate.suspects.map(x => x.fyeIso)), leftoverDates: leftoverFyes, rows: planRows, today });
        planItems.push({ company: { id: c.id, name: c.company_name }, plan });
        for (const rep of plan.reports) {
          if (rep.kind === 'date-drift') planReports.push(`date-drift | ${c.company_name} | row #${rep.rowId} has fye_date ${rep.rowDate}, TeamWork's cycle is ${rep.slotDate}`);
          else if (rep.kind === 'stale-cycle') planReports.push(`stale-cycle | ${c.company_name} | TeamWork still lists the cycle ending ${rep.fyeIso} as open (older than 12 months)`);
          else if (rep.kind === 'other-month-cycle') planReports.push(`other-month-cycle | ${c.company_name} | open cycle ending ${rep.fyeIso} (${rep.month}) but the company's FYE month is ${eff.effective}`);
          else if (rep.kind === 'suspect-cycle') planReports.push(`suspect-cycle | ${c.company_name} | ${rep.fyeIso}`);
          else if (rep.kind === 'uncertain-cycle') planReports.push(`uncertain-cycle | ${c.company_name} | ${rep.fyeIso}`);
          else planReports.push(`${rep.kind} | ${c.company_name} | ${JSON.stringify(rep)}`);
        }
      }

      // (4) Late Filing: the cycle the sync would mirror now (exact FYE date) against the one the OLD guess produced
      let latestCompletionFyeIso: string | null = null;
      let latestFyeIsoLenient: string | null = null;
      for (const row of rows) {
        const [event, , fyeRaw, , , heldRaw, filingRaw] = row;
        if (!['AGM', 'AR'].includes(event)) continue;
        const completion = parseDmy(filingRaw) || parseDmy(heldRaw);
        const fyeIso = iso(parseDmy(fyeRaw));
        if (fyeIso && fyeIso !== 'INVALID' && (!latestFyeIsoLenient || fyeIso > latestFyeIsoLenient)) latestFyeIsoLenient = fyeIso;
        if (completion && fyeIso && fyeIso !== 'INVALID' && (!latestCompletionFyeIso || fyeIso > latestCompletionFyeIso)) latestCompletionFyeIso = fyeIso;
      }
      let earliestOverdueDue: Date | null = null, earliestOverdueFye: string | null = null, currentOverdueDays = 0;
      for (const row of rows) {
        const [event, , fyeRaw, , dueRaw, heldRaw, filingRaw] = row;
        if (!['AGM', 'AR'].includes(event)) continue;
        const due = parseLatestDmy(dueRaw);
        if (!due || Number.isNaN(due.getTime())) continue;
        const completion = parseDmy(filingRaw) || parseDmy(heldRaw);
        const fyeIso = iso(parseDmy(fyeRaw));
        if (completion) continue;
        if (!fyeIso || fyeIso === 'INVALID' || !latestCompletionFyeIso || fyeIso > latestCompletionFyeIso) {
          if (due < todayDate) {
            const overdue = Math.round((todayDate.getTime() - due.getTime()) / 86_400_000);
            if (overdue > currentOverdueDays) currentOverdueDays = overdue;
            if (!earliestOverdueDue || due < earliestOverdueDue) { earliestOverdueDue = due; earliestOverdueFye = fyeIso && fyeIso !== 'INVALID' ? fyeIso : null; }
          }
        }
      }
      if (earliestOverdueDue) {
        const exactMonth = earliestOverdueFye ? MONTHS[Number(earliestOverdueFye.slice(5, 7)) - 1] : null;
        const exactYear = earliestOverdueFye ? Number(earliestOverdueFye.slice(0, 4)) : null;
        const oldMonthIdx = latestFyeIsoLenient ? Number(latestFyeIsoLenient.slice(5, 7)) - 1 : -1;
        const dueMonthIdx = earliestOverdueDue.getUTCMonth();
        const oldYear = earliestOverdueDue.getUTCFullYear() - (oldMonthIdx > dueMonthIdx ? 1 : 0);
        const oldMonth = oldMonthIdx >= 0 ? MONTHS[oldMonthIdx] : null;
        const lf = (c.registration_no ? lfByUen.get(String(c.registration_no).trim().toUpperCase()) : undefined) ?? lfByName.get(String(c.company_name).trim().toUpperCase());
        const mirrored = lf?.mirrored_ar_reminder_id ? rowById.get(lf.mirrored_ar_reminder_id) : undefined;
        const line = `${c.company_name} | overdue ${currentOverdueDays} days${currentOverdueDays > 90 ? ' (flagged: mirrors an AR row)' : ' (not flagged yet; mirrors once past 90 days)'} | the cycle that is overdue: FYE ${earliestOverdueFye ?? '(unreadable)'} = ${exactMonth} ${exactYear} | OLD guess: ${oldMonth} ${oldYear} | row mirrored so far: ${mirrored ? `#${mirrored.id} ${mirrored.fye_month} ${mirrored.fye_year} ${mirrored.status}` : '-'}`;
        if (exactMonth !== oldMonth || exactYear !== oldYear) lfDiffs.push(line); else lfSame.push(line);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  console.log(`fetched ${fetched}, fetch errors ${fetchErrors}`);

  console.log(`\n=== (1) dates that do not exist, anywhere in TeamWork's AGM/AR list (${badCells.length}) ===`);
  badCells.forEach(l => console.log('  ' + l));
  if (!badCells.length) console.log('  none in any of the 9 columns of any active company\'s history');

  console.log(`\n=== (2) Master List FYE cells that staff typed by hand (${manualByUen.size}) ===`);
  const ids = [...manualByUen.values()].map(v => v.masterRowId);
  const { data: masters } = ids.length ? await sb.from('master_list').select('id, company_name, roc_no, fye, status').in('id', ids) : { data: [] as Array<{ id: number; company_name: string; roc_no: string | null; fye: string | null; status: string | null }> };
  const masterName = new Map((masters ?? []).map(m => [m.id, m]));
  const twMonthByUen = new Map((companiesRaw ?? []).map(c => [String(c.registration_no ?? '').trim().toUpperCase(), c.fye_month]));
  for (const [uen, v] of manualByUen) {
    const m = masterName.get(v.masterRowId);
    const tw = twMonthByUen.get(uen) ?? '?';
    console.log(`  ${(m?.company_name ?? uen).slice(0, 44).padEnd(44)} Master List ${v.month.padEnd(9)} TeamWork ${String(tw).padEnd(9)} ${v.month === tw ? 'same' : 'DIFFERENT'} | ${v.basis}${v.by ? ' by ' + v.by : ''} ${String(v.at ?? '').slice(0, 10)}`);
  }

  const outcome = await executeArPlans(sb, planItems, { apply: false, buildInsert: () => ({}) });
  console.log(`\n=== (3) tonight's AR plan: wanted ${outcome.wanted}, restore ${outcome.restored.length}, insert ${outcome.inserted.length}, hide ${outcome.hidden.length}, blocked ${outcome.blocked.length} ===`);
  outcome.restored.forEach(r => console.log(`  RESTORE #${r.id} ${r.company} — ${r.slot}`));
  outcome.inserted.forEach(r => console.log(`  INSERT ${r.company} — ${r.slot}`));
  outcome.hidden.forEach(r => console.log(`  HIDE #${r.id} ${r.company} — ${r.slot} [${r.reason}]`));
  outcome.blocked.forEach(r => console.log(`  BLOCKED #${r.id} ${r.company} — ${r.slot} [${r.why}]`));
  console.log(`  plan reports (${planReports.length}):`);
  planReports.sort().forEach(l => console.log('    ' + l));

  console.log(`\n=== (4) Late Filing: overdue cycles where the NEW exact-date mirror differs from the OLD guess (${lfDiffs.length}); same (${lfSame.length}) ===`);
  lfDiffs.forEach(l => console.log('  DIFFERENT: ' + l));
  lfSame.forEach(l => console.log('  same:      ' + l));

  console.log(`\n=== (4b) TeamWork leftover cycles the system now ignores (${leftoverList.length}) ===`);
  leftoverList.forEach(l => console.log('  ' + l));

  console.log('\n=== (5) recent runs and open exceptions that could be related ===');
  const { data: runs } = await sb.from('automation_sync_runs').select('*').in('source', ['teamwork_nd_1', 'teamwork_nd_2', 'teamwork_nd_3', 'teamwork_nd_4', 'teamwork_nd_5', 'ar_generate', 'ar_workflow', 'late_filing']).order('started_at', { ascending: false }).limit(24);
  const seen = new Set<string>();
  for (const r of runs ?? []) { if (seen.has(r.source)) continue; seen.add(r.source); const err = (r as Record<string, unknown>).error ?? (r as Record<string, unknown>).error_message ?? (r as Record<string, unknown>).last_error; console.log(`  ${r.source.padEnd(14)} ${String(r.started_at).slice(0, 16)} ${r.status}${err ? ' | ' + String(err).slice(0, 160) : ''}`); }
  const { data: exc } = await sb.from('automation_exceptions').select('source, exception_type, entity_name, status').in('source', ['ar_generate', 'ar_workflow', 'late_filing']).eq('status', 'open');
  console.log(`  open exceptions for ar_generate / ar_workflow / late_filing: ${exc?.length ?? 0}`);
  for (const e of (exc ?? []).slice(0, 30)) console.log(`    ${e.source} / ${e.exception_type} / ${e.entity_name}`);
  void MONTH_ABBR;
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
