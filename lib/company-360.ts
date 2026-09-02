import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize, matchScore } from './company-name';

// Company 360 — one aggregation function, imported by both the page
// (server component, no HTTP hop) and the API route (for any future
// non-page consumer), so there is exactly one join implementation, not two
// that can drift apart. See docs/FEATURE_MAP.md's "high-risk shared logic"
// entry for lib/company-name.ts — the same caution applies here: most of
// the tables below have NO real foreign key to a company, only a fuzzy
// company_name match, confirmed by direct schema research before writing
// this (see docs/CURRENT_STATE.md / PROJECT_STATUS.md 2026-08-31 entry).
//
// Reliable links, in order of trust: companies.id (PK) > ar_reminder's
// company_id (nullable FK) > ar_reminder.uen (exact string) >
// email_drafts.company_id (real FK, INV-DOC-004) > master_list.roc_no /
// post_incorporate_operations.company_uen (exact UEN string, not FK) >
// everything else (generated_invoices, quickbooks_invoices,
// nd_appointments, trademark_records) — company_name string only, no
// company_id/UEN column exists on any of them at all.

// Stricter than findUniqueBestMatch's default 70 (lib/company-name.ts) —
// this filters an ilike-prefiltered CANDIDATE LIST for a known company,
// not picking one best match among many candidates, so a false positive
// here would misattribute another company's real invoice/appointment/
// trademark history onto this page. Kept every match's own score in the
// response so a borderline hit is still visible, not silently dropped.
const FUZZY_MATCH_THRESHOLD = 85;

// The word used to prefilter a large, company_name-only table via ilike
// before scoring — normalize() already strips "pte ltd"/"sdn bhd"/etc., so
// the remaining longest word is usually the one distinguishing word a raw
// company_name column will still literally contain.
function significantWord(companyName: string): string | null {
  const words = normalize(companyName).split(' ').filter(w => w.length > 2);
  if (!words.length) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
}

function fuzzyMatch<T>(companyName: string, rows: T[], getName: (r: T) => string): (T & { matchScore: number })[] {
  return rows
    .map(r => ({ ...r, matchScore: matchScore(companyName, getName(r)) }))
    .filter(r => r.matchScore >= FUZZY_MATCH_THRESHOLD);
}

export type Company360 = {
  company: {
    id: number;
    internalId: string | null;
    internalCode: string | null;
    companyName: string;
    registrationNo: string | null;
    companyType: string | null;
    fyeMonth: string | null;
    fyeDay: number | null;
    twStatus: string | null;
    clientType: string | null;
    isActive: boolean | null;
    isNonClient: boolean | null;
    pic: string | null;
    secPic: string | null;
    usesAddress: boolean | null;
    hasNd: boolean | null;
    hasXbrl: boolean | null;
    hasAccounts: boolean | null;
    hasTax: boolean | null;
    hasAnnualReturn: boolean | null;
    hasAgm: boolean | null;
    servicesManual: Record<string, boolean> | null;
    bestEmail: string | null;
    twToEmails: string[] | null;
    primaryContact: { contactName?: string } | null;
    contactPersons: unknown[] | null;
    parentCompanyId: number | null;
    parentCompanyName: string | null;
    syncedAt: string | null;
    // Reports' customer-source breakdown reads this directly (see
    // lib/customer-source.ts, app/api/companies/customer-source/route.ts) —
    // null means untagged, shown as "Unknown" everywhere.
    customerSource: string | null;
    // SSIC (added 2026-09-03) — synced by teamwork/sync-secretary from
    // TeamWork's own "Principal Activities" table (lib/teamwork-company-
    // profile.ts). Activity 2 fields are null for a company with only one
    // registered activity, not an error.
    ssicCode1: string | null;
    ssicDescription1: string | null;
    ssicCode2: string | null;
    ssicDescription2: string | null;
  };
  masterList: Record<string, unknown>[];
  arReminderCycles: (Record<string, unknown> & {
    daysUntilDue: number | null;
    matchedVia: 'company_id' | 'uen' | 'fuzzy';
  })[];
  invoices: {
    generated: Record<string, unknown>[];
    quickbooks: (Record<string, unknown> & { matchScore: number })[];
  };
  nomineeDirector: {
    appointments: {
      ndId: number;
      ndName: string;
      subRole: string | null;
      appointmentDate: string | null;
      cessationDate: string | null;
      isActive: boolean;
    }[];
  };
  communications: {
    drafts: Record<string, unknown>[];
  };
  documentsGenerated: Record<string, unknown>[];
  trademark: (Record<string, unknown> & { matchScore: number })[];
  // Officials (Director/Secretary/Controller/Representative/Contact
  // Person) and the real shareholder share register — both already synced
  // nightly by teamwork/sync-secretary (lib/teamwork-company-profile.ts)
  // for Post Incorporate's own UEN lookup (app/api/post-incorporate/
  // enrich/route.ts), just never surfaced on Company 360 before 2026-09-03.
  // Matched by exact UEN, not fuzzy company-name matching — both tables
  // store the real registration number directly, a more reliable join than
  // most of this file's other fuzzy sections.
  officials: Record<string, unknown>[];
  shareholders: Record<string, unknown>[];
  matchQuality: {
    warnings: string[];
  };
};

export async function getCompany360(supabase: SupabaseClient, id: number): Promise<Company360 | null> {
  const { data: companyRow } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (!companyRow) return null;

  const companyName = companyRow.company_name as string;
  const uen = companyRow.registration_no ? String(companyRow.registration_no).trim().toUpperCase() : null;
  const word = significantWord(companyName);
  const warnings: string[] = [];
  if (!uen) warnings.push('This company has no UEN on file — exact-match sections (Master List, Post Incorporate documents) could not be looked up.');
  if (!word) warnings.push('Company name has no distinguishing word to search on — fuzzy-matched sections (invoices, Nominee Director, Trademark) may be incomplete.');

  // 2026-09-02: every real fetch this function needs runs in ONE parallel
  // batch now, including the AR fuzzy-fallback candidates (arFuzzyCandidates
  // below) — Vincent reported the page felt slow to open ("点进点的速度可以
  // 提升吗"), and this query used to be a separate, sequential `await` AFTER
  // this whole batch resolved, adding one full extra Supabase round-trip on
  // top of the parallel batch's own latency for every single page load.
  // Folding it in here costs nothing extra when there's nothing to find
  // (ar_reminder is a small table, ~900 rows) and removes a guaranteed
  // sequential hop. See also preferredRegion='sin1' on the page/route
  // (this function has no region of its own — Vercel functions default to
  // a US region unless pinned, and Supabase is Tokyo-hosted, so every one
  // of these round-trips was crossing the Pacific twice for no reason).
  const [
    { data: masterListRows },
    { data: arById },
    { data: arByUen },
    { data: arFuzzyCandidates },
    { data: generatedInvoiceRows },
    { data: qbCandidateRows },
    { data: ndCandidateRows },
    { data: allNdPeople },
    { data: draftRows },
    { data: trademarkCandidateRows },
    { data: postIncorpRows },
    { data: parentRow },
    { data: officialRows },
    { data: shareholderRows },
  ] = await Promise.all([
    uen ? supabase.from('master_list').select('*').ilike('roc_no', uen) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from('ar_reminder').select('*').eq('company_id', id).or('status.is.null,status.neq.Excluded'),
    uen
      ? supabase.from('ar_reminder').select('*').is('company_id', null).eq('uen', uen).or('status.is.null,status.neq.Excluded')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    word
      ? supabase.from('ar_reminder').select('*').ilike('entity_name', `%${word}%`).or('status.is.null,status.neq.Excluded')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    // Cheap to fetch in full and match by exact normalize() key — this
    // table only ever holds one row per (company, cycle, qb_company), not
    // the full QB history, matching the same reasoning already documented
    // in app/api/ar-reminder/route.ts for its own identical full fetch.
    supabase.from('generated_invoices').select('*'),
    word ? supabase.from('quickbooks_invoices').select('*').ilike('customer_name', `%${word}%`) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    word ? supabase.from('nd_appointments').select('*').ilike('company_name', `%${word}%`) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from('nominee_directors').select('id, name'),
    supabase.from('email_drafts')
      .select('*, email_campaigns(id, type, name, fye_month, fye_year, created_at, email_senders(email, display_name))')
      .eq('company_id', id)
      .order('updated_at', { ascending: false }),
    word ? supabase.from('trademark_records').select('*').ilike('company_name', `%${word}%`) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    uen ? supabase.from('post_incorporate_operations').select('*').ilike('company_uen', uen).order('created_at', { ascending: false }) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    companyRow.parent_company_id
      ? supabase.from('companies').select('company_name').eq('id', companyRow.parent_company_id).maybeSingle()
      : Promise.resolve({ data: null as { company_name: string } | null }),
    uen
      ? supabase.from('teamwork_company_officials').select('name, role, sub_roles, id_no, id_type, address, date_of_appointment, dob, email, mobile, telephone, synced_at').ilike('uen', uen)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    uen
      ? supabase.from('teamwork_shareholder_shares').select('shareholder_name, number_of_shares, issued_share_capital, paid_up_capital, consideration_paid_up_capital, currency, share_type, share_class, share_certificate_no, synced_at').ilike('uen', uen)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // AR Reminder cycles — company_id + uen dual check (INV-AR-003, the same
  // pattern app/api/ar-reminder/generate/route.ts:248-264 already uses for
  // legacy rows predating the company_id backfill), plus a fuzzy fallback
  // pass over rows this exact-match pass didn't cover, so a genuinely
  // orphaned row (no company_id, no uen match — e.g. a UEN typo at data
  // entry) still surfaces, flagged instead of silently missing.
  const idMatched = arById ?? [];
  const uenMatched = arByUen ?? [];
  const exactIds = new Set([...idMatched, ...uenMatched].map(r => r.id as number));
  const fuzzyArRows = word
    ? fuzzyMatch(companyName, (arFuzzyCandidates ?? []).filter(r => !exactIds.has(r.id as number)), r => r.entity_name as string)
    : [];
  if (fuzzyArRows.length) warnings.push(`${fuzzyArRows.length} AR/AGM cycle row(s) matched only by company name, not company_id/UEN — verify these belong to this company.`);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const shapeArRow = (row: Record<string, unknown>, matchedVia: 'company_id' | 'uen' | 'fuzzy'): Record<string, unknown> & { daysUntilDue: number | null; matchedVia: 'company_id' | 'uen' | 'fuzzy' } => {
    const dueDate = row.due_date as string | null;
    return {
      ...row,
      daysUntilDue: dueDate
        ? Math.ceil((new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
        : null,
      matchedVia,
    };
  };
  const arReminderCycles = [
    ...idMatched.map(r => shapeArRow(r, 'company_id' as const)),
    ...uenMatched.map(r => shapeArRow(r, 'uen' as const)),
    ...fuzzyArRows.map(r => shapeArRow(r, 'fuzzy' as const)),
  ].sort((a, b) => (b.fye_year as number) - (a.fye_year as number) || String(b.fye_month).localeCompare(String(a.fye_month)));

  // generated_invoices — our own log, matched by exact normalize() key
  // (we wrote these rows ourselves under the company's own canonical name,
  // same reasoning as app/api/ar-reminder/route.ts's generatedMap).
  const normName = normalize(companyName);
  const generated = (generatedInvoiceRows ?? []).filter(r => normalize(r.company_name as string) === normName);

  const quickbooks = fuzzyMatch(companyName, qbCandidateRows ?? [], r => r.customer_name as string);
  const ndMatches = fuzzyMatch(companyName, ndCandidateRows ?? [], r => r.company_name as string);
  const ndNameById = new Map((allNdPeople ?? []).map(p => [p.id as number, p.name as string]));
  const appointments = ndMatches.map(r => {
    const cessationDate = r.cessation_date as string | null;
    return {
      ndId: r.nd_id as number,
      ndName: ndNameById.get(r.nd_id as number) ?? 'Unknown',
      subRole: r.sub_role as string | null,
      appointmentDate: r.appointment_date as string | null,
      cessationDate,
      isActive: !cessationDate || cessationDate > today,
    };
  }).sort((a, b) => String(b.appointmentDate ?? '').localeCompare(String(a.appointmentDate ?? '')));

  const trademark = fuzzyMatch(companyName, trademarkCandidateRows ?? [], r => r.company_name as string)
    .sort((a, b) => String(b.application_date ?? '').localeCompare(String(a.application_date ?? '')));

  if (quickbooks.length === 0 && (qbCandidateRows?.length ?? 0) > 0) {
    warnings.push('QuickBooks invoice candidates were found by name search but none scored high enough to confidently match — check manually if invoice history is expected.');
  }

  return {
    company: {
      id: companyRow.id,
      internalId: companyRow.internal_id ?? null,
      internalCode: companyRow.internal_code ?? null,
      companyName,
      registrationNo: companyRow.registration_no ?? null,
      companyType: companyRow.company_type ?? null,
      fyeMonth: companyRow.fye_month ?? null,
      fyeDay: companyRow.fye_day ?? null,
      twStatus: companyRow.tw_status ?? null,
      clientType: companyRow.client_type ?? null,
      isActive: companyRow.is_active ?? null,
      isNonClient: companyRow.is_non_client ?? null,
      pic: companyRow.pic ?? null,
      secPic: companyRow.sec_pic ?? null,
      usesAddress: companyRow.uses_address ?? null,
      hasNd: companyRow.has_nd ?? null,
      hasXbrl: companyRow.has_xbrl ?? null,
      hasAccounts: companyRow.has_accounts ?? null,
      hasTax: companyRow.has_tax ?? null,
      hasAnnualReturn: companyRow.has_annual_return ?? null,
      hasAgm: companyRow.has_agm ?? null,
      servicesManual: (companyRow.services_manual as Record<string, boolean> | null) ?? null,
      bestEmail: companyRow.best_email ?? null,
      twToEmails: (companyRow.tw_to_emails as string[] | null) ?? null,
      primaryContact: (companyRow.primary_contact as { contactName?: string } | null) ?? null,
      contactPersons: (companyRow.contact_persons as unknown[] | null) ?? null,
      parentCompanyId: companyRow.parent_company_id ?? null,
      parentCompanyName: parentRow?.company_name ?? null,
      customerSource: (companyRow.customer_source as string | null) ?? null,
      ssicCode1: (companyRow.ssic_code_1 as string | null) ?? null,
      ssicDescription1: (companyRow.ssic_description_1 as string | null) ?? null,
      ssicCode2: (companyRow.ssic_code_2 as string | null) ?? null,
      ssicDescription2: (companyRow.ssic_description_2 as string | null) ?? null,
      syncedAt: companyRow.synced_at ?? null,
    },
    masterList: masterListRows ?? [],
    arReminderCycles,
    invoices: { generated, quickbooks },
    nomineeDirector: { appointments },
    communications: { drafts: draftRows ?? [] },
    documentsGenerated: postIncorpRows ?? [],
    trademark,
    officials: officialRows ?? [],
    shareholders: shareholderRows ?? [],
    matchQuality: { warnings },
  };
}
