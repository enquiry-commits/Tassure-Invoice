/**
 * Insert 35 companies from screenshot into:
 *   1. companies        — master record (upsert by registration_no)
 *   2. ar_reminder      — AR tracking record for given FYE
 *
 * Usage:
 *   node scripts/insert-35-companies.js               → FYE April 2026
 *   node scripts/insert-35-companies.js March 2026    → FYE March 2026
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const FYE_MONTH = process.argv[2] || 'April';
const FYE_YEAR  = parseInt(process.argv[3] || '2026');

const COMPANIES = [
  { company_name: 'AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING PTE. LTD.', uen: '202320507E' },
  { company_name: 'AFRI S GROUP PTE. LTD.',                               uen: '202526827Z' },
  { company_name: 'BROTH BEYOND SINGAPORE PTE. LTD. (FKA THE DOLLAR SHOP SINGAPORE PTE. LTD.)', uen: '202117339E' },
  { company_name: 'CHINASIN MARINE ENGINEERING PTE. LTD',                 uen: '202521112H' },
  { company_name: 'CHRONOAI PTE. LTD. (FKA AELF PTE. LTD.)',             uen: '201815367H' },
  { company_name: 'CHENG HE CONSTRUCTION PTE. LTD.',                      uen: '202536252N' },
  { company_name: 'DJ BEAUTY TANG PTE. LTD.',                             uen: '202317100G' },
  { company_name: 'ELECTRAMIN INTERNATIONAL PTE. LTD.',                   uen: '202519736W' },
  { company_name: 'GOOHAH SHIPPING PTE. LTD.',                            uen: '202215911K' },
  { company_name: 'GOLDEN LOTUS INFORMATION SERVICE PTE. LTD.',           uen: '202418776H' },
  { company_name: 'HONG YANG DEVELOPMENT PTE. LTD.',                      uen: '201110838G' },
  { company_name: 'HAI RUI PTE. LTD.',                                    uen: '202419688E' },
  { company_name: 'H & W SPA PTE. LTD.',                                  uen: '201523516W' },
  { company_name: 'IHORIZON CONSULTING SINGAPORE PTE. LTD',               uen: '201712019K' },
  { company_name: 'I-LINK TECHNOLOGY PTE. LTD. (f.k.a. HK AIR LOGISTIC SINGAPORE PTE. LTD.)', uen: '201915742K' },
  { company_name: 'INFINITY LINKS PTE. LTD.',                             uen: '202320434R' },
  { company_name: 'JIA JIA FU PTE. LTD.',                                 uen: '201714658K' },
  { company_name: 'JOPHEN INVESTMENT MANAGEMENT PTE. LTD.',               uen: '201815438R' },
  { company_name: 'LOYANG BESTCON TRADING & SERVICES',                    uen: '201916145M' },
  { company_name: 'LIE YANG CONSTRUCTION PTE. LTD.',                      uen: '202217190W' },
  { company_name: 'LYNKORA TECHNOLOGY PTE. LTD.',                         uen: '202522163Z' },
  { company_name: 'MUTUAL SYNERGY TRADING PTE. LTD.',                     uen: '202013163Z' },
  { company_name: 'MERIT BULK PTE. LTD.',                                 uen: '202214878M' },
  { company_name: 'NAJIWAN PTE. LTD.',                                    uen: '202417366C' },
  { company_name: 'OCEANIC APEX SHIPPING PTE. LTD.',                      uen: '202523571E' },
  { company_name: 'QAP LEISURE ASSET HOLDINGS PTE. LTD.',                 uen: '202525381C' },
  { company_name: 'RUICHI INTERNATIONAL TRADING PTE. LTD',                uen: '202319422K' },
  { company_name: 'STARTASTER TECHNOLOGY PTE. LTD.',                      uen: '201312363W' },
  { company_name: 'SNACKING PTE. LTD.',                                   uen: '202014534G' },
  { company_name: 'SUPER MALL PTE. LTD.',                                 uen: '202317699M' },
  { company_name: 'TAIHUA SHIPPING PTE. LTD.',                            uen: '201714802K' },
  { company_name: 'TOUCHSTONE MEDTECH PTE. LTD.',                         uen: '202320811R' },
  { company_name: 'TRILITHON CAPITAL PTE. LTD.',                          uen: '202522838W' },
  { company_name: 'YUAN SOON CONSTRUCTION PTE. LTD.',                     uen: '200202467H' },
  { company_name: 'BAOBABTREE (S) PTE. LTD.',                             uen: '202523505Z' },
];

async function run() {
  console.log(`\nInserting ${COMPANIES.length} companies — FYE ${FYE_MONTH} ${FYE_YEAR}\n`);

  // ── Step 1: Upsert into companies (by registration_no) ─────────────────────
  const companyRows = COMPANIES.map(c => ({
    company_name:    c.company_name,
    registration_no: c.uen,
    fye_month:       FYE_MONTH,
  }));

  // Fetch existing registration_nos to avoid duplicates
  const uens = COMPANIES.map(c => c.uen);
  const { data: existing } = await sb
    .from('companies')
    .select('registration_no')
    .in('registration_no', uens);

  const existingSet = new Set((existing ?? []).map(r => r.registration_no));
  const newRows = companyRows.filter(r => !existingSet.has(r.registration_no));

  if (newRows.length === 0) {
    console.log(`ℹ️  companies: all ${COMPANIES.length} already exist — skipped`);
  } else {
    const { error: compErr } = await sb.from('companies').insert(newRows);
    if (compErr) {
      console.error('companies insert error:', compErr.message);
    } else {
      console.log(`✅ companies: inserted ${newRows.length} new rows (${existingSet.size} already existed)`);
    }
  }

  // ── Step 2: Insert into ar_reminder (skip if already exists) ───────────────
  const arRows = COMPANIES.map(c => ({
    entity_name: c.company_name,
    uen:         c.uen,
    fye_month:   FYE_MONTH,
    fye_year:    FYE_YEAR,
    status:      'Pending',
  }));

  const { error: arErr, count } = await sb
    .from('ar_reminder')
    .upsert(arRows, {
      onConflict:      'entity_name,fye_month,fye_year',
      ignoreDuplicates: true,   // skip if already exists — don't overwrite progress
    });

  if (arErr) {
    console.error('ar_reminder upsert error:', arErr.message);
    process.exit(1);
  }

  console.log(`✅ ar_reminder: upserted ${arRows.length} rows for FYE ${FYE_MONTH} ${FYE_YEAR}`);
  console.log('\nDone. Open the AR Reminder page and select FYE', FYE_MONTH, FYE_YEAR, 'to see them.\n');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
