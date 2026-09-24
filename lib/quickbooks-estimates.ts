import { correctedCustomerName, qbQuery, type QbCompany } from './quickbooks';

// Live read of QuickBooks Estimates ("Quotation") for the Billing System ›
// Quotation page (Vincent, 2026-09-24). A Quotation is QuickBooks' own
// Estimate entity — Tassure's DocNumbers carry a "PI" prefix (e.g. PI260067).
//
// Read LIVE on every page load, not mirrored into Supabase like Invoice /
// CreditMemo: Vincent has already said (docs/INVARIANTS.md INV-QB-021) that
// QuickBooks changes must not wait for a once-a-day sync, and the flow this
// page exists for is "Finance closes a quotation, issues the invoice" — a
// daily mirror would lag exactly that. The volume is tiny (a couple of
// hundred estimates a year across all three books), so three small queries
// are cheap; INV-QB-014 is the precedent for live QuickBooks reads where
// freshness matters. lib/quotation-trace.ts is source-agnostic, so a mirror
// can be added later without touching the trace logic if this ever needs to.

// The fixed set of books. Deliberately a literal list, never derived from a
// request parameter (INV-QB-011).
export const ESTIMATE_BOOKS: readonly QbCompany[] = ['TAB', 'TAC', 'TAO'];

export type EstimateLine = {
  kind: 'item' | 'discount' | 'text';
  item?: string | null;
  description?: string | null;
  qty?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
};

export type EstimateRecord = {
  book: QbCompany;
  // QuickBooks' own immutable Id. DocNumber is user-editable, so it is never
  // treated as identity.
  qbEstimateId: string;
  docNumber: string | null;
  txnDate: string | null;
  expirationDate: string | null;
  // Passed through correctedCustomerName() (INV-QB-012), same as every other
  // place this app copies a QuickBooks CustomerRef name.
  customerName: string;
  totalAmt: number;
  currency: string | null;
  // QuickBooks' raw TxnStatus: 'Pending' | 'Accepted' | 'Closed' | 'Rejected'.
  txnStatus: string | null;
  // Invoice-type LinkedTxn Ids — populated when the estimate was converted
  // with QuickBooks' "Copy to invoice", and ONLY ever for an invoice in the
  // SAME company file. An estimate converted to an invoice in another book
  // has no link at all, which is why the trace also matches by customer name.
  linkedInvoiceIds: string[];
  // Location (DepartmentRef) is a per-OPERATOR tag, not an ownership tag
  // (INV-QB-013) — shown for reference only.
  locationName: string | null;
  privateNote: string | null;
  lines: EstimateLine[];
  // For a Closed estimate this is the closest thing QuickBooks exposes to a
  // "closed on" timestamp — it moves on ANY later edit too, so it is an
  // approximation, never an audit fact.
  qbUpdatedAt: string | null;
};

export type BookFetchResult = { book: QbCompany; estimates: EstimateRecord[]; error: string | null };

const PAGE = 1000;
// Keeps one hung QuickBooks call from hanging the whole page: that book
// reports an error and the other two still load.
const BOOK_TIMEOUT_MS = 25_000;

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

// QuickBooks Line[] carries derived rows (SubTotalLineDetail) alongside the
// real ones — keep only the lines a person would read on the quotation.
function mapLines(raw: unknown): EstimateLine[] {
  if (!Array.isArray(raw)) return [];
  const out: EstimateLine[] = [];
  for (const line of raw as Array<Record<string, unknown>>) {
    const description = strOrNull(line.Description);
    const amount = numOrNull(line.Amount);
    if (line.DetailType === 'SalesItemLineDetail') {
      const detail = (line.SalesItemLineDetail as Record<string, unknown> | undefined) ?? {};
      const itemRef = detail.ItemRef as Record<string, unknown> | undefined;
      out.push({
        kind: 'item', item: strOrNull(itemRef?.name), description,
        qty: numOrNull(detail.Qty), unitPrice: numOrNull(detail.UnitPrice), amount,
      });
    } else if (line.DetailType === 'DiscountLineDetail') {
      out.push({ kind: 'discount', description, amount });
    } else if (line.DetailType === 'DescriptionOnly' && description) {
      out.push({ kind: 'text', description });
    }
  }
  return out;
}

export function mapEstimate(raw: Record<string, unknown>, book: QbCompany): EstimateRecord | null {
  const qbEstimateId = String(raw.Id ?? '');
  if (!qbEstimateId) return null;
  const customer = (raw.CustomerRef as Record<string, unknown> | undefined) ?? {};
  const meta = (raw.MetaData as Record<string, unknown> | undefined) ?? {};
  const linkedTxns = (raw.LinkedTxn as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    book,
    qbEstimateId,
    docNumber: strOrNull(raw.DocNumber),
    txnDate: strOrNull(raw.TxnDate),
    expirationDate: strOrNull(raw.ExpirationDate),
    customerName: correctedCustomerName(book, String(customer.value ?? ''), (customer.name as string) ?? ''),
    totalAmt: Number(raw.TotalAmt ?? 0),
    currency: strOrNull((raw.CurrencyRef as Record<string, unknown> | undefined)?.value),
    txnStatus: strOrNull(raw.TxnStatus),
    linkedInvoiceIds: linkedTxns
      .filter(t => t.TxnType === 'Invoice')
      .map(t => String(t.TxnId ?? ''))
      .filter(Boolean),
    locationName: strOrNull((raw.DepartmentRef as Record<string, unknown> | undefined)?.name),
    privateNote: strOrNull(raw.PrivateNote),
    lines: mapLines(raw.Line),
    qbUpdatedAt: strOrNull(meta.LastUpdatedTime),
  };
}

async function fetchBook(book: QbCompany, windowStart: string): Promise<BookFetchResult> {
  const fail = (error: string): BookFetchResult => ({ book, estimates: [], error });
  try {
    const where = `WHERE TxnDate >= '${windowStart}'`;

    // qbQuery() returns the FIRST key of QueryResponse as the row list — for
    // COUNT(*) that key is `totalCount`, so `rows` is a bare number at runtime
    // despite its declared array type. The count is a REQUIRED cross-check
    // here, not a nicety: qbQuery() also returns `[]` for an odd/empty
    // response (a Fault inside a 200, say), and reading live means that would
    // otherwise show up as a confident "this book has no quotations".
    // The COUNT and the first page go out together — a full sequential
    // round trip saved per book, which matters because this runs on every
    // page load. (Concurrent getValidToken() calls for one book are safe: an
    // expired token is refreshed under a distributed lease and the loser
    // waits for the winner's token.)
    const [countRes, firstPage] = await Promise.all([
      qbQuery(`SELECT COUNT(*) FROM Estimate ${where}`, book),
      qbQuery(`SELECT * FROM Estimate ${where} STARTPOSITION 1 MAXRESULTS ${PAGE}`, book),
    ]);
    if (!countRes || !firstPage) return fail(`QuickBooks ${book} not connected, token expired, or the API call failed`);
    const expected = countRes.rows as unknown;
    if (typeof expected !== 'number' || !Number.isFinite(expected)) {
      return fail(`QuickBooks ${book} returned no usable Estimate count, so the result could not be verified`);
    }

    // Array.isArray, not just `?? []` — an unexpected non-array first key must
    // end the loop rather than spin it forever.
    let pageRows = Array.isArray(firstPage.rows) ? firstPage.rows : [];
    const rows: Record<string, unknown>[] = [...pageRows];
    for (let start = 1 + PAGE; pageRows.length === PAGE; start += PAGE) {
      const page = await qbQuery(`SELECT * FROM Estimate ${where} STARTPOSITION ${start} MAXRESULTS ${PAGE}`, book);
      if (!page) return fail(`QuickBooks ${book} Estimate page failed at STARTPOSITION ${start}`);
      pageRows = Array.isArray(page.rows) ? page.rows : [];
      rows.push(...pageRows);
    }

    const byId = new Map<string, EstimateRecord>();
    for (const raw of rows) {
      const record = mapEstimate(raw, book);
      if (record) byId.set(record.qbEstimateId, record);
    }
    if (byId.size < expected) {
      return fail(`QuickBooks ${book} reports ${expected} estimates but only ${byId.size} were fetched`);
    }
    return { book, estimates: [...byId.values()], error: null };
  } catch (err) {
    return fail(`QuickBooks ${book} Estimate read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// All three books in parallel (different companies, different tokens); each
// book's failure is reported on its own and never hides the others.
export async function fetchAllEstimates(windowStart: string): Promise<BookFetchResult[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart)) throw new Error(`Invalid Estimate window start: ${windowStart}`);
  return Promise.all(ESTIMATE_BOOKS.map(book => new Promise<BookFetchResult>(resolve => {
    const timer = setTimeout(
      () => resolve({ book, estimates: [], error: `QuickBooks ${book} did not answer within ${BOOK_TIMEOUT_MS / 1000}s` }),
      BOOK_TIMEOUT_MS,
    );
    fetchBook(book, windowStart).then(result => { clearTimeout(timer); resolve(result); });
  })));
}
