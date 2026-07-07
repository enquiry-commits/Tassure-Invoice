/**
 * Sync nd_appointments against the freshly-extracted TeamWork officials data
 * (data/teamwork-api/companies/*.json), using nominee_directors.member_id as
 * the join key against each company's Directors[] list.
 *
 * Actions:
 *  - INSERT appointments that exist in TeamWork but are missing from the DB
 *  - UPDATE cessation_date where TeamWork shows a cessation but DB has none
 *  - UPDATE appointment_date where TeamWork's date differs from DB's
 *
 * Skips nd_id=2 (DAI LIQING) entirely — her one DB appointment (SOMOS
 * MERIDIAN PTE. LTD.) has zero corroborating TeamWork Directors record under
 * her member_id, so it's left untouched pending manual review.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_ND_IDS = new Set(); // DAI LIQING (id=2) fixed: member_id corrected from 1509 -> 3230

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
      });
      directorAppearances.set(d.member_id, list);
    }
  }

  let inserted = 0, cessationFilled = 0, dateFixed = 0;

  for (const nd of nds) {
    if (SKIP_ND_IDS.has(nd.id)) {
      console.log(`Skipping ${nd.name} (id=${nd.id}) — manual review pending`);
      continue;
    }
    if (!nd.member_id) continue;

    const twAppearances = directorAppearances.get(nd.member_id) ?? [];
    const dbAppts = apptsByNd.get(nd.id) ?? [];
    const dbByCompany = new Map(dbAppts.map(a => [a.company_name, a]));

    for (const tw of twAppearances) {
      const existing = dbByCompany.get(tw.company_name);

      if (!existing) {
        console.log(`  INSERT nd=${nd.name} company=${tw.company_name} doapp=${tw.doapp} cessation=${tw.cessation}`);
        if (!DRY_RUN) {
          const { error } = await sb.from('nd_appointments').insert({
            nd_id: nd.id,
            company_name: tw.company_name,
            sub_role: 'Nominee Director',
            appointment_date: tw.doapp,
            cessation_date: tw.cessation,
          });
          if (error) console.error('    ERROR:', error.message);
        }
        inserted++;
        continue;
      }

      if (tw.cessation && !existing.cessation_date) {
        console.log(`  FILL CESSATION nd=${nd.name} company=${tw.company_name} -> ${tw.cessation}`);
        if (!DRY_RUN) {
          const { error } = await sb.from('nd_appointments').update({ cessation_date: tw.cessation }).eq('id', existing.id);
          if (error) console.error('    ERROR:', error.message);
        }
        cessationFilled++;
      }

      if (tw.doapp && existing.appointment_date && tw.doapp !== existing.appointment_date) {
        console.log(`  FIX APPT DATE nd=${nd.name} company=${tw.company_name} "${existing.appointment_date}" -> "${tw.doapp}"`);
        if (!DRY_RUN) {
          const { error } = await sb.from('nd_appointments').update({ appointment_date: tw.doapp }).eq('id', existing.id);
          if (error) console.error('    ERROR:', error.message);
        }
        dateFixed++;
      }
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Inserted: ${inserted}, Cessation filled: ${cessationFilled}, Date fixed: ${dateFixed}`);
}

main();
