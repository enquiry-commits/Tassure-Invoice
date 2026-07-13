/**
 * Fetch every row of a Supabase query that exceeds the 1000-row response cap.
 *
 * Unlike a naive loop (one round-trip per page, serial — ~9 sequential trips
 * to Tokyo for the invoice-items table), this fires pages in parallel waves
 * of `batch`, so total latency is ~ceil(pages/batch) round-trips.
 *
 * `makeQuery` must return a FRESH query builder each call (builders are
 * single-use once `.range()` is applied).
 */
const PAGE = 1000;

export async function pageAll<T>(
  makeQuery: () => PromiseLike<{ data: T[] | null }>,
  batch = 5,
): Promise<T[]> {
  type Ranged = { range: (a: number, b: number) => PromiseLike<{ data: T[] | null }> };
  const fetchPage = async (idx: number): Promise<T[]> => {
    const { data } = await (makeQuery() as unknown as Ranged).range(idx * PAGE, idx * PAGE + PAGE - 1);
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
