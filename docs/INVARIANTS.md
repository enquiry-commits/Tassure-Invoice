# System Invariants

This file exists so a lesson learned once does not have to be learned twice.

Every rule below was extracted from a **real incident** documented in
`PROJECT_STATUS.md` — a bug that actually shipped, was actually found (usually
by Vincent noticing wrong real data), and was actually fixed. Each rule is
concrete and checkable against this codebase, not a general engineering
principle. If you (human or AI) are about to touch code anywhere near one of
these areas, read the matching section first — a "surely this is fine" change
in these areas has broken production before, more than once, in exactly this
shape.

Each rule cites the source incident (date, `PROJECT_STATUS.md`) and the
relevant file/function where known. Sources are pointers for traceability,
not guaranteed still-accurate line numbers — verify against current code.

**When you find a new rule of this shape** (not "I fixed a typo" — "this
domain/system genuinely behaves in a non-obvious way and will bite again if
forgotten"), add it here in the same change that fixes it. That is the whole
point: every real bug should make the system harder to break the same way
again.

---

## TeamWork data parsing & scraping (INV-TW)

- **INV-TW-001** — A TeamWork AGM/AR due-date field can contain
  `<strike>ORIGINAL</strike> <br> REVISED` in the raw HTML (an approved
  Extension of Time). Always take the **latest** dd/mm/yyyy match, never the
  first. *(source: 2026-08-28 EOT feature; `lib/teamwork-agm.ts`
  `parseDmy`→`parseLatestDmy`; affects `late-filing/sync`'s overdue calc,
  `ar-reminder/sync-workflow`'s "Next AGM Due", and `ar_reminder.due_date`.)*
- **INV-TW-002** — When deriving a company's FYE month from TeamWork AGM/AR
  event history, take the event with the **latest** FYE date, never the
  first encountered — a company that changed FYE has older cycles under the
  old month sitting earlier in the history list. *(source: 2026-08-05/06 FYE
  Mismatch fixes, `ar-reminder/sync-workflow` and `late-filing/sync`.)*
- **INV-TW-003** — TeamWork's bulk `getCompanies` `fye_date` field can be
  stale for years after a company's real FYE moved. Never trust it as
  authoritative — only use it to populate an **empty** `fye_month`
  (bootstrap), never to overwrite an already-set value. Real correction must
  come from actual AGM/AR event history. *(source: 2026-08-06,
  `app/api/teamwork/sync/route.ts`.)*
- **INV-TW-004** — An AR/AGM cycle is only "still open" if **neither** its
  AGM nor its AR event shows a held/filing date. Checking each event row in
  isolation produces false results (the "Science In Sport" bug). *(source:
  2026-08-27, `ar-reminder/generate` catch-up + `sync-workflow` backfill.)*
- **INV-TW-005** — `due_date` for an AR/AGM cycle must always be computed
  independently as **FYE + 7 months** — never trust TeamWork's own scraped
  "due date" column directly (AGM rows show FYE+6mo, AR rows show FYE+7mo in
  TeamWork's own UI, causing off-by-one-month bugs if the wrong event is
  read first). *(source: 2026-08-12 AR generation chain.)*
- **INV-TW-006** — Statutory AGM due date = **FYE + 9 months** (SG
  private-company rule) — used when deriving a Late-Filing-flagged company's
  outstanding cycle from TeamWork's FYE month + AGM due date. Compare month
  *numbers*, not calendar-date subtraction, to avoid overflow edge cases.
  *(source: `app/api/late-filing/sync/route.ts`.)*
- **INV-TW-007** — "Next AGM Due Date" must use a two-pass approach: find
  the latest genuinely-completed cycle's FYE first, then only consider
  unheld cycles **after** it — otherwise an old cycle's blank Held/Filing
  Date (even though later cycles are filed) causes an ancient,
  already-superseded cycle to be picked. *(source: handoff-log tail,
  `ar-reminder/sync-workflow`, `late-filing/sync`.)*
- **INV-TW-008** — Active Client's "Last Accts Date" = the FYE Date on the
  **same AR row as the latest filing**, not just the newest FYE on file
  (which could be an unfiled future cycle). "Next AGM Due" = the Due Date of
  the nearest not-yet-held AGM event. *(source: 2026-08-06.)*
- **INV-TW-009** — TeamWork's appointment-history AJAX response embeds
  multiple history tables (Director/Shareholder/Secretary/Contact Person…)
  with near-identical column shapes. Row extraction must be scoped to the
  table following its own heading, never a whole-document `<tr>` scan, or
  Secretary appointments get misread as ND appointments missing a subrole.
  *(source: 2026-08-06, `lib/teamwork-nd.ts` `scrapeMember`.)*
- **INV-TW-010** — A blank-subrole Director History row only counts as a
  genuine "missing ND subrole" gap if the person isn't **also** already a
  Controller for that company (separate Controller History table) — and the
  profile page's own Subrole column, not the AJAX endpoint, is ground truth
  (the AJAX endpoint never surfaces "Controller" as a Role value). *(source:
  2026-08-06.)*
- **INV-TW-011** — TeamWork's per-company "Shareholders Information" table
  (on the profile page) is a **stale/historical** source — the real current
  share register is the separate `shares/share_list/<id>` per-transaction
  ledger. Sum only `status=Valid` (Active) rows, and sum multiple
  transaction rows per person (a holding can be split across allotments).
  *(source: 2026-08-11, `lib/teamwork-company-profile.ts`.)*
- **INV-TW-012** — Individual shareholders have their own rich detail card
  (`cardType==="Individual"`, distinct from `"IndividualDirector"`) on a
  TeamWork profile — must be scraped separately or contact/ID/DOB data is
  silently dropped even though fetched. Corporate shareholder cards use a
  completely different field set (Reg. No., no personal fields). *(source:
  2026-08-11.)*
- **INV-TW-013** — A Bizfile ACRA "ND" superscript marker
  (`isNomineeDirector`, per-director) is independent of whether **Tassure
  itself** supplies the ND service (`needNdService`, company-level) — the
  latter must be sourced only from Tassure's own
  `nd_appointments`/`nominee_directors` roster, never from the Bizfile
  marker. Both signals should be OR'd, neither overriding the other, when
  flagging a director as nominee. *(source: 2026-08-11.)*
- **INV-TW-014** — Bizfile PDF officer/shareholder row-boundary detection
  needs a ~8pt epsilon (not 2pt) to correctly separate multi-line wrapped
  column headers and superscript annotations (~4.5pt offset) from real row
  data; a digit-blacklist meant to strip footnote superscripts must not also
  strip a genuine single-digit share count. A table with no following
  heading on its PDF page needs an explicit footer-boilerplate floor.
  *(source: 2026-08-11, `lib/bizfile-parse.ts`.)*
- **INV-TW-015** — The "Non-TeamWork"/genuine-client detection must use
  TeamWork's `non_client` field, not `client` — `client` is unreliable and
  reads `"0"` even for confirmed active clients with a valid `client_id` (an
  entire onboarding batch, CBxxx-prefixed, was affected).
- **INV-TW-016** — A `class="..."` CSS selector on a TeamWork company
  profile page is not guaranteed unique to the section it visually looks
  like it belongs to — TeamWork's own template reuses `tble
  principal_activities` for BOTH the real Principal Activities/SSIC table
  and an unrelated PIC/Group/Holding Company/Team info table elsewhere on
  the same page (confirmed: 3 occurrences of that exact class string on one
  real company's page). Any new extractor on this page must anchor its
  table search to start after the section's own visible heading text (the
  pattern `extractOfficials` already used for its own `tble
  articles_constitution` class collision), never trust a class name alone.
  *(source: 2026-09-03, `lib/teamwork-company-profile.ts`'s `extractSsic` —
  caught by verifying against real HTML from 15 live companies before
  shipping, not assumed from a 3-company spot check.)*
- **INV-TW-017** — SSIC Activity I's own `code` field can be blank on a real
  company that genuinely has SSIC data on file (Activity II populated, or
  Activity I's own `remarks` field non-empty even with `code` blank) —
  confirmed on a real company during the 15-company spot check above. A
  "does this company have SSIC data worth writing" check must test
  `code1 OR code2`, never `code1` alone, or it will silently discard a
  company that does have real classification data.
  *(source: 2026-09-03, same investigation as INV-TW-016.)*
- **INV-TW-018** — "Does this client use OUR address service" must check
  against EVERY real Tassure office/serviced-address location, never a
  single hardcoded one — Tassure runs 5 (`lib/address-service.ts`'s
  `ADDRESS_SERVICE_LOCATIONS`), and the original `usesOurAddress()` (`app/
  api/teamwork/sync/route.ts`) only ever recognized the first (10 Anson
  Road), silently undercounting every real client registered at one of the
  other 4 — its own original comment even documented validating it only
  against companies ALREADY flagged true, never checking the reverse
  direction (a company NOT flagged, whose real address is one of ours).
  Confirmed 2026-09-07 when Vincent's boss listed the other 4 addresses
  directly. Any consumer of `companies.uses_address` (Address Service page,
  AR Reminder, Reports, Company 360, dashboard/stats) inherits this same
  risk if this list is ever incomplete again — a new Tassure office/
  serviced address must be added to `ADDRESS_SERVICE_LOCATIONS`, not a new
  one-off regex somewhere else.
  *(source: 2026-09-07.)*
- **INV-TW-019** — A Bizfile Officer(s)/Shareholder(s) table that doesn't fit
  on one PDF page continues onto the next page — the old per-page loop in
  `parseBizfilePages()` only ever looked at the ONE page containing the
  heading text and used `shareholders = extractShareholdersFromItems(...)`
  (assignment, not merge), so every row that spilled onto a continuation page
  was silently dropped. Confirmed on a real Bizfile (LAKEFILL VENTURES PTE.
  LTD., 2026-09-09, 5 shareholders with long overseas addresses): only 2 of 5
  shareholders were detected, and the result looked like a complete (if
  small) table, not an obvious failure — this is the kind of bug that passes
  a casual glance. The actual page-continuation signal took TWO attempts to
  get right against the real document: a first version walked forward until
  hitting the section's own "terminator" (the next section's heading, or —
  for Shareholder(s) — the "Includes nationality.../Abbreviation" footnote)
  — but ACRA reprints BOTH the section heading AND that footnote on EVERY
  page a multi-page table spans, not just once at the true end, so that
  version stopped one page too early (found only 3 of 5). The reliable
  signal, confirmed against the real document: a page belongs to the same
  table's continuing run if and only if it REPEATS the exact same section
  heading text; the run ends at the first page that doesn't (this also
  correctly handles a table that fits on ONE page with no continuation at
  all — the very next page starting a different, unrelated section is never
  mistaken for a continuation). `collectSectionItems()` implements this,
  offsetting each later page's Y by a large fixed step so the existing
  Y-based row/column logic keeps working unmodified across the page
  boundary. Any future Bizfile table extractor must go through this same
  page-merging helper, never assume a table's heading page is the whole
  table, and never assume a page's own repeated heading/footnote text means
  the table ends there. *(source: 2026-09-09, `lib/bizfile-parse.ts`.)*
- **INV-TW-020** — The Capital table's Currency cell can wrap onto its own
  PDF line when the currency's full name is long ("UNITED STATES OF AMERICA
  DOLLAR" vs. the shorter "SINGAPORE DOLLAR" `parseCapitalTable()` was
  originally written against) — the old code read exactly ONE line after the
  heading and split it by tab assuming 4 cells, so a wrapped currency
  silently truncated mid-word and Share Type (whichever line it wrapped onto)
  came back empty. A first fix (read forward up to 5 lines, stop at the next
  `Label\t:value` field or known heading) was ALSO wrong against the real
  document: ACRA prints an explanatory footnote sentence directly below the
  table ("Number of Shares includes number of Treasury Shares") that matches
  neither stop condition, so that version swallowed it as more cell data too
  (Currency came back as "...DOLLAR ORDINARY Number of Shares includes
  number of Treasury", Share Type as "Shares"). The real, reliable stop
  signal: every genuine cell value (however many lines it wraps across) is
  ALL-CAPS; the footnote sentence that follows always has lowercase
  connector words ("includes", "of", "the") — checked from the second data
  line onward, since the first is always numbers/tabs. First 2 tokens
  collected are Amount/Number of Shares, the LAST token is Share Type (a
  single word on every real sample seen so far — "ORDINARY"), everything
  between is Currency. A Share Type with its own multi-word qualifier (e.g.
  ACRA's "PREFERENCE (REDEEMABLE)") is a known remaining gap — flag it if a
  real sample ever turns up. *(source: 2026-09-09, `lib/bizfile-parse.ts`.)*
- **INV-TW-021** — Every ACRA Bizfile PDF page repeats a fixed disclaimer/
  print-date header block at its TOP ("ACCOUNTING AND CORPORATE REGULATORY
  AUTHORITY", "Business Profile (Company) of...", the document's own print
  date) and, on a continuation page of a multi-page Officer(s)/Shareholder(s)
  table, ALSO repeats that table's own column-header row (Name/Address/
  Identification Number/Nationality/.../Currency) — none of it is real row
  data, but nothing excluded it once INV-TW-019's page-merging started
  pulling continuation pages' items into the same coordinate space: whichever
  row sits nearest a page boundary got this junk appended to its
  address/ID/nationality/currency (confirmed on a real document: a director's
  ID/nationality/date fields, and a shareholder's currency value, each ended
  up with fragments of the adjoining page's header). Column headers ALSO
  carry their own reference-number superscripts ("Number of Shares³") that
  float ~4.5pt above whichever line they annotate (same offset
  `ROW_BOUNDARY_EPSILON` already documents for row-level superscripts) — and
  a table's own closing footnote (see INV-TW-020's "Number of Shares
  includes...") carries the same kind of superscript too. Fixed with 3
  distinct exclusion mechanisms in `lib/bizfile-parse.ts`, each necessary
  (removing any one reintroduced real contamination when tested against the
  real document): `HEADER_ITEM_PATTERNS` (the disclaimer block, stripped from
  every page except the section's own first) + `TABLE_HEADER_LABELS` (the
  repeated column-header words, stripped from every page except the first)
  + `stripSuperscriptNoise()` (the bare 1-2-digit superscripts near either a
  footnote or a header label, stripped from EVERY page including the first —
  unlike the other two, a table's own footnote/header superscript on its OWN
  first page is ALSO not real data when more pages follow). Any future
  change to this page-merging logic must re-verify against a real multi-page
  sample, not just a synthetic one — every one of these 3 exclusions was
  found by testing the actual LAKEFILL VENTURES PDF, not by reasoning about
  the code alone. *(source: 2026-09-09, `lib/bizfile-parse.ts`.)*

- **INV-TW-022** — TeamWork can REISSUE a company's internal `company_id`
  for a company we already track (confirmed real, 2026-09-11: GOLDEN
  BRIDGE MARTEC PTE. LTD., UEN 202633763E, went from internal_id 1827 to
  1837 between two sync runs — the same real client, same UEN, just a new
  TeamWork-side id). `app/api/teamwork/sync/route.ts`'s match cascade was
  `byInternal` (exact id) → `byName`, but `byName` only indexes rows with
  NO internal_id at all (a one-time healing path for legacy rows), so a row
  that already has an internal_id is invisible to it once TeamWork reissues
  a different one — the sync found no match and INSERTED A DUPLICATE
  `companies` row for the same UEN. This silently inflated every "active
  CSS Client" count by one (confirmed live: the Active Client Master List
  page showed 792 against TeamWork's own real 791) and left a real AR
  Reminder cycle (id 946) pointed at the now-stale, no-longer-synced row.
  Fixed with a third match tier — `byRegNo`, keyed on UEN, checked whenever
  internal_id and name both miss — which re-keys the existing row's
  `internal_id` to the new one instead of creating a second row; a non-zero
  `internal_id_reregistered` count in the sync's own response is the signal
  this happened again. Any future change to this route's matching cascade
  must preserve UEN as a match key, not just internal_id and name — UEN is
  the one identity TeamWork does not change. Also worth remembering:
  because this class of bug creates a real duplicate row rather than a
  wrong value on an existing one, its symptom shows up somewhere else
  entirely (a headcount metric on a different page) before anyone would
  think to look at `companies` itself — when a count is off by a small,
  exact number like this, check for a duplicate UEN before assuming a
  filter or a sync-timing issue. *(source: 2026-09-11, Vincent: "这种的要
  修复，避免下次出现一样的情况".)*

## AR/AGM cycle & ar_reminder data lifecycle (INV-AR)

- **INV-AR-001** — `ar_reminder` rows are **immutable snapshots** keyed by
  (entity_name, fye_month, fye_year). A company's FYE self-correcting does
  not retroactively touch any existing row; without an explicit fix the same
  company shows under both the old and new month. The fix must soft-delete
  (`status:'Excluded'`) the old month's still-**pending** rows only —
  already-filed old rows are real history and must never be touched.
  *(source: 2026-08-11, `ar-reminder/sync-workflow` FYE-correction block.)*
- **INV-AR-002** — `ar_reminder` inserts must use
  `.upsert(rows, {onConflict:'entity_name,fye_month,fye_year',
  ignoreDuplicates:true})`, never a plain `.insert()` — one conflicting row
  in a plain insert aborts the **entire batch**, silently dropping every
  other legitimate row. Applies to both the forward-window loop and the
  catch-up pass. *(source: 2026-08-28, `app/api/ar-reminder/generate/route.ts`.)*
- **INV-AR-003** — AR Generate only looks 6 months forward; a company whose
  fye_month rolls out of that window before its first appearance never gets
  a row without catch-up. Catch-up's "has this company ever had a row"
  check must be by **UEN**, not just `company_id` (legacy null-`company_id`
  rows caused real duplicates), and must check "has a **live row under the
  current fye_month**", not "has any row ever" — otherwise a company whose
  old-month row was excluded by an FYE correction, with no new row yet, is
  permanently invisible. *(source: 2026-08-12.)*
- **INV-AR-004** — The catch-up pass must never guess a cycle's year from
  the calendar — it must fetch the company's real TeamWork history and only
  insert a genuinely open (unheld/unfiled) cycle using TeamWork's own year,
  never a computed guess (a newly-incorporated company's first cycle can
  land a year later than assumed). *(source: 2026-08-12.)*
- **INV-AR-005** — Once a newer `ar_reminder` row exists under a company's
  current fye_month, an older still-open cycle behind it becomes
  **structurally invisible** to catch-up forever (catch-up only fires for
  zero-row companies) — ~897 companies system-wide match this shape. The
  permanent fix is to hook backfill into the FYE-month **correction event**
  itself (bounded, rare) rather than a daily full-company scan (timeout
  risk). *(source: 2026-08-27/28.)*
- **INV-AR-006** — A "STRIKE OFF" skip condition in Late Filing detection
  must not match "STRIKE OFF – CLIENT LODGED OBJECTION" — an unresolved
  objection means the outcome isn't settled and filing the overdue AR can be
  part of resolving it. *(source: 2026-08-27.)*
- **INV-AR-007** — Active Client's "Last AGM/AR Date" (fully automated,
  derived from a company's **whole** TeamWork history) is functionally
  distinct from AR Reminder's per-cycle, staff-editable
  `date_of_agm`/`filling_date` — the two must be cross-checked for mismatch,
  never conflated as duplicate displays of the same value.
- **INV-AR-008** — AR Reminder's `date_of_agm`/`filling_date` manual edits
  take absolute priority: a `_manual` flag set true on save, cleared only
  when the cell is emptied; sync must skip the field entirely (not just
  "fill once") when `_manual` is true. The internal `agm_held_date`
  progress signal (distinct from the user-facing `date_of_agm`) always
  mirrors TeamWork regardless.
- **INV-AR-009** — AR Reminder's cross-cycle search must query
  `ar_reminder` directly, not just the TeamWork-derived `companies` roster
  — a company mirrored in from Late Filing (because it has no `companies`
  row, e.g. struck off) is otherwise permanently unfindable.
- **INV-AR-010** — A company 90+ days overdue in Late Filing (stricter than
  AR Reminder's own "late" bar) must get its own `ar_reminder` row inserted
  if none exists — such a company can predate AR Generate's rolling window.
  The `⚠ LATE FILING:` marker prefix must never be rewritten into remarks
  once present, so a staff edit to Remarks always sticks.
- **INV-AR-011** — AR Reminder's Invoice column must resolve TAB/TAC
  numbers by matching each row to its **own** FYE cycle
  (`fyeDateString(fye_month, fye_year)`), never the currently-browsed
  month/year — a stale-overdue row can carry a past `fye_year`.
- **INV-AR-012** — AR Reminder/Billing default cycle selection must use the
  **mode** (most common fye_month/year) of the last 30 invoices, never
  simply "most recently created" — one out-of-sequence invoice can
  otherwise hijack the whole page's default.

## PIC / staff assignment (INV-PIC)

- **INV-PIC-001** — `resolveTeamworkPic()` must split and resolve
  **comma-separated** multiple TeamWork ids (e.g. "9,11" for a co-assigned
  company) — a single-id-only matcher leaves such companies showing raw ids
  forever. The sync's own stale-value overwrite guard regex must also
  recognize the comma-separated shape (`/^\d+(,\d+)*$/`) or future syncs
  never re-resolve it. *(source: `lib/teamwork-pic.ts`.)*
- **INV-PIC-002** — PIC-style columns (ND, Secretary, ACC/TAX PIC, Contact
  Window, Add @) must format via `formatStaffName()` identically for
  **both display and column-filter matching** — Chinese names untouched,
  everything else Title Cased and expanded from staff-directory shorthand
  to full name — or one person splinters into multiple filter-dropdown
  variants. Editing must always show/edit the raw stored value; formatting
  is never a silent rewrite of stored data.
- **INV-PIC-003** — `titleCase()` must not blindly capitalize
  `word.charAt(0)` — a token like "(CHEN" capitalizes the parenthesis
  (no-op), leaving "chen" lowercase; caused real mis-cased legacy
  "YES (name)" values.
- **INV-PIC-004** — ACC/TAX PIC is two-way synced between AR Reminder and
  Active Client: whichever page was edited most recently wins and mirrors
  to the other. An Active Client edit mirrors onto **every** `ar_reminder`
  row for that UEN across all FYE cycles (no per-cycle PIC concept there to
  disambiguate).
- **INV-PIC-005** — Secretary's "active" checkbox must always exactly equal
  `!!secretary` (has the text field content) — it is not an independent
  status flag, purely a "has content" indicator. Same rule for `nd_active`
  vs. `nominee_director` text. Both server PATCH and client optimistic
  state must derive this identically or the checkbox visually desyncs until
  reload.
- **INV-PIC-006** — A column-filter dropdown over a multi-name field (PIC-
  style columns via `formatStaffNameList()`, plus `directors`/`shareholders`
  which are real people but never staff-directory-resolved) must decompose
  each cell into its individual names for BOTH the option list and the
  row-match check — never treat "Zhang Dan, Xu Min" as one opaque value
  splintered from "Zhang Dan" alone. Confirmed live 2026-09-05: the same
  nominee director/shareholder is genuinely reused across many companies
  paired with a different co-appointee each time (e.g. "Zhang Dan" appears
  in `directors` alongside "Sun Changjiang", "Feng Jiong", "Song Jianfeng"
  on different real companies) — a filter keyed on the whole raw string
  could never let staff select "every company with Zhang Dan," only one
  specific pairing at a time. `components/MasterListTable.tsx`'s
  `ColumnFilterMenu` and `app/billing/page.tsx`'s `ARColumnFilterMenu` both
  implement this via a parallel `displayFieldValues()`/`arColumnValues()`
  (plural) alongside the existing singular display formatter — the singular
  one still governs what the cell itself shows, untouched. `app/reports/page.tsx`'s
  `DimensionFilterMenu`-based `pic` dimension was NOT touched in the same
  pass (its `value: (r) => string` contract is shared by the pivot
  table/chart, not just filtering, so decomposing it is a larger, separate
  change) — still splinters on multi-name PICs as of this writing.
- **INV-PIC-007** — A QuickBooks Class/Location tag, or `companies.pic`
  (always a Corporate Secretarial value), resolving to a real staff name does
  NOT mean that name belongs on every QB company's PIC — TAB's PIC must only
  ever be Corporate Secretarial staff, TAO's only ever Accounting/Tax staff
  (`lib/soa-owner.ts`'s `PIC_TEAMS_BY_COMPANY`/`picAllowedForCompany()`, used
  by `computeSuggestedOwner()`/`collectInvolvedStaff()` AND the
  `companies.pic` union in `lib/soa-data.ts`). Real data violates this: a
  mistagged TAB invoice's Accounts line carried Class="Lee Jing Fei"
  (Accounting), which a 2026-09-07 fix (see this file's `collectInvolvedStaff`
  comment) had treated as a genuine co-assigned PIC — Vincent, 2026-09-17,
  confirmed after seeing it surface in a real A/R Ageing export ("TAO 为什么
  会出现sec 的人？...tab 要只会有sec的人") that this was itself the bug, not
  a real cross-team assignment, and must be filtered rather than shown. TAC
  is deliberately NOT in this map — its PIC is the current Nominee Director
  (INV-QB-008), not a staff-team-restricted signal. **Widened 2026-09-17,
  same conversation**: `Corporate Secretarial (Malaysia)` is ALSO valid on
  both TAB and TAO — Malaysia-side staff (e.g. Tey Shemin) aren't split into
  separate Secretarial/Accounts/Tax teams the way Singapore staff are, so
  the same person legitimately handles both kinds of work there; confirmed
  against real data (63 genuine `soa_owners` rows already recorded her that
  way before this rule existed). Don't assume this list is exhaustive —
  verify any FUTURE team addition against real `soa_owners`/PIC data the
  same way, rather than reasoning from the org chart alone.
  **Also found the same day**: this rule only governs the AUTOMATIC
  suggestion — the human-override table `soa_owners` had 119 real rows
  (31% of the table) recording a WRONG-team staff member, all written by a
  2026-09-07 backfill script (`updated_by_email='backfill@internal'`) that
  ran under the OLD "same owner regardless of book" theory this rule
  replaced, before the per-book split existed. A manual override always
  wins over the (now-correct) auto-suggestion, so these stale rows kept
  masking the right answer even after this filter shipped — e.g. ACN
  Consultants Pte Ltd's TAB row recorded "Tee Yu Heng" (Accounting) while
  the real invoice Class field correctly says "Ang Shi Ming". Cleaned up via
  `scripts/backfill-clean-soa-owner-mismatches.js` (deletes only
  still-mismatched `backfill@internal` rows under the CURRENT team rule,
  never a row a real human has touched since — idempotent, safe to re-run).
  **Lesson**: fixing the computed-signal side of a PIC rule is not enough
  when a persisted human-override table exists for the same field — check
  it for stale data seeded under the old logic in the same pass, not as an
  afterthought.
  **Found later the same day**: the "Widened" fix above (allowing
  `Corporate Secretarial (Malaysia)`) had a real side effect on the FIRST
  cleanup pass — 19 of the 63 real `Tey Shemin` `soa_owners` rows that
  "confirmed" the widening were themselves stale `backfill@internal` rows
  that a genuine staffing handoff had made wrong, and widening the team
  rule made them stop looking mismatched to `scripts/backfill-clean-soa-
  owner-mismatches.js`, so they survived that cleanup even though they
  were wrong — e.g. TAO's Iuiga New/One/Retail Chain/Retail Management/
  Retail/Technologies Pte. Ltd. all recorded "Tey Shemin" while their real,
  more-recent invoice Class fields clearly show "Lee Jing Fei"/"Quinnie
  Tan" doing the actual work. Surfaced by Chelsea noticing it on a real
  TAO export ("shemin 还在tao？"). Fixed by auditing EVERY remaining
  `soa_owners` row for that person against the MOST RECENT real invoice
  Class for that exact (customer, qb_company) — 44 confirmed genuinely her
  (kept), 9 had no Class evidence either way (kept, no better signal
  exists), 19 were directly contradicted (deleted via new
  `scripts/backfill-clean-soa-owner-contradicted.js`). **Lesson**:
  widening a team-restriction rule and cleaning stale data under that same
  rule in one pass can hide genuinely-wrong rows from the cleanup — when
  a rule change makes previously-flagged data "look correct" again,
  independently verify a sample against the underlying source-of-truth
  data (real invoices here), not just against the updated rule.

## Recipient / CC / email address (INV-MAIL)

- **INV-MAIL-001** — Canonical recipient policy (`lib/campaign-recipients.ts`):
  external addresses → To; Tassure-domain addresses → CC; always exclude
  `cindy@tassure.com` (both aliases); always add `hoechyi@tassure.com` to CC
  (must fire on **every** resolution branch — a bug let the
  fallback/no-recipient-source branch skip it entirely); remove
  `sengxin@tassure.com` from CC whenever `kahye@tassure.com` is present. CC
  also always includes SEC PIC (`companies.pic`), plus AR-cycle-specific
  ACC/TAX PIC for AR campaigns.
- **INV-MAIL-002** — A recipient source label alone (e.g.
  `'teamwork_report'`) must not be trusted as proof a real To-email exists
  — must additionally check `tw_to_emails.length > 0`, or a known email
  that a later fill-in correctly populated can still resolve to "no email
  found."
- **INV-MAIL-003** — The TeamWork Contact-Person-report fill-in must keep
  **every** contact person for a company (write all unique emails to
  `tw_to_emails`), not just the first found.
- **INV-MAIL-004** — The "Dear {{contactName}}" greeting must read "All"
  whenever more than one To-recipient is going out, not silently default to
  whichever contact happens to be first.
- **INV-MAIL-005** — A fill-in sync must only ever populate a currently
  **empty** email field — never override an existing value from another
  source, even if the two disagree (staff-curated data can be more accurate
  than TeamWork's own report).

## Document / template generation (INV-DOC)

- **INV-DOC-001** — ROND/RONS declaration templates must keep **both** the
  "has nominee"/"no nominee" clauses and strike through the inactive one —
  never remove it — matching the template's own "* Delete as appropriate"
  instruction; per-nominee blocks repeat once per nominee with both
  nominator-type sub-paragraphs left in place (inapplicable one just
  renders blank).
- **INV-DOC-002** — Share Certificate signer/title selection follows a
  fixed fallback order: explicit non-nominee director → any nominee
  director → any other director → company secretary. Templates 13/14 sign
  using the **shareholder's own** declared corporate director names, not
  the company's directors.
- **INV-DOC-003** — A TeamWork-scraped "DD/MM/YYYY" dob must be converted
  to ISO (`teamworkDateToIso()`) before feeding an `<input type="date">` —
  that input silently renders blank for any non-ISO value, so data can be
  correctly synced/stored while still being invisible in the UI at every
  auto-fill point.
- **INV-DOC-004** — `email_drafts.company_id` is `companies.id`, **not**
  `ar_reminder.id` — an assumption to the contrary silently mirrored an
  "email sent" auto-fill onto a completely unrelated company's ar_reminder
  row.
- **INV-DOC-005** — The **Nominator** (`nominatorType`/`nominatorInd*`/
  `nominatorCorp*` on both `PostIncorporateDirector` and
  `PostIncorporateShareholder`) is a genuinely SEPARATE real person/entity
  from the ND (nominee director) or nominee shareholder they nominate — NOT
  the same person filling a second role. Confirmed directly from "08
  Declaration of Maintenance of ROND"'s own template text: the per-nominee
  block is a letter FROM the Nominator TO the company ("I, the undersigned,
  have appointed a nominee director of the Company..."), signed by the
  Nominator in their OWN capacity — `signature_position: 'Director'`
  (`lib/docx-post-incorporate.ts`'s `nomineeDirectorItem()`) means the real
  nominator is very often ALSO a director of the same company (a controlling
  shareholder/director who requested the ND arrangement), never that the
  nominator "is" the ND. A previous version of `app/post-incorporate/
  page.tsx`'s Bizfile-parse handler read this backwards and auto-filled the
  Nominator fields with the ND's OWN bio (`nominatorIndName: d.name`) —
  confidently wrong data on a real legal declaration, worse than leaving it
  blank. Bizfile itself carries no nominator data at all and never will (it's
  the official ACRA extract, which has no such concept) — any future
  auto-fill attempt here must not reach for the ND's/nominee's own record as
  a stand-in. The safe assist is a "pick an existing Director/Shareholder to
  copy their details in" convenience (since the real nominator is very often
  already one of them), never a blind default. *(source: 2026-09-09,
  confirmed on a real company, LAKEFILL VENTURES PTE. LTD. — Vincent: "我之
  前一直误解了我把ND 当成是 NOMINATOR".)*
- **INV-DOC-006** — `lib/docx-post-incorporate.ts` (and `lib/docx-xml.ts`
  underneath it) is a SERVER-ONLY module (`import fs from 'fs'`, `PizZip`) —
  importing even ONE plain value from it (not a `type`-only import) into a
  client component pulls the whole module, `fs` included, into the browser
  bundle and breaks `next build` with "Module not found: fs". Confirmed
  real: `app/post-incorporate/page.tsx` needed `formatDisplayDate()` (a
  small, pure, dependency-free function) purely for on-screen display, which
  broke the build the moment it was imported this way. Fixed by moving that
  one function to `lib/date.ts` (already browser-safe, already imported by
  several client pages) instead of trying to import it from
  `docx-post-incorporate.ts`. Any future helper needed by BOTH a Post
  Incorporate client page and the server-side document generator must live
  in a dependency-free shared module (`lib/date.ts` or a new one), never be
  pulled through `docx-post-incorporate.ts`/`docx-xml.ts` itself — `import
  type { ... }` from those two files is fine (erased at compile time), a
  real value import is not.
- **INV-DOC-011** — `pdf-lib`'s `StandardFonts` (Helvetica etc.) only encode
  WinAnsi — `page.drawText()` throws SYNCHRONOUSLY for any character outside
  it, confirmed live: `'吉木锌国际贸易（上海）有限公司'` throws `WinAnsi
  cannot encode "吉" (0x5409)`. Any real client/company name or free-text
  QuickBooks field drawn onto a PDF with a StandardFont MUST be passed
  through a filter (`app/api/billing/soa/pdf/route.ts`'s `safeText()`) before
  `drawText()`, never drawn raw — this app's own real client base includes
  Chinese-registered names (`lib/quickbooks.ts`'s
  `CUSTOMER_NAME_CORRECTIONS`), so this is not a theoretical edge case. Found
  2026-09-17 by adversarial code review, before shipping: the SOA Statement
  cover page (`drawStatementCoverPage()`) called `pdfDoc.addPage()` before
  any `drawText()`, and the caller's `try/catch` swallowed a mid-draw throw
  WITHOUT removing that already-added page — a half-drawn page (letterhead +
  a bare "To:" label, no client name, no totals) would have silently shipped
  in a real client's downloaded/emailed Statement, with zero error surfaced
  anywhere. The fix has two independent layers, both required: (1)
  `safeText()` so a CJK name never throws in the first place, degrading to
  visible placeholder text rather than a blank; (2) the `try/catch` around
  page-drawing must still track the page count BEFORE drawing and
  `removePage()` anything added if it throws anyway, since (1) can never be
  proven to cover every future draw call someone adds later. Proper CJK
  glyph rendering (an embedded Unicode font via `fontkit`) was deliberately
  out of scope — `safeText()` is a crash-safety net, not a real
  Chinese-text-rendering feature.
- **INV-DOC-012** — The SOA "All" page's own Draft Email / Download PDF
  actions are the ONE deliberate exception to "TAB/TAC/TAO always stay
  separately scoped" (INV-PIC-007's own domain) — Vincent, 2026-09-17,
  re-examining the "1V Capital" example that started the whole SOA
  Statement feature: "当我在All 那边点 Draft 是要一起附带上 TAB/TAO/TAC的
  就和之前的一样...Total 也是TAB/TAO/TAC的 加在一起" (combine all 3 books
  into one Statement, matching how this worked before the per-book pages
  existed). A PRIOR version of this code had explicitly documented the
  opposite as intentional ("rowCompany(c) is always a real QbCompany, never
  the literal 'ALL' — SoaDetail... needs one real system to scope to, even
  when this modal was opened from the combined All list") — that comment
  was correct for its own time but is now superseded; don't reintroduce
  "always resolve to one real book" as an assumption anywhere in this
  flow. The combine path: `app/api/billing/soa/pdf/route.ts` accepts
  `company=ALL` (queries `.in('qb_company', [...])` instead of `.eq()`,
  builds the cover page via `combineStatementRows()` summing each book's own
  `computeSoaRows()` result — never a second, independently-computed total),
  `app/api/billing/soa/detail/route.ts` the same for the invoice-level list,
  and `lib/soa-actions-client.ts`'s `buildSoaDraft()` passes `qbCompany:
  undefined` to `buildCampaignDraft()` when combining (that's
  `buildRow()`'s own default — no filter — not a 4th fake `QbCompany`
  value threaded through `lib/client-comms-resolve.ts`). The on-screen
  All LIST itself is unaffected — still 2+ separate un-deduplicated rows
  per company, one per book (docs/CURRENT_STATE.md) — only the Draft/PDF
  ACTION combines.
- **INV-DOC-013** — A raw PDF content stream's operator ORDER is not its
  visual Y-position — reverse-engineering a reference PDF's layout by
  reading its decompressed content stream top-to-bottom and assuming that
  matches top-to-bottom on the page is wrong, because each drawing op
  carries its OWN absolute/relative position (`cm`/`Tm` transforms), and a
  PDF is free to draw a page's visual FOOTER before its HEADER in stream
  order. Found live 2026-09-17: `drawStatementCoverPage()`'s first
  implementation put an aging-bucket summary table both above the
  letterhead AND as a footer, having misread the reference PDF's own single
  footer-only table (its content stream happened to draw it FIRST) as two
  separate top+bottom instances — confirmed wrong only when Vincent
  screenshotted his real reference side-by-side with this function's actual
  rendered output ("排版格式差太多了吧，那个有LOGO的才是正确的排版"). The
  safe way to reverse-engineer a reference PDF's layout: render it and
  compare screenshots/visual position, or track each block's actual y
  coordinate through the nested `cm` transforms — never assume stream order
  means page order. Same investigation correctly extracted the reference's
  embedded T Assure logo image (an `/Image` XObject, raw RGB pixels,
  `zlib.inflateSync` + `sharp` to re-encode as PNG) — saved as
  `public/assets/tassure-statement-logo.png` and embedded via
  `pdfDoc.embedPng()` — that extraction method itself is correct and durable
  for any future need to pull an asset out of a reference PDF.
- **INV-DOC-014** — The Statement cover page's TO block must print the
  client's own real QuickBooks data, not this app's own `companies` table
  convention. Found live 2026-09-17, same day as INV-DOC-013, a second real
  mismatch Vincent caught by comparing his reference PDF again: "地址都没有
  看到" (the client's mailing address wasn't printed at all) and "你最新版的
  位置不对" (the block's spacing looked wrong — a direct symptom of the
  missing address leaving the wrong-looking gap). Two causes: (1)
  `drawStatementCoverPage()` was printing `row.companyName`, which for a row
  sourced through `computeSoaRows()` can be the `companies` table's own
  ALL-CAPS display convention (e.g. "1V CAPITAL PTE. LTD.") instead of
  QuickBooks' actual mixed-case DisplayName ("1V Capital Pte. Ltd." — the
  reference's own printed name); (2) the client's registered mailing address
  was never fetched or printed at all — `SoaCompanyRow` doesn't carry it,
  and nothing else in the request path did either. Fixed by having the route
  (`app/api/billing/soa/pdf/route.ts`) pass the ALREADY-RESOLVED raw QB
  customer_name (`resolvedRawName` — the same exact-match value the
  invoice/credit-memo merge already settled on, see INV-DOC-012's own
  resolution note) as the printed name, and by live-fetching that exact
  QuickBooks Customer's `BillAddr` (`findCustomer()` +
  `addrToLines()`, both in `lib/qb-invoice-conventions.ts`, `addrToLines`
  newly exported for this) at generation time — never stored redundantly in
  this app's own tables, best-effort (an unreachable book or a customer with
  no BillAddr on file just skips the address block, never fails the whole
  Statement). Confirmed against real data: TAB's own BillAddr for "1V
  Capital Pte. Ltd." has its entire address jammed into a single `Line1`
  string ("100 Lorong 23 Geylang #04-03 D' Centennial Singapore 388398") —
  genuinely different real data than TAO's own record for the same real
  company (which has it properly split across `Line1`/`Line2`/`City`/
  `PostalCode`, and is even a DIFFERENT physical address, "60 Paya Lebar
  Road") — this app prints whatever that book's own field actually contains
  rather than attempting to normalize/re-split free text, since guessing at
  a client's real address is worse than an occasionally-unsplit line. The
  cover-page drawing code itself moved out of the route file into
  `lib/statement-pdf.ts` (`drawStatementCoverPage`, `combineStatementRows`,
  `safeText`, `StatementRow`) purely so it could be verified against real
  QuickBooks/Supabase data via a standalone `tsx` script outside the
  Next.js/proxy.ts auth wall — same reasoning as this file's own bar for
  real-data verification, not a design preference. "STATEMENT NO." and
  "ENCLOSED" (both present in the reference) remain deliberately omitted:
  the former is QuickBooks' own internal web-UI-only Statement-numbering
  sequence with no API equivalent (inventing one would be a fabricated
  business record), the latter is boilerplate with no real value this app
  could show under it.
- **INV-DOC-015** — On the Statement cover page, a bottom-anchored summary
  table must be positioned by its distance from the page bottom, not by
  flowing immediately after whatever content precedes it — and a
  multi-column header's fill color must span the same width as any other
  full-width table on the same page, not a column-width subtotal that falls
  short of it. Found live 2026-09-17, third round on this same page, Vincent
  comparing his reference PDF pixel-by-pixel: "位置很重要，宽度也很重要，
  上下的位置，蓝色的宽度，是否有对齐" (position matters, width matters too —
  top-to-bottom position, the blue's width, whether things line up). Two
  real bugs: (1) `drawAgingTable()`'s footer instance was being drawn right
  after the last itemized row's `y`, so a short statement (few line items —
  the reference's own 1-invoice example) left the aging summary crowded
  right under the list instead of anchored near the bottom margin with the
  rest of the page blank, which is how the reference actually looks. Fixed
  by pinning to a fixed `AGING_TABLE_Y = 140` (only pulling `y` DOWN into
  empty space, never up over already-drawn rows — a long item list that
  already runs past that point is left to flow naturally, or spills to a new
  page). (2) the itemized table's `OPEN AMOUNT` column had a fixed 90pt
  width, but the DATE+DESCRIPTION+AMOUNT+OPEN AMOUNT widths only summed to
  480pt against a ~512pt content area — its blue header band stopped ~32pt
  short of the right margin, visibly narrower than the aging table's own
  full-width blue band directly below it, so the two tables' right edges
  didn't align. Fixed by dropping OPEN AMOUNT's fixed width so it stretches
  to `right`, the same "last column reaches the true margin" rule the aging
  table already followed. A third, related bug found in the same pass:
  `billAddrLines` was being drawn via `page.drawText(..., { maxWidth })` —
  pdf-lib's own auto-wrap — and a real BillAddr can be ONE long unsplit
  `Line1` (confirmed same day, INV-DOC-014) that wraps to 2+ visual lines
  pdf-lib draws internally; this function's own `y -= 13` per nominal
  "line" never knew those extra visual lines happened, undercounting the
  vertical space actually used and crowding whatever printed next. Fixed by
  wrapping manually first (`wrapLine()`, greedy word-wrap against real font
  metrics) so every `drawText` call this function makes is a single real
  line it fully accounts for in its own `y` tracker. General lesson: on this
  page, ANY place that reserves vertical space by reading back how much a
  drawText call visually consumed (instead of the caller measuring it
  first) is a latent version of this same bug.
- **INV-DOC-016** — Not every field on a reference document is equally safe
  to reproduce: a fixed caption/label is fine to copy exactly (no data
  behind it to get wrong), but a per-document identifier this app has no
  real source for must stay omitted rather than invented, even under
  pressure to "match the reference exactly." Found live 2026-09-17, Vincent
  pointing at the reference's STATEMENT NO./DATE/TOTAL DUE/ENCLOSED block as
  a whole: "这个你没有部分重现吗？" (didn't you reproduce any of this?). On
  review, the earlier round's blanket omission of ENCLOSED was simply
  wrong — it's fixed boilerplate on every real QuickBooks-printed Statement
  regardless of what's being sent, never a per-Statement value, so printing
  it exactly as the reference does (no value beside it — that IS the
  correct look, not a placeholder needing a value) involved no fabrication
  at all. Now reproduced in `drawStatementCoverPage()`. STATEMENT NO. is
  the opposite case and correctly stays omitted: it's QuickBooks' own
  internal per-Statement numbering sequence (the reference shows 10498),
  assigned only by its web-UI "Create statements" flow with no API
  equivalent — this app has no real value for it, and inventing one
  (blank, zero, or a self-minted counter) would be a new business record
  Vincent hasn't authorized, not a simplification. The general rule: when a
  reference field is missing, ask "is this a constant caption, or a real
  per-document data value?" before deciding whether reproducing it is safe
  — the two look identical on the page but are opposite risk categories.
- **INV-DOC-017** — `SoaCompanyRow.lineItems[].docNumber` (from
  `computeSoaRows()`) is not always the real QuickBooks invoice number —
  confirmed live 2026-09-17, fourth round on the Statement cover page,
  Vincent: "这部分为什么生成出来的没有像这个那么完整" (why doesn't the
  generated DESCRIPTION column look as complete as the reference's "Invoice
  No.02610894: Due 31/07/2026. XBRL for the year (FYE 31.12.2025)"). Two
  real gaps: (1) the real invoice number for that exact example is
  "02610894" (confirmed against both `quickbooks_invoices.invoice_no` and
  `quickbooks_invoice_items.invoice_no`), but `SoaCompanyRow.lineItems`
  carried it as "2610894" — the leading zero silently lost in the
  fresh-snapshot (`quickbooks_ar_aging_detail`) path, confirmed systemic
  (433 of 541 real unpaid invoices, not just this one) and fixed at its
  actual source, not just here — see INV-QB-022, found immediately after
  this entry when Vincent pushed back on treating this fix as complete
  without checking further ("你不要忘记看远一点"); (2) `lineItems` never carried
  the invoice's real line `Description` at all (a real field, present in
  `quickbooks_invoice_items.description`, e.g. "XBRL for the year (FYE
  31.12.2025)\n\nConversion of statutory financial statements..." —
  QuickBooks' own printed Statement shows only the first line). Fixed in
  `app/api/billing/soa/pdf/route.ts`'s `resolveInvoiceDetails()`: rather
  than trust `docNumber`, it re-derives both the real invoice number and
  description from `matched` — the SAME real `quickbooks_invoices` rows
  (with real `qb_invoice_id` + `invoice_no`) already fetched earlier in the
  route to merge the real invoice PDFs, joined to `quickbooks_invoice_items`
  by exact `qb_invoice_id` (never a fuzzy/numeric-string match against the
  already-corrupted `docNumber`), and keyed for lookup by
  `String(Number(invoice_no))` so a lookup FROM the possibly-stripped
  `docNumber` still finds the right row. Best-effort — any failure here
  falls back to the plain "docNumber (Type)" form the itemized table already
  used before this round, never blocks the Statement. General lesson: a
  `computeSoaRows()`-sourced row is a real-time AGGREGATE for the on-screen
  list (Company/PIC/aging/total) — that's the one place INV-PIC-007 and
  friends require strict accuracy — but its own per-line fields
  (`docNumber` especially) are not guaranteed to preserve every formatting
  detail of the source document; anything that needs the exact printed
  form of a real business document (an invoice number going out to a
  client) should re-derive it from the actual source row, not from
  `computeSoaRows()`'s own convenience shape.
- **INV-DOC-018** — Verifying a "match the reference exactly" document
  against a screenshot is not the same as verifying it against the actual
  reference PDF file — a screenshot can visually read as "close enough"
  while still hiding real structural differences a byte-level comparison
  catches immediately. Found live 2026-09-17, Vincent's fifth round asking
  point-blank "SOA PDF格式生成已经做到和QB一模一样了吗？" (has the Statement
  PDF format generation now been made to match QuickBooks exactly?) after
  4 rounds of screenshot-based fixes already landed — the honest answer
  required going back to the ORIGINAL real reference PDF file itself
  (found still on disk from earlier in this exact investigation) rather
  than continuing to eyeball screenshots, which surfaced two more real,
  previously-invisible gaps: (1) the reference's TO block prints the
  customer's name TWICE — not a rendering quirk, but QuickBooks' own
  Customer.CompanyName field (a real field distinct from DisplayName,
  confirmed via a direct Customer query) printed as its own second line
  below DisplayName, unconditionally, even when the two happen to be
  identical; (2) the reference's itemized DATE column shows the invoice's
  real transaction date ("24/07/2026"), not its due date — confirmed the
  real txn_date WAS already available in `quickbooks_ar_aging_detail`/
  `ArAgingDetailRow` (surfaced days earlier while investigating INV-QB-022)
  but was never threaded through into `SoaCompanyRow.lineItems`, which
  only ever carried `dueDate`. Fixed: `findCustomer()`
  (`lib/qb-invoice-conventions.ts`) now also returns `companyName`,
  printed as an unconditional second TO-block line in
  `drawStatementCoverPage()` whenever QuickBooks has a real value for it —
  never deduplicated against the primary name, since the reference itself
  doesn't deduplicate. `SoaCompanyRow.lineItems` gained a `txnDate` field
  (both the fresh-snapshot and legacy computation paths, falling back to
  `dueDate` when a real txnDate genuinely isn't available — no existing
  consumer's behavior changes), and the Statement's DATE column now reads
  `txnDate` while the DESCRIPTION text's own "Due DD/MM/YYYY" continues
  reading `dueDate` — these are genuinely two different real dates and the
  reference itself shows both, just in different places. General lesson:
  when the ground truth is a real file the user already has, ask for it
  (or check whether an earlier round of the same investigation already
  saved a copy) rather than continuing to iterate against a photo of it —
  a photo can look right while a `pdf-lib`/content-stream-level read
  reveals it wasn't.
- **INV-DOC-019** — A staff-facing abbreviation and a client-facing label
  are two different requirements on the same underlying data, and sharing
  one lookup table between them is wrong even when it looks like harmless
  reuse. Found live 2026-09-18: the Statement PDF's itemized DESCRIPTION
  column fell back to `TXN_TYPE_TAGS` (`lib/soa.ts`) for a non-Invoice line
  — e.g. "3343 (PM)", "Trial Balance -Dec'23 (JE)" — printing Vincent's own
  2-letter internal-staff shorthand (Deposit→DP, Payment→PM, Journal
  Entry→JE, explicitly spec'd "kept short since these sit inline next to a
  number" for the on-screen SOA list/Company 360) straight through to a
  real client's copy of the Statement. Vincent: "客户也不知道是什么" — a
  client has no way to know what "(PM)" means. Fixed by adding a SEPARATE
  export, `TXN_TYPE_LABELS` (`lib/soa.ts`), used only by
  `lib/statement-pdf.ts` — full English words, only remapping "Credit
  Memo"→"Credit Note" (this business's own client-facing term for it, same
  normalization `TXN_TYPE_TAGS` already does), everything else falling
  through to QuickBooks' own already-correct full type name. `TXN_TYPE_TAGS`
  itself is UNCHANGED — the on-screen staff UI (`app/billing/soa/
  _components.tsx`, `app/companies/[id]/_components.tsx`) still uses the
  compact codes Vincent explicitly asked for there; narrowing those to full
  words too would have been an unrequested, unwanted regression in the
  other direction. General lesson: before reusing an existing lookup table
  for a new consumer, check who the ORIGINAL one was designed for — internal
  shorthand and external wording are often genuinely incompatible
  requirements on the same enum, not two call sites that happen to want the
  same string.
- **INV-DOC-020** — The combined "All books" SOA Statement is TWO real,
  legitimately different documents, not one document with two possible
  formats — a single merged PDF (cover page + every book's real invoice
  PDFs concatenated, `app/api/billing/soa/pdf`'s `company=ALL` mode,
  INV-DOC-012) for the standalone "Download SOA PDF" button, and — added
  2026-09-18 — N separate per-book PDFs as individual attachments for the
  DRAFT EMAIL specifically. Vincent, correcting his own earlier framing of
  what "All" should do: "其实是当我在All 的时候，就要出现TAB/TAO/TAC 单独
  的3个SOA PDF，而这3个SOA PDF 要加到All 的 Draft 内...类似于截图中只有
  TAB/TAO两家公司，所以在Drafts 的时候就只需要附带 TAB/TAO 的SOA PDF，不
  需要TAC的" — for a company owing on 2 of the 3 books, the draft needs
  each of those 2 books' OWN complete Statement PDF as its own attachment,
  not one file combining them, and never a third attachment for a book with
  no real balance. At the time, "当然在外面Download PDF的时候可以单独下载
  选择 TAB还是TAO的 SOA PDF" was read as confirming the standalone download
  button (per book, or the existing single merged 'ALL' PDF) was never the
  part that was wrong, so `downloadSoaPdf()` (`lib/soa-actions-client.ts`)
  itself was left UNCHANGED in this first round — that reading turned out
  to be incomplete; see the correction below, same day. `buildSoaDraft()`
  changed: for `qbCompany === 'ALL'`, it
  now tries all 3 books' own single-book PDF endpoint (the exact same one
  each book's own "Download SOA PDF" button already calls) in parallel and
  keeps only the ones that succeed — a 404 there is not an error, it's
  exactly how that endpoint already reports "this book has no real
  balance for this company," so treating it as "skip this attachment" is
  reusing an existing, already-correct signal, not inventing a new
  determination of which books have a balance. `buildCampaignDraft()`'s own
  `attachment?: File | null` widened to `attachments?: File[] | null` to
  carry them — safe because `additional_attachments` on `DraftLike` was
  ALREADY `File[]` end-to-end (the real Outlook draft creation in `lib/
  draft-helper-client.ts` already maps over it), and `buildSoaDraft()` was
  confirmed to be the ONLY real caller ever passing this param (`npx tsc
  --noEmit` across the whole project would have caught any other caller
  still using the old singular name). Verified against the real 1V Capital
  example from the screenshot: TAB and TAO's own single-book PDF fetch both
  genuinely succeed, TAC's genuinely 404s (checked directly against
  `quickbooks_invoices`/`quickbooks_credit_memos`, the same tables that
  route's own 404 check reads) — confirming the draft will correctly
  attach exactly 2 files, never a spurious third.

  Correction, same day: the standalone "Download SOA PDF" button in 'ALL'
  mode DID still need to change — it had kept silently calling
  `downloadSoaPdf(name, 'ALL')` and only ever produced one merged file.
  Real proof, not more wording: a live screenshot of the button doing
  exactly that, and "为什么还是Download All 的". `当然在外面Download PDF的
  时候可以单独下载选择 TAB还是TAO的 SOA PDF` actually meant the button
  itself should let him choose TAB's or TAO's PDF individually, not that it
  should be left alone. Fixed by giving `SoaDetail` (`app/billing/soa/
  _components.tsx`) a `SoaDownloadPopover`, rendered only when `qbCompany
  === 'ALL'`: it lists every book with a real balance — derived from the
  same `invoices` array the line-item table already renders, so it cannot
  disagree with what is on screen — as its own one-click single-book
  download, plus (Vincent's own final refinement, "再优化一点就是点击下载
  TAB / TAO / All (TAB+TAO)") an explicitly-labeled combined option at the
  bottom, shown only when 2+ books have a balance, still calling the same
  `downloadSoaPdf(name, 'ALL')` from round 1 unchanged. Single-book pages
  (a real `qbCompany`, never `'ALL'`) keep the original plain button.
  Verified the same way as round 1, directly against 1V Capital's real AR
  aging snapshot: TAB 1 row, TAO 3 rows, TAC 0 rows — so the picker lists
  exactly `['TAB', 'TAO']` plus an `All (TAB+TAO)` option, matching what
  the account actually owes.

  General lesson for both rounds: a fix built from Vincent's wording alone,
  without watching the specific control get used, is provisional — "当然在
  外面Download PDF的时候可以单独下载选择 TAB还是TAO的" genuinely admitted
  both "leave it alone" and "let me pick TAB or TAO here too," and only a
  live screenshot of the actual button settled which one he meant. Treat a
  natural-language confirmation of a UI behavior as settled only once the
  specific control has actually been exercised, not just described.

  Round 3, same day: `SoaDownloadPopover` moved out of `app/billing/soa/
  _components.tsx` into `components/billing/SoaDownloadPopover.tsx` —
  Vincent wanted the identical button reachable from Company 360's
  Outstanding table too ("复制这个 Download SOA PDF 的按钮，但是是All 的版
  本"), and a second independently-styled copy of the same popover is
  exactly the drift this codebase already has a name for (see
  `lib/company-name.ts`'s four-divergent-matchers header). The shared file
  exports the presentational popover itself (unchanged; `SoaDetail` still
  derives `books` from the `invoices` it already fetched for its own table,
  now just importing the component instead of defining it) plus a new
  self-contained `SoaAllDownloadButton({ companyName })` for callers with
  no invoices list already in hand — it fetches `/api/billing/soa/detail`
  itself. `OutstandingSection` (`app/companies/[id]/_components.tsx`, a
  SERVER component) renders one `SoaAllDownloadButton` per row — one row
  per book a company owes on, so a company owing on 2 books shows this
  button twice, confirmed expected ("好像这边有两个就要有2个一样的All 按
  钮") rather than something to deduplicate down to one.

## Automation & cron reliability (INV-CRON)

- **INV-CRON-001** — Vercel Hobby-tier functions have a hard,
  non-negotiable 300s `maxDuration` — enabling Fluid Compute does **not**
  override this; longer real-world budgets require splitting into
  more/smaller batched cron triggers, never raising `maxDuration` past 300
  on Hobby.
- **INV-CRON-002** — Vercel Hobby cron jitter is confined to the specified
  **hour** only (`0 8 * * *` can fire any time in 08:00:00–08:59:59) —
  multiple batches scheduled within the same hour have no real separation
  guarantee; use non-adjacent hours for a guaranteed gap. *(source:
  2026-08-29 TeamWork ND 4-batch redesign.)*
- **INV-CRON-003** — When splitting a roster-processing cron into N
  batches, partition **interleaved by position**, not contiguous id ranges
  — a handful of consistently-slow individuals can otherwise cluster into
  one batch. With a concurrent worker pool, a batch sized exactly to the
  worker count gives every item its own parallel worker; a larger batch
  risks slow items stacking sequentially on one worker. *(source: 2026-08-29,
  `app/api/teamwork/sync-nd/route.ts` — the 2-batch design failed real
  testing, redesigned to 4 batches ≈ concurrency.)*
- **INV-CRON-004** — Never call the same session-establishing function
  (e.g. Playwright login) from two independent helper functions within one
  route invocation — launches the browser/session twice, which for
  Chromium can exhaust `/tmp` disk space (Vercel Fluid Compute reuses
  containers between invocations) and crash the whole route. Obtain the
  session once at the top level and pass it into both helpers. Every
  browser-launching route must also run the shared stale-`/tmp`-profile
  cleanup helper (`lib/playwright-tmp-cleanup.ts`) — one route
  (`lib/teamwork-nd.ts`) silently lacked it until 2026-08-29. *(source:
  2026-08-29 TeamWork Companies fix, `app/api/teamwork/sync/route.ts`.)*
- **INV-CRON-005** — Playwright's `--user-data-dir` cannot be set
  per-launch as a workaround for shared-profile contention — it throws a
  hard error (`_createUserDataDirArgMisuseError`) in this Playwright
  version (confirmed against `node_modules/playwright-core/lib/coreBundle.js`).
- **INV-CRON-006** — A per-company/person TeamWork-fetch cron's real-world
  per-batch time must be measured against the **actual observed slowest**
  individual, not an average — production runs had already been landing at
  256–298s (near the 300s kill) even on "successful" runs.
- **INV-CRON-007** — `automation_exceptions` need a grace period on
  auto-resolution (`replaceAutomationExceptions`'s `graceMs` option) when
  the same logical source is now split across multiple cron runs hours
  apart — otherwise one batch's run wrongly auto-resolves another batch's
  still-genuinely-open exception.
- **INV-CRON-008** — Any lease/lock-based cron route (`withAutomationRun`)
  needs a self-imposed deadline (AbortController) well under the
  platform's hard cutoff, checked every loop iteration and propagated into
  any in-flight external fetch — a hard platform kill never reaches
  cleanup code, leaving the lease stuck until natural expiry and blocking
  the next run's clean success.
- **INV-CRON-009** — TeamWork throttles **per session**, not per
  individual request — raising client concurrency past a proven-safe level
  can make total time *worse* (verified: 4 workers was slower with real
  timeouts than 3). Verify empirically per route rather than assuming
  higher concurrency is always faster.
- **INV-CRON-010** — A cron route's own "expected schedule" doc-comment can
  silently drift from the real `vercel.json` entry — always verify the
  actual `vercel.json` when reasoning about automation timing.
- **INV-CRON-011** — Any route reachable via `Bearer $CRON_SECRET` must be
  explicitly added to `proxy.ts`'s `CRON_PATHS` allow-list — having its own
  `vercel.json` cron entry and doc comment is not sufficient; a missed
  entry gets silently 401'd by middleware every night forever with zero
  `automation_sync_runs` rows ever recorded.
- **INV-CRON-012** — Code that depends on a new DB column must never be
  deployed before the corresponding SQL migration is confirmed run in
  Supabase — deploying first 500s the **entire route** on its next cron
  firing, not just the new feature.
- **INV-CRON-013** — Any new or moved Playwright-launching cron entry must
  be checked for hour-collision against **every** other Playwright-
  launching entry project-wide (grep callers of `getSessionCookie`/
  `getBrowser`/`launchBrowser`), not just siblings within the same route
  family — a same-hour or genuinely-overlapping pair of DIFFERENT
  invocations can exhaust shared `/tmp` exactly like the same-invocation
  double-launch INV-CRON-004 already covers, but INV-CRON-004's fix
  (single login per invocation) and the stale-profile cleanup's age gate
  cannot prevent it, since neither mechanism can distinguish a still-live
  sibling invocation from garbage. Confirmed live, 2026-08-31: ND batch 4
  (`0 18`), `teamwork/sync` (`30 18`), and `teamwork/sync-secretary`'s
  first daily run (`45 18`) had all drifted into sharing hour 18 — two days
  after this exact ND-batch redesign shipped, only checked against its own
  4 batches, never against the other 2 routes already sitting in that
  hour. Real evidence also shows a cron's actual `started_at` can fall
  **outside its own documented jitter hour** (Companies fired at 19:08
  despite a `30 18` schedule) — so hour-separation reduces but does not
  fully eliminate this risk; pair it with INV-CRON-014's retry, not
  instead of spacing. *(source: 2026-08-31, `vercel.json`,
  `lib/playwright-tmp-cleanup.ts`.)*
- **INV-CRON-014** — A Playwright acquire-retry helper's timeout/elapsed-
  time math must be derived from the caller's own real `maxDuration` (300s
  on Vercel Hobby) and any self-imposed deadline it has, never from an
  assumption about cron schedule spacing — that assumption already failed
  once (INV-CRON-013). Retry the **whole** "acquire a working
  browser/session" unit (launch through context/page creation and login),
  not just the `launch()` call — the disk-exhaustion failure can plausibly
  surface at `newContext()`/`newPage()` too, since both allocate shared-
  memory-backed resources the same way. Each retry attempt must close its
  own partially-created browser before retrying (self-contained, leak-
  safe) rather than relying on an outer `finally` that only knows about a
  successfully-returned browser. Only one such retry wrapper should exist
  per invocation path — stacking an outer ad hoc retry on top of an inner
  one multiplies worst-case attempts (found live: `teamwork/sync` had its
  own one-off retry on top of what should have been the shared helper).
  *(source: 2026-08-31, `lib/playwright-tmp-cleanup.ts`'s
  `withPlaywrightRetry`.)*
- **INV-CRON-015** — `replaceAutomationExceptions()`'s resolve-cutoff must
  be computed from the SAME `observedAt` timestamp just written to the rows
  it upserts, never a fresh `Date.now()`/`new Date()` call taken after that
  upsert completes — the upsert's own network round-trip means a fresh
  timestamp is always at least a few ms later than `observedAt`, so with
  the default `graceMs=0` every exception just upserted as `'open'`
  immediately satisfied its own `lt(last_seen_at, resolveCutoff)` check and
  got marked `'resolved'` in the SAME call that created it — never visibly
  open on the Automation Health dashboard long enough for a human to see.
  Found 2026-09-17 while building `app/api/soa-owners/audit/route.ts`
  (a brand new caller, immediately hit the bug) — then confirmed this had
  silently affected EVERY pre-existing real caller in production history
  except one: `quickbooks/duplicate_doc_number_*` (8 real rows),
  `teamwork_companies/unknown_pic_id` (55 real rows),
  `teamwork_companies/missing_from_teamwork` (1), and
  `quickbooks/oauth_refresh_*` (3) were ALL resolved within under 2 seconds
  of being created, 100% of the time, for as long as this function has
  existed — a real operational-monitoring feature that never actually
  worked for 6 of 7 real exception types. The one exception,
  `teamwork_nd/missing_nominee_subrole`, only survived because it happens
  to pass a real non-zero `graceMs` (INV-CRON's own 2026-08-29 comment on
  that parameter) — accidentally avoiding the bug, not by design. Fixed by
  deriving `resolveCutoff` from `new Date(observedAt).getTime() - graceMs`
  instead of `Date.now() - graceMs` — a row upserted THIS call can never be
  strictly earlier than its own `observedAt`, so it can never resolve
  itself; only a row genuinely not re-observed this run (an older
  `last_seen_at` from a prior call) is older than the cutoff, which is what
  "replace" was always supposed to mean. **Lesson**: a shared helper's
  self-test ("does this call's own output survive being read back") is
  worth doing even for code that's been in production a while and looks
  correct on a read-through — this bug was invisible in every code review
  because `Date.now()` genuinely reads as "now" at a glance; only running
  it against real data and checking the row's actual persisted `status`
  caught it.
- **INV-CRON-016** — An external-site Playwright fetch (`lib/sg-news-
  fetch.ts`, built 2026-09-23 for the "SG Latest News" feature) must treat
  a single source's failure as a normal, expected, per-source outcome —
  never let one source's failure abort the whole run. Confirmed for real,
  not just designed defensively: a live local run against all 9 real
  sources (ACRA/IRAS/MOM/ICA/ISCA/CSIS/Straits Times/Business Times/
  Zaobao) hit two entirely different real failure modes in one batch —
  CSIS returned a hard `403 Forbidden` to headless Chrome (bot-protection,
  reproducible, not transient), and Straits Times simply needed longer
  than a 30s `domcontentloaded` timeout on a slow load (succeeded on retry
  at 45s, no code change needed otherwise). A third class — `ERR_NAME_
  NOT_RESOLVED` on 3 domains simultaneously in one local run, confirmed via
  direct `nslookup` to be this sandbox's own DNS resolver timing out, not
  a real site problem — is an environment limitation of local dev, not a
  production signal either way. All three classes land in the SAME
  designed degradation path: `fetchAndExtractSource()` returns `{error}`,
  the sync route (`app/api/sg-news/sync/route.ts`) records it in
  `sg_news_sync_state` and `sources_failed` and moves on to the next
  source. Do not chase CSIS's 403 with stealth/evasion techniques — it is
  documented as an expected, tolerated per-source failure in
  `lib/sg-news-sources.ts`, not a bug.
- **INV-CRON-017** — A new Playwright-launching route is NOT automatically
  safe on Vercel just because its `launchBrowser()` copies an existing,
  proven working pattern (per INV-CRON-004's "duplicate, don't share"
  convention) — `next.config.ts`'s `outputFileTracingIncludes` is keyed
  per ROUTE PATH, and Next.js's automatic file-tracing does not reliably
  find `playwright-core`'s own non-import asset files (`browsers.json`)
  for every route that dynamically `import()`s it, even when an existing
  route with the identical import line works fine. `/api/sg-news/sync`
  (built 2026-09-23) had the exact code shape of the already-working
  `teamwork_nd_*`/`teamwork_companies` jobs, shipped without a
  `outputFileTracingIncludes` entry, and its first 3 real production runs
  ALL failed with `Cannot find module '/var/task/node_modules/playwright-
  core/browsers.json'` — caught only because Vincent's "SQL好了" prompted
  a check of `sg_news_sync_state`'s real rows right after migration,
  not from any build-time signal (`npm run build` succeeds either way —
  this is a Lambda-runtime-only failure, invisible locally even against
  the Vercel code path, since local dev always takes the non-`VERCEL`
  branch of `launchBrowser()`). Fixed by adding the same two-glob include
  `/api/late-filing/sync` already needed for this identical error.
  **Any future route that dynamically imports `playwright-core` on
  Vercel must add its own `outputFileTracingIncludes` entry as part of
  that same change, checked by looking at the actual `sg_news_sync_state`/
  `automation_sync_runs` row after its first real deploy — do not assume
  a clean local build means the Vercel Lambda will find the browser.**

## QuickBooks / invoice (INV-QB)

- **INV-QB-001** — A period-validation result of `'incomplete'` (no
  readable period at all) must always hard-block invoice generation; a
  genuine period `'overlap'` should be a confirmable warning only — the
  server must independently re-validate and can still require confirmation
  even if client-side data was stale.
- **INV-QB-002** — When ranking candidate QB invoice-line history for "the
  latest real renewal period," sort by **primary-product-ness first**,
  period_end only as a tie-breaker — sorting by period_end first lets an
  unrelated one-off line (matched only because its item *name* contains
  "secretary") outrank the real renewal via its unrelated description
  date. Must be one shared function used everywhere this logic is needed,
  never two independently-maintained copies.
- **INV-QB-003** — `Deferred Revenue - Corp Sec` sums only into the
  Corporate Secretarial primary line; `Deferred Revenue - Reg Addr` sums
  only into Registered Address — never generic keyword-grouped.
- **INV-QB-004** — A one-off/newer standalone Secretary-product QB line
  must not be mistaken for the year's annual renewal — annual evidence
  requires a matching deferred line, a readable period, an Annual
  Return/ACRA fee, this system's own generated-invoice record, or two
  services recurring ~1 year after already-verified annual fees.
- **INV-QB-005** — QB Custom DocNumber creation must never send the
  literal `AUTO_GENERATE` — always resolve the real next validated number;
  a live duplicate check must re-run immediately before the actual QB
  create call, not just at reservation time.
- **INV-QB-006** — Deleting an invoice directly in QuickBooks does not
  clean up its `invoice_creation_reservations` row — the stale row blocks
  reuse of that DocNumber forever until manually verified (via QB's live
  API, per-invoice, never assumed) and marked `'failed'`.
- **INV-QB-007** — QB invoice-line PIC/Class assignment is restricted to
  Secretary and XBRL lines only — Address/AR/ND/Accounts/Tax/discounts
  must never inherit the company PIC/Class when co-billed. TAC/ND PIC is
  carried in the named service-item text, never a QB Class.
- **INV-QB-008** — The current (latest active) TeamWork-appointed Nominee
  Director is always authoritative for TAC's PIC/service-shorthand — QB
  history is used only for fee totals/periods and must never override
  which director is shown, even against an existing QB-derived period.
- **INV-QB-009** — Editing a system-generated, un-sent QB invoice must go
  only through the app's gated PATCH route, which must independently
  re-verify before writing: (1) a matching `generated_invoices` row
  exists, (2) no `email_drafts` row with `status='sent'` already
  references this exact `qb_invoice_id` (checked per-invoice, since
  TAB/TAC on the same company/cycle can have different sent-states), (3) a
  live QB read confirms `Balance === TotalAmt` and not voided. The write
  payload includes only Id+SyncToken+Line — never CustomerRef/TxnDate/DocNumber.
- **INV-QB-010** — Outlook drafts' merged amount text must be re-verified
  against QuickBooks' live invoice total right before opening — an amount
  corrected directly in QuickBooks after generation can otherwise leave
  stale text in the email body while the (always-live) attached PDF shows
  the corrected figure.
- **INV-QB-011** — A `?company=` (or state/param-derived) value that
  resolves which QuickBooks company (TAB/TAC/TAO) to act on must be
  validated against the full known set and rejected outright when it isn't
  one of them — never a binary `=== 'TAC' ? 'TAC' : 'TAB'`-style ternary,
  which silently folds *every other value, including a real but not-yet-
  supported company*, into TAB with no error. Found in `auth`/`callback`/
  `status`/`invoice-pdf` routes and the sync POST handler when adding TAO
  as a third company (2026-09-04) — before the fix, `?company=TAO` on any
  of these would have silently connected/shown/served **TAB's** data,
  the single most dangerous failure mode for a multi-company QB
  integration since it looks like success. The text-label sibling of this
  (invoice PDF filenames, `lib/invoice-filename.ts`) has the same failure
  shape and needs the same explicit-match treatment, not just the token/
  data-layer routes.
- **INV-QB-012** — Every place that writes `customer_name` into
  `quickbooks_invoices`/`quickbooks_invoice_items` from a live QuickBooks
  `CustomerRef` must go through `correctedCustomerName()`
  (`lib/quickbooks.ts`), never `customer.name` directly. Confirmed
  2026-09-05: QuickBooks itself holds duplicate customer records for at
  least 4 real Chinese companies — one correctly named, one with a
  mojibake DisplayName (GBK bytes misread as Latin-1 upstream of
  QuickBooks) — invisible in every existing page because they only ever
  display via `companies.company_name` (TeamWork-sourced, clean), never a
  raw QB customer name, until the new `/billing/tao` page surfaced one
  directly. A plain DB text-fix alone doesn't hold: both `qb_company,
  qb_invoice_id`-keyed sync paths (`app/api/quickbooks/sync/route.ts`'s
  full-year sync and `lib/quickbooks-invoice-incremental.ts`'s webhook
  path) upsert `customer_name` fresh from QuickBooks on every run, so an
  uncorrected write site silently reintroduces the garbled text the next
  time either one touches that invoice. Vincent's call after finding the
  duplicate-customer root cause: don't merge/rename anything inside
  QuickBooks itself (irreversible, needs manual review there) — correct
  only this app's own copy, keyed by the stable `qb_customer_id` (never
  by the free-text name, which for these rows IS the corrupted value).
  **Gap found 2026-09-17**: despite this rule naming both tables,
  `app/api/quickbooks/sync/route.ts`'s full-year sync only ever called
  `correctedCustomerName()` for its `invoiceRows` push — its `itemRows`
  push (the `quickbooks_invoice_items` row) wrote `customer.name` raw.
  `lib/quickbooks-invoice-incremental.ts`'s webhook path had it right on
  both rows the whole time, which is exactly why the garbled name kept
  reappearing specifically after a full-year sync, not after a webhook
  update — a subtlety worth checking for on ANY future "two write paths,
  same correction" rule (verify EVERY row-push site in EACH path
  individually, don't assume a path is fully fixed because one push site
  in it is). Confirmed live: 21 `quickbooks_invoice_items` rows across
  all 5 known corrected customer ids (TAC 362/363/366/394, TAO 1697) held
  the raw garbled name — backfilled via
  `scripts/backfill-invoice-item-name-corrections.js` (safe to re-run,
  idempotent, display-name only).
- **INV-QB-013** — When deriving "who is really responsible for this
  company's billing" FROM existing QuickBooks data (as opposed to INV-
  QB-007's rule for WRITING a new PIC/Class), a per-line `ClassRef` name
  is the authoritative signal, and an invoice's own `DepartmentRef`
  (Location) is only a fallback for a line with no resolvable Class —
  never the other way round. Confirmed against real live invoices
  (2026-09-07, relayed by Chelsea): Location is a per-*operator* tag (staff
  share QB logins and use Location to mark whose desk an invoice was
  entered from — e.g. Chelsea processes invoices for several secretaries'
  clients, so her name sits on the Location of many invoices that are not
  actually hers), while Class is the real per-*service* ownership tag. A
  real sample invoice showed `Location="Chelsea Ang"` with every line's
  `Class="Chin Kah Ye"` — using Location as the primary signal here would
  have attributed the client to the wrong person. `lib/soa-owner.ts`'s
  `computeSuggestedOwner()` is the one place this priority is implemented;
  any other feature that needs "the real owner" from QB data must reuse
  it, not re-derive its own Location-first shortcut. Both write paths
  into `quickbooks_invoices.location_name`/`quickbooks_invoice_items
  .class_name` — the full-year sync (`app/api/quickbooks/sync/route.ts`)
  AND the webhook-driven incremental sync (`lib/quickbooks-invoice-
  incremental.ts`) — must extract these fields identically; missing it
  on either one leaves SOA's Owner suggestion silently stale for
  whichever invoices only ever pass through that one path (a brand-new
  invoice is only ever seen by the incremental path until the next
  day's full sync catches up to it).
- **INV-QB-014** — `/api/quickbooks/invoice-pdf` can be asked for a PDF by
  either QuickBooks' own internal invoice `Id` (`?id=`) or by the
  human-readable DocNumber shown on screen (`?invoiceNo=`, e.g. AR
  Reminder/Billing Drafts' "TAB #02610938" chip) — every UI caller only
  ever has the DocNumber, never the internal Id. DocNumber resolution is a
  LIVE `qbQuery()` call, never a lookup against the synced
  `quickbooks_invoices` snapshot table — a manually-entered QuickBooks
  invoice (not created through this system) can lag the daily sync by up
  to a day, so a snapshot lookup would 404 on exactly the invoices most in
  need of this feature. *(source: 2026-09-11, Vincent: "这些Invoice 可以直接
  点开到实际的PDF吗".)*
- **INV-QB-015** — Any "what does this client owe" computation must net
  QuickBooks `CreditMemo` balances against `Invoice` balances, never read
  `Invoice.balance` alone. QuickBooks does NOT automatically reduce an
  invoice's own `Balance` when a CreditMemo is created against it but left
  "Unapplied" (applying is a separate manual step inside QuickBooks) — but
  QuickBooks' own official Aged Receivables report (`/v3/company/{realmId}/
  reports/AgedReceivables`) DOES net an unapplied CreditMemo's balance into
  that customer's total, bucketed by the CreditMemo's OWN `TxnDate` (not
  merged into whichever invoice it's "for"). Before `quickbooks_credit_memos`
  existed, this app only ever synced `Invoice` objects
  (`app/api/quickbooks/sync/route.ts`'s `SELECT * FROM Invoice`), so its own
  outstanding-balance numbers silently drifted from QuickBooks' own truth —
  confirmed 2026-09-15 via the report API against a real client-provided
  Excel export: this system was overstating total receivables by
  $185,722.57 (~42%) across TAB/TAC/TAO combined (real example: Ligang
  Limited/TAC showed $790 owed; QuickBooks' own report nets it to -$970 once
  its $1,760 unapplied CreditMemo, memo "CN TAC 02680170", is counted). The
  fix: sync CreditMemo into its own table (`scripts/add-quickbooks-credit-
  memos.sql`) and net it into `computeSoaRows()` (`lib/soa-data.ts`) — the
  one shared computation per INV-DATA-022 — so every consumer inherits the
  fix. Three independent bypass paths that query `quickbooks_invoices`
  directly instead of going through `computeSoaRows()` needed their own
  matching fix: `app/api/billing/soa/detail/route.ts` (the SOA drill-down
  modal), `app/api/billing/soa/pdf/route.ts` (the actual merged SOA PDF sent
  to a client — also fetches CreditMemo's own official QuickBooks PDF via
  the same `/creditmemo/{id}/pdf` endpoint QuickBooks exposes, symmetric to
  `/invoice/{id}/pdf`, rather than computing a number itself), and
  `lib/client-comms-resolve.ts`'s `loadAutoTargetNames`/
  `loadInvoicesByCompany` (SOA collection-email candidate list and line
  items — without this fix, a client with a net credit could receive a
  collection email for money they don't actually owe). As of 2026-09-15,
  CreditMemo sync only runs on the daily full-sync cron, not the webhook/
  incremental path (`lib/quickbooks-invoice-incremental.ts`,
  `app/api/quickbooks/webhook/route.ts` — the latter hard-filters to
  `'invoice'` entity type only and would silently drop a CreditMemo webhook
  event) — same "up to a day stale until the next cron" tolerance INV-QB-014
  already accepts for Invoice data; real-time CreditMemo sync is a deferred
  follow-up, not done. *(source: 2026-09-15, confirmed via QuickBooks'
  own Aged Receivables report API + a real Excel export Vincent provided.)*
  **CLOSED, 2026-09-16, by INV-QB-021** — not via per-entity CDC sync as
  originally imagined here, but by widening the SAME webhook pipeline to
  trigger a fresh AgedReceivableDetail report re-sync (comprehensive by
  construction, covering CreditMemo and the other AR-relevant types
  together) instead of adding a CreditMemo-specific incremental path.
- **INV-QB-016** — `TASSURE PAC` (both `"TASSURE PAC"` and `"Tassure PAC"`
  spellings appear in real QuickBooks data across TAB/TAC/TAO) is an
  internal inter-company settlement account, not a real client, and must
  be excluded from every outstanding-balance computation
  (`lib/soa-data.ts`'s `computeSoaRows()`, `INTERNAL_ACCOUNT_NORM_NAMES`)
  — never shown as a client owing money on the SOA Outstanding list, an SOA
  collection email, or the AI assistant's arrears/collections tools.
  Vincent, 2026-09-15, confirming after this account showed up as TAB's
  single largest post-CreditMemo-fix discrepancy ($27,413.06 overstated):
  "PAC是我们公司内部的交易主要为主，因为TAB/TAO/TAC都是不同的3家公司，有时候
  会提供PAC去支付一些公司费用" (PAC is primarily internal transactions —
  TAB/TAC/TAO are 3 different companies, and PAC sometimes pays company
  expenses on another's behalf). If a genuinely new internal/related-party
  account turns up the same way (a customer whose real balance is driven by
  inter-company settlement, not client billing), add its normalized name to
  the same set rather than inventing a parallel mechanism for one entry.
  A SEPARATE, larger, NOT-YET-FIXED issue found the same day via the same
  investigation: several customers carry real balances in USD or RMB
  (QuickBooks itself shows some as distinct currency-suffixed customer
  records, e.g. `"Cyber Quantum Pte Ltd (USD)"` as a separate `Customer`
  from the SGD `"Cyber Quantum Pte Ltd"`) while `quickbooks_invoices`/
  `quickbooks_credit_memos` store the raw transaction-currency `balance`
  with no currency code or SGD conversion captured anywhere — summing these
  alongside SGD balances is not meaningful arithmetic. Vincent confirmed:
  "这个就是我们财务说的货币问题，因为我们的记录基本是靠SGD的，但是有一些公司
  是给美金和人民币的" (a known finance-team issue — our records are
  basically SGD-based, but some companies pay in USD/RMB). Not fixed as of
  this entry — needs its own scoped design (capture `CurrencyRef`/
  `ExchangeRate` at sync time at minimum; decide whether to convert to SGD
  or keep multi-currency totals visually separate) before touching
  `computeSoaRows()` again for this reason.
  **CLOSED, same day, by the INV-QB-017 report-sync redesign below** — the
  `AgedReceivableDetail` report is itself always denominated in the home
  currency (its `Header.Currency` field reads `"SGD"` for TAB/TAC/TAO,
  confirmed live), so `quickbooks_ar_aging_detail.open_balance` is already
  SGD-converted for every row, not a raw foreign-currency figure. Vincent
  asked for this to be re-verified directly rather than re-asserted ("在QB
  内我们也是有记入 USD/SGD和人民币的，这些不能把全部的货币都当成新币
  (SGD)") — confirmed with exact arithmetic on 2 independent live
  transactions, not just the report's own claim: (1) `Cyber Quantum Pte
  Ltd (USD)`'s Journal Entry 17648 — raw `Line[].Amount` 16,040.26 USD ×
  its own `ExchangeRate` 1.3740588 = 22,040.26, matching the report's Open
  Balance and this app's stored figure exactly; (2) `FAITH CAPITAL GLOBAL
  FUND VCC`'s Invoice 23148 — raw `Balance` 507.55 USD × `ExchangeRate`
  1.2861 = 652.76, matching QuickBooks' own `HomeBalance` field AND this
  app's stored `open_balance` exactly. Confirmed live: only USD-denominated
  customers currently exist (TAB 5, TAC 2, TAO 0) — no RMB/CNY customer
  currently exists in any of the 3 books, despite Vincent's concern about
  RMB specifically; the conversion mechanism itself is currency-agnostic
  (driven by each transaction's own `CurrencyRef`/`ExchangeRate`, not a
  USD-specific code path), so this holds for RMB the moment one appears.
- **INV-QB-017** — An entity-by-entity QuickBooks sync (Invoice, then
  CreditMemo, INV-QB-015) can NEVER be assumed complete, no matter how many
  entity types it currently covers — only QuickBooks' own server-side
  reports are a reliably-complete source for an aggregate financial total,
  because Intuit's engine enumerates every entity type relevant to that
  total, including ones not yet seen in this business's data. Live
  verification (2026-09-15) against QuickBooks' own `AgedReceivableDetail`
  report (`GET /v3/company/{realmId}/reports/AgedReceivableDetail`) found
  that even after INV-QB-015/016, a real ~$90K gap remained — driven by
  `Payment`, `Journal Entry`, and (TAB only) `Deposit` transactions, none
  of which this app had ever synced, on top of INV-QB-016's still-open
  multi-currency gap (this report already SGD-converts, closing that half
  of INV-QB-016 for free). Concrete example: a single `Journal Entry`
  dated 2023-12-31, description "Opening journal"/"OPNG JE" — an
  opening-balance entry from when this QuickBooks file was first set up,
  entirely outside this app's 3-year rolling sync window — explained a
  $38,171.37 discrepancy on `Cyber Quantum Pte Ltd`/`Cyber Quantum Pte Ltd
  (USD)`, a customer with ZERO `Invoice`/`CreditMemo`/`Payment`/
  `RefundReceipt`/`SalesReceipt` records of any kind, at any date —
  confirmed directly against live QuickBooks, not assumed. Fix: sync the
  `AgedReceivableDetail` report itself (`quickbooks_ar_aging_detail`,
  `lib/quickbooks-ar-aging.ts`, `syncAgedReceivableDetail()` in
  `app/api/quickbooks/sync/route.ts`) as `computeSoaRows()`'s PRIMARY
  total/aging source (`lib/soa-data.ts`'s `loadArAgingSnapshot()`) —
  comprehensive by construction, so a future 6th entity type this
  business's data has never produced needs zero code changes here.
  `quickbooks_invoices`/`quickbooks_credit_memos` and their syncs
  (`syncYear()`, `syncCreditMemoYear()`) are KEPT, not deleted — narrowed
  to the two jobs the report structurally cannot do: the Class/Location
  owner-suggestion signal (INV-QB-013 — the report has no line-level
  detail) and fetching a specific Invoice/CreditMemo's own official PDF by
  QuickBooks internal Id (`app/api/billing/soa/pdf/route.ts`). The
  pre-report Invoice+CreditMemo computation is ALSO kept, verbatim, as
  `legacyComputeSoaRows()` — `computeSoaRows()` and the SOA detail modal/
  PDF route/`lib/client-comms-resolve.ts` all gate on the same
  `loadArAgingSnapshot()` freshness check (`quickbooks_ar_aging_sync_state`,
  success within 36h) and fall back to it together when the report sync is
  down for a company, so a bad sync run degrades to a real (slightly less
  complete) number, never a false `$0` for an entire book, and the total/
  detail/PDF/collections-email paths can never show DIFFERENT modes for
  the same company at the same time. *(source: 2026-09-15, Vincent: "你每
  次都很死板的只是看到眼前的东西，而不是全面的了解QB的内部，才导致的理解和创
  建失误...不要每次漏东漏西白白后面浪费时间去优化本来就有的东西" — direct
  feedback that reactive entity-by-entity investigation wastes time
  rediscovering gaps one at a time; this fix is the structural response,
  not another entity added to the same reactive pattern.)*
- **INV-QB-018** — A `customerNamePrefilter` passed to
  `lib/soa-data.ts`'s `loadArAgingSnapshot()`/`legacyComputeSoaRows()` MUST
  be reduced through `lib/company-name.ts`'s `significantWord()` before use
  — never passed as a raw, full company display name. Both functions use
  the prefilter as a literal SQL `ilike '%...%'` substring test against the
  real QuickBooks `customer_name` column; a resolved/fuzzy-matched display
  name (e.g. `companies.company_name` = "ACG Interior and Exhibition Pte.
  Ltd.") can differ from the actual `customer_name` QuickBooks stores (e.g.
  "ACG Interior & Exhibition Pte Ltd" — "&" vs "and", "Pte. Ltd." vs "Pte
  Ltd") in ways `normalize()`'s own fuzzy scoring shrugs off everywhere
  else in this app but a literal substring test cannot — matching zero
  rows even though the two names are unambiguously the same company. Both
  functions now reduce internally (idempotent, so a caller that already
  pre-reduced its own input via `significantWord()` — `lib/company-360.ts`,
  `lib/outstanding-lookup.ts` — is unaffected), closing this for every
  current and future caller at the one shared choke point rather than
  trusting each call site to remember. *(source: 2026-09-15, Vincent found
  this via ACG Interior & Exhibition Pte Ltd's SOA detail modal — the
  on-screen Outstanding row showed a real S$4,540.00 total (from
  `computeSoaRows()`, which is never given a raw prefilter) but the detail
  modal opened to a completely empty invoice list (`app/api/billing/soa/
  detail/route.ts` and `app/api/billing/soa/pdf/route.ts` both passed the
  raw `?companyName=` query param straight through) — "为什么有一些还是看
  不到单？" (why do some [companies] still show no invoices?).)*
- **INV-QB-019** — `lib/invoice-period.ts`'s `compareRenewalPeriodProductLines()`
  must only rank a "primary" renewal line above its "deferred" counterpart
  (INV-QB-013's Class-before-Location precedent is a different rule; this
  one governs which QB line's `period_end` is trusted as "how far this
  service is paid up to") when the two lines come from DIFFERENT invoices.
  Within the SAME `invoice_no`, a primary line and its paired deferred line
  can legitimately cover DIFFERENT, non-overlapping sub-periods of one
  renewal — confirmed live: Tassure's ND billing convention sometimes
  splits one 12-month renewal into a "Secretary:Nominee Director Fees -
  X" (primary) stub period plus a "Deferred - ND Fees - X" (deferred)
  continuation period in the SAME invoice (e.g. Aug-Dec of one year +
  Jan-Jul of the next), not two lines covering the identical period twice
  (which is the normal case this function was originally built to handle).
  Ranking primary-over-deferred unconditionally picks the EARLIER line's
  `period_end` as the invoice's true coverage end whenever the split
  happens to land that way, silently understating how far the client is
  actually paid up to. Fix: compare by `period_end` alone (latest wins)
  when `a.invoice_no === b.invoice_no`; only fall back to the primary-first
  rule across different invoices, where it still correctly protects against
  an unrelated ad-hoc line (e.g. a one-off CPF submission also tagged
  `service_type='Secretary'`) outranking the real renewal by a
  coincidentally later date. *(source: 2026-09-16, Vincent screenshotted
  Siehi Shipping Pte. Ltd.'s TAC Billing Drafts row: the real, PAID invoice
  #02580282 billed "Aug 2025-Dec 2025" ($1,250, primary) + "Jan 2026-Jul
  2026" ($1,750, deferred) — together one 12-month renewal through Jul
  2026 — but the next draft proposed "Jan 2026-Dec 2026", re-billing
  Jan-Jul 2026 already paid for in that same invoice. "这边的开单Period 好
  像有点判断失误呢". A full scan of `quickbooks_invoice_items` (paginated,
  not the default 1000-row cap) found this exact split-invoice pattern on
  25 real companies, all ND, all previously mis-sorted the same way —
  verified the fix corrects Siehi Shipping's own next period from "Jan
  2026-Dec 2026" to the true "Aug 2026-Jul 2027".)*
- **INV-QB-020** — `lib/soa-export.ts`'s `renderAgingTable()` (the Excel
  exports behind `GET /api/billing/soa/export` and `.../export-all`) must
  never gate an aging-bucket cell's value — or that column's TOTAL-row
  SUM — on the bucket's net being positive. The on-screen SOA list had
  this exact bug (INV-QB-017's own fix history) before it was redesigned
  to show every line item individually; the Excel export inherited the
  same `> 0` gate independently and was never updated when the on-screen
  list was fixed. This was not just a display gap: the TOTAL row's
  per-bucket sum used the SAME `> 0` filter on each company's contribution
  before summing, so a bucket column's own grand total silently EXCLUDED
  every company whose net in that bucket was zero or negative — a real
  wrong printed number, not merely an incomplete one. Fix: a bucket cell
  shows the real net (`aging[bucket]`, never re-derived from line items —
  one source of truth) whenever the bucket has ANY real line item behind
  it (checked via `lineItems`, not the net's sign), and the itemized
  breakdown (type/reference/signed amount, one per line) goes into that
  cell's Excel comment/note — a spreadsheet cell can't stack lines the way
  the on-screen table now does, so the note is the closest equivalent,
  verified to round-trip through a real save-and-reopen cycle. *(source:
  2026-09-16, Vincent, after seeing the on-screen ACCADIA MANAGEMENT
  SERVICES 91+ bucket example (7 real line items netting to exactly
  $0.00): "这样Export Full Workbook 那边也是要更新一下内容显示了".)*
- **INV-QB-021** — The Outstanding/SOA total's freshness has two layers,
  and they must never be confused: the daily cron (`vercel.json`'s
  `30 19 * * *`) is the unconditional baseline that always runs; on top of
  it, `lib/quickbooks-webhook-queue.ts`'s `processQuickBooksWebhookQueue()`
  ALSO triggers a fresh `syncAgedReceivableDetail()` (the exact same
  function the cron calls — moved to `lib/quickbooks-ar-aging.ts` and
  exported 2026-09-16 specifically so both callers share one
  implementation, never a second copy) for a company whenever that
  company's realm has a pending webhook event whose `entity_name` is one
  of the 5 types INV-QB-017 confirmed actually affect AR: `Invoice`,
  `Payment`, `CreditMemo`, `JournalEntry`, `Deposit`. This is deliberately
  NOT a return to per-entity-type sync logic (INV-QB-017's own rejected
  pattern) — the webhook only decides WHETHER to trigger a re-sync; the
  re-sync itself still asks QuickBooks' own report for the complete truth,
  so a future 6th AR-relevant entity type still needs zero new sync logic,
  only an addition to this file's `TRACKED_AR_ENTITIES` set AND the
  webhook route's own `TRACKED_ENTITIES` allowlist (see below) — missing
  either one silently caps this at today's 5 types again.
  Two vocabularies for the same QuickBooks objects must never be
  conflated: `app/api/quickbooks/webhook/route.ts`'s `TRACKED_ENTITIES`
  keys are QuickBooks' own webhook/API *resource* names (`CreditMemo`,
  `JournalEntry` — no spaces, confirmed against this codebase's own
  `SELECT * FROM CreditMemo` in `syncCreditMemoYear`), while
  `lib/quickbooks-ar-aging.ts`'s synced `txn_type` column holds the
  AgedReceivableDetail report's own *display* wording (`"Credit Note"`,
  `"Journal Entry"` — with spaces, matching `lib/soa.ts`'s `TXN_TYPE_TAGS`
  map). "Fixing" the webhook allowlist to match the report's wording (or
  vice versa) breaks matching silently, not loudly.
  A webhook-triggered re-sync is debounced per company (minimum 60s since
  `quickbooks_ar_aging_sync_state.last_synced_at` for that company) —
  checked in `lib/quickbooks-webhook-queue.ts`, NOT inside
  `syncAgedReceivableDetail()` itself, so the daily cron and the manual-
  trigger route (`POST /api/quickbooks/sync`) stay fully unconditional.
  Verified no additional locking is needed: `AutomationRun.begin()`
  (`lib/automation-sync.ts`) locks by `source` alone (the fixed string
  `'quickbooks'`), not per-company, so two webhook deliveries — even for
  different companies — can never run `processQuickBooksWebhookQueue()`
  concurrently; the second fails to acquire the lock and the webhook
  route's own `after()` retry loop (5 attempts, 2s apart) waits it out.
  Before this app's own webhook route filter is even reached, whether
  QuickBooks actually SENDS these 4 additional entity types for this
  Intuit app registration is an out-of-band fact (configured at
  app.developer.intuit.com, not in this repo) that this code change
  cannot itself verify — if `quickbooks_webhook_events` never shows rows
  with `entity_name` other than `Invoice` despite real Payment/CreditMemo/
  JournalEntry/Deposit activity in QuickBooks, that dashboard subscription
  (not this code) is the next place to check. *(source: 2026-09-16,
  Vincent: "这部分是有需求的所有需要实时的收到QB的更新，不能一天更新一次" —
  triggered by a real Taiyau Trading Pte. Ltd. case where a same-day
  payment across TAB/TAC/TAO wasn't reflected until the next sync; this
  closes the "real-time CreditMemo sync is a deferred follow-up, not
  done" gap INV-QB-015 left open, extended to the other 4 AR-relevant
  entity types confirmed by INV-QB-017.)*
- **INV-QB-022** — QuickBooks' AgedReceivableDetail REPORT API (the source
  of `quickbooks_ar_aging_detail`, INV-QB-017) silently reformats a purely-
  numeric Invoice `DocNumber`, stripping its leading zero — the same real
  invoice is "02610894" in the Invoice entity itself
  (`quickbooks_invoices.invoice_no`, synced separately via the Invoice
  entity API, never the Report API) but "2610894" in the report-sourced
  `doc_number` column. This is NOT a one-off cosmetic quirk: checked
  against ALL real unpaid invoices across all 3 books, 433 of 541 (72-92%
  per book) have a leading zero and were affected. `loadArAgingSnapshot()`
  (`lib/soa-data.ts`) is `computeSoaRows()`'s fresh-path source for EVERY
  consumer of `SoaCompanyRow.lineItems[].docNumber` — Company 360's
  Outstanding section (`app/companies/[id]/_components.tsx` renders
  `item.docNumber` directly to staff), the Excel export
  (`lib/soa-export.ts`), the on-screen SOA list, and the Statement PDF
  (INV-DOC-017) — so every one of them was showing the wrong invoice
  number for the large majority of real invoices, not just the one example
  that surfaced it. Found live 2026-09-17 while building the Statement
  PDF's own itemized description (Vincent: "这部分为什么生成出来的没有像这
  个那么完整"); confirmed systemic, not a one-off, only after deliberately
  checking the FULL real dataset rather than trusting the one fixed
  example (Vincent, same day, pushing back on a premature "done": "你不要
  忘记看远一点"). Fixed at the one shared chokepoint,
  `loadArAgingSnapshot()` itself: for every Invoice-type row, cross-
  references `quickbooks_invoices.invoice_no` by `qb_invoice_id` (a table
  synced via the Invoice entity API, never touched by the Report API's own
  reformatting) and uses that authoritative value whenever the report's own
  value differs — one extra bounded query per snapshot load, best-effort
  (a failed lookup just leaves the report's own value, same as before this
  fix). Credit Note doc numbers (e.g. "CN240023", "JV24-138") are never
  purely numeric, so the Report API never reformats them — this fix only
  ever needed to touch Invoice rows. Verified against the FULL real
  dataset post-fix: 0 remaining mismatches across all 541 checked
  invoices, all 3 books. General lesson: a QuickBooks REPORT API response
  is not guaranteed to preserve a field's exact printed form the way the
  matching ENTITY API does, even for what looks like a plain passthrough
  string field — cross-check a report-sourced identifier against its own
  entity's API before trusting it for anything shown to a client or used
  as a real document reference.

## Data integrity, concurrency & manual-override (INV-DATA)

- **INV-DATA-001** — Optimistic-concurrency CAS on a boolean field must
  treat `NULL` and `false` as equivalent "unchecked" states
  (`.or(field.is.null, field.eq.false)`) — `WHERE field = false` never
  matches a genuinely-NULL untouched row, so a checkbox's very first click
  looks like a conflicting edit and snaps back.
- **INV-DATA-002** — `manual_fields`/`_manual` protection: a field is
  "manual" the moment a human saves a non-empty value into it; clearing it
  back to empty hands control back to automation. Every automation writer
  must gate on `!manual_fields?.field` before overwriting. This must be
  **per-field**, not per-row — a row-level "AUTO:" prefix gate lets editing
  one field in a whole-form modal leave the row still nominally "AUTO,"
  letting the next sync silently revert an unrelated field just fixed on
  the same row.
- **INV-DATA-003** — For fields whose automation source is a cheap
  always-current single-row lookup (Active Client CODE/Email/FYE), "is this
  manual" should be a **live comparison** against the current computed
  automation value, not a blanket "any non-empty = manual" rule —
  otherwise a value that already matches automation gets permanently
  locked out of future auto-refresh.
- **INV-DATA-004** — A JSONB read-modify-write (SELECT → merge one key in
  JS → UPDATE whole object) on a shared column is a real race — two users
  editing two different keys concurrently can have the second write
  silently revert the first. Must use a single atomic
  `UPDATE...SET col = col || jsonb_build_object(...)` DB function for any
  JSONB field with concurrent per-key edits.
- **INV-DATA-005** — Supabase Realtime `postgres_changes` UPDATE payloads
  always carry the full new row — code detecting "did this field change"
  via `hasOwnProperty` on the new payload alone is always true and useless;
  must compare old vs. new, which requires `REPLICA IDENTITY FULL` on the
  table. A client should skip re-applying its own realtime echo
  (`updated_by_email === me.email`) — its own edit is already reflected
  optimistically.
- **INV-DATA-006** — `master_list`/any >1000-row table must always be
  queried with explicit `range()` pagination in server routes needing "all
  rows" — PostgREST's default 1000-row cap has silently truncated queries
  more than once in this codebase.
- **INV-DATA-007** — A newly-added column with page-specific rendering
  must never be added to the shared default `COLUMNS` array used by pages
  that don't pass an explicit `fields` prop — it silently "leaks" onto
  every page using the default; page-specific derived columns belong in a
  separate array a page must explicitly opt into.
- **INV-DATA-008** — CSS `!important` on a shared/global selector silently
  beats a component's own inline `style` override anywhere that class is
  applied (recurred repeatedly: row tint, header background, header
  font-size) — overriding a shared class's default requires a dedicated
  CSS class of equal/higher specificity, never an inline style alone.
- **INV-DATA-009** — `border-collapse: collapse` combined with sticky
  columns/headers is a severe perf pathology — any DOM change inside such
  a table (e.g. a cell swapping to an editable input) forces the entire
  table to re-layout, freezing the page on click; must use
  `border-collapse: separate; border-spacing: 0` with explicit per-cell
  borders instead. A `<tr>`-level CSS border never renders on a real
  `<table>` under `border-collapse: separate` — row dividers on
  table-based (not div-based) list pages must be set at the `<td>` level.
- **INV-DATA-010** — Any inline-edit text input must check
  `event.nativeEvent.isComposing` before treating Enter as commit — an
  unguarded handler intercepts the Enter an IME sends to confirm a
  mid-composition Chinese candidate, making it impossible to type Chinese
  names into that field.
- **INV-DATA-011** — Any date column with genuinely ambiguous real-world
  formats (DD/MM/YYYY, DD.MM.YYYY, "14 Nov 2019", year-first
  "2022.10.27", non-dates) must go through the one shared,
  dataset-calibrated parser for both sorting and display — a plain SQL
  `.order()` sorts such a column lexicographically, not chronologically.
- **INV-DATA-012** — The ND page's "active appointment" count must also
  require the company itself being `is_active && client_type==='CSS
  Client'` — deriving "active" purely from `nd_appointments`' own
  `cessation_date` misses companies TeamWork left un-ceased even though
  the company itself is now Struck Off.
- **INV-DATA-013** — Optimistic-concurrency CAS on a text field must not
  collapse `''` to `null` (the common `value || null` convention used
  everywhere ELSE in this codebase) when the underlying column is `NOT
  NULL` and can genuinely hold `''` (e.g. `trademark_records.company_name`
  on a deliberately blank Add-Record row) — the server's `.is(field, null)`
  filter never matches a real empty string, so every edit of a blank-but-
  not-null row 409s as a false "someone else changed this" conflict, on
  the very first save, every time, with no race actually involved. The
  text sibling of INV-DATA-001's boolean null/false case. Any NOT NULL
  text column needs its own coercion branch that keeps `''` as `''` (never
  `null`) through cellText → saveEdit's request body → the PATCH route's
  `coerce()` and CAS filter — same rule applies to the write side too
  (writing `null` into a NOT NULL column 500s).
- **INV-DATA-014** — `ar_reminder.remarks` (the AR Reminder tab's own
  compliance-workflow Remarks column, TERMINATED/STRIKE OFF/AR COMPLETED)
  and `ar_reminder.billing_remarks` (Billing Drafts' own separate free-typed
  note, split off 2026-08-17 specifically so the two could never collide)
  are DIFFERENT columns with similar names and an almost-identical purpose —
  any feature reading "the Remarks field" on a `CompanyBilling`/`ARCompany`-
  shaped object must double check which one it actually wants against the
  live data, not just the field name. The `MANUALLY INVOICED` marker feature
  was built to read `billingRemarks` (`billing_remarks`) but the marker
  itself was designed to live in `remarks` — a wrong-field bug that shipped
  silently: `notInvoicedYet()`'s marker fallback and the invoice-number
  display both always read the empty field, so the feature could never have
  worked for any company, not just the one Vincent happened to test with
  (whose row hid the bug further, since it already had a real invoice
  satisfying the check through the OTHER path). Caught only because Vincent
  tested the exact display it was supposed to affect and it didn't show —
  verify a "reads a remarks-like field" feature against a real row that
  actually has the target field populated, not just that the code compiles.
- **INV-DATA-015** — A "who's responsible for this company" value sourced
  from Vincent's real collections tracking must never be assumed to be one
  global value per customer, even when the customer name is a clean,
  reliable key. Confirmed 2026-09-07 (SOA's `soa_owners`, originally
  designed as one global row per customer name): his real Google Sheet has
  3 SEPARATE tabs — one per QuickBooks company (TAB/TAC/TAO) — each with
  its own PIC column, and 13 of 81 real companies that owe on 2+ systems
  have a genuinely different confirmed person on each tab (e.g. "Meishan
  Silk Road Trading": TAB tab says one person, TAO tab says another). The
  original backfill only ever read the sheet's DEFAULT/first tab (TAB) and
  applied that answer uniformly across all 3 pages — silently wrong
  whenever the real per-system answer actually differs. Fixed by adding
  `qb_company` to `soa_owners`' key (`scripts/add-soa-owners-per-company
  .sql`) — any future "one confirmed value per customer" field sourced from
  a Vincent-maintained spreadsheet must be checked for this same shape
  (multiple tabs/sections keyed by system or category) before assuming a
  single customer-name key is enough.

- **INV-DATA-016** — `user_activity_events` (added 2026-09-08, real
  page-visit/key-action behavioral tracking — `lib/activity-data.ts`)
  starts EMPTY at the moment it's deployed and can never be backfilled —
  unlike every other table in this app, there is no prior system (no
  Google Sheet, no TeamWork field, no QuickBooks history) that ever
  recorded "who visited what page when" before this shipped. Any consumer
  of this table (the Activity Insights page, the assistant's
  `my_activity_pattern` tool, any future one) MUST treat a 0-row result as
  "not enough history yet," never as evidence the tracking is broken or
  that the person genuinely does nothing — and must never invent a
  plausible-sounding usage pattern to fill the gap. `pageAll()`'s own
  `{data} = await ...` destructuring (ignores `.error`) means a query
  against a table that doesn't exist yet ALSO silently resolves to an
  empty array rather than throwing — confirmed directly before the SQL
  migration was even run, so the honest "no data" UI path was exercised
  and verified before real data ever existed to distinguish the two cases.

- **INV-DATA-017** — `user_memories` has two deliberate write paths. The
  immediate path is the assistant's `remember_this` tool and may fire ONLY
  when the user explicitly asks to remember/note something. The inferred
  path (added 2026-09-21 at Vincent's explicit request) must go through
  `ai_learning_candidates`: `lib/ai-learning/conversations.ts` extracts a
  durable preference/workflow/correction/decision from saved My Tasks
  messages, records evidence and confidence, and leaves it pending unless
  it passes INV-DATA-019's high auto-approval bar. No code may write a
  single conversational inference directly into `user_memories`. Never
  learn API keys/secrets, sensitive personal data, emotions/personality,
  one-off tasks, client facts, invoice/status facts, or assistant-only
  claims. This preserves the original blueprint's two warnings ("AI 不应
  因为一次对话就永久定义用户"; "用户的一次情绪性表达不应被直接写成永久性
  格或偏好") while allowing systematic conversation learning. Inferred
  writes use `source='inferred'`; explicit requests remain
  `source='explicit'`.

- **INV-DATA-018** — `canViewAsOthers` (added 2026-09-02 for the My Tasks
  Tasks-tab picker) grants FULL identity substitution for the assistant
  chat too (`ai_conversations`/`ai_messages`), not read-only access —
  extended 2026-09-08 after Vincent explicitly overrode an initial
  read-only design mid-build: "不只是还原，而且我作为最大的ADMIN 甚至是要
  可以带入到那个员工的身份，去开一个NEW CHAT 在她的记录...通过View as". A
  privileged caller passing `viewAs=<target email>` (`lib/approved-
  accounts.ts`'s `resolveViewAsAccount()`) doesn't just preview the
  target's conversations — a new chat they start is CREATED under the
  target's own email and becomes part of the target's real history, and
  they can pin/rename/delete the target's existing threads too (the
  ownership check in `app/api/ai/conversations/[id]/route.ts` and
  `[id]/messages/route.ts` is "literal owner OR canViewAsOthers", not
  scoped to a specific currently-selected target). Do not "fix" this to
  read-only later without re-confirming with Vincent first — it was a
  deliberate correction to what an earlier draft of this exact feature did.
  Separately, `findMentionedAccount()` (same file) lets ANY account ask
  about a named OTHER person conversationally (e.g. "如果我是HC...") while
  staying logged in as themselves — gated the same way (refused for a
  non-privileged caller) but never substitutes identity or writes into the
  named person's own conversation; the two mechanisms are complementary,
  not the same code path, and both must be checked when touching this area.

- **INV-DATA-020** — Every mutating API route must call
  `getRequestAccount()` AND actually check its result for `null` (401 if
  so) — calling it alone is not a gate. Found real 2026-09-09: `POST
  /api/master-list/move` had no auth check at all (only a client-side
  `window.confirm()`, trivially bypassed by hitting the URL directly);
  `POST`/`PATCH /api/late-filing` called `getRequestAccount()` but never
  checked for `null`, silently proceeding with `updated_by_email: null`;
  `DELETE /api/late-filing` didn't call it at all. All four fixed to
  match every sibling mutating route (AR Reminder, Trademark,
  QuickBooks). When adding or reviewing a new mutating route, grep for
  `getRequestAccount` in it and confirm the very next real line is a
  null-check with a `401` response — its mere presence proves nothing.

- **INV-DATA-019** — `ai_learning_candidates` auto-approval (added
  2026-09-08 for activity; extended 2026-09-21 to saved My Tasks
  conversations) is the ONLY permitted automatic route into inferred
  `user_memories`, and is not a precedent for lowering the bar without
  going back to Vincent.
  He explicitly asked for auto-approval with zero human review ("我希望AI
  可以自主学习...不一定要我审核对话"); the actual design landed on a
  narrower middle ground after being shown the direct conflict with his
  own blueprint's "AI 不应因为一次对话就永久定义用户" and the fact this
  same feature's human-approval gate had JUST been deliberately tightened
  in a prior commit ("restrict AI learning review to Vincent"). The bar —
  `confidence >= 0.9 AND distinct_days >= 5`, both required — is the
  actual agreed compromise, not an arbitrary starting guess. Never lower
  either threshold, remove the human-review path for anything short of
  it, or auto-approve a candidate a human already rejected/dismissed
  (the upsert in `analyzeUserActivity()` already guards the latter by
  preserving any final status) without an explicit new ask from Vincent.
  Conversation evidence follows the same rule; additionally, one-message
  candidates are capped below approval, same-day repetition cannot count
  as multiple days, and only real user-message IDs may be evidence.
  The auto-approve actor is always `system:ai-learning-auto` — never a
  real person's email — so `ai_learning_feedback`/`user_memories` audit
  trails stay honest about which approvals were automatic.

- **INV-DATA-021** — An agentic-chat tool that assembles a real legal
  document's identity data (a person's ID number, address, date of birth,
  share details — `preview_post_incorporate` in `app/api/assistant/
  route.ts`, added 2026-09-09 for the Post Incorporate document set) must
  NEVER let Claude invent, infer, or auto-fill any such value — every one
  must come from the user exactly as stated, or be left blank and asked
  for. This is stated explicitly in `staticSystemPrompt()`'s own guidance
  for the tool and is the one constraint Vincent did NOT want relaxed when
  he rejected downgrading this feature to a read-only status query ("我比
  较极端 我希望是可以真正协助执行操作的...你要思考用户真正要的是什么" —
  he wanted genuine guided task-completion, not passive Q&A, but never
  asked to relax the no-guessing rule on identity data itself). The
  resolution that satisfies both: the tool conducts a real multi-turn
  guided intake (collect a few real fields at a time, track progress
  across the conversation) but still only VALIDATES what the user actually
  gave it, via the same real `validatePostIncorporateInput()` the live
  `/post-incorporate` page itself uses — never Claude's own judgment of
  whether the picture is "close enough." Any future agentic tool touching
  another real legal/compliance document (NRIC, addresses, dates of birth,
  UENs, share/ownership data) must follow the same rule — a wrong guessed
  value on an actual legal document is a categorically worse failure than
  a wrong guessed value in a chat reply.

- **INV-DATA-022** — Annual Return/AGM FILING status (`ar_reminder.status`,
  surfaced in the assistant's `search_company` tool as `ar_reminders`) and
  QuickBooks OUTSTANDING BALANCE / arrears (real unpaid invoices, computed
  by `computeSoaRows()` in `lib/soa-data.ts`, surfaced via
  `check_outstanding_balance` in `app/api/assistant/route.ts`) are two
  completely unrelated concepts — one tracks whether a company's annual
  return has been lodged, the other tracks whether it has paid its
  invoices. A real 2026-09-09 incident: asked whether "1V Capital" owed
  money, the chat assistant answered "这家公司也没有欠款标记" (no arrears
  marker) after reading only `ar_reminders` (which said "Pending" — a
  filing-status word that has nothing to do with payment) — while the
  company's real Company 360 page showed 2 real unpaid invoices totalling
  S$3,650. Vincent: "这个回复就不对了" / "明明有outstanding". Never answer
  an outstanding-balance/arrears question from `ar_reminders`, general
  company data, or unrelated conversation context — only
  `check_outstanding_balance`'s own real result is a valid basis for that
  claim (enforced in `staticSystemPrompt()`'s own explicit rule). Any
  future feature (chat tool, report, dashboard card) that shows a filing-
  status field and a payment-status field side by side must keep them
  visually and semantically distinct — never let one imply the other.

  A SECOND, worse incident the same day, right after `check_outstanding_
  balance` shipped: a short elliptical follow-up ("那么 1v capital呢",
  right after a genuinely correct $0 answer for a DIFFERENT company) got a
  confident "✅ 确认：...没有欠款" reply with fabricated precise numbers
  ($0, 0 unpaid invoices) for a company that actually owed S$3,650 — the
  tool was never actually called for it; the model pattern-completed the
  previous company's answer template instead. Prompt instructions alone
  are NOT sufficient to guarantee a tool gets called every time, especially
  on a terse follow-up that doesn't restate the topic in words a keyword
  check could see. The real fix is a deterministic, code-level guard in
  `claudeAnswer()` (`app/api/assistant/route.ts`): `mentionsOutstanding
  Balance()` scans the REPLY text itself (not the user's question — the
  real elliptical follow-up contained no arrears-related word at all) for
  arrears/outstanding-balance language; if found and
  `check_outstanding_balance` was not actually invoked that turn, a visible
  `⚠️ 系统提示` warning is prepended before the reply ever reaches the
  user. Any future high-stakes factual claim (money, legal/compliance
  status) that an LLM could plausibly answer via pattern-completion instead
  of a real tool call should get the same treatment: a deterministic,
  code-level check on the OUTPUT for the claim's own telltale language, not
  just an instruction trusting the model to always call the right tool.

- **INV-DATA-023** — The same hallucination family as INV-DATA-022, applied
  to permission checks: Vincent (real `canViewAsOthers: true`, confirmed in
  `lib/approved-accounts.ts`) asked "Chelsea 今天要做什么" then "Chelsea
  Ang" right after successfully using the exact same cross-person feature
  for "CKY" moments earlier in the SAME conversation — both got a
  fabricated "我没有权限查看其他员工的任务" refusal. `my_tasks_summary()`'s
  own real code (`app/api/assistant/route.ts`) only ever returns
  `permission_denied` when `!account.canViewAsOthers` — impossible for
  Vincent's account, so this was never a real tool result. Vincent: "你是
  不是傻了 我是Vincent 最大的Admin" / "它会有时候分不清楚权限". Fixed the
  same way as INV-DATA-022: `claimsPermissionDenied()` scans the REPLY for
  permission-denial language; if the CALLER's own account genuinely has
  `canViewAsOthers` (ground truth known server-side — this is the one case
  where the guard can be MORE than a hedge, since the claim is definitely
  false, not just unverified) and no cross-person tool call happened that
  turn, a corrective warning is prepended. Any future permission-gated
  chat tool should carry the same guard — check the reply for a refusal
  claim against what the caller's account is actually allowed, not just
  trust the model relayed the tool's real answer.
- **INV-DATA-024** — `getPersonActivitySummary`/`getCompanyActivitySummary`
  (`lib/activity-data.ts`) computing "since" as `Date.now() - rangeDays *
  86_400_000` means `rangeDays=1` is a ROLLING 24-hour window ending right
  now, NOT the Singapore-time calendar day "today" — genuinely different
  ranges except right at midnight. Confirmed real: Vincent asked "今天活跃
  的人员" (today's active people); the honest reply, computed from
  `rangeDays===1`, described its own output as "过去24小时" (past 24 hours)
  — technically accurate for what was computed, not what "today" means.
  `days<=1` is only ever used by a caller meaning "today" colloquially (no
  caller passes 1 to mean a deliberate rolling window) — fixed by switching
  ONLY that case to the real SGT calendar-day boundary (`sinceFor()`);
  `days>1` keeps rolling-window behavior, which has no single unambiguous
  calendar boundary to snap to anyway. Any future "since N days" helper
  where 1 day can mean "today" needs the same split.
- **INV-DATA-025** — A raw DB timestamp (`created_at`/`updated_at`, always
  UTC) handed to an LLM to relay in a reply must be pre-formatted into
  Singapore time server-side, never left for the model to convert itself —
  confirmed real: a reply once echoed "2026-09-09 02:04:08 UTC" verbatim,
  which the user (correctly) didn't recognize as the "10点" (10am) they
  remembered, since nothing had done the +8 conversion. `lib/date.ts`'s
  `formatSgtDateTime()` (same convention `app/page.tsx`'s own local
  `formatSgtTime()` already used) is the one shared formatter — any chat
  tool result carrying a timestamp for direct display (not further date
  math) must run it through this before returning, as
  `recentActivitySummary()`/`myActivityPattern()` now do.
- **INV-DATA-026** — SOA (Statement of Account — a PDF of a company's
  unpaid invoices, downloaded from `/billing/soa/{tab,tac,tao}` with a real
  "Draft Email" button to send it to the client) is a genuinely different
  feature from Billing Drafts (new invoice generation) — confirmed real
  confusion in the chat assistant, 2026-09-09: asked "我要开SOA", it
  offered to preview a NEW billing draft instead. An SOA only exists where
  a company has a real outstanding balance — `check_outstanding_balance`'s
  `byQbCompany` lines now each carry a real `soa_link`
  (`soaDeepLink()`, `lib/deep-links.ts`) straight to that company's own SOA
  book, pre-opened via the same `openCompany` query-param convention
  `billingDeepLink`/`lateFilingDeepLink` already use. Any future chat
  capability touching SOA must go through `check_outstanding_balance`
  first to find which real QuickBooks company(ies) the balance is under —
  never assume, and never redirect to Billing Drafts for an SOA request.
- **INV-DATA-027** — `companies.ssic_description_1` has inconsistent casing
  in real data — confirmed on production: "WHOLESALE TRADE OF A VARIETY OF
  GOODS WITHOUT A DOMINANT PRODUCT" (140 companies) and "Wholesale trade of
  a variety of goods without a dominant product" (12 companies) are the
  SAME industry, split into two entries by any grouping that keys on the
  raw string. `lib/customer-profile-lookup.ts` groups on
  `.trim().toUpperCase()` instead. `app/reports/page.tsx`'s own "Explore"
  section pivot (its `ssic` `DIMENSIONS` entry) got the same fix the same
  day, once Vincent asked for the whole list of found gaps to be closed
  ("全部都要做"). `app/api/reports/export/route.ts` was checked and
  deliberately left unnormalized — it's a flat per-company row export with
  no grouping/aggregation at all, so the casing inconsistency doesn't
  silently split any count there; showing the true raw value is arguably
  more useful for someone who wants to go clean up the source data. Any
  FUTURE code that groups/counts by `ssic_description_1` needs the same
  `.trim().toUpperCase()` normalization; a per-row read of the raw value
  does not.
- **INV-DATA-028** — A chat tool that surfaces a company's real
  director/secretary/shareholder roster (`lib/company-deep-lookup.ts`,
  reusing `getCompany360()`) must NEVER hand an LLM their NRIC/passport
  number, date of birth, home address, or personal mobile/telephone —
  `teamwork_company_officials`/`teamwork_shareholder_shares` carry all of
  that (real, synced data, already used elsewhere for real purposes like
  Post Incorporate auto-fill), but a casual "who's on the board" chat
  question only needs names and roles. `lookupCompanyDeep()` curates this
  down to `{ name, role }`/`{ name, numberOfShares, shareType }` only —
  any future chat tool touching this same personal-data source must apply
  the same minimization, not just pass the raw row through because the
  data happens to already be in Supabase.
- **INV-DATA-029** — A pure, dependency-free business-logic function used
  by BOTH a client page and a server-side chat tool (no I/O of its own —
  e.g. `categorizeLateFilingRow()`, moved from `app/late-filing/page.tsx`'s
  own local `categorize()`) must live in its own small module with no
  `server-only` marker and no heavy imports — putting it in an existing
  `server-only`-marked lib file (e.g. `lib/late-filing-lookup.ts`, which
  needs `server-only` because it queries Supabase) would break the CLIENT
  page's build the moment it tried to import it, the same class of mistake
  INV-DOC-006 already documents for `formatDisplayDate()`/`lib/date.ts` —
  confirmed as a real, recurring risk now that it's happened twice in the
  same session. `lib/late-filing-categorize.ts` is the model to follow: one
  tiny, framework-free file, importable from anywhere.
- **INV-DATA-030** — A company that has been struck off or terminated is
  routinely REMOVED from the `companies` table entirely while `master_list`
  keeps its full historical record — confirmed on production: of 6 sampled
  struck-off companies, 4 had no `companies` row at all. Any
  company-lookup path that queries only `companies` will therefore answer
  "no such company" for a real former client the firm served for years
  (`lib/company-deep-lookup.ts` did exactly that until it gained a
  master_list fallback returning `recordSource: 'master_list_only'`). Two
  rules follow: (a) a lookup meant to answer "do we know this company" must
  fall back to master_list, and (b) "is X still our client" must be
  answered from the master_list lifecycle category, NOT from
  `companies.tw_status`/`is_active` alone — those come from TeamWork and can
  disagree with it.
- **INV-DATA-031** — Annual Return FILING status and INVOICING status are
  different concepts on the same AR cycle and must never be used to answer
  each other's question — the same confusion INV-DATA-022 already documents
  for `search_company`'s `ar_reminders` field. `ar_batch` returned only
  filing status, so "4月有几家没开单" (a billing question) had no correct
  answer at all; it now returns `filing_status` and `billing_status`
  separately, with invoiced-vs-not resolved the way AR Reminder's own page
  does it (a `generated_invoices` row whose `fye_cycle` matches that row's
  own cycle).
- **INV-DATA-032** — Any count reported to a user must come from a COUNT
  query or a fully-paged fetch, never from the length of a capped
  `.limit()`/`.range()` read: `lib/audit-lookup.ts` first reported exactly
  1000 changes for a 7-day window because that was Supabase's row cap, not
  the real figure (1058). The same class of error is why `lib/page-all.ts`
  exists — reach for a count query or `pageAll()` rather than assuming a
  single read returned everything.
- **INV-DATA-033** — Every chat action that WRITES must go through the
  preview → user-click-Confirm → execute pattern the assistant's four
  original action cards established, per Vincent: "可以真正执行只是每次执行
  要提前获得用户点击同意才真正执行操作" (real execution is fine, as long as
  every execution gets an explicit user click first). Concretely: the chat
  TOOL is read-only and returns a preview with the real current value; the
  CARD renders a before/after and a Confirm button; only the click calls
  the real API. `preview_ar_update` (2026-09-09) also shows the two extra
  rules such an action needs: send the previous value so a conflict-safe
  endpoint REJECTS a value someone else changed in the meantime (surface
  that 409 to the user rather than swallowing it), and keep the chat-
  writable field list deliberately NARROWER than the endpoint's own
  allowlist, so chat is a workflow shortcut rather than a way to rewrite
  any column of a compliance record by typing a sentence.
- **INV-DATA-034** — A file handed to the user from a chat answer must be
  built by RE-RUNNING the query server-side, never assembled from anything
  the model produced, and must never be truncated. `/api/assistant/export`
  therefore accepts only a KIND plus its parameters (`lib/chat-export.ts`'s
  `ChatExportSpec`), parsed field-by-field against an allow-list, and calls
  the same tested lookup the chat tool called — so a company the model
  hallucinated into its prose still cannot reach the spreadsheet. The
  no-truncation half matters just as much: the chat tool's own row cap
  exists to keep a reply readable, and reusing it for the export would
  silently hand over 40 of 419 rows under a headline that says 419
  (`CompanyListFilters.unlimited` and the unbounded collections limit exist
  only for this path, and are deliberately unreachable from the model's
  tool input). The export offer is also stripped from the tool result
  before it is serialised for the model — a model that can see an export
  descriptor narrates it ("I've exported it for you"), which is the same
  false claim INV-DATA-033 exists to prevent. *(source: 2026-09-10,
  Vincent: chat could answer list questions but a person cannot work from
  "16 家逾期" or the first 40 of 419 names.)*
- **INV-DATA-035** — A chat surface's suggested prompts are its only
  discoverability affordance, and a click SENDS THE TEXT VERBATIM — so a
  suggestion containing a placeholder ("XX 公司的欠款") literally asks about
  a company named XX, and one no tool can answer teaches the user the
  assistant is useless. Every suggestion must stand alone and be really
  answerable. Related: never make a headline suggestion out of a tool that
  legitimately returns nothing for the person most likely to click it —
  "What should I prioritize today?" routed only to `my_tasks_summary`,
  which returns `everAssigned:false, total:0` for an owner/management
  account who was never a caseworker, so the app's most prominent prompt
  answered "you have never been assigned anything" (`lib/firm-pulse.ts` /
  `firm_pulse` is the firm-wide counterpart that now sits beside it).
  *(source: 2026-09-10, Vincent: "怎么样让AI chat 更简单易懂人类的提问".)*
- **INV-DATA-036** — The assistant's system prompt must state the CURRENT
  SGT date and time on every call, in the DYNAMIC (uncached) half. A model
  cannot read a clock: with no date given, it infers "today" from the
  newest timestamp in its own tool results and narrates that as today.
  Confirmed real 2026-09-10 — asked what everyone did today at 12:24 SGT,
  it answered "今天（2026-09-09）", because the newest audit row it saw was
  from the 9th. Nothing about the data or the timezone conversion was
  wrong; the prompt simply never said what day it was. Related: this whole
  system runs on Singapore time, so anything computing "now" must use
  `todaySGT()`/`thisYearSGT()`, never `new Date().toISOString().slice(0,10)`
  or `getFullYear()` — Vercel functions run in UTC, which is still the
  PREVIOUS day until 08:00 SGT, and the previous YEAR until 08:00 on 1
  January. That had reached a real financial record: an invoice raised
  before 08:00 SGT was dated the previous day in QuickBooks
  (`create-invoice`'s txnDate default). *(source: 2026-09-10, Vincent:
  "一切以新加坡时间为准".)*
- **INV-DATA-037** — When chat can answer a question about a real feature,
  the reply must carry that feature's REAL actions, not a link telling the
  user to go and press the buttons themselves. Vincent, repeatedly and
  finally bluntly: "我已经说很多次了要有实际功能，只是在每次真正要操作实际
  功能的时候，敏感操作，需要跳出弹窗获得用户点击同意AI助手协助执行" — real
  execution is the requirement; the confirm popup is the safeguard, not a
  reason to stop at a preview. The SOA answer had been prose plus two
  markdown links, which left the actual job (download the statement, send
  it to the client) entirely undone. The pattern that satisfies both: the
  card runs the FEATURE PAGE'S OWN action code, extracted into a shared
  client module so there is one implementation rather than a chat copy
  that can drift (`lib/soa-actions-client.ts`, extracted from
  `app/billing/soa/_components.tsx`), and anything client-facing still
  terminates in the same human-confirmed send window the page uses —
  chat prepares, the human sends. *(source: 2026-09-10.)*
- **INV-DATA-038b** — Follow-through on INV-DATA-038: a chat card must not ALSO keep its own lookalike of the feature's action dialog. The invoice card had both a real-editor modal AND a chat-built "Confirm invoice generation" popup (thin: company + line totals + Confirm). Vincent: "这个弹窗都不是我真正的完整的弹窗内容". The chat popup and its own POST path are gone; the card is a read-only preview whose single action opens the real `ExpandedBillingRow` editor, where the full line detail, the real overlap-confirm and the real Generate button live. If a real editor exists to open, do not also ship a second confirm step beside it. *(source: 2026-09-10.)*
- **INV-DATA-038** — When chat needs to offer a feature's FULL interaction
  (not a summary), render the feature page's OWN component in a modal —
  never a chat lookalike of it. Vincent: "现在这些功能都锁死了在各自的功能
  页内，却没有互通到这个AI CHAT内...还是很像只是一个聊天chat". The move
  that makes this possible is that these editors are already module-level
  components taking plain props (`ExpandedBillingRow({ c, cycleFye })`
  closes over none of the Billing page's state), so extracting one to
  `components/<feature>/` is a pure move the page keeps using unchanged —
  verify byte-identity of the moved block rather than trusting a diff to
  look right. Two rules for the chat side: fetch the component's real data
  from a server route that RE-RUNS the real computation (never feed it the
  chat preview), and give that route the same permission gate the feature
  page has — `/api/billing/renewals/company` re-runs
  `computeAllCompanyBilling()`, resolves the name exactly as the page does,
  and refuses restricted accounts. *(source: 2026-09-10.)*
- **INV-DATA-039** — Chat must never form its own opinion about who a
  client email goes to. Recipient/CC policy lives in exactly one place
  (`lib/client-comms-resolve.ts`: TeamWork report recipients → company
  fallback → the staff CCs derived from SEC/ACC/TAX PIC), and every chat
  path — preview and draft alike — goes through it: `previewEmailDraft()`
  calls `buildRow()` server-side, and `buildCampaignDraft()` re-resolves
  through the same `/campaigns/preview` endpoint the pages use rather than
  trusting the preview it was shown. It also passes `buildRow`'s own
  verdict through verbatim (`autoIncluded`/`autoReason` — "Already sent
  this cycle", "No invoice found", …) instead of re-deriving it, so chat
  and Campaign Centre can never disagree about whether a client was
  already emailed. Sending a client's statement to an address chat guessed
  is the failure this prevents, and it is not recoverable. *(source:
  2026-09-10.)*
- **INV-DATA-040** — `companies` and `master_list` are joined BY NAME and
  their spellings genuinely differ, so any lookup across the two must go
  through `normalize()` — never an exact compare, `.eq()` or `.ilike()` on
  the raw name. Confirmed real 2026-09-10: `companies` stores
  "1V CAPITAL PTE. LTD." and `master_list` stores "1V CAPITAL PTE. LTD"
  (one trailing dot apart), so an `.ilike()` match reported "has no Master
  List row" for a company that plainly has one. This is the same failure
  family as the address-service count that silently dropped an active
  client on a UEN join — a name/key join across these tables that looks
  like it works will still be quietly missing rows. *(source: 2026-09-10,
  `lib/company-update-lookup.ts`.)*
- **INV-DATA-041** — TAO (ACC's QuickBooks book) has its own client base
  that is NOT a subset of the corporate-secretarial roster: 154 of 359 real
  TAO customers have no row in `companies` at all, and some are
  individuals billed for personal tax. Any TAO lookup must resolve against
  ACC's actual book (`computeTaoCompanies()`, extracted from
  `/api/billing/tao`'s GET), never against `companies` — a first version of
  `lib/tao-lookup.ts` resolved against active companies and answered "No
  active company matched" for 43% of ACC's real customers. The TAO page
  itself already had this right; the lesson is to reuse its computation
  rather than re-derive one. Related: TAO cannot be auto-drafted at all —
  Accounts/Tax have no periodicity model in this system, which is why ACC
  hand-builds every TAO invoice, so nothing may present a TAO "draft" or
  "due" list. *(source: 2026-09-10.)*
- **INV-DATA-042** — A total computed over rows with missing values must
  travel with the count of what it could not price, and that count must be
  stated whenever it is non-zero. Older TAO line items in QuickBooks store
  a NULL rate, so summing with `?? 0` produced a confident "S$0 to repeat
  everything" for a customer really billed S$1,200 (Galaxia Capital, 2024).
  A silently-incomplete number is worse than an obviously incomplete one.
  *(source: 2026-09-10, `TaoPreview.servicesWithoutRate`.)*
- **INV-DATA-043** — When chat reuses a page component that keeps DERIVED
  state, it must reuse the page's recompute function too, not just spread
  the changed field. `ARDetailModal` renders a workflow bar off
  `record.stages`, which the Billing page refreshes through
  `recomputeArRecord()` (plus the `_manual` flag flip that drives the blue
  auto-fill dot) inside its own `handleSave`. A plain `{...record, [field]:
  value}` in the chat copy left that bar showing the pre-edit state while
  the value itself had already been saved. If a component's props carry
  derived fields, copying the component without its derivation is a
  half-reuse. *(source: 2026-09-10.)*
- **INV-DOC-007** — Reusing a page component in chat is a bundle decision
  as much as a code one. `ChatCards.tsx` renders on every page, so a
  top-level VALUE import from `app/billing/page` pulls that ~3,500-line
  module into every bundle; only `import type` is erased. The AR modal is
  therefore loaded with `next/dynamic`, and the helper it needs
  (`recomputeArRecord`) is taken off that SAME lazily-imported module
  rather than imported statically — adding one innocuous value import
  silently undid the code-splitting once already. Verify by checking that
  the only remaining reference is `import type`. *(source: 2026-09-10.)*
- **INV-DOC-008** — `loadTemplate()`/`renderDoc()` in `lib/docx-post-
  incorporate.ts` only ever touched `word/document.xml` — a placeholder
  living in a Word HEADER or FOOTER part (`word/header*.xml`,
  `word/footer*.xml`) was copied into every generated document byte-for-byte
  unresolved, no matter what `data` the caller passed. Confirmed real:
  template 12 (ND_AGREEMENT)'s `footer1.xml` has a bare `{{ND_name}}` that
  survived generation as literal text on every page. `renderDoc()` now also
  runs `replaceAllPlaceholders`/`stripMarkerText` on every `word/header*.xml`
  / `word/footer*.xml` part it finds, for every caller (not just the one
  template known to need it today) — a future template edit that adds a
  footer/header placeholder is covered automatically. `test-orchestrator.ts`'s
  `fullText()` now scans header/footer parts too, since it previously could
  not have caught this class of bug at all (it only ever read
  `word/document.xml`). *(source: 2026-09-11, Vincent's problem-report docx,
  screenshot of an unresolved "{{ND_name}}" table.)*
- **INV-DOC-009** — When Vincent reports a Post Incorporate GENERATED-FILE
  bug (wrong content, not a form/UI issue), check whether the relevant
  template file in `templates/post-incorporate/` still matches HIS working
  copy before assuming it's a code bug — `md5sum` every same-named file
  against his Desktop `Post Incorporate - Tassure` folder (or wherever he
  says the current master copies live). Confirmed real: templates 12
  (ND_AGREEMENT) and 05 (Engagement Letter) had silently drifted; the ND
  Agreement template had been deliberately rewritten to name only the
  LARGEST shareholder as "the Shareholder" party (new `largest_shareholder_*`
  placeholders — ported from the old desktop tool's "最大股东" selector,
  `PostIncorporateCompany.largestShareholderName`, `largestShareholder()` in
  `lib/docx-post-incorporate.ts`) instead of listing every shareholder —
  a real, intentional business/legal change, not a parsing bug, that the
  code had no way to know about until the templates were diffed. Default
  (no explicit selection): whoever holds the most shares, tie broken by
  entry order — deliberately NOT the old tool's random tie-break, since a
  document generator re-run on identical input should never name a
  different legal party. *(source: 2026-09-11, Vincent: "在我小程序里面是有
  一个这个东西的，但是在我系统不见了".)*
- **INV-DOC-010** — A template run whose ENTIRE text content is a bare
  `{{placeholder}}` must never carry `w:hint="eastAsia"` on its `w:rFonts` —
  this document set's theme (`word/theme/theme1.xml`) has an EMPTY East
  Asian font slot (`<a:ea typeface=""/>`) on both major and minor fonts, so
  a run hinted to render via that slot has no font Word/WPS is told to use;
  Microsoft Word tends to fall back gracefully, but WPS (confirmed:
  Vincent's own screenshots show the WPS toolbar) can render the substituted
  text as genuinely blank even though the real value is 100% present in the
  XML — confirmed directly: a generated Engagement Letter's `{{Chairman}}`
  field inspected byte-for-byte had "ZHANG WEIZENG" correctly filled, yet
  Vincent's WPS screenshot showed the "Name:" line empty. Root cause: Word
  auto-tags a run with `w:hint="eastAsia"` whenever the author's input
  method was set to Chinese at the moment of typing, EVEN when the typed
  text itself is pure Latin (e.g. typing "{{Chairman}}" while a CJK IME was
  active) — a common accident in these bilingual EN/CN templates, unrelated
  to whether the run's actual content needs CJK rendering at all. A one-time
  sweep across all 16 templates found this exact pattern on 13 runs across 5
  files (`01 First Board Resolution` alone had 9: company_name, company_UEN
  x2, first_finperiod_enddate, finperiod_enddate, secretary_name,
  company_address, ND_name, company_reg_date; `03`, `04`, `05`, `06`, `12`
  had one each) — stripped the hint from every one (never from a run mixing
  in real CJK prose, which legitimately needs it). Check for this pattern
  first — before assuming a "missing data" report is a data-binding bug —
  whenever a placeholder's `{{name}}` is confirmed present in the raw XML
  but Vincent reports the printed value blank. *(source: 2026-09-11, traced
  from Vincent's screenshot of a blank "Name:" field on the very sample file
  generated to prove the data WAS there.)*
- **INV-QB-0CO** — QuickBooks REPLACES `BillAddr` wholesale; it never
  merges. So the moment this system sends one, it owns every line the client
  reads on a real invoice. Two consequences that are load-bearing: (1) an
  ordinary invoice with no c/o and no parent link must keep sending NO
  `BillAddr` at all — that omission is what lets QuickBooks refill from the
  customer default and is also what stops an invoice EDIT from wiping a c/o
  someone typed by hand in QuickBooks; (2) composing a Bill To means
  rebuilding the whole block (client name → `c/o X` → address → `Attn: Y`),
  so every lookup inside it must DEGRADE to the client's own address with a
  visible note rather than print a c/o line with nothing under it.
  Confirmed against live data: "Novix Ai Global Pte. Ltd" exists as a
  QuickBooks customer but has no address on file, which is exactly why the
  real staff-typed invoice (TAC #02680288) printed the client's own address
  under the c/o line. QuickBooks prints only Line1–Line5, so overflow is
  folded into the last line, never dropped. *(source: 2026-09-10.)*
- **INV-QB-0CO2** — Two features can write the invoice Bill To and they mean
  OPPOSITE things: the parent-company override (`parent_company_id`) bills
  the PARENT and replaces the client's name, while c/o bills the CLIENT and
  keeps its name. c/o wins, per Vincent ("c/o 优先...但是要小心"), and when
  both are configured on one company the invoice result carries an explicit
  note saying which was used — never resolve that silently, because it
  changes who the client sees the invoice addressed to. A new column read by
  invoicing must also survive its own migration not having run yet:
  `loadCareOfSettings()` swallows the missing-column error and returns
  all-null, so deploying ahead of the SQL leaves invoicing byte-identical
  (verified against production before the migration). *(source:
  2026-09-10.)*
- **INV-DATA-044** — A deterministic reply guard must fire on a CLAIM, not
  on a keyword. The outstanding-balance guard (INV-DATA-022) matched any
  mention of 欠款/outstanding, so a reply describing the Billing page as
  "（开单、年报、欠款等）" got the full "⚠️ 系统提示 ... 内容可能不准确" banner
  stapled to an otherwise correct answer. A guard that cries wolf on
  ordinary prose gets ignored, which costs more than the guard saves. It now
  requires the keyword AND either a money figure or an assertion adjacent to
  it (没有/有/共/目前… or the English equivalents) — strictly narrower, and
  `test-reply-guards.ts` pins both directions: the seven real fabrications
  it must still catch, and the five ordinary sentences it must leave alone.
  *(source: 2026-09-10.)*
- **INV-DATA-045** — Page-view counts are not work. "今天大家做了什么" must
  be answered from the real audit trail (`recent_changes`, the only
  company-wide source of what was actually changed and on which company),
  never from `active_users_today`, whose numbers are visits. Presenting
  "Vincent — 18 次" as what someone did is a category error, and a quiet day
  is a real answer: verified 2026-09-10, when `humanChanges` was 0 of 9
  (all automated syncs) and every human-output table —
  `generated_invoices`, `email_drafts`, `email_campaigns`,
  `post_incorporate_operations` — was genuinely empty for the SGT day. Say
  that plainly rather than dressing visits up as activity. *(source:
  2026-09-10.)*
- **INV-DATA-046** — `audit_log` is NOT the record of what people did. It
  captures field-level changes only, and misses most real work: verified
  2026-09-10, when `recent_changes` reported 0 human changes for the day
  while six real AR Reminder edits by two staff had happened (they live in
  `ar_reminder.updated_at`/`updated_by_email`, never reaching audit_log).
  An answer built on audit_log alone will confidently tell a manager the
  team did nothing. `lib/team-activity.ts` is the company-wide truth,
  reading the eight tables staff actually write. Two rules it encodes:
  automated writers (`system:*`, `*@internal`) share those same
  `updated_by_email` columns and must be filtered — `backfill@internal`
  alone was 199 of 263 items over a week — and the ASKER is excluded by
  default, because a manager asking what the team did does not mean
  themselves. *(source: 2026-09-10, Vincent: "重点的是我要知道其他人真正在
  干嘛".)*
- **INV-DATA-047** — The assistant's answer quality is bounded by its
  MODEL, and no amount of prompt engineering substitutes. It ran on
  `claude-haiku-4-5` with `max_tokens: 1024` while carrying 33 tools and
  ~40KB of routing guidance — past what the small model handles, which is
  what produced mechanical, table-padded replies and mis-routing (开SOA →
  invoice drafts). Now `claude-sonnet-5` at 4096, overridable via
  `ASSISTANT_MODEL`. Before adding yet another prompt rule to fix a
  "dumb answer", check what model is actually serving it. *(source:
  2026-09-10, Vincent: "为什么...不能像 chatgpt 和 claude 那样智能的理解...
  明明都接了 Anthropic 的 api".)*
- **INV-DATA-048** — A person's name is data we already hold (`lib/approved-accounts.ts`), never something to reconstruct from an email local-part. Confirmed live 2026-09-10: `active_users_today` returned bare emails and the model rendered `hoechyi@tassure.com` as "Ho Echyi" (her name is "Lim Hoe Chyi") — it guessed a word split. Every assistant tool that surfaces a staff member now resolves the real name server-side before the payload reaches the model, and the prompt forbids inventing one. If an email has no matching account, show the email — do not guess a spelling of a real person. *(source: 2026-09-10.)*
- **INV-DATA-049** — Late Filing's PIC column was empty for every row because `lateFy` is the OLDEST unfiled cycle (often years old, e.g. INVENTA FY2018), and `ar_reminder.pic` on those ancient rows is an EMPTY STRING, not null — so `lateFy.pic ?? fallback` never fell through (`??` only catches null/undefined). Two fixes, both needed: guard with `.trim() ||` not `??`, and fall back to `companies.pic` (the TeamWork-synced current Secretary PIC) matched via `normalize()` not `.toLowerCase()` (INV-DATA-040). All 16 late filers resolved a PIC after both. Vincent: "TW 应该是有记录的才对啊" — it was, the page just wasn't reading it. *(source: 2026-09-10.)*
- **INV-DATA-050** — Field-level edit history lives in TWO tables and any "what changed" answer must read both. `ar_reminder` edits are written to `ar_reminder_audit` by DB triggers (field_name / old_value / new_value / changed_by_*), NOT to `audit_log` — the AR Reminder PATCH endpoint has no logFieldChange() call, unlike the Master List and Trademark PATCHes, whose diffs DO go to `audit_log`. So `recent_changes` (audit_log only) never shows a human AR edit, and `team_activity` reads `ar_reminder_audit` + `audit_log` together. A burst of edits to one company by one person within a minute is collapsed to a single item so "filled in 6 fields" reads as one action. *(source: 2026-09-10, Vincent: "这些可以优化到更细的层面吗".)*
- **INV-DATA-051** — The assistant's person-activity permission model is a RANK ladder, not a binary management flag, and it gates ONLY person-centric questions (my_tasks_summary / recent_activity_summary with a `person`, team_activity, active_users_today, team_roster load figures). Client data, invoicing, arrears, deadlines, company lookups stay open to every account. Ranks (lib/staff-directory.ts RANK_BY_EMAIL, lib/person-visibility.ts): owner (Vincent — visible to no one else) > partner (visible only to owner; partners cannot see each other) > leader (visible to owner/partner/other leaders) > staff (visible to any staff+; staff see each other; Chelsea is plain staff). team_activity / active_users_today FILTER out people the caller may not see and report the hidden count rather than refusing — a blocked person-level query never blocks the underlying company facts, and the refusal message says so. test-person-visibility.ts pins the matrix. *(source: 2026-09-10, Vincent's spec.)*
- **INV-DATA-052** — Hiding a section client-side (`{data && <Section/>}`) is a display choice, not an access boundary — the API route behind it must enforce the restriction itself, or any authenticated account can still read the data by hitting the endpoint directly. `/api/automation/health` (the Dashboard's Automation Health panel — cron status, TeamWork batch timings, integration exceptions) had no per-account check at all, only the blanket "must be logged in" the proxy middleware already applies to every route; any approved account could fetch it even though the page only ever rendered it for the one email checked client-side. Restricted to Vincent at the route (`getRequestAccount` + an explicit email check, 403 for everyone else) rather than only in `app/page.tsx`. *(source: 2026-09-11, Vincent: "这个板块只开放给Vincent显示，其他人看不到".)*
- **INV-DATA-053** — Any loader keyed on My Tasks' `viewAsEmail` (identity
  substitution — `load()` for `/api/my-tasks`, `loadConversations()` for
  `/api/ai/conversations`, both in `app/my-tasks/page.tsx`) must discard its
  result if the identity has moved on by the time the request resolves —
  switching View As twice in quick succession fires two overlapping
  requests with no guaranteed resolution order, so the OLDER identity's
  response can land after the newer one and silently overwrite it with the
  wrong person's data. Guarded with a `viewAsEmailRef` each loader checks
  against its own captured target before calling `setData`/
  `setConversations`. Any future loader added under this identity-switch
  pattern needs the same guard — this is not specific to these two calls.
  *(source: 2026-09-11, Vincent: "来回切换身份的时候有点信息更新延迟卡顿的
  情况".)*
- **INV-DATA-054** — A `companies` row is only ever safely hard-deletable
  when it has ZERO real dependent data anywhere in the system AND has never
  been touched by a real TeamWork sync — never as a general "remove a
  company" capability. Added 2026-09-18 for `DELETE /api/billing/tao`
  (`companyDeletionBlockers()`), the undo path for the SAME route's own
  manual "+ Add new company" side door (`POST`, added 2026-09-05) — Vincent,
  after asking for exactly this once by hand (a placeholder "AAAA" row from
  testing Add): "以后这种自己在系统开的公司for 开单的，能不能可以添加过后
  删除". Real double gate, not a single check: (1) a real `companies.tw_status`
  refuses outright — this route is only for undoing what POST itself just
  did, never a real TeamWork-tracked client, regardless of whether that
  client happens to have zero invoices yet; (2) a real dependent row in ANY
  of `ar_reminder`/`email_drafts` (real `company_id` FK — see `lib/company-
  360.ts`'s own "Reliable links" comment), or `quickbooks_invoices`/
  `quickbooks_credit_memos`/`generated_invoices`/`trademark_records`/
  `nd_appointments` (company_name text match — none of these carry a real
  FK to `companies` at all) or `post_incorporate_operations` (UEN text
  match) refuses, with the specific real reason(s) surfaced rather than a
  generic failure. A query ERROR in any of these checks must never read as
  "0, safe to delete" — every branch explicitly throws instead of letting a
  failed count default to zero, since that would be a silent false negative
  that could let a real client's row get deleted. Verified against real
  data before shipping: a fresh throwaway company (mirroring exactly what
  POST creates) correctly returned zero blockers; "1V Capital Pte. Ltd."
  (known real AR Reminder/QuickBooks/Post Incorporate history) correctly
  returned 5 real blocking reasons. The UI (`app/billing/tao/page.tsx`) only
  ever offers the delete button on a row with `lastInvoice === null` (an
  already-billed company could never pass check #2 above anyway), but the
  server remains the real authority regardless of what the UI shows.

- **INV-DATA-055** — `companies.has_accounts`/`has_tax` (and any other raw
  per-service boolean on that table) are NOT the real signal for "does this
  company get this service" — confirmed live 2026-09-22: only 1-2 of 911
  active companies had `has_accounts`/`has_tax` set at all, and only ONE
  company anywhere had any `services_manual` override set (and it wasn't
  accounts/tax). The real signal is REAL history: actual QuickBooks
  Accounts/Tax invoice line items (`quickbooks_invoice_items.service_type`),
  with `services_manual`'s per-service override (`/api/companies/service-
  override`, `secretary`/`accounts`/`tax`/`xbrl` only — ND/Address always
  follow TeamWork) layered on top for the rare case with no invoice history
  yet. `computeTaoCompanies()` (`app/api/billing/tao/route.ts`) and
  `ar-reminder`'s own `servicesAuto`/`services` merge already did this
  correctly; `app/api/reports/route.ts`'s Service Mix chart did not — it
  read the raw columns directly and showed "Accounts: 1, Tax: 2" on a client
  base where the real count is **383/454** (corrected 2026-09-22, same day
  — this entry originally said 223/217, itself wrong: the verification
  script used to confirm the fix queried `quickbooks_invoice_items` with a
  plain `.select()`, silently truncated at Supabase's default 1000-row cap
  — real row count 4033 — while the ACTUAL fix already correctly used
  `pageAll()`. The shipped code was right the whole time; only this
  invariant's own reported number was wrong. General lesson: a verification
  script checking a `pageAll()`-based production computation must ALSO use
  `pageAll()`, never a plain `.select()` — a truncated verification can
  silently confirm a wrong number, which is worse than no verification at
  all since it reads as checked). Fixed by computing Accounts/Tax
  service-mix membership from real `quickbooks_invoice_items` history
  (service_type-specific, so Accounts and Tax stay two genuinely different
  counts — `computeTaoCompanies()` itself was NOT reused here since it
  merges the two into one combined roster). `uses_address`/`has_nd`/
  `has_xbrl` were checked too and are NOT part of this bug (375/153/35 out
  of 911 — real, plausible numbers, kept in sync some other way); `has_agm`
  reads 911/911 (100%) for a different reason — it's definitionally near-
  universal, not a broken column — and was deliberately left alone rather
  than guessed at. Before trusting any `has_*`/`uses_*` company flag for a
  new feature, check its actual population rate against `is_active`
  companies first; do not assume a column means what its name says.
- **INV-DATA-056** — A "does this company already exist" collision check
  before a write must use the identifier that CAN'T legitimately collide
  between two real companies (UEN) before falling back to one that can
  (name) — and a NAME-only match below 100% confidence (fuzzy) must ask a
  human before acting, never silently proceed, when the action is
  consequential (here: turning on a real service flag on someone else's
  tracked company). Added 2026-09-22 to `POST /api/billing/tao`'s "+ Add new
  company" side door (INV-DATA-054's own POST): its OLD collision check was
  name-only (exact then 85%-fuzzy) and had a real dead end — a company
  already tracked via TeamWork for another service, but never billed under
  TAO, has no TAO eligibility yet (see INV-DATA-055's real-signal
  definition) so it doesn't appear in this page's own list/search either;
  hitting the old collision check on it produced "already exists...search
  for it instead" pointing at a search that could never find it. Now: UEN is
  a REQUIRED field (validated against the same regex `lib/teamwork-company-
  profile.ts` already uses to recognize one), checked before name; a
  UEN-exact or normalized-name-exact hit is trusted immediately since
  neither can reasonably be a different real company; a fuzzy-name-only hit
  returns `needsConfirmation` (candidate + message) instead of guessing, and
  the caller must explicitly send back `confirmedCompanyId` (yes, same
  company — flip its `services_manual` accounts/tax flag via `/api/
  companies/service-override`'s own `set_service_override` RPC, never a
  second `companies` row) or `forceNew` (no, different company — insert).
  Confirmed a REAL pre-existing duplicate this design would have caught:
  "GOLDEN BRIDGE MARTEC PTE. LTD." exists as two separate `companies` rows
  sharing one real UEN (202633763E) — found, not fixed (unclear which row
  carries which real dependent data; a human should pick which to keep).
  UEN coverage confirmed asymmetric: 98.8% for TeamWork-synced companies,
  21.4% for the small manually-added set — so UEN is a reliable check
  against the EXISTING roster, but wasn't being captured going forward by
  this exact side door until this fix (now stored as `registration_no` on
  every insert, and backfilled onto an existing row only when that row's own
  field was empty — never overwritten). *(source: 2026-09-22, Vincent: "是否
  有必要加入UEN做保险机制".)*
- **INV-DATA-057** — My Tasks' per-person task list must only ever ADD a new
  domain by REUSING that domain's own already-established attribution rule
  and "needs attention" threshold — never invent a new one for the purpose
  of populating this page. `lib/my-tasks-data.ts`'s `computeMyTasks()` was
  widened 2026-09-22 (Vincent, on a real screenshot of the v1 AR-Reminder-
  and-Late-Filing-only page: "现在这部分那么简陋，根本都称不上是提醒") to
  add 2 more domains, both reusing existing logic verbatim: SOA collections
  (`effectiveOwner()`, `lib/soa-data.ts` — the EXACT function the SOA pages
  themselves already show as the "Owner" column) and Trademark renewals
  (`getTrademarkSummary()`'s own existing 180-day "expiring soon" window,
  attributed via `companies.pic`/`sec_pic` joined by `normalize()`-matched
  company name — the SAME company_name→companies.pic fallback join Late
  Filing's own PIC resolution already relies on, INV-DATA-049). Nominee
  Director subrole review and Client Communications drafts were
  DELIBERATELY NOT added in the same pass, and must not be added later by
  guessing a threshold — neither has an equally clean existing per-person
  attribution rule (ND review is company-scoped but "whose job" isn't
  defined anywhere; an unsent draft has no existing "how long is too long"
  rule anywhere in this codebase) — see `docs/CURRENT_STATE.md`'s Pending
  improvements for what a real decision would need to cover before either
  could be added the same way.

  Verified against real production data before shipping (`computeMyTasks()`
  run for 2 real accounts with genuine SOA involvement): Hoo Seng Xin — 33
  real SOA collections, each correctly attributed to him by name via
  `effectiveOwner()`; Chelsea Ang — 1 real SOA collection (ZTT Engineering,
  S$1,533.50). Both accounts' first `computeMyTasks()` call measured ~12.8s
  (cold Node process — module load + first Supabase TLS handshake), but a
  second call on an already-warm process measured ~2-2.4s consistently —
  the real added cost of `computeAllSoaRows()` in a warm serverless
  function is closer to the latter, not the former; don't mistake a cold
  diagnostic script's first-run number for steady-state latency. Same
  change added `preferredRegion = 'sin1'` to `/api/my-tasks`
  (INV-PERF-001) — it had NONE even in the narrower v1 scope (already
  past the "5+ Supabase queries" threshold with AR Reminder + Late Filing +
  the mirrored-AR lookup alone), and is well past it now.

- **INV-DATA-058** — "Undo my last add" is not one operation — which undo is
  correct depends entirely on WHICH of two different things the add actually
  did, and showing the wrong one is worse than showing neither. Added
  2026-09-22 to TAO's "+ Add new company" (INV-DATA-054/056's own POST):
  a row with no invoice yet (`lastInvoice === null`) can exist for two
  unrelated reasons — a genuinely fresh `companies` row that POST just
  inserted (hard-deletable; DELETE's own `tw_status` gate already allows
  it), or a real TeamWork-tracked company whose `services_manual` accounts/
  tax override POST just flipped on (NEVER hard-deletable — DELETE's
  `tw_status` gate correctly refuses it, but the old UI showed the delete
  icon on it anyway, so the only feedback was a refusal with no path
  forward). `TaoCompanyRow` gained `trackedByTeamWork` (a real
  `companies.tw_status` read, computed once in `computeTaoCompanies()`
  itself so every caller — the TAO page and `lib/tao-lookup.ts`'s chat
  preview alike — sees the same real answer) so the page can show the RIGHT
  undo for each: the trash icon only for `!trackedByTeamWork` (delete),
  a new "Remove from TAO" icon only for `trackedByTeamWork` (clears the
  `services_manual` override back to `null` — not `false` — via the same
  `/api/companies/service-override` PATCH the Add flow itself used to set
  it; `null` clears the override rather than asserting "never eligible",
  so real Accounts/Tax invoice history appearing later still makes the
  company eligible again on its own, unlike a hard `false` would). Verified
  against real production data: of 807 real TAO-eligible companies, 19 are
  never-billed-but-`trackedByTeamWork` (would have hit the old dead-end) vs.
  only 2 genuinely fresh never-billed ones (the trash icon's real intended
  case). `ConfirmDeleteModal` (`components/ConfirmDeleteModal.tsx`, shared
  by 7 call sites) gained optional `title`/`body`/`confirmLabel`/`tone`
  props, all defaulting to the exact original hard-delete wording/red
  styling, so this reuses the one shell instead of a second, divergent
  "are you sure" modal — every existing caller passing only `label`/
  `onCancel`/`onConfirm` is unaffected. *(source: 2026-09-22, Vincent: "假设
  我后面发现加错公司了怎么办...这个新加的公司后面发现无效".)*
- **INV-DATA-059** — Any period-over-period figure ("YoY", "growth", "vs
  last year") shown anywhere in this app — on screen or fed to an AI
  narrative — must be built from `lib/reporting-period.ts`'s
  `buildReportingContext()`, never from comparing two arbitrary values a
  caller happens to have lying around. Found 2026-09-22 (Vincent's "Reports
  V3 — Management Analytics Upgrade Specification"): `lib/reports-
  narrative.ts`'s AI analysis card (shipped THE SAME DAY, hours earlier)
  derived its own "YoY" by comparing a 5-year trend series' own last two
  year-buckets — the current year's bucket is only ever partial-through-
  the-year (2026 = Jan-Sep so far) while every prior bucket is a full 12
  months, so this was silently comparing 2026 YTD against all of 2025 and
  calling the result YoY, the EXACT failure mode the same spec calls out by
  name as its first example. Confirmed with real data, not a hypothetical:
  the old (buggy) calculation would have reported revenue **down ~14.4%**
  (2026's partial S$3.29M bucket vs 2025's full S$3.84M bucket) — almost
  exactly matching the spec's own illustrative bad-output number
  ("Revenue declined 14.4% YoY"). The REAL comparable figure (2026-01-01
  to 2026-09-22 vs the identical date range in 2025) shows revenue
  genuinely **up 16.2%** — a complete reversal of the conclusion a reader
  would have drawn from the old chart. `lib/reports-data.ts`'s
  `computeComparableRevenue()` is now the one place this gets computed,
  surfaced both on-screen (`RevenuePerformanceCard`, `app/reports/
  page.tsx`) and to the narrative prompt (`comparableRevenueYoy` in
  `lib/reports-narrative.ts`'s evidence object) — never computed a third
  way anywhere else. `buildReportingContext()`'s comparability check is a
  pure day-count match between period and comparison; when it fails,
  `comparable: false` and a human-readable `comparabilityReason` are
  returned, and every consumer must check `comparable` before presenting
  a percentage — `RevenuePerformanceCard` shows "Comparison unavailable"
  instead, and the narrative's own system prompt now says explicitly it
  may only ever cite `comparableRevenueYoy`'s numbers, never recompute a
  percentage itself from the raw multi-year `revenueByYear` series (which
  stays in the prompt only to describe overall SHAPE, e.g. "trending up
  across years").

  Same change fixed "Missing Data Is Not Zero" (the same spec, its own
  named rule) for the multi-year trend charts: `quickbooks_invoices` has
  zero rows before 2024-01-02, so the 5-year Revenue/Invoice Volume trend
  (reaching back to 2022) was drawing a flat 0 line for 2022/2023 — a real,
  live instance of exactly the bug the spec's own literal example
  describes. `computeRevenueTrend()` now returns `value: null` for a year
  that never appears in its own aggregation (proof no QuickBooks data
  exists for that year at all — a different fact than "zero invoices"),
  and `components/dashboard/Charts.tsx`'s shared `Pt`/`LineSeries` types
  were widened to `number | null` app-wide (Dashboard, Reports, Activity
  Insights all share this file) — `VBars` renders no bar at all for a null
  point (never a phantom 0-height one) and `LineChart` lets Recharts break
  the line at that point (`connectNulls` is not set) instead of drawing
  through a fabricated 0. `Donut`/`HBars` (composition/ranking, no time-
  series "missing" concept) filter null entries out entirely rather than
  rendering them. Verified against real data before shipping: `npx tsx`
  (with a local no-op `server-only` shim, since that package is a
  Next.js-only virtual module with no real npm entry — removed again after
  testing, never committed) fetched all 8,017 real `quickbooks_invoices`
  rows and ran both the old and new calculations side by side, producing
  the exact before/after numbers quoted above. `npx tsc --noEmit`, `npm
  run lint` on the changed files, and `npm run build` all clean. See
  `docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md` §0 for the original audit that
  found this bug, written hours before it was fixed.
- **INV-DATA-060** — Two durable rules from Reports V3 Phase 1
  (2026-09-23, `docs/REPORTS_V3_PHASE1_PLAN.md`, approved with Vincent's own
  refinements):

  1. **A period's own day-count is not always exactly reproducible by
     calendar-shifting.** `lib/reporting-period.ts`'s `current_quarter`
     default comparison (shift both endpoints back 3 calendar months)
     preserves calendar ALIGNMENT (same day-of-quarter) but not exact
     day-count — quarters are not a fixed length (Jul-Sep is 92 days,
     Apr-Jun is 91), so a partial Q3 window shifted back 3 months can
     legitimately land 1-3 days short. Found by this file's own test suite
     (`test-reporting-period.ts`), not a screenshot. `checkComparable()`
     now tolerates up to 3 days' difference — enough to absorb this
     calendar-length noise, nowhere near enough to let the dangerous case
     (YTD vs a full prior year, ~100 days) slip through; both are asserted
     directly in the test file. `ytd`/`previous_ytd` and `ttm`/
     `previous_ttm` are exact (0-day difference) by construction and are
     unaffected by this tolerance.

  2. **A "missing data" signal must never be forced onto a dimension the
     source data can't actually support.** `quickbooks_invoices` has a
     clean year boundary (zero rows before 2024-01-02), so INV-DATA-059's
     null-for-absent-year fix is safe there. `master_list.join_date`/
     `update_date` has NO such boundary (Tassure's client base predates
     the trend window) — Vincent's own correction to the original plan:
     do not null out a whole year over a few parse failures, and do not
     force an unparseable date into a year it cannot be reliably assigned
     to. `lib/reports-data.ts`'s `computeClientFlow()` now tracks parse
     success/failure as a GLOBAL count per series (new vs churned — two
     different source fields, two different coverage rates), not
     attributed to any single year, exposed as `{ parseableRecords,
     unparseableRecords, coveragePct, status }` with thresholds Vincent
     specified directly (100% normal, ≥95% minor_issues, ≥90% partial_data,
     else data_quality_warning). Verified against real data: 1,599
     `master_list` rows fetched live — new-client dating 98% coverage
     (25 unparseable), churned-client dating 96.4% (17 unparseable), both
     correctly landing in `minor_issues`.

     **A real, adjacent bug surfaced by this same verification, not fixed
     in this change**: `parseFlexibleDate()`'s final fallback
     (`new Date(s)`) accepts garbage input as a "successful" parse for
     some real rows — `newByYear` came back with entries for 2027, 2028,
     and a bare `44420` (almost certainly an Excel date-serial number that
     leaked through as raw text and got misread as a literal year). These
     don't currently reach the screen (the trend chart only ever shows
     `years = [thisYear-4 … thisYear]`, so 2027/2028/44420 fall outside
     the displayed window), but they DO mean `newQuality.coveragePct`
     (98%) is optimistic — some of what's counted as "parseable" actually
     parsed to nonsense, not a real date. Flagged to Vincent as a known
     limitation, not silently fixed here — tightening `parseFlexibleDate`'s
     own sanity bounds (e.g. reject a parsed year outside some reasonable
     [2000, thisYear+2] range) is a real, scoped follow-up, deliberately
     kept out of this change to avoid touching the shared parser's
     behavior for every other caller in the same commit as the quality-
     tracking feature.

  Also consolidated in the same change: `app/api/reports/route.ts` used to
  carry its OWN separate inline copy of the entire client-flow computation
  (counts + drill-down row lists + its own duplicate `parseFlexibleDate`),
  never calling `lib/reports-data.ts`'s `computeClientFlow()` at all, while
  that shared function's own copy (used by the chat assistant's portfolio-
  summary tool) only built the counts. Folded into one function — the
  route now calls it directly — rather than applying the new quality-
  tracking logic to two separate implementations that could drift apart
  again.

  Also: `lib/reports-narrative.ts`'s comparable-period enforcement is now
  METRIC-SPECIFIC, not "any percentage present + comparable=false = reject"
  — an insight is only rejected when its own `metricRefs` actually cites
  `revenue_yoy`/`invoice_count_yoy` while `comparableYoy.comparable` is
  false; an unrelated percentage (Vincent's own example: "Tax usage =
  49.8%", a point-in-time `service_mix` figure) must never be flagged just
  for containing a "%" sign. `validateNarrative()` also rejects any
  `metricRefs` citation of a `status: 'planned'` entry in `lib/metric-
  catalogue.ts` (nothing computes it yet) and any citation of a metricId
  that doesn't exist in the catalogue at all. On a validation failure,
  `generateReportsNarrative()` retries ONCE with the specific violations
  fed back as a correction instruction ("reject / regenerate", not a
  silent text patch); a second failure throws a real error rather than
  serving an invalid analysis. `driverZh`/`driverEn` are now nullable —
  the model must write `null` rather than invent a causal explanation the
  evidence doesn't support. `confidence` (`high`/`medium`/`low`) is a new,
  independent field from `signal` (kept as `good`/`watch`/`warning` per
  Vincent's own correction — "'good' is not semantically a severity
  level," so it was never renamed to "severity"). All 4 of Vincent's own
  approved test cases (A: warning+low confidence is valid; B: driver=null
  is valid; C: an unrelated percentage during comparable=false passes; D:
  citing revenue_yoy during comparable=false fails) plus 6 more covering
  the catalogue-integrity rules are pinned in
  `test-reports-narrative-guards.ts`. `app/api/reports/narrative/
  route.ts`'s cache-shape validation was tightened the same way it already
  was for the ROUND 1→2 transition (no migration — the cache column is
  plain `text`) so an old-shape cached row is treated as a cache miss, not
  rendered with missing fields.

  **Not verified against a real live Claude call** — no `ANTHROPIC_API_KEY`
  exists in this machine's local `.env.local` (production-only, set
  directly in Vercel), so `generateReportsNarrative()`'s actual model
  output could only be verified structurally (the `validateNarrative()`
  unit tests above), not end-to-end against a real generation. `npx tsc
  --noEmit`, `npm run lint` (changed files), and `npm run build` all
  clean.

- **INV-DATA-061** — INV-DATA-060 shipped and, within hours, broke the
  Reports page's AI Analysis card in production: "Claude returned an empty
  analysis" (Vincent's screenshot, 2026-09-23), exactly the caveat at the
  end of INV-DATA-060 warning that the new schema was never exercised
  against a real live call. Root cause (most likely; could not be
  reproduced locally — no `ANTHROPIC_API_KEY` outside Vercel) and fix, two
  independent contributors:

  1. **A JSON Schema union `type` (`['string', 'null']`) is not a safe way
     to express a nullable field inside an Anthropic forced tool-use
     schema.** It's valid JSON Schema, but `driverZh`/`driverEn` used it to
     satisfy "driver must be nullable," and this shipped as the most likely
     cause of the model's tool-call output coming back malformed enough
     that `insights` was empty/missing. Replaced with the same nullable
     CONTRACT expressed a different way on the wire: `driverZh`/`driverEn`
     are now a required plain `string` in the schema, with an explicit
     "empty string `\"\"` means no driver" convention in both the field
     description and the system prompt. `normalizeInsight()`
     (`lib/reports-narrative.ts`) converts `""` back to real `null`
     immediately inside `callClaude()`, before the result ever reaches
     `validateNarrative()`, the cache, or `app/reports/page.tsx` — every
     downstream consumer still sees the `driverZh: string | null` the
     exported `ReportsInsight` type promises; only the wire format changed.
     **Rule: never give an Anthropic forced-tool-use schema a union `type`
     for nullability — use a sentinel value (empty string, or a documented
     placeholder) and normalize it back to the real type in code.**

  2. **`max_tokens` must be sized for the CURRENT schema, not left at
     whatever an earlier, smaller schema used.** INV-DATA-060's rewrite grew
     the schema from 5 fields to 14 required fields per insight (two of
     them bilingual arrays), across up to 4 insights — but `max_tokens` was
     only bumped 2000→2600, a value sized for the old schema. A response
     that hits the token ceiling mid-JSON can come back with no usable
     `tool_use.input` — the same failure mode INV-DATA-047 already
     documented and fixed elsewhere in this codebase
     (`app/api/assistant/route.ts`'s `claudeAnswer()`, 1024→4096). Raised to
     4096 here too, matching that established value rather than a new
     number chosen ad hoc.

  Also fixed in the same change, a separate definite bug (not just a
  suspected contributor): `generateReportsNarrative()`'s one retry only
  triggered when `callClaude()` succeeded but `validateNarrative()` found a
  rule violation — a THROWN error from `callClaude()` itself (API error,
  malformed/empty response — i.e. exactly this bug's own symptom) propagated
  immediately with zero retry attempts, the worse outcome for what should be
  the more recoverable case. Both call sites now go through one `attempt()`
  helper that catches either failure mode uniformly and feeds the specific
  reason back into the retry's system prompt.

  **Why this wasn't caught by `test-reports-narrative-guards.ts` before
  shipping**: that suite only unit-tests `validateNarrative()` against mock
  `ReportsNarrative` objects — it has never made a real Anthropic API call
  and could not have reproduced a live tool-use schema/response bug. This is
  a real gap, not a test that was skipped; closing it would require either
  a live API key available at test time or a recorded/replayed response
  fixture, neither of which exists yet. Flagged, not silently left
  undocumented.

  **Still not verified against a real live Claude call** — same
  `ANTHROPIC_API_KEY`-not-available-locally limitation as INV-DATA-060.
  Verified: `npx tsc --noEmit` clean, `npx eslint lib/reports-narrative.ts`
  clean, `npm run build` (cold, `.next` removed first) clean, and all 11
  existing `test-reports-narrative-guards.ts` cases still pass unchanged
  (that file only exercises `validateNarrative()`, which this fix did not
  touch). The actual fix can only be confirmed once Vincent reloads the
  Reports page against production.

  **Correction, same day**: this did NOT fix it. Vincent reloaded and got
  the identical error, both attempts ("AI analysis failed after retry:
  Claude returned an empty analysis."), meaning it's deterministic given
  the current data/schema, not a one-off. Neither hypothesized cause above
  is confirmed wrong — there's still no way to know, because this file had
  **zero server-side logging** on this failure path: `callClaude()` just
  threw a fixed string, so even Vercel's own function logs had nothing
  beyond what the user already saw on screen. Two things landed in the
  immediate follow-up, one load-bearing and one speculative:

  - **Load-bearing**: `callClaude()` now logs (`console.error`, visible in
    Vercel's Function/Runtime logs) `stop_reason` and either the response's
    content-block types (if no `tool_use` block was found at all) or the
    actual keys and a truncated JSON dump of `tool_use.input` (if a
    tool_use block WAS found but `insights` came back missing/empty — the
    branch this bug has hit twice now). This is the only way this bug gets
    diagnosed with real data instead of a third guess; nothing here proves
    a specific root cause yet.
  - **Speculative, explicitly not confirmed**: added a required
    `planningNotes` scratch-string field as the FIRST property in
    `ANALYSIS_TOOL.input_schema` (`lib/reports-narrative.ts`), stripped
    out of the result before it's ever returned. Forced `tool_choice`
    gives Claude no free chain-of-thought pass before generating tool
    arguments — it plans and writes simultaneously — and `insights[]` asks
    for a lot per item (14 required fields, bilingual, FACT/INFERENCE/
    HYPOTHESIS/ACTION structure) with previously zero scratch space; a
    documented weakness of forced tool-use on complex schemas, and a
    standard (if unverified here) mitigation. **Do not treat this as a
    confirmed fix in any future entry** until it's actually verified
    against a live response — if it recurs a third time, the logging above
    is what should drive the next actual diagnosis, not another schema
    guess.
  - `npx tsc --noEmit`, `npx eslint lib/reports-narrative.ts`, `npm run
    build` (cold) all clean; all 11 `test-reports-narrative-guards.ts`
    cases unchanged and passing (still only exercises `validateNarrative()`
    — cannot exercise either change above, which both live inside
    `callClaude()`). Confirmation is, again, only possible via Vincent
    reloading the Reports page against production.

- **INV-DATA-062** — Reports' AI Analysis provider switched from Anthropic
  to OpenAI, 2026-09-23, per Vincent's explicit instruction: "额度用完了，
  那么先换成 Open Ai 去生成 Report 这边的Ai分析" (Anthropic credit ran out,
  switch to OpenAI for this feature for now). This was decided while
  INV-DATA-061's "Claude returned an empty analysis" was STILL an open,
  unconfirmed bug — Vincent's own explanation (exhausted Anthropic
  credits) is a genuinely plausible root cause for that exact symptom (a
  quota-exhausted account can plausibly produce a degenerate/empty
  tool-use response rather than a clean HTTP error), though this was never
  confirmed against real Vercel logs — the two hypothesized code-level
  fixes in INV-DATA-061 remain unverified, not proven wrong.
  - `lib/reports-narrative.ts`'s `generateReportsNarrative()` now calls a
    new `callOpenAI()` (via `attempt()`) instead of `callClaude()`, using
    the SAME shared `lib/ai/openai.ts` helper (`openAIJson()`) the My
    Tasks assistant's own synthesis step already uses in production
    (INV-AI-003) — not a new integration, a second caller of an existing
    one. Model: `openAIModel('primary')` (`OPENAI_ASSISTANT_MODEL` env var,
    default `gpt-5.6-terra`), exported as `ACTIVE_NARRATIVE_MODEL` so
    `app/api/reports/narrative/route.ts`'s cache-row `model` field records
    the real generating model instead of a stale hardcoded Anthropic name
    (a real, separate mislabeling bug this fix also closed).
  - New `OPENAI_ANALYSIS_SCHEMA` mirrors `ANALYSIS_TOOL`'s fields
    (identical semantics/descriptions, same `planningNotes` scratch field,
    same `driverZh`/`driverEn` "" -> null convention via the same shared
    `normalizeInsight()`) but in OpenAI Structured Outputs' strict-mode
    shape: `additionalProperties: false` on every object level (top-level
    AND each insight item — a real, silent gap if omitted on the nested
    one) and every property listed in `required` (strict mode has no
    concept of an optional field). `maxOutputTokens: 4096` explicitly
    overridden — `openAIJson()`'s own default (1200) is sized for much
    smaller schemas elsewhere in this codebase and would very likely
    truncate this one, the same class of risk INV-DATA-061 already raised
    for the Anthropic side.
  - `callClaude()`/`ANALYSIS_TOOL` are DELIBERATELY KEPT, not deleted —
    Vincent said "先" (for now), implying Anthropic may return once
    credits are restored. Reverting is meant to be a one-line change in
    `attempt()` (`callOpenAI` -> `callClaude`), not a rebuild. Marked with
    an `eslint-disable-next-line no-unused-vars` on `callClaude` itself
    (genuinely unused right now, not oversight) rather than deleted.
  - **Not verified against a real live OpenAI call** — same
    `OPENAI_API_KEY`-not-available-locally limitation this file already had
    for `ANTHROPIC_API_KEY`. Also could not directly confirm
    `OPENAI_API_KEY` is actually configured in Vercel production — the
    Vercel API token on file could list deployments but returned "Could
    not retrieve Project Settings" for `vercel env ls`, a narrower grant
    than expected; inferred (not confirmed) from the fact that the My
    Tasks assistant's own OpenAI-backed features already ship successfully
    in production. `npx tsc --noEmit`, `npx eslint` (both changed files),
    `npm run build` (cold) all clean; the same 11
    `test-reports-narrative-guards.ts` cases pass unchanged
    (provider-agnostic — only exercises `validateNarrative()`).
    Confirmation is only possible via Vincent reloading the Reports page.

## Draft Helper / Outlook COM automation (INV-HELPER)

- **INV-HELPER-001** — Multiple To/CC/BCC addresses stored newline-joined
  (this app's internal convention) must be re-joined with `; ` before
  assignment to Outlook's COM `mail.To/.CC/.BCC` — Outlook expects
  semicolons, and `.Send()` (unlike `.Display()`) hard-fails immediately
  on an embedded newline ("Outlook does not recognize one or more
  names"). Must be applied in every code path setting these properties.
- **INV-HELPER-002** — An Outlook `Inspector` obtained via
  `GetInspector()` (for its account-binding side effect) must **not** be
  closed immediately — closing before Outlook finishes initializing a
  not-yet-saved item can tear down the item or crash Outlook's process;
  the close must be deferred until right before Save()/Send()/Display().
  Conversely, `.Send()` itself requires the Inspector be closed first or
  it throws `(-2147024809, 'The parameter is incorrect.')` —
  `.Display()` can safely leave it open (matches the source macro's own
  behavior: it never closes the Inspector at all until the human
  dismisses the window).
- **INV-HELPER-003** — `app.py`'s `VERSION` and the web app's
  `LATEST_HELPER_VERSION` must always be bumped **together** in the same
  change — bumping only one silently breaks the "Helper is outdated"
  banner.
- **INV-HELPER-004** — A silent early-exit for "already running" must show
  explicit user feedback (a message box) — otherwise re-downloading and
  double-clicking looks like a complete no-op.
- **INV-HELPER-005** — An email `<img>`'s display size must be set via
  literal pixel `width`/`height` HTML attributes, not CSS `style` sizing —
  Outlook's Word-based renderer silently ignores CSS sizing on `<img>`.
- **INV-HELPER-006** — A standing inline attachment (e.g. payment QR
  image) needs `PR_ATTACHMENT_HIDDEN=True` in addition to
  `PR_ATTACH_CONTENT_ID` — content-id alone is insufficient for every mail
  client (Gmail still lists it as a separate download without it).
- **INV-HELPER-007** — Outlook auto-saves a compose window to Drafts
  before explicit save — closing an already-saved item's window only
  closes the window, not the saved copy; this safety net does not apply
  to a genuinely never-saved item.

## Performance (INV-PERF)

- **INV-PERF-001** — Any route/page issuing several (roughly 5+) Supabase
  queries — especially in parallel, where total latency is bounded by the
  slowest one, not summed — should set `export const preferredRegion =
  'sin1'`. Supabase is Tokyo-hosted; a Vercel function with no region pin
  runs in Vercel's default region, meaning every one of those round-trips
  crosses the Pacific for no reason. Confirmed real: Company 360
  (`lib/company-360.ts`, ~11 queries) had no pin at all — only the 5
  TeamWork-scraping cron routes in this codebase set `preferredRegion`
  anywhere, and those pin for latency to TeamWork's own servers, not
  Supabase; every regular user-facing data route, including this one,
  defaulted to the non-Asia region until fixed. *(source: 2026-09-02,
  Vincent: "点进点的速度可以提升吗".)*
- **INV-PERF-002** — Never fire a dependent Supabase query as a separate
  sequential `await` **after** a `Promise.all` batch when it could run
  **inside** that same batch instead — even a query whose filtering logic
  needs another query's result (e.g. "exclude ids already matched
  exactly") can usually still fetch its raw candidate rows in the same
  parallel batch, with the ids-based filtering done afterward as pure
  in-memory computation on already-fetched data. A sequential follow-up
  query adds one full extra network round-trip to every single page load,
  not just the slow path. Confirmed real: `lib/company-360.ts`'s AR/AGM
  fuzzy-match fallback used to fetch its candidates only after the main
  batch resolved — folded into the same `Promise.all` instead. *(source:
  2026-09-02.)*
- **INV-PERF-003** — A server-rendered page (no client-side fetch, so no
  natural "Loading…" state) needs its own `loading.tsx`
  (Next.js App Router's automatic Suspense-boundary convention) or the
  browser shows nothing at all — not even a spinner — for however long
  the server-side data fetch takes. Every other page in this app is
  `'use client'` + `useEffect`, which gets a loading state for free; the
  one server-rendered exception (Company 360) didn't, until this was
  found live. *(source: 2026-09-02, `app/companies/[id]/loading.tsx`.)*
- **INV-PERF-004** — `/api/assistant`'s agentic tool-use loop (up to 4
  rounds, each a full Claude API HTTP call) shares ONE `maxDuration = 60`
  Vercel budget across every round — a query needing several sequential
  tool calls before it can answer can genuinely exceed 60s and 504 with a
  non-JSON body (client sees a generic "网络错误，请重试", not the real
  cause). Confirmed real via a production log: "Vercel Runtime Timeout
  Error: Task timed out after 60 seconds" on POST /api/assistant, traced to
  "今天秘书部做了什么"-style questions needing team_roster (find members)
  THEN team_activity (get everyone's activity) THEN the model
  cross-referencing them itself — 3 full round trips in one request. Two
  fixes, both real causes, not guesses: (1) `team_activity` gained an
  optional `department` parameter so this exact pattern resolves in ONE
  round trip instead of three (see `teamActivityTool` in
  `app/api/assistant/route.ts`); (2) the route had NO `preferredRegion` at
  all (violates INV-PERF-001 above — its tool handlers routinely fire 5+
  Supabase queries per call, `getTeamActivity` alone does 9), added
  `preferredRegion = 'sin1'`. When a NEW multi-tool-call question pattern
  is added, check whether it can be answered in fewer round trips before
  assuming the 60s ceiling (Vercel's max for this plan) is the fix. *(source:
  2026-09-11, Vincent: "然后具体一直显示网络错误", confirmed via a Vercel log
  screenshot.)*

## AI Assistant / chatbot (INV-AI)

- **INV-AI-007** — When a forced-tool-call response asks the model to echo
  back an identifying field alongside generated content (so the real
  caller-supplied data — a URL, a date, anything that must stay factually
  exact — can be re-attached afterward rather than trusted from the
  model's own retyping), key that re-attachment lookup on the field the
  model was told to copy VERBATIM, never on a second field it was free to
  paraphrase. Found and fixed 2026-09-23 building `lib/sg-news-digest.ts`:
  the first version keyed its `byKey` re-derivation map on `` `${source
  name}|${title}` `` — `title` is copied verbatim by instruction, but
  `source` (e.g. "ACRA", "The Straits Times") had no such instruction and
  the model was free to phrase it differently, so any near-miss would
  silently fail the lookup and null out a real `url`/`publishedLabel` with
  no error anywhere — a silent data-loss bug, not a crash. Fixed by keying
  on `title` alone (already the de-dup key one layer up in `app/api/
  sg-news/sync/route.ts`, so collisions across sources are already rare by
  construction). Same root cause class as `lib/reports-narrative.ts`
  pre-computing YoY figures in code instead of asking the model to compute
  them — the fix here is the matching-key version of that same rule:
  never depend on the model reproducing something byte-exact unless the
  prompt actually constrains it to.

- **INV-AI-006** — The automated quality spot-check
  (`lib/ai-quality/review.ts`, `ai_quality_reviews`, `/ai-quality`, item 6 of
  Vincent's "AI Agent/My Tasks 少一些东西" review, 2026-09-22) is a
  BEHAVIORAL judge, not a fact-checker, and this must stay explicit
  everywhere it's described — to Vincent, on the page itself, in any future
  extension. `ai_messages` never persists the raw RESULT a tool call
  returned (only `ai_agent_runs.tool_names`, which tools ran, not what they
  returned), so the judge genuinely cannot verify whether a dollar figure,
  date or name in a reply is factually correct — it only has the reply's own
  text and which tools were called this turn to reason from. Its rubric is
  written to reflect that limit rather than pretend otherwise: it flags a
  denial-of-capability, a specific factual claim asserted from a turn with
  ZERO tools called, wrong-language/non-sequitur replies, and confusing
  action cards — never "this number looks wrong", which it has no way to
  know. A future version that wants real ground-truth checking would need
  the judge to re-run the same tools itself, not just read the transcript —
  a materially bigger feature, not a rubric tweak.

  This is the `ai_feedback` table `scripts/add-ai-conversations.sql`'s own
  header deliberately deferred back on 2026-09-08 ("belong to that
  document's own later phases... have no concrete consumer yet") — named
  `ai_quality_reviews` instead since what it holds is one specific
  automated judge's verdict, not the blueprint's more generic
  user-submitted feedback (thumbs up/down), which remains unbuilt. A human
  verdict (`confirmed_issue`/`false_positive`) is recorded on the SAME row
  the machine's own verdict lives on, never a second row — "does a human
  agree with the machine" must stay attached to the exact verdict it is
  agreeing or disagreeing with. Migration: `scripts/add-ai-quality-
  reviews.sql` (not yet run in production as of this writing — the route
  degrades to a per-candidate error, not a crash, exactly like every other
  optional-migration column in this codebase, see `ai_conversations`' own
  header). Daily cron `0 23 * * *` (`vercel.json`), plus a manual "立即抽查"
  button on `/ai-quality` for an on-demand run. Gated on `account.admin`
  (Vincent-only today), same as `/ai-learning`.

  Same change closed 2 real, unrelated dashboard-visibility gaps found while
  wiring this in: `ai_learning` and the new `ai_quality_review` are both
  valid `AutomationSource` values with real daily crons, but
  `app/api/automation/health/route.ts`'s own `SOURCES` array — which does
  NOT follow the `AutomationSource` union automatically, a gap its own
  comment already warned about — only listed one of them (neither, until
  this change). Both now added.

- **INV-AI-005** — A chat-confirmed write and the SAME business action done
  manually from its own real page must never share one `logActivity()`
  `event_type` string — doing so makes them permanently indistinguishable in
  `user_activity_events`/Activity Insights, which is exactly the "AI
  proposed this vs. a human just did it normally" distinction this table
  exists to be able to answer. Found 2026-09-22 (Vincent's own "AI Agent/My
  Tasks 少一些东西" review, item "AI建议 vs 人工确认没有审计层"):
  `components/assistant/ChatCards.tsx`'s `LateFilingResolveCard` and
  `app/late-filing/page.tsx`'s own manual `resolve()` both logged the
  identical `'late_filing_resolve'` — every one of Late Filing's other 7
  chat-confirmed write cards already used a `chat_`-prefixed name distinct
  from anything a real page logs, so this was the one place the convention
  had quietly lapsed, not a general problem. Renamed to
  `'chat_late_filing_resolve'`. Any NEW chat card added later must pick an
  event_type that cannot collide with what the equivalent real page logs for
  the same action — grep for the exact string first if unsure.

  Same change (INV-AI-005) added `conversationId` to every chat-confirmed
  write's `logActivity()` `detail` (both render sites —
  `app/my-tasks/page.tsx`'s `activeConversationId`,
  `components/AssistantWidget.tsx`'s `conversationId` — now pass it into
  every card: `InvoiceDraftCard`, `LateFilingResolveCard`, `InvoiceEditCard`,
  `PostIncorporateCard`, `ArUpdateCard`, `EmailDraftCard`, `CompanyUpdateCard`,
  `TaoBillingCard`, `SoaCard`, `ListExportCard`), and closed 2 real gaps
  where a chat-confirmed write logged NOTHING at all —
  `InvoiceEditCard`/`preview_invoice_edit` (`PATCH /api/quickbooks/update-
  invoice`) and `PostIncorporateCard`/`preview_post_incorporate` (`POST
  /api/post-incorporate/generate`) previously had no `logActivity` call
  whatsoever, so a chat-confirmed edit or a chat-confirmed Post Incorporate
  generation was invisible to Activity Insights entirely, not just
  unlabeled. `user_activity_events.detail` is free-form JSONB
  (`app/api/activity/log/route.ts`), so this needed no migration.

  **Deliberately NOT covered by this same change**: `InvoiceDraftCard`
  (real QuickBooks invoice creation) and `TaoBillingCard` (real TAO invoice
  creation) don't have a self-contained confirm handler to tag at all — both
  open the SAME shared, reused editor modal
  (`BillingDraftsModal`/`TaoBuilderModal`) the real Billing Drafts/TAO pages
  use for effectively 100% of manual invoicing, which has no chat-origin
  awareness and no success callback to hook. What this change adds for
  those two is only `chat_invoice_draft_opened`/`chat_tao_builder_opened` —
  proof the AI's suggestion was OPENED for review, not proof a real invoice
  was actually generated from it. Making the real generate-success event
  itself distinguishable would mean threading an origin flag into that
  shared, real-money modal — deliberately deferred as its own careful
  change rather than folded in here, given the blast radius (every manual
  invoice too) of touching that specific code path.

- **INV-AI-006** — A NEW AI feature in this app defaults to a direct
  Anthropic call (`app/api/assistant/route.ts`'s claudeAnswer() pattern:
  `x-api-key`/`anthropic-version: 2023-06-01` headers,
  `https://api.anthropic.com/v1/messages`), never `lib/ai/openai.ts`'s
  multi-model path, UNLESS that OpenAI path's production config has been
  freshly confirmed live. Added 2026-09-22 for `lib/reports-narrative.ts`
  (Reports' auto-generated analysis card) — as of the multi-model agent's
  own 2026-09-21 rollout, `docs/CURRENT_STATE.md` already noted "Vincent
  confirmed the production key was saved in Vercel, but a fresh deployment
  is still needed to load it," still unconfirmed the next day. A feature
  meant to reliably show something on every page load cannot depend on a
  still-uncertain second provider — Anthropic is the one path this session
  has real production evidence for (real `ai_agent_runs` rows,
  `primary_provider: "anthropic"`). Once OpenAI's production config is
  confirmed live, a feature like this can gain OpenAI polish the same way
  `lib/ai/orchestrator.ts`'s `synthesizeWithOpenAI()` already does for the
  My Tasks assistant (degrades to the Claude draft unchanged if
  `openAIConfigured()` is false) — without changing its own contract.

- **INV-AI-004** — The reply-scanning safety-net guards (INV-DATA-022/023,
  `mentionsOutstandingBalance`/`claimsPermissionDenied`/
  `claimsNoSoaDownloadTool`, plus the new generic backstop below) must run
  exactly ONCE, on the text actually about to be shown to the user — never
  inside `claudeAnswer()` on its own draft. Found 2026-09-22 while adding the
  4th guard, not from a screenshot: `claudeAnswer()` used to guard its own
  `result.text` before returning it, but `POST()`'s `claude_then_openai`
  route then feeds that ALREADY-guarded text into `synthesizeWithOpenAI()` as
  `claudeDraft` and ships whatever OpenAI rewrites it into, unguarded — a
  real, live gap (not yet observed misfiring, but structurally certain to):
  OpenAI's own "improve clarity" rewrite could smooth away the ⚠️ warning
  banner, or introduce a fresh denial claim of its own that never existed in
  Claude's draft, and neither would ever be caught. Guarding inside
  `claudeAnswer()` also can't simply be left in place alongside a second
  guard pass later — the warning banner's own text contains "欠款", which
  re-matches `mentionsOutstandingBalance` and would double-prepend itself on
  every un-synthesized reply. Fixed by moving the whole guard chain out of
  `claudeAnswer()` (`applyCapabilityGuards()`, `app/api/assistant/route.ts`)
  and calling it exactly once in `POST()` on `draftReply` — whichever text
  that is (Claude's own, or OpenAI's synthesis of it) — using the same
  `toolNames`/`toolEvidence` `claudeAnswer()` already tracks (the two
  boolean flags `claudeAnswer()` used to track locally,
  `outstandingToolCalled`/`crossPersonToolCalled`, are now derived from
  those instead of tracked separately). Any FUTURE reply-scanning guard
  follows the same rule: add it to `applyCapabilityGuards()`, never re-check
  inside `claudeAnswer()`.

  Same change added `claimsGenericCapabilityDenial()` — a structural
  backstop instead of a 4th per-feature regex. The three specific guards
  above each exist because Vincent found one specific false "I can't do X"
  claim, for one specific feature, after the fact; the next NEW false denial
  (for a capability none of the three happen to name) would need the same
  discover-then-patch cycle again. What all three real incidents actually
  had in common wasn't their wording, it was that **zero tools were called
  that turn** before the model asserted it had no way to help. The generic
  guard checks that structural signal instead: a denial-shaped reply
  (reusing the same question/offer-to-check exclusion shapes as
  `mentionsOutstandingBalance`, so a genuine hedge is never flagged) is
  suspicious specifically when `toolNames.length === 0` for the whole turn —
  with 35+ real tools covering nearly everything in this app, a flat "no
  tool/no way/can't do this" on a turn that never even tried one is almost
  always fabricated. Only fires when none of the three specific guards
  already did (`applyCapabilityGuards`' own `flagged` check), so a known
  incident is never double-warned. Verified against all three real
  documented incidents' own wording (would have caught each on this signal
  alone) plus 6 new true/false cases, `test-reply-guards.ts` (`npx tsx
  test-reply-guards.ts`), 20/20 passing; `npx tsc --noEmit` and `npm run
  build` both clean. *(source: 2026-09-22, following up on Vincent's own
  "AI Agent/My Tasks 少一些东西" review of this exact failure family.)*

- **INV-AI-003** — The multi-model My Tasks agent (added 2026-09-21) has
  one final-answer owner and one source of truth for internal facts.
  `lib/ai/orchestrator.ts` may route clearly external/general questions to
  OpenAI, but internal company/staff/task/email/invoice questions remain on
  Claude's established live-data tools. For a complex internal turn,
  Claude resolves tool calls first and OpenAI may only synthesize/review
  that evidence; it must never alter a tool-returned name, amount, date,
  count, permission, status or link. Data-changing actions remain previews
  requiring the user's existing Confirm button. Post Incorporate identity
  intake is never forwarded to OpenAI. Every OpenAI Responses request uses
  `store:false`, and the UI receives one final answer rather than exposing
  two competing model responses. Keep the deterministic internal/mutation
  routing guard even if the learned router is changed later.

- **INV-AI-001** — An Anthropic-hosted SERVER tool (e.g. `web_search`,
  added to `CLAUDE_TOOLS` in `app/api/assistant/route.ts` 2026-09-18) is
  architecturally different from every other entry in that array and needs
  NO dispatch code in `runTool()` — Anthropic executes it server-side as
  part of generating the response, before this route ever sees it. Its
  invocation comes back as a `server_tool_use` content block (already
  resolved into a `web_search_tool_result` block alongside it), never
  `tool_use` — `claudeAnswer()`'s own tool-loop filters `data.content` for
  `b.type === 'tool_use'` specifically to decide what to dispatch, so a
  server tool's blocks simply never match that filter and `runTool()` is
  never called for them; if the model's whole turn only used a server tool
  (no request-response round trip needed), `stop_reason` comes back
  `'end_turn'`, not `'tool_use'`, and the loop already returns the
  synthesized final text as-is, no extra handling required. The one thing
  that DOES matter: `convo.push({ role: 'assistant', content: data.content
  })` must keep pushing the WHOLE content array verbatim (already true,
  unchanged) — it must never be filtered down to just `tool_use`/`text`
  blocks before being pushed back, or a later turn referencing an earlier
  search's results would lose them. Before wiring up dispatch logic for any
  FUTURE Anthropic server tool (code execution, bash, etc.), check whether
  it needs any client-side handling at all — most don't.
- **INV-AI-002** — When this app gains a genuinely new capability on a page
  (a combined/merged view, a new download option, a new action), check
  whether the AI assistant has its own hand-written comment somewhere
  actively saying that capability doesn't exist yet — a stale "not
  supported" note left over from before the feature shipped is a real,
  silent trap, not a harmless leftover. Found live 2026-09-18: `lib/deep-
  links.ts`'s `soaDeepLink()` had an explicit 2026-09-09 comment/type
  restriction saying `qbCompany` "must be... never 'ALL'", accurate on the
  day it was written (the combined Statement was a page with no real
  generatable PDF yet) but never revisited when `app/api/billing/soa/pdf`'s
  own `company=ALL` combined-PDF mode shipped 2026-09-17 (the same session's
  own INV-DOC-012 through 018 work). Confirmed real: a client owing on both
  TAB and TAO, asked the assistant for "All" of it combined into one
  document, got told flatly that no combined PDF exists and to download the
  two books' SOAs separately — wrong, and actively worse than saying
  nothing, since it confidently denied a real, already-shipped feature.
  `checkOutstandingBalance()` (`app/api/assistant/route.ts`) now also
  returns `soa_link_all` (built via the now-widened `soaDeepLink('ALL', …)`)
  whenever a company's `byQbCompany` has 2+ lines, with explicit routing
  guidance (both the tool's own `description` and the static system prompt)
  telling the model to use it for "全部/All/合并/一起" requests instead of
  handing back each book's own link separately. General lesson: a tool-
  routing comment or type restriction written to describe "what's possible
  today" needs the same staleness suspicion as a stale INVARIANTS.md entry
  — grep for a feature's name/page across the assistant's own tool
  descriptions and deep-link helpers whenever it changes, not just its own
  page's code.

  Extended same day: fixing the tool's PROSE reply (above) was not the
  whole gap — Vincent, looking at the actual structured `SoaCard` UI
  underneath that reply: "我要这边多一个All的". The card
  (`components/assistant/ChatCards.tsx`) maps `preview.lines` into one row
  per book with its own download/draft buttons, but had no combined row at
  all — a company owing on 2+ books got a correct combined link in the TEXT
  above the card, then a card below it that still only ever offered
  per-book actions, a real half-fixed gap a text-only check wouldn't have
  caught. Added a highlighted "ALL" row (shown only when
  `preview.lines.length > 1`) reusing the exact same `downloadSoaPdf`/
  `buildSoaDraft` actions the per-book rows call, just passed `'ALL'` —
  both already accept `SoaCompanySelector = QbCompany | 'ALL'` from the
  original combine-books work, so no new plumbing was needed, only wiring
  the UI up to what already existed. Also fixed the card's own "Open in
  SOA" bottom link, which defaulted to `lines[0]`'s single-book page even
  for a multi-book company. General lesson, sharpened: when a capability
  gap is fixed only in a tool's prose/routing layer, check every OTHER
  surface fed by the same preview/result object (a structured card, a
  button row) for the identical stale assumption — they can drift
  independently even when they render from the same data.

  Extended once more, same day: even after the card itself had every real
  option, the model's own TEXT reply for a real 2-book company still said
  "我没法直接帮你下载文件" (I can't directly help you download the file)
  and repeated each book's `soa_link` as bare markdown links — not false,
  but actively undermining a capability that was one real click away on the
  card rendering right below that same reply, since a reader has no way to
  know the sentence right above it is wrong about what chat can do. Root
  cause: `checkOutstandingBalance()`'s own `note` and the static SOA prose
  block both still instructed the model to "present each line's soa_link as
  a real clickable markdown link" — guidance written before the card had
  real inline buttons, never revisited once it did, so the model was doing
  exactly what it was told, just against stale instructions. Rewrote both
  to explicitly forbid repeating the links as text and state plainly that
  the card's buttons genuinely perform the download/draft in one click —
  this app's usual "the user's own click performs the action" rule does NOT
  mean chat is unable to help, and the guidance now says so directly, since
  the model had no way to infer that distinction on its own. Also added
  explicit guidance to ask (one short sentence) which of 2+ books' worth the
  user wants when their own request doesn't already say, rather than
  dumping every option as text — Vincent's own explicit ask ("你应该是问要
  下载哪个"). General lesson, sharpened again: "the data is available to the
  model" and "the model has been told the RIGHT way to present it" are two
  separate facts — a `note`/prompt string written honestly for the
  capability that existed on the day it was written can quietly start
  telling the model to do something WORSE than what later shipped, with no
  error, no stale-comment smell, just steadily suboptimal replies.

  Extended a fourth time, same day, immediately after the round above
  shipped: Vincent tried it live — "这边的还是不完善" — and a real
  conversation showed the FIRST reply now correctly listing the TAB/TAO/All
  choices (that fix genuinely worked), then a SHORT FOLLOW-UP that just
  named which one ("我要下载 All的", no company re-stated, nothing left
  ambiguous) got "抱歉，我这边没有任何工具能直接下载或生成 PDF" — an even
  more absolute false claim than the original bug. Root cause: a terse
  follow-up narrowing an earlier SOA answer reads to the model as answerable
  from conversation memory alone, so `check_outstanding_balance` never gets
  called again for THAT turn, no fresh card attaches, and with no tool
  result in hand the model fabricated a "no tool exists" refusal instead.
  This time fixed with TWO layers, not one, precisely because prompt wording
  alone had already failed to hold once: (1) an explicit HARD RULE added to
  the static prompt — any SOA-related follow-up, even a bare format name
  with no company repeated, must re-call `check_outstanding_balance` every
  time, no exceptions; (2) — the real backstop —
  `claimsNoSoaDownloadTool()`, a new deterministic regex guard in
  `app/api/assistant/route.ts`, same family as the pre-existing
  `mentionsOutstandingBalance`/`claimsPermissionDenied` guards (both born
  from the identical incident shape: the model confidently stating
  something false that a real tool call would have caught). Wired into the
  same `guardedText()` pipeline, reusing the already-tracked
  `outstandingToolCalled` flag — fires whenever a reply flatly denies any
  tool exists to download/generate an SOA PDF while that flag is still
  false, prepending a correction. Verified against the ACTUAL failure text
  from the real screenshot (not invented test strings): both this new false
  claim and the earlier round's own wording are caught, a correctly-behaving
  reply pointing at the real card is not. Caught a real, separate,
  build-breaking mistake while writing this fix: a literal backtick typed
  inside a prompt string that is ITSELF a backtick-delimited template
  literal terminates that outer string early — `npx tsc --noEmit` caught it
  immediately as a syntax error, before it could ship; the fix was to drop
  the inline-code backticks around a bare identifier mentioned in prose,
  matching how every other identifier reference in this same prompt string
  is already written (plain text, never backtick-wrapped, precisely because
  the whole prompt is already one big template literal). Sharpest lesson
  yet: when the SAME class of "the model asserts a false capability denial"
  bug recurs a second time after a prompt-only fix, add the deterministic
  code-level guard immediately rather than trying a third round of prompt
  wording — this codebase already had the right pattern for it
  (`mentionsOutstandingBalance`/`claimsPermissionDenied`), it just hadn't
  been extended to this specific false claim yet.

## SOA Reminder delivery tracking

- **INV-DOC-021** — `email_drafts.status='sent'` alone is not proof that
  Outlook actually sent an SOA Reminder: Delivery History also has a manual
  “Mark as Sent” fallback. Only `outlook_send_verified_at` may advance the
  1st → 2nd → 3rd sequence, and that field is written only after the local
  Draft Helper returns success from Outlook's real `.Send()`. The chosen
  stage and book scope are snapshotted on the draft itself
  (`soa_reminder_stage`, `soa_qb_company`) rather than re-derived later from
  editable template content. An `ALL` send applies to each TAB/TAC/TAO row;
  a book-specific send applies only to that book. Old placeholder templates
  remain in the database for campaign foreign-key history but are hidden;
  the operational SOA template set is exactly 1st/2nd/3rd Reminder.
  The All list groups same-company book rows for display only: each child
  still retains its own scope and status. A mixed group defaults a combined
  draft to the earliest `nextStage` among its sources, preventing an
  unrecorded source from being silently skipped; staff may still explicitly
  select 2nd/3rd when earlier reminders pre-date the system.

## SOA Outstanding shared remarks

- **INV-DATA-025** — SOA Outstanding Remarks are company-level operational
  notes, not book-level notes. One normalized company/customer has exactly
  one `soa_remarks` row shared across All, TAB, TAC and TAO; never add
  `qb_company` to this key or copy the text into each source row. The key is
  normalized customer name rather than `companies.id` because legitimate
  QuickBooks Outstanding customers may not exist in `companies`. In the All
  view, the Remarks UI must visually span the combined parent plus all of its
  expanded source children, while each envelope remains source-specific.
  Multi-source groups start expanded; collapsing one is only a temporary UI
  preference and does not alter balances, reminder stages, owners or remarks.
