import { thisYearSGT } from '@/lib/date';
import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { buildReportsCompanyRows, computeClientFlow, REPORTS_COMPANY_SELECT, REPORTS_MASTER_LIST_SELECT } from './reports-data';
import { customerSourceLabel } from './customer-source';

// A real capability gap Vincent flagged, 2026-09-09: asked "客户最大是什么
// 类型的客户？从事什么行业的？" (what type/industry is our biggest client),
// twice — the chat assistant honestly said it had no "customer analysis"
// tool and pointed at Companies/Active Client for manual browsing, which is
// technically true but the SAME real data already exists, computed once,
// on the Reports page's own "Explore" section (company_type = legal entity
// structure, ssic_description_1 = real industry classification, backfilled
// for the whole roster — see lib/reports-data.ts's own header comment).
// Reuses buildReportsCompanyRows() exactly rather than re-deriving the
// companies+master_list join or the active-client filter (`is_active`,
// same definition app/api/reports/route.ts's own "Active Clients" KPI
// uses) a second time.
export type DimensionCount = { label: string; count: number };

export type CustomerProfileSummary = {
  totalActiveClients: number;
  byCompanyType: DimensionCount[]; // legal entity structure (Pte Ltd / Sole Prop / LLP...), sorted desc
  byIndustry: DimensionCount[]; // real SSIC industry description, sorted desc, top 15 (avoids a long SSIC tail dump)
  industryDataCoverage: number; // fraction (0-1) of active clients with a real SSIC value on file
  // Added 2026-09-09 — the first version of this summary covered only 1 of
  // the ~5 leadership-facing things the Reports page computes. These close
  // the rest: service mix, customer source, the client-lifecycle roll-up
  // (which is the ONLY place "how many clients have we lost" is answerable),
  // address-service footprint, and this/last year's client flow.
  byService: DimensionCount[];        // how many active clients use each service
  byCustomerSource: DimensionCount[]; // untagged shown as "Unknown"
  byLifecycle: DimensionCount[];      // master_list.list_type roll-up across the WHOLE history, not just active
  addressService: { totalUsing: number; byLocation: DimensionCount[] };
  clientFlow: { newThisYear: number; churnedThisYear: number; netGrowthThisYear: number; year: number };
};

export async function getCustomerProfileSummary(): Promise<CustomerProfileSummary> {
  const sb = createAdminClient();
  const [companies, masterList] = await Promise.all([
    // address_service_location isn't in REPORTS_COMPANY_SELECT (Reports
    // doesn't chart it) — appended here rather than widening the shared
    // constant other callers depend on.
    pageAll<Record<string, unknown>>(() => sb.from('companies').select(`${REPORTS_COMPANY_SELECT}, address_service_location`)),
    // list_type/update_date are needed for the lifecycle roll-up and client
    // flow below, on top of the shared join columns.
    pageAll<Record<string, unknown>>(() => sb.from('master_list').select(`list_type, update_date, company_name, ${REPORTS_MASTER_LIST_SELECT}`)),
  ]);
  const rows = buildReportsCompanyRows(companies, masterList).filter(r => r.isActive);

  const typeCounts = new Map<string, number>();
  // Real, confirmed data-quality issue in ssic_description_1: the same
  // industry appears with inconsistent casing ("WHOLESALE TRADE OF A
  // VARIETY OF GOODS WITHOUT A DOMINANT PRODUCT" x140 and "Wholesale trade
  // of a variety of goods without a dominant product" x12, on a real
  // production check) — grouping by the raw string split what is genuinely
  // ONE industry into two separate, much-smaller-looking entries. Grouped
  // by the upper-cased form (the dominant casing in this data) instead, so
  // counts aren't silently split.
  const industryCounts = new Map<string, number>();
  let withIndustry = 0;
  for (const r of rows) {
    const type = r.companyType || 'Unspecified';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (r.ssicDescription1) {
      withIndustry += 1;
      const key = r.ssicDescription1.trim().toUpperCase();
      industryCounts.set(key, (industryCounts.get(key) ?? 0) + 1);
    }
  }
  const toSorted = (m: Map<string, number>) =>
    [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  // Service mix — same 6 services and same active-client scope as the
  // Reports page's own Service Mix chart.
  const byService: DimensionCount[] = [
    { label: 'Registered Address', count: rows.filter(r => r.usesAddress).length },
    { label: 'Nominee Director', count: rows.filter(r => r.hasNd).length },
    { label: 'AGM', count: rows.filter(r => r.hasAgm).length },
    { label: 'XBRL', count: rows.filter(r => r.hasXbrl).length },
    { label: 'Accounts', count: rows.filter(r => r.hasAccounts).length },
    { label: 'Tax', count: rows.filter(r => r.hasTax).length },
  ].sort((a, b) => b.count - a.count);

  const sourceCounts = new Map<string, number>();
  for (const r of rows) sourceCounts.set(customerSourceLabel(r.customerSource), (sourceCounts.get(customerSourceLabel(r.customerSource)) ?? 0) + 1);

  // Lifecycle roll-up spans the WHOLE master_list history (not just active
  // clients) — this is the only place "how many clients have we lost" is
  // answerable at all.
  const lifecycleCounts = new Map<string, number>();
  for (const m of masterList) {
    const t = (m.list_type as string | null) ?? '(uncategorised)';
    lifecycleCounts.set(t, (lifecycleCounts.get(t) ?? 0) + 1);
  }

  // Address service — which of our own offices each client is registered at.
  // Counted straight off the companies rows (is_active && uses_address), NOT
  // via a UEN join: a first version joined on UEN and silently dropped one
  // real active client that has no UEN on file, reporting 376 where the
  // direct count is 377. Same is_active definition as everything else here.
  const locationCounts = new Map<string, number>();
  let totalUsingAddress = 0;
  for (const c of companies) {
    if (!c.is_active || !c.uses_address) continue;
    totalUsingAddress += 1;
    const loc = (c.address_service_location as string | null) ?? '(unspecified)';
    locationCounts.set(loc, (locationCounts.get(loc) ?? 0) + 1);
  }

  const thisYear = thisYearSGT();
  const { newByYear, churnedByYear } = computeClientFlow(masterList);

  return {
    totalActiveClients: rows.length,
    byCompanyType: toSorted(typeCounts),
    byIndustry: toSorted(industryCounts).slice(0, 15),
    industryDataCoverage: rows.length ? withIndustry / rows.length : 0,
    byService,
    byCustomerSource: toSorted(sourceCounts),
    byLifecycle: toSorted(lifecycleCounts),
    addressService: { totalUsing: totalUsingAddress, byLocation: toSorted(locationCounts) },
    clientFlow: {
      year: thisYear,
      newThisYear: newByYear[thisYear] ?? 0,
      churnedThisYear: churnedByYear[thisYear] ?? 0,
      netGrowthThisYear: (newByYear[thisYear] ?? 0) - (churnedByYear[thisYear] ?? 0),
    },
  };
}
