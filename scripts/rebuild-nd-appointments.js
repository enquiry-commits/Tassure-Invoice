/**
 * Full rebuild of nd_appointments using browser-verified data from each
 * Nominee Director's "Company Appoinments" tab (data/teamwork-api/nd-appointments-browser.json).
 *
 * A row counts as a valid, currently-active Nominee Director appointment
 * only if: role === 'Nominee Director' AND cessation is empty (per user's
 * explicit correction — the earlier API-based sync incorrectly counted
 * every Directors[] entry regardless of subrole).
 *
 * Deletes and replaces all appointments for the 12 NDs with a known
 * member_id. ZHANG YAN (nd_id=13, member_id=null) is left untouched since
 * she can't be verified via this method.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

function parseDate(s) {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teamwork-api', 'nd-appointments-browser.json'), 'utf-8'));
  const { data: nds } = await sb.from('nominee_directors').select('id, name, member_id');
  const ndIdByName = new Map(nds.map(n => [n.name, n.id]));

  const verifiedNames = new Set(Object.keys(raw.results));
  const ndIdsToRebuild = nds.filter(n => verifiedNames.has(n.name)).map(n => n.id);

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Rebuilding appointments for nd_ids: ${ndIdsToRebuild.join(', ')} (${ndIdsToRebuild.length} NDs)`);
  console.log(`Leaving untouched: ${nds.filter(n => !verifiedNames.has(n.name)).map(n => `${n.name} (id=${n.id})`).join(', ')}`);

  if (!DRY_RUN) {
    const { error: delErr, count } = await sb.from('nd_appointments').delete({ count: 'exact' }).in('nd_id', ndIdsToRebuild);
    if (delErr) { console.error('DELETE ERROR:', delErr.message); process.exit(1); }
    console.log(`Deleted ${count} old rows.`);
  }

  const toInsert = [];
  for (const [name, rows] of Object.entries(raw.results)) {
    const ndId = ndIdByName.get(name);
    if (!ndId) { console.log(`  WARNING: no nd_id found for ${name}, skipping`); continue; }
    const valid = rows.filter(r => r.role === 'Nominee Director' && !r.cessation.trim());
    for (const r of valid) {
      toInsert.push({
        nd_id: ndId,
        company_name: r.company,
        sub_role: 'Nominee Director',
        appointment_date: parseDate(r.doapp),
        cessation_date: null,
      });
    }
    console.log(`  ${name} (nd_id=${ndId}): inserting ${valid.length} appointments`);
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Total to insert: ${toInsert.length}`);

  if (!DRY_RUN && toInsert.length) {
    const { error: insErr } = await sb.from('nd_appointments').insert(toInsert);
    if (insErr) { console.error('INSERT ERROR:', insErr.message); process.exit(1); }
    console.log('Insert complete.');
  }
}

main();
