import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { thisYearSGT, todaySGT } from './date';
import { fetchAllEstimates } from './quickbooks-estimates';
import { traceQuotations, TRACE_GRACE_DAYS, type QuotationRow, type TraceInvoiceInput } from './quotation-trace';
import type { QbCompany } from './quickbooks';

// I/O half of the Quotation page (the pure join is lib/quotation-trace.ts):
// estimates read LIVE from QuickBooks (lib/quickbooks-estimates.ts for why),
// invoices from the synced quickbooks_invoices table (already near-real-time
// via the webhook, INV-QB-021).

export type QuotationBookStatus = { book: QbCompany; ok: boolean; count: number; error: string | null };

export type QuotationData = {
  rows: QuotationRow[];
  books: QuotationBookStatus[];
  // Estimates dated before this are not shown: quickbooks_invoices only holds
  // this year and the two before it, so an older Closed quotation's invoice
  // could not be found and would read as a misleading "not found".
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

export async function loadQuotationData(): Promise<QuotationData> {
  const windowStart = `${thisYearSGT() - 2}-01-01`;
  const supabase = createAdminClient();

  const [fetched, invoices] = await Promise.all([
    fetchAllEstimates(windowStart),
    loadWindowInvoices(supabase, windowStart),
  ]);

  const rows = traceQuotations(fetched.flatMap(f => f.estimates), invoices, { today: todaySGT(), graceDays: TRACE_GRACE_DAYS });

  return {
    rows,
    books: fetched.map(f => ({ book: f.book, ok: f.error === null, count: f.estimates.length, error: f.error })),
    windowStart,
    traceGraceDays: TRACE_GRACE_DAYS,
    generatedAt: new Date().toISOString(),
  };
}
