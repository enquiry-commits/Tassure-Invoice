// THE single source of truth for a company's lifecycle — every rule about
// "what is this company's TeamWork status" and "is this company terminated"
// lives here, and nowhere else (docs/INVARIANTS.md INV-TW-024 / INV-AR-017).
//
// Why one file: between 2026-09-23 and 09-28 the same question — "is this
// company terminated?" — was answered independently in several places, and
// every copy that drifted produced a real incident (INV-TW-023: a TeamWork
// stub record flipped XGC SINGAPORE / SHENGYA / A.I.R to inactive;
// INV-AR-016: a second copy of the check in late-filing/sync trusted a stale
// Master List row over a live Active company). 14 real AR Reminder cycles,
// including XGC's March 2026 cycle days before its deadline, silently
// disappeared. Vincent, 2026-09-28: "这个是严格不允许发生的问题，只能由真的"
// — only the REAL TeamWork record may ever decide a company's status.
//
// The rules, in order of defence:
//
//   1. IDENTITY — a TeamWork "stub" (no client code AND no status) is never
//      allowed to claim, re-key, or create a company row. It can only ever be
//      reported. (TeamWork keeps 254 of these today; 3 share a UEN with the
//      real record.)
//
//   2. STATUS WRITES — companies.tw_status / is_active change ONLY when
//      TeamWork gives an EXPLICIT status. A blank status is "unknown", never
//      "inactive": it can't demote a known status, and it is reported so staff
//      complete TeamWork. A real termination in TeamWork always comes with an
//      explicit status (Terminated / Striking Off / Struck-Off / …), which
//      still goes straight through.
//
//   3. DECISION — "terminated" means an explicit, non-Active TeamWork status.
//      Blank/unknown is never terminated. When a company has several rows
//      (a leftover duplicate), it is terminated only if EVERY row says so —
//      order-independent (INV-TW-023). Master List's lifecycle lists are a
//      fallback ONLY when no companies row exists at all (INV-DATA-030,
//      INV-AR-016).
//
//   4. ACTION — hiding an AR Reminder row is reversible and self-healing: a
//      row the SYSTEM excluded is automatically restored the next run once
//      its company is no longer terminated. A row a PERSON excluded (trash
//      can) is never touched.
//
//   5. CIRCUIT BREAKERS — one run may never mass-hide (or mass-restore) rows:
//      above a small limit it does nothing and raises an alert instead. The
//      safe failure is "a terminated company's AR stays visible a bit
//      longer", never "a live client's AR disappears".
//
//   6. SAFETY NET — every run checks the OUTCOME directly: an Active company
//      whose AR rows are ALL hidden raises an alert, whatever caused it —
//      including causes nobody has thought of yet.
//
// Framework-free on purpose: teamwork/sync, late-filing/sync and a plain
// `npx tsx test-company-lifecycle.ts` all import it.

import { normalize } from './company-name';

// ── 1. What counts as REAL TeamWork evidence ─────────────────────────────

/** A trimmed, non-blank status, or null. Blank is "unknown" — never a status. */
export function explicitStatus(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  return s ? s : null;
}

/** A TeamWork record with no client code AND no status — never a company's identity. */
export function isTeamworkStub(record: { client_id?: string | null; status?: string | null }): boolean {
  return !String(record.client_id ?? '').trim() && !explicitStatus(record.status);
}

// ── 2. The ONE rule for writing companies.tw_status / is_active ──────────

export type CompanyStatusFields = { tw_status: string | null; is_active: boolean | null };

/**
 * What teamwork/sync may write to a company's status fields, given the
 * status on its REAL TeamWork record. Explicit status → mirrored (is_active =
 * "Active"). Blank → nothing changes; `blankIgnored` says a known status was
 * held against it, so the sync can report it.
 */
export function planCompanyStatusPatch(
  current: CompanyStatusFields,
  incomingRawStatus: string | null | undefined,
): { patch: { tw_status?: string; is_active?: boolean }; blankIgnored: boolean } {
  const status = explicitStatus(incomingRawStatus);
  if (!status) return { patch: {}, blankIgnored: !!explicitStatus(current.tw_status) };
  const patch: { tw_status?: string; is_active?: boolean } = {};
  if (status !== current.tw_status) patch.tw_status = status;
  const active = status.toLowerCase() === 'active';
  if (active !== (current.is_active === true)) patch.is_active = active;
  return { patch, blankIgnored: false };
}

// ── 3. The ONE rule for "is this company terminated" ──────────────────────

/** Explicit and not Active. Blank / null / unknown is NEVER terminated. */
export function isTerminatedStatus(twStatus: string | null | undefined): boolean {
  const s = explicitStatus(twStatus);
  return !!s && s.toLowerCase() !== 'active';
}

export type LifecycleCompany = { registration_no: string | null; company_name: string | null; tw_status: string | null };
export type LifecycleIndex = {
  /** UEN first; then (only if given) the entity name; then Master List — only when no companies row exists. */
  isTerminated(uen: string | null | undefined, entityName?: string | null): boolean;
  /** Every UEN this index would call terminated (companies rows + Master List fallback). */
  terminatedUens(): string[];
};

export const normalizeUen = (uen: string | null | undefined) => String(uen ?? '').trim().toUpperCase();

export function buildLifecycleIndex(companies: readonly LifecycleCompany[], masterListTerminatedUens: Iterable<string | null | undefined>): LifecycleIndex {
  // Per key, order-independent: terminated only if EVERY row under it is.
  const byUen = new Map<string, boolean>();
  const byName = new Map<string, boolean>();
  for (const c of companies) {
    const terminated = isTerminatedStatus(c.tw_status);
    const uen = normalizeUen(c.registration_no);
    if (uen) byUen.set(uen, (byUen.get(uen) ?? true) && terminated);
    const name = c.company_name ? normalize(c.company_name) : '';
    if (name) byName.set(name, (byName.get(name) ?? true) && terminated);
  }
  const masterList = new Set<string>();
  for (const u of masterListTerminatedUens) { const k = normalizeUen(u); if (k) masterList.add(k); }

  const isTerminated = (uen: string | null | undefined, entityName?: string | null) => {
    const key = normalizeUen(uen);
    if (key && byUen.has(key)) return byUen.get(key)!;
    const name = entityName ? normalize(entityName) : '';
    if (name && byName.has(name)) return byName.get(name)!;
    return key ? masterList.has(key) : false;
  };
  return {
    isTerminated,
    terminatedUens: () => [...new Set([...byUen.keys(), ...masterList])].filter(u => isTerminated(u)),
  };
}

// ── 4 & 5. AR Reminder auto-exclusion / auto-restore, with breakers ──────

export const AR_SYSTEM_EXCLUDER = 'system:late-filing';
export const AR_SYSTEM_RESTORER = 'system:late-filing-restore';
export const MAX_AUTO_EXCLUSIONS_PER_RUN = 10;
export const MAX_AUTO_RESTORES_PER_RUN = 10;

export type ArRowRef = { id: number; uen: string | null; entity_name?: string | null };

/**
 * Visible rows of terminated companies to hide. UEN matches only (a bulk hide
 * must never ride on a fuzzy name). Above the limit: hide nothing, block.
 */
export function planArAutoExclusions(visibleRows: readonly ArRowRef[], index: LifecycleIndex, max = MAX_AUTO_EXCLUSIONS_PER_RUN) {
  const candidates = visibleRows.filter(r => normalizeUen(r.uen) && index.isTerminated(r.uen));
  const blocked = candidates.length > max;
  return { candidates, blocked, toExclude: blocked ? [] : candidates };
}

export type ExcludedArRow = ArRowRef & {
  /** The LATEST transition to 'Excluded' in ar_reminder_audit, or null if none is recorded. */
  lastExclusion: { by: string | null; statusBefore: string | null } | null;
};

/**
 * Rows the SYSTEM hid whose company is no longer terminated → restore to the
 * exact status they had before. A person's exclusion, or one with no audit
 * trail, is never touched. Above the limit: restore nothing, block.
 */
export function planArAutoRestores(excludedRows: readonly ExcludedArRow[], index: LifecycleIndex, max = MAX_AUTO_RESTORES_PER_RUN) {
  const candidates = excludedRows.filter(r =>
    r.lastExclusion?.by === AR_SYSTEM_EXCLUDER && normalizeUen(r.uen) && !index.isTerminated(r.uen));
  const blocked = candidates.length > max;
  return {
    candidates,
    blocked,
    toRestore: blocked ? [] : candidates.map(r => ({ id: r.id, restoreTo: r.lastExclusion!.statusBefore })),
  };
}

// ── 6. Safety net: judge the OUTCOME, not the mechanism ──────────────────

/**
 * Companies TeamWork explicitly shows as Active whose AR Reminder rows exist
 * but are ALL hidden. Should always be empty; anything here is a real client
 * whose AR has vanished, whatever the cause.
 */
export function findActiveCompaniesWithAllArHidden(
  companies: readonly LifecycleCompany[],
  arRows: readonly { uen: string | null; status: string | null }[],
): Array<{ uen: string; name: string; hiddenRows: number }> {
  const rowsByUen = new Map<string, { status: string | null }[]>();
  for (const r of arRows) { const u = normalizeUen(r.uen); if (u) (rowsByUen.get(u) ?? rowsByUen.set(u, []).get(u)!).push(r); }
  const out: Array<{ uen: string; name: string; hiddenRows: number }> = [];
  const seen = new Set<string>();
  for (const c of companies) {
    const uen = normalizeUen(c.registration_no);
    if (!uen || seen.has(uen) || explicitStatus(c.tw_status)?.toLowerCase() !== 'active') continue;
    seen.add(uen);
    const rows = rowsByUen.get(uen) ?? [];
    if (rows.length && rows.every(r => r.status === 'Excluded')) out.push({ uen, name: c.company_name ?? uen, hiddenRows: rows.length });
  }
  return out;
}
