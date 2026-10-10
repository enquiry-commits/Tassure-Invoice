// READ-ONLY. Shows what tonight's AR plan (lib/ar-cycle-plan.ts, INV-AR-021) would do for the named companies, using TeamWork's
// LIVE AGM/AR history and the live ar_reminder rows. Writes nothing anywhere: the executor runs with apply:false.
//
//   npx tsx scripts/ar-plan-dryrun.ts "BEAUTY ASSET" "MAPLE GROVE" "SOQ INTERNATIONAL"      (named companies, full detail)
//   npx tsx scripts/ar-plan-dryrun.ts --all                                                 (every active company: what tonight's run would record)
//
// Needs .env.local (service role key + TeamWork login) and, outside the app bundle, a stub for the `server-only` import:
//   NODE_PATH=<dir containing node_modules/server-only/index.js stub> npx tsx scripts/ar-plan-dryrun.ts ...
// One TeamWork login for the whole run, one history fetch per company — keep the list short.
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../lib/supabase';
import { fetchAgmList, getSessionCookie } from '../lib/teamwork-agm';
import { assessFye, parseTwCycles } from '../lib/ar-fye-resolve';
import { effectiveFyeForCompany, loadManualFyeByUen } from '../lib/ar-fye-manual';
import { planCompanyAr, type PlanRow } from '../lib/ar-cycle-plan';
import { executeArPlans, type PlanItem } from '../lib/ar-plan-apply';
import { isTeamworkActiveCompany, onlyTeamworkActiveCompanies } from '../lib/company-lifecycle';
import { MONTHS } from '../lib/ar-fye-resolve';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }

async function runAll() {
  const sb = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const manualByUen = await loadManualFyeByUen(sb);
  const { data: companies, error } = await onlyTeamworkActiveCompanies(sb.from('companies').select('id, company_name, internal_id, registration_no, fye_month, is_active, tw_status'));
  if (error) throw new Error(error.message);
  const roster = (companies ?? []).filter(c => c.internal_id);
  const { data: allRows, error: rowsErr } = await sb.from('ar_reminder').select('id, company_id, entity_name, fye_month, fye_year, fye_date, status, filling_date, agm_held_date');
  if (rowsErr) throw new Error(rowsErr.message);
  const byCompany = new Map<number, PlanRow[]>();
  const byName = new Map<string, PlanRow[]>();
  for (const r of (allRows ?? []) as PlanRow[]) {
    if (r.company_id != null) (byCompany.get(r.company_id) ?? byCompany.set(r.company_id, []).get(r.company_id)!).push(r);
    const k = r.entity_name.trim().toUpperCase();
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(r);
  }
  console.log(`roster ${roster.length} active companies with a TeamWork id | ar_reminder rows ${allRows?.length} | deliberate Master List FYEs ${manualByUen.size}`);
  const cookie = await getSessionCookie();
  const items: PlanItem[] = [];
  const stats = { fetched: 0, fetchErrors: 0, noCycles: 0, gateDiffersFromOld: [] as string[], storedDiffersFromDerived: [] as string[], suspects: [] as string[], bad: [] as string[], overrides: [] as string[], uncertain: 0 };
  let next = 0;
  const worker = async () => {
    while (next < roster.length) {
      const c = roster[next++];
      let history: { data: string[][] } | null = null;
      for (let attempt = 1; attempt <= 2 && !history; attempt++) {
        try { history = await fetchAgmList(cookie, String(c.internal_id)); } catch { await new Promise(r => setTimeout(r, 400)); }
      }
      if (!history) { stats.fetchErrors++; continue; }
      stats.fetched++;
      const parsed = parseTwCycles(history.data ?? []);
      if (!parsed.cycles.length) { stats.noCycles++; continue; }
      const gate = assessFye(parsed.cycles);
      for (const sct of gate.suspects) stats.suspects.push(`${c.company_name}: ${sct.fyeIso} (${sct.kind})`);
      for (const b of parsed.bad) stats.bad.push(`${c.company_name}: ${b.event} ${b.yearLabel} ${b.column} "${b.raw}"`);
      stats.uncertain += parsed.cycles.filter(x => x.uncertain).length;
      // the OLD rule: the month of the cycle with the latest FYE date
      const latest = [...parsed.cycles].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso)).at(-1)!;
      const oldMonth = MONTHS[Number(latest.fyeIso.slice(5, 7)) - 1];
      if (gate.month && gate.month !== oldMonth) stats.gateDiffersFromOld.push(`${c.company_name}: old rule ${oldMonth}, gated ${gate.month}`);
      if (gate.month && gate.month !== c.fye_month) stats.storedDiffersFromDerived.push(`${c.company_name}: stored ${c.fye_month}, TeamWork implies ${gate.month}`);
      const eff = effectiveFyeForCompany(c, manualByUen, gate.month);
      if (!eff.effective) continue;
      const manual = manualByUen.get(String(c.registration_no ?? '').trim().toUpperCase());
      if (eff.differs && manual) stats.overrides.push(`${c.company_name}: Master List ${manual.month}, TeamWork ${eff.teamworkMonth}`);
      const rows = [...(byCompany.get(c.id) ?? []), ...(byName.get(String(c.company_name).trim().toUpperCase()) ?? []).filter(r => r.company_id == null)];
      items.push({
        company: { id: c.id, name: c.company_name },
        plan: planCompanyAr({ company: { id: c.id, name: c.company_name }, effectiveMonth: eff.effective, teamworkMonth: eff.teamworkMonth, cycles: parsed.cycles, suspectDates: new Set(gate.suspects.map(x => x.fyeIso)), rows, today }),
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  const outcome = await executeArPlans(sb, items, { apply: false, buildInsert: () => ({}) });
  console.log(`\nfetched ${stats.fetched} (errors ${stats.fetchErrors}, no readable cycle ${stats.noCycles}, uncertain cycles ${stats.uncertain}) | planned ${outcome.companies} | covered ${outcome.covered} | wanted ${outcome.wanted} | exceeds the change limit: ${outcome.exceedsLimit}`);
  console.log('plan reports by kind:', JSON.stringify(outcome.reports));
  const show = <T,>(title: string, list: readonly T[], fmt: (x: T) => string, n = 40) => {
    console.log(`\n== ${title} (${list.length})`);
    for (const x of list.slice(0, n)) console.log('  ' + fmt(x));
    if (list.length > n) console.log(`  … and ${list.length - n} more`);
  };
  show('would RESTORE (hidden by the system, TeamWork wants it)', outcome.restored, x => `#${x.id} ${x.company} — ${x.slot}`);
  show('would INSERT (no row at all)', outcome.inserted, x => `${x.company} — ${x.slot}`);
  show('would HIDE (ghost / replaced)', outcome.hidden, x => `#${x.id} ${x.company} — ${x.slot} [${x.reason}]`);
  show('BLOCKED (left alone, a person decides)', outcome.blocked, x => `#${x.id} ${x.company} — ${x.slot} [${x.why}${x.by ? ' by ' + x.by : ''}]`);
  show('FYE month the new gate sets differently from the old "latest FYE wins" rule', stats.gateDiffersFromOld, x => x);
  show('companies.fye_month that the nightly sync would change (stored vs what TeamWork implies)', stats.storedDiffersFromDerived, x => x);
  show('cycles refused as keying slips', stats.suspects, x => x);
  show('unreadable dates in TeamWork', stats.bad, x => x);
  show('Master List FYE overrides in effect (AR follows Master List, TeamWork shows another month)', stats.overrides, x => x);
}

(async () => {
  if (process.argv.includes('--all')) { await runAll(); return; }
  const needles = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!needles.length) { console.log('give at least one company name fragment, or --all'); process.exit(1); }
  const sb = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const manualByUen = await loadManualFyeByUen(sb);
  const cookie = await getSessionCookie();
  const items: PlanItem[] = [];

  for (const needle of needles) {
    const { data: found, error } = await sb.from('companies').select('id, company_name, internal_id, registration_no, fye_month, is_active, tw_status').ilike('company_name', `%${needle}%`).limit(5);
    if (error) throw new Error(error.message);
    for (const c of found ?? []) {
      console.log(`\n=== ${c.company_name} (companies.id ${c.id}, TeamWork ${c.internal_id}, UEN ${c.registration_no}) | stored FYE ${c.fye_month} | ${c.is_active ? 'active' : 'INACTIVE'} / ${c.tw_status}`);
      if (!c.internal_id) { console.log('  no TeamWork id — skipped'); continue; }
      const history = await fetchAgmList(cookie, String(c.internal_id));
      const parsed = parseTwCycles(history.data ?? []);
      const gate = assessFye(parsed.cycles);
      console.log(`  TeamWork cycles (${parsed.cycles.length}):`);
      for (const cy of parsed.cycles.slice(-8)) console.log(`    FYE ${cy.fyeIso} label ${cy.yearLabel} | AGM ${cy.hasAgm ? (cy.agmDone ? 'held' : 'open') : '-'} | AR ${cy.hasAr ? (cy.arDone ? 'filed' : 'open') : '-'} | due ${cy.dueIso ?? '-'}${cy.uncertain ? ' | UNCERTAIN' : ''}`);
      if (parsed.bad.length) console.log('  unreadable cells:', JSON.stringify(parsed.bad));
      console.log(`  month TeamWork implies: ${gate.month ?? '(none)'}${gate.suspects.length ? ` | refused: ${gate.suspects.map(s => `${s.fyeIso} (${s.kind})`).join(', ')}` : ''}`);
      const eff = effectiveFyeForCompany(c, manualByUen, gate.month);
      const manual = manualByUen.get(String(c.registration_no ?? '').trim().toUpperCase());
      console.log(`  month AR runs on: ${eff.effective} (${eff.source})${manual ? ` | Master List ${manual.month} typed by ${manual.by ?? '(flag)'} ${manual.at ?? ''}` : ''}${eff.differs ? ' | DIFFERS from TeamWork' : ''}`);
      if (!isTeamworkActiveCompany(c)) { console.log('  not on the active roster — the plan skips it'); continue; }
      if (!eff.effective) continue;
      const { data: rows, error: rowsErr } = await sb.from('ar_reminder').select('id, company_id, entity_name, fye_month, fye_year, fye_date, status, filling_date, agm_held_date').or(`company_id.eq.${c.id},entity_name.eq.${String(c.company_name).replace(/[,()]/g, ' ')}`).order('fye_year').order('id');
      if (rowsErr) throw new Error(rowsErr.message);
      for (const r of (rows ?? []) as PlanRow[]) console.log(`    row #${r.id} ${r.fye_month} ${r.fye_year} fye_date ${r.fye_date ?? '-'} ${r.status}${r.filling_date ? ' filed ' + r.filling_date : ''}`);
      const plan = planCompanyAr({
        company: { id: c.id, name: c.company_name }, effectiveMonth: eff.effective, teamworkMonth: eff.teamworkMonth, cycles: parsed.cycles,
        suspectDates: new Set(gate.suspects.map(s => s.fyeIso)), rows: (rows ?? []) as PlanRow[], today,
      });
      console.log(`  PLAN: covered ${plan.covered} | wanted ${plan.wanted.map(w => `${w.slot.fye_month} ${w.slot.fye_year} (${w.slot.fye_date}${w.relabelled ? ', relabelled' : ''})`).join(', ') || '-'} | hide ${plan.hide.map(h => `#${h.row.id} ${h.reason}`).join(', ') || '-'} | reports ${plan.reports.map(r => r.kind).join(', ') || '-'}`);
      items.push({ company: { id: c.id, name: c.company_name }, plan });
    }
  }
  const outcome = await executeArPlans(sb, items, { apply: false, buildInsert: () => ({}) });
  console.log('\n=== what the executor would do (nothing is written) ===');
  console.log(JSON.stringify({ restore: outcome.restored, insert: outcome.inserted, hide: outcome.hidden, blocked: outcome.blocked, failed: outcome.failed }, null, 1));
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
