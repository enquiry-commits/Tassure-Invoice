import 'server-only';

import { createAdminClient } from './supabase';
import { normalize, findUniqueBestMatch } from './company-name';
import { getCompany360 } from './company-360';

// Added 2026-09-09 — the single highest-leverage chat-assistant gap found
// in a full review of what data exists vs. what chat can reach: the vast
// majority of casual "how's this company doing" questions are about ONE
// specific company, but search_company (app/api/assistant/route.ts) only
// ever exposed a thin slice of what Company 360 actually knows (no
// trademark, no invoice history, no generated documents, no real
// director/shareholder roster). This calls the EXACT SAME getCompany360()
// the real Company 360 page renders from — never a second, re-derived
// notion of "everything about this company" — then curates it down to a
// chat-appropriate summary: real counts and recent items for chat, but
// deliberately DROPS personally-identifying detail (NRIC/passport numbers,
// date of birth, home address, personal mobile/telephone) from the
// officials/shareholders roster — a casual "who's on the board" question
// only needs names and roles, and handing an LLM a company's directors'
// full ID numbers/DOB/home addresses is a real, avoidable privacy risk
// this tool has no business taking just to answer that.
//
// Resolves companyQuery -> companyId the same normalize()/
// findUniqueBestMatch() idiom every other single-company chat lookup in
// this codebase already uses (lib/outstanding-lookup.ts,
// lib/late-filing-lookup.ts, lib/billing-lookup.ts, ...), not a fragile
// ilike-substring guess.
export type CompanyDeepLookupResult =
  | {
      found: true;
      companyName: string;
      uen: string | null;
      status: string | null;
      companyType: string | null;
      clientType: string | null;
      isActive: boolean | null;
      fyeMonth: string | null;
      pic: string | null;
      secPic: string | null;
      customerSource: string | null;
      industry: string | null; // ssicDescription1
      services: { address: boolean; nd: boolean; xbrl: boolean; accounts: boolean; tax: boolean; agm: boolean };
      arReminder: { totalCycles: number; pendingCycles: number; mostRecent: { fyeMonth: string; fyeYear: number; status: string | null; dueDate: string | null }[] };
      invoices: { generatedCount: number; quickbooksMatchedCount: number; mostRecentGenerated: { qbCompany: string | null; totalAmt: number | null; createdAt: string | null }[] };
      outstanding: { hasOutstanding: boolean; total: number; byQbCompany: { qbCompany: string; total: number }[] };
      nomineeDirectors: { name: string; subRole: string | null; appointmentDate: string | null; isActive: boolean }[];
      trademarks: { applicationNumber: string | null; applicationDate: string | null; markExpiredDate: string | null; statusText: string | null; category: string | null }[];
      documentsGenerated: { generatedAt: string | null; fileCount: number; generatedByName: string | null; needNdService: boolean }[];
      // Names + roles only — see this file's own header comment on why the
      // real ID/DOB/address/contact fields are deliberately never surfaced here.
      officials: { name: string; role: string | null }[];
      shareholders: { name: string; numberOfShares: string | null; shareType: string | null }[];
      communicationsDraftCount: number;
      warnings: string[];
    }
  | { found: false; message: string; suggestions: string[] };

export async function lookupCompanyDeep(companyQuery: string): Promise<CompanyDeepLookupResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();

  const { data: companies } = await sb.from('companies').select('id, company_name');
  const rows = companies ?? [];
  let match = rows.find(c => normalize(c.company_name as string) === normalize(trimmed));
  if (!match) {
    const best = findUniqueBestMatch(trimmed, rows, r => r.company_name as string, 70).value;
    if (best) match = best;
  }
  if (!match) {
    const q = normalize(trimmed);
    const suggestions = rows.filter(c => normalize(c.company_name as string).includes(q)).slice(0, 5).map(c => c.company_name as string);
    return { found: false, message: `No company matched "${companyQuery}".`, suggestions };
  }

  const c360 = await getCompany360(sb, match.id as number);
  if (!c360) return { found: false, message: `No company matched "${companyQuery}".`, suggestions: [] };

  const outstandingByQb = new Map<string, number>();
  for (const row of c360.outstanding) outstandingByQb.set(row.qbCompany, (outstandingByQb.get(row.qbCompany) ?? 0) + row.totalOutstanding);
  const outstandingTotal = [...outstandingByQb.values()].reduce((a, b) => a + b, 0);

  return {
    found: true,
    companyName: c360.company.companyName,
    uen: c360.company.registrationNo,
    status: c360.company.twStatus,
    companyType: c360.company.companyType,
    clientType: c360.company.clientType,
    isActive: c360.company.isActive,
    fyeMonth: c360.company.fyeMonth,
    pic: c360.company.pic,
    secPic: c360.company.secPic,
    customerSource: c360.company.customerSource,
    industry: c360.company.ssicDescription1,
    services: {
      address: !!c360.company.usesAddress, nd: !!c360.company.hasNd, xbrl: !!c360.company.hasXbrl,
      accounts: !!c360.company.hasAccounts, tax: !!c360.company.hasTax, agm: !!c360.company.hasAgm,
    },
    arReminder: {
      totalCycles: c360.arReminderCycles.length,
      pendingCycles: c360.arReminderCycles.filter(r => (r.status as string | null) !== 'Filed').length,
      mostRecent: c360.arReminderCycles.slice(0, 3).map(r => ({
        fyeMonth: r.fye_month as string, fyeYear: r.fye_year as number, status: (r.status as string | null) ?? 'Pending', dueDate: r.due_date as string | null,
      })),
    },
    invoices: {
      generatedCount: c360.invoices.generated.length,
      quickbooksMatchedCount: c360.invoices.quickbooks.length,
      mostRecentGenerated: c360.invoices.generated
        .slice()
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        .slice(0, 3)
        .map(r => ({ qbCompany: (r.qb_company as string | null) ?? null, totalAmt: (r.total_amt as number | null) ?? null, createdAt: (r.created_at as string | null) ?? null })),
    },
    outstanding: {
      hasOutstanding: outstandingTotal > 0,
      total: outstandingTotal,
      byQbCompany: [...outstandingByQb.entries()].map(([qbCompany, total]) => ({ qbCompany, total })),
    },
    nomineeDirectors: c360.nomineeDirector.appointments.map(a => ({ name: a.ndName, subRole: a.subRole, appointmentDate: a.appointmentDate, isActive: a.isActive })),
    trademarks: c360.trademark.map(t => ({
      applicationNumber: (t.application_number as string | null) ?? null,
      applicationDate: (t.application_date as string | null) ?? null,
      markExpiredDate: (t.mark_expired_date as string | null) ?? null,
      statusText: (t.status_text as string | null) ?? null,
      category: (t.category as string | null) ?? null,
    })),
    documentsGenerated: c360.documentsGenerated.map(d => ({
      generatedAt: (d.created_at as string | null) ?? null,
      fileCount: ((d.generated_files as string[] | null) ?? []).length,
      generatedByName: (d.created_by_name as string | null) ?? null,
      needNdService: !!d.need_nd_service,
    })),
    officials: c360.officials.map(o => ({ name: (o.name as string | null) ?? 'Unknown', role: (o.role as string | null) ?? null })),
    shareholders: c360.shareholders.map(s => ({
      name: (s.shareholder_name as string | null) ?? 'Unknown',
      numberOfShares: (s.number_of_shares as string | null) ?? null,
      shareType: (s.share_type as string | null) ?? null,
    })),
    communicationsDraftCount: c360.communications.drafts.length,
    warnings: c360.matchQuality.warnings,
  };
}
