// READ-ONLY. What do TeamWork's AGM/AR cycles of the active companies look like when something is "off"? Used to check a rule for leftover
// cycles (ORBITEZ: a June 2025 AGM that cannot exist for a December-FYE company) against ALL companies before it is built. Writes nothing.
//
//   NODE_PATH=<dir containing node_modules/server-only> npx tsx scripts/ar-cycle-shapes.ts
//
// One TeamWork login and one history fetch per company (~900 reads, concurrency 8, about four minutes).
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../lib/supabase';
import { fetchAgmList, getSessionCookie } from '../lib/teamwork-agm';
import { assessFye, daysBetweenIso, findLeftoverCycles, isDoneCycle, isOpenCycle, monthOfIso, parseTwCycles, type TwCycle } from '../lib/ar-fye-resolve';
import { onlyTeamworkActiveCompanies } from '../lib/company-lifecycle';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }

const monthsBetween = (a: string, b: string) => Math.round(daysBetweenIso(b, a) / 30.4375);
const show = (c: TwCycle) => `${c.fyeIso} ${c.hasAgm ? (c.agmDone ? 'AGM held' : 'AGM open') : 'no AGM event'} / ${c.hasAr ? (c.arDone ? 'AR filed' : 'AR open') : 'no AR event'}${c.dueIso ? ' due ' + c.dueIso : ''}`;

(async () => {
  const sb = createAdminClient();
  const { data: companies, error } = await onlyTeamworkActiveCompanies(sb.from('companies').select('id, company_name, internal_id, fye_month'));
  if (error) throw new Error(error.message);
  const roster = (companies ?? []).filter(c => c.internal_id);
  const cookie = await getSessionCookie();
  const lopsided: string[] = [];
  const otherMonthOpen: string[] = [];
  const sandwiches: string[] = [];
  const leftovers: string[] = [];
  const histogram = { companies: 0, cycles: 0, both: 0, agmOnly: 0, arOnly: 0, agmOnlyOpen: 0, arOnlyOpen: 0 };
  let next = 0, errors = 0;
  const worker = async () => {
    while (next < roster.length) {
      const c = roster[next++];
      let history: { data: string[][] } | null = null;
      for (let attempt = 1; attempt <= 2 && !history; attempt++) { try { history = await fetchAgmList(cookie, String(c.internal_id)); } catch { await new Promise(r => setTimeout(r, 400)); } }
      if (!history) { errors++; continue; }
      const { cycles } = parseTwCycles(history.data ?? []);
      if (!cycles.length) continue;
      histogram.companies++;
      const month = assessFye(cycles).month;
      for (const l of findLeftoverCycles(cycles)) leftovers.push(`${c.company_name} | company month ${month} | ${l.note}`);
      cycles.forEach((cy, i) => {
        histogram.cycles++;
        if (cy.hasAgm && cy.hasAr) histogram.both++;
        else if (cy.hasAgm) { histogram.agmOnly++; if (isOpenCycle(cy)) histogram.agmOnlyOpen++; }
        else { histogram.arOnly++; if (isOpenCycle(cy)) histogram.arOnlyOpen++; }
        const later = cycles.slice(i + 1);
        const prev = i > 0 ? cycles[i - 1] : null;
        const nxt = later[0] ?? null;
        const ctx = `${c.company_name} | company month ${month} | cycle ${show(cy)}${prev ? ` | previous ${prev.fyeIso}` : ''}${nxt ? ` | next ${nxt.fyeIso}` : ''}`;
        if (cy.hasAgm !== cy.hasAr && !isDoneCycle(cy)) lopsided.push(ctx);
        if (month && monthOfIso(cy.fyeIso) !== month && isOpenCycle(cy) && later.length) otherMonthOpen.push(ctx);
        if (prev && nxt && monthsBetween(prev.fyeIso, nxt.fyeIso) >= 11 && monthOfIso(cy.fyeIso) !== monthOfIso(prev.fyeIso) && monthOfIso(cy.fyeIso) !== monthOfIso(nxt.fyeIso)) sandwiches.push(ctx);
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  console.log(`companies with readable cycles ${histogram.companies} (fetch errors ${errors}) | cycles ${histogram.cycles}: both events ${histogram.both}, AGM only ${histogram.agmOnly} (open ${histogram.agmOnlyOpen}), AR only ${histogram.arOnly} (open ${histogram.arOnlyOpen})`);
  const dump = (title: string, list: string[]) => { console.log(`\n== ${title} (${list.length})`); list.slice(0, 80).forEach(l => console.log('  ' + l)); if (list.length > 80) console.log(`  … ${list.length - 80} more`); };
  dump('LEFTOVER (the rule findLeftoverCycles — the system ignores these)', leftovers);
  dump('open cycle that has only ONE of the two events (AGM without AR, or AR without AGM)', lopsided);
  dump('open cycle in a month other than the company\'s FYE month, with a later cycle', otherMonthOpen);
  dump('cycle sandwiched between two cycles that are 11+ months apart, in a month different from both', sandwiches);
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
