// Master List `status` column — the rules in one framework-free file, so the
// Move route, the Move menu on the pages and the nightly TeamWork sync can
// never disagree about them (docs/INVARIANTS.md INV-DATA-067; its
// predecessor INV-DATA-064 is the same lesson for the Strike Off move).
//
// The column mirrors TeamWork's own company Status — Vincent: "MASTER LIST
// 这边的 ACTIVE 就是TW里面的 STATUS". Two words matter for Terminated Services,
// and they are DIFFERENT on purpose:
//
//   "Terminate"  = the PLACEHOLDER. The row was filed here (by hand, by a
//                  Move, by an old import) but TeamWork has not confirmed it.
//   "Terminated" = TeamWork's own word. It appears only when the nightly sync
//                  copies it from TeamWork, so it means CONFIRMED.
//
// Vincent: "Move 到 Terminated 现在放的 'Terminate'…和TW确认后才变成
// Terminated". The change from "Terminate" to "Terminated" overnight is the
// confirmation signal, not a bug — and a row that still says "Terminate"
// after a sync is exactly the kind Vincent wants to look at ("看看之前有没有
// 错误显示的 或者没有同步正确的"). Rules:
//
//   1. TeamWork wins. When TeamWork has a non-blank Status for the row's UEN,
//      that is what the row shows, whichever list it sits in (a manual edit
//      locks the row through `manual_fields.status` and beats everything).
//
//   2. A row TeamWork can say nothing about — its UEN is not in TeamWork at
//      all, or TeamWork's status is blank — and that sits in Terminated
//      Services must read exactly "Terminate" (same as a fresh Move), unless
//      it already says exactly "Terminate" or TeamWork's exact "Terminated".
//      Case matters: Vincent, 2026-09-24, "terminate 要改成 Terminate" and
//      "TERMINATED 要换成 Terminate 或者是 Terminated, 这个要按照TW，如果TW有
//      Status 显示就换成 TW的status, 如果没有就和Move的显示一样 Terminate" — so
//      "terminate", "TERMINATED", "terminated" are all rewritten (a TeamWork-
//      known row already got TeamWork's word from rule 1). Only the EXACT
//      "Terminated" is kept when TeamWork is silent: it is TeamWork's own
//      spelling, so it was most likely mirrored earlier, and a company
//      dropping out of one TeamWork response must not downgrade a confirmed
//      status to a placeholder and back. Nothing else will ever correct the
//      rest: 180 such rows kept a legacy "YES" for months (plus "NO", "to be
//      terminate", "RENAMED", even a person's name), because the sync only
//      ever touches rows TeamWork knows. The colleague who works that list
//      asked for exactly this ("你可以帮我把之前的都放Terminate 吗 — 就是不是
//      terminated status 的…一直比较好"). A row TeamWork DOES report as
//      something else (e.g. still "Active") is NOT forced: "follow TeamWork"
//      stands, and the disagreement is a TeamWork-side fix, not something to
//      hide here.
//
//   3. Moving a row into Strike Off / Terminated Services stamps the
//      PLACEHOLDER until the next sync can confirm it — "Striking Off" (TeamWork's
//      own in-progress wording, never the more final "STRUCK OFF", INV-DATA-064)
//      and "Terminate" — and the SERVER decides it, so a stale browser tab
//      can't reintroduce a different literal. Do NOT "tidy" the placeholder
//      into TeamWork's final word: stamping "Terminated" at Move time would
//      claim a confirmation that has not happened (the 2026-09-24 first
//      version of this file did exactly that, and Vincent corrected it).

export const TERMINATED_STATUS = 'Terminated';        // TeamWork's word — confirmed
export const TERMINATE_PLACEHOLDER = 'Terminate';     // ours — filed here, not yet confirmed by TeamWork
export const STRIKING_OFF_STATUS = 'Striking Off';

// Only the lists whose status TeamWork itself can already contradict need a
// server-decided placeholder; every other target keeps whatever the caller
// sends (Active Client's own "YES", see app/master-list/*/page.tsx).
const MOVE_PLACEHOLDER_BY_LIST = new Map<string, string>([
  ['strike_off', STRIKING_OFF_STATUS],
  ['terminated', TERMINATE_PLACEHOLDER],
]);

export function placeholderStatusForMove(targetListType: string): string | undefined {
  return MOVE_PLACEHOLDER_BY_LIST.get(targetListType);
}

// The two words are compared EXACTLY, case included. The old Move placeholder
// was "TERMINATED" and staff typed "terminate"; neither is the placeholder or
// TeamWork's word, and Vincent wants them replaced (rule 2 above).
export function isTerminatePlaceholder(status: string | null | undefined): boolean {
  return String(status ?? '').trim() === TERMINATE_PLACEHOLDER;
}

// TeamWork's own spelling — written by the sync, so TeamWork's silence must
// not downgrade it.
export function isTeamWorkTerminated(status: string | null | undefined): boolean {
  return String(status ?? '').trim() === TERMINATED_STATUS;
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
    if (isTerminatePlaceholder(row.status) || isTeamWorkTerminated(row.status)) continue;
    patches.push({ id: row.id, oldValue: row.status, newValue: TERMINATE_PLACEHOLDER, reason: 'terminated_list_default' });
  }
  return patches;
}
