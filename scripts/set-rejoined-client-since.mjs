// One-time (2026-10-06, Vincent's decision): companies whose Master List holds
// two join dates because an earlier engagement was terminated and they later
// came back. client_since = the LATEST date (start of the current engagement);
// client_since_note records that they were terminated before. Needs
// scripts/add-client-since-note.sql run first. Never overwrites a client_since
// or note that someone already entered. Dry run by default; --apply writes.
//   node --env-file=.env.local scripts/set-rejoined-client-since.mjs [--apply]
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const COMPANIES = [
  { uen: '202335034W', date: '2025-11-19', note: 'Re-joined — earlier engagement terminated (first joined 29 Aug 2023).' },
  { uen: '202415722M', date: '2025-06-17', note: 'Re-joined — earlier engagement terminated (first joined 19 Apr 2024).' },
  { uen: '202132801G', date: '2026-05-01', note: 'Re-joined — earlier engagement terminated (first joined 20 Sep 2021).' },
  { uen: '201831780G', date: '2026-05-01', note: 'Re-joined — earlier engagement terminated (first joined 04 Aug 2021).' },
  { uen: '201327824K', date: '2022-12-06', note: 'Re-joined — earlier engagement terminated (first joined 01 Oct 2016).' },
  { uen: '202411102N', date: '2026-04-06', note: 'Re-joined — earlier engagement terminated (first joined 20 Mar 2024).' },
  { uen: '201523227W', date: '2023-10-19', note: 'Earlier record marked inactive (old), no start date on file.' },
];

const probe = await sb.from('companies').select('client_since_note').limit(1);
if (probe.error) { console.error(`client_since_note not readable (${probe.error.message}). Run scripts/add-client-since-note.sql first.`); process.exit(1); }

for (const c of COMPANIES) {
  const { data: rows, error } = await sb.from('companies').select('id, company_name, client_since, client_since_note').eq('registration_no', c.uen);
  if (error) throw new Error(error.message);
  if (rows.length !== 1) { console.log(`SKIP ${c.uen}: ${rows.length} companies match`); continue; }
  const row = rows[0];
  const patch = {};
  if (!row.client_since) patch.client_since = c.date;
  if (!row.client_since_note) patch.client_since_note = c.note;
  if (Object.keys(patch).length === 0) { console.log(`SKIP ${row.company_name}: already set (${row.client_since})`); continue; }
  console.log(`${APPLY ? 'SET ' : 'WOULD SET '}${row.company_name}: ${JSON.stringify(patch)}`);
  if (APPLY) {
    const { error: e2 } = await sb.from('companies').update(patch).eq('id', row.id);
    if (e2) { console.error(`FAILED ${row.company_name}: ${e2.message}`); process.exitCode = 1; }
  }
}
