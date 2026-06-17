// Import QB invoices into Supabase
// Run: node scripts/import-qb-invoices.js
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

function parseQBDate(str) {
  if (!str) return null;
  // Format: "17/3/26" → "2026-03-17"
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day   = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const year  = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${month}-${day}`;
}

async function run() {
  const file = path.join(__dirname, '../data/qb_invoices.json');
  if (!fs.existsSync(file)) {
    console.error('qb_invoices.json not found. Run npm run scrape-qb first.');
    process.exit(1);
  }

  const { invoices, scraped_at } = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Importing ${invoices.length} QB invoices…`);

  const rows = invoices.map(inv => ({
    invoice_no:    inv.invoiceNo || null,
    txn_date:      parseQBDate(inv.txnDate),
    customer_name: inv.customerName || '',
    total_amt:     inv.totalAmt ?? 0,
    balance:       inv.balance ?? 0,
    status:        inv.status || 'Open',
    status_raw:    inv.statusRaw || '',
    scraped_at:    scraped_at,
  }));

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('quickbooks_invoices')
      .upsert(batch, { onConflict: 'invoice_no', ignoreDuplicates: false });
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} error:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`  Upserted ${inserted}/${rows.length}`);
    }
  }

  console.log(`\nDone. ${inserted} invoices in Supabase.`);
}

run().catch(err => { console.error(err); process.exit(1); });
