// One-time cleanup of master_list.join_date text (2026-10-06, Vincent's
// explicit rules). Only touches master_list rows whose UEN belongs to a row in
// `companies`. Dry run by default; --apply writes. Always writes a backup CSV
// (id, old, new) first so every change is reversible.
//   - "dd/mm/yyyy" where BOTH parts <= 12 and differ (the ambiguous ones)
//     -> read as DAY-first and rewritten as "08 Jul 2024".
//   - "Sep-16"        -> "September 16"   (literal, as instructed)
//   - "2020.02.18"    -> "18 Feb 2020"
//   - "YES", "2020"   -> kept, listed in needs-accurate-date.csv
// Everything else (invalid dates, "11-12-2018", conflicting duplicates...) is
// left untouched and listed in not-touched.csv.
//   node --env-file=.env.local scripts/normalize-join-dates.mjs [--apply] [--out <dir>]
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

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const norm = v => (v ? String(v).trim().toUpperCase() : null);
function valid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const fmt = (y, m, d) => `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`;

// -> { to } | { keep: reason } | null (not in scope for this script)
function rewrite(raw) {
  const s = String(raw ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const a = +m[1], b = +m[2];
    if (a > 12 || b > 12 || a === b) return null; // unambiguous: already parsed fine, out of scope
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, b, a) ? { to: fmt(y, b, a) } : null;
  }
  if (/^Sep-16$/i.test(s)) return { to: 'September 16' };
  if ((m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/))) return valid(+m[1], +m[2], +m[3]) ? { to: fmt(+m[1], +m[2], +m[3]) } : null;
  if (/^YES$/i.test(s) || /^\d{4}$/.test(s)) return { keep: 'needs an accurate date' };
  return null;
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const [companies, masterList] = await Promise.all([
  fetchAll('companies', 'id, registration_no'),
  fetchAll('master_list', 'id, company_name, roc_no, join_date, list_type'),
]);
const companyUens = new Set(companies.map(c => norm(c.registration_no)).filter(Boolean));

const changes = [], needsDate = [];
for (const m of masterList) {
  const uen = norm(m.roc_no);
  if (!uen || !companyUens.has(uen)) continue;
  const r = rewrite(m.join_date);
  if (!r) continue;
  if (r.keep) needsDate.push([m.company_name, m.roc_no, m.join_date, m.list_type]);
  else if (r.to !== String(m.join_date).trim()) changes.push({ id: m.id, name: m.company_name, uen: m.roc_no, old: m.join_date, to: r.to });
}

// Same-UEN rows that carry different dates — listed for a human, never touched.
const byUen = new Map();
for (const m of masterList) {
  const uen = norm(m.roc_no);
  if (!uen || !companyUens.has(uen) || !String(m.join_date ?? '').trim()) continue;
  (byUen.get(uen) ?? byUen.set(uen, []).get(uen)).push(m);
}
const conflicts = [];
for (const [uen, rows] of byUen) {
  const dates = [...new Set(rows.map(r => String(r.join_date).trim()))];
  if (dates.length > 1) conflicts.push([rows[0].company_name, uen, rows.map(r => `${r.join_date} (${r.list_type})`).join(' | ')]);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'join-date-backup-and-changes.csv'), csv(['master_list id', 'Company', 'UEN', 'OLD join_date', 'NEW join_date'], changes.map(c => [c.id, c.name, c.uen, c.old, c.to])));
writeFileSync(join(OUT_DIR, 'join-date-needs-accurate-date.csv'), csv(['Company', 'UEN', 'join_date now', 'list'], needsDate));
writeFileSync(join(OUT_DIR, 'join-date-conflicts.csv'), csv(['Company', 'UEN', 'Different join_dates'], conflicts));
console.log({ toRewrite: changes.length, keepNeedsAccurateDate: needsDate.length, conflictingDuplicates: conflicts.length });

if (!APPLY) { console.log('DRY RUN — nothing written.'); process.exit(0); }

let done = 0;
for (const c of changes) {
  // .eq('join_date', c.old): only if nobody edited it since the read above.
  const { data, error } = await sb.from('master_list').update({ join_date: c.to }).eq('id', c.id).eq('join_date', c.old).select('id');
  if (error) { console.error(`FAILED id ${c.id}: ${error.message}`); process.exitCode = 1; break; }
  if (data?.length) done++;
}
console.log(`APPLIED: ${done} of ${changes.length} rows rewritten.`);
