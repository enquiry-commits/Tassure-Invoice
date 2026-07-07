/**
 * Corrected read-only cross-check for nd_appointments.
 *
 * Per user correction: a TeamWork Directors[] entry only counts as a genuine
 * Nominee Director appointment if BOTH:
 *   1. nominee_dir === 'Yes'  (explicit subrole flag)
 *   2. director_doapp is present AND director_date_of_cessation is empty
 *      (currently active)
 *
 * This flags every current DB row (315 total, from the prior flawed sync)
 * that does NOT meet this criteria as WRONG (should be removed), and every
 * TW entry that DOES meet it but is missing from the DB as MISSING (should
 * be inserted). Also separately reports nominee_dir='Yes' entries that are
 * ceased (historical) for visibility, without proposing to insert them.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function toIso(dmy) {
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

  // member_id -> [{ company_name, doapp, cessation, nominee_dir }]
  const directorAppearances = new Map();
  for (const fn of files) {
    const data = JSON.parse(fs.readFileSync(path.join(companiesDir, fn), 'utf-8'));
    const directors = data.officials?.Directors ?? [];
    for (const d of directors) {
      if (!d.member_id) continue;
      const list = directorAppearances.get(d.member_id) ?? [];
      list.push({
        company_name: data.company_name,
        doapp: toIso(d.director_doapp),
        cessation: toIso(d.director_date_of_cessation),
        nominee_dir: d.nominee_dir,
      });
      directorAppearances.set(d.member_id, list);
    }
  }

  let totalWrong = 0, totalMissing = 0, totalHistorical = 0, totalKept = 0;

  for (const nd of nds) {
    if (!nd.member_id) continue;
    const twAll = directorAppearances.get(nd.member_id) ?? [];
    const twValidActive = twAll.filter(a => a.nominee_dir === 'Yes' && a.doapp && !a.cessation);
    const twValidHistorical = twAll.filter(a => a.nominee_dir === 'Yes' && a.cessation);
    const validActiveCompanySet = new Set(twValidActive.map(a => a.company_name));

    const dbAppts = apptsByNd.get(nd.id) ?? [];

    console.log(`\n=== ${nd.name} (member_id=${nd.member_id}) ===`);
    console.log(`  TW total Directors entries: ${twAll.length}, valid ACTIVE nominee_dir=Yes: ${twValidActive.length}, valid HISTORICAL nominee_dir=Yes (ceased): ${twValidHistorical.length}`);
    console.log(`  DB currently has: ${dbAppts.length} appointments`);

    const wrong = dbAppts.filter(a => !validActiveCompanySet.has(a.company_name));
    const kept = dbAppts.filter(a => validActiveCompanySet.has(a.company_name));
    const missing = twValidActive.filter(a => !dbAppts.some(d => d.company_name === a.company_name));

    if (wrong.length) {
      console.log(`  WRONG in DB (not a valid active nominee_dir=Yes appointment, should REMOVE): ${wrong.length}`);
      wrong.forEach(w => console.log(`    - ${w.company_name} (id=${w.id})`));
    }
    if (missing.length) {
      console.log(`  MISSING (valid active, not in DB, should ADD): ${missing.length}`);
      missing.forEach(m => console.log(`    - ${m.company_name} doapp=${m.doapp}`));
    }
    if (twValidHistorical.length) {
      console.log(`  Historical nominee_dir=Yes (ceased, FYI only, not auto-added): ${twValidHistorical.length}`);
      twValidHistorical.forEach(h => console.log(`    - ${h.company_name} ceased=${h.cessation}`));
    }

    totalWrong += wrong.length;
    totalMissing += missing.length;
    totalHistorical += twValidHistorical.length;
    totalKept += kept.length;
  }

  console.log(`\n\n=== TOTALS ===`);
  console.log(`Kept (correct): ${totalKept}`);
  console.log(`Wrong (to remove): ${totalWrong}`);
  console.log(`Missing (to add): ${totalMissing}`);
  console.log(`Historical ceased nominee_dir=Yes (FYI): ${totalHistorical}`);
}

main();
