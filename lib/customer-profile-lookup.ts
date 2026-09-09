import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { buildReportsCompanyRows, REPORTS_COMPANY_SELECT, REPORTS_MASTER_LIST_SELECT } from './reports-data';

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
};

export async function getCustomerProfileSummary(): Promise<CustomerProfileSummary> {
  const sb = createAdminClient();
  const [companies, masterList] = await Promise.all([
    pageAll<Record<string, unknown>>(() => sb.from('companies').select(REPORTS_COMPANY_SELECT)),
    pageAll<Record<string, unknown>>(() => sb.from('master_list').select(REPORTS_MASTER_LIST_SELECT)),
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

  return {
    totalActiveClients: rows.length,
    byCompanyType: toSorted(typeCounts),
    byIndustry: toSorted(industryCounts).slice(0, 15),
    industryDataCoverage: rows.length ? withIndustry / rows.length : 0,
  };
}
