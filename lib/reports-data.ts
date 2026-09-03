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
