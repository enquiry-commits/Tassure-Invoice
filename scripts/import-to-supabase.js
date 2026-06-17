// Import scraped JSON data into Supabase
// Run: node scripts/import-to-supabase.js
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY   // use secret key for writes
);

const DATA = path.join(__dirname, '..', 'data');

function parseDate(str) {
  if (!str) return null;
  const clean = str.replace(/\(Effective\)\s*/i, '').trim();
  const m = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;  // ISO format for Postgres
}

async function importCompanies() {
  console.log('\n── Importing companies...');
  const clients = JSON.parse(fs.readFileSync(path.join(DATA, 'clients_merged.json'), 'utf8'));

  const rows = clients.map(c => ({
    company_name:    c.companyName,
    registration_no: c.registrationNo || null,
    company_type:    c.companyType || null,
    internal_id:     c.internalId ? String(c.internalId) : null,
    fye_month:       c.fyeMonth || null,
    pic:             c.pic || null,
    uses_address:    c.usesAddressService === true,
    best_email:      c.bestEmail || null,
    primary_contact: c.primaryContact || null,
    contact_persons: c.contactPersons || [],
    synced_at:       new Date().toISOString(),
  }));

  // Upsert in batches of 100
  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('companies')
      .upsert(batch, { onConflict: 'internal_id', ignoreDuplicates: false });
    if (error) { console.error('  Error:', error.message); return false; }
    done += batch.length;
    process.stdout.write(`\r  ${done}/${rows.length} companies`);
  }
  console.log(`\n  ✓ ${done} companies imported`);

  // Log sync
  await supabase.from('sync_log').insert({ source: 'css_companies', records: done, status: 'success' });
  return true;
}

async function importNDs() {
  console.log('\n── Importing nominee directors...');
  const ndPersons = JSON.parse(fs.readFileSync(path.join(DATA, 'nd_from_individuals.json'), 'utf8'));

  // 1. Upsert ND persons
  const ndRows = ndPersons
    .filter(p => p.memberId)   // skip ZHANG YAN (no member ID)
    .map(p => ({ name: p.ndName, member_id: String(p.memberId) }));

  ndRows.push({ name: 'ZHANG YAN', member_id: null });  // include without member ID

  const { error: ndErr } = await supabase
    .from('nominee_directors')
    .upsert(ndRows, { onConflict: 'name' });
  if (ndErr) { console.error('  Error:', ndErr.message); return false; }
  console.log(`  ✓ ${ndRows.length} nominee directors`);

  // 2. Fetch ND IDs
  const { data: ndRecords } = await supabase.from('nominee_directors').select('id, name');
  const ndIdMap = Object.fromEntries(ndRecords.map(r => [r.name, r.id]));

  // 3. Delete existing appointments and re-insert (clean slate)
  await supabase.from('nd_appointments').delete().neq('id', 0);

  // 4. Insert appointments
  const apptRows = [];
  ndPersons.forEach(person => {
    const ndId = ndIdMap[person.ndName];
    if (!ndId) return;
    person.appointments.forEach(appt => {
      apptRows.push({
        nd_id:            ndId,
        company_name:     appt.companyName,
        sub_role:         appt.subRole || null,
        appointment_date: parseDate(appt.appointmentDate),
        cessation_date:   parseDate(appt.cessationDate) || null,
      });
    });
  });

  let done = 0;
  for (let i = 0; i < apptRows.length; i += 100) {
    const batch = apptRows.slice(i, i + 100);
    const { error } = await supabase.from('nd_appointments').insert(batch);
    if (error) { console.error('  Error:', error.message); return false; }
    done += batch.length;
    process.stdout.write(`\r  ${done}/${apptRows.length} appointments`);
  }
  console.log(`\n  ✓ ${done} ND appointments imported`);

  await supabase.from('sync_log').insert({ source: 'nd_appointments', records: done, status: 'success' });
  return true;
}

async function main() {
  console.log('Tassure Invoice — Supabase Data Import');
  console.log(`URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  const ok1 = await importCompanies();
  const ok2 = await importNDs();

  if (ok1 && ok2) {
    console.log('\n✅ Import complete! Data is now in Supabase.');
  } else {
    console.log('\n⚠️  Import finished with errors. Check messages above.');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
