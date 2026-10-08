import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { todaySGT } from './date';
import { fetchAllEstimates } from './quickbooks-estimates';
import { traceQuotations, TRACE_GRACE_DAYS, type QuotationRow, type TraceInvoiceInput } from './quotation-trace';
import { applyReviews, purgeCutoffIso, reviewKey, windowStart12Months, type LiveInvoiceState, type QuotationRowView, type ReviewRecord } from './quotation-reviews';
import type { QbCompany } from './quickbooks';
import { getApprovedAccount } from './approved-accounts';

// I/O half of the Quotation page (the pure join is lib/quotation-trace.ts):
// estimates read LIVE from QuickBooks (lib/quickbooks-estimates.ts for why),
// invoices from the synced quickbooks_invoices table (already near-real-time
// via the webhook, INV-QB-021).

export type QuotationBookStatus = { book: QbCompany; ok: boolean; count: number; error: string | null };

export type QuotationData = {
  rows: QuotationRowView[];
  books: QuotationBookStatus[];
  // False until scripts/add-quotation-reviews.sql has been run — the page then says so and
  // does not offer Completed / Remarks (nothing could be saved).
  reviewsReady: boolean;
  // Estimates dated before this are not shown: the page lists the last 12 months only
  // (Vincent, 2026-10-07 — a completed PI's record is deleted a year after it was completed,
  // and by then the PI is older than this window, so it cannot come back into the list).
  windowStart: string;
  traceGraceDays: number;
  generatedAt: string;
};

// Thrown for conditions a person can act on (incomplete data) — the API route
// turns the message into its 503 body.
export class QuotationDataError extends Error {}

type InvoiceDb = {
  id: number;
  qb_company: string;
  qb_invoice_id: string;
  invoice_no: string | null;
  txn_date: string | null;
  customer_name: string | null;
  total_amt: number | null;
  balance: number | null;
  status: string | null;
};

const isBook = (v: string): v is QbCompany => v === 'TAB' || v === 'TAC' || v === 'TAO';

// Every synced invoice dated on/after windowStart — a superset of what the
// name-based trace needs, loaded WHOLE (about 8,000 rows) so it can run
// alongside the slower QuickBooks reads instead of waiting for them to say
// which date it could start from. It also covers every QuickBooks-linked
// invoice, which can only ever be inside the synced window anyway.
async function loadWindowInvoices(supabase: SupabaseClient, windowStart: string): Promise<TraceInvoiceInput[]> {
  // pageAll() swallows query errors and returns []. Probe with an
  // error-returning head count first, then verify the load against it.
  const probe = await supabase.from('quickbooks_invoices').select('*', { count: 'exact', head: true }).gte('txn_date', windowStart);
  if (probe.error) throw new QuotationDataError(probe.error.message);

  // pageAll() orders every page by the unique id (INV-DATA-066) — this exact
  // txn_date-filtered read is what first exposed that unordered offset paging
  // silently duplicated 650 rows and dropped 650 others out of 2,324.
  const loaded = (await pageAll(() => supabase
    .from('quickbooks_invoices')
    .select('id, qb_company, qb_invoice_id, invoice_no, txn_date, customer_name, total_amt, balance, status')
    .gte('txn_date', windowStart))) as InvoiceDb[];

  // A short/duplicated load raises nothing — it would just turn real invoices
  // into a confident-looking "not found". Refuse instead.
  const distinct = new Set(loaded.map(r => r.id)).size;
  if (distinct !== (probe.count ?? 0)) {
    throw new QuotationDataError(`Invoice data incomplete: loaded ${distinct} of ${probe.count} invoices dated on/after ${windowStart}. Refresh to try again.`);
  }

  const out: TraceInvoiceInput[] = [];
  for (const row of loaded) {
    if (!isBook(row.qb_company)) continue;
    out.push({
      book: row.qb_company,
      qbInvoiceId: row.qb_invoice_id,
      invoiceNo: row.invoice_no,
      txnDate: row.txn_date,
      customerName: row.customer_name,
      totalAmt: Number(row.total_amt ?? 0),
      balance: Number(row.balance ?? 0),
      status: row.status ?? 'Open',
    });
  }
  return out;
}

// Quotations created through this system's New Quotation
// (app/api/quickbooks/create-quotation logs a 'create_quotation' event with
// the creating account) — QuickBooks itself records no user on an Estimate.
// Best-effort: if this read fails, those rows fall back to their QuickBooks
// Location like every other quotation, so the page still loads.
async function loadSystemCreators(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('user_activity_events')
    .select('account_email, detail, created_at')
    .eq('event_type', 'create_quotation')
    .order('created_at', { ascending: true });
  const creators = new Map<string, string>();
  if (error) {
    console.error('Quotation creators: could not read create_quotation events:', error.message);
    return creators;
  }
  for (const row of (data ?? []) as Array<{ account_email: string; detail: { book?: unknown; qbEstimateId?: unknown } | null }>) {
    const book = typeof row.detail?.book === 'string' ? row.detail.book : null;
    const id = row.detail?.qbEstimateId == null ? null : String(row.detail.qbEstimateId);
    if (!book || !id) continue;
    creators.set(`${book}|${id}`, getApprovedAccount(row.account_email)?.name ?? row.account_email);
  }
  return creators;
}

export type LiveQuotations = Omit<QuotationData, 'rows' | 'reviewsReady'> & { rows: QuotationRow[] };

// Every estimate read live and matched to invoices — no review (Completed / Remarks) applied. The
// "Completed" action freezes the trace of exactly THIS result, so it must be the live one.
export async function loadLiveQuotations(): Promise<LiveQuotations> {
  const windowStart = windowStart12Months(todaySGT());
  const supabase = createAdminClient();

  const [fetched, invoices, systemCreators] = await Promise.all([
    fetchAllEstimates(windowStart),
    loadWindowInvoices(supabase, windowStart),
    loadSystemCreators(supabase),
  ]);

  const rows = traceQuotations(fetched.flatMap(f => f.estimates), invoices, { today: todaySGT(), graceDays: TRACE_GRACE_DAYS, systemCreators });

  return {
    rows,
    books: fetched.map(f => ({ book: f.book, ok: f.error === null, count: f.estimates.length, error: f.error })),
    windowStart,
    traceGraceDays: TRACE_GRACE_DAYS,
    generatedAt: new Date().toISOString(),
  };
}

const isMissingReviewsTable = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || /quotation_reviews.*(does not exist|schema cache)/i.test(error?.message ?? '');

export async function loadQuotationData(): Promise<QuotationData> {
  const supabase = createAdminClient();
  const [live, reviews] = await Promise.all([
    loadLiveQuotations(),
    supabase.from('quotation_reviews').select('qb_company, qb_estimate_id, remarks, completed_at, completed_by_email, completed_trace'),
  ]);
  if (reviews.error && !isMissingReviewsTable(reviews.error)) throw new QuotationDataError(`Could not read quotation reviews: ${reviews.error.message}`);
  const reviewsReady = !reviews.error;

  // A completed PI's record is kept one year after it was completed, then deleted (best effort — a failure here
  // must never stop the page). The rows below are what was read BEFORE the delete; one already past the year is
  // simply shown until the next load, which is harmless.
  if (reviewsReady) {
    const { error } = await supabase.from('quotation_reviews').delete().lt('completed_at', purgeCutoffIso(new Date()));
    if (error) console.error('Quotation reviews clean-up failed:', error.message);
  }

  const records = (reviews.data ?? []) as ReviewRecord[];

  // The frozen invoices' paid state is read live (their membership and amounts stay frozen).
  const liveState = new Map<string, LiveInvoiceState>();
  const frozen = records.filter(r => r.completed_trace).flatMap(r => r.completed_trace!.invoices);
  const ids = [...new Set(frozen.map(i => i.qbInvoiceId))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('quickbooks_invoices').select('qb_company, qb_invoice_id, balance, status').in('qb_invoice_id', ids.slice(i, i + 200));
    if (error) { console.error('Quotation paid-state refresh failed:', error.message); break; }
    for (const inv of data ?? []) liveState.set(reviewKey(inv.qb_company, inv.qb_invoice_id), { balance: Number(inv.balance ?? 0), status: inv.status ?? 'Open' });
  }

  return { ...live, rows: applyReviews(live.rows, records, liveState), reviewsReady };
}
