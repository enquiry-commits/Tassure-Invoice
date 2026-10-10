// READ-ONLY. Which companies the Late Filing page would show under the statutory AGM date (FYE + 6 months) that it does NOT show
// under the old FYE + 9 months rule — today and at a few later dates (the difference only exists while a company is between
// FYE + 6 and FYE + 9 months). Uses the real getLateFilingList() with its two evaluation options; writes nothing.
//
//   NODE_PATH=<dir containing node_modules/server-only> npx tsx scripts/late-filing-impact.ts [YYYY-MM-DD ...]
import { readFileSync } from 'node:fs';
import { getLateFilingList } from '../app/api/late-filing/route';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }

(async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);   // SGT
  const dates = process.argv.slice(2).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const asOf = dates.length ? dates : [today, '2026-11-15', '2027-01-15', '2027-03-15', '2027-06-15'];
  for (const d of asOf) {
    const [oldList, newList] = await Promise.all([getLateFilingList({ agmMonths: 9, asOf: d }), getLateFilingList({ agmMonths: 6, asOf: d })]);
    const oldKeys = new Set(oldList.map(r => r.id));
    const added = newList.filter(r => !oldKeys.has(r.id));
    const newKeys = new Set(newList.map(r => r.id));
    const dropped = oldList.filter(r => !newKeys.has(r.id));
    console.log(`\n=== as of ${d}${d === today ? ' (today)' : ''}: old rule ${oldList.length} companies | statutory rule ${newList.length} | newly shown ${added.length} | no longer shown ${dropped.length}`);
    for (const r of added) console.log(`  + ${r.company_name} | FYE ${r.financial_year_end} ${r.late_fy} | AGM due (statutory) ${r.next_agm_due_date} | ${r.source}${r.remarks ? ' | ' + r.remarks.slice(0, 50) : ''}`);
    for (const r of dropped) console.log(`  - ${r.company_name} | FYE ${r.financial_year_end} ${r.late_fy} | next AGM due ${r.next_agm_due_date} | ${r.source}`);
  }
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
