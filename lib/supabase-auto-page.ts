/**
 * Completes a Supabase read that PostgREST silently truncated at its row cap.
 *
 * The problem (docs/INVARIANTS.md INV-DATA-006 / INV-DATA-066): this project's
 * PostgREST returns at most 1,000 rows for any read that does not page
 * explicitly — no error, no warning, just the first 1,000 rows in an
 * unspecified order — so a plain `.select()` on a table that has grown past
 * 1,000 rows quietly loses the rest. Measured 2026-09-24: the assistant's
 * Master List edit tool read `master_list` (1,599 rows) this way and could not
 * see 599 of them — 218 of 788 ACTIVE clients among them ("has no Master List
 * row, so there is nothing to edit there") — and `generated_invoices` (945
 * rows, +41/month), `ar_reminder` (917, +50/month) and `companies` (952) are
 * weeks from the same cliff under dozens of unpaginated reads.
 *
 * The fix, at the one place every server-side table read goes through
 * (lib/supabase.ts): when — and ONLY when — a plain GET read comes back with
 * exactly the cap's signature (`Content-Range: 0-999/*`, no explicit
 * limit/offset/Range, no count preference, not a single-object or RPC call),
 * it is re-issued with a unique `id` tiebreaker on the ordering and every
 * page is fetched, and the caller receives the complete set. Every other
 * request is returned completely untouched, so the blast radius is limited to
 * reads that are ALREADY returning wrong (truncated) data.
 *
 * Deliberately not silent: each completion logs which table needed it, so a
 * call site that keeps relying on this can be converted to an explicit
 * `pageAll()` (lib/page-all.ts) — this is the safety net, not a licence to skip
 * pagination. If completing the read fails for any reason the original
 * (truncated) response is returned exactly as before, never a new error.
 *
 * Kill switch: SUPABASE_AUTO_PAGINATE=0 restores the old pass-through.
 */

// The project's PostgREST `max-rows` (checked live 2026-09-24: `limit=1500` and
// `Range: 0-1499` are both still capped at 1,000). lib/page-all.ts pages by the
// same number.
export const SUPABASE_MAX_ROWS = 1000;

const PARALLEL_PAGES = 5;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function describe(input: RequestInfo | URL, init?: RequestInit) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const req = typeof input === 'object' && !(input instanceof URL) ? (input as Request) : null;
  return {
    url: new URL(raw),
    method: (init?.method ?? req?.method ?? 'GET').toUpperCase(),
    headers: new Headers(init?.headers ?? req?.headers),
  };
}

// True only for a plain, unpaged table read whose response has the row cap's
// exact signature.
export function isCapTruncated(url: URL, method: string, headers: Headers, res: Response): boolean {
  if (method !== 'GET') return false;
  if (!url.pathname.includes('/rest/v1/') || url.pathname.includes('/rest/v1/rpc/')) return false;
  // Any explicit paging or limit is the caller's own choice — leave it exact.
  if (url.searchParams.has('limit') || url.searchParams.has('offset') || headers.has('range')) return false;
  if ((headers.get('accept') ?? '').includes('pgrst.object')) return false; // .single()/.maybeSingle()
  if (/\bcount=/.test(headers.get('prefer') ?? '')) return false; // caller manages its own count/paging
  if (res.status !== 200) return false;
  if (!(res.headers.get('content-type') ?? '').includes('json')) return false;
  return res.headers.get('content-range') === `0-${SUPABASE_MAX_ROWS - 1}/*`;
}

// The same read, one deterministic page. The ordering gets a unique `id`
// tiebreaker appended (kept AFTER any ordering the caller asked for) so pages
// can never overlap or skip rows.
function pageRequest(base: FetchLike, url: URL, headers: Headers, init: RequestInit | undefined, offset: number) {
  const u = new URL(url);
  const order = u.searchParams.get('order');
  if (!order) u.searchParams.set('order', 'id.asc');
  else if (!/(^|,)id\./.test(order)) u.searchParams.set('order', `${order},id.asc`);
  u.searchParams.set('limit', String(SUPABASE_MAX_ROWS));
  u.searchParams.set('offset', String(offset));
  const h = new Headers(headers);
  if (offset === 0) h.set('prefer', [h.get('prefer'), 'count=exact'].filter(Boolean).join(','));
  return base(u.toString(), { ...init, method: 'GET', headers: h, body: undefined });
}

async function completeRead(base: FetchLike, url: URL, headers: Headers, init: RequestInit | undefined): Promise<unknown[] | null> {
  const first = await pageRequest(base, url, headers, init, 0);
  if (!first.ok) return null;
  const total = Number(/\/(\d+)$/.exec(first.headers.get('content-range') ?? '')?.[1]);
  if (!Number.isFinite(total)) return null;
  const firstRows = await first.json();
  if (!Array.isArray(firstRows)) return null;
  const rows: unknown[] = [...firstRows];

  const offsets: number[] = [];
  for (let o = SUPABASE_MAX_ROWS; o < total; o += SUPABASE_MAX_ROWS) offsets.push(o);
  for (let i = 0; i < offsets.length; i += PARALLEL_PAGES) {
    const pages = await Promise.all(offsets.slice(i, i + PARALLEL_PAGES).map(async offset => {
      const res = await pageRequest(base, url, headers, init, offset);
      if (!res.ok) return null;
      const body = await res.json();
      return Array.isArray(body) ? body : null;
    }));
    for (const page of pages) {
      if (!page) return null;
      rows.push(...page);
    }
  }
  return rows;
}

export function makeAutoPaginatingFetch(base: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  return async (input, init) => {
    const res = await base(input, init);
    if (process.env.SUPABASE_AUTO_PAGINATE === '0') return res;
    try {
      const { url, method, headers } = describe(input, init);
      if (!isCapTruncated(url, method, headers, res)) return res;

      const rows = await completeRead(base, url, headers, init);
      const table = url.pathname.split('/').pop() ?? '?';
      if (!rows) {
        console.error(`[supabase] read of "${table}" hit the ${SUPABASE_MAX_ROWS}-row cap and could NOT be completed — returning the truncated result. select=${url.searchParams.get('select')?.slice(0, 120)}`);
        return res;
      }
      console.warn(`[supabase] unpaginated read of "${table}" hit the ${SUPABASE_MAX_ROWS}-row cap; completed to ${rows.length} rows. Convert this call site to pageAll(). select=${url.searchParams.get('select')?.slice(0, 120)}`);
      void res.body?.cancel().catch(() => undefined);
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-range': `0-${Math.max(rows.length - 1, 0)}/*` },
      });
    } catch (err) {
      console.error('[supabase] auto-pagination failed; returning the original response:', err instanceof Error ? err.message : err);
      return res;
    }
  };
}
