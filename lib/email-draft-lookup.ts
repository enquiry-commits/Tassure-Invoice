import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { resolveCompany } from '@/lib/company-name';
import {
  loadCompanies, loadInvoicesByCompany, loadAlreadySent, loadArPicByCompany, buildRow, makeCompanyFinder,
  type CompanyRow, type ResolvedRow,
} from '@/lib/client-comms-resolve';

/**
 * READ-ONLY preview of the client email chat would draft (2026-09-10).
 *
 * Client Communications was the largest remaining feature locked inside its
 * own page: chat could tell you whether an email had been sent
 * (check_email_status) but could not draft one, which is the actual daily
 * work. See INV-DATA-037 — an answer that only links to the page leaves the
 * job undone.
 *
 * Everything here reuses lib/client-comms-resolve.ts, the single owner of
 * recipient/CC policy (TeamWork report recipients → company fallback → the
 * staff CCs derived from SEC/ACC/TAX PIC). Chat must never grow a second
 * opinion about who a client email goes to: getting that wrong sends a
 * client's financial statement to the wrong address.
 *
 * This function writes NOTHING. It resolves who the mail would go to and
 * what would be attached; creating the campaign draft and sending it stay
 * on the user's click, in the same Outlook review window the pages use.
 */

export type EmailDraftType = 'letter' | 'ar' | 'soa';

export type EmailDraftPreview = {
  companyName: string;
  type: EmailDraftType;
  fyeMonth?: string;
  fyeYear?: number;
  toEmail: string | null;
  ccEmail: string | null;
  contactName: string;
  // Where the To address came from — a 'missing' here is the single most
  // common reason a draft cannot be created, so it is surfaced explicitly
  // rather than left for the user to discover at send time.
  recipientSource: 'teamwork_report' | 'company_fallback' | 'missing';
  recipientReviewRequired: boolean;
  invoiceCount: number;
  invoiceNumbers: string[];
  totalAmount: number;
  // buildRow()'s own verdict, passed through verbatim rather than
  // re-derived here: it is what Campaign Centre itself would show for this
  // company ("Already sent this cycle", "No invoice found", "No email on
  // file", "TeamWork Report recipients unavailable — confirm To/CC
  // manually"). Reinterpreting it in a second place is exactly how the two
  // surfaces would start disagreeing about whether a client was emailed.
  autoIncluded: boolean;
  autoReason: string | null;
  templateName: string | null;
  canDraft: boolean;
  blockedReason: string | null;
};

export type EmailDraftResult =
  | { found: true; preview: EmailDraftPreview }
  | { found: false; ambiguous: true; message: string; candidates: string[] }
  | { found: false; ambiguous?: false; message: string };

export async function previewEmailDraft(
  companyQuery: string,
  type: EmailDraftType,
  fyeMonth?: string,
  fyeYear?: number,
): Promise<EmailDraftResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();
  if (!trimmed) return { found: false, message: 'A company name is required.' };
  if (type === 'ar' && (!fyeMonth || !fyeYear)) {
    return { found: false, message: 'An AR reminder email is always for one specific FYE cycle — ask the user which FYE month and year before drafting.' };
  }

  const [companyList, invoicesByCompany, alreadySentSet, arPicByCompany, templates] = await Promise.all([
    loadCompanies(sb),
    loadInvoicesByCompany(sb, type, fyeMonth, fyeYear),
    loadAlreadySent(sb, type, fyeMonth, fyeYear),
    type === 'ar' ? loadArPicByCompany(sb, fyeMonth, fyeYear) : Promise.resolve(new Map<string, { acc_pic: string | null; tax_pic: string | null }>()),
    sb.from('email_templates').select('name, is_default').eq('type', type).then(r => r.data ?? []),
  ]);

  // Same ambiguity handling as every other chat lookup — several real
  // companies matching a short brand word is a question to ask, not a
  // "not found" (see resolveCompany's own comment).
  const resolution = resolveCompany(trimmed, companyList, c => c.company_name);
  if (resolution.kind === 'ambiguous') {
    return {
      found: false, ambiguous: true,
      message: `Several companies match "${trimmed}" — ask which one before drafting anything.`,
      candidates: resolution.candidates.map(c => c.company_name),
    };
  }
  if (resolution.kind === 'none') return { found: false, message: `No active company matched "${trimmed}".` };
  const company: CompanyRow = resolution.kind === 'exact' ? resolution.value : resolution.value;

  const findCompany = makeCompanyFinder(companyList);
  const row: ResolvedRow = buildRow(company.company_name, findCompany, invoicesByCompany, alreadySentSet, type, arPicByCompany);

  const template = templates.find(t => t.is_default) ?? templates[0] ?? null;
  const blockedReason =
    !row.toEmail ? 'No valid recipient email on file for this company — it has to be resolved in Campaign Centre first.'
    : !template ? `No ${type.toUpperCase()} template exists — one has to be added in Client Communications › Templates first.`
    : null;

  return {
    found: true,
    preview: {
      companyName: row.companyName,
      type, fyeMonth, fyeYear,
      toEmail: row.toEmail,
      ccEmail: row.ccEmail,
      contactName: row.contactName,
      recipientSource: row.recipientSource,
      recipientReviewRequired: row.recipientReviewRequired,
      invoiceCount: row.invoiceRefs.length,
      invoiceNumbers: row.invoiceRefs.map(i => i.invoiceNo).filter(Boolean).slice(0, 6),
      totalAmount: row.totalAmount,
      autoIncluded: row.included,
      autoReason: row.reason,
      templateName: template?.name ?? null,
      canDraft: !blockedReason,
      blockedReason,
    },
  };
}
