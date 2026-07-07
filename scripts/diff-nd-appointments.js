/**
 * Read-only cross-check: for each Nominee Director (by member_id), scan the
 * freshly-extracted TeamWork officials data across all 1340 companies and
 * find every Directors[] entry matching that member_id, then compare against
 * the nd_appointments table (company_name, appointment_date, cessation_date).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function toIso(dmy) {
  // "19/07/2017" -> "2017-07-19"
  if (!dmy) return null;
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function main() {
  const { data: nds } = await sb.from('nominee_directors').select('id, name, member_id');
  const { data: appts } = await sb.from('nd_appointments').select('*');

  const apptsByNd = new Map();
  for (const a of appts) {
    const list = apptsByNd.get(a.nd_id) ?? [];
    list.push(a);
    apptsByNd.set(a.nd_id, list);
  }

  const companiesDir = path.join(__dirname, '..', 'data', 'teamwork-api', 'companies');
  const files = fs.readdirSync(companiesDir);

  // Build member_id -> [{ company_name, doapp, cessation }] index from Directors role only
  const directorAppearances = new Map();
  for (const fn of files) {
    const data = JSON.parse(fs.readFileSync(path.join(companiesDir, fn), 'utf-8'));
    const directors = data.officials?.Directors ?? [];
    for (const d of directors) {
      if (!d.member_id) continue;
      const list = directorAppearances.get(d.member_id) ?? [];
      list.push({
        company_name: data.company_name,
        director_name: d.director_name,
        doapp: toIso(d.director_doapp),
        cessation: toIso(d.director_date_of_cessation),
        is_removed: d.is_removed,
        nominee_dir: d.nominee_dir,
        director_role: d.director_role,
      });
      directorAppearances.set(d.member_id, list);
    }
  }

  for (const nd of nds) {
    console.log(`\n=== ND: ${nd.name} (id=${nd.id}, member_id=${nd.member_id}) ===`);
    if (!nd.member_id) { console.log('  no member_id set, skipping TW cross-check'); continue; }

    const twAppearances = directorAppearances.get(nd.member_id) ?? [];
    const dbAppts = apptsByNd.get(nd.id) ?? [];

    const twCompanySet = new Set(twAppearances.map(a => a.company_name));
    const dbCompanySet = new Set(dbAppts.map(a => a.company_name));

    const missingInDb = [...twCompanySet].filter(c => !dbCompanySet.has(c));
    const extraInDb = [...dbCompanySet].filter(c => !twCompanySet.has(c));

    console.log(`  TW appearances: ${twAppearances.length}, DB appointments: ${dbAppts.length}`);
    if (missingInDb.length) console.log(`  MISSING in DB (in TW but not tracked):`, missingInDb);
    if (extraInDb.length) console.log(`  EXTRA in DB (tracked but not found in TW Directors):`, extraInDb);

    // Check date mismatches for companies present in both
    for (const c of twCompanySet) {
      if (!dbCompanySet.has(c)) continue;
      const twEntry = twAppearances.find(a => a.company_name === c);
      const dbEntry = dbAppts.find(a => a.company_name === c);
      if (twEntry.cessation && !dbEntry.cessation_date) {
        console.log(`  CESSATION MISSING in DB: ${c} — TW says ceased ${twEntry.cessation}, DB shows still active`);
      }
      if (twEntry.doapp && dbEntry.appointment_date && twEntry.doapp !== dbEntry.appointment_date) {
        console.log(`  APPOINTMENT DATE MISMATCH: ${c} — TW=${twEntry.doapp} DB=${dbEntry.appointment_date}`);
      }
    }
  }
}

main();
