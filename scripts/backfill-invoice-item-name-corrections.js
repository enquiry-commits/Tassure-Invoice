/**
 * One-time backfill: app/api/quickbooks/sync/route.ts wrote raw (uncorrected)
 * customer_name into quickbooks_invoice_items for the 5 known mojibake
 * customer ids in lib/quickbooks.ts's CUSTOMER_NAME_CORRECTIONS — the
 * invoice-header table (quickbooks_invoices) already had the fix applied at
 * sync time, this table never did. Fixed going forward in the sync route
 * itself (2026-09-17); this script corrects the already-written rows.
 * Display-name only — never touches amount/balance/date columns. Safe to
 * re-run (idempotent: only updates rows that still hold the raw value).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Mirrors lib/quickbooks.ts's CUSTOMER_NAME_CORRECTIONS verbatim.
const CORRECTIONS = {
  TAC: {
    '362': '吉木锌国际贸易（上海）有限公司',
    '363': '江苏日月照明电器有限公司',
    '366': '俐玛精密测量技术（苏州）有限公司',
    '394': '天马微电子股份有限公司',
  },
  TAO: {
    '1697': '吉木锌国际贸易（上海）有限公司',
  },
};

(async () => {
  let totalUpdated = 0;
  for (const [qbCompany, byCustomerId] of Object.entries(CORRECTIONS)) {
    for (const [qbCustomerId, correctName] of Object.entries(byCustomerId)) {
      const { data: before, error: selErr } = await sb
        .from('quickbooks_invoice_items')
        .select('qb_invoice_id, qb_line_id, customer_name')
        .eq('qb_company', qbCompany)
        .eq('qb_customer_id', qbCustomerId);
      if (selErr) { console.error(`SELECT failed for ${qbCompany}/${qbCustomerId}:`, selErr.message); continue; }

      const stillGarbled = (before ?? []).filter(r => r.customer_name !== correctName);
      if (!stillGarbled.length) {
        console.log(`${qbCompany}/${qbCustomerId} (${correctName}): 0 rows need updating (already correct or none found).`);
        continue;
      }

      const { error: updErr, count } = await sb
        .from('quickbooks_invoice_items')
        .update({ customer_name: correctName }, { count: 'exact' })
        .eq('qb_company', qbCompany)
        .eq('qb_customer_id', qbCustomerId)
        .neq('customer_name', correctName);
      if (updErr) { console.error(`UPDATE failed for ${qbCompany}/${qbCustomerId}:`, updErr.message); continue; }
      console.log(`${qbCompany}/${qbCustomerId} (${correctName}): updated ${count} row(s) (was garbled: ${JSON.stringify(before[0]?.customer_name)}).`);
      totalUpdated += count ?? 0;
    }
  }
  console.log(`\nDone. Total rows corrected: ${totalUpdated}.`);
})().catch(e => { console.error(e); process.exit(1); });
