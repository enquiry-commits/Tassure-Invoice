'use client';

import type { DraftLike } from '@/lib/draft-helper-client';
import type { QbCompany } from '@/lib/quickbooks';
import { todaySGT } from '@/lib/date';
import { safeFileLabel } from '@/lib/invoice-filename';
import { SoaPdfError, settleBookPdfs, type BookPdfAttempt } from '@/lib/soa-book-pdfs';
import { buildCampaignDraft, loadCampaignActor } from '@/lib/campaign-draft-client';

/**
 * The two real SOA actions — download the merged statement PDF, and build
 * the client email draft — extracted 2026-09-10 from the SOA page's own
 * SoaDetail component (app/billing/soa/_components.tsx) so the chat
 * assistant's SOA card runs THE SAME code rather than a second copy.
 *
 * Why extraction rather than a copy: this is the client-facing money
 * conversation. Recipient/CC policy, the SOA template, the campaign record
 * and the merged-PDF attachment are all decided in one place
 * (Client Communications), and a parallel chat implementation would be
 * exactly the kind of drift that has already caused real bugs in this
 * codebase (see lib/company-name.ts's header on four divergent copies of
 * one matcher). Every line below is a mechanical move from SoaDetail —
 * verify with `git diff` that the page's own behavior is unchanged.
 *
 * Chat context matters for one thing only: the assistant must never be
 * able to SEND. buildSoaDraft() stops at a prepared draft; putting that
 * draft in front of a human in OutlookStyleSendModal, and the send click
 * inside it, stay the caller's job — the same preview → click → execute
 * rule as every other chat action (INV-DATA-033).
 */

export type SoaActor = { email: string; name: string } | null;
export type SoaSender = { email: string; display_name: string | null } | null;

/** Fetch the current user + default sender the draft flow needs. */
export async function loadSoaActor(): Promise<{ me: SoaActor; sender: SoaSender }> {
  return loadCampaignActor();
}

// 'ALL' (added 2026-09-17): the combined-books mode used only by the "All"
// SOA page — Vincent: "当我在All 那边点 Draft 是要一起附带上 TAB/TAO/TAC的
// 就和之前的一样" (combine TAB+TAC+TAO into one statement/draft, matching
// how this used to work before the per-book pages existed). Every
// single-book page still passes a real QbCompany and stays scoped exactly
// as before.
export type SoaCompanySelector = QbCompany | 'ALL';

// The SOA route keeps going when some invoices can't be merged, or must go
// in as QuickBooks' own PDF (which prints accounting's split, INV-QB-029) —
// it says so in headers that nothing used to read. Tell the person.
function warnAboutSoaPdf(res: Response, label: string): void {
  const missing = Number(res.headers.get('X-Soa-Merge-Errors') ?? 0);
  const split = Number(res.headers.get('X-Soa-Split-Fallbacks') ?? 0);
  const coverFont = res.headers.get('X-Soa-Cover-Font-Fallback') === '1';
  if (!missing && !split && !coverFont) return;
  const detail = (name: string) => {
    const raw = res.headers.get(name) ?? '';
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const lines = [`${label}:`];
  if (missing) lines.push(`• ${missing} invoice PDF(s) could not be added: ${detail('X-Soa-Merge-Error-Detail')}`);
  if (split) lines.push(`• ${split} invoice(s) are QuickBooks' own PDF and show accounting's split lines: ${detail('X-Soa-Split-Fallback-Detail')}`);
  if (coverFont) lines.push("• The cover page could not load its Chinese font, so a Chinese client name or text on it is missing — check the cover before sending, and tell Vincent.");
  window.alert(lines.join('\n'));
}

/** Download the merged SOA PDF — one QuickBooks book, or 'ALL' three combined. */
export async function downloadSoaPdf(companyName: string, qbCompany: SoaCompanySelector): Promise<void> {
  const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${qbCompany}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? 'Unable to generate the combined PDF.');
  }
  warnAboutSoaPdf(res, `SOA (${qbCompany}) for ${companyName}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SOA (${qbCompany}) - ${companyName} - ${todaySGT()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open the merged SOA PDF in a NEW TAB to look at before downloading (the assistant's SOA card, Vincent 2026-10-09).
 * The tab is opened synchronously on the click, before the await — otherwise Chrome blocks it as a popup.
 */
export async function openSoaPdf(companyName: string, qbCompany: SoaCompanySelector): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${qbCompany}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? 'Unable to generate the combined PDF.');
    }
    warnAboutSoaPdf(res, `SOA (${qbCompany}) for ${companyName}`);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/**
 * Build the SOA client email draft, with the merged statement PDF already
 * attached. Returns the draft for OutlookStyleSendModal — it does NOT send.
 *
 * `templateId` (added 2026-09-17): an explicit pick from the Mail-icon
 * popover (List row and the detail modal's own Draft Email button both go
 * through it now) — lets staff choose which of the 1st/2nd/3rd escalating
 * reminder templates to send instead of always silently getting the
 * default/first 'soa' template. Optional — omitting it keeps the old
 * behavior.
 *
 * `qbCompany` (fixed 2026-09-17): now also forwarded into buildCampaignDraft
 * so the draft's BODY (invoice list/total merge fields) is scoped to this
 * same one book, matching the PDF attachment — it used to only reach the PDF
 * fetch and the campaign-name string, so a company owing on 2+ systems got a
 * TAB-titled email whose body silently listed TAO's invoices too (Vincent,
 * real client email: "tao tab 有欠款为什么只attached tab 而已"). See
 * lib/client-comms-resolve.ts's buildRow() qbCompanyFilter comment.
 *
 * `qbCompany: 'ALL'` (added same day, see SoaCompanySelector's own comment):
 * the PDF fetch already combines all 3 books server-side; here it means NOT
 * forwarding a qbCompany to buildCampaignDraft at all (`undefined`), which
 * is buildRow()'s own default — no filter, i.e. genuinely combined — rather
 * than inventing a 4th, fake "QbCompany" value that would have to be
 * special-cased through buildRow/loadInvoicesByCompany too.
 */
async function fetchBookSoaPdf(companyName: string, book: QbCompany): Promise<File> {
  const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${book}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new SoaPdfError(j.error ?? `Unable to generate the ${book} SOA PDF.`, res.status);
  }
  warnAboutSoaPdf(res, `SOA (${book}) for ${companyName}`);
  const blob = await res.blob();
  return new File([blob], `SOA (${book}) - ${safeFileLabel(companyName)}.pdf`, { type: 'application/pdf' });
}

/**
 * Every book's own SOA PDF for one company (TAB / TAC / TAO), keeping only the books that have one — a 404 is "nothing
 * outstanding in that book", anything else stops with a message naming the book (lib/soa-book-pdfs.ts). The same fetch the
 * "All" Draft Email uses (buildSoaDraft below) and the Group email (lib/soa-group-draft-client.ts) reuses per company.
 */
export async function fetchAllBookSoaPdfs(companyName: string): Promise<File[]> {
  const attempts = await Promise.all((['TAB', 'TAC', 'TAO'] as QbCompany[]).map(async (book): Promise<BookPdfAttempt<File>> => {
    try { return { book, file: await fetchBookSoaPdf(companyName, book) }; } catch (error) { return { book, error }; }
  }));
  return settleBookPdfs(attempts);
}

export async function buildSoaDraft(
  companyName: string,
  qbCompany: SoaCompanySelector,
  me: SoaActor,
  sender: SoaSender,
  templateId?: number,
): Promise<DraftLike> {
  // SOA's one difference from the other campaign types: the real Statement
  // PDF(s) replace the automatic per-invoice attachments, so they are
  // passed as `attachments` (which also clears invoice_refs — see
  // buildCampaignDraft). Everything else is the shared flow.
  //
  // 'ALL' (corrected 2026-09-18): Vincent, after seeing this attach the ONE
  // merged cross-book PDF — "其实是当我在All 的时候，就要出现TAB/TAO/TAC
  // 单独的3个SOA PDF，而这3个SOA PDF 要加到All 的 Draft 内...类似于截图中
  // 只有 TAB/TAO两家公司，所以在Drafts 的时候就只需要附带 TAB/TAO 的SOA
  // PDF，不需要TAC的" (the individual per-book PDFs should attach — for a
  // company owing on TAB+TAO only, the draft needs TAB's own PDF and TAO's
  // own PDF as two separate attachments, not TAC's, since it owes nothing
  // there). Tries all 3 books' own single-book PDF (the exact same endpoint
  // each book's own "Download SOA PDF" button already calls) and keeps only
  // the ones that succeed — a book 404ing is not a failure here, it is
  // exactly how that book's own download button already reports "nothing
  // outstanding here", so it's correctly excluded rather than surfaced as
  // an error — but ONLY a 404: any other failure (500, timeout, network)
  // stops the draft with a message naming the book (lib/soa-book-pdfs.ts;
  // Vincent 2026-10-06, "改成明确报错"), because skipping it silently left
  // that book's statement out of a collections email. downloadSoaPdf() above
  // is UNCHANGED and deliberately so — "当
  // 然在外面Download PDF的时候可以单独下载选择 TAB还是TAO的 SOA PDF" (the
  // standalone Download PDF button should still let you pick one book, or
  // the existing single merged PDF for 'ALL') — this only changes what the
  // DRAFT attaches.
  const files: File[] = qbCompany === 'ALL' ? await fetchAllBookSoaPdfs(companyName) : [await fetchBookSoaPdf(companyName, qbCompany)];

  return buildCampaignDraft({
    companyName, type: 'soa', me, sender, templateId,
    qbCompany: qbCompany === 'ALL' ? undefined : qbCompany,
    soaReminderScope: qbCompany,
    campaignName: `SOA (${qbCompany}) - ${companyName} - ${todaySGT()}`,
    attachments: files,
  });
}
