/**
 * Fixes the column-misalignment in Inactive Old Record rows 226-232
 * (master_list ids 750-756). Rows 750-755 were imported shifted one column
 * to the LEFT (internal code landed in update_date, company name in
 * internal_code, UEN in company_name, ...). Verified against id 748 (the
 * same company PETRAM, correctly stored): a uniform shift-right-by-1 across
 * the full column order restores every field to the correct place.
 *
 * id 756 (UNITED CHURCH LTD.) is scrambled more severely (an address landed
 * in corporate_tax, names in add_here, etc.) — reconstructed explicitly by
 * field type, with a remark flagging it for human verification.
 *
 * Usage: node scripts/fix-inactive-old-misalignment.js [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const APPLY = process.argv.includes('--apply');

// Canonical column order (matches the source spreadsheet / UI table order).
const COLS = [
  'update_date','internal_code','company_name','roc_no','status','join_date','sec_agent','kyc_year',
  'register_of_controllers','corporate_tax','efiling_authorization','ac','audit','gst','compil_report','cpf_submit',
  'add_here','invoice_address','mailing_address','contact_window','mailing_list','email','tel','inc_date',
  'shareholders','directors','nominee_director','secretary','annual_return','fye',
  'last_ar_date','last_agm_date','last_accounts_date','next_agm_due_date','months_from_last_accounts',
  'remark','referral','risk_level','incorp_with_us','acra_update','mas','grade',
];

// Shift every value one column to the RIGHT within COLS; update_date becomes null.
function shiftRight(row) {
  const out = {};
  for (let i = COLS.length - 1; i >= 1; i--) out[COLS[i]] = row[COLS[i - 1]] ?? null;
  out[COLS[0]] = null;
  return out;
}

// Explicit reconstruction for the badly-scrambled UNITED CHURCH row (id 756).
const UNITED_CHURCH = {
  update_date: null,
  internal_code: 'CU003',
  company_name: 'UNITED CHURCH LTD.',
  roc_no: '201331588G',
  status: null,
  join_date: null,
  sec_agent: null,
  kyc_year: null,
  register_of_controllers: null,
  corporate_tax: null,
  efiling_authorization: null,
  ac: null, audit: null, gst: null, compil_report: null, cpf_submit: null,
  add_here: null,
  invoice_address: '1 COMMONWEALTH LANE #06-31 ONE COMMONWEALTH SINGAPORE 149544',
  mailing_address: null,
  contact_window: 'chuan ping',
  mailing_list: null,
  email: 'chuanping.zhong@gmail.com',
  tel: null,
  inc_date: '11/22/13',
  shareholders: 'LI YINGJIU',
  directors: 'SEAH KWEE HONG, LI YINGJIU, CHIN WAI MAN RAYMOND',
  nominee_director: null,
  secretary: null,
  annual_return: null,
  fye: 'JUN',
  last_ar_date: '24/03/2020',
  last_agm_date: '20/03/2020',
  last_accounts_date: '31/12/2020',
  next_agm_due_date: '30/06/2019',
  months_from_last_accounts: null,
  remark: 'AUTO-FIX 2026-07: source columns were badly misaligned; date fields reconstructed by best-guess — please verify.',
  referral: null, risk_level: null, incorp_with_us: null, acra_update: null, mas: null, grade: null,
};

const KEY = ['internal_code','company_name','roc_no','status','join_date','sec_agent','kyc_year','invoice_address','contact_window','email','tel','inc_date','shareholders','directors','nominee_director','secretary','annual_return','fye','last_ar_date','last_agm_date','last_accounts_date','next_agm_due_date','incorp_with_us','acra_update'];

async function main() {
  const { data: rows } = await sb.from('master_list').select('*').in('id', [750,751,752,753,754,755,756]).order('id');

  for (const row of rows) {
    const fixed = row.id === 756 ? UNITED_CHURCH : shiftRight(row);
    console.log(`\n===== id=${row.id}  (${fixed.company_name || row.company_name}) =====`);
    for (const k of KEY) {
      const before = row[k] ?? '';
      const after = fixed[k] ?? '';
      if (String(before) !== String(after)) console.log(`  ${k.padEnd(24)} ${JSON.stringify(before).slice(0,40).padEnd(42)} ->  ${JSON.stringify(after)}`);
    }
    if (APPLY) {
      const { error } = await sb.from('master_list').update({ ...fixed, updated_at: new Date().toISOString() }).eq('id', row.id);
      if (error) console.error('  ERROR:', error.message);
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (pass --apply to write)'}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
