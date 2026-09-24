// Master List `status` column — the rules in one framework-free file, so the
// Move route, the Move menu on the pages and the nightly TeamWork sync can
// never disagree about them (docs/INVARIANTS.md INV-DATA-067; its
// predecessor INV-DATA-064 is the same lesson for the Strike Off move).
//
// The column mirrors TeamWork's own company Status — Vincent: "MASTER LIST
// 这边的 ACTIVE 就是TW里面的 STATUS". Three rules follow from that:
//
//   1. TeamWork wins. When TeamWork has a non-blank Status for the row's UEN,
//      that is what the row shows, whichever list it sits in (a manual edit
//      locks the row through `manual_fields.status` and beats everything).
//
//   2. A row TeamWork can say nothing about — its UEN is not in TeamWork at
//      all, or TeamWork's status is blank — and that sits in Terminated
//      Services must read "Terminated". Nothing else will ever correct it:
//      180 such rows kept a legacy "YES" for months (plus "NO", "terminate",
//      "to be terminate", "RENAMED", even a person's name), because the sync
//      only ever touches rows TeamWork knows. The colleague who works that
//      list asked for exactly this ("不是 terminated status 的…一直比较好").
//      A row TeamWork DOES report as something else (e.g. still "Active") is
//      NOT forced: "follow TeamWork" stands, and the disagreement is a
//      TeamWork-side fix, not something to hide here.
//
//   3. Moving a row into Strike Off / Terminated Services stamps a
//      PLACEHOLDER until the next sync can confirm it: TeamWork's own wording
//      ("Striking Off" — never the more final "STRUCK OFF", INV-DATA-064 — and
//      "Terminated"), so the next night's sync has nothing to change, and the
//      SERVER decides it, so a stale browser tab can't reintroduce a
//      different literal.

export const TERMINATED_STATUS = 'Terminated';
export const STRIKING_OFF_STATUS = 'Striking Off';

// Only the lists whose status TeamWork itself can already contradict need a
// server-decided placeholder; every other target keeps whatever the caller
// sends (Active Client's own "YES", see app/master-list/*/page.tsx).
const MOVE_PLACEHOLDER_BY_LIST = new Map<string, string>([
  ['strike_off', STRIKING_OFF_STATUS],
  ['terminated', TERMINATED_STATUS],
]);

export function placeholderStatusForMove(targetListType: string): string | undefined {
  return MOVE_PLACEHOLDER_BY_LIST.get(targetListType);
}

// Case-insensitive on purpose: the old Move placeholder was "TERMINATED", and
// rewriting a correct word only to change its case would itself be a status
// that "changes by itself".
export function isTerminatedStatus(status: string | null | undefined): boolean {
  return String(status ?? '').trim().toLowerCase() === TERMINATED_STATUS.toLowerCase();
}

export type MasterListStatusRow = {
  id: number;
  list_type: string | null;
  roc_no: string | null;
  status: string | null;
  manual_fields: Record<string, boolean> | null;
};

export type MasterListStatusPatch = {
  id: number;
  oldValue: string | null;
  newValue: string;
  reason: 'teamwork' | 'terminated_list_default';
};

const normUen = (uen: string | null | undefined) => String(uen ?? '').trim().toUpperCase();

/**
 * Which rows' `status` the nightly sync should rewrite, and to what.
 *
 * `twStatusByUen` is what the sync mirrors (UEN -> TeamWork's non-blank
 * Status, canonical record per INV-TW-023). `twUensWithStatus` is every UEN
 * for which ANY TeamWork record carries a non-blank Status — wider on
 * purpose: the sync skips a few TeamWork records (ambiguous name, duplicate
 * stub) before it fills the mirror map, and a row whose company TeamWork DOES
 * describe must never be treated as "TeamWork knows nothing about it".
 */
export function planMasterListStatusPatches(
  rows: readonly MasterListStatusRow[],
  twStatusByUen: ReadonlyMap<string, string>,
  twUensWithStatus: ReadonlySet<string>,
): MasterListStatusPatch[] {
  const patches: MasterListStatusPatch[] = [];
  for (const row of rows) {
    if (row.manual_fields?.status) continue; // a staff edit locks the cell until it is cleared back to empty
    const uen = normUen(row.roc_no);

    const twStatus = uen ? twStatusByUen.get(uen) : undefined;
    if (twStatus) {
      if (twStatus !== row.status) patches.push({ id: row.id, oldValue: row.status, newValue: twStatus, reason: 'teamwork' });
      continue;
    }

    if (row.list_type !== 'terminated') continue;
    if (uen && twUensWithStatus.has(uen)) continue;
    if (isTerminatedStatus(row.status)) continue;
    patches.push({ id: row.id, oldValue: row.status, newValue: TERMINATED_STATUS, reason: 'terminated_list_default' });
  }
  return patches;
}
