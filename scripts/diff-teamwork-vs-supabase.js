/**
 * Read-only diff: compare Supabase `companies` table against freshly-extracted
 * TeamWork API data (data/teamwork-api/companies-list.json), joined by
 * companies.internal_id === teamwork.company_id.
 *
 * Does NOT write anything. QB-derived fields are intentionally excluded from
 * comparison: has_annual_return, has_agm, has_xbrl, has_accounts, has_tax,
 * has_nd, sec_pic, acc_pic, tax_pic, qb_customer_name, last_invoice_date,
 * is_active, client_type.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function monthName(fyeDate) {
  // fye_date format seen: "31/12" (DD/MM)
  if (!fyeDate) return null;
  const parts = fyeDate.split('/');
  if (parts.length !== 2) return null;
  const mm = parseInt(parts[1], 10);
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[mm - 1] || null;
}

function normEmail(e) {
  return (e || '').trim().toLowerCase() || null;
}

async function main() {
  const { data: companies, error } = await sb.from('companies').select('*');
  if (error) { console.error(error); process.exit(1); }
  console.log(`Loaded ${companies.length} companies from Supabase.`);

  const twList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teamwork-api', 'companies-list.json'), 'utf-8'));
  const twById = new Map(twList.map(c => [c.company_id, c]));
  console.log(`Loaded ${twList.length} companies from TeamWork API extract.`);

  const diffs = {
    no_tw_match: [],
    registration_no: [],
    company_type: [],
    tw_status: [],
    fye_month: [],
    best_email: [],
  };

  for (const c of companies) {
    const tw = twById.get(c.internal_id);
    if (!tw) {
      diffs.no_tw_match.push({ id: c.id, company_name: c.company_name, internal_id: c.internal_id });
      continue;
    }

    if ((c.registration_no || null) !== (tw.company_registration_Num || null)) {
      diffs.registration_no.push({ id: c.id, company_name: c.company_name, current: c.registration_no, tw: tw.company_registration_Num });
    }

    const twType = (tw.type || '').trim() || null;
    if ((c.company_type || null) !== twType) {
      diffs.company_type.push({ id: c.id, company_name: c.company_name, current: c.company_type, tw: twType });
    }

    if ((c.tw_status || null) !== (tw.status || null)) {
      diffs.tw_status.push({ id: c.id, company_name: c.company_name, current: c.tw_status, tw: tw.status });
    }

    const twFyeMonth = monthName(tw.fye_date);
    if (twFyeMonth && (c.fye_month || null) !== twFyeMonth) {
      diffs.fye_month.push({ id: c.id, company_name: c.company_name, current: c.fye_month, tw: twFyeMonth });
    }

    const twEmail = normEmail(tw.company_email_address);
    if (twEmail && normEmail(c.best_email) !== twEmail) {
      diffs.best_email.push({ id: c.id, company_name: c.company_name, current: c.best_email, tw: tw.company_email_address });
    }
  }

  for (const [key, arr] of Object.entries(diffs)) {
    console.log(`\n=== ${key}: ${arr.length} ===`);
    arr.slice(0, 8).forEach(d => console.log(' ', JSON.stringify(d)));
  }

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'teamwork-api', 'diff-report.json'), JSON.stringify(diffs, null, 2));
  console.log('\nFull diff saved to data/teamwork-api/diff-report.json');
}

main();
