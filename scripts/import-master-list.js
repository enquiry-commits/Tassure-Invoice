// Import the 4-sheet Master List Excel file into the `master_list` Supabase table.
// Run: node scripts/import-master-list.js
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

const FILE_PATH = 'C:\\Users\\vincent\\Desktop\\Copy of 2022.09.30-Master List (Strike off & Terminated).xlsx';

const SHEET_TO_TYPE = {
  'STRIKE OFF wef 1.9.2019':        'strike_off',
  'TERMINATE SERVICES wef 1.9.2019':'terminated',
  'Change Co name':                 'name_change',
  'INACTIVE OLD RECORD 4.9.2019 ':  'inactive_old',
};

// Column index → DB field name (matches header row order in the source file)
const FIELDS = [
  'update_date', 'internal_code', 'company_name', 'roc_no', 'status',
  'join_date', 'sec_agent', 'kyc_year', 'register_of_controllers', 'corporate_tax',
  'efiling_authorization', 'ac', 'audit', 'gst', 'compil_report', 'cpf_submit',
  'add_here', 'invoice_address', 'mailing_address', 'contact_window', 'mailing_list',
  'email', 'tel', 'inc_date', 'shareholders', 'directors',
  'nominee_director', 'secretary', 'annual_return', 'fye', 'last_ar_date',
  'last_agm_date', 'last_accounts_date', 'next_agm_due_date', 'months_from_last_accounts', 'remark',
  'referral', 'risk_level', 'incorp_with_us', 'acra_update',
];

async function run() {
  const wb = XLSX.readFile(FILE_PATH);

  for (const [sheetName, listType] of Object.entries(SHEET_TO_TYPE)) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) { console.log(`⚠️  Sheet not found: ${sheetName}`); continue; }

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    const rows = data.slice(1); // skip header row

    const records = rows
      .filter(r => r.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))
      .map((r, i) => {
        const rec = { list_type: listType, row_order: i + 1 };
        FIELDS.forEach((field, idx) => {
          const val = r[idx];
          rec[field] = (val === null || val === undefined || String(val).trim() === '') ? null : String(val).trim();
        });
        return rec;
      });

    // Insert in batches of 200
    let inserted = 0, failed = 0;
    for (let i = 0; i < records.length; i += 200) {
      const batch = records.slice(i, i + 200);
      const { error } = await supabase.from('master_list').insert(batch);
      if (error) { console.error(`❌ ${listType} batch ${i}: ${error.message}`); failed += batch.length; }
      else { inserted += batch.length; }
    }
    console.log(`✅ ${listType}: ${inserted} inserted, ${failed} failed (from ${records.length} rows in "${sheetName}")`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
