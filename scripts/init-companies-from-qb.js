/**
 * Initialize company service flags from QB invoice history.
 *
 * For each QB customer with line items, determines which services
 * Tassure has provided them, then upserts into the `companies` table.
 *
 * Also syncs sec_pic / acc_pic / tax_pic from ar_reminder (most recent FYE).
 *
 * Usage: node scripts/init-companies-from-qb.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

// ── Name normalisation for fuzzy matching ─────────────────────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\s*/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\b(s'?pore|singapore)\b/gi, '')
    .replace(/\binternational\b/gi, 'intl')
    .replace(/[().,&@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordOverlap(a, b) {
  const wa = new Set(normalizeName(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normalizeName(b).split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  return common / Math.min(wa.size, wb.size);
}

function bestMatch(qbName, companyRows) {
  let best = null;
  let bestScore = 0;

  for (const c of companyRows) {
    const score = wordOverlap(qbName, c.company_name);
    if (score > bestScore) { bestScore = score; best = c; }
  }

  return bestScore >= 0.7 ? { company: best, score: bestScore } : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Initializing company master from QB data…\n`);

  // 1. Load QB line items grouped by customer
  console.log('Loading QB invoice items from Supabase…');
  const { data: items, error: itemsErr } = await sb
    .from('quickbooks_invoice_items')
    .select('customer_name, service_type, txn_date, invoice_no');

  if (itemsErr) { console.error('Error loading items:', itemsErr.message); process.exit(1); }
  console.log(`  ${items.length} line items loaded`);

  // Aggregate per QB customer
  const byCustomer = new Map();
  for (const item of items) {
    const key = (item.customer_name || '').trim();
    if (!key) continue;
    if (!byCustomer.has(key)) {
      byCustomer.set(key, {
        qbName:    key,
        services:  new Set(),
        lastDate:  null,
        invoices:  new Set(),
      });
    }
    const rec = byCustomer.get(key);
    if (item.service_type) rec.services.add(item.service_type);
    if (item.invoice_no)   rec.invoices.add(item.invoice_no);
    if (item.txn_date && (!rec.lastDate || item.txn_date > rec.lastDate)) {
      rec.lastDate = item.txn_date;
    }
  }
  console.log(`  ${byCustomer.size} unique QB customers found\n`);

  // 2. Load existing companies
  const { data: companies, error: compErr } = await sb.from('companies').select('*');
  if (compErr) { console.error('Error loading companies:', compErr.message); process.exit(1); }
  console.log(`Existing companies in DB: ${companies.length}`);

  // 3. Load latest PIC info from ar_reminder
  const { data: arRows } = await sb
    .from('ar_reminder')
    .select('entity_name, pic, acc_pic, tax_pic, fye_year')
    .order('fye_year', { ascending: false });

  // Keep only the most recent FYE entry per entity
  const picByName = new Map();
  for (const row of (arRows || [])) {
    if (!picByName.has(row.entity_name)) {
      picByName.set(row.entity_name, {
        sec_pic: row.pic || null,
        acc_pic: row.acc_pic || null,
        tax_pic: row.tax_pic || null,
      });
    }
  }

  // 4. Match each QB customer → company, build update payload
  const toUpdate  = [];
  const toInsert  = [];
  const unmatched = [];

  for (const [qbName, rec] of byCustomer) {
    const svc = rec.services;

    const serviceFlags = {
      has_annual_return: svc.has('AR')        || true,   // always true for corp sec clients
      has_agm:           svc.has('AGM')       || true,
      has_xbrl:          svc.has('XBRL'),
      has_accounts:      svc.has('Accounts'),
      has_tax:           svc.has('Tax'),
      has_nd:            svc.has('ND'),
      uses_address:      svc.has('Address'),
      qb_customer_name:  qbName,
      last_invoice_date: rec.lastDate || null,
      is_active:         true,
    };

    const match = bestMatch(qbName, companies);

    if (match) {
      // Find PIC info — try QB-matched company name or original entity names
      const picLookup = picByName.get(match.company.company_name)
        || [...picByName.entries()].find(([k]) => wordOverlap(k, qbName) >= 0.7)?.[1]
        || {};

      toUpdate.push({
        id: match.company.id,
        ...serviceFlags,
        sec_pic: picLookup.sec_pic || match.company.sec_pic || null,
        acc_pic: picLookup.acc_pic || match.company.acc_pic || null,
        tax_pic: picLookup.tax_pic || match.company.tax_pic || null,
        _matchScore: match.score,
        _matchedTo:  match.company.company_name,
      });
    } else {
      // Try to find PIC from ar_reminder by name similarity
      const picEntry = [...picByName.entries()].find(([k]) => wordOverlap(k, qbName) >= 0.7);
      const picInfo = picEntry?.[1] || {};

      toInsert.push({
        company_name: qbName,  // use QB name as fallback; can be corrected manually
        ...serviceFlags,
        sec_pic: picInfo.sec_pic || null,
        acc_pic: picInfo.acc_pic || null,
        tax_pic: picInfo.tax_pic || null,
      });
      unmatched.push(qbName);
    }
  }

  console.log(`\nMatched: ${toUpdate.length} | New: ${toInsert.length} | Unmatched: ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('\nUnmatched QB customers (will be inserted as new companies):');
    unmatched.forEach(n => console.log(`  - ${n}`));
  }

  // 5. Apply updates
  if (!DRY_RUN) {
    let updated = 0;
    for (const rec of toUpdate) {
      const { id, _matchScore, _matchedTo, ...payload } = rec;
      const { error } = await sb.from('companies').update(payload).eq('id', id);
      if (error) {
        console.error(`  ✗ update ${_matchedTo}: ${error.message}`);
      } else {
        updated++;
        if (updated <= 5 || updated % 10 === 0) {
          console.log(`  ✓ ${_matchedTo} (score ${(_matchScore * 100).toFixed(0)}%)`);
        }
      }
    }
    console.log(`\nUpdated ${updated} existing companies.`);

    // Insert new companies
    if (toInsert.length > 0) {
      const { error } = await sb.from('companies').insert(toInsert);
      if (error) {
        console.error(`  ✗ insert new companies: ${error.message}`);
      } else {
        console.log(`Inserted ${toInsert.length} new companies.`);
      }
    }
  } else {
    console.log('\n[DRY RUN] No DB writes. Pass without --dry-run to apply.');

    console.log('\nSample updates (first 5):');
    toUpdate.slice(0, 5).forEach(r => {
      console.log(`  ${r._matchedTo} → xbrl:${r.has_xbrl} nd:${r.has_nd} acc:${r.has_accounts} tax:${r.has_tax}`);
    });
  }

  console.log('\n✅ Done.');

  // Summary of service distribution
  const summary = { AR: 0, AGM: 0, XBRL: 0, ND: 0, Address: 0, Accounts: 0, Tax: 0, Audit: 0, Secretary: 0 };
  [...byCustomer.values()].forEach(rec => {
    rec.services.forEach(s => { if (summary[s] !== undefined) summary[s]++; });
  });
  console.log('\nService distribution across QB customers:');
  Object.entries(summary).forEach(([k, v]) => console.log(`  ${k.padEnd(12)}: ${v} companies`));
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
