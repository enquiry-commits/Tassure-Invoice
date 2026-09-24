import { normalize } from './company-name';
import type { QbCompany } from './quickbooks';
import type { EstimateLine, EstimateRecord } from './quickbooks-estimates';

// The Quotation page's join (Vincent, 2026-09-24): every QuickBooks Estimate,
// and — for a CLOSED one — which book(s) the resulting invoice(s) were issued
// in. PURE on purpose (no database, no QuickBooks): lib/quotation-data.ts loads
// the inputs and test-quotation-trace.ts feeds it fixtures. Nothing derived
// here is ever persisted, so it can never go stale relative to the invoice
// sync and can never rewrite history.
//
// How an invoice is tied to a quotation, strongest evidence first:
//  1. `quickbooks_link` — QuickBooks' own LinkedTxn (the estimate was
//     converted with "Copy to invoice"). Authoritative, but ONLY exists when
//     the invoice is in the SAME QuickBooks company file as the estimate.
//     Shown for an estimate in any status (a partly-converted one can still be
//     open).
//  2. `name_match` — an estimate in one book converted to an invoice in
//     ANOTHER book has no link anywhere in QuickBooks. Vincent's own words:
//     the customer name on these documents is unified across books (no UEN),
//     so the same normalize()d customer name, on an invoice dated inside the
//     quotation's lifetime, is the trace. CLOSED estimates only. Exact match
//     only — no fuzzy candidates (his choice; docs/INVARIANTS.md INV-QB-024).

// How far past the estimate's last update (≈ its closing) an invoice may
// still be attributed to it. Without an upper bound every later invoice for
// the same customer would qualify — real data: 4 unrelated August invoices for
// Bestar in TAB/TAC/TAO after PI260067 closed on 2026-07-30, each its own,
// later service. One tunable constant, deliberately not smarter than that.
export const TRACE_GRACE_DAYS = 7;

const SGT = 'Asia/Singapore';
const AMOUNT_EPSILON = 0.005;
const BOOK_ORDER: readonly QbCompany[] = ['TAB', 'TAC', 'TAO'];

export type QuotationStatusGroup = 'open' | 'closed' | 'rejected';

// What the trace needs to know about one synced invoice
// (quickbooks_invoices — which has no currency column).
export type TraceInvoiceInput = {
  book: QbCompany;
  qbInvoiceId: string;
  invoiceNo: string | null;
  txnDate: string | null;
  customerName: string | null;
  totalAmt: number;
  balance: number;
  // 'Open' | 'Paid' | 'Voided'
  status: string;
};

export type QuotationTraceInvoice = {
  source: QbCompany;
  qbInvoiceId: string;
  invoiceNo: string | null;
  txnDate: string | null;
  // The invoice's OWN customer name, shown so a suffix collision ("Pte Ltd"
  // vs "Limited" normalize to the same key) is visible, not silent.
  customerName: string;
  totalAmt: number;
  balance: number;
  status: string;
  via: 'quickbooks_link' | 'name_match';
  // true/false when comparable; null when the quotation is not in SGD (the
  // invoices table has no currency to compare against, INV-QB-016).
  amountMatches: boolean | null;
};

export type QuotationTrace = {
  // linked = QuickBooks itself recorded a conversion to an invoice (even if
  // that invoice is missing from our synced data — see
  // unresolvedLinkedInvoiceIds); name_match = only name-based candidates;
  // none = Closed but nothing found (not an error — a quotation can be closed
  // without ever being invoiced); not_applicable = not Closed and no link.
  status: 'linked' | 'name_match' | 'none' | 'not_applicable';
  invoices: QuotationTraceInvoice[];
  // Distinct books the invoice(s) were issued in, TAB/TAC/TAO order. Voided
  // invoices do not count. An unresolved QuickBooks link still counts: the
  // link is same-book by construction, so its book is the estimate's own.
  sources: QbCompany[];
  // Sum of the (non-voided) traced invoices, shown next to the quotation
  // total so a person can judge the candidates: real data — Pearl Works'
  // $8,050 quotation traces to TAB $2,000 + TAC $6,050 = exactly $8,050,
  // while another quotation whose own linked TAB invoice already equals its
  // total also picks up an unrelated $6,000 TAC invoice by name (traced
  // $14,560 vs $8,560). The number makes that visible; nothing here decides.
  tracedTotal: number;
  // Two or more (non-voided) traced invoices that together equal the
  // quotation total — a quotation split across invoices/books.
  sumMatchesTotal: boolean;
  // QuickBooks says the estimate was converted to these Invoice Ids (in the
  // estimate's own book) but they are not in our synced invoice data
  // (deleted in QuickBooks, older than the sync window, or not synced yet).
  unresolvedLinkedInvoiceIds: string[];
  // The invoice-date window the name-based match searched, null when it did
  // not run (not Closed, or a date it needs is missing).
  nameMatchWindow: { from: string; to: string } | null;
};

export type QuotationRow = {
  source: QbCompany;
  qbEstimateId: string;
  docNumber: string | null;
  txnDate: string | null;
  expirationDate: string | null;
  customerName: string;
  totalAmt: number;
  currency: string | null;
  txnStatus: string | null;
  statusGroup: QuotationStatusGroup;
  locationName: string | null;
  privateNote: string | null;
  lines: EstimateLine[];
  // SGT date of the estimate's last update — for a Closed one, the closest
  // thing QuickBooks exposes to a closing date (any later edit moves it too).
  closedOn: string | null;
  daysOpen: number | null;
  trace: QuotationTrace;
};

export function statusGroupOf(txnStatus: string | null): QuotationStatusGroup {
  if (txnStatus === 'Closed') return 'closed';
  if (txnStatus === 'Rejected') return 'rejected';
  return 'open';
}

// QuickBooks timestamps carry a US-Pacific offset; the invoice dates they are
// compared with are plain calendar dates, so convert to the SGT date first.
export function sgtDateOf(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: SGT });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

export function traceQuotations(
  estimates: EstimateRecord[],
  invoices: TraceInvoiceInput[],
  opts: { today: string; graceDays?: number },
): QuotationRow[] {
  const graceDays = opts.graceDays ?? TRACE_GRACE_DAYS;

  const invoiceByKey = new Map<string, TraceInvoiceInput>();
  const invoicesByName = new Map<string, TraceInvoiceInput[]>();
  for (const inv of invoices) {
    invoiceByKey.set(`${inv.book}|${inv.qbInvoiceId}`, inv);
    // The same normalize() key the rest of the app joins company names on
    // (INV-DATA-040). An empty key would match every blank name — skip it.
    const key = normalize(inv.customerName ?? '');
    if (!key) continue;
    const list = invoicesByName.get(key);
    if (list) list.push(inv); else invoicesByName.set(key, [inv]);
  }

  // An invoice QuickBooks itself linked to some estimate must never also show
  // up as a name-match "candidate" under a different one.
  const linkedToAnyEstimate = new Set<string>();
  for (const e of estimates) for (const id of e.linkedInvoiceIds) linkedToAnyEstimate.add(`${e.book}|${id}`);

  const rows: QuotationRow[] = estimates.map(e => {
    const group = statusGroupOf(e.txnStatus);
    const closedOn = e.qbUpdatedAt ? sgtDateOf(e.qbUpdatedAt) : null;
    // Only a quotation in SGD can be compared with the (currency-less) invoice
    // table's amounts.
    const amountComparable = !e.currency || e.currency === 'SGD';
    const toTraced = (inv: TraceInvoiceInput, via: QuotationTraceInvoice['via']): QuotationTraceInvoice => ({
      source: inv.book,
      qbInvoiceId: inv.qbInvoiceId,
      invoiceNo: inv.invoiceNo,
      txnDate: inv.txnDate,
      customerName: inv.customerName ?? '',
      totalAmt: inv.totalAmt,
      balance: inv.balance,
      status: inv.status,
      via,
      amountMatches: amountComparable ? Math.abs(inv.totalAmt - e.totalAmt) < AMOUNT_EPSILON : null,
    });

    const traced: QuotationTraceInvoice[] = [];
    const unresolved: string[] = [];

    for (const id of e.linkedInvoiceIds) {
      const inv = invoiceByKey.get(`${e.book}|${id}`);
      if (inv) traced.push(toTraced(inv, 'quickbooks_link')); else unresolved.push(id);
    }

    // The name-based trace needs both ends of its window; without a closing
    // timestamp or a quotation date there is nothing principled to bound it
    // with, so skip it rather than guess.
    let nameMatchWindow: QuotationTrace['nameMatchWindow'] = null;
    const key = normalize(e.customerName);
    if (group === 'closed' && key && e.txnDate && closedOn) {
      nameMatchWindow = { from: e.txnDate, to: addDays(closedOn, graceDays) };
      for (const inv of invoicesByName.get(key) ?? []) {
        if (inv.status === 'Voided') continue;
        if (!inv.txnDate || inv.txnDate < nameMatchWindow.from || inv.txnDate > nameMatchWindow.to) continue;
        if (linkedToAnyEstimate.has(`${inv.book}|${inv.qbInvoiceId}`)) continue;
        traced.push(toTraced(inv, 'name_match'));
      }
    }

    traced.sort((a, b) =>
      (a.via === b.via ? 0 : a.via === 'quickbooks_link' ? -1 : 1)
      || (a.txnDate ?? '').localeCompare(b.txnDate ?? '')
      || a.source.localeCompare(b.source));

    const real = traced.filter(t => t.status !== 'Voided');
    const sum = Math.round(real.reduce((s, t) => s + t.totalAmt, 0) * 100) / 100;
    const sources = BOOK_ORDER.filter(b => real.some(t => t.source === b) || (unresolved.length > 0 && b === e.book));

    const status: QuotationTrace['status'] =
      e.linkedInvoiceIds.length > 0 ? 'linked'
        : traced.length > 0 ? 'name_match'
          : group === 'closed' ? 'none'
            : 'not_applicable';

    return {
      source: e.book,
      qbEstimateId: e.qbEstimateId,
      docNumber: e.docNumber,
      txnDate: e.txnDate,
      expirationDate: e.expirationDate,
      customerName: e.customerName,
      totalAmt: e.totalAmt,
      currency: e.currency,
      txnStatus: e.txnStatus,
      statusGroup: group,
      locationName: e.locationName,
      privateNote: e.privateNote,
      lines: e.lines,
      closedOn,
      daysOpen: group === 'open' && e.txnDate ? Math.max(0, dayDiff(e.txnDate, opts.today)) : null,
      trace: {
        status,
        invoices: traced,
        sources,
        tracedTotal: sum,
        sumMatchesTotal: amountComparable && real.length > 1 && Math.abs(sum - e.totalAmt) < AMOUNT_EPSILON,
        unresolvedLinkedInvoiceIds: unresolved,
        nameMatchWindow,
      },
    };
  });

  rows.sort((a, b) =>
    (b.txnDate ?? '').localeCompare(a.txnDate ?? '')
    || (b.docNumber ?? '').localeCompare(a.docNumber ?? ''));
  return rows;
}
