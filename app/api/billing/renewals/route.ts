import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';
import { pageAll } from '@/lib/page-all';
import { normalize, matchScore } from '@/lib/company-name';

function daysBetween(from: string, to: string): number {
  return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}
function addOneYear(d: string): string {
  const dt = new Date(d); dt.setFullYear(dt.getFullYear() + 1); return dt.toISOString().slice(0, 10);
}
function firstOfNextMonth(d: string): string {
  const dt = new Date(d); dt.setDate(1); dt.setMonth(dt.getMonth() + 1); return dt.toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ServicePeriod {
  invoice_no: string; txn_date: string | null;
  period_start: string | null; period_end: string | null;
  fye_date: string | null;
  rate: number | null; amount: number | null;
  product_service: string | null; description: string | null;
}

// Secretary / Address / ND — subscription services with explicit period
export interface RenewalStatus {
  service: 'Secretary' | 'Address' | 'ND';
  applicable: boolean;
  lastPeriodEnd: string | null;
  lastRate: number | null;
  daysUntilExpiry: number | null;
  status: 'active' | 'expiring_soon' | 'expired' | 'not_found';
  suggestedPeriodStart: string | null;
  suggestedPeriodEnd: string | null;
  history: ServicePeriod[];
}

// AR / XBRL — annual filing obligations (billed once per FY)
export interface AnnualStatus {
  service: 'AR' | 'XBRL';
  applicable: boolean;
  status: 'billed' | 'pending' | 'not_found';
  lastTxnDate: string | null;
  lastFyeDate: string | null;
  lastAmount: number | null;
  history: ServicePeriod[];
}

export interface CompanyBilling {
  companyId: number;
  companyName: string;
  uen: string | null;
  fyeMonth: string | null;
  pic: string | null;
  ndPic: string | null;
  twActive: boolean;
  urgency: 'expired' | 'expiring_soon' | 'active' | 'not_found';
  renewals: RenewalStatus[];
  annuals: AnnualStatus[];
  email: string | null;
  contactName: string | null;
  billedCycles: string[]; // FYE dates ("dd.mm.yyyy") this company has already been invoiced for
  priorLines: PriorLine[]; // every line from the most recent renewal invoice (to clone)
  priorInvoiceDate: string | null;
  priorInvoiceNo: string | null; // QB DocNumber of that prior renewal invoice
  generatedInvoices: GeneratedInvoice[]; // invoices OUR system has created (authoritative)
}

export interface GeneratedInvoice {
  qbCompany: 'TAB' | 'TAC';
  invoiceNo: string | null;
  fyeCycle: string | null;
  fyeMonth: string | null;
  fyeYear: number | null;
  totalAmt: number | null;
  services: string[];
  createdAt: string;
}

export interface PriorLine {
  product_service: string | null;
  description: string | null;
  amount: number | null;
  service_type: string | null;
}

// The aggregation is expensive (6 queries, ~10k invoice rows from Tokyo), but
// its inputs only change when QB syncs — cache the computed results for 60s
// per `within` value; the cheap status/service filters run per request.
let renewalsCache: { key: string; ts: number; today: string; results: CompanyBilling[] } | null = null;
const RENEWALS_TTL = 60_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const withinDays = parseInt(searchParams.get('within') ?? '90');
  const filterStatus  = searchParams.get('status')  ?? 'all';
  const filterService = searchParams.get('service') ?? 'all';

  if (renewalsCache && renewalsCache.key === String(withinDays) && Date.now() - renewalsCache.ts < RENEWALS_TTL) {
    return respond(renewalsCache.today, renewalsCache.results, filterStatus, filterService, withinDays);
  }

  const supabase = createAdminClient();
  const today = todaySGT();
  const cutoff18m = new Date(); cutoff18m.setMonth(cutoff18m.getMonth() - 18);
  const cutoff18mStr = cutoff18m.toISOString().slice(0, 10);
  const cutoff24m = new Date(); cutoff24m.setMonth(cutoff24m.getMonth() - 24);
  const cutoff24mStr = cutoff24m.toISOString().slice(0, 10);

  // ── Fetch everything in parallel (pageAll itself fetches pages in parallel
  //    waves) — this was 6 serial round-trip chains before and dominated the
  //    13-16s response time.
  const [
    { data: companies, error: compErr },
    { data: activeNDs },
    { data: nomineeDirectors },
    periodItems,
    annualItems,
    feeItems,
    carriedItems,
    { data: generatedRows },
  ] = await Promise.all([
    supabase
      .from('companies')
      .select('id, company_name, registration_no, fye_month, pic, sec_pic, has_nd, uses_address, has_xbrl, tw_status, client_type, is_active, best_email, primary_contact')
      .eq('client_type', 'CSS Client')
      .eq('tw_status', 'Active'),
    supabase
      .from('nd_appointments')
      .select('company_name, nd_id')
      .eq('sub_role', 'Nominee Director')
      .not('appointment_date', 'is', null)
      .is('cessation_date', null),
    supabase
      .from('nominee_directors')
      .select('id, name'),
    pageAll(() => supabase
      .from('quickbooks_invoice_items')
      .select('customer_name, invoice_no, txn_date, service_type, period_start, period_end, rate, amount, product_service, description')
      .in('service_type', ['Secretary', 'Address', 'ND'])
      .not('period_end', 'is', null)
      .order('period_end', { ascending: false })
      // invoice_no+line_num = unique tiebreaker so parallel page boundaries are stable
      .order('invoice_no', { ascending: true }).order('line_num', { ascending: true })) as Promise<Array<{ customer_name: string; invoice_no: string; txn_date: string | null; service_type: string; period_start: string | null; period_end: string | null; rate: number | null; amount: number | null; product_service: string | null; description: string | null }>>,
    pageAll(() => supabase
      .from('quickbooks_invoice_items')
      .select('customer_name, invoice_no, txn_date, service_type, fye_date, period_start, period_end, amount, rate, product_service, description')
      .in('service_type', ['AR', 'XBRL'])
      .gte('txn_date', cutoff18mStr)
      .order('txn_date', { ascending: false })
      .order('invoice_no', { ascending: true }).order('line_num', { ascending: true })) as Promise<Array<{ customer_name: string; invoice_no: string; txn_date: string | null; service_type: string; fye_date: string | null; period_start: string | null; period_end: string | null; amount: number | null; rate: number | null; product_service: string | null; description: string | null }>>,
    pageAll(() => supabase
      .from('quickbooks_invoice_items')
      .select('customer_name, invoice_no, txn_date, product_service, amount')
      .or('product_service.ilike.%Corporate Secretarial Services%,product_service.ilike.%Deferred Revenue - Corp Sec%,product_service.ilike.%Registered Address Services%,product_service.ilike.%Deferred Revenue - Reg Addr%,product_service.ilike.%Nominee Director Fees%,product_service.ilike.%Deferred%ND%')
      .gte('txn_date', cutoff18mStr)
      .order('txn_date', { ascending: false })
      .order('invoice_no', { ascending: true }).order('line_num', { ascending: true })) as Promise<Array<{ customer_name: string; invoice_no: string; txn_date: string | null; product_service: string | null; amount: number | null }>>,
    // Carry-forward candidates only (Discount / Accounts / Tax lines). This
    // used to be a full 24-month scan of ALL invoice items (~9k rows) just to
    // find each company's prior renewal invoice — but that invoice is already
    // derivable from the fee + annual queries above, so fetch only the few
    // hundred lines the draft modal actually carries forward.
    pageAll(() => supabase
      .from('quickbooks_invoice_items')
      .select('customer_name, invoice_no, txn_date, product_service, description, amount, service_type')
      .or('product_service.ilike.%Discount Given%,product_service.ilike.%Yearly Accounts Services%,product_service.ilike.%Compilation Services%,product_service.ilike.%Monthly Accounts Services%,product_service.ilike.%Corporate Tax Services%,product_service.ilike.%Personal Income Tax Services%,product_service.ilike.%Other Tax Services%')
      .gte('txn_date', cutoff24mStr)
      .order('txn_date', { ascending: false })
      .order('invoice_no', { ascending: true }).order('line_num', { ascending: true })) as Promise<Array<{ customer_name: string; invoice_no: string; txn_date: string | null; product_service: string | null; description: string | null; amount: number | null; service_type: string | null }>>,
    supabase
      .from('generated_invoices')
      .select('company_name, qb_company, invoice_no, fye_cycle, fye_month, fye_year, total_amt, services, created_at')
      .order('created_at', { ascending: false }),
  ]);
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  const ndActiveSet = new Set((activeNDs ?? []).map(a => normalize(a.company_name)));
  const ndNameById = new Map((nomineeDirectors ?? []).map(person => [person.id, person.name as string]));
  const activeNdNameByCompany = new Map<string, string>();
  for (const appointment of activeNDs ?? []) {
    const name = ndNameById.get(appointment.nd_id);
    if (name) activeNdNameByCompany.set(normalize(appointment.company_name), name);
  }

  // Index our own generated-invoice records per company (authoritative record
  // of what THIS system has already invoiced, per QB company).
  const generatedMap = new Map<string, GeneratedInvoice[]>();
  for (const g of generatedRows ?? []) {
    const n = normalize(g.company_name);
    if (!generatedMap.has(n)) generatedMap.set(n, []);
    generatedMap.get(n)!.push({
      qbCompany: g.qb_company as 'TAB' | 'TAC',
      invoiceNo: g.invoice_no,
      fyeCycle: g.fye_cycle,
      fyeMonth: g.fye_month,
      fyeYear: g.fye_year,
      totalAmt: g.total_amt,
      services: g.services ?? [],
      createdAt: g.created_at,
    });
  }

  // ── 4b. TRUE annual fee per service ──────────────────────────────────────
  // QB splits an annual fee across a recognised line ("Corporate Secretarial
  // Services") and a deferred-revenue line ("Deferred Revenue - Corp Sec").
  // TAC uses the same pattern for ND: the named Nominee Director item plus a
  // "Deferred - ND Fees" / "Deferred Revenue - ND" line in the same invoice.
  // The real fee the client is charged is the SUM of both. So compute it per
  // company from the most recent renewal invoice: group that invoice's lines
  // by service and add them up.
  // key normName|invoice|service → { txn_date, sum }; then keep the latest
  // invoice per (company, service) as the current annual fee.
  const feeTmp = new Map<string, { n: string; svc: string; txn_date: string | null; sum: number; hasPrimary: boolean }>();
  for (const it of feeItems ?? []) {
    const ps = it.product_service ?? '';
    const svc = /Nominee Director Fees|Deferred.*ND/i.test(ps) ? 'ND'
              : /Corporate Secretarial|Corp Sec/i.test(ps) ? 'Secretary'
              : /Registered Address|Reg Addr/i.test(ps) ? 'Address' : null;
    if (!svc) continue;
    const n = normalize(it.customer_name);
    const key = `${n}|${it.invoice_no}|${svc}`;
    if (!feeTmp.has(key)) feeTmp.set(key, { n, svc, txn_date: it.txn_date, sum: 0, hasPrimary: false });
    const group = feeTmp.get(key)!;
    group.sum += +(it.amount ?? 0) || 0;
    if (svc !== 'ND' || /Nominee Director Fees/i.test(ps)) group.hasPrimary = true;
  }
  const annualFeeMap = new Map<string, Map<string, { txn_date: string | null; fee: number }>>();
  for (const { n, svc, txn_date, sum, hasPrimary } of feeTmp.values()) {
    if (!hasPrimary) continue;
    if (!annualFeeMap.has(n)) annualFeeMap.set(n, new Map());
    const m = annualFeeMap.get(n)!;
    const cur = m.get(svc);
    if (!cur || (txn_date ?? '') > (cur.txn_date ?? '')) m.set(svc, { txn_date, fee: Math.round(sum * 100) / 100 });
  }
  const annualFeeEntries = [...annualFeeMap.entries()];
  function getAnnualFee(companyName: string, svc: string): number | null {
    const direct = annualFeeMap.get(normalize(companyName))?.get(svc);
    if (direct?.fee) return direct.fee;
    for (const [k, m] of annualFeeEntries) {
      if (matchScore(companyName, k) >= 70) { const f = m.get(svc)?.fee; if (f) return f; }
    }
    return null;
  }

  // ── 4c. Prior renewal invoice (the template to clone) ────────────────────
  // The billing SOP is: take last year's invoice, reuse its items + amounts,
  // just roll the service period forward. The prior renewal invoice — the one
  // carrying the annual retainer / AR govt fee / address line — is already
  // present in the fee + annual queries above, so derive it from those instead
  // of scanning every invoice line (that scan dominated response time).
  const RENEWAL_LINE = /Corporate Secretarial Services|Government fee for filing Annual Return|Registered Address Services/i;
  const priorInvoiceMap = new Map<string, { invoice_no: string; txn_date: string | null }>();
  const noteRenewal = (name: string, invoice_no: string, txn_date: string | null, ps: string | null) => {
    if (!RENEWAL_LINE.test(ps ?? '')) return;
    const n = normalize(name);
    const cur = priorInvoiceMap.get(n);
    if (!cur || (txn_date ?? '') > (cur.txn_date ?? '')) priorInvoiceMap.set(n, { invoice_no, txn_date });
  };
  for (const it of feeItems ?? [])    noteRenewal(it.customer_name, it.invoice_no, it.txn_date, it.product_service);
  for (const it of annualItems ?? []) noteRenewal(it.customer_name, it.invoice_no, it.txn_date, it.product_service);

  // Carry-forward lines (Discount/Accounts/Tax) grouped by (company, invoice).
  const carriedByInv = new Map<string, PriorLine[]>();
  for (const it of carriedItems ?? []) {
    const key = `${normalize(it.customer_name)}|${it.invoice_no}`;
    if (!carriedByInv.has(key)) carriedByInv.set(key, []);
    carriedByInv.get(key)!.push({
      product_service: it.product_service, description: it.description,
      amount: it.amount, service_type: it.service_type,
    });
  }
  const priorInvoiceEntries = [...priorInvoiceMap.entries()];
  function getPriorInvoice(companyName: string): { invoice_no: string; txn_date: string | null; lines: PriorLine[] } | null {
    const n = normalize(companyName);
    let key = n;
    let hit = priorInvoiceMap.get(n);
    if (!hit) {
      for (const [k, v] of priorInvoiceEntries) {
        if (matchScore(companyName, k) >= 70) { hit = v; key = k; break; }
      }
    }
    if (!hit) return null;
    return { invoice_no: hit.invoice_no, txn_date: hit.txn_date, lines: carriedByInv.get(`${key}|${hit.invoice_no}`) ?? [] };
  }

  // Index period items: normName → service_type → deduplicated ServicePeriod[]
  const periodMap = new Map<string, Map<string, ServicePeriod[]>>();
  for (const item of periodItems ?? []) {
    const n = normalize(item.customer_name);
    if (!periodMap.has(n)) periodMap.set(n, new Map());
    const svcMap = periodMap.get(n)!;
    if (!svcMap.has(item.service_type)) svcMap.set(item.service_type, []);
    svcMap.get(item.service_type)!.push({
      invoice_no: item.invoice_no, txn_date: item.txn_date,
      period_start: item.period_start, period_end: item.period_end,
      fye_date: null, rate: item.rate, amount: item.amount,
      product_service: item.product_service, description: item.description,
    });
  }

  // Index annual items: normName → service_type → ServicePeriod[]
  const annualMap = new Map<string, Map<string, ServicePeriod[]>>();
  for (const item of annualItems ?? []) {
    const n = normalize(item.customer_name);
    if (!annualMap.has(n)) annualMap.set(n, new Map());
    const svcMap = annualMap.get(n)!;
    if (!svcMap.has(item.service_type)) svcMap.set(item.service_type, []);
    svcMap.get(item.service_type)!.push({
      invoice_no: item.invoice_no, txn_date: item.txn_date,
      period_start: item.period_start, period_end: item.period_end,
      fye_date: item.fye_date, rate: item.rate, amount: item.amount,
      product_service: item.product_service, description: item.description,
    });
  }

  // ── Which FYE cycles has each company already been invoiced for? ─────────
  // Extract the "dd.mm.yyyy" FYE marker from AR/annual line descriptions and
  // the fye_date column. Lets the month view tell "already invoiced this
  // cycle" apart from "still to invoice" — reliable even when period_end is
  // missing on the subscription lines.
  const billedCyclesMap = new Map<string, Set<string>>();
  const addCycle = (name: string, s: string | null) => {
    if (!s) return;
    const n = normalize(name);
    if (!billedCyclesMap.has(n)) billedCyclesMap.set(n, new Set());
    billedCyclesMap.get(n)!.add(s);
  };
  const fyeFromIso = (d: string | null): string | null => {
    const m = d ? String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
  };
  for (const it of annualItems ?? []) {
    addCycle(it.customer_name, fyeFromIso(it.fye_date));
    const dm = (it.description || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) addCycle(it.customer_name, `${dm[1]}.${dm[2]}.${dm[3]}`);
  }

  const periodEntries = [...periodMap.entries()];
  const annualEntries = [...annualMap.entries()];

  function getHistory(entries: [string, Map<string, ServicePeriod[]>][], companyName: string, svc: string): ServicePeriod[] {
    const n = normalize(companyName);
    const direct = periodMap.get(n)?.get(svc) ?? annualMap.get(n)?.get(svc);
    if (direct?.length) return direct;
    for (const [k, svcMap] of entries) {
      if (matchScore(companyName, k) >= 70) {
        const periods = svcMap.get(svc);
        if (periods?.length) return periods;
      }
    }
    return [];
  }

  // ── 5. Build per-company billing record ─────────────────────────────────
  const results: CompanyBilling[] = (companies ?? []).map(company => {
    const normName = normalize(company.company_name);
    const hasNdActive = ndActiveSet.has(normName) || company.has_nd === true;

    // ── Renewal services ──────────────────────────────────────────────────
    const renewals: RenewalStatus[] = (['Secretary', 'Address', 'ND'] as const).map(svc => {
      const applicable =
        svc === 'ND'      ? hasNdActive :
        svc === 'Address' ? (company.uses_address === true) :
        true; // Secretary always applies

      const rawHistory = getHistory(periodEntries, company.company_name, svc);
      // Deduplicate by (invoice_no, period_end)
      const seen = new Set<string>();
      const history = rawHistory
        .filter(h => {
          const key = `${h.invoice_no}|${h.period_end}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        })
        .sort((a, b) => (b.period_end ?? '').localeCompare(a.period_end ?? ''));

      if (!history.length) {
        // No parsed service period — but the TRUE annual fee may still be known
        // from the fee lines (368 active clients have a real Secretary fee yet
        // no parseable period). Surface it so drafts pre-fill the real rate
        // instead of falling back to the catalogue median.
        return { service: svc, applicable, lastPeriodEnd: null,
          lastRate: getAnnualFee(company.company_name, svc),
          daysUntilExpiry: null, status: 'not_found', suggestedPeriodStart: null,
          suggestedPeriodEnd: null, history: [] };
      }

      const latest = history[0];
      const lastPeriodEnd = latest.period_end!;
      const daysUntilExpiry = daysBetween(today, lastPeriodEnd);
      const status: RenewalStatus['status'] =
        daysUntilExpiry < 0          ? 'expired' :
        daysUntilExpiry <= withinDays ? 'expiring_soon' : 'active';

      // Prefer the true annual fee (service + deferred lines summed) for
      // Secretary, Address and ND; fall back to the single parsed line rate.
      const annualFee = getAnnualFee(company.company_name, svc);
      return {
        service: svc, applicable, lastPeriodEnd, daysUntilExpiry, status,
        lastRate: annualFee ?? history.find(h => h.rate)?.rate ?? null,
        suggestedPeriodStart: firstOfNextMonth(lastPeriodEnd),
        suggestedPeriodEnd:   addOneYear(lastPeriodEnd),
        // The UI shows period + invoice_no and reads [0].product_service/rate;
        // the long line descriptions were dead weight in a 2.3MB payload.
        history: history.slice(0, 3).map(h => ({ ...h, description: null })),
      };
    });

    // ── Annual obligations ────────────────────────────────────────────────
    const annuals: AnnualStatus[] = (['AR', 'XBRL'] as const).map(svc => {
      const applicable = svc === 'XBRL' ? (company.has_xbrl === true) : true; // AR always

      const history = getHistory(annualEntries, company.company_name, svc)
        .sort((a, b) => (b.txn_date ?? '').localeCompare(a.txn_date ?? ''));

      if (!history.length) {
        return { service: svc, applicable, status: 'not_found',
          lastTxnDate: null, lastFyeDate: null, lastAmount: null, history: [] };
      }

      const latest = history[0];
      // If billed within last 13 months → likely covers current FY
      const monthsAgo = daysBetween(latest.txn_date ?? today, today) / 30;
      const status: AnnualStatus['status'] = monthsAgo <= 13 ? 'billed' : 'pending';

      return {
        service: svc, applicable, status,
        lastTxnDate: latest.txn_date,
        lastFyeDate: latest.fye_date,
        lastAmount: latest.amount,
        history: history.slice(0, 3).map(h => ({ ...h, description: null })),
      };
    });

    // Overall urgency (drives row color)
    const urgency: CompanyBilling['urgency'] =
      renewals.some(r => r.applicable && r.status === 'expired')           ? 'expired' :
      renewals.some(r => r.applicable && r.status === 'expiring_soon')     ? 'expiring_soon' :
      renewals.some(r => r.applicable && r.status === 'active')            ? 'active' : 'not_found';

    const primary = company.primary_contact as { email?: string; contactName?: string } | null;
    // The draft modal only carries forward Discount / Accounts / Tax lines
    // from the prior invoice — the carried-items query already fetches only
    // those, so the prior invoice's line list is exactly what ships.
    const prior = getPriorInvoice(company.company_name);
    const carriedLines = prior?.lines ?? [];
    return {
      companyId: company.id,
      companyName: company.company_name,
      uen: company.registration_no ?? null,
      fyeMonth: company.fye_month ?? null,
      pic: company.sec_pic ?? company.pic ?? null,
      ndPic: activeNdNameByCompany.get(normName) ?? null,
      twActive: true,
      urgency,
      renewals,
      annuals,
      email: company.best_email ?? primary?.email ?? null,
      contactName: primary?.contactName ?? null,
      billedCycles: [...(billedCyclesMap.get(normName) ?? [])],
      priorLines: carriedLines,
      priorInvoiceDate: prior?.txn_date ?? null,
      priorInvoiceNo: prior?.invoice_no ?? null,
      generatedInvoices: generatedMap.get(normName) ?? [],
    };
  });

  renewalsCache = { key: String(withinDays), ts: Date.now(), today, results };
  return respond(today, results, filterStatus, filterService, withinDays);
}

// Cheap per-request filtering over the (possibly cached) computed results.
function respond(today: string, results: CompanyBilling[], filterStatus: string, filterService: string, withinDays: number) {
  const filtered = results.filter(c => {
    if (filterStatus !== 'all' && c.urgency !== filterStatus) return false;
    if (filterService !== 'all') {
      const svcLower = filterService.toLowerCase();
      const inRenewals = c.renewals.some(r => r.service.toLowerCase() === svcLower && r.applicable && r.status !== 'not_found');
      const inAnnuals  = c.annuals.some(a => a.service.toLowerCase() === svcLower  && a.applicable && a.status !== 'not_found');
      return inRenewals || inAnnuals;
    }
    return true;
  });

  const summary = {
    total: filtered.length,
    expired:      filtered.filter(c => c.urgency === 'expired').length,
    expiringSoon: filtered.filter(c => c.urgency === 'expiring_soon').length,
    active:       filtered.filter(c => c.urgency === 'active').length,
    withinDays,
  };

  return NextResponse.json({ today, summary, companies: filtered });
}
