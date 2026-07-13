// One-time backfill: populate the new generated_invoices table from historical
// synced QB data, so the Billing Drafts "TAB Invoice / TAC Invoice" columns
// show invoice numbers for cycles that were already billed before this
// system's multi-company (TAB/TAC) support existed.
//
// Only backfills invoices that carry a derivable FYE cycle marker (an AR or
// XBRL line with a fye_date or a "dd.mm.yyyy" description marker) — same
// convention already used by the "already invoiced this cycle" check in
// app/api/billing/renewals/route.ts (billedCyclesMap). Invoices without that
// marker (one-off/ad-hoc bills) can't be matched to a cycle, so skipping them
// is a no-op for the UI, not data loss.
//
// All historical rows are qb_company = 'TAB' — TAC was never connected/synced
// before this migration, so no historical TAC invoice data exists.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const COMMIT = process.argv.includes('--commit');

async function pageAll(fn) {
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await fn().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function fyeFromIso(d) {
  const m = d ? String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

async function main() {
  const annualItems = await pageAll(() => sb.from('quickbooks_invoice_items')
    .select('invoice_no, fye_date, description')
    .in('service_type', ['AR', 'XBRL']));

  const cycleByInvoice = new Map();
  for (const it of annualItems) {
    let cycle = fyeFromIso(it.fye_date);
    if (!cycle) {
      const dm = (it.description || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) cycle = `${dm[1]}.${dm[2]}.${dm[3]}`;
    }
    if (cycle && !cycleByInvoice.has(it.invoice_no)) cycleByInvoice.set(it.invoice_no, cycle);
  }

  const allItems = await pageAll(() => sb.from('quickbooks_invoice_items').select('invoice_no, service_type'));
  const servicesByInvoice = new Map();
  for (const it of allItems) {
    if (!it.service_type) continue;
    if (!servicesByInvoice.has(it.invoice_no)) servicesByInvoice.set(it.invoice_no, new Set());
    servicesByInvoice.get(it.invoice_no).add(it.service_type);
  }

  const invoices = await pageAll(() => sb.from('quickbooks_invoices')
    .select('invoice_no, customer_name, total_amt, qb_company, txn_date'));

  const existing = await pageAll(() => sb.from('generated_invoices').select('qb_company, invoice_no'));
  const existingKeys = new Set(existing.map(r => `${r.qb_company}|${r.invoice_no}`));

  const rows = [];
  for (const inv of invoices) {
    const cycle = cycleByInvoice.get(inv.invoice_no);
    if (!cycle) continue;
    const key = `${inv.qb_company}|${inv.invoice_no}`;
    if (existingKeys.has(key)) continue;
    rows.push({
      company_name: inv.customer_name,
      fye_month: null,
      fye_year: +cycle.slice(-4),
      fye_cycle: cycle,
      qb_company: inv.qb_company,
      invoice_no: inv.invoice_no,
      qb_invoice_id: null,
      total_amt: inv.total_amt,
      services: [...(servicesByInvoice.get(inv.invoice_no) ?? [])],
      created_at: inv.txn_date ? `${inv.txn_date}T00:00:00Z` : undefined,
    });
  }

  console.log(`Candidate rows to backfill: ${rows.length} (of ${invoices.length} total historical invoices)`);
  console.log('Sample:', JSON.stringify(rows.slice(0, 3), null, 2));

  if (!COMMIT) {
    console.log('\nDRY RUN — no rows written. Re-run with --commit to insert.');
    return;
  }

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from('generated_invoices').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  console.log(`\nInserted ${inserted} rows into generated_invoices.`);
}
main().catch(e => { console.error(e); process.exit(1); });
