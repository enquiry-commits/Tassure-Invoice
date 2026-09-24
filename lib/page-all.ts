/**
 * Fetch every row of a Supabase query that exceeds the 1000-row response cap.
 *
 * Unlike a naive loop (one round-trip per page, serial — ~9 sequential trips
 * to Tokyo for the invoice-items table), this fires pages in parallel waves of
 * `batch`, so total latency is ~ceil(pages/batch) round-trips.
 *
 * `makeQuery` must return a FRESH query builder each call (builders are
 * single-use once `.range()` is applied).
 *
 * Two guarantees this helper owns so no caller has to remember them
 * (docs/INVARIANTS.md INV-DATA-066):
 *
 * 1. EVERY page request carries a unique tiebreaker ordering (`id` by default,
 *    appended AFTER whatever ordering the caller already asked for). Offset
 *    paging without a total order is not stable in PostgREST and fails
 *    SILENTLY — measured on the real `quickbooks_invoices` table (a
 *    txn_date-filtered read, 2,324 rows): 307 to 650 rows duplicated and the
 *    same number MISSING, with no error at all; it was live in AR Reminder's
 *    per-company "Invoice" column (13% of the year's invoices randomly absent
 *    on every load) until this fix. Callers that already order by something
 *    non-unique keep that as the primary order; only ties get broken.
 *
 * 2. A failed page THROWS. It used to be swallowed (`data ?? []`), which meant
 *    one bad page quietly returned partial data — and if it happened to be the
 *    last page of a wave, the "short page means we're done" check below ended
 *    the whole read early. Wrong money figures are worse than an error.
 *
 * `tiebreaker` is the unique column to order by; every table this app pages
 * has `id` (checked 2026-09-24), so the default is right — pass another unique
 * column only for a table that genuinely lacks one.
 */
const PAGE = 1000;

type PageResult<T> = { data: T[] | null; error?: { message: string; code?: string } | null };

export async function pageAll<T>(
  makeQuery: () => PromiseLike<{ data: T[] | null }>,
  batch = 5,
  tiebreaker = 'id',
): Promise<T[]> {
  type Paged = {
    order: (column: string, options: { ascending: boolean }) => Paged;
    range: (from: number, to: number) => PromiseLike<PageResult<T>>;
  };
  const fetchPage = async (idx: number): Promise<T[]> => {
    const query = (makeQuery() as unknown as Paged).order(tiebreaker, { ascending: true });
    const { data, error } = await query.range(idx * PAGE, idx * PAGE + PAGE - 1);
    if (error) throw new Error(`pageAll: page ${idx} failed${error.code ? ` (${error.code})` : ''}: ${error.message}`);
    return data ?? [];
  };
  const out: T[] = [];
  for (let wave = 0; ; wave++) {
    const pages = await Promise.all(
      Array.from({ length: batch }, (_, i) => fetchPage(wave * batch + i)),
    );
    for (const p of pages) out.push(...p);
    // The last page of the wave being short means there's nothing beyond it.
    if (pages[batch - 1].length < PAGE) break;
  }
  return out;
}
