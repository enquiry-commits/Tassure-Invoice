/**
 * One-time cleanup: 72 soa_owners rows recorded soa_pic="Tey Shemin", every
 * one written by the same 2026-09-07 backfill@internal script, never
 * touched by a real human since. Cross-checked each against the MOST
 * RECENT real QuickBooks invoice Class for that exact (customer, qb_company)
 * — 44 are still genuinely her (real Class confirms it), 9 have no Class
 * evidence either way (all TAC), and 19 are directly CONTRADICTED by real,
 * dated invoice evidence naming someone else entirely (e.g. Iuiga
 * New/One/Retail Chain/Retail Management/Retail/Technologies Pte. Ltd. on
 * TAO all show real Class="Lee Jing Fei" on invoices as recent as
 * 2026-08-24, never Shemin) — a real staffing handoff that the backfill
 * record was never updated for, still masking the correct answer today
 * because a manual override always wins over the (correctly computed)
 * suggested owner.
 *
 * Found 2026-09-17 after Vincent forwarded a real WhatsApp exchange
 * ("shemin 还在tao？" / "可是她这些在tao 都是有tao 的pic 的") questioning
 * exactly this pattern on the TAO A/R Ageing export.
 *
 * Deletes ONLY the 19 contradicted rows (hardcoded ids below, from the
 * audit — not a live re-scan, so this script's effect is fixed and
 * reviewable). Safe to re-run (idempotent: nothing left to delete on a
 * second run).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// (qb_company, customer_name) pairs confirmed contradicted by real invoice
// Class data — see this file's own header comment for the audit method.
const CONTRADICTED = [
  { qb_company: 'TAB', customer_name: 'Iuiga Technologies Pte. Ltd.' },
  { qb_company: 'TAB', customer_name: 'Man Sang Resources Pte Ltd' },
  { qb_company: 'TAB', customer_name: 'Megastar Logistics Pte. Ltd.' },
  { qb_company: 'TAB', customer_name: 'Minyotech Pte. Ltd.' },
  { qb_company: 'TAB', customer_name: 'Novozee Pte Ltd' },
  { qb_company: 'TAB', customer_name: 'Racingme Information Technology Pte Ltd' },
  { qb_company: 'TAB', customer_name: 'SFS Care Pte. Ltd.' },
  { qb_company: 'TAB', customer_name: 'SLM7249 Pte Ltd' },
  { qb_company: 'TAO', customer_name: 'Chronoai Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Huixiang Global Logistics Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Iuiga New Retail Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Iuiga One Retail Pte Ltd' },
  { qb_company: 'TAO', customer_name: 'Iuiga Retail Chain Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Iuiga Retail Management Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Iuiga Retail Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Iuiga Technologies Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Man Sang Resources Pte Ltd' },
  { qb_company: 'TAO', customer_name: 'Novozee Pte. Ltd.' },
  { qb_company: 'TAO', customer_name: 'Shaowen Global Supply Chain Pte. Ltd.' },
];

(async () => {
  let totalDeleted = 0;
  for (const { qb_company, customer_name } of CONTRADICTED) {
    const { data: before } = await sb.from('soa_owners').select('id, soa_pic, updated_by_email')
      .eq('qb_company', qb_company).eq('customer_name', customer_name);
    const stillShemin = (before ?? []).filter(r => (r.soa_pic || '').toLowerCase().includes('shemin') && r.updated_by_email === 'backfill@internal');
    if (!stillShemin.length) {
      console.log(`${qb_company} | ${customer_name}: nothing to delete (already clean or changed since audit).`);
      continue;
    }
    const { error, count } = await sb.from('soa_owners').delete({ count: 'exact' }).in('id', stillShemin.map(r => r.id));
    if (error) { console.error(`FAILED ${qb_company}/${customer_name}:`, error.message); continue; }
    console.log(`${qb_company} | ${customer_name}: deleted ${count} row(s).`);
    totalDeleted += count ?? 0;
  }
  console.log(`\nDone. Total rows deleted: ${totalDeleted}.`);
})().catch(e => { console.error(e); process.exit(1); });
