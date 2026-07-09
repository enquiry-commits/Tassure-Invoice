import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';

function normalize(name: string) {
  return (name ?? '')
    .toLowerCase()
    .replace(/\(fka\b[^)]*\)/gi, '')
    .replace(/\(f\.k\.a\.[^)]*\)/gi, '')
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  return Math.round((common / Math.max(wa.size, wb.size)) * 100);
}

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
  twActive: boolean;
  urgency: 'expired' | 'expiring_soon' | 'active' | 'not_found';
  renewals: RenewalStatus[];
  annuals: AnnualStatus[];
  email: string | null;
  contactName: string | null;
  billedCycles: string[]; // FYE dates ("dd.mm.yyyy") this company has already been invoiced for
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const withinDays = parseInt(searchParams.get('within') ?? '90');
  const filterStatus  = searchParams.get('status')  ?? 'all';
  const filterService = searchParams.get('service') ?? 'all';

  const supabase = createAdminClient();
  const today = todaySGT();
  const cutoff18m = new Date(); cutoff18m.setMonth(cutoff18m.getMonth() - 18);
  const cutoff18mStr = cutoff18m.toISOString().slice(0, 10);

  // ── 1. Active CSS clients (TeamWork gate) ────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, company_name, registration_no, fye_month, pic, sec_pic, has_nd, uses_address, has_xbrl, tw_status, client_type, is_active, best_email, primary_contact')
    .eq('client_type', 'CSS Client')
    .eq('tw_status', 'Active');
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  // ── 2. Active ND appointments ────────────────────────────────────────────
  const { data: activeNDs } = await supabase
    .from('nd_appointments')
    .select('company_name')
    .eq('sub_role', 'Nominee Director')
    .not('appointment_date', 'is', null)
    .is('cessation_date', null);
  const ndActiveSet = new Set((activeNDs ?? []).map(a => normalize(a.company_name)));

  // Supabase caps a single request at 1000 rows, and the invoice-item tables
  // are much larger than that — page through so no invoice lines are dropped.
  type Row = Record<string, unknown>;
  async function pageAll(makeQuery: () => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
    const out: Row[] = [];
    let fromIdx = 0;
    for (;;) {
      const { data } = await (makeQuery() as unknown as { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null }> }).range(fromIdx, fromIdx + 999);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < 1000) break;
      fromIdx += 1000;
    }
    return out;
  }

  // ── 3. QB items — subscription services (period-based) ───────────────────
  const periodItems = await pageAll(() => supabase
    .from('quickbooks_invoice_items')
    .select('customer_name, invoice_no, txn_date, service_type, period_start, period_end, rate, amount, product_service, description')
    .in('service_type', ['Secretary', 'Address', 'ND'])
    .not('period_end', 'is', null)
    .order('period_end', { ascending: false })) as unknown as Array<{ customer_name: string; invoice_no: string; txn_date: string | null; service_type: string; period_start: string | null; period_end: string | null; rate: number | null; amount: number | null; product_service: string | null; description: string | null }>;

  // ── 4. QB items — annual obligations (AR, XBRL) ──────────────────────────
  const annualItems = await pageAll(() => supabase
    .from('quickbooks_invoice_items')
    .select('customer_name, invoice_no, txn_date, service_type, fye_date, period_start, period_end, amount, rate, product_service, description')
    .in('service_type', ['AR', 'XBRL'])
    .gte('txn_date', cutoff18mStr)
    .order('txn_date', { ascending: false })) as unknown as Array<{ customer_name: string; invoice_no: string; txn_date: string | null; service_type: string; fye_date: string | null; period_start: string | null; period_end: string | null; amount: number | null; rate: number | null; product_service: string | null; description: string | null }>;

  // ── 4b. TRUE annual fee per service ──────────────────────────────────────
  // QB splits an annual fee across a recognised line ("Corporate Secretarial
  // Services") and a deferred-revenue line ("Deferred Revenue - Corp Sec").
  // The real fee the client is charged is the SUM of both. So compute it per
  // company from the most recent renewal invoice: group that invoice's lines
  // by service and add them up.
  const feeItems = await pageAll(() => supabase
    .from('quickbooks_invoice_items')
    .select('customer_name, invoice_no, txn_date, product_service, amount')
    .or('product_service.ilike.%Corporate Secretarial Services%,product_service.ilike.%Deferred Revenue - Corp Sec%,product_service.ilike.%Registered Address Services%,product_service.ilike.%Deferred Revenue - Reg Addr%')
    .gte('txn_date', cutoff18mStr)
    .order('txn_date', { ascending: false })) as unknown as Array<{ customer_name: string; invoice_no: string; txn_date: string | null; product_service: string | null; amount: number | null }>;

  // key normName|invoice|service → { txn_date, sum }; then keep the latest
  // invoice per (company, service) as the current annual fee.
  const feeTmp = new Map<string, { n: string; svc: string; txn_date: string | null; sum: number }>();
  for (const it of feeItems ?? []) {
    const ps = it.product_service ?? '';
    const svc = /Corporate Secretarial|Corp Sec/i.test(ps) ? 'Secretary'
              : /Registered Address|Reg Addr/i.test(ps) ? 'Address' : null;
    if (!svc) continue;
    const n = normalize(it.customer_name);
    const key = `${n}|${it.invoice_no}|${svc}`;
    if (!feeTmp.has(key)) feeTmp.set(key, { n, svc, txn_date: it.txn_date, sum: 0 });
    feeTmp.get(key)!.sum += +(it.amount ?? 0) || 0;
  }
  const annualFeeMap = new Map<string, Map<string, { txn_date: string | null; fee: number }>>();
  for (const { n, svc, txn_date, sum } of feeTmp.values()) {
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
        return { service: svc, applicable, lastPeriodEnd: null, lastRate: null,
          daysUntilExpiry: null, status: 'not_found', suggestedPeriodStart: null,
          suggestedPeriodEnd: null, history: [] };
      }

      const latest = history[0];
      const lastPeriodEnd = latest.period_end!;
      const daysUntilExpiry = daysBetween(today, lastPeriodEnd);
      const status: RenewalStatus['status'] =
        daysUntilExpiry < 0          ? 'expired' :
        daysUntilExpiry <= withinDays ? 'expiring_soon' : 'active';

      // Prefer the true annual fee (service + deferred summed) for Secretary /
      // Address; fall back to the single line's rate (e.g. ND).
      const annualFee = getAnnualFee(company.company_name, svc);
      return {
        service: svc, applicable, lastPeriodEnd, daysUntilExpiry, status,
        lastRate: annualFee ?? history.find(h => h.rate)?.rate ?? null,
        suggestedPeriodStart: firstOfNextMonth(lastPeriodEnd),
        suggestedPeriodEnd:   addOneYear(lastPeriodEnd),
        history: history.slice(0, 5),
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
        history: history.slice(0, 5),
      };
    });

    // Overall urgency (drives row color)
    const urgency: CompanyBilling['urgency'] =
      renewals.some(r => r.applicable && r.status === 'expired')           ? 'expired' :
      renewals.some(r => r.applicable && r.status === 'expiring_soon')     ? 'expiring_soon' :
      renewals.some(r => r.applicable && r.status === 'active')            ? 'active' : 'not_found';

    const primary = company.primary_contact as { email?: string; contactName?: string } | null;
    return {
      companyId: company.id,
      companyName: company.company_name,
      uen: company.registration_no ?? null,
      fyeMonth: company.fye_month ?? null,
      pic: company.sec_pic ?? company.pic ?? null,
      twActive: true,
      urgency,
      renewals,
      annuals,
      email: company.best_email ?? primary?.email ?? null,
      contactName: primary?.contactName ?? null,
      billedCycles: [...(billedCyclesMap.get(normName) ?? [])],
    };
  });

  // ── Filters ───────────────────────────────────────────────────────────────
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
