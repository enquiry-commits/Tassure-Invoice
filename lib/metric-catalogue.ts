// Reports V3 Phase 1, item "Metric Catalogue" — Vincent's approved plan
// (docs/REPORTS_V3_PHASE1_PLAN.md §1). A documentation/registry layer
// describing metrics this codebase ALREADY computes — it never recomputes
// anything itself (spec §14: "Do not duplicate logic inside prompts").
// Each entry's `owner` field points at the real function that does the
// math; `status` is the load-bearing field the narrative's metricRefs
// validation (lib/reports-narrative.ts) checks against — only `available`
// metrics may be cited as a supported fact, `partial` metrics must state
// their own limitation, and `planned` metrics must NEVER be cited by the
// production narrative (Vincent's explicit instruction, approved plan
// item 4) because nothing computes them yet.
export type MetricStatus = 'available' | 'partial' | 'planned';
export type MetricDefinition = {
  metricId: string;
  name: string;
  businessDefinition: string;
  formula: string;
  numerator: string;
  denominator: string | null;
  periodRule: string;
  filters: string[];
  currency: 'SGD' | null;
  owner: string;
  version: string;
  status: MetricStatus;
  /** Set only when status is 'partial' — the narrative must repeat this limitation whenever it cites the metric. */
  limitation?: string;
};

export const METRIC_CATALOGUE: MetricDefinition[] = [
  {
    metricId: 'active_clients',
    name: 'Active Clients',
    businessDefinition: 'Companies currently marked active in the client roster.',
    formula: 'COUNT(companies) WHERE is_active = true',
    numerator: 'companies.is_active = true rows',
    denominator: null,
    periodRule: 'Point-in-time as of report generation, not a period-over-period figure.',
    filters: ['is_active = true'],
    currency: null,
    owner: 'app/api/reports/route.ts (active.length)',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'new_clients_this_year',
    name: 'New Clients (This Year)',
    businessDefinition: 'Companies whose join_date falls in the current calendar year.',
    formula: 'COUNT(master_list) WHERE YEAR(parseFlexibleDate(join_date)) = thisYear',
    numerator: 'rows with a parseable join_date in the current year',
    denominator: null,
    periodRule: 'Current calendar year only — partial through the year, same as every other current-year figure.',
    filters: ['join_date parses successfully'],
    currency: null,
    owner: 'lib/reports-data.ts:computeClientFlow',
    version: '2',
    status: 'partial',
    limitation: 'join_date is staff-typed free text with real parse-failure gaps — see the quality metadata attached to each year’s Client Flow point; a year with a low coveragePct is a real data-quality caveat, not a precise count.',
  },
  {
    metricId: 'churned_clients_this_year',
    name: 'Churned Clients (This Year)',
    businessDefinition: 'Companies moved to Terminated/Strike Off whose update_date falls in the current calendar year.',
    formula: 'COUNT(master_list) WHERE list_type IN (terminated, strike_off) AND YEAR(parseFlexibleDate(update_date)) = thisYear',
    numerator: 'rows with a parseable update_date in the current year',
    denominator: null,
    periodRule: 'Current calendar year only.',
    filters: ['list_type IN (terminated, strike_off)', 'update_date parses successfully'],
    currency: null,
    owner: 'lib/reports-data.ts:computeClientFlow',
    version: '2',
    status: 'partial',
    limitation: 'update_date on a Terminated/Strike Off row is an informal proxy for "when status changed," not a guaranteed transition-date field, and shares join_date’s parse-failure gaps.',
  },
  {
    metricId: 'net_client_growth_this_year',
    name: 'Net Client Growth (This Year)',
    businessDefinition: 'New clients minus churned clients this year.',
    formula: 'new_clients_this_year - churned_clients_this_year',
    numerator: 'new_clients_this_year',
    denominator: null,
    periodRule: 'Current calendar year only.',
    filters: [],
    currency: null,
    owner: 'app/api/reports/route.ts (kpis.netGrowthThisYear)',
    version: '1',
    status: 'partial',
    limitation: 'Inherits both underlying metrics’ date-parsing limitation.',
  },
  {
    metricId: 'client_flow_trend',
    name: 'Client Flow by Year',
    businessDefinition: 'New and churned client counts for each of the last 5 calendar years.',
    formula: 'Per-year new_clients_this_year/churned_clients_this_year, computed for each year in the trend window',
    numerator: 'see new_clients_this_year / churned_clients_this_year',
    denominator: null,
    periodRule: 'Multi-year trend — the most recent year is labeled "YTD" and is partial; earlier years are complete calendar years.',
    filters: [],
    currency: null,
    owner: 'lib/reports-data.ts:computeClientFlow',
    version: '2',
    status: 'partial',
    limitation: 'Same date-parsing coverage caveat as the underlying yearly counts; each year now carries its own quality.status (normal/minor-issues/partial-data/data-quality-warning/unavailable) — cite that alongside the number, never the number alone, for any year not flagged "normal".',
  },
  {
    metricId: 'revenue_ytd',
    name: 'Revenue (Current YTD)',
    businessDefinition: 'Total QuickBooks invoice amount from 1 Jan of the current year through today.',
    formula: 'SUM(quickbooks_invoices.total_amt) WHERE txn_date BETWEEN period.start AND period.end',
    numerator: 'quickbooks_invoices.total_amt',
    denominator: null,
    periodRule: 'YTD (buildReportingContext, periodType: ytd) — always partial-through-the-year by construction.',
    filters: ['txn_date in current YTD window'],
    currency: 'SGD',
    owner: 'lib/reports-data.ts:computeComparableRevenue',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'revenue_yoy',
    name: 'Revenue YoY (Comparable Period)',
    businessDefinition: 'Percentage change between current YTD revenue and the identical date range one year earlier.',
    formula: 'pctChange(currentRevenue, priorRevenue) — see lib/reporting-period.ts',
    numerator: 'revenue_ytd (current)',
    denominator: 'revenue for the equivalent prior-year YTD window',
    periodRule: 'YTD vs previous_ytd — same day-count both sides, validated by buildReportingContext()’s comparability check before this may be cited as a real YoY figure. INV-DATA-059.',
    filters: [],
    currency: null,
    owner: 'lib/reports-data.ts:computeComparableRevenue',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'invoice_count_yoy',
    name: 'Invoice Count YoY (Comparable Period)',
    businessDefinition: 'Percentage change in invoice count between current YTD and the identical prior-year window.',
    formula: 'pctChange(currentInvoiceCount, priorInvoiceCount)',
    numerator: 'current YTD invoice count',
    denominator: 'prior-year equivalent YTD invoice count',
    periodRule: 'Same comparable-period guarantee as revenue_yoy.',
    filters: [],
    currency: null,
    owner: 'lib/reports-data.ts:computeComparableRevenue',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'avg_invoice_value_trend',
    name: 'Average Invoice Value by Year',
    businessDefinition: 'Revenue divided by invoice count for each year in the trend window.',
    formula: 'revenueTrendThousands[y] * 1000 / invoiceCountTrend[y]',
    numerator: 'yearly revenue',
    denominator: 'yearly invoice count',
    periodRule: 'Multi-year trend, most recent year labeled YTD and partial.',
    filters: [],
    currency: 'SGD',
    owner: 'app/reports/page.tsx (derived from lib/reports-data.ts:computeRevenueTrend)',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'service_mix',
    name: 'Service Mix',
    businessDefinition: 'Share of active clients currently using each service (AGM, Tax, Accounts, Registered Address, Nominee Director, XBRL).',
    formula: 'COUNT(companies WHERE has_<service> = true) / COUNT(active companies)',
    numerator: 'active companies with the service flag set',
    denominator: 'all active companies',
    periodRule: 'Point-in-time, not a period-over-period figure.',
    filters: ['is_active = true'],
    currency: null,
    owner: 'app/api/reports/route.ts (serviceMix)',
    version: '1',
    status: 'available',
    limitation: 'This is USAGE against ALL active clients, not an eligibility-adjusted attach rate — not every active client is necessarily eligible for every service. Phase 4 will add a real eligible-population denominator; until then this metric describes current usage only, never "opportunity" or "whitespace".',
  },
  {
    metricId: 'client_type_composition',
    name: 'Client Type Composition',
    businessDefinition: 'Active clients grouped by legal entity structure (Pte Ltd / Sole Prop / LLP, etc.).',
    formula: 'COUNT(companies) GROUP BY company_type WHERE is_active = true',
    numerator: 'active companies per company_type',
    denominator: 'all active companies',
    periodRule: 'Point-in-time.',
    filters: ['is_active = true'],
    currency: null,
    owner: 'app/api/reports/route.ts (clientTypeDonut)',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'customer_source_coverage',
    name: 'Customer Source Coverage',
    businessDefinition: 'Share of active clients with a recorded customer_source value.',
    formula: '(active_clients - COUNT(customer_source IS NULL)) / active_clients',
    numerator: 'active companies with a non-null customer_source',
    denominator: 'all active companies',
    periodRule: 'Point-in-time.',
    filters: ['is_active = true'],
    currency: null,
    owner: 'app/reports/page.tsx:CustomerSourceQualityCard',
    version: '1',
    status: 'available',
  },
  {
    metricId: 'staff_workload_open_cycles',
    name: 'Staff Workload (Open AR/AGM Cycles)',
    businessDefinition: 'Count of open (not yet filed) AR/AGM cycles per staff member as SEC, ACC, or TAX PIC.',
    formula: 'COUNT(ar_reminder) WHERE filling_date IS NULL, grouped by pic/acc_pic/tax_pic',
    numerator: 'open ar_reminder rows',
    denominator: null,
    periodRule: 'Point-in-time.',
    filters: ['filling_date IS NULL'],
    currency: null,
    owner: 'lib/reports-data.ts:computePicWorkload',
    version: '1',
    status: 'available',
    limitation: 'Raw open-item count, not weighted by urgency/complexity/risk — Reports V3’s original spec’s "Weighted Workload Score" (P2) does not exist yet; never cite this as a direct workload-intensity comparison between staff.',
  },

  // Phase 2/3/4 metrics — status 'planned' until each is actually built.
  // Listed now so the narrative's own metricRefs validation has a real,
  // named thing to reject a premature citation of, and so this registry
  // never silently omits what the wider Reports V3 roadmap still owes.
  { metricId: 'revenue_bridge', name: 'Revenue Bridge', businessDefinition: 'New/Expansion/Contraction/Churn decomposition of period-over-period revenue change.', formula: 'Not yet implemented.', numerator: '', denominator: null, periodRule: '', filters: [], currency: 'SGD', owner: '(Phase 2)', version: '0', status: 'planned' },
  { metricId: 'grr', name: 'Gross Revenue Retention', businessDefinition: 'Retained starting revenue after churn and contraction, as a share of starting revenue.', formula: 'Not yet implemented.', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 3)', version: '0', status: 'planned' },
  { metricId: 'nrr', name: 'Net Revenue Retention', businessDefinition: 'Retained starting revenue after churn, contraction and expansion, as a share of starting revenue.', formula: 'Not yet implemented.', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 3)', version: '0', status: 'planned' },
  { metricId: 'arpc', name: 'Average Revenue per Client', businessDefinition: 'Total revenue divided by active client count.', formula: 'Not yet implemented.', numerator: '', denominator: null, periodRule: '', filters: [], currency: 'SGD', owner: '(Phase 2)', version: '0', status: 'planned' },
  { metricId: 'revenue_concentration', name: 'Revenue Concentration (Top 5/10)', businessDefinition: 'Share of total revenue from the largest 5/10 clients.', formula: 'Not yet implemented — needs client-name normalization first.', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 2)', version: '0', status: 'planned' },
  { metricId: 'logo_retention', name: 'Logo Retention', businessDefinition: 'Share of opening clients still active at period close.', formula: 'Not yet implemented — needs Opening Clients as a first-class metric.', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 3)', version: '0', status: 'planned' },
  { metricId: 'service_attach_rate', name: 'Eligible Service Attach Rate', businessDefinition: 'Service users as a share of ELIGIBLE clients, not all active clients.', formula: 'Not yet implemented — blocked on a real eligibility engine (Phase 4).', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 4)', version: '0', status: 'planned' },
  { metricId: 'service_whitespace', name: 'Service Whitespace / Opportunity', businessDefinition: 'Eligible clients not currently using a service.', formula: 'Not yet implemented — blocked on a real eligibility engine (Phase 4).', numerator: '', denominator: null, periodRule: '', filters: [], currency: null, owner: '(Phase 4)', version: '0', status: 'planned' },
];

export function getMetric(metricId: string): MetricDefinition | undefined {
  return METRIC_CATALOGUE.find(m => m.metricId === metricId);
}
