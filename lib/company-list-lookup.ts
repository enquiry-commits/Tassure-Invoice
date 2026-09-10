import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { buildReportsCompanyRows, REPORTS_COMPANY_SELECT, REPORTS_MASTER_LIST_SELECT, type ReportsCompanyRow } from './reports-data';
import { normalize } from './company-name';

// Added 2026-09-09 — the single biggest STRUCTURAL gap found reviewing what
// chat could reach: every existing tool was either (a) one named company or
// (b) a global aggregate count. Nothing could return a FILTERED LIST of
// companies, so ordinary questions like "Chelsea 负责哪些公司", "哪些公司用
// 我们的注册地址", "12月FYE的有哪些", "哪些公司要做XBRL" all failed even
// though the data and the join were already built and shipping (the Reports
// page's own Explore section drills down on exactly this dataset).
//
// Reuses buildReportsCompanyRows() — the same companies+master_list join
// Reports and customer_profile_summary already use — rather than a third
// copy of it. Filters are applied in-memory on that one shared result, the
// same idiom app/companies/page.tsx and Reports' Explore section already use
// (fetch the roster once, filter in JS).
export type CompanyListFilters = {
  pic?: string;               // Secretary PIC, fuzzy (matches pic field, case/format-insensitive)
  fyeMonth?: string;          // e.g. "December" / "DEC" — matched on first 3 letters
  service?: 'address' | 'nd' | 'agm' | 'xbrl' | 'accounts' | 'tax';
  industry?: string;          // SSIC description substring
  companyType?: string;       // legal entity type substring
  customerSource?: string;
  status?: string;            // tw_status substring, e.g. "Active", "Striking"
  activeOnly?: boolean;       // default true — companies.is_active
  limit?: number;             // default 50, max 200
  // Lifts the 200-row cap. NEVER settable from chat: companyListTool()
  // builds CompanyListFilters field-by-field from an allow-list, so the
  // model cannot reach this. Only lib/chat-export.ts sets it, because an
  // .xlsx whose whole purpose is "give me the list to work from" must not
  // silently stop at 200 of 947.
  unlimited?: boolean;
};

export type CompanyListResult = {
  totalMatched: number;
  returned: number;
  truncated: boolean;
  filtersApplied: Record<string, unknown>;
  companies: {
    companyName: string;
    uen: string | null;
    status: string | null;
    pic: string | null;
    companyType: string | null;
    industry: string | null;
    services: string[];
  }[];
};

const SERVICE_FIELD: Record<NonNullable<CompanyListFilters['service']>, keyof ReportsCompanyRow> = {
  address: 'usesAddress', nd: 'hasNd', agm: 'hasAgm', xbrl: 'hasXbrl', accounts: 'hasAccounts', tax: 'hasTax',
};

function serviceLabels(r: ReportsCompanyRow): string[] {
  const out: string[] = [];
  if (r.usesAddress) out.push('address');
  if (r.hasNd) out.push('nd');
  if (r.hasAgm) out.push('agm');
  if (r.hasXbrl) out.push('xbrl');
  if (r.hasAccounts) out.push('accounts');
  if (r.hasTax) out.push('tax');
  return out;
}

export async function listCompanies(filters: CompanyListFilters): Promise<CompanyListResult> {
  const sb = createAdminClient();
  const [companies, masterList] = await Promise.all([
    // fye_month isn't part of REPORTS_COMPANY_SELECT (Reports itself doesn't
    // need it) — appended here rather than widening the shared constant,
    // which other callers depend on the exact shape of.
    pageAll<Record<string, unknown>>(() => sb.from('companies').select(`${REPORTS_COMPANY_SELECT}, fye_month`)),
    pageAll<Record<string, unknown>>(() => sb.from('master_list').select(REPORTS_MASTER_LIST_SELECT)),
  ]);
  let rows = buildReportsCompanyRows(companies, masterList);

  const activeOnly = filters.activeOnly !== false; // default true
  if (activeOnly) rows = rows.filter(r => r.isActive);

  if (filters.pic) {
    // Staff names are stored inconsistently ("Kah Ye Chin" vs "Chin Kah Ye"
    // vs "CKY" appear across this system's own fields) — match on any word
    // overlap rather than an exact string, so a real name typed either way
    // round still finds its companies.
    const wanted = normalize(filters.pic).split(' ').filter(w => w.length > 1);
    rows = rows.filter(r => {
      if (!r.pic) return false;
      const have = normalize(r.pic);
      return wanted.some(w => have.includes(w));
    });
  }
  if (filters.service) {
    const field = SERVICE_FIELD[filters.service];
    rows = rows.filter(r => !!r[field]);
  }
  if (filters.industry) {
    const q = filters.industry.trim().toUpperCase();
    rows = rows.filter(r => (r.ssicDescription1 ?? '').toUpperCase().includes(q));
  }
  if (filters.companyType) {
    const q = filters.companyType.trim().toUpperCase();
    rows = rows.filter(r => (r.companyType ?? '').toUpperCase().includes(q));
  }
  if (filters.customerSource) {
    const q = filters.customerSource.trim().toUpperCase();
    rows = rows.filter(r => (r.customerSource ?? '').toUpperCase().includes(q));
  }
  if (filters.status) {
    const q = filters.status.trim().toUpperCase();
    rows = rows.filter(r => (r.twStatus ?? '').toUpperCase().includes(q));
  }

  // FYE month lives on the raw companies row (not on ReportsCompanyRow), so
  // resolve it from the same fetch rather than a second query.
  if (filters.fyeMonth) {
    const want = filters.fyeMonth.trim().toLowerCase().slice(0, 3);
    const fyeByUen = new Map<string, string>();
    for (const c of companies) {
      const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
      const fye = c.fye_month as string | null;
      if (uen && fye) fyeByUen.set(uen, fye);
    }
    rows = rows.filter(r => {
      const fye = r.uen ? fyeByUen.get(r.uen) : null;
      return !!fye && fye.trim().toLowerCase().slice(0, 3) === want;
    });
  }

  const sorted = rows.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));
  const limit = filters.unlimited ? sorted.length : Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return {
    totalMatched: sorted.length,
    returned: Math.min(sorted.length, limit),
    truncated: sorted.length > limit,
    filtersApplied: { ...filters, activeOnly },
    companies: sorted.slice(0, limit).map(r => ({
      companyName: r.companyName,
      uen: r.uen,
      status: r.twStatus,
      pic: r.pic,
      companyType: r.companyType,
      industry: r.ssicDescription1,
      services: serviceLabels(r),
    })),
  };
}
