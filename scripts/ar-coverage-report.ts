// READ-ONLY. Lists every active client whose next open TeamWork cycle has no visible AR Reminder row, plus ghosts,
// duplicates and stale open rows (lib/ar-coverage.ts, INV-AR-020). Writes nothing anywhere.
//
//   npx tsx scripts/ar-coverage-report.ts [--csv path/to/file.csv]
//
// Needs .env.local (service role key) and, outside the app bundle, a stub for the `server-only` import:
//   NODE_PATH=<dir containing node_modules/server-only/index.js stub> npx tsx scripts/ar-coverage-report.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createAdminClient } from '../lib/supabase';
import { reconcileCoverage, MONTHS, normalizeUen, type CovCompany, type CovMaster, type CovRow, type Finding } from '../lib/ar-coverage';
import { loadLastExclusions } from '../lib/ar-fye-restore';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }

async function all<T>(q: () => ReturnType<ReturnType<typeof createAdminClient>['from']>['select'] extends never ? never : any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

(async () => {
  const sb = createAdminClient();
  const companiesAll = await all<CovCompany & { is_active: boolean | null; tw_status: string | null }>(() => sb.from('companies').select('id, company_name, registration_no, fye_month, fye_day, is_active, tw_status').order('id'));
  const companies = companiesAll.filter(c => c.is_active === true && /active/i.test(String(c.tw_status ?? '')) && !/terminat|strik|struck/i.test(String(c.tw_status ?? '')) && c.fye_month && MONTHS.includes(c.fye_month));
  const mastersAll = await all<CovMaster & { status: string | null; secretary_active: boolean | null }>(() => sb.from('master_list').select('id, roc_no, company_name, status, secretary_active, next_agm_due_date, eot_original_due_date').order('id'));
  const masters = mastersAll.filter(m => /^active/i.test(String(m.status ?? '')));
  const rows = await all<CovRow>(() => sb.from('ar_reminder').select('id, entity_name, company_id, uen, fye_month, fye_year, fye_date, status, filling_date').order('id'));

  const { findings, stats, horizonYm } = reconcileCoverage({ companies, masters, rows });
  const secActive = new Map(masters.map(m => [normalizeUen(m.roc_no), m.secretary_active]));
  const hiddenIds = findings.flatMap(f => (f.kind === 'MISSING' ? f.hidden.map(h => h.id) : []));
  const last = hiddenIds.length ? await loadLastExclusions(sb, hiddenIds) : new Map();
  const who = (id: number) => { const l = last.get(id); return l ? `${l.by ?? '?'}${l.byName ? ` (${l.byName.slice(0, 40)})` : ''} on ${l.at.slice(0, 10)}` : 'no audit trail'; };

  console.log(`AR COVERAGE — ${new Date().toISOString().slice(0, 16)}Z`);
  console.log(`active companies with an FYE month: ${companies.length} | matched to TeamWork's next open cycle: ${stats.checked} | covered: ${stats.covered} | not due to exist yet (beyond the 6-month window): ${stats.notYetDue}`);
  console.log(`not evaluated: no unique Master List row for the UEN ${stats.noMaster} | no next AGM date ${stats.noDue} | date is legacy text, not ISO ${stats.unparseableDue}`);
  console.log(`findings: MISSING ${stats.missing} | WRONG_MONTH ${stats.wrongMonth} | DUPLICATE ${stats.duplicate} | LABEL_MISMATCH ${stats.labelMismatch} | STALE_OPEN ${stats.staleOpen} | DATE_INCONSISTENT ${stats.dateInconsistent} | STALE_MASTER ${stats.staleMaster}   (window ends ${horizonYm})\n`);

  const csv: string[][] = [['kind', 'company', 'UEN', 'company FYE month', 'expected / row cycle', 'detail', 'secretary_active']];
  const sec = (uen: string | null) => String(secActive.get(normalizeUen(uen)) ?? '');
  const show = (title: string, kind: Finding['kind'], line: (f: Finding) => string, limit = 60) => {
    const list = findings.filter(f => f.kind === kind);
    console.log(`== ${title} (${list.length})`);
    list.slice(0, limit).forEach(f => console.log('  ' + line(f)));
    if (list.length > limit) console.log(`  … and ${list.length - limit} more (see the CSV)`);
    console.log('');
  };
  for (const f of findings) {
    if (f.kind === 'MISSING') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', f.expectedYm, `AGM due ${f.due}; ${f.hidden.length ? f.hidden.map(h => `hidden row #${h.id} by ${who(h.id)}`).join(' / ') : 'no row at all for this cycle'}`, sec(f.company.registration_no)]);
    else if (f.kind === 'WRONG_MONTH') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', `${f.row.fye_month} ${f.row.fye_year}`, `row #${f.row.id} ${f.row.status}, fye_date ${f.row.fye_date}`, sec(f.company.registration_no)]);
    else if (f.kind === 'DUPLICATE') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', f.ym, `rows ${f.rows.map(r => '#' + r.id).join(', ')}`, sec(f.company.registration_no)]);
    else if (f.kind === 'DATE_INCONSISTENT') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', '', `Master List next AGM due ${f.due} fits no year of this company's FYE month — check the FYE in TeamWork`, sec(f.company.registration_no)]);
    else if (f.kind === 'STALE_MASTER') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', f.expectedYm, `TeamWork's next open cycle is older than 12 months (AGM due ${f.due}); a visible row ${f.covered ? 'exists' : 'does NOT exist'} for it`, sec(f.company.registration_no)]);
    else if (f.kind === 'STALE_OPEN') csv.push([f.kind, f.company.company_name, f.company.registration_no ?? '', f.company.fye_month ?? '', `${f.row.fye_month} ${f.row.fye_year}`, `row #${f.row.id} ${f.row.status} unfiled, older than the open cycle ${f.expectedYm}`, sec(f.company.registration_no)]);
    else csv.push([f.kind, f.row.entity_name, f.row.uen ?? '', '', `${f.row.fye_month} ${f.row.fye_year}`, `row #${f.row.id}, fye_date ${f.row.fye_date}`, '']);
  }
  show('MISSING — TeamWork has an open cycle but no visible AR row', 'MISSING', f => {
    if (f.kind !== 'MISSING') return '';
    return `${f.company.company_name} | company FYE ${f.company.fye_month} | open cycle FYE ${f.expectedYm} (AGM due ${f.due}) | secretary_active=${sec(f.company.registration_no) || '?'} | ${f.hidden.length ? f.hidden.map(h => `hidden #${h.id} by ${who(h.id)}`).join('; ') : 'NO row at all'}`;
  });
  show('WRONG_MONTH — visible unfiled row stored under a month that is not the company\'s FYE month', 'WRONG_MONTH', f => (f.kind === 'WRONG_MONTH' ? `${f.company.company_name} | company FYE ${f.company.fye_month} | row #${f.row.id} ${f.row.fye_month} ${f.row.fye_year} (${f.row.status}, fye_date ${f.row.fye_date})` : ''));
  show('DUPLICATE — two visible rows for one cycle', 'DUPLICATE', f => (f.kind === 'DUPLICATE' ? `${f.company.company_name} | ${f.ym} | rows ${f.rows.map(r => '#' + r.id).join(', ')}` : ''));
  show('LABEL_MISMATCH — month label disagrees with its own fye_date', 'LABEL_MISMATCH', f => (f.kind === 'LABEL_MISMATCH' ? `${f.row.entity_name} | row #${f.row.id} ${f.row.fye_month} ${f.row.fye_year} but fye_date ${f.row.fye_date}` : ''));
  show('DATE_INCONSISTENT — Master List\'s next AGM date fits no year of the company\'s FYE month (check the FYE / the date in TeamWork)', 'DATE_INCONSISTENT', f => (f.kind === 'DATE_INCONSISTENT' ? `${f.company.company_name} | company FYE ${f.company.fye_month} ${f.company.fye_day ?? ''} | next AGM due ${f.due}` : ''));
  show('STALE_MASTER — TeamWork\'s next open cycle is more than 12 months old (an ancient unheld cycle, or stale data)', 'STALE_MASTER', f => (f.kind === 'STALE_MASTER' ? `${f.company.company_name} | company FYE ${f.company.fye_month} | open cycle FYE ${f.expectedYm} (AGM due ${f.due}) | visible row ${f.covered ? 'exists' : 'does NOT exist'}` : ''));
  show('STALE_OPEN — unfiled visible row OLDER than the open cycle, whose own AGM date has passed (filing not synced to the row, or an earlier cycle is genuinely overdue)', 'STALE_OPEN', f => (f.kind === 'STALE_OPEN' ? `${f.company.company_name} | row #${f.row.id} ${f.row.fye_month} ${f.row.fye_year} (${f.row.status}) | open cycle now ${f.expectedYm}` : ''), 40);

  const i = process.argv.indexOf('--csv');
  if (i > 0 && process.argv[i + 1]) {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync(process.argv[i + 1], '﻿' + csv.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
    console.log('CSV written:', process.argv[i + 1]);
  }
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
