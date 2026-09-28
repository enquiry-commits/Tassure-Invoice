// THE single source of truth for a company's lifecycle — every rule about
// "what is this company's TeamWork status" and "is this company terminated"
// lives here, and nowhere else (docs/INVARIANTS.md INV-TW-024 / INV-AR-017 /
// INV-AR-018).
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
//   7. ROSTER — "is this a live client" is companies.is_active, read ONLY
//      through isActiveCompany()/onlyActiveCompanies() (or the TeamWork-Active
//      / CSS-Client variants below). No feature keeps its own status list.
//
//   8/9. Master List's "ended" categories, and the one verdict (active /
//      terminated / unknown) shown to people, live here too.
//
// `npx tsx test-company-lifecycle.ts` fails if any file outside this module
// compares is_active / tw_status / Master List lifecycle categories itself
// (its "one definition" guard — REG-026).
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

/** TeamWork explicitly says "Active" (any case) — the ONE string test for it. */
export function isActiveStatus(raw: string | null | undefined): boolean {
  return explicitStatus(raw)?.toLowerCase() === 'active';
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
  const active = isActiveStatus(status);
  if (active !== isActiveCompany(current)) patch.is_active = active;
  return { patch, blankIgnored: false };
}

/**
 * The status fields a company NEW from TeamWork is inserted with — the same
 * mapping as every update (explicit status mirrored, is_active = "Active"),
 * never a literal. BOTH fields are always explicit: companies.is_active
 * DEFAULTs to true in the database, so leaving it out would put a new
 * Terminated company on the active roster. (teamwork/sync only inserts
 * records whose status is explicitly Active; blank → {} is never reached.)
 */
export function statusFieldsForNewCompany(incomingRawStatus: string | null | undefined): { tw_status?: string; is_active?: boolean } {
  const status = explicitStatus(incomingRawStatus);
  return status ? { tw_status: status, is_active: isActiveStatus(status) } : {};
}

// ── 3. The ONE rule for "is this company terminated" ──────────────────────

/** Explicit and not Active. Blank / null / unknown is NEVER terminated. */
export function isTerminatedStatus(twStatus: string | null | undefined): boolean {
  return !!explicitStatus(twStatus) && !isActiveStatus(twStatus);
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
 *
 * Deliberately NOT "only once proven Active": an AR row is visible unless its
 * company is PROVEN terminated, so hide and restore are the same single
 * predicate and the outcome never depends on history. If the evidence
 * degrades to "unknown", the row comes back — a stray reminder is visible and
 * a person can trash it; a vanished one silently misses a filing deadline.
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
    if (!uen || seen.has(uen) || !isActiveStatus(c.tw_status)) continue;
    seen.add(uen);
    const rows = rowsByUen.get(uen) ?? [];
    if (rows.length && rows.every(r => r.status === 'Excluded')) out.push({ uen, name: c.company_name ?? uen, hiddenRows: rows.length });
  }
  return out;
}

// ── 7. Roster membership — the ONE definition of "active company" ─────────
//
// companies.is_active is the single MATERIALISED answer to "is this company on
// the active roster". It is written ONLY by planCompanyStatusPatch() (rows
// TeamWork tracks) and by NEW_UNTRACKED_CLIENT (billing/tao "+ Add new
// company" — an accounts/tax client TeamWork doesn't track). Every feature
// reads it through the helpers below — never its own `.eq('is_active', …)`,
// `.eq('tw_status', 'Active')`, or list of status strings. Until 2026-09-28
// three different definitions were in use (is_active; is_active + a
// "not Terminated/Striking Off" list; tw_status = 'Active' exact-case): AR
// generation and Billing Drafts could disagree about the same company.

/** On the active roster (every workflow that just needs "a live client"). */
export function isActiveCompany(row: { is_active?: boolean | null }): boolean {
  return row.is_active === true;
}

/**
 * Active AND TeamWork explicitly says "Active" — the corporate-secretarial
 * roster (Billing Drafts, Companies page). Excludes clients TeamWork doesn't
 * track (a TAO-only accounts client). Case-insensitive, unlike the
 * `tw_status = 'Active'` filters it replaces.
 */
export function isTeamworkActiveCompany(row: { is_active?: boolean | null; tw_status?: string | null }): boolean {
  return isActiveCompany(row) && isActiveStatus(row.tw_status);
}

/** An active company TeamWork's Client column marks "CSS Client" (Master List cards, ND page). */
export function isActiveCssClient(row: { is_active?: boolean | null; client_type?: string | null }): boolean {
  return isActiveCompany(row) && row.client_type === 'CSS Client';
}

/**
 * Linked to a TeamWork record at all — it has TeamWork's record id, or has
 * ever carried a TeamWork status. NOT the same as "has a status": since
 * INV-TW-024 a TeamWork company whose record is blank keeps tw_status null
 * (EVOP (SINGAPORE) INTERNATIONAL), and it is still a TeamWork company.
 */
export function isTrackedByTeamwork(row: { internal_id?: string | number | null; tw_status?: string | null }): boolean {
  return !!String(row.internal_id ?? '').trim() || !!explicitStatus(row.tw_status);
}

/** The fields a brand-new client TeamWork doesn't track is created with. */
export const NEW_UNTRACKED_CLIENT = { is_active: true } as const;

// Query-side twins of the predicates above. Framework-free: they take any
// query builder with .eq/.ilike and hand the same builder back.
type EqBuilder<Q> = { eq(column: string, value: unknown): Q; ilike(column: string, pattern: string): Q };

/** DB twin of isActiveCompany(). */
export function onlyActiveCompanies<Q>(query: Q): Q {
  return (query as unknown as EqBuilder<Q>).eq('is_active', true);
}

/** DB twin of isTeamworkActiveCompany() — `ilike` with no wildcard = case-insensitive equality. */
export function onlyTeamworkActiveCompanies<Q>(query: Q): Q {
  const q = (query as unknown as EqBuilder<Q>).eq('is_active', true);
  return (q as unknown as EqBuilder<Q>).ilike('tw_status', 'active');
}

/**
 * Rows whose two lifecycle fields contradict each other (is_active true but
 * TeamWork status explicitly not Active, or status "Active" but not active).
 * Every roster reads is_active alone, so this must always be empty; the
 * TeamWork sync reports anything here.
 */
export function findLifecycleInconsistencies<T extends { is_active?: boolean | null; tw_status?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter(r => !!explicitStatus(r.tw_status) && isActiveStatus(r.tw_status) !== isActiveCompany(r));
}

// ── 8. Master List lifecycle categories ───────────────────────────────────

/**
 * Master List categories that mean the relationship has ENDED — the only
 * evidence for a company with no `companies` row left (INV-DATA-030), and the
 * "churned" definition in Reports. One list, so the two can't drift.
 */
export const ENDED_MASTER_LIST_TYPES = ['terminated', 'strike_off'] as const;

export function isEndedMasterListType(listType: string | null | undefined): boolean {
  return (ENDED_MASTER_LIST_TYPES as readonly string[]).includes(String(listType ?? ''));
}

// ── 9. The one verdict for REPORTING a single company's lifecycle ─────────

export type LifecycleVerdict = 'active' | 'terminated' | 'unknown';

/**
 * What the system itself considers this company — for anything that TELLS a
 * person (the assistant, a page). Same precedence as buildLifecycleIndex():
 * the companies row wins; Master List is consulted only when there is no row.
 * A blank TeamWork status on a row that isn't active is honestly 'unknown'.
 */
export function lifecycleVerdict(
  row: { is_active?: boolean | null; tw_status?: string | null } | null | undefined,
  masterListTypes: readonly (string | null | undefined)[] = [],
): LifecycleVerdict {
  if (row) {
    if (isTerminatedStatus(row.tw_status)) return 'terminated';
    return isActiveCompany(row) ? 'active' : 'unknown';
  }
  return masterListTypes.some(isEndedMasterListType) ? 'terminated' : 'unknown';
}

/** The Dashboard's status chart (display only): TeamWork's own word for the 3 common states, anything else as "Untracked". */
export const STATUS_CHART_BUCKETS = ['Active', 'Striking Off', 'Terminated'] as const;

export function statusChartBucket(twStatus: string | null | undefined): string {
  const s = explicitStatus(twStatus);
  return s && (STATUS_CHART_BUCKETS as readonly string[]).includes(s) ? s : 'Untracked';
}
