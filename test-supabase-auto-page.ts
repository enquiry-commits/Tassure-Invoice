// lib/supabase-auto-page.ts — completes a read that PostgREST silently
// truncated at its 1,000-row cap (docs/INVARIANTS.md INV-DATA-006/066). It
// sits in front of EVERY server-side table read, so the two things that
// matter most are pinned here: (1) a truncated plain read really does come
// back complete, exact and in a deterministic order; (2) EVERYTHING else —
// small reads, explicit limits/ranges, counts, single-object, RPC, writes —
// is left byte-for-byte alone, and a failure while completing never turns
// into a new error.
//
// Uses the REAL supabase-js client against a mini-PostgREST fake, so the query
// strings and headers are exactly what production sends.
//
// Run: npx tsx test-supabase-auto-page.ts
import { createClient } from '@supabase/supabase-js';
import { makeAutoPaginatingFetch, isCapTruncated, SUPABASE_MAX_ROWS } from './lib/supabase-auto-page';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
};

type Row = { id: number; k: number };
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Recorded = { url: URL; method: string; headers: Headers };

// Mini PostgREST: 1,000-row cap, order/limit/offset/Prefer count/Accept handling,
// and — crucially — an arbitrary, different row order on every request unless
// the request's ORDER BY includes the unique id (the real instability).
function fakePostgrest(tables: Record<string, Row[]>, opts: { failOffset?: number } = {}) {
  const log: Recorded[] = [];
  let reqNo = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    log.push({ url, method, headers });
    const req = reqNo++;
    if (method !== 'GET') return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
    const table = url.pathname.split('/').pop()!;
    const isRpc = url.pathname.includes('/rpc/');
    const all = isRpc ? Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, k: 0 })) : (tables[table] ?? []);
    const orderParam = url.searchParams.get('order');
    const terms = orderParam ? orderParam.split(',').map(t => { const [col, dir] = t.split('.'); return { col, asc: dir !== 'desc' }; }) : [];
    const rnd = mulberry32(req + 1);
    let list = all.map(r => [rnd(), r] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]); // arbitrary order
    if (terms.length) {
      // stable sort over the arbitrary base order: ties on non-unique columns stay arbitrary
      list = list.map((r, i) => [r, i] as const).sort((a, b) => {
        for (const t of terms) {
          const d = (a[0][t.col as keyof Row] as number) - (b[0][t.col as keyof Row] as number);
          if (d !== 0) return t.asc ? d : -d;
        }
        return a[1] - b[1];
      }).map(x => x[0]);
    }
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const rangeHeader = headers.get('range');
    let from = offset;
    let limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
    if (rangeHeader) { const [a, b] = rangeHeader.split('-').map(Number); from = a; limit = b - a + 1; }
    limit = Math.min(limit, SUPABASE_MAX_ROWS); // the server-side cap
    if (opts.failOffset !== undefined && from === opts.failOffset) return new Response('{"message":"upstream"}', { status: 500, headers: { 'content-type': 'application/json' } });
    const slice = list.slice(from, from + limit);
    const wantsCount = /\bcount=/.test(headers.get('prefer') ?? '');
    const end = from + slice.length - 1;
    const range = slice.length ? `${from}-${end}/${wantsCount ? all.length : '*'}` : `*/${wantsCount ? all.length : '*'}`;
    const partial = wantsCount && slice.length < all.length;
    return new Response(JSON.stringify(slice), { status: partial ? 206 : 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-range': range } });
  };
  return { fetchImpl, log };
}

const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, k: (i * 7) % 13 }));
const distinct = (rows: Row[]) => new Set(rows.map(r => r.id)).size;
const clientFor = (fake: ReturnType<typeof fakePostgrest>) =>
  createClient('https://fake.supabase.co', 'key', { auth: { persistSession: false }, global: { fetch: makeAutoPaginatingFetch(fake.fetchImpl) } });

// console noise from the intentional log lines
const origWarn = console.warn, origError = console.error;
const warns: string[] = [], errors: string[] = [];
console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };

(async () => {
  console.log('--- a truncated plain read comes back complete ---');
  for (const n of [1000, 1001, 1599, 2500, 8045, 18970]) {
    const fake = fakePostgrest({ items: rowsOf(n) });
    const { data, error } = await clientFor(fake).from('items').select('id, k');
    const got = (data ?? []) as Row[];
    check(`n=${String(n).padEnd(5)} every row exactly once (${got.length} returned, ${distinct(got)} distinct), no error`, !error && got.length === n && distinct(got) === n);
    if (n === 2500) {
      check('... deterministic order: unique id ascending', got.every((r, i) => i === 0 || got[i - 1].id < r.id));
      check('... the completion was logged, naming the table', warns.some(w => w.includes('"items"') && w.includes('2500')));
    }
  }
  {
    // the exact scenario measured live: master_list, 1,599 rows, plain unpaginated select
    const fake = fakePostgrest({ master_list: rowsOf(1599) });
    const before = fakePostgrest({ master_list: rowsOf(1599) });
    const raw = await createClient('https://fake.supabase.co', 'key', { auth: { persistSession: false }, global: { fetch: before.fetchImpl } }).from('master_list').select('id, k');
    check('(without the safeguard the same read returns only 1000 of 1599)', (raw.data ?? []).length === 1000);
    const { data } = await clientFor(fake).from('master_list').select('id, k');
    check('with it: 1599 of 1599', (data ?? []).length === 1599);
  }
  {
    // caller's own ordering stays primary, id only breaks ties
    const fake = fakePostgrest({ items: rowsOf(2500) });
    const { data } = await clientFor(fake).from('items').select('id, k').order('k', { ascending: false });
    const got = (data ?? []) as Row[];
    let ok = got.length === 2500 && distinct(got) === 2500;
    for (let i = 1; i < got.length && ok; i++) {
      if (got[i - 1].k < got[i].k || (got[i - 1].k === got[i].k && got[i - 1].id > got[i].id)) ok = false;
    }
    check('caller order(k desc) kept as the primary order, id ascending as the tiebreak, still exact', ok);
    const orderSent = fake.log.slice(1).map(r => r.url.searchParams.get('order'));
    check('the completion requests append id.asc AFTER the caller\'s order', orderSent.every(o => o === 'k.desc,id.asc'));
  }
  {
    // auth headers and schema headers must reach the follow-up requests
    const fake = fakePostgrest({ items: rowsOf(2500) });
    await clientFor(fake).from('items').select('id, k');
    check('apikey/authorization are forwarded on every completion request', fake.log.every(r => r.headers.get('apikey') === 'key' && (r.headers.get('authorization') ?? '').includes('key')));
    check('completion = 1 original + page0(count) + 2 more pages', fake.log.length === 4 && fake.log[1].headers.get('prefer')?.includes('count=exact') === true);
  }

  console.log('\n--- everything else is left exactly alone ---');
  {
    const fake = fakePostgrest({ items: rowsOf(500) });
    const { data } = await clientFor(fake).from('items').select('id, k');
    check('a read under the cap: one request, untouched', fake.log.length === 1 && (data ?? []).length === 500);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    const { data } = await clientFor(fake).from('items').select('id, k').limit(1000);
    check('explicit .limit(1000) (same signature as the cap!) is the caller\'s choice: untouched, 1 request, 1000 rows', fake.log.length === 1 && (data ?? []).length === 1000);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    const { data } = await clientFor(fake).from('items').select('id, k').range(0, 999);
    check('explicit .range(0,999) (pageAll\'s own requests): untouched, 1 request', fake.log.length === 1 && (data ?? []).length === 1000);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    const { data, count } = await clientFor(fake).from('items').select('id, k', { count: 'exact' });
    check('a read that asked for a count manages its own paging: untouched', fake.log.length === 1 && (data ?? []).length === 1000 && count === 2500);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    await clientFor(fake).from('items').select('id, k').limit(1).maybeSingle();
    check('.maybeSingle()/.single() (object Accept header) is never completed', fake.log.length === 1);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    // rpc() is a POST by default; { get: true } is the GET form that could match the cap signature
    const { data } = await clientFor(fake).rpc('some_fn', {}, { get: true });
    check('GET RPC calls returning the cap signature are never completed', fake.log.length === 1 && fake.log[0].method === 'GET' && Array.isArray(data) && data.length === 1000);
  }
  {
    const fake = fakePostgrest({ items: rowsOf(2500) });
    await clientFor(fake).from('items').insert({ k: 1 });
    check('writes are never touched', fake.log.length === 1 && fake.log[0].method === 'POST');
  }
  {
    process.env.SUPABASE_AUTO_PAGINATE = '0';
    const fake = fakePostgrest({ items: rowsOf(2500) });
    const { data } = await clientFor(fake).from('items').select('id, k');
    check('kill switch SUPABASE_AUTO_PAGINATE=0 restores the old pass-through (1000 rows, 1 request)', fake.log.length === 1 && (data ?? []).length === 1000);
    delete process.env.SUPABASE_AUTO_PAGINATE;
  }
  {
    // the signature test in isolation
    const u = (q: string) => new URL('https://x.supabase.co/rest/v1/t' + q);
    const res = (range: string, status = 200, type = 'application/json') => new Response('[]', { status, headers: { 'content-range': range, 'content-type': type } });
    check('isCapTruncated: plain 0-999/* GET -> yes', isCapTruncated(u('?select=id'), 'GET', new Headers(), res('0-999/*')));
    check('isCapTruncated: 0-998/* (under cap) -> no', !isCapTruncated(u('?select=id'), 'GET', new Headers(), res('0-998/*')));
    check('isCapTruncated: non-JSON (CSV) -> no', !isCapTruncated(u('?select=id'), 'GET', new Headers(), res('0-999/*', 200, 'text/csv')));
    check('isCapTruncated: 206 -> no', !isCapTruncated(u('?select=id'), 'GET', new Headers(), res('0-999/*', 206)));
    check('isCapTruncated: offset present -> no', !isCapTruncated(u('?select=id&offset=0'), 'GET', new Headers(), res('0-999/*')));
    check('isCapTruncated: Range header -> no', !isCapTruncated(u('?select=id'), 'GET', new Headers({ range: '0-999' }), res('0-999/*')));
  }

  console.log('\n--- a failure while completing never becomes a new error ---');
  {
    const fake = fakePostgrest({ items: rowsOf(2500) }, { failOffset: 2000 });
    errors.length = 0;
    const { data, error } = await clientFor(fake).from('items').select('id, k');
    check('a failing follow-up page: the ORIGINAL truncated response is returned (1000 rows), no error thrown', !error && (data ?? []).length === 1000);
    check('... and the failure was logged loudly', errors.some(e => e.includes('could NOT be completed') && e.includes('"items"')));
  }

  console.warn = origWarn; console.error = origError;
  console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
