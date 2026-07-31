import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { formatContactName, type InvoiceRef } from '@/lib/email-merge';
import { applyCampaignRecipientRules, buildDefaultCcList, parseEmailList, recipientLines } from '@/lib/campaign-recipients';
import { findStaffEmails } from '@/lib/staff-directory';

/**
 * Shared company/invoice resolution for Client Communications, used by both
 * the campaign preview (shows the reviewer what WOULD be generated, before
 * anything is written) and campaign creation (which now only writes exactly
 * the row set the reviewer confirmed). Keeping one resolver means a company
 * previewed as includable is guaranteed to merge identically at creation
 * time — there is no separate "recompute" path that could drift.
 */

const FYE_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface CompanyRow {
  id: number; company_name: string; best_email: string | null;
  primary_contact: { email?: string; contactName?: string } | null;
  tw_to_emails: string[] | null; tw_cc_emails: string[] | null;
  tw_recipient_source: string | null; tw_recipient_synced_at: string | null;
  pic: string | null;
}

export interface ResolvedRow {
  companyName: string; companyId: number | null;
  toEmail: string | null; ccEmail: string | null; contactName: string;
  invoiceRefs: InvoiceRef[]; totalAmount: number;
  included: boolean; reason: string | null;
  recipientSource: 'teamwork_report' | 'company_fallback' | 'missing';
  recipientSyncedAt: string | null;
  recipientReviewRequired: boolean;
}

// extraPicValues: raw PIC-field values beyond the company's own SEC PIC
// (company.pic) — e.g. an AR cycle's acc_pic/tax_pic — each resolved
// against the staff directory and CC'd alongside the always-CC default.
// A name that doesn't resolve to a known staff member (a client's own
// accountant, "dormant", "Waiver", ...) is silently dropped, not guessed.
export function pickContact(company: CompanyRow | null, extraPicValues: (string | null | undefined)[] = []) {
  const primary = company?.primary_contact as { email?: string; contactName?: string } | null;
  const picEmails = [company?.pic, ...extraPicValues].flatMap(findStaffEmails);
  // A company can be tagged with a recipient source yet still have zero
  // to-emails (e.g. the upcoming-events report only found a staff CC for
  // it) — trusting the source label alone then silently drops best_email/
  // primary_contact, which the Contact Person report fill-in may have since
  // populated. Only treat the directory as usable when it actually has a
  // to-email; otherwise fall through to the single-contact fallback below.
  const hasTeamworkDirectory = !!company?.tw_recipient_source && Array.isArray(company?.tw_to_emails) && company.tw_to_emails.length > 0;
  if (hasTeamworkDirectory) {
    const { toEmails, ccEmails } = applyCampaignRecipientRules([
      ...(company?.tw_to_emails ?? []),
      ...(company?.tw_cc_emails ?? []),
    ]);
    return {
      email: recipientLines(toEmails),
      ccEmail: recipientLines(buildDefaultCcList([...ccEmails, ...picEmails])),
      contactName: primary?.contactName ?? company?.company_name ?? '',
      source: 'teamwork_report' as const,
      syncedAt: company?.tw_recipient_synced_at ?? null,
      reviewRequired: false,
    };
  }

  const fallback = parseEmailList(company?.best_email ?? primary?.email ?? '');
  return {
    email: recipientLines(fallback),
    ccEmail: recipientLines(buildDefaultCcList(picEmails)),
    contactName: primary?.contactName ?? company?.company_name ?? '',
    source: fallback.length ? 'company_fallback' as const : 'missing' as const,
    syncedAt: null,
    reviewRequired: true,
  };
}

export async function loadCompanies(supabase: SupabaseClient): Promise<CompanyRow[]> {
  const { data } = await supabase
    .from('companies')
    .select('id, company_name, best_email, primary_contact, tw_to_emails, tw_cc_emails, tw_recipient_source, tw_recipient_synced_at, pic')
    .eq('is_active', true);
  return (data ?? []) as CompanyRow[];
}

/** ACC/TAX PIC are AR-cycle-specific (staff can reassign them per FYE year),
 * unlike the company's own SEC PIC — only meaningful for type 'ar'. */
export async function loadArPicByCompany(
  supabase: SupabaseClient, fyeMonth?: string, fyeYear?: number,
): Promise<Map<string, { acc_pic: string | null; tax_pic: string | null }>> {
  const map = new Map<string, { acc_pic: string | null; tax_pic: string | null }>();
  if (!fyeMonth || !fyeYear) return map;
  const { data } = await supabase.from('ar_reminder')
    .select('entity_name, acc_pic, tax_pic')
    .eq('fye_month', fyeMonth).eq('fye_year', fyeYear);
  for (const r of data ?? []) map.set(normalize(r.entity_name), { acc_pic: r.acc_pic, tax_pic: r.tax_pic });
  return map;
}

export function makeCompanyFinder(companyList: CompanyRow[]) {
  return (targetName: string): CompanyRow | null => {
    const n = normalize(targetName);
    const exact = companyList.find(c => normalize(c.company_name) === n);
    if (exact) return exact;
    return findUniqueBestMatch(targetName, companyList, c => c.company_name).value;
  };
}

function fyeCycleString(fyeMonth: string, fyeYear: number) {
  const monthNum = FYE_MONTHS.indexOf(fyeMonth) + 1;
  const lastDay = new Date(fyeYear, monthNum, 0).getDate();
  return `${String(lastDay).padStart(2, '0')}.${String(monthNum).padStart(2, '0')}.${fyeYear}`;
}

/** TAO is not yet connected as a QuickBooks company, so ar/soa invoice lookups only see TAB/TAC for now. */
export async function loadInvoicesByCompany(
  supabase: SupabaseClient, type: 'letter' | 'ar' | 'soa', fyeMonth?: string, fyeYear?: number,
): Promise<Map<string, InvoiceRef[]>> {
  const invoicesByCompany = new Map<string, InvoiceRef[]>();
  if (type === 'ar' && fyeMonth && fyeYear) {
    const fyeCycle = fyeCycleString(fyeMonth, fyeYear);
    const { data: rows } = await supabase.from('generated_invoices')
      .select('company_name, qb_company, invoice_no, total_amt, qb_invoice_id, created_at')
      .eq('fye_cycle', fyeCycle)
      .order('created_at', { ascending: true });
    // A wrongly-issued invoice that gets deleted and reissued in QuickBooks
    // keeps its DocNumber, but `generated_invoices` is an append-only log —
    // the old row for the deleted invoice never goes away. Dedupe on
    // (company, qb_company, invoice_no), keeping the latest logged row,
    // so a reused number doesn't show up twice in the review list.
    const latest = new Map<string, { company_name: string; qb_company: string; invoice_no: string | null; total_amt: number | null; qb_invoice_id: string | null }>();
    for (const r of rows ?? []) {
      if (!r.invoice_no) continue;
      latest.set(`${normalize(r.company_name)}|${r.qb_company}|${r.invoice_no}`, r);
    }
    for (const r of latest.values()) {
      const key = normalize(r.company_name);
      if (!invoicesByCompany.has(key)) invoicesByCompany.set(key, []);
      invoicesByCompany.get(key)!.push({ qbCompany: r.qb_company as 'TAB' | 'TAC', invoiceNo: r.invoice_no!, amount: Number(r.total_amt ?? 0), qbInvoiceId: r.qb_invoice_id ?? null });
    }
  } else if (type === 'soa') {
    const { data: rows } = await supabase.from('quickbooks_invoices')
      .select('customer_name, qb_company, invoice_no, balance, qb_invoice_id').gt('balance', 0);
    for (const r of rows ?? []) {
      const key = normalize(r.customer_name);
      if (!invoicesByCompany.has(key)) invoicesByCompany.set(key, []);
      invoicesByCompany.get(key)!.push({ qbCompany: r.qb_company as 'TAB' | 'TAC', invoiceNo: r.invoice_no, amount: Number(r.balance ?? 0), qbInvoiceId: r.qb_invoice_id ?? null });
    }
  }
  return invoicesByCompany;
}

/** The default candidate set per type — AR reminder cycle, unpaid SOA balances, or a manual letter list. */
export async function loadAutoTargetNames(
  supabase: SupabaseClient, type: 'letter' | 'ar' | 'soa', fyeMonth?: string, fyeYear?: number, companyNames?: string[],
): Promise<string[]> {
  let targetNames: string[] = [];
  if (type === 'ar') {
    if (!fyeMonth || !fyeYear) return [];
    const { data: arRows } = await supabase.from('ar_reminder')
      .select('entity_name')
      .eq('fye_month', fyeMonth).eq('fye_year', fyeYear)
      .or('status.is.null,status.neq.Excluded');
    targetNames = (arRows ?? []).map(r => r.entity_name);
  } else if (type === 'soa') {
    const { data: unpaid } = await supabase.from('quickbooks_invoices')
      .select('customer_name').gt('balance', 0);
    targetNames = [...new Set((unpaid ?? []).map(r => r.customer_name))];
  } else {
    targetNames = companyNames ?? [];
  }
  if (companyNames?.length && type !== 'letter') {
    const allow = new Set(companyNames.map(normalize));
    targetNames = targetNames.filter(n => allow.has(normalize(n)));
  }
  return targetNames;
}

export async function loadAlreadySent(
  supabase: SupabaseClient, type: 'letter' | 'ar' | 'soa', fyeMonth?: string, fyeYear?: number,
): Promise<Set<string>> {
  const alreadySent = new Set<string>();
  const { data: sentRows } = await supabase.from('email_drafts')
    .select('company_name, campaign_id, status, email_campaigns!inner(type, fye_month, fye_year)')
    .eq('status', 'sent')
    .eq('email_campaigns.type', type)
    .eq('email_campaigns.fye_month', fyeMonth ?? '')
    .eq('email_campaigns.fye_year', fyeYear ?? 0);
  for (const r of sentRows ?? []) alreadySent.add(normalize(r.company_name));
  return alreadySent;
}

/**
 * Resolves one company name into a mergeable row. `included` is only the
 * SUGGESTED checkbox state (auto-detected problems start unchecked) — a
 * reviewer can still tick a "no invoice found" row back on manually, since
 * that reflects data lag rather than a hard block. Missing email is the one
 * truly hard block, since there is nowhere to send the draft.
 */
export function buildRow(
  rawName: string,
  findCompany: (name: string) => CompanyRow | null,
  invoicesByCompany: Map<string, InvoiceRef[]>,
  alreadySent: Set<string>,
  type: 'letter' | 'ar' | 'soa',
  arPicByCompany?: Map<string, { acc_pic: string | null; tax_pic: string | null }>,
): ResolvedRow {
  const key = normalize(rawName);
  const company = findCompany(rawName);
  const arPic = arPicByCompany?.get(key);
  const contact = pickContact(company, [arPic?.acc_pic, arPic?.tax_pic]);
  const refs = invoicesByCompany.get(key) ?? [];
  const totalAmount = refs.reduce((s, r) => s + r.amount, 0);

  let included = true;
  let reason: string | null = null;
  if (alreadySent.has(key)) { included = false; reason = 'Already sent this cycle'; }
  if (type !== 'letter' && !refs.length) { included = false; reason = 'No invoice found (TAB/TAC only — check TAO manually)'; }
  if (!contact.email) { included = false; reason = 'No email on file'; }
  else if (contact.reviewRequired) { included = false; reason = 'TeamWork Report recipients unavailable — confirm To/CC manually'; }

  return {
    companyName: rawName,
    companyId: company?.id ?? null,
    toEmail: contact.email ?? null,
    ccEmail: contact.ccEmail,
    contactName: formatContactName(contact.contactName || rawName),
    invoiceRefs: refs,
    totalAmount,
    included,
    reason,
    recipientSource: contact.source,
    recipientSyncedAt: contact.syncedAt,
    recipientReviewRequired: contact.reviewRequired,
  };
}
