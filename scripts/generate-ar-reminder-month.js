/**
 * One-off variant of generate-ar-reminder.js: generates ar_reminder rows for
 * a SPECIFIC month/year (not the rolling window), using the same logic —
 * same company filter (is_active=true, tw_status not Striking Off/Terminated),
 * same due_date = FYE + 7 months formula. Only inserts missing rows.
 *
 * Usage: node scripts/generate-ar-reminder-month.js <Month> <Year> [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EXCLUDED_STATUSES = ['Striking Off', 'Terminated'];

function lastDayOfMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}
function toDateStr(d) { return d.toISOString().slice(0, 10); }
function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

async function main() {
  const monthArg = process.argv[2];
  const yearArg = parseInt(process.argv[3], 10);
  const monthIndex0 = MONTH_NAMES.indexOf(monthArg);
  if (monthIndex0 === -1 || !yearArg) {
    console.error('Usage: node scripts/generate-ar-reminder-month.js <Month> <Year> [--dry-run]');
    process.exit(1);
  }

  const { data: companies, error } = await sb
    .from('companies')
    .select('company_name, registration_no, fye_month, pic, is_active, tw_status')
    .eq('is_active', true)
    .not('tw_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`);
  if (error) { console.error(error); process.exit(1); }

  const matching = companies.filter(c => c.fye_month === monthArg);

  const { data: existing } = await sb
    .from('ar_reminder')
    .select('entity_name')
    .eq('fye_month', monthArg)
    .eq('fye_year', yearArg);
  const existingNames = new Set((existing ?? []).map(r => r.entity_name));

  const fyeDate = lastDayOfMonth(yearArg, monthIndex0);
  const dueDate = addMonths(fyeDate, 7);

  const toInsert = matching
    .filter(c => !existingNames.has(c.company_name))
    .map(c => ({
      entity_name: c.company_name,
      uen: c.registration_no || '',
      fye_month: monthArg,
      fye_year: yearArg,
      fye_date: toDateStr(fyeDate),
      due_date: toDateStr(dueDate),
      pic: c.pic || '',
    }));

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}${monthArg} ${yearArg}: ${matching.length} companies match FYE, ${existingNames.size} already in ar_reminder, ${toInsert.length} new to insert`);
  toInsert.forEach(r => console.log(`  + ${r.entity_name}`));

  if (toInsert.length && !DRY_RUN) {
    const { error: insErr } = await sb.from('ar_reminder').insert(toInsert);
    if (insErr) { console.error('INSERT ERROR:', insErr.message); process.exit(1); }
    console.log('Insert complete.');
  }
}

main();
