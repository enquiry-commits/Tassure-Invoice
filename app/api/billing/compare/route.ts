import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

function normalize(name: string) {
  return name
    .toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\b/g, '')
    .replace(/\bsdn\.?\s*bhd\.?\b/g, '')
    .replace(/\bllp\b/g, '')
    .replace(/[.\-,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  // Word overlap score
  const wa = new Set(na.split(' ').filter(Boolean));
  const wb = new Set(nb.split(' ').filter(Boolean));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total  = Math.max(wa.size, wb.size);
  return total > 0 ? Math.round((common / total) * 70) : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year') ?? new Date().getFullYear().toString();
  const type  = searchParams.get('type') ?? 'all'; // 'nd' | 'address' | 'all'

  const supabase = createAdminClient();

  // Fetch companies that should be billed
  let query = supabase.from('companies').select('id, company_name, uses_address, internal_id');
  if (type === 'nd') {
    // Companies with active ND appointments
    const { data: ndIds } = await supabase
      .from('nd_appointments')
      .select('company_id')
      .is('cessation_date', null);
    const ids = [...new Set((ndIds ?? []).map((r: { company_id: number }) => r.company_id))];
    query = query.in('id', ids);
  } else if (type === 'address') {
    query = query.eq('uses_address', true);
  }

  const { data: companies, error: compErr } = await query;
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  // Fetch QB invoices for the year
  const { data: invoices, error: invErr } = await supabase
    .from('quickbooks_invoices')
    .select('invoice_no, txn_date, customer_name, total_amt, balance, status')
    .gte('txn_date', `${year}-01-01`)
    .lte('txn_date', `${year}-12-31`);
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // Match companies to invoices
  const results = (companies ?? []).map(company => {
    const matches = (invoices ?? [])
      .map(inv => ({ inv, score: matchScore(company.company_name, inv.customer_name) }))
      .filter(m => m.score >= 70)
      .sort((a, b) => b.score - a.score);

    const invoiceList = matches.map(m => m.inv);
    const hasPaid     = invoiceList.some(i => i.status === 'Paid');
    const hasOpen     = invoiceList.some(i => i.status === 'Open' || i.status === 'Overdue');
    const totalBilled = invoiceList.reduce((s, i) => s + (i.total_amt ?? 0), 0);

    let billingStatus: string;
    if (invoiceList.length === 0) billingStatus = 'NOT_BILLED';
    else if (hasPaid)             billingStatus = 'PAID';
    else if (hasOpen)             billingStatus = 'INVOICED_UNPAID';
    else                          billingStatus = 'UNKNOWN';

    return {
      companyId:     company.id,
      companyName:   company.company_name,
      usesAddress:   company.uses_address,
      billingStatus,
      invoiceCount:  invoiceList.length,
      totalBilled,
      invoices:      invoiceList,
    };
  });

  const summary = {
    year,
    type,
    total:         results.length,
    notBilled:     results.filter(r => r.billingStatus === 'NOT_BILLED').length,
    paid:          results.filter(r => r.billingStatus === 'PAID').length,
    invoicedUnpaid:results.filter(r => r.billingStatus === 'INVOICED_UNPAID').length,
  };

  return NextResponse.json({ summary, companies: results });
}
