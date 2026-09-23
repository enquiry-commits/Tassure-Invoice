// Shared companies+master_list join for the Reports "Explore" section
// (2026-09-03) — both app/api/reports/route.ts and app/api/reports/export/
// route.ts call this, so there is exactly one join implementation, not two
// that can drift apart (same reasoning lib/company-360.ts's own module
// comment already states for its own aggregation).
//
// Matched by exact UEN (companies.registration_no vs master_list.roc_no,
// both trimmed/uppercased) — NOT the fuzzy company-name matching
// lib/company-name.ts does elsewhere. That's deliberate: master_list rows
// are unique per UEN at any moment (app/api/master-list/move/route.ts
// deletes-then-reinserts on a category change, never leaving two rows for
// the same company), so an exact-UEN join here is safe and cheap — no need
// to reach for the fuzzy-match machinery docs/FEATURE_MAP.md flags as
// high-risk shared logic, and no risk of misattributing one company's
// join_date onto a different company with a similar name.
import { buildReportingContext, pctChange } from './reporting-period';

export type ReportsCompanyRow = {
  id: number;
  companyName: string;
  uen: string | null;
  companyType: string | null;
  ssicDescription1: string | null;
  customerSource: string | null;
  twStatus: string | null;
  pic: string | null;
  isActive: boolean | null;
  joinDate: string | null;
  usesAddress: boolean | null;
  hasNd: boolean | null;
  hasAgm: boolean | null;
  hasXbrl: boolean | null;
  hasAccounts: boolean | null;
  hasTax: boolean | null;
};

type CompanyRaw = Record<string, unknown>;
type MasterListRaw = Record<string, unknown>;

export function buildReportsCompanyRows(companies: CompanyRaw[], masterList: MasterListRaw[]): ReportsCompanyRow[] {
  const joinDateByUen = new Map<string, string | null>();
  for (const m of masterList) {
    const uen = m.roc_no ? String(m.roc_no).trim().toUpperCase() : null;
    if (uen) joinDateByUen.set(uen, (m.join_date as string | null) ?? null);
  }

  return companies.map(c => {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    return {
      id: c.id as number,
      companyName: c.company_name as string,
      uen,
      companyType: (c.company_type as string | null) ?? null,
      ssicDescription1: (c.ssic_description_1 as string | null) ?? null,
      customerSource: (c.customer_source as string | null) ?? null,
      twStatus: (c.tw_status as string | null) ?? null,
      pic: (c.pic as string | null) ?? null,
      isActive: (c.is_active as boolean | null) ?? null,
      joinDate: uen ? (joinDateByUen.get(uen) ?? null) : null,
      usesAddress: (c.uses_address as boolean | null) ?? null,
      hasNd: (c.has_nd as boolean | null) ?? null,
      hasAgm: (c.has_agm as boolean | null) ?? null,
      hasXbrl: (c.has_xbrl as boolean | null) ?? null,
      hasAccounts: (c.has_accounts as boolean | null) ?? null,
      hasTax: (c.has_tax as boolean | null) ?? null,
    };
  });
}

// The companies.* columns buildReportsCompanyRows needs — both callers
// (route.ts, export/route.ts) select exactly this so the shape always
// matches what this function reads.
export const REPORTS_COMPANY_SELECT = 'id, company_name, registration_no, company_type, ssic_description_1, customer_source, tw_status, pic, is_active, uses_address, has_nd, has_agm, has_xbrl, has_accounts, has_tax';
export const REPORTS_MASTER_LIST_SELECT = 'roc_no, join_date';

// Extracted 2026-09-09 from app/api/reports/route.ts's own inline
// computation (verbatim, not rewritten) so a new customer_profile_summary-
// style chat tool (revenue/workload) can reuse the EXACT same numbers the
// Reports page itself shows, rather than a second, divergent copy. Needs
// `quickbooks_invoices.select('txn_date, total_amt')`, full table (no
// filter) — the same fetch app/api/reports/route.ts already does.
// Reports V3, P0 #1/#2 — Vincent's spec, §5/§13. The real fix for
// docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md's §0 bug: computeRevenueTrend()
// above buckets by fixed calendar year, so its own last-two-buckets
// comparison was 2026's partial year against 2025's full year, labeled
// "YoY". This function instead sums real invoices within two dates ranges
// resolved by lib/reporting-period.ts's buildReportingContext() — by
// construction (ytd vs previous_ytd is the SAME day-count, both genuinely
// partial-through-the-year), so the comparison is always safe by the time
// it reaches a reader, and `comparable`/`comparabilityReason` are exposed
// so nothing downstream can accidentally present it as a real YoY number
// if that guarantee is ever loosened later.
export type ComparableRevenue = {
  periodLabel: string;
  comparisonLabel: string | null;
  currentRevenue: number;
  currentInvoiceCount: number;
  priorRevenue: number | null;
  priorInvoiceCount: number | null;
  revenuePctChange: number | null;
  invoiceCountPctChange: number | null;
  comparable: boolean;
  comparabilityReason: string;
};

export function computeComparableRevenue(qbInvoices: Record<string, unknown>[], asOfDate: string): ComparableRevenue {
  const ctx = buildReportingContext({ asOfDate, periodType: 'ytd' });
  const sum = (range: { start: string; end: string }) => {
    let revenue = 0;
    let invoiceCount = 0;
    for (const inv of qbInvoices) {
      const raw = typeof inv.txn_date === 'string' ? inv.txn_date.slice(0, 10) : null;
      if (!raw || raw < range.start || raw > range.end) continue;
      revenue += Number(inv.total_amt) || 0;
      invoiceCount += 1;
    }
    return { revenue, invoiceCount };
  };
  const current = sum(ctx.period);
  const prior = ctx.comparison ? sum(ctx.comparison) : null;
  return {
    periodLabel: `${ctx.period.start} to ${ctx.period.end}`,
    comparisonLabel: ctx.comparison ? `${ctx.comparison.start} to ${ctx.comparison.end}` : null,
    currentRevenue: current.revenue,
    currentInvoiceCount: current.invoiceCount,
    priorRevenue: prior?.revenue ?? null,
    priorInvoiceCount: prior?.invoiceCount ?? null,
    revenuePctChange: prior ? pctChange(current.revenue, prior.revenue) : null,
    invoiceCountPctChange: prior ? pctChange(current.invoiceCount, prior.invoiceCount) : null,
    comparable: ctx.comparable,
    comparabilityReason: ctx.comparabilityReason,
  };
}

export function computeRevenueTrend(qbInvoices: Record<string, unknown>[], years: number[]) {
  const invoiceCountByYear: Record<number, number> = {};
  const revenueByYear: Record<number, number> = {};
  for (const inv of qbInvoices) {
    const d = typeof inv.txn_date === 'string' ? new Date(inv.txn_date) : null;
    if (!d || isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    invoiceCountByYear[y] = (invoiceCountByYear[y] ?? 0) + 1;
    revenueByYear[y] = (revenueByYear[y] ?? 0) + (Number(inv.total_amt) || 0);
  }
  // Reports V3, "Missing Data Is Not Zero" — a year that never appears in
  // invoiceCountByYear (the loop above only ever creates a key when it
  // actually sees an invoice) means no QuickBooks data exists for that
  // year at all, which is a DIFFERENT fact than "zero invoices that year"
  // and must render as a gap, never a 0 bar/point. Real example this
  // fixes: quickbooks_invoices has no rows before 2024-01-02, so a 5-year
  // trend reaching back to 2022 used to draw a flat 0 line for 2022/2023.
  return {
    invoiceCountTrend: years.map(y => ({ label: String(y), value: y in invoiceCountByYear ? invoiceCountByYear[y] : null })),
    revenueTrendThousands: years.map(y => ({ label: String(y), value: y in revenueByYear ? Math.round(revenueByYear[y] / 1000) : null })),
  };
}

// Extracted 2026-09-09, same reasoning as computeRevenueTrend above. Needs
// `ar_reminder.select('pic, acc_pic, tax_pic, filling_date').or('status.is.
// null,status.neq.Excluded')` — the same fetch app/api/reports/route.ts
// already does. Open (not yet filed) AR/AGM cycles only — SEC/ACC/TAX PIC
// dropdowns hold plain staff names, not emails, same fields My Tasks
// already reads, no resolution step needed.
// Extracted 2026-09-09 from app/api/reports/route.ts (verbatim) so the chat
// assistant's portfolio summary can reuse the SAME client-flow numbers the
// Reports page shows. Its own caveats still apply and must be repeated
// wherever this is surfaced: master_list.join_date/update_date are staff-
// typed free text in mixed formats, and update_date on a terminated/
// struck-off row is an informal proxy for "when it changed", not a
// guaranteed transition-date field.
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function parseFlexibleDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();

  const named = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (named) {
    const mi = MONTH_ABBR.indexOf(named[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return new Date(Number(named[3]), mi, Number(named[1]));
  }
  const dotted = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotted) {
    const yr = dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    return new Date(yr, Number(dotted[2]) - 1, Number(dotted[1]));
  }
  const slashed = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashed) {
    const yr = slashed[3].length === 2 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
    return new Date(yr, Number(slashed[1]) - 1, Number(slashed[2]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Reports V3 Phase 1, "Client Flow data quality" (Vincent's approved plan
// refinement, 2026-09-23) — deliberately DIFFERENT from revenue's Missing
// != Zero fix (INV-DATA-059). quickbooks_invoices has a clean, provable
// boundary (zero rows before 2024-01-02), so "this year never appears in
// the aggregation" reliably means "no data collected." master_list has no
// such boundary — Tassure's client base predates the trend window, so a
// year with a low count could mean "genuinely few new/churned clients" OR
// "join_date/update_date text for that year failed to parse." These are
// NOT the same fact and must not be collapsed into one number.
//
// Per Vincent's explicit instruction: do NOT null out a whole year over a
// few parse failures (zero-tolerance was rejected), and do NOT force an
// unparseable date into a year it cannot be reliably assigned to — a
// failure that never successfully parsed has no known year, so it is
// tracked as a global "unassigned" count instead, attached once (not
// per-year, which would misleadingly imply a per-year signal this data
// cannot actually support).
export type DataQualityStatus = 'normal' | 'minor_issues' | 'partial_data' | 'data_quality_warning' | 'unavailable';
export type DataQuality = { parseableRecords: number; unparseableRecords: number; coveragePct: number; status: DataQualityStatus };

function classifyQuality(parseable: number, unparseable: number): DataQuality {
  const total = parseable + unparseable;
  if (total === 0) return { parseableRecords: 0, unparseableRecords: 0, coveragePct: 0, status: 'unavailable' };
  const coveragePct = Math.round((parseable / total) * 1000) / 10;
  // Thresholds per Vincent's own spec: 100% normal, >=95% minor note,
  // 90-95% partial-data warning, <90% strong warning.
  const status: DataQualityStatus = coveragePct >= 100 ? 'normal' : coveragePct >= 95 ? 'minor_issues' : coveragePct >= 90 ? 'partial_data' : 'data_quality_warning';
  return { parseableRecords: parseable, unparseableRecords: unparseable, coveragePct, status };
}

export type FlowRow = { companyName: string; uen: string | null };

// Consolidated 2026-09-23 (Reports V3 Phase 1) — app/api/reports/route.ts
// used to carry its OWN separate inline copy of this exact loop (counts +
// per-year drill-down row lists), never calling this shared function at
// all, while this function's own copy (used by the chat assistant's
// portfolio-summary tool) only built the counts. Two implementations of
// the same business rule is exactly the drift risk this codebase's own
// FEATURE_MAP.md "high-risk shared logic" table exists to flag — folded
// into one function, now the single source both callers use, rather than
// applying the new quality-tracking logic to both copies separately.
export function computeClientFlow(masterList: Record<string, unknown>[]) {
  const newByYear: Record<number, number> = {};
  const churnedByYear: Record<number, number> = {};
  const newRowsByYear: Record<number, FlowRow[]> = {};
  const churnedRowsByYear: Record<number, FlowRow[]> = {};
  let newParseable = 0, newUnparseable = 0;
  let churnedParseable = 0, churnedUnparseable = 0;
  for (const m of masterList) {
    // Only a NON-EMPTY join_date that fails to parse counts as an
    // "unparseable" record — a genuinely blank field is a different gap
    // (never recorded at all, not a parsing failure) and is out of scope
    // for this specific quality signal.
    const joinRaw = typeof m.join_date === 'string' ? m.join_date.trim() : '';
    if (joinRaw) {
      const jd = parseFlexibleDate(m.join_date);
      if (jd) {
        const y = jd.getFullYear();
        newByYear[y] = (newByYear[y] ?? 0) + 1;
        (newRowsByYear[y] ??= []).push({ companyName: m.company_name as string, uen: (m.roc_no as string | null) ?? null });
        newParseable++;
      } else newUnparseable++;
    }
    if (m.list_type === 'terminated' || m.list_type === 'strike_off') {
      const updateRaw = typeof m.update_date === 'string' ? m.update_date.trim() : '';
      if (updateRaw) {
        const ud = parseFlexibleDate(m.update_date);
        if (ud) {
          const y = ud.getFullYear();
          churnedByYear[y] = (churnedByYear[y] ?? 0) + 1;
          (churnedRowsByYear[y] ??= []).push({ companyName: m.company_name as string, uen: (m.roc_no as string | null) ?? null });
          churnedParseable++;
        } else churnedUnparseable++;
      }
    }
  }
  return {
    newByYear, churnedByYear, newRowsByYear, churnedRowsByYear,
    newQuality: classifyQuality(newParseable, newUnparseable),
    churnedQuality: classifyQuality(churnedParseable, churnedUnparseable),
  };
}

export function computePicWorkload(arRows: Record<string, unknown>[]) {
  const picCount: Record<string, number> = {};
  for (const r of arRows) {
    if (r.filling_date) continue;
    for (const name of [r.pic, r.acc_pic, r.tax_pic]) {
      if (!name || name === 'Client') continue;
      picCount[name as string] = (picCount[name as string] ?? 0) + 1;
    }
  }
  return Object.entries(picCount)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}
