// One-time seed of companies.client_since from master_list.join_date
// (2026-10-06, Vincent: "把现有的 join_date 能解析出来的部分，一次性导入
// client_since 当初始值").
//
// master_list.join_date is staff-typed free text in mixed formats, so this is
// deliberately conservative — anything that cannot be read with certainty is
// LEFT BLANK and listed in the review CSV for a person to fill in, never
// guessed (same principle as lib/reports-data.ts's computeClientFlow):
//   - "12 Jan 2024", "12.01.2024", ISO "2024-01-12" -> parsed as-is.
//   - "a/b/yyyy": day-first or month-first is decided ONLY when one side is
//     > 12; when both are <= 12 it is ambiguous and goes to the review list.
//     (lib/reports-data.ts parseFlexibleDate assumes month-first for slashes;
//     this script does not inherit that guess.)
//   - A date in the future, or before 1990, is flagged suspicious and skipped.
//   - A UEN with several master_list rows that disagree is skipped.
//   - A company that already has client_since is never overwritten.
//
// Matching is by exact UEN (companies.registration_no = master_list.roc_no,
// trimmed/uppercased) — same rule as lib/reports-data.ts.
//
// Default is a DRY RUN (writes review CSVs, changes nothing). Add --apply to
// write. Requires scripts/add-relationship-contacts.sql to have been run.
//   node --env-file=.env.local scripts/backfill-client-since.mjs [--apply] [--out <dir>]
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const outIdx = process.argv.indexOf('--out');
const OUT_DIR = outIdx > -1 ? process.argv[outIdx + 1] : '.';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

function ymd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 31 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

// -> { date } | { reason }
function parseJoinDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { reason: 'blank' };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/))) {
    const d = ymd(+m[1], +m[2], +m[3]);
    return d ? { date: d } : { reason: 'invalid calendar date' };
  }
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s,-]+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi < 0) return { reason: 'unrecognised month name' };
    const d = ymd(+m[3], mi + 1, +m[1]);
    return d ? { date: d } : { reason: 'invalid calendar date' };
  }
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = ymd(y, +m[2], +m[1]);
    return d ? { date: d } : { reason: 'invalid calendar date' };
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const a = +m[1], b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (a > 12 && b <= 12) { const d = ymd(y, b, a); return d ? { date: d } : { reason: 'invalid calendar date' }; }
    if (b > 12 && a <= 12) { const d = ymd(y, a, b); return d ? { date: d } : { reason: 'invalid calendar date' }; }
    if (a === b) { const d = ymd(y, a, b); return d ? { date: d } : { reason: 'invalid calendar date' }; }
    return { reason: 'ambiguous d/m vs m/d' };
  }
  return { reason: 'unrecognised format' };
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const probe = await sb.from('companies').select('client_since').limit(1);
const hasColumn = !probe.error;
if (!hasColumn && APPLY) {
  console.error(`companies.client_since is not readable (${probe.error.message}). Run scripts/add-relationship-contacts.sql in Supabase first.`);
  process.exit(1);
}
if (!hasColumn) console.log('NOTE: companies.client_since does not exist yet (migration not run) — previewing as if every company is blank.');

const [companies, masterList] = await Promise.all([
  fetchAll('companies', hasColumn ? 'id, company_name, registration_no, client_since' : 'id, company_name, registration_no'),
  fetchAll('master_list', 'id, company_name, roc_no, join_date, list_type'),
]);

const norm = v => (v ? String(v).trim().toUpperCase() : null);

// UEN -> every master_list row for it
const mlByUen = new Map();
for (const m of masterList) {
  const uen = norm(m.roc_no);
  if (!uen) continue;
  (mlByUen.get(uen) ?? mlByUen.set(uen, []).get(uen)).push(m);
}

const today = new Date().toISOString().slice(0, 10);
const toSet = [];
const review = []; // [company, uen, raw join_date, reason]
const stats = { companies: companies.length, alreadySet: 0, noUen: 0, noMasterRow: 0, blank: 0, toSet: 0, review: 0 };

for (const c of companies) {
  if (c.client_since) { stats.alreadySet++; continue; }
  const uen = norm(c.registration_no);
  if (!uen) { stats.noUen++; continue; }
  const rows = mlByUen.get(uen);
  if (!rows) { stats.noMasterRow++; continue; }

  const rawDates = [...new Set(rows.map(r => String(r.join_date ?? '').trim()).filter(Boolean))];
  if (rawDates.length === 0) { stats.blank++; continue; }

  const parsed = rawDates.map(parseJoinDate);
  const good = [...new Set(parsed.filter(p => p.date).map(p => p.date))];
  const bad = parsed.find(p => !p.date);
  if (bad) { review.push([c.company_name, uen, rawDates.join(' | '), bad.reason]); continue; }
  if (good.length > 1) { review.push([c.company_name, uen, rawDates.join(' | '), 'master_list rows disagree']); continue; }

  const date = good[0];
  if (date > today) { review.push([c.company_name, uen, rawDates.join(' | '), 'date in the future']); continue; }
  if (date < '1990-01-01') { review.push([c.company_name, uen, rawDates.join(' | '), 'before 1990 — likely a typo']); continue; }
  toSet.push({ id: c.id, name: c.company_name, uen, raw: rawDates[0], date });
}
stats.toSet = toSet.length;
stats.review = review.length;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'client-since-to-set.csv'), csv(['Company', 'UEN', 'master_list join_date (raw)', 'client_since to set'], toSet.map(r => [r.name, r.uen, r.raw, r.date])));
writeFileSync(join(OUT_DIR, 'client-since-needs-review.csv'), csv(['Company', 'UEN', 'master_list join_date (raw)', 'Why skipped'], review));
console.log(JSON.stringify(stats, null, 2));
console.log(`Wrote client-since-to-set.csv (${toSet.length}) and client-since-needs-review.csv (${review.length}) to ${OUT_DIR}`);

if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply to update companies.client_since.'); process.exit(0); }

let done = 0;
for (const r of toSet) {
  // .is('client_since', null): never overwrite a value someone entered since the read above.
  const { error } = await sb.from('companies').update({ client_since: r.date }).eq('id', r.id).is('client_since', null);
  if (error) { console.error(`FAILED ${r.name}: ${error.message}`); process.exitCode = 1; break; }
  done++;
}
console.log(`APPLIED: ${done} of ${toSet.length} companies updated.`);
