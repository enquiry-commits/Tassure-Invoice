// TeamWork can hold TWO live company records for the same UEN — a real one
// (client code, Internal CSS Status "Active") plus a blank stub (no client
// code, empty status). Confirmed 2026-09-24 against the real bulk feed: exactly
// 3 UENs (SHENGYA (SG), A.I.R. INVESTMENT MANAGEMENT, XGC SINGAPORE/YANGGU).
// docs/INVARIANTS.md INV-TW-023. Kept framework-free so the sync route and a
// plain `npx tsx` test can both import it.
export type TwRecordLite = {
  company_id: string;
  client_id: string | null;
  status: string | null;
  company_registration_Num: string | null;
};

const normUen = (uen: string | null | undefined) => (uen ?? '').trim().toUpperCase();

// Higher wins, compared left to right: has a client code, is Active, has ANY
// status, then the higher numeric id as a deterministic last tie-break.
function rank(r: TwRecordLite): number[] {
  const status = (r.status ?? '').trim();
  return [
    (r.client_id ?? '').trim() ? 1 : 0,
    status.toLowerCase() === 'active' ? 1 : 0,
    status ? 1 : 0,
    Number(r.company_id) || 0,
  ];
}

// For every UEN with 2+ live records, which record is the real one. UENs with
// a single record (the normal case) never appear in either map.
export function findDuplicateUenRecords<T extends TwRecordLite>(list: T[]) {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const uen = normUen(r.company_registration_Num);
    if (!uen) continue;
    groups.set(uen, [...(groups.get(uen) ?? []), r]);
  }
  const canonicalIdByUen = new Map<string, string>();
  const recordsByUen = new Map<string, T[]>();
  for (const [uen, records] of groups) {
    if (records.length < 2) continue;
    const ranked = [...records].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
      return 0;
    });
    canonicalIdByUen.set(uen, ranked[0].company_id);
    recordsByUen.set(uen, ranked);
  }
  return { canonicalIdByUen, recordsByUen };
}
