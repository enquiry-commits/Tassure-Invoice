/**
 * Billing draft accuracy validation.
 *
 * Ground-truth test of the "clone last year's invoice → predict this year"
 * billing logic. For every active CSS client with two or more real annual
 * renewal invoices (Corporate Secretarial retainer >= S$300, >180 days apart),
 * it treats the latest as the actual outcome and the prior one as the basis a
 * draft would be cloned from, then measures per-service year-over-year
 * stability. Re-run after any change to the draft-generation logic.
 *
 *   node scripts/validate-billing-accuracy.js
 *
 * Baseline (2026-07): Secretary 85% identical / ~99% within 5%, Address 95%,
 * XBRL amount 100% stable but presence volatile, AR billed separately (flat
 * S$60 always added by the system), ND volatile — must be human-reviewed.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function norm(s) {
  return (s ?? '').toLowerCase()
    .replace(/\(fka\b[^)]*\)/gi, '').replace(/\(f\.k\.a\.[^)]*\)/gi, '')
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '').replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '').replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&@]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function pageAll(makeQuery) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data } = await makeQuery().range(from, from + 999);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function bucket(ps) {
  ps = ps || '';
  if (/Corporate Secretarial Services|Deferred Revenue - Corp Sec/i.test(ps)) return 'Secretary';
  if (/Registered Address Services|Deferred Revenue - Reg Addr/i.test(ps)) return 'Address';
  if (/Government fee for filing Annual Return/i.test(ps)) return 'AR';
  if (/Company XBRL Services/i.test(ps) && !/DO NOT USE/i.test(ps)) return 'XBRL';
  if (/Nominee Director Fees|Deferred Revenue - ND/i.test(ps)) return 'ND';
  if (/Discount Given/i.test(ps)) return 'Discount';
  return 'Other';
}

(async () => {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 40);
  const { data: comp } = await sb.from('companies')
    .select('company_name').eq('client_type', 'CSS Client').eq('tw_status', 'Active');
  const all = await pageAll(() => sb.from('quickbooks_invoice_items')
    .select('customer_name, invoice_no, txn_date, product_service, amount')
    .gte('txn_date', cutoff.toISOString().slice(0, 10)));

  const byC = new Map();
  for (const it of all) {
    const n = norm(it.customer_name);
    if (!byC.has(n)) byC.set(n, new Map());
    const m = byC.get(n);
    if (!m.has(it.invoice_no)) m.set(it.invoice_no, { d: it.txn_date, lines: [] });
    m.get(it.invoice_no).lines.push(it);
  }
  const bmap = inv => {
    const m = {};
    for (const l of inv.lines) m[bucket(l.product_service)] = (m[bucket(l.product_service)] || 0) + (+l.amount || 0);
    return m;
  };
  const isRealRenewal = inv => inv.lines
    .filter(l => /Corporate Secretarial Services|Deferred Revenue - Corp Sec/i.test(l.product_service || ''))
    .reduce((a, l) => a + (+l.amount || 0), 0) >= 300;

  const svcs = ['Secretary', 'Address', 'XBRL', 'AR', 'ND'];
  const stat = {};
  svcs.forEach(s => (stat[s] = { both: 0, same: 0, close: 0, diff: 0, onlyActual: 0, onlyBasis: 0 }));
  let nPairs = 0;

  for (const co of comp) {
    const m = byC.get(norm(co.company_name));
    if (!m) continue;
    const rens = [...m.values()].filter(isRealRenewal).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    if (rens.length < 2) continue;
    if ((new Date(rens[0].d) - new Date(rens[1].d)) / 86400000 < 180) continue;
    nPairs++;
    const A = bmap(rens[0]), B = bmap(rens[1]);
    for (const s of svcs) {
      const a = Math.abs(A[s] || 0) > 0.5, b = Math.abs(B[s] || 0) > 0.5;
      if (a && b) {
        stat[s].both++;
        const d = Math.abs((A[s] || 0) - (B[s] || 0));
        if (d < 0.5) stat[s].same++;
        else if (d <= Math.abs(A[s]) * 0.05 + 0.5) stat[s].close++;
        else stat[s].diff++;
      } else if (a && !b) stat[s].onlyActual++;
      else if (!a && b) stat[s].onlyBasis++;
    }
  }

  console.log('REAL annual-renewal pairs (Corp Sec >= S$300, >180d apart):', nPairs, '\n');
  console.log('service   | both | same amt  | within5% | changed | added | dropped');
  for (const s of svcs) {
    const x = stat[s], p = n => String(n).padStart(4);
    const pct = x.both ? Math.round((x.same) / x.both * 100) : 0;
    console.log(`${s.padEnd(9)} | ${p(x.both)} | ${p(x.same)} (${String(pct).padStart(2)}%) | ${p(x.close)}     | ${p(x.diff)}    | ${p(x.onlyActual)}  | ${p(x.onlyBasis)}`);
  }
})();
