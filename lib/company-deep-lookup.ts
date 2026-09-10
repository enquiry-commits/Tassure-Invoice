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
// A company that has been struck off / terminated is routinely REMOVED from
// the `companies` table entirely (the same behaviour the Late Filing work
// already documented: "被除名的公司可能整条从 companies 表里消失"), while
// master_list keeps its full historical record. Confirmed real on
// production: of 6 sampled struck-off companies, 4 had no `companies` row at
// all — so this lookup used to answer "No company matched" for a real former
// client Tassure served for years, as if it had never existed. That is worse
// than an incomplete answer; this fallback shape exists so chat can say what
// the company WAS, and be explicit that no live record remains.
export type CompanyDeepLookupResult =
  | {
      found: true;
      recordSource: 'master_list_only';
      companyName: string;
      uen: string | null;
      lifecycleStatus: string | null; // master_list.status, e.g. "STRUCK OFF"
      masterListCategories: string[];
      joinDate: string | null;
      lastUpdateDate: string | null;
      fye: string | null;
      internalCode: string | null;
      contactName: string | null;
      email: string | null;
      directors: string | null;
      shareholders: string | null;
      nomineeDirector: string | null;
      secretary: string | null;
      note: string;
    }
  | {
      found: true;
      recordSource: 'live';
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
      // Client-lifecycle category from master_list (active_client / terminated
      // / strike_off / name_change / mas / ad_hoc / inactive_old). Added
      // 2026-09-09 as a CORRECTNESS fix, not just extra detail: without it
      // this tool answered "is X still our client" from companies.tw_status
      // alone, which can disagree with master_list — and master_list really
      // does hold 268 terminated + 263 struck-off companies. Answering
      // "Active" for a terminated client is a wrong answer, not a gap.
      masterListCategories: string[];
      parentCompanyName: string | null;
      // Real contact routing — bestEmail is what Client Communications
      // actually sends to; "这家公司的邮箱是什么" is a high-frequency
      // operational question this tool couldn't answer before.
      bestEmail: string | null;
      primaryContactName: string | null;
      services: { address: boolean; nd: boolean; xbrl: boolean; accounts: boolean; tax: boolean; agm: boolean };
      // The AR workflow pipeline (prepared → sent → received → AGM held →
      // filed) and any extension of time. Added 2026-09-10 to close a real
      // coherence gap: preview_ar_update lets chat WRITE these exact fields,
      // but this read side only exposed status/dueDate — so "这家公司的年报
      // 做到哪一步了" failed even though chat could set the very next stage.
      arReminder: {
        totalCycles: number;
        pendingCycles: number;
        mostRecent: {
          fyeMonth: string;
          fyeYear: number;
          status: string | null;
          dueDate: string | null;
          preparedDate: string | null;
          sentDate: string | null;
          receivedDate: string | null;
          agmHeldDate: string | null;
          filingDate: string | null;
          stage: string;
          extendedFrom: string | null;
          pic: string | null;
        }[];
      };
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

// Where an AR cycle has actually reached, derived from which workflow dates
// are filled. Deliberately reports the FURTHEST stage reached rather than
// assuming the dates were filled in order — real rows are sparsely
// populated (of 867 open cycles on a production check: 43 prepared, 23
// sent, 3 received, 1 AGM held), so a cycle can legitimately have a later
// date set without the earlier ones.
function arStage(r: Record<string, unknown>): string {
  if (r.filling_date) return 'Filed';
  if (r.agm_held_date) return 'AGM held, not yet filed';
  if (r.received_date) return 'Received back from client';
  if (r.sent_date) return 'Sent to client';
  if (r.prepared_date) return 'Prepared';
  return 'Not started';
}

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
  // No live `companies` row — before giving up, check master_list, which
  // keeps a struck-off/terminated client's full historical record even after
  // the live row is gone (see this type's own comment above).
  if (!match) {
    const { data: mlRows } = await sb.from('master_list')
      .select('company_name, roc_no, list_type, status, join_date, update_date, fye, internal_code, contact_window, email, directors, shareholders, nominee_director, secretary');
    const ml = mlRows ?? [];
    let mlMatch = ml.find(m => normalize(m.company_name as string) === normalize(trimmed));
    if (!mlMatch) {
      const best = findUniqueBestMatch(trimmed, ml, m => m.company_name as string, 70).value;
      if (best) mlMatch = best;
    }
    if (mlMatch) {
      const categories = [...new Set(ml
        .filter(m => normalize(m.company_name as string) === normalize(mlMatch!.company_name as string))
        .map(m => (m.list_type as string | null) ?? '(uncategorised)'))];
      return {
        found: true,
        recordSource: 'master_list_only',
        companyName: mlMatch.company_name as string,
        uen: (mlMatch.roc_no as string | null) ?? null,
        lifecycleStatus: (mlMatch.status as string | null) ?? null,
        masterListCategories: categories,
        joinDate: (mlMatch.join_date as string | null) ?? null,
        lastUpdateDate: (mlMatch.update_date as string | null) ?? null,
        fye: (mlMatch.fye as string | null) ?? null,
        internalCode: (mlMatch.internal_code as string | null) ?? null,
        contactName: (mlMatch.contact_window as string | null) ?? null,
        email: (mlMatch.email as string | null) ?? null,
        directors: (mlMatch.directors as string | null) ?? null,
        shareholders: (mlMatch.shareholders as string | null) ?? null,
        nomineeDirector: (mlMatch.nominee_director as string | null) ?? null,
        secretary: (mlMatch.secretary as string | null) ?? null,
        note: 'This company has NO live record in the main companies table — it exists only in the Master List history, which is what happens to a struck-off/terminated client. Tell the user plainly that this is a FORMER client (state its lifecycle category/status and when it was last updated) and that live sections (current invoices, outstanding balance, trademarks, AR cycles, generated documents) are therefore not available for it. Everything returned here is historical Master List data, some of it staff-typed free text — do not present it as current.',
      };
    }
    const q = normalize(trimmed);
    const suggestions = [
      ...rows.filter(c => normalize(c.company_name as string).includes(q)).map(c => c.company_name as string),
      ...ml.filter(m => normalize(m.company_name as string).includes(q)).map(m => m.company_name as string),
    ].slice(0, 5);
    return { found: false, message: `No company matched "${companyQuery}" in either the live company list or Master List history.`, suggestions };
  }

  const c360 = await getCompany360(sb, match.id as number);
  if (!c360) return { found: false, message: `No company matched "${companyQuery}".`, suggestions: [] };

  const outstandingByQb = new Map<string, number>();
  for (const row of c360.outstanding) outstandingByQb.set(row.qbCompany, (outstandingByQb.get(row.qbCompany) ?? 0) + row.totalOutstanding);
  const outstandingTotal = [...outstandingByQb.values()].reduce((a, b) => a + b, 0);

  return {
    found: true,
    recordSource: 'live',
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
    masterListCategories: [...new Set(c360.masterList.map(m => (m.list_type as string | null) ?? '(uncategorised)'))],
    parentCompanyName: c360.company.parentCompanyName,
    bestEmail: c360.company.bestEmail,
    primaryContactName: c360.company.primaryContact?.contactName ?? null,
    services: {
      address: !!c360.company.usesAddress, nd: !!c360.company.hasNd, xbrl: !!c360.company.hasXbrl,
      accounts: !!c360.company.hasAccounts, tax: !!c360.company.hasTax, agm: !!c360.company.hasAgm,
    },
    arReminder: {
      totalCycles: c360.arReminderCycles.length,
      pendingCycles: c360.arReminderCycles.filter(r => (r.status as string | null) !== 'Filed').length,
      mostRecent: c360.arReminderCycles.slice(0, 3).map(r => ({
        fyeMonth: r.fye_month as string, fyeYear: r.fye_year as number, status: (r.status as string | null) ?? 'Pending', dueDate: r.due_date as string | null,
        preparedDate: (r.prepared_date as string | null) ?? null,
        sentDate: (r.sent_date as string | null) ?? null,
        receivedDate: (r.received_date as string | null) ?? null,
        agmHeldDate: (r.agm_held_date as string | null) ?? null,
        filingDate: (r.filling_date as string | null) ?? null,
        stage: arStage(r),
        // due_date already carries the revised date where an EOT was
        // granted (verified against production), so the ORIGINAL is what
        // makes the extension visible.
        extendedFrom: r.ar_original_due_date && r.ar_original_due_date !== r.due_date ? (r.ar_original_due_date as string) : null,
        pic: (r.pic as string | null) ?? null,
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
