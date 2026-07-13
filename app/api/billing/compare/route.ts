import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { thisYearSGT } from '@/lib/date';
import { normalize, matchScore } from '@/lib/company-name';


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year   = searchParams.get('year') ?? thisYearSGT().toString();
  const type   = searchParams.get('type') ?? 'all';
  const status = searchParams.get('status') ?? 'all'; // NOT_BILLED | PAID | INVOICED_UNPAID | all

  const supabase = createAdminClient();

  // ── QB invoices for the year ──────────────────────────────────────────────
  const { data: invoices, error: invErr } = await supabase
    .from('quickbooks_invoices')
    .select('invoice_no, txn_date, customer_name, total_amt, balance, status')
    .gte('txn_date', `${year}-01-01`)
    .lte('txn_date', `${year}-12-31`);
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // ── Companies with service flags ──────────────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, company_name, has_annual_return, has_agm, has_xbrl, has_nd, has_accounts, has_tax, uses_address, is_active, fye_month, pic')
    .eq('is_active', true);
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  // ── AR reminder workflow data (for filing status) ─────────────────────────
  const { data: arRows } = await supabase
    .from('ar_reminder')
    .select('entity_name, fye_month, fye_year, ar_status, filling_date, due_date');

  // Build lookup: normalized company name → AR record
  const arLookup = new Map<string, typeof arRows extends (infer T)[] | null ? T : never>();
  for (const row of arRows ?? []) {
    if (row.entity_name) arLookup.set(normalize(row.entity_name), row);
  }

  // Pre-index QB invoices by normalized customer name for fast lookup
  const invoicesByNorm = new Map<string, typeof invoices extends (infer T)[] | null ? T[] : never[]>();
  for (const inv of invoices ?? []) {
    const n = normalize(inv.customer_name);
    if (!invoicesByNorm.has(n)) invoicesByNorm.set(n, []);
    invoicesByNorm.get(n)!.push(inv);
  }

  // ── Build results ─────────────────────────────────────────────────────────
  const results = (companies ?? []).map(company => {
    const normName = normalize(company.company_name);

    // Service flags (from companies master — initialized by QB history)
    const hasAR      = company.has_annual_return === true;
    const hasAGM     = company.has_agm           === true;
    const hasXBRL    = company.has_xbrl          === true;
    const hasND      = company.has_nd            === true;
    const hasAcct    = company.has_accounts      === true;
    const hasTax     = company.has_tax           === true;
    const hasAddress = company.uses_address      === true;

    // Filter by service type
    if (type === 'ar'      && !hasAR)      return null;
    if (type === 'agm'     && !hasAGM)     return null;
    if (type === 'nd'      && !hasND)      return null;
    if (type === 'address' && !hasAddress) return null;
    if (type === 'accounts'&& !hasAcct)    return null;
    if (type === 'tax'     && !hasTax)     return null;

    // Match QB invoices by name (exact first, then fuzzy)
    let invoiceList = invoicesByNorm.get(normName) ?? [];
    if (invoiceList.length === 0) {
      // Fuzzy fallback — scan all invoices
      invoiceList = (invoices ?? [])
        .map(inv => ({ inv, score: matchScore(company.company_name, inv.customer_name) }))
        .filter(m => m.score >= 70)
        .sort((a, b) => b.score - a.score)
        .map(m => m.inv);
    }

    const hasPaid = invoiceList.some(i => i.status === 'Paid');
    const hasOpen = invoiceList.some(i => i.status === 'Open' || i.status === 'Overdue');
    const totalBilled = invoiceList.reduce((s, i) => s + (i.total_amt ?? 0), 0);

    let billingStatus: 'NOT_BILLED' | 'PAID' | 'INVOICED_UNPAID' | 'UNKNOWN';
    if      (invoiceList.length === 0) billingStatus = 'NOT_BILLED';
    else if (hasPaid)                  billingStatus = 'PAID';
    else if (hasOpen)                  billingStatus = 'INVOICED_UNPAID';
    else                               billingStatus = 'UNKNOWN';

    // Filter by billing status
    if (status !== 'all' && billingStatus !== status) return null;

    // AR workflow status from ar_reminder
    const arRecord = arLookup.get(normName)
      ?? arRows?.find(r => r.entity_name && matchScore(company.company_name, r.entity_name) >= 70);

    const arFiled  = !!(arRecord?.filling_date || arRecord?.ar_status === 'Yes');

    return {
      companyId:    company.id,
      companyName:  company.company_name,
      fye:          company.fye_month ?? '—',
      pic:          company.pic ?? null,
      services: { ar: hasAR, agm: hasAGM, xbrl: hasXBRL, nd: hasND, accounts: hasAcct, tax: hasTax, address: hasAddress },
      arFiled,
      arDueDate:   arRecord?.due_date ?? null,
      billingStatus,
      invoiceCount: invoiceList.length,
      totalBilled,
      invoices:     invoiceList.slice(0, 10),
    };
  }).filter(Boolean);

  const all = results as NonNullable<typeof results[0]>[];

  const summary = {
    year, type,
    total:          all.length,
    notBilled:      all.filter(r => r.billingStatus === 'NOT_BILLED').length,
    paid:           all.filter(r => r.billingStatus === 'PAID').length,
    invoicedUnpaid: all.filter(r => r.billingStatus === 'INVOICED_UNPAID').length,
    totalRevenue:   all.reduce((s, r) => s + r.totalBilled, 0),
  };

  return NextResponse.json({ summary, companies: all });
}
