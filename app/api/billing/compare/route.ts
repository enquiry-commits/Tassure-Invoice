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
  const wa = new Set(na.split(' ').filter(Boolean));
  const wb = new Set(nb.split(' ').filter(Boolean));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total  = Math.max(wa.size, wb.size);
  return total > 0 ? Math.round((common / total) * 70) : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year') ?? new Date().getFullYear().toString();
  const type  = searchParams.get('type') ?? 'all'; // 'nd' | 'address' | 'ar' | 'agm' | 'all'

  const supabase = createAdminClient();

  // ── Fetch QB invoices for the year
  const { data: invoices, error: invErr } = await supabase
    .from('quickbooks_invoices')
    .select('invoice_no, txn_date, customer_name, total_amt, balance, status')
    .gte('txn_date', `${year}-01-01`)
    .lte('txn_date', `${year}-12-31`);
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // ── Fetch companies
  const { data: allCompanies, error: compErr } = await supabase
    .from('companies')
    .select('id, company_name, uses_address, internal_id');
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  // ── Fetch AR + AGM records for the year (Teamwork source of truth)
  const { data: dueDateRecords } = await supabase
    .from('annual_returns')
    .select('entity_name, year, fye, due_date, status, event_type')
    .eq('year', parseInt(year));

  const arRecords  = (dueDateRecords ?? []).filter(r => r.event_type === 'AR');
  const agmRecords = (dueDateRecords ?? []).filter(r => r.event_type === 'AGM');

  // ── Fetch ND appointments active in the selected year
  const { data: ndAppointments } = await supabase
    .from('nd_appointments')
    .select('company_name, appointment_date, cessation_date')
    .lte('appointment_date', `${year}-12-31`);

  // Only ND still active during the selected year
  const activeNd = (ndAppointments ?? []).filter(nd => {
    if (!nd.appointment_date) return false;
    if (nd.cessation_date && nd.cessation_date < `${year}-01-01`) return false;
    return true;
  });

  // Calculate the renewal date for each ND in the selected year
  // e.g. appointed 2022-04-28 → year 2025 renewal = 2025-04-28
  function ndRenewalDate(appointmentDate: string, yr: string): string {
    const [, mm, dd] = appointmentDate.split('-');
    return `${yr}-${mm}-${dd}`;
  }

  const arSet  = new Set((arRecords).map(r => normalize(r.entity_name)));
  const agmSet = new Set((agmRecords).map(r => normalize(r.entity_name)));
  const ndSet  = new Set(activeNd.map(nd => normalize(nd.company_name)));

  // ── Build company result list
  const results = (allCompanies ?? []).map(company => {
    const normName = normalize(company.company_name);

    const hasAR  = arSet.has(normName)  || arRecords.some(r  => matchScore(company.company_name, r.entity_name)  >= 70);
    const hasAGM = agmSet.has(normName) || agmRecords.some(r => matchScore(company.company_name, r.entity_name) >= 70);
    const ndMatch = ndSet.has(normName)
      ? activeNd.find(nd => normalize(nd.company_name) === normName)
      : activeNd.find(nd => matchScore(company.company_name, nd.company_name) >= 70);
    const hasND      = !!ndMatch;
    const hasAddress = company.uses_address === true;

    // Filter by requested type
    if (type === 'ar'      && !hasAR)      return null;
    if (type === 'agm'     && !hasAGM)     return null;
    if (type === 'nd'      && !hasND)      return null;
    if (type === 'address' && !hasAddress) return null;
    // 'all' — only show companies that have at least one service
    if (type === 'all' && !hasAR && !hasAGM && !hasND && !hasAddress) return null;

    // Match QB invoices to this company
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

    // Per-event status from Teamwork
    const arRecord  = arRecords.find(r  => matchScore(company.company_name, r.entity_name)  >= 70);
    const agmRecord = agmRecords.find(r => matchScore(company.company_name, r.entity_name) >= 70);

    // ND renewal date for the selected year
    const ndRenewal = ndMatch ? ndRenewalDate(ndMatch.appointment_date, year) : null;
    const today = new Date().toISOString().slice(0, 10);
    const ndRenewalPast = ndRenewal ? ndRenewal <= today : false;

    return {
      companyId:    company.id,
      companyName:  company.company_name,
      services: {
        ar:      hasAR,
        agm:     hasAGM,
        nd:      hasND,
        address: hasAddress,
      },
      arStatus:         arRecord?.status   ?? null,
      arDueDate:        arRecord?.due_date ?? null,
      agmStatus:        agmRecord?.status   ?? null,
      agmDueDate:       agmRecord?.due_date ?? null,
      ndAppointedDate:  ndMatch?.appointment_date ?? null,
      ndRenewalDate:    ndRenewal,
      ndRenewalPast,
      billingStatus,
      invoiceCount:  invoiceList.length,
      totalBilled,
      invoices:      invoiceList,
    };
  }).filter(Boolean);

  const summary = {
    year,
    type,
    total:          results.length,
    notBilled:      results.filter(r => r!.billingStatus === 'NOT_BILLED').length,
    paid:           results.filter(r => r!.billingStatus === 'PAID').length,
    invoicedUnpaid: results.filter(r => r!.billingStatus === 'INVOICED_UNPAID').length,
  };

  return NextResponse.json({ summary, companies: results });
}
