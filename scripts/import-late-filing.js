/**
 * Import Late Filing Companies from the Excel tracking sheet.
 * Run AFTER creating the table in Supabase SQL Editor.
 * Usage: node scripts/import-late-filing.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

// Data extracted from "Late Filing Companies" Excel (Updated 09/02/2026)
const COMPANIES = [
  {
    company_name: 'CO-OPERATE ASSOCIATES PTE LTD',
    uen: '199302620Z',
    financial_year_end: 'JAN',
    last_annual_return_date: '2026-01-07',
    last_agm_date:           '2026-01-05',
    last_accounts_date:      '2023-01-31',
    next_agm_due_date:       '2024-07-31',
    remarks: null,
  },
  {
    company_name: 'EK DERMA LAB PTE. LTD.',
    uen: '201732706D',
    financial_year_end: 'JAN',
    last_annual_return_date: '2026-01-14',
    last_agm_date:           '2026-01-08',
    last_accounts_date:      '2024-01-31',
    next_agm_due_date:       '2025-07-31',
    remarks: null,
  },
  {
    company_name: 'VISTACHEM SINGAPORE (PTE. LTD.)',
    uen: '200903884C',
    financial_year_end: 'JAN',
    last_annual_return_date: '2026-01-14',
    last_agm_date:           '2026-01-09',
    last_accounts_date:      '2024-01-31',
    next_agm_due_date:       '2025-07-31',
    remarks: null,
  },
  {
    company_name: 'ADVANCE BRIGHT GLOBAL PTE. LTD.',
    uen: '201611291N',
    financial_year_end: 'MAR',
    last_annual_return_date: '2021-10-01',
    last_agm_date:           '2021-09-30',
    last_accounts_date:      '2021-03-31',
    next_agm_due_date:       '2022-09-30',
    remarks: 'ACRA STRIKE OFF',
  },
  {
    company_name: 'FULLRICH INTERNATIONAL PTE LTD',
    uen: '201505819K',
    financial_year_end: 'MAR',
    last_annual_return_date: '2021-10-01',
    last_agm_date:           '2021-09-30',
    last_accounts_date:      '2021-03-31',
    next_agm_due_date:       '2022-09-30',
    remarks: 'ACRA STRIKE OFF',
  },
  {
    company_name: 'SILVER RIVER TECHNOLOGY PTE. LTD.',
    uen: '202215861Z',
    financial_year_end: 'MAR',
    last_annual_return_date: null,
    last_agm_date:           null,
    last_accounts_date:      null,
    next_agm_due_date:       '2023-09-30',
    remarks: 'STRIKE OFF - CLIENT LODGED OBJECTION',
  },
  {
    company_name: 'ALTSTAKE PTE. LTD.',
    uen: '202120143G',
    financial_year_end: 'MAY',
    last_annual_return_date: '2024-12-31',
    last_agm_date:           '2024-11-30',
    last_accounts_date:      '2024-05-31',
    next_agm_due_date:       '2025-11-30',
    remarks: null,
  },
  {
    company_name: 'ALTSTAKE TECHNOLOGY PTE. LTD.',
    uen: '202120801R',
    financial_year_end: 'MAY',
    last_annual_return_date: '2024-12-31',
    last_agm_date:           '2024-11-30',
    last_accounts_date:      '2024-05-31',
    next_agm_due_date:       '2025-11-30',
    remarks: null,
  },
  {
    company_name: 'MITRADE GROUP PTE. LTD.',
    uen: '201917375R',
    financial_year_end: 'JUN',
    last_annual_return_date: '2025-02-28',
    last_agm_date:           '2025-02-27',
    last_accounts_date:      '2024-06-30',
    next_agm_due_date:       '2025-12-31',
    remarks: null,
  },
  {
    company_name: 'DING WEI FANG LLP',
    uen: 'T16LL1159L',
    financial_year_end: 'DEC',
    last_annual_return_date: null,
    last_agm_date:           null,
    last_accounts_date:      null,
    next_agm_due_date:       null,
    remarks: null,
  },
  {
    company_name: 'FAITH CAPITAL GLOBAL FUND VCC',
    uen: 'T21VC0076J',
    financial_year_end: 'DEC',
    last_annual_return_date: '2024-09-25',
    last_agm_date:           '2024-08-29',
    last_accounts_date:      '2023-12-31',
    next_agm_due_date:       '2025-06-30',
    remarks: null,
  },
  {
    company_name: 'INVENTA PROJECTS PTE. LTD.',
    uen: '201207873D',
    financial_year_end: 'DEC',
    last_annual_return_date: '2022-07-20',
    last_agm_date:           '2022-06-30',
    last_accounts_date:      '2016-12-31',
    next_agm_due_date:       '2018-06-30',
    remarks: 'ACRA STRIKE OFF - CLIENT LODGED OBJECTION',
  },
  {
    company_name: 'INVENTA TECHNOLOGIES PTE. LTD.',
    uen: '200401271W',
    financial_year_end: 'DEC',
    last_annual_return_date: '2020-11-27',
    last_agm_date:           '2020-11-16',
    last_accounts_date:      '2018-12-31',
    next_agm_due_date:       '2020-06-30',
    remarks: null,
  },
  {
    company_name: 'JETONE GLOBAL FREIGHT(S) PTE. LTD.',
    uen: '202246024R',
    financial_year_end: 'DEC',
    last_annual_return_date: '2024-09-27',
    last_agm_date:           '2024-06-30',
    last_accounts_date:      '2023-12-31',
    next_agm_due_date:       '2025-06-30',
    remarks: null,
  },
  {
    company_name: 'LAVARA HOLDINGS PTE. LTD. (F.K.A. LANGE COMMUNICATION)',
    uen: '200415586M',
    financial_year_end: 'DEC',
    last_annual_return_date: '2020-11-26',
    last_agm_date:           '2019-07-31',
    last_accounts_date:      '2017-12-31',
    next_agm_due_date:       '2019-06-30',
    remarks: 'ACRA STRIKE OFF - CLIENT LODGED OBJECTION',
  },
  {
    company_name: 'MEGASTAR SHIPPING PTE LTD',
    uen: '196600442Z',
    financial_year_end: 'DEC',
    last_annual_return_date: '2025-02-28',
    last_agm_date:           '2025-02-26',
    last_accounts_date:      '2023-12-31',
    next_agm_due_date:       '2025-06-30',
    remarks: null,
  },
];

async function run() {
  console.log(`Importing ${COMPANIES.length} late filing companies…`);

  const { error } = await sb
    .from('late_filing_companies')
    .upsert(COMPANIES, { onConflict: 'uen', ignoreDuplicates: false });

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${COMPANIES.length} companies imported into late_filing_companies`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
