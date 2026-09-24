// lib/page-all.ts — the shared "read every row" helper behind ~55 call sites.
// The fake backend below reproduces what PostgREST really did on 2026-09-24:
// offset paging WITHOUT a total order returns rows in a different order on
// each request, so pages overlap and skip rows (measured live: 650 duplicated
// and 650 missing of 2,324) — silently. It only becomes stable when the
// request orders by a unique column. See docs/INVARIANTS.md INV-DATA-066.
//
// Run: npx tsx test-page-all.ts
import { pageAll } from './lib/page-all';

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

// One table. Every builder call is one "request".
function fakeTable(rows: Row[], opts: { failPage?: number } = {}) {
  let requests = 0;
  const seen: Array<Array<[string, boolean]>> = [];
  const makeQuery = () => {
    const orders: Array<[string, boolean]> = [];
    const builder = {
      order(col: string, o: { ascending: boolean }) { orders.push([col, o.ascending]); return builder; },
      range(from: number, to: number) {
        const req = requests++;
        seen.push(orders.slice());
        const page = Math.floor(from / 1000);
        if (opts.failPage === page) return Promise.resolve({ data: null, error: { message: 'boom', code: '57014' } });
        const unique = orders.some(([c]) => c === 'id'); // a total order exists only if a unique column is in it
        let list = rows.slice();
        if (unique) {
          list.sort((a, b) => {
            for (const [col, asc] of orders) {
              const d = (a[col as keyof Row] as number) - (b[col as keyof Row] as number);
              if (d !== 0) return asc ? d : -d;
            }
            return 0;
          });
        } else {
          // no total order: a different arbitrary order on every request
          const rnd = mulberry32(req + 1);
          list = list.map(r => [rnd(), r] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        }
        return Promise.resolve({ data: list.slice(from, to + 1), error: null });
      },
    };
    return builder as never;
  };
  return { makeQuery, seen, requests: () => requests };
}

// Verbatim copy of the pre-fix pageAll (no ordering, errors swallowed) — used
// only to prove the fake really reproduces the bug.
async function legacyPageAll<T>(makeQuery: () => unknown, batch = 5): Promise<T[]> {
  const fetchPage = async (idx: number): Promise<T[]> => {
    const { data } = await (makeQuery() as { range: (a: number, b: number) => Promise<{ data: T[] | null }> }).range(idx * 1000, idx * 1000 + 999);
    return data ?? [];
  };
  const out: T[] = [];
  for (let wave = 0; ; wave++) {
    const pages = await Promise.all(Array.from({ length: batch }, (_, i) => fetchPage(wave * batch + i)));
    for (const p of pages) out.push(...p);
    if (pages[batch - 1].length < 1000) break;
  }
  return out;
}

const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, k: (i * 7) % 13 }));
const distinctIds = (rows: Row[]) => new Set(rows.map(r => r.id)).size;

(async () => {
  console.log('--- the fake backend reproduces the real bug on the OLD implementation ---');
  {
    const rows = makeRows(2324); // the exact size of the real txn_date-filtered read
    const t = fakeTable(rows);
    const got = await legacyPageAll<Row>(t.makeQuery);
    check('legacy pageAll on unstable paging returns 2,324 rows but with duplicates', got.length === 2324 && distinctIds(got) < 2324);
    check(`... and therefore MISSES rows (${2324 - distinctIds(got)} missing)`, 2324 - distinctIds(got) > 0);
  }

  console.log('\n--- fixed pageAll: exact on the same backend ---');
  for (const n of [0, 1, 999, 1000, 1001, 2000, 2324, 5000, 5001, 18970]) {
    const rows = makeRows(n);
    const t = fakeTable(rows);
    const got = await pageAll<Row>(t.makeQuery);
    check(`n=${String(n).padEnd(5)} every row exactly once (${got.length} returned, ${distinctIds(got)} distinct)`, got.length === n && distinctIds(got) === n);
  }

  console.log('\n--- ordering contract ---');
  {
    const t = fakeTable(makeRows(3));
    await pageAll<Row>(t.makeQuery);
    check('a query with no ordering gets order(id asc)', JSON.stringify(t.seen[0]) === JSON.stringify([['id', true]]));
  }
  {
    // caller already orders by a NON-unique column (txn_date desc style): it stays PRIMARY, id only breaks ties
    const t = fakeTable(makeRows(30));
    const q = () => (t.makeQuery() as unknown as { order: (c: string, o: { ascending: boolean }) => never }).order('k', { ascending: false });
    const got = await pageAll<Row>(q);
    check('caller order kept first, unique tiebreaker appended after it', JSON.stringify(t.seen[0]) === JSON.stringify([['k', false], ['id', true]]));
    let sorted = true;
    for (let i = 1; i < got.length; i++) {
      if (got[i - 1].k < got[i].k || (got[i - 1].k === got[i].k && got[i - 1].id > got[i].id)) sorted = false;
    }
    check('result is sorted by k desc, ties broken by id asc (deterministic)', sorted);
  }
  {
    const t = fakeTable(makeRows(3));
    await pageAll<Row>(t.makeQuery, 5, 'k');
    check('a different unique column can be passed for a table without id', JSON.stringify(t.seen[0]) === JSON.stringify([['k', true]]));
  }

  console.log('\n--- errors are loud, never a silently short result ---');
  {
    const t = fakeTable(makeRows(3000), { failPage: 1 });
    let msg = '';
    try { await pageAll<Row>(t.makeQuery); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    check('a failed middle page throws (with page number and PostgREST code)', msg.includes('page 1') && msg.includes('57014') && msg.includes('boom'));
  }
  {
    // The old code's worst case: the LAST page of a wave fails -> empty -> "short page, we're done" -> silent truncation.
    const t = fakeTable(makeRows(9000), { failPage: 4 });
    let threw = false;
    try { await pageAll<Row>(t.makeQuery); } catch { threw = true; }
    check('a failed last-page-of-wave throws instead of ending the read early', threw);
    const legacy = await legacyPageAll<Row>(fakeTable(makeRows(9000), { failPage: 4 }).makeQuery).catch(() => null);
    check('(the OLD implementation returned a silently truncated array here)', legacy !== null && legacy.length < 9000);
  }

  console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
