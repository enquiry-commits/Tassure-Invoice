// What an invoice reference of a draft becomes when it is re-read from QuickBooks right before the draft opens / sends
// (app/api/client-communications/drafts/refresh-amounts/route.ts). Pure, so `npx tsx test-draft-refresh.ts` can pin it.
// docs/INVARIANTS.md INV-MAIL-007.
//
// The amount a draft quotes depends on what the email is about:
//  - AR renewal and letter drafts quote the WHOLE invoice (`TotalAmt`) — the client is asked to pay that invoice.
//  - an SOA draft quotes what is STILL OWED on each invoice (the invoice's `Balance`, which is what the attached statement shows
//    and what the draft was created with: the AR aging's open balance). Reading `TotalAmt` here wrote a partly paid invoice at its
//    full total into the email body — Easybook Pay TAB #02510178: invoice S$1,660, S$200 still owed, the statement said 200 and the
//    email 1,660 (26 open invoices on 2026-10-07). Vincent, 2026-10-07: "改成读未付余额".
// Both quote Singapore dollars: an invoice raised in another currency (FAITH CAPITAL GLOBAL FUND VCC's four TAB invoices are USD 507.55 each at
// 1.2861, S$652.76, which is what the AR aging and the statement hold) is converted at its own exchange rate — QuickBooks' `Balance` and
// `TotalAmt` are in the INVOICE's currency, and "S$507.55" in an email is simply wrong. Both still pick up a renumbered invoice
// (INV-QB-030). A value QuickBooks did not return leaves the reference as it was (the refresh fails open), and the reference keeps its
// place, its book and its QuickBooks Id — the caller pairs attachments with references by index.
import type { InvoiceRef } from './email-merge';

export type RefreshCampaignType = 'letter' | 'ar' | 'soa';
export type LiveInvoiceRow = { DocNumber?: unknown; TotalAmt?: unknown; Balance?: unknown; ExchangeRate?: unknown } | null | undefined;

/**
 * An SOA body is a SUM: its invoice lines plus any credit note, payment or journal entry — lines that carry no QuickBooks Id and
 * cannot be re-read. Re-pricing only the invoices of such a draft double counts whatever accounting applied to an invoice since the
 * draft was made: a credit note of -400 applied to a 1,000 invoice makes the invoice's Balance 600 while the frozen -400 stays, so the
 * body would say 200 when the client still owes 600. A draft with such a line therefore keeps its amounts (a renumbered invoice is
 * still renamed); AR and letter drafts are not sums of that kind. Found by the independent review of 2026-10-07.
 */
export function amountsAreRefreshable(refs: ReadonlyArray<Pick<InvoiceRef, 'qbInvoiceId'>>, campaignType: RefreshCampaignType): boolean {
  return campaignType !== 'soa' || refs.every(r => !!r.qbInvoiceId);
}

export function refreshInvoiceRef(ref: InvoiceRef, live: LiveInvoiceRow, campaignType: RefreshCampaignType, repriceAmount = true): InvoiceRef {
  const raw = campaignType === 'soa' ? live?.Balance : live?.TotalAmt;
  const rate = typeof live?.ExchangeRate === 'number' && live.ExchangeRate > 0 ? live.ExchangeRate : 1;
  const liveNumber = live?.DocNumber;
  return {
    ...ref,
    ...(repriceAmount && typeof raw === 'number' ? { amount: Math.round(raw * rate * 100) / 100 } : {}),
    ...(typeof liveNumber === 'string' && liveNumber.trim() ? { invoiceNo: liveNumber.trim() } : {}),
  };
}
