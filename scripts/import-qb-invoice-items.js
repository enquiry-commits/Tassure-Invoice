/**
 * Import QB invoice line items → Supabase quickbooks_invoice_items
 * Run after: node scripts/scrape-qb-invoices.js --line-items
 *
 * Usage: node scripts/import-qb-invoice-items.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const TARGETED = process.argv.includes('--targeted');
const ITEMS_FILE = TARGETED
  ? path.join(__dirname, '../data/qb_targeted_items.json')
  : path.join(__dirname, '../data/qb_invoice_items.json');

function parseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  // DD/MM/YY or D/M/YY
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2, '0');
    const mo = m1[2].padStart(2, '0');
    const y = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${y}-${mo}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

async function run() {
  if (!fs.existsSync(ITEMS_FILE)) {
    console.error('qb_invoice_items.json not found.');
    console.error('Run: node scripts/scrape-qb-invoices.js --line-items');
    process.exit(1);
  }

  const { items, scraped_at } = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf-8'));
  console.log(`Importing ${items.length} line items…`);

  // Filter out items with no invoice_no (can't upsert without unique key)
  const valid = items.filter(i => i.invoiceNo && i.lineNum);
  console.log(`  ${valid.length} have invoice_no + line_num (${items.length - valid.length} skipped)`);

  // Deduplicate by invoice_no + line_num (multiple scrape runs may produce duplicates)
  const seen = new Set();
  const deduped = valid.filter(i => {
    const key = `${i.invoiceNo}_${i.lineNum}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < valid.length) console.log(`  Deduped: ${valid.length - deduped.length} duplicates removed → ${deduped.length} unique items`);

  const rows = deduped.map(i => ({
    invoice_no:      i.invoiceNo || null,
    qb_invoice_id:   i.qbInvoiceId || null,
    customer_name:   i.customerName || '',
    txn_date:        parseDate(i.txnDate),
    line_num:        i.lineNum,
    description:     i.description || null,
    product_service: i.productService || null,
    qty:             i.qty != null ? Number(i.qty) : null,
    rate:            i.rate != null ? Number(i.rate) : null,
    amount:          i.amount != null ? Number(i.amount) : null,
    service_type:    i.serviceType || 'Other',
    scraped_at:      scraped_at || new Date().toISOString(),
  }));

  let upserted = 0;
  const BATCH = 200;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from('quickbooks_invoice_items')
      .upsert(batch, { onConflict: 'invoice_no,line_num', ignoreDuplicates: false });

    if (error) {
      console.error(`  ✗ Batch ${i}–${i + batch.length}: ${error.message}`);
    } else {
      upserted += batch.length;
      process.stdout.write(`\r  Inserted ${upserted}/${rows.length}…`);
    }
  }

  console.log(`\n✅ Done — ${upserted} line items in quickbooks_invoice_items`);

  // Show service type distribution
  const dist = {};
  rows.forEach(r => { dist[r.service_type] = (dist[r.service_type] || 0) + 1; });
  console.log('\nService type distribution:');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(12)}: ${count}`);
  });
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
