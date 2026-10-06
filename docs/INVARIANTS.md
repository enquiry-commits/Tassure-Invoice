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
- **INV-TW-023** — INV-TW-022's UEN fallback assumes an id change means
  TeamWork REISSUED the id (old id gone). TeamWork can also hold TWO LIVE
  records for one UEN at once — a real one (client code + Internal CSS
  Status "Active") and a blank stub (no code, empty status). Confirmed
  2026-09-24 against the real `getCompanies` feed: exactly 3 UENs
  (SHENGYA (SG) 1522 real / 1462 stub, A.I.R. INVESTMENT 1534 / 1468,
  XGC SINGAPORE 978 / YANGGU 976), matching `internal_id_reregistered: 3` in
  every nightly run. With both live, the fallback re-keyed the ONE
  `companies` row between them every night, and both patches landed on it —
  when the stub's blank status won, `tw_status` became null and `is_active`
  false, so a company TeamWork plainly shows as Active appeared under "Inactive
  in TeamWork" on the Active Client page (Shi Ming: "Shengya 为什么会变成
  inactive?"), intermittently. Rule: when 2+ live records share a UEN, only
  the canonical one (`lib/teamwork-duplicate-uen.ts`: has client code, then
  Active, then any status, then higher id) is ever matched or applied; the
  rest are skipped and raised as the `duplicate_uen_in_teamwork` automation
  exception so staff can delete the stub in TeamWork — the sync must be
  correct WITHOUT that cleanup, the exception is hygiene only. The Master
  List page has the mirror-image rule: `app/api/master-list/route.ts` derives
  `is_css_client` / `css_client_inactive` per UEN across ALL its `companies`
  rows (active if ANY row is; inactive only if there are CSS Client rows and
  none is active) — it used to be last-write-wins, so a stale pre-fix
  orphan row (GOLDEN BRIDGE MARTEC's old row 1770) could flip
  a correctly Active UEN to inactive depending on row order. Any per-UEN flag
  computed from `companies` must be order-independent. That one orphan was
  also deleted outright (removed 2026-09-24, Vincent-authorized, backed up
  first, after a sweep of 48 tables found nothing referencing `companies`
  id 1770 via company_id/parent_company_id); the `missing_from_teamwork`
  exception it kept raising closed on the next run. A leftover duplicate row
  is still handled by the order-independent rule above if one ever reappears. *(source: 2026-09-24,
  Vincent: "没有办法彻底的清除这些问题吗？因为TW明明都写道很清楚是Active了".)*
  **Extended by INV-TW-024** (2026-09-28): the "only the real record" rule now
  also covers a stub arriving ALONE and a real record arriving BLANK.
- **INV-TW-024** — Only the REAL TeamWork record may ever change a company's
  status. Two rules, both in `lib/company-lifecycle.ts` and nowhere else:
  (1) a TeamWork "stub" (`isTeamworkStub()`: no client code AND no status —
  TeamWork keeps 254 of them) can never CLAIM a `companies` row through the
  name or UEN healing paths in `app/api/teamwork/sync/route.ts` (INV-TW-022's
  UEN re-key included) — it can only be reported (`stub_record_ignored`);
  (2) `companies.tw_status`/`is_active` change ONLY when TeamWork gives an
  EXPLICIT status (`planCompanyStatusPatch()`): a blank status is "unknown",
  never "not Active" — it can't demote a known status (`blank_status_ignored`)
  and a tracked company TeamWork has never given a status is reported so
  staff complete it (`tracked_record_blank`; 2 today: EVOP (SINGAPORE)
  INTERNATIONAL, flagged "CSS Client" in TeamWork, and WORLD PRECISION
  MACHINERY — both can never get AR generated until TeamWork is completed).
  An explicit Terminated/Striking Off/Struck-Off/… still goes straight
  through. This REPLACES this route's old documented exception "Internal CSS
  Status ... an empty value means Not Specified (therefore not Active)".
  Vincent, 2026-09-28, after XGC SINGAPORE's March 2026 AR cycle vanished
  days before its deadline: "这个是严格不允许发生的问题，只能由真的" — only the
  real record decides. **Why INV-TW-023 alone wasn't enough** (proved by
  replaying XGC's real companies row and its real TeamWork records — real
  978, stub 976 — through the old and new cascade, read-only): INV-TW-023
  closed the case where TeamWork returns BOTH records (and the old code even
  depended on their ORDER — stub last flipped XGC inactive, stub first did
  not), but TWO more paths still hid XGC's AR under the old rule: (a) one
  night where the real record is missing from TeamWork's response and only
  the stub is there — the UEN fallback re-keyed the row onto the stub; (b)
  the real record coming back with a blank status. Under INV-TW-024 all
  three leave XGC Active; a genuine "Terminated" still terminates it.
  Behaviour-neutral on the day it shipped (dry run against live TeamWork:
  0 status writes differ from the old rule, 0 stubs blocked, 0 statuses
  held) — purely preventive. Guards: `test-company-lifecycle.ts` (rules +
  source guards that fail if `teamwork/sync` writes `tw_status`/`is_active`
  any other way, or lets a stub heal-match).

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
- **INV-AR-013** — A reconciliation pass that mirrors one table's state onto
  another (Late Filing → AR Reminder's `⚠ LATE FILING:` marker, via
  `late_filing_companies.mirrored_ar_reminder_id`) must never depend on a
  link column staying populated on the SOURCE side — walk it FROM the
  written-to side (every `ar_reminder` row that currently carries the
  marker) instead, so a missing/never-backfilled link can't hide a stale
  row from ever being revisited. Confirmed live 2026-09-23 on two real
  companies: MITRADE GROUP had been marked `Resolved:` on the Late Filing
  page since 2026-08-21, but its `late_filing_companies.mirrored_ar_
  reminder_id` was `null` (never backfilled — it was Resolved without ever
  passing through the "currently flagged" branch that sets that column), so
  the old forward-only reconciliation (`.not('mirrored_ar_reminder_id',
  'is', null)`) never looked at it — its `ar_reminder` row still showed "⚠
  LATE FILING: Overdue 1678 days" a month later. TAFOS CAPITAL (F.K.A. LWL
  EDUCATION CONSULTANCY) was worse: genuinely `tw_status='Terminated'` with
  no `late_filing_companies` row left at all, yet its `ar_reminder` row
  still carried a stale marker from before it terminated, with nothing in
  the old design able to ever revisit a marker whose source row no longer
  exists. `app/api/late-filing/sync/route.ts`'s reconciliation now queries
  `ar_reminder WHERE remarks ILIKE '%⚠ LATE FILING:%'` directly and, for
  each hit, independently re-derives the correct state (checks `companies`
  first, falls back to `master_list`'s lifecycle category per INV-DATA-030
  for companies removed from `companies` entirely) rather than trusting a
  potentially-stale link — and self-heals that same link column on every
  run it finds out of sync, so a second consumer of it
  (`lib/my-tasks-data.ts`'s own `.not('mirrored_ar_reminder_id', 'is',
  null)` staff-task query) stops silently missing the same rows.
- **INV-AR-014** — Once a company is Terminated/Striking Off (checked
  against `companies.is_active`/`tw_status`, falling back to
  `master_list.list_type` per INV-DATA-030 when the `companies` row is
  gone), any outstanding `⚠ LATE FILING:` marker on its `ar_reminder` rows
  auto-clears — Vincent's own explicit decision, 2026-09-23, made in
  response to the INV-AR-013 bug report (chose "auto-clear" over "leave it
  to staff to type TERMINATED into remarks manually"). This does NOT change
  INV-DATA-014's separate, staff-typed exact-match `TERMINATED`/`STRIKE
  OFF` remarks convention — only the auto-written marker LINE is affected.
- **INV-AR-015** — Clearing the `⚠ LATE FILING:` marker text is NOT the
  same as removing the row from the AR Reminder page — Vincent, immediately
  after INV-AR-014 shipped, pointed at the exact same two companies still
  fully visible as dated rows: "terminated了，就不可能要做AR了" (once
  terminated, there is no AR left to do at all — a terminated company must
  not appear on AR Reminder AT ALL, not just show up unflagged). Confirmed
  root cause: a separate, un-guarded fallback loop in `late-filing/sync`
  (the "manual/legacy" pass, for `late_filing_companies` rows not matched
  to an active company this run) mirrors into `ar_reminder` unconditionally
  — it never checked `Resolved:`/termination status before writing, so it
  could re-introduce a marker on a Terminated or Resolved company on a
  later run even after INV-AR-013's reconciliation cleared it. Fixed by
  adding a THIRD pass, run last: for every UEN confirmed Terminated/
  Striking Off (same `companies`-then-`master_list` lookup as INV-AR-013),
  set `ar_reminder.status = 'Excluded'` on every one of its non-Excluded
  rows — the exact same reversible soft-hide `DELETE /api/ar-reminder`
  already uses for the page's own trash-can button (re-adding the same
  entity/cycle restores it; see that route). Because this pass runs LAST
  and re-queries fresh, it self-corrects even if the legacy loop re-wrote a
  row earlier in the same run — deliberately not also fixing that loop's
  own missing guard, since a last-writer-wins cleanup pass is lower-risk
  than changing an existing loop's conditions. Scoped to exact UEN matches
  only (never the normalized-name fallback used elsewhere in this file) —
  bulk-hiding a row is higher-consequence than clearing a text marker, so
  it only acts where the match is exact.

- **INV-AR-016** — `app/api/late-filing/sync/route.ts`'s termination-exclusion
  pass (INV-AR-015, "once a company is Terminated/Striking Off, exclude its
  `ar_reminder` rows") must decide "is this UEN terminated" through the EXACT
  SAME function the marker-clearing pass just above it uses
  (`isTerminatedCompany()`: a `companies` row, if one exists, always wins;
  `master_list`'s lifecycle category is consulted ONLY when no `companies`
  row exists at all) — never a second, independently-built set. Found
  2026-09-28: a colleague's message relayed by Vincent — "XGC - March 2026,
  missing in AR list...如果有公司AR 跳不出来对我们deadline 影响很大的" (if a
  company's AR doesn't show up it seriously hits our deadline); Vincent:
  "这个情况处理一下". Root cause: `allTerminatedUenKeys` (the set this pass
  actually excludes against) was built as
  `[...terminatedUenKeys, ...terminatedUens]` — an UNCONDITIONAL union of
  companies-confirmed-terminated UENs with EVERY UEN sitting in
  `master_list`'s `terminated`/`strike_off` lists, regardless of whether that
  UEN ALSO has a live, genuinely Active `companies` row. `master_list` can
  and does carry a stale terminated/strike_off row for a company TeamWork
  itself still shows Active — the exact gap INV-DATA-067 records 7 real
  examples of (XSPY, SINGAPORE CHINESE ARTS CENTRE, SATORISYS, HALOFUN,
  ANABLE MANAGEMENT SERVICES, ARK PARTNERS MANAGEMENT, SINO MINING HEAVY
  INDUSTRIES) — every one of those 7 had a real, current AR cycle wrongly
  `Excluded` (invisible on the AR Reminder page) the first night this pass
  ran after being filed there, and will again on every future run until
  their `master_list` entry is corrected, because the code bug — not just
  the stale data — was the thing actually excluding them.
  Confirmed live, 2026-09-28: **14 real `ar_reminder` rows across 11
  companies** wrongly `Excluded` since this pass shipped (audit-confirmed
  `Pending → Excluded`, `changed_by: system:late-filing`): ANABLE MANAGEMENT
  SERVICES, SHENGYA (SG) — also a real INV-TW-023 duplicate-stub victim, its
  `companies.is_active` really was false at the moment of exclusion — A.I.R
  INVESTMENT MANAGEMENT (same), HALOFUN, XSPY, SATORISYS, SINGAPORE CHINESE
  ARTS CENTRE, SINO MINING HEAVY INDUSTRIES (×2 FYE cycles), ARK PARTNERS
  MANAGEMENT (×2 FYE cycles), XGC SINGAPORE (the reported case — also an
  INV-TW-023 victim), plus 2 older ones (MAPLE GROVE CAPITAL VCC, BEAUTY
  ASSET PTE LTD) whose underlying data has since self-corrected. Of these,
  7 still have a wrong `master_list` entry today (the INV-DATA-067 list) —
  WITHOUT this fix they would be re-excluded on the very next run; WITH it,
  once restored, they stay restored regardless of `master_list`, since
  `companies` now always wins whenever a live companies row exists. The other
  5 were only ever excluded because of a since-self-corrected `companies` row
  (INV-TW-023, for SHENGYA/A.I.R/XGC) or older, no-longer-reproducible data —
  the code fix is still required for them going forward, just not visibly
  triggered by today's live data. Separately confirmed CORRECT and
  left untouched: 25 genuinely-terminated rows, plus 3 rows for companies
  TeamWork sync has already removed from `companies` entirely (MIX POINT —
  Liquidation in Progress, ADVANCE BRIGHT GLOBAL, FULLRICH INTERNATIONAL —
  both Struck-Off, INV-AR-013's own cited examples) where the `master_list`
  fallback is exactly correct.
  Fix: `allTerminatedUenKeys` is now the union filtered THROUGH
  `isTerminatedCompany()` (`.filter(uen => isTerminatedCompany(uen, ''))`)
  instead of trusted as-is — one line, reuses the already-correct function
  rather than re-deriving the rule a second time, so the two passes can never
  disagree again. Verified against real production data before shipping (not
  assumed): re-ran both the OLD and NEW set-construction logic against the
  live `companies`/`master_list` tables — the 12 wrongfully-included UENs all
  flip to excluded-from-the-terminated-set under the fix, the 3 genuine
  fallback UENs stay included, confirmed by name/UEN, not just count.
  **Data NOT yet restored as of this writing** — the corrective write
  (flipping the 14 rows' `status` back to `'Pending'`, matching their own
  audit-confirmed prior value, compare-and-swap on `status='Excluded'`) was
  attempted and blocked by the session's permission guard (ad-hoc production
  write); Vincent needs to either approve that specific write or apply it
  himself. The code fix alone stops any NEW row from being wrongly excluded,
  but does nothing for a row already sitting `Excluded` — this class of pass
  is one-directional by design (INV-AR-015) and was never meant to
  self-heal a row it wrongly touched.
  **Lesson**: whenever a pass re-derives "is this thing terminated/inactive"
  a second time anywhere in the same file that already has a correct,
  tested version of that exact check, make the second one CALL the first —
  never trust that a copy will stay in sync, even one written the same day
  as the original (this one was: INV-AR-015 shipped 2026-09-23, and its own
  `allTerminatedUenKeys` diverged from the `isTerminatedCompany()` a few
  lines above it that same commit).
  **Superseded by INV-AR-017** (same day): both passes now call one shared
  `lib/company-lifecycle.ts` index, and wrongly-hidden rows self-restore.

- **INV-AR-017** — Every decision and action that can hide an AR Reminder
  row because a company "looks terminated" goes through
  `lib/company-lifecycle.ts`, with six layers, so no live client's AR can
  silently disappear again — whatever the cause (Vincent, 2026-09-28: "我要一
  个彻底永决后患的彻底的一整套逻辑"). (1) IDENTITY and (2) STATUS WRITES — see
  INV-TW-024. (3) DECISION: `buildLifecycleIndex()` is the ONE definition of
  "terminated" — an explicit, non-Active TeamWork status; blank/null/unknown
  is NEVER terminated (the old copies used `!is_active`, which made "unknown"
  mean "terminated"); several `companies` rows for one UEN count as
  terminated only if ALL of them are, in any order (INV-TW-023's
  order-independence rule); Master List's terminated/strike_off lists only
  when no `companies` row exists (INV-DATA-030, INV-AR-016).
  `app/api/late-filing/sync/route.ts` has no private copy left — both its
  marker pass and its exclusion pass call the index, and a failed
  `companies`/`master_list` read now THROWS instead of letting an empty index
  hand every decision to the Master List fallback. (4) REVERSIBLE ACTION: a
  row this pass hid is auto-restored on the next run once its company is no
  longer terminated, to the EXACT status it had (`planArAutoRestores()`,
  actor `system:late-filing-restore`). Who hid a row is read from
  `ar_reminder_audit` — written by a DB trigger on every update, so no code
  path can skip it — and only the LATEST transition to 'Excluded' by
  `system:late-filing` qualifies: staff trash-can exclusions, INV-AR-001's
  FYE-correction exclusions (`system:teamwork`) and anything without an audit
  trail are never touched (today: 28 system / 19 FYE / 2 script / 1 staff).
  This is what XGC lacked: INV-TW-023 was fixed 2026-09-24, but its
  wrongly-hidden row stayed hidden until 09-28 because the old pass was
  one-directional. (5) CIRCUIT BREAKERS: more than 10 rows to hide
  (`MAX_AUTO_EXCLUSIONS_PER_RUN`) or restore in ONE run does NOTHING and
  raises `ar_mass_exclusion_blocked` / `ar_mass_restore_blocked` on
  Automation Health — the safe failure is "a terminated company's AR stays
  visible a little longer" (staff can still trash rows by hand). The first
  run of INV-AR-015 (2026-09-23 03:53 UTC) hid 12+ rows in one go, the
  wrongful ones among them; it would have been stopped. (6) SAFETY NET:
  every run checks the OUTCOME — any company TeamWork shows Active whose AR
  rows ALL sit Excluded raises `active_company_ar_all_hidden`, whatever the
  mechanism (a future bug, a wrong FYE correction, a mistaken trash click);
  XGC's 2026-09-23 state would have alerted the next morning. Tripwire:
  `test-company-lifecycle.ts` also fails if ANY new code path in `app/`/`lib/`
  writes `status: 'Excluded'` beyond the 3 reviewed ones (AR Reminder trash
  can, `ar-reminder/sync-workflow` FYE correction, this pass) — a new one
  must be checked against these rules before it joins the list.
  Behaviour-neutral on the day it shipped (dry run against the live DB:
  0 UENs change their "terminated" answer, 0 exclusions, 0 restores,
  0 safety-net alerts). **Lesson** (the cluster behind INV-TW-023,
  INV-DATA-067, INV-AR-016 and this entry): every place that re-derived "is
  this company terminated" on its own was a fresh chance to get it wrong, and
  each wrong copy hid real clients' AR. There is now exactly one; add to it,
  never beside it.
  **Extended by INV-AR-018** (same day): the one-definition rule now covers
  every feature's "is this still a client" check, not only AR hiding.

- **INV-AR-018** — "Is this company still a client?" has exactly ONE
  definition, and every feature calls it — none keeps its own (Vincent,
  2026-09-28: "把'这家公司是否终止'这个判断收成唯一一份共享逻辑，所有功能都调用同一份，
  不再各自维护一份自己的判断"). A full audit found the question answered on
  its own in 35 places across 20 files, with THREE different meanings of
  "active": `is_active` alone (913 companies — Address Service, Billing
  compare, Client Comms, Dashboard, Reports…), `is_active AND tw_status NOT IN
  ('Striking Off','Terminated')` (AR Generate, Late Filing sync) and
  exact-case `tw_status = 'Active'` (Billing Drafts, Companies page) — plus
  hand-kept status lists (Dashboard, Late Filing page), two spellings of
  Master List's "ended" categories, and private "is it Active" string tests
  (TeamWork sync's new-company gate, INV-TW-023's duplicate ranking). All now
  import from `lib/company-lifecycle.ts` §7–9: `isActiveStatus()` (the only
  string test), `isActiveCompany()`/`onlyActiveCompanies()` (the active
  roster), `isTeamworkActiveCompany()`/`onlyTeamworkActiveCompanies()` (the
  corporate-secretarial roster — AR Generate, Late Filing sync, Billing
  Drafts and the Companies page share it, so a company that gets an AR cycle
  can't be missing from Billing Drafts), `isActiveCssClient()`,
  `isTrackedByTeamwork()`, `ENDED_MASTER_LIST_TYPES`/`isEndedMasterListType()`,
  `lifecycleVerdict()` (what the assistant and company lookups tell people:
  `system_lifecycle`/`systemLifecycle`) and `statusChartBucket()`; the only
  lifecycle VALUES written outside `planCompanyStatusPatch()` are
  `statusFieldsForNewCompany()` and `NEW_UNTRACKED_CLIENT`. Two real bugs the
  audit found: (a) **SQL NULL trap** — AR Generate's roster excluded the 9
  companies with NO TeamWork status (YHS group, HAN KUN LLP, TASSURE ASIA
  OUTSOURCEZ, SINGAPORE CAMBRIDGE…) only because SQL's `NULL NOT IN (…)` is
  NULL, never true — right by accident; the obvious "simplify it to
  is_active" refactor would have started generating AR for 9 non-TeamWork
  clients (913 vs 904 — caught on real data before shipping). Never express a
  roster as `NOT IN` on a nullable column; say what it INCLUDES. (b) **TAO
  delete guard** — `DELETE /api/billing/tao` refused only when `tw_status`
  was set, so EVOP (SINGAPORE) INTERNATIONAL (TeamWork id 1725, a CSS Client)
  and WORLD PRECISION MACHINERY — TeamWork records with a blank status —
  could be hard-deleted as "untracked", and since those records are stubs
  (INV-TW-024) the sync would never re-create them. "Tracked by TeamWork" is
  now `internal_id` OR a status. Also closed: `companies.is_active` DEFAULTs
  to true, so an insert that omits it puts a company on the active roster —
  `statusFieldsForNewCompany()` always writes BOTH fields; the Late Filing
  page's hide-by-name rule is order-independent ("inactive" only if EVERY
  same-named row is, as INV-TW-023); `teamwork/sync` reports
  `lifecycle_fields_inconsistent` on its end-of-run state, because every
  roster trusts `is_active` alone. Pinned on purpose: hide and restore are
  ONE predicate — a system-hidden AR row comes back once its company is no
  longer PROVEN terminated, not "only once proven Active"; that tightening
  looks safer and is the wrong direction (a stray reminder is visible and
  can be trashed; a vanished one misses a filing deadline). Guard:
  `test-company-lifecycle.ts`'s "one definition" check fails on ANY query
  filter, literal, comparison or status list on `is_active`/`tw_status`,
  TeamWork's status words or the ended Master List categories outside the
  module (Master List status TEXT in `lib/master-list-status.ts` excepted —
  INV-DATA-067), allows raw reads only at 14 reviewed DISPLAY sites (exact
  count per file), and requires the four critical rosters to call
  `onlyTeamworkActiveCompanies()` (a filter that simply vanished would pass a
  "no private copy" check). Negative control: against 5423360 it reports 25
  private copies in 17 files. Behaviour-neutral on real data, by id: AR 904,
  Billing Drafts 794, Companies 904, active roster 913, Address Service 375,
  Late Filing hide-set 39, Master List ended rows 533 — all identical; only
  TAO "tracked" changed (941 → 943, the fix). **Lesson:** need to know if a
  company is active / terminated / tracked? Import it from
  `lib/company-lifecycle.ts`; if the helper you need doesn't exist, add it
  THERE with a test — never a local copy, not even a "harmless" one-liner.

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
  Chinese-text-rendering feature — and as the ONLY layer it silently
  degraded real client PDFs: on 2026-10-05 the SOA cover printed
  思店科技(杭州)有限公司 as "()" and 江苏日月照明电器有限公司 as "(name
  unavailable)", and dropped full-width （）【】 from 11 open-invoice
  descriptions (unbalanced brackets). The SOA WEB page showed both names
  fine — the browser has Chinese fonts — which is exactly why nobody saw
  it: a page rendering Chinese says nothing about the PDF. Since then the
  cover draws Chinese text with the embedded Noto Sans SC
  (`lib/pdf-chinese-text.ts`, shared with the client invoice PDF,
  INV-QB-029; inside the bold TO name its characters are faux bold — fill
  plus a thin outline — the font being Regular only). Text Helvetica prints
  goes through the exact same calls as before (472 real cover pages
  compared old vs new: 458 byte-identical, the other 14 exactly those
  Chinese names/brackets). `safeText()` stays the fallback when the font is
  off, fails to load, or lacks a character too — the Statement never fails
  over it. Guarded by `test-statement-cover-chinese.ts`.
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
  `automation_sync_runs` rows ever recorded. (First seen 2026-08-06:
  `/api/teamwork/sync-secretary`.)
  **Shipped again despite this rule (fixed 2026-10-05).**
  `/api/ai-quality/review` was scheduled `0 23 * * *` on 2026-09-22 and
  never listed, so the nightly AI quality spot-check (INV-AI-006) never ran
  once — and since 2026-09-22 the Automation Health data has shown that
  source as `attention`, with no run ever, without anyone acting on it. A
  session found it on 2026-09-24 and deliberately left it out, to keep a
  paid Anthropic job off until Vincent agreed. **Leaving a path out of
  `CRON_PATHS` is not an off switch**: it looks exactly like this bug, and
  the decision is invisible. Pause a scheduled job by removing its
  `vercel.json` entry or by gating the route itself. Adding a path to
  `CRON_PATHS` is effectively that route's first real deploy, so
  INV-CRON-012 applies: run the migration the route needs before the push
  that lets the cron reach it (without `ai_quality_reviews`, every run would
  have paid to judge every reply, saved nothing, and repeated nightly).
  Enforced by `test-cron-wiring.ts`: every `vercel.json` path is in
  `CRON_PATHS` and every `CRON_PATHS` entry is scheduled, each has a GET
  route, and every `AutomationSource` is on the health panel — a written
  rule alone did not stop the second occurrence.
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
- **INV-CRON-018** — A route that serves BOTH a cron and a browser "run now"
  button must gate the browser case itself. `proxy.ts` only bypasses auth
  for the exact `CRON_SECRET` bearer on a `CRON_PATHS` entry and otherwise
  checks "signed in as ANY approved account" — it never guards API routes
  by permission. `/api/sg-news/sync` (built 2026-09-23 as Vincent-only)
  shipped with no in-route check, so any signed-in staff account could
  start a full run (9 Playwright fetches + Claude calls) just by opening
  the URL, even though the page and the report API were gated. Found
  2026-09-24 by the independent design review of the Quotation work; fixed
  by testing the exact secret (`!!secret && header === \`Bearer ${secret}\``)
  and otherwise requiring the account flag. Do NOT use
  `automationTrigger()` for this: it only tests "has a Bearer header", so a
  made-up `Authorization` header defeats it. Also noted, not fixed here:
  `app/api/reports/narrative-cron/route.ts` compares the header against
  `Bearer ${process.env.CRON_SECRET}` with no truthiness check, which would
  match the literal `Bearer undefined` if the secret were ever unset — left
  to the separate cron-hygiene follow-up along with `ai_quality_review`
  (see `docs/CURRENT_STATE.md`). `/api/ai-quality/review` got its gate on
  2026-10-05 (exact secret, else `account.admin`; `test-ai-quality-judge.ts`
  checks it comes before `withAutomationRun`); `narrative-cron`'s check is
  still open.

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
- **INV-QB-007** — QB invoice-line PIC/Class assignment BY DEFAULT is
  restricted to Secretary and XBRL lines only — Address/AR/ND/Accounts/Tax/
  discounts must never inherit the company PIC/Class when co-billed. TAC/ND
  PIC is carried in the named service-item text, never a QB Class. Since
  2026-10-04 a person may still pick any non-ND line's PIC by hand in the
  Billing Drafts popup's PIC column, exactly like QuickBooks' own per-line
  Class column — a choice, not inheritance (INV-QB-026).
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
  it, not re-derive its own Location-first shortcut. Its same-day tie-break
  (lower QuickBooks Id first) is explicit and deliberate — INV-DATA-066 part 3
  says why and what would move. Both write paths
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
- **INV-QB-019** — **Rewritten 2026-10-06: the CURRENT order is the last
  paragraph of this rule; the text before it is the 2026-09-16 rule it
  replaced (its "same invoice vs different invoice" split is not a
  consistent order).** `lib/invoice-period.ts`'s `compareRenewalPeriodProductLines()`
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

  **Current rule (2026-10-06, Vincent: "按新规则修").** The comparator ranks
  each line on its OWN key — never by comparing two lines' invoices: (1) this
  service's own item (its primary or its deferred product) before any other
  line that merely shares the `service_type`; (2) latest `period_end`;
  (3) primary before deferred on the same `period_end`; (4) newest
  `txn_date`, then `invoice_no`. It is a consistent order, so the result no
  longer depends on the order the rows arrive in. Why the 09-16 rule had to
  go: Elite Gathering's TAB #02611051 held the real address line (to Jun 2027)
  AND a director's residential-address disbursement tagged Address
  ("Reimbursement - OPE", to Aug 2027). "Primary first across invoices" plus
  "latest end within an invoice" formed a cycle, `sort()` put an OLDER
  invoice first, and ADDR read "expired" while paid to Jun 2027 — the draft
  would have re-billed it. The council also showed the 09-16 rule could pick
  an older invoice for the very split-ND case it was written for. Other lines
  are ranked last, never dropped: a client billed only under an unrecognised
  item still gets a period. The overlap check in
  `app/api/quickbooks/create-invoice/route.ts` uses the same function (and
  now passes `txn_date`); its query has no ORDER BY, so before this its answer
  could vary between runs. A read-only before/after of the real `GET
  /api/billing/renewals` over all 796 clients changed 8 tiles: Elite Address
  (expired → active to 2027-06-30); 4 split-ND clients that now read their
  latest invoice (Canvas Logistic, Fuhai International, Asia Connet, Silver
  Zenith — paid through Oct/Nov 2026, previously shown not_found/expired from
  2024–2025, which would have proposed re-billing a paid year); and 3
  pre-filled rates that had taken the wrong line of an old invoice (Ark
  Partners Address 585 → 270 and ND 5000 → 3750; Hai Rui Address 585 → 240 —
  585 was the incorporation fee, 5000 an ND deposit). Pinned by
  `scripts/test-renewal-fee-pairing.mjs` (every input order of Elite, a
  Siehi-shaped split and a CPF case gives one winner; it fails on the old
  comparator) and `scripts/test-invoice-period.mjs`.
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
- **INV-QB-023** — The merged SOA PDF's "Other Adjustments" appended
  summary page (Payment/Journal Entry/Deposit rows with no invoice/credit-
  memo document to merge — added 2026-09-15 specifically per INV-QB-017 so
  the merged PDF's total never went quietly short of the system's own
  figure) was REMOVED 2026-09-23, deliberately, per Vincent's own informed
  choice — this is a KNOWN, ACCEPTED gap, not an oversight or a bug to
  silently "fix" back. He was told directly, before the change, exactly
  what this page existed to prevent (a real ~$38,171.37 discrepancy once
  found this way, see INV-QB-017's own history) and was offered the safer
  alternative — suppress the page only when its subtotal nets to $0, which
  preserves the guarantee for every case that actually matters — but chose
  "完全不生成这页，不管金额" (never generate this page, regardless of
  amount) instead. **Concrete, current consequence**: a customer whose
  Payment/JE/Deposit adjustments do NOT net to exactly $0 will now get a
  merged SOA PDF whose total does not match what the SOA list/detail modal
  shows for them elsewhere in this app — the exact class of discrepancy
  INV-QB-017 was written to close. If this surfaces again as a real
  complaint ("PDF total doesn't match the system"), do not silently
  restore the page — that would contradict this explicit decision; ask
  Vincent to reconfirm first. `INV-QB-017` itself is completely unaffected
  by this change — `loadArAgingSnapshot()`/`AgedReceivableDetail` remains
  the primary total/aging source everywhere else (SOA list, detail modal,
  Excel export, collections email); only this one appended PDF page, for
  non-zero-netting adjustments specifically, lost the guarantee. Removed
  `app/api/billing/soa/pdf/route.ts`'s entire `otherRows`/"Other
  Adjustments" block and its now-unused imports (`StandardFonts`, `rgb`
  from `pdf-lib`; `loadArAgingSnapshot` from `lib/soa-data`; `safeText`
  from `lib/statement-pdf`) rather than leaving dead code disabled in
  place. `npx tsc --noEmit`, `npx eslint`, `npm run build` (cold) all
  clean.
- **INV-QB-024** — Billing System › Quotation (`app/billing/quotation`,
  `lib/quickbooks-estimates.ts`, `lib/quotation-trace.ts`,
  `lib/quotation-data.ts`; Vincent, 2026-09-24, Vincent-only via
  `canViewQuotation`) lists QuickBooks **Estimates** and, once one is
  Closed, shows which book(s) the resulting invoice(s) were issued in. Facts
  confirmed against real data (read live from all three books, not assumed)
  that a future change here must keep true:
  1. **A "Quotation" is the QuickBooks Estimate entity** — "PI" + YY +
     sequence (`PI260067`), one numbering shared across books. Live: 48 of
     50 estimates dated since 2024 are in TAB, 2 in TAO, 0 in TAC. The
     prefix is NOT a reliable filter: 2 of 50 carry no PI number (a Closed
     one numbered like an invoice, `02610474`, and a Pending `260041`) —
     never filter on it.
  2. **`LinkedTxn` (Estimate → Invoice) exists only when both are in the
     SAME company file.** All 39 real Closed estimates carry a same-book link,
     but the invoices Chelsea issued for the same quotation in ANOTHER book
     have no link anywhere in QuickBooks — exactly the case Vincent asked
     the page to trace ("你可以从TAB/TAO/TAC追踪到Chelsea 开在哪个Source").
     Real workflow shape: 18 of the 39 also have invoices in another book
     (16 TAC, 4 TAB, found by name), and for 10 of those 18 the traced
     invoices add up EXACTLY to the quotation total (PI260088 $8,050 = TAB
     $2,000 linked + TAC $6,050 by name).
  3. **The trace** (`traceQuotations()`, pure — no DB/QuickBooks imports,
     covered by `test-quotation-trace.ts`): (a) `quickbooks_link` from
     LinkedTxn for an estimate in ANY status (a link to an invoice missing
     from our synced data is kept as unresolved and still counts as linked
     in the estimate's own book — never dropped); plus (b) `name_match`, for
     CLOSED estimates only: same `normalize()` key on the invoice's customer
     name, not Voided, dated from the quotation date to `TRACE_GRACE_DAYS`
     (7) after the estimate's last update, and not already QuickBooks-linked
     to a different estimate. Exact match only — Vincent declined fuzzy
     candidates. Names differ by case across books (TAB/TAC store UPPERCASE,
     TAO mixed case) so raw equality would be wrong; `normalize()` fixes
     that.
  4. **Why the upper bound**: without one, every later invoice for the same
     customer qualifies — after `PI260067` closed (2026-07-30) Bestar had 4
     unrelated invoices across TAB/TAC/TAO in August; with the bound none of
     them is listed. **Why the numbers are shown, not just the chips**: real
     data has noise the rule cannot tell from signal (PI260068 also matched a
     stray $5.50 TAB invoice; PI260043's own linked TAB invoice already equals
     its total while an unrelated $6,000 TAC invoice also matched by name), so
     each row shows "Traced X vs quotation Y", marks ● (QuickBooks-confirmed)
     vs ○ (matched by name), highlights an amount that equals the quotation,
     and flags a split whose sum equals it — nothing auto-decides which
     candidate belongs. `amountMatches` is `null` (not false) for a non-SGD
     quotation: `quickbooks_invoices` has no currency column (INV-QB-016).
  5. **Known, accepted edges** (Vincent's call, not bugs): a typo'd
     quotation name traces to nothing (`Baolaipo Electrics` vs `Electronics`
     is a real example); `normalize()` merges different-jurisdiction
     same-name companies (2 of 1,326 real invoice-name keys: `Menusifu Sdn.
     Bhd.`/`Pte. Ltd.`, `Spring Mud Pte. Ltd.`/`Limited`); the "closed on"
     date is the estimate's last-updated time, which any later edit moves.
  6. **Read LIVE, not mirrored** (unlike Invoice/CreditMemo): INV-QB-021
     already records Vincent's stance that QuickBooks changes must not wait
     for a daily sync, INV-QB-014 is the precedent for live reads where
     freshness matters, and volume is tiny (~50 estimates). The first
     design was a daily Supabase mirror + cron; an independent design
     review, then this same rule, flipped it — the trace is deliberately
     source-agnostic, so a mirror can be added later without touching it.
     Live-read safeguards that must stay: `qbQuery()` returns `[]` for an
     odd/empty response and returns `COUNT(*)` as a bare number (it reads
     the FIRST key of `QueryResponse`), so `fetchBook()` requires a numeric
     COUNT and refuses a fetch that returns fewer distinct estimates —
     otherwise a Fault-inside-a-200 would render as a confident "this book
     has no quotations"; each book has its own 25s timeout and failure pill
     ("missing ≠ none" is stated on the page); estimates are limited to
     `thisYearSGT()-2` onward because `quickbooks_invoices` only holds that
     window (an older Closed quotation's invoice could not be found and would
     read as a misleading "not found").
  7. **Not done, and how to make it exact**: no PI reference exists anywhere
     in synced invoices (measured: 0 invoice numbers start with PI, 0 line
     descriptions mention a PI number). If cross-book tracing ever needs to
     be exact, the fix is a process rule (write the PI number in the
     invoice's Memo/Private Note) plus syncing that field — not a smarter
     name match. QuickBooks has never delivered an Estimate webhook event
     (only Invoice/Payment/JournalEntry/Deposit/CreditMemo); real-time push
     would need an Intuit-dashboard subscription and is not needed while
     reads are live.
  8. **Who issued a quotation ("Created By", Vincent 2026-10-04: "要多一列
     可以追查是谁开的 Quotation", including ones opened directly in QB).**
     QuickBooks records NO user on an Estimate — confirmed live: `MetaData`
     is only `CreateTime`/`LastUpdatedTime`, no custom fields are enabled
     (`SalesFormsPrefs.UseSalesCustom1-3` all false), no sales-rep field —
     and staff share QuickBooks logins anyway (INV-QB-013), so even
     QuickBooks' own audit log could not tell people apart. The person is
     the **Location** staff choose on the form (`TrackDepartments` is on in
     TAB and TAO, terminology "Location") — 51 of 52 real estimates carry
     one (TAB: Chin Kah Ye 24, Hoo Seng Xin 24, Jenny Lai 1; TAO: Lee Jing
     Fei 2). QuickBooks does NOT force it: `260041` (13 Apr 2026, Yu An
     Logistics) has none. `quotationCreator()` (`lib/quotation-trace.ts`,
     tested in `test-quotation-trace.ts`) resolves, strongest first: this
     system's own record for a quotation made with New Quotation (the
     create route logs a `create_quotation` `user_activity_events` row with
     book + estimate id — the only place that creator is recorded), then
     the Location mapped to the staff member's full name via `qbLocations`
     (TAC uses short forms like "Kah Ye"), else `null` shown as an amber
     "Not set" — never a guess. The fix for "Not set" is choosing a
     Location on that quotation in QuickBooks (the page reads live, so it
     shows up on the next load); making Location mandatory is a QuickBooks
     process rule, not something this app can enforce.
- **INV-QB-025** — `displayInvoiceNo()`'s (`components/billing/
  ExpandedBillingRow.tsx`) leading-prefix strip must cover EVERY book
  `BillingInvoiceReference`'s `company` prop accepts, not just whichever
  ones happened to have a real caller when a prop widening shipped. Found
  live 2026-09-28: `company` was widened `'TAB' | 'TAC'` → the full
  `QbCompany` (adding `'TAO'`) back on 2026-09-16 specifically so a future
  TAO caller could reuse the shared chip — but `displayInvoiceNo()`'s own
  regex was never updated alongside it (`/^(?:TAB|TAC)(?=...)/i`, no TAO),
  a gap invisible until `app/billing/tao/page.tsx`'s "Last TAO Invoice"
  column became the first real TAO caller (2026-09-28, Vincent: "Last TAO
  Invoice 的那个UI也是做成按钮的UI设计" — give it the same button UI as
  TAB/TAC Invoice, switching it from its own local, non-clickable
  `TaoInvoiceRef` to the shared chip). Real TAO `invoice_no` values carry a
  literal "TAO" prefix (e.g. "TAO02660519"), same as TAB's "INV"/TAC's
  "TAC" — without this fix the chip would have rendered a doubled
  "TAO #TAO02660519". Fixed by widening the regex to
  `/^(?:TAB|TAC|TAO)(?=...)/i`. General lesson, same shape as INV-QB-022's
  own: widening a shared component's TYPE (accepting a new value) does not
  automatically widen every OTHER piece of logic that assumes the old,
  narrower set — grep for every regex/switch/lookup keyed on the type
  being widened, not just the one call site prompting the widening.
  `TaoInvoiceRef` (the now-fully-superseded local duplicate) was removed
  entirely rather than left as dead code — confirmed via `grep -rl
  TaoInvoiceRef` it had exactly one real caller, now migrated. `npx tsc
  --noEmit` clean, `npx eslint` clean (pre-existing warnings/errors
  elsewhere in the same 3 files, confirmed unrelated via `git diff`'s own
  line ranges), `npm run build` (cold) clean.
- **INV-QB-026** — An invoice line's PIC is its QuickBooks Class, chosen
  PER LINE, and saving an invoice must never change a line's Class nobody
  touched. All three books track Class per line (`Preferences.
  AccountingInfoPrefs.ClassTrackingPerTxnLine = true`) and staff use it as
  each service's PIC; Vincent, 2026-10-04: "要和QB那样，要有一列是可以选择每个
  服务的PIC的". The Billing Drafts popup has that column: edit mode loads each
  line's live Class (`getLiveInvoice()` → `picClass`); create mode pre-fills
  INV-QB-007's default via the shared `getsDefaultPicClass()` and the SAME
  company-PIC matcher the server uses (`lib/invoice-pic-class.ts`); both
  send `picClassId` per line — absent = the default rule, null = none, an id
  = that Class, checked server-side against the book's live active classes
  (`validateLinePicClasses()`); an unvalidated id throws rather than being
  dropped. Real bug this closed: `update-invoice` rebuilt every line's Class
  from the company's CURRENT PIC on every save (QuickBooks replaces Line
  wholesale) — across 40 real app-created TAB invoices (163 lines) a save
  would have changed 80 line Classes, e.g. #02611099's Secretary line Jenny
  Lai → Lim Hoe Chyi and Deferred lines' Classes dropped; since SOA reads its
  owner from line Classes (INV-QB-013), each such save silently re-attributed
  the client. The same save now keeps 163/163. Class-list facts: TAB holds
  3,208 Classes (mostly one-off numeric references from 2025), so read them
  with `listActiveClasses()` (ORDERBY Id, every page, 10-minute cache) —
  never one 1,000-row page. Since 2026-01-01 every TAB line Class is a full
  staff name ("Ang Shi Ming"); the 2025 initials ("JL", "ASM") are not
  offered (`isStaffClassName()`), but a line that still carries one keeps it
  ("JL (current)"). TAO builder (`app/billing/tao`, same day — Vincent:
  "尽量还原QB本来有的设定"): QuickBooks' own TAO conventions are restored,
  read from the 60 latest hand-made TAO invoices — a Class on 100% of
  Accounts/Tax lines and 0% of disbursement/OPE lines, the operator's
  Location on 60/60, a Statement memo (PrivateNote) on 60/60. Each line
  starts with the Class its client's last line of the SAME item had, else
  the client's latest Class for that service, disbursements none
  (`taoDefaultPicName()`); the invoice carries the operator's TAO Location
  (`qbLocations.TAO` — every account named like one of TAO's 17 staff
  Locations, all 15 verified live) and a Statement memo written from its
  lines (INV-QB-027 — carrying the last memo forward was tried the same day
  and dropped: wrong most of the time).
  Across 470 TAO clients billed in 2026 the restored PIC equals
  QuickBooks' own last PIC on 1,290/1,290 rows. The old TAO builder note
  "TAO invoices never carry one" was wrong.
- **INV-QB-027** — Every invoice this app generates carries QuickBooks'
  Statement memo (PrivateNote), written AUTOMATICALLY from the lines being
  invoiced the way staff already write it — no memo field, never left for
  someone to type in afterwards, never rewritten on an edit. What it is:
  QuickBooks' "Message displayed on statement" — not printed on the
  invoice; it labels the invoice in QuickBooks' lists and on customer
  statements. Real data (2026-10-04): every app-created invoice had its
  memo typed in by hand afterwards (60/60 TAB, 20/20 TAC) and every TAO
  invoice since Jan 2026 carries one (784/784). Vincent: "只做 Statement
  memo", then, the same day, "自动就好了，也不需要特地多一个东西显示这个Memo"
  — so Generate composes it and nothing shows it (`lib/statement-memo.ts`).
  TAB/TAC, `composeStatementMemo()`: "Sec,addrs (Apr 2026 - Mar 2027),AR
  31.08.2026", "Sec (Oct 2026 - Sep 2027),AR,XBRL 31.12.2026", "XBRL", TAC
  "ND (Aug 2026 - Jul 2027)" — identical to what staff typed on 86 of 99
  real app-created TAB invoices and 20/20 TAC; the other 13 are staff slips
  (impossible dates like "AR 31.6.2026", a missing month, an addrs/XBRL
  left out although it IS on the invoice) — don't bend the composer toward
  them. Non-obvious: a service billed in advance sits on QuickBooks'
  "Deferred Revenue - Corp Sec / Reg Addr" item WITH its full description
  (#02611068's only secretarial line) — that counts as Sec/addrs; only the
  EMPTY deferred twin and discounts are never mentioned. TAO,
  `composeTaoStatementMemo()`: each service in the wording staff use most
  for it, in the order they always list them (accounts, report, tax —
  260/260 real multi-service memos, whatever order the lines are in), the
  YA as the line states it — "Yearly accounting services,Compilation
  report,Tax YA 2027"; OPE/discounts unnamed. Never reuse the client's LAST
  TAO memo: staff word TAO memos inconsistently ("Quarterly acc" /
  "quarterly account & GST" / "Quarterly accounting services"), so the last
  memo, even year-rolled, was right on only 36 of 112 repeat invoices with
  identical items and 0 of 214 when the items changed — sent unseen, it
  would mislabel most invoices (it was the first TAO design, replaced the
  same day). On the 784 real 2026 TAO invoices the composed memo states the
  same YA as staff's on 425/428 (the other 3: staff typed last year's YA,
  or "YA2025 & 2026"), is word-for-word staff's on 362, and otherwise
  differs only in staff's own wording. `update-invoice` sends no
  PrivateNote, so editing an invoice leaves its memo exactly as QuickBooks
  has it. The "Print later" flag (PrintStatus NeedToPrint on 59/60
  app-created TAB invoices, which staff leave unset) was deliberately left
  as it is — Vincent chose the memo only, after hearing it changes nothing
  a client sees.
- **INV-QB-028** — Opening a QuickBooks book to someone (a page they can
  generate invoices from) must come with that book's Location for them
  whenever QuickBooks already has one in their name — `qbLocations` in
  lib/approved-accounts.ts is separate config that nothing else updates,
  and a Location is invisible in the app, so a miss shows up only as
  invoices with no "who keyed it" tag (INV-QB-013). Found 2026-10-04, hours
  after the department split (INV-DATA-069) opened TAB/TAC Billing Drafts
  to TCS ACCOUNT/TAX: their TAO Locations had been mapped that morning when
  TAO was their only book, the split changed only page access, and the gap
  was written up as a "Watch" instead of fixed — Vincent: "这个要全部开放啊
  为什么只设TAO". Read live (read-only): TAB's 17 active Locations are
  the same staff full names as TAO's, including all 8 ACCOUNT/TAX staff and
  Tan Yee Soon — never used on any of 4,499 synced TAB invoices — so all 9
  were mapped (no QuickBooks write; caught before any of them generated an
  invoice). TAC has only 8 Locations (Chelsea Ang, Esther Loo, Jenny Lai,
  Kah Ye, Lim Hoe Chyi, Seng Xin, Shemin, Shi Ming): giving anyone else a
  TAC Location means CREATING it in QuickBooks, and two traps make that
  Vincent's decision, not a mapping (4-agent council review, each claim
  re-checked in code): (1) create-invoice refuses an invoice whose
  configured Location QuickBooks doesn't have ("Location not found"), so
  mapping before creating breaks every TAC invoice for that person — and a
  Billing Drafts Generate that writes both books would land half done;
  (2) TAC has no team filter in `lib/soa-owner.ts` (INV-PIC-007) and the
  app's TAC invoices are ND-only lines that carry no Class, so the keyer's
  Location IS the SOA owner fallback — a new TAC Location would quietly
  move those clients' collection owner (and My Tasks SOA rows) to whoever
  keyed the invoice, and the daily soa-owners audit skips TAC. If ever
  created, use full names: short ones like "Jing Fei" don't resolve to a
  staff member. Vincent, told both traps, chose not to create TAC Locations
  for ACCOUNT/TAX for now (nor any Location for Tan Min Quan, who has none
  in any book). On TAB the same fallback is harmless — TAB only accepts
  Corporate Secretarial owners, so ACCOUNT/TAX/Partners Locations are
  filtered out. `test-invoice-pic-class.ts` pins each book's live Location
  list and fails if (a) someone who can bill in a book lacks the Location
  QuickBooks has in their name, or (b) a configured Location doesn't exist
  in that book (negative controls: dropping Jay's TAB entry fails (a);
  mapping a TAC one for him fails (b)). Re-read the lists from QuickBooks
  when a Location is added, renamed or deactivated.
- **INV-QB-029** — What a client sees shows each service ONCE, at the price
  on the invoice. Splitting a fee into this-year + "Deferred Revenue" lines
  is internal bookkeeping and must never reach a client. Vincent, 2026-10-05,
  after confirming with Chelsea (a client asked about TAB #02610986, Novozee:
  address 180 + 180, payroll 300 + 300): "服务是不能分开两个显示的，要按照原装
  的INVOICE 金额显示…同一个服务不需要让客户知道我们把金额分成两份记录，那个是
  我们公司内部的操作，不然客户会疑惑". **The split itself STAYS — it is
  accounting's, not the system's.** Vincent, same day, correcting an earlier
  reading (that invoices would stop being split and the deferral move to a
  journal entry — wrong; nothing was changed in QuickBooks on that basis):
  "那个后续拆开两行是必然的，这个是后续Chelsea 会做的东西，而系统不需要管这些拆开
  两行的情况，系统只需要记得原本的金额就对了…主要是要给客户看到的是完整的金额
  就好，不能显示两行的金额情况给客户知道，尤其是在Email Drafts, SOA 也是一样" and
  "分开只是chelsea 为了公司的记账要求做的额外的多余操作，不是要你记录在系统的
  数据，这个操作本身和系统没有关系的". So: never edit, merge or "fix" the split
  in QuickBooks, never ask accounting to stop it, never record it as system
  data; the SYSTEM must present each service once at its full amount
  (service line + its deferred twin) in everything a client receives —
  Email Drafts attachments and the SOA above all. Facts behind
  it (read-only, same day): this system never split a line —
  create-invoice refuses any line without a description
  (`app/api/quickbooks/create-invoice/route.ts:363`), while the deferred
  twins have none; they were added in QuickBooks afterwards (Novozee was
  generated at S$1,120 — QuickBooks now S$1,720, split 350+350 / 180+180 /
  60 / 300+300 with Payroll added there). Clients see them because
  QuickBooks' own invoice PDF prints every line, and that PDF is what AR
  emails attach and what the SOA PDF appends
  (`app/api/billing/soa/pdf/route.ts` fetchInvoicePdf). In 2026, 438 invoices
  carry a blank deferred line (TAB 372, TAC 66; 122 of them generated here,
  split later); 154 open invoices carry a deferred line. The deferred items
  post to LIABILITY accounts (Deferred Revenue:…), reversed by accounting's
  half-yearly reclassification JVs (JV26-105, JV26-177) — one more reason the
  invoice lines are accounting's and never the system's to change. The
  renewal-fee logic already reads the original amount back from the split
  (`buildAnnualRenewalFeeMap`, lib/invoice-period.ts: 350 + deferred 350 =
  700, the same as an unsplit 700).

  Extended 2026-10-05 (Vincent, on 1X EXCHANGE TAB #02611112 showing
  Secretary 175 + Deferred 525 in Billing Drafts' editor: "这些还没有合并好
  吗？" … "在编辑页面显示 Secretary 服务 700 就可以了" … "Deferred部分 是只需
  要存在于QB的，而系统要显示的是 服务部分+Deferred部分的金额总额，而不需要多一
  行显示Deferred部分"; and on first sends: Chelsea splits only AFTER the
  invoice has gone to the client, so the first copy is never split). The
  system's own screens show each service ONCE too, not only what clients
  receive. ONE pairing rule serves every surface — `lib/deferred-pairing.ts`
  (pure; `test-deferred-pairing.ts`): a twin joins the one service line of
  its item FAMILY anywhere on the invoice (Corp Sec → Corporate
  Secretarial, Reg Addr → Registered Address, ND by director initials,
  Payroll, CPF; the nearest one above if there are several), never by
  position or equal amounts (2026: 56 twins are the invoice's first line, 23
  follow another twin, 3 sit under an unrelated line; halves equal in only
  124 of 657 pairs). A twin whose description is text its service line does
  not contain (Anmed TAC #02680138: service "Apr 2026 - Dec 2026", twin "Jan
  2027 - Mar 2027"), a twin with no service line (Helder Trading TAB
  #02610936), an unknown deferred item or a quantity other than 1 is NOT
  folded: that invoice is shown as QuickBooks has it, the twin read-only,
  with the reason (Vincent: fall back to QuickBooks' version and tell staff).
  Census over all 526 split invoices of 2026 (read-only): 507 fold, totals
  unchanged on every one; the 19 that don't are all paid. Saving from the
  editor writes QuickBooks' real lines back: the service line (with the
  edited description/PIC) plus its twin(s) exactly as they were; a changed
  amount moves onto the service line only (700 → 800 = 275 + 525) and
  Chelsea re-splits in QuickBooks ("这个你不需要操心，Chelsea 会自己到QB额外修
  改"); an amount at or below the deferred part is refused.

  The invoice PDF CLIENTS receive (built 2026-10-05, same rule): Email
  Drafts attachments and Billing Drafts' Save PDF go through
  `/api/billing/client-invoice-pdf`, the SOA PDF through the same
  `lib/client-invoice-pdf.ts` `getClientInvoicePdf()`; staff-only invoice
  chips keep QuickBooks' original. An invoice with no deferred line is
  QuickBooks' own PDF untouched. A split one is DRAWN (pdf-lib,
  `lib/client-invoice-render.ts`) in QuickBooks' own layout — US Letter,
  positions/sizes/colours measured on real TAB #02610986 and TAC #02680320
  — from `lib/client-invoice-model.ts`'s rows; the letterhead (Chinese
  company name), the service banner and the PayNow QR are PIXEL crops of
  QuickBooks' PDF (`scripts/extract-client-invoice-assets.py` →
  `templates/client-invoice/`), never copied PDF content, so no text of the
  sample invoice can ride along hidden; the QR is identical across invoices
  of a book (checked: carries no amount). Bank details are real text. The
  printed total must equal QuickBooks' TotalAmt to the cent. Chinese text
  (client names, full-width （）【】 in descriptions) is drawn character by
  character in an embedded Noto Sans SC subset
  (`templates/client-invoice/NotoSansSC-Regular.ttf`, OFL; Vincent approved
  the download 2026-10-05, "加，允许下载"); every other character stays
  Helvetica. Anything not exactly drawable — an unpaired twin, a
  discount/group/text line, tax, non-SGD, unreadable terms, totals off by a
  cent, a character NEITHER font has (e.g. Thai) — sends QuickBooks' own PDF
  and TELLS staff why (Email Drafts: a note under the attachment; Save PDF:
  the result message; SOA: an alert that now also reports invoices that
  failed to merge, `X-Soa-Merge-Errors`, which no page used to read). Two
  pdf-lib traps — handled once, in `lib/pdf-chinese-text.ts`, which the SOA
  cover page shares (INV-DOC-011) — both caught by looking at real renders
  before the font shipped and both guarded in
  `test-client-invoice-model.ts`: (a) its
  subsetter writes SHORT (halved) glyph offsets, so a TrueType file with
  odd-length glyph data embeds corrupted characters while the page still
  "renders" — fontTools' instancer saved exactly such a file (15,684 of
  31,036 offsets odd) and most letters of a mixed line came out blank or
  wrong; the shipped font is re-saved with every glyph padded to 4 bytes,
  and the test compares each embedded glyph with the original outline of the
  character the PDF's ToUnicode map names (a page count proves nothing);
  (b) its Helvetica `widthOfTextAtSize` subtracts kerning that `drawText`
  never applies, so text placed after a Helvetica run overlapped it (】 3pt
  into "Ltd.") — positions now use the sum of character widths (digits have
  no kerning pairs, so amounts didn't move; of the 138 invoices drawn
  before, 137 have byte-identical page content and 1 wraps one word earlier,
  same line count). Render census over the 154 open split invoices
  (read-only, synced lines): 152 drawn (132 one page, 20 two), 2 model
  fallbacks, 0 refused. BILL TO lines WRAP at 355pt (the invoice facts start
  at x=407.8), like QuickBooks' own template: the first live version drew
  every line unwrapped, and TAC #02680202's real BillAddr — the whole
  address in ONE `Line1`, which QuickBooks data commonly has — ran straight
  through the DATE / DUE DATE column and off the page margin. Found
  2026-10-06 by rendering a LIVE invoice (read-only QuickBooks query, token
  not refreshed): the census above could not see it because synced rows
  carry no BillAddr, and the three real PDFs compared by eye had short
  addresses. A census of a drawing rule needs the live field that drives
  it. Open split invoices affected: TAC 1 of 24 (#02680202); TAB's 130 can
  only be measured live once TAB's token is fresh. Per-book switch
  `CLIENT_INVOICE_PDF_MODE`: TAB and TAC
  'live' since 2026-10-05 (Vincent approved real samples side by side —
  1X EXCHANGE TAB #02611112, Advance CF TAC #02680320); set a book back to
  'off' to send QuickBooks' PDF again.
- **INV-QB-031** — Billing Drafts' invoice editor saves by REPLACING the
  QuickBooks invoice's whole Line list (`app/api/quickbooks/update-invoice`
  sparse update, `Line` sent in full), so any line the editor drops or can't
  carry is deleted from QuickBooks without anyone choosing to. Three real
  ways it did that, found 2026-10-05 while folding deferred twins (council
  review, each claim re-checked in code and data): (1) the route refused any
  line without a description, and 637 of 2026's 736 deferred twins have none
  — so a split invoice could not be saved at all, and the natural workaround
  (untick or delete the blank row) deleted accounting's line (Novozee: 1,720
  → 890). Now a deferred item may be blank, and an unpaired twin is
  read-only in the editor. (2) Loaded lines were filed by SERVICE (ND → the
  TAC table), so ND fees billed on a TAB invoice ("Nominee Director Fees -
  WW" + "Deferred Revenue - ND - WW" — 62 such TAB twins on record; TAC's
  own twins are "Deferred - ND Fees - XX" and were filed correctly) showed
  under TAC, and a TAB save deleted the ND line. Now a loaded line stays
  with the invoice it came from (`bookOf()`); only new draft lines use the
  service rule. (3) The editor reads item lines only
  (`lib/quickbooks-invoice-lines.ts` `getLiveInvoice`), so a QuickBooks
  discount, group or text-only line would have been deleted by any save —
  the route now refuses to save an invoice that has one ("Edit it in
  QuickBooks"). Whether (1)–(3) ever actually removed a line from a real
  invoice was not checked. Rule: anything that writes an invoice's Line
  list must write back every line it read, untouched unless a person
  changed it — or refuse.
- **INV-QB-030** — A QuickBooks invoice is (book, QuickBooks Id); its
  number and total are only its CURRENT values. `generated_invoices` logs
  the number and total at creation and nothing ever updates them, so
  anything that SHOWS or SENDS a generated invoice must read QuickBooks'
  current number and total by Id (`lib/current-invoice-values.ts`
  `loadCurrentQbValues` + `withCurrentQbValues`, from the synced
  `quickbooks_invoices` mirror) — and the log itself is never rewritten.
  Found 2026-10-05 (colleague via Vincent: "inv number qb 改了system 没有同步";
  4-agent council review, each claim re-checked): 1X EXCHANGE was generated
  01/10 as TAB #02611111 while Nucon's invoice keyed straight into QuickBooks
  got #02611111 in the same seconds; staff renumbered 1X's to #02611112 in
  QuickBooks, but Billing Drafts kept showing #02611111 — and its invoice
  chip, which opened PDFs by NUMBER, opened Nucon's invoice. Of 128 app-made
  invoices with an Id, 1 number and 7 totals had changed in QuickBooks (e.g.
  Novozee logged S$1,120, QuickBooks S$1,720). Rules now: (1) Billing Drafts,
  the AR email invoice list, AR Reminder and Company 360 overlay current
  values; (2) a generated invoice's chip opens by QuickBooks Id, and opening
  by number refuses (409) when two QuickBooks invoices share the number
  instead of taking the first; (3) the pre-send check refreshes the number
  as well as the amount, and no send path skips it any more (Quick Draft
  and the assistant's drafts used to, on the false premise that figures
  read from `generated_invoices` were "seconds old"); attachment names
  follow the refreshed number; (4) the last duplicate-number check before a
  create FAILS CLOSED — a QuickBooks error or no answer stops the create
  ("unknown" used to read as "unused", INV-QB-005's gap) — and after a
  create a same-number invoice is reported to the person. QuickBooks itself
  doesn't stop a duplicate keyed by hand, so a race in the same seconds can
  still happen; the nightly sync's duplicate-number exception and the
  post-create warning surface it. Verified on live data (read-only) through
  the changed code: Billing Drafts → 1X #02611112, Novozee S$1,720, KINPLUS
  S$1,220, ADVANCE CF S$1,070; the duplicate check answers exists / unused /
  unknown (refused token). `test-current-invoice-values.ts` pins the rules.

- **INV-QB-032** — The TAO builder offers QuickBooks TAO's OWN item list:
  every active Service item, the 5 categories plus the no-category ones
  ("No category": Discount Given, Sales, Contra, Company XBRL Fees, Corporate
  Secretary Services, …), and a new line starts with the item's own
  QuickBooks description, word for word. Found 2026-10-05: Jay opened the
  TAO builder for Partical Investment, then keyed #02660764 straight into
  QuickBooks — the builder only kept SubItems of the 5 categories (113 of
  129; Discount Given, used on 29 TAO invoices this year, was one of the 16
  left out, 58 of 786 invoices needed one), and filled a new line with the
  item NAME although QuickBooks returns its description (95 of 113 have
  one). Vincent (AskUserQuestion, after a 4-agent council review): "全部，和
  QuickBooks 一样", "照 QuickBooks 原文" (no year rolled to the client's FYE),
  and TAO skips the TAB/TAC renewal-period check — "TAO 不做这个检查": its 59
  Secretary-category services (Admin Fee, EP application, Change of
  Director…) are one-off work and were blocked whenever the text stated no
  "Mon YYYY - Mon YYYY" period. Also fixed: "Custom / Other…" shared the
  category "Other" with QuickBooks' real Other items once the list went live
  (10-04), so choosing it added "Other:ACRA Fees" (no invoice affected
  yet); a failed QuickBooks read now shows an error and hides "Add New
  Service" instead of silently offering only Custom; the shared item map
  reads 1000 items, not 200 (past 200 a line fell back to a keyword guess).
  No-category items count as service "Other" (no PIC required). Unit prices
  are NOT prefilled (pricing — needs Vincent). `test-tao-catalog.ts`.

- **INV-QB-033** — A TAB/TAC/quotation line's QuickBooks item is resolved
  EXACTLY or the write stops; and only real RENEWAL items get the period
  check. Found 2026-10-05 (Vincent: "我也担心TAB的服务不全面和描述被简化了";
  4-agent council review, each claim re-checked): (1) `buildInvoiceLineArray`
  fell back to `pickItem` — a keyword guess, else the book's FIRST item —
  whenever a named item wasn't found, and `getItemMap` returned an empty map
  when QuickBooks didn't answer (whole invoice on one item); 9 Billing Drafts
  catalog names (TAB names, e.g. "Secretary:CPF Submission Services") have
  no TAC twin, reachable from the Quotation page; editing re-looked every
  line up by name. Now a named item not found in THIS book, or an unreadable
  item list, throws `QbItemLookupError` before anything is written (create,
  update, quotation answer with a plain error); a loaded line keeps its
  QuickBooks item Id (`itemId`, `getLiveInvoice` → editor → update) and is
  never re-looked up; only a line naming no item keeps the per-service
  default. (2) the period check ran on every Secretary/Address/ND line, so
  ~25 one-off Billing Drafts items (Change of Director, Strike Off, CTC,
  Shares Transfer…) and ND Deposit were hard-blocked unless the text stated
  "Mon YYYY - Mon YYYY" — the reason a short catalog label never reached a
  real invoice (0 of 425 TAB, 0 of 40 TAC lines). Now `needsRenewalPeriodCheck`
  (lib/invoice-period.ts, used by the screen AND create-invoice) checks only
  the renewal items — corporate secretarial retainer, registered address,
  nominee director fees (`classifyRenewalFeeProduct` primary). Vincent:
  "拦下并说明原因", "只检查真正的续费项目". `test-item-resolution.ts`.

- **INV-QB-034** — Billing Drafts' "Add line" offers the book's LIVE
  QuickBooks item list (TAB 169, TAC 127 today — every active Service item
  except accounting's Deferred twins, INV-QB-029), grouped like QuickBooks;
  a picked item brings its QuickBooks description and NO price (staff type
  it; Generate/Save wait for it). Replaced the hardcoded 61-item QB_CATALOG
  (TAB names, shared with TAC, short labels, stale median prices such as
  466.67 vs 525 for the same retainer) that left out items on 401 of 1,284
  TAB and 164 of 329 TAC invoices this year and lacked ND "- EL" / "- LXM.".
  Vincent, 2026-10-05: "和 QuickBooks 一样，全部列出", "不预填，和 TAO 一样".
  The item → draft service mapping is ONE pure rule, `classifyCatalogItem`
  (lib/qb-item-classify.ts) — never the QuickBooks category, because service
  drives the default PIC, the renewal-period check, AR/XBRL memo wording and
  ND handling: renewal items keep Secretary/Address/ND, XBRL, the AR
  government fee → AR, Secretary:ACRA Fees and all disbursements → Other
  (no PIC), Discount → Discount, Accounts/Tax by prefix, other Secretary:*
  one-off work → Secretary. A line added from a book's list stays in that
  book (`book`). Verified live (read-only): every offered item resolves
  exactly when generating (0 unresolved in both books). Not changed: renewal
  rows' templates and per-client prices, the Quotation page's list.
  `test-book-catalog.ts`.
- **INV-QB-035** — An AR/annual line's FYE marker can be typed by hand in
  QuickBooks as "FYE 31/08/2026" (slashes), not only as the "31.08.2026" this
  system writes. Billing Drafts decides "already invoiced this cycle" from
  that marker (`billedCycles` in `app/api/billing/renewals/route.ts`; the
  line's `fye_date` column is often empty). So a slashed marker left a fully
  invoiced client showing "To invoice": Elite Gathering, TAB #02611051
  (2026-09-14), found 2026-10-05 from a staff remark "AR ?".
  `fyeCycleFromDescription()` (`lib/invoice-period.ts`) now reads both forms.
  A slashed date counts only right after "FYE" or "AR", so an unrelated
  date (a filing date) can't mark a cycle as billed. A read-only before/after
  run of the real route over all 796 Billing Drafts clients: exactly 2
  clients gained a cycle (Elite Gathering 31.08.2026, Co-operate Associates
  31.01.2023), none lost one, and no renewal status changed.
- **INV-QB-036** — Every invoice this app creates carries QuickBooks' own
  PDF of itself as an ATTACHMENT on the invoice in QuickBooks, attached
  automatically and kept equal to the invoice while it is edited before
  sending (`lib/quickbooks-attachments.ts` decisions + wire formats,
  `-http.ts` the HTTP side, `lib/quickbooks-invoice-copy.ts` token, switch
  and file name; called by `create-invoice` as 'create' and `update-invoice`
  as 'refresh'). Why: accounting's rule, written on the invoice edit screen
  on 2026-10-06 — "From now onwards, kindly attached the invoice copy as
  attachment here." — because Chelsea splits an invoice's lines AFTER it has
  gone to the client (INV-QB-029), after which QuickBooks prints only the
  split version; the copy attached at creation is the one the client first
  received. Staff had started attaching by hand that day, naming the file the
  way "Save PDF" does (`INV02611137-Cleanwell Technology Pte. Ltd.-S$1776.50.pdf`);
  the system uses the same name (`invoicePdfFileName`). Vincent asked for it
  ("每次在系统开了INVOICE 后，自动添加到 QB对应的 INVOICE (Attachments)") and
  chose all three books, replacement after an edit, and a real-invoice test
  first. Rules: (1) QuickBooks' OWN PDF — not the redrawn client version
  (INV-QB-029); (2) best effort: the invoice exists whatever happens, so a
  failure is a warning shown beside it (`copyWarnings` / `copyWarning`),
  never an error and never a rollback; (3) the system recognises its own file
  by the note "Invoice copy attached automatically by the Tassure system" —
  ONLY files carrying it are ever replaced or deleted, a file attached by
  hand is never touched, and the system adds none next to one; (4) 'create'
  attaches once (a replayed request is harmless), 'refresh' uploads the new
  copy FIRST and removes the old one after, so a failure never leaves an
  invoice without a copy; (5) `IncludeOnSend` is false — QuickBooks must not
  mail it; (6) all three books are live (`INVOICE_COPY_ATTACHMENT_MODE`), no
  backfill ("from now onwards"): an invoice accounting has already split
  (e.g. #02611099) would get the SPLIT version, which is not what the client
  received; (7) an invoice accounting has already split is NEVER attached to
  and its earlier copy is NEVER replaced (`splitByAccounting`; update-invoice
  reads it from the live lines before the edit): QuickBooks would print the
  split version, and the refresh would overwrite the original made before the
  split — the very thing the copy is for. Found the day it shipped, when
  Vincent said the point is that the system can later find the original,
  unsplit invoice in QuickBooks (for the SOA and email attachments, instead of
  redrawing it, INV-QB-029). Verified on a real invoice, TAB #02611136, 2026-10-06, with
  Vincent's approval: ONE multipart request (`file_metadata_01` JSON linking
  to the invoice Id + `file_content_01`) is enough; QuickBooks answers HTTP
  200 even when it refuses a file (the refusal is a `Fault` inside
  `AttachableResponse`), so success means "an Attachable with an Id came
  back"; the file downloaded back is byte-identical (sha256) to the one
  uploaded; the query `AttachableRef.EntityRef.Type = 'Invoice' AND
  AttachableRef.EntityRef.value = '<Id>'` works; every attach or delete BUMPS
  the invoice's SyncToken (0 → 3 over attach, replace) — harmless because the
  only writer, `update-invoice`, reads the live SyncToken right before
  writing (INV-QB-009); never hold a SyncToken across an attach. Guarded by
  `test-qb-attachments.ts` (decisions, wire format, HTTP against a fake
  fetch, and that both routes call it).
- **INV-QB-037** — For an invoice accounting has split (INV-QB-029), the PDF a
  client receives (the SOA PDF, an Email Drafts attachment, Billing Drafts'
  Save PDF — all through `getClientInvoicePdf`) is the ORIGINAL invoice
  attached to it in QuickBooks when that file PROVES it is the original; the
  system's redraw is the LAST choice. Vincent's order, 2026-10-06: "先找 QB,
  QB不能去 Server, Server 找不到了 才重新画，这样准确度和失误率才是最优的" —
  (1) the original attached in QuickBooks; (2) STAFF fetch it from the company
  file server and attach it in QuickBooks by hand ("第一步还是要按照附件走，
  没有附件的就从server 填进去，……以后大家都从系统开单就不会有这些问题了" — since
  2026-10-07 by uploading it on Billing System > Invoice Originals, which checks it
  first, below); (3)
  only then the system's redraw (INV-QB-029), or QuickBooks' own PDF with a
  notice for an invoice the system cannot draw. Why: 154 open invoices (~27%)
  are split and were all redrawn; the attachments (INV-QB-036) exist for this.
  The file server is sensitive ("一个不小心删除错东西 都是很大的影响"; it is
  not forbidden to staff, who also use it to replace a wrongly attached file):
  nothing in the system and no Claude session reads or writes it. The proof
  (`lib/original-copy.ts`; text, page count and Producer read by
  `lib/pdf-text.ts`) has three parts, ALL required. WHAT THE FILE IS: its
  Producer is not "Tassure" (the system's own drawing — what Save PDF gives and
  what staff are used to attaching; read with pdf-lib's `updateMetadata: false`,
  because by default pdf-lib overwrites the Producer with its own name) AND
  the company letterhead ("Registration No.: 201325157G") is on the page as
  TEXT — QuickBooks prints it as text in both layouts, the system's own drawing
  as a picture, which is what still refuses the drawing once another program has
  re-saved or printed it and rewritten the Producer (the second council,
  2026-10-06, re-saved a Save PDF file and every other check passed), every
  page was read and has text (the SOA merges ALL pages; a page that was never
  read, or a picture, is not checked), and pdf-lib can load it (a file with an
  owner password is read by pdf.js but refused by pdf-lib, and the invoice
  would drop out of the SOA). WHOSE IT IS: the page says the invoice
  number after its "Invoice No." label (not merely contains it: DN26-18 is not
  DN26-182, and a credit note quoting the number is not the invoice), the
  invoice date after "Date" (not the due date), is billed to the customer (an
  invoice moved to another customer, INV-QB-030), and says which amount is the
  total. Two printed layouts of a real original exist and BOTH are accepted
  (found on the file server, 2026-10-06, where 23 of 155 originals were in the
  second): QuickBooks' current one ("INVOICE NO. : TAB 02611112", "DATE :
  01/10/2026", "TOTAL 760.00" or "TOTAL S$760.00"), and the older one staff
  printed from the QuickBooks screen in 2025 - early 2026 (Microsoft Print To
  PDF or Acrobat: "Invoice No. : 02610188" with no book, "Date : 4/3/2026" with
  no zero padding, the total as the LAST amount under a "Net Total" heading);
  in both, another book's prefix, another day, or an amount after the total
  is refused, and a number QuickBooks stores with its book ("TAC02580261") is
  the same number. WHAT IT PRINTS: the
  money on the page, counted as a multiset, equals the invoice's line amounts
  plus the total, with every Deferred twin folded into exactly ONE other line
  (the two footer lines of an invoice to a foreign payer, "Exchange rate 5.24"
  and "Equivalent to RMB5,986.20", are information and not counted — 4 originals
  on the file server have them, and the redraw drops them).
  Any folding is accepted, not only the system's label pairing, because
  accounting sometimes gives a twin the wrong service's label: TAB #02611114's
  second "Deferred Revenue - Corp Sec" (50) sits under Registered Address (150)
  and both services were split 3:1, so the original was Corp Sec 600 + Reg
  Addr 200 where the label pairing gives 650 + 150; #02611078 (Fuyuan) the same
  at 5:7 — the redraw shows 910 + 150 where the original was most likely 700 +
  360 (the totals are right, the lines are not; see CURRENT_STATE). The split
  version keeps its twins separate, so it is never on the list. Run with the
  production code on 20 real files saved from QuickBooks on 2026-10-06 (dates
  and customers taken from the synced rows, not from the PDF): 8 of 8 attached
  invoices accepted, 12 of 12 current QuickBooks PDFs of split invoices refused
  for their amounts (so every anchor was found on a real page), and the
  system's own redraw refused by its Producer. History: the first version
  (invoice number as a substring + the amounts) was reviewed by a council the
  same day, which got 7 wrong files past it with the production code — the
  system's own redraw, a file whose pages past the 6th were never read but
  were merged into the SOA, a picture page, another client's invoice with the
  same number, a credit note quoting it — and an owner-password file that
  passed and then dropped its invoice out of the SOA; all are tests now.
  Rules: (1) the LOOK-UP is read-only — it lists an invoice's attachments and
  downloads them, and never uploads, changes or deletes anything in QuickBooks
  (the only code that adds a file for it is the Invoice Originals upload, below:
  it adds one attachment to one invoice and removes nothing); (2) any doubt
  is the next choice down — no attachment, a file that fails the proof, an
  unreadable one, a QuickBooks error or a timeout all give "none" and the
  invoice goes out as before, never as an error; (3) candidates are PDFs of at
  most 1 MB with a download link (real invoices are 80-260 KB; the SOA response
  limit is 4.5 MB): the system's own copy (its note, INV-QB-036) first, then
  the newest hand-attached file, at most 4; (4) it runs for EVERY invoice that
  carries a Deferred line (TAB, TAC), ahead of both the redraw and QuickBooks'
  split PDF for an invoice the system cannot draw; an invoice with nothing to
  fold is not looked up and goes out as QuickBooks' own PDF; (5) the
  QuickBooks token is never sent to the download link's host (the signed
  `TempDownloadUri` is the credential), the link must be https and stay https
  after redirects; (6) at most 15 s per invoice, the requests are cancelled at
  the deadline, and after a QuickBooks failure or timeout no invoice is looked
  up for 2 minutes (per server instance) so a customer's SOA cannot pile up 15
  s per invoice; (7) logs name the attachment Id and the invoice number, never
  a file name (file names carry client names); (8) per-book switch
  `ORIGINAL_COPY_LOOKUP_MODE` (TAB and TAC live, TAO off); staff-only views
  (invoice chips) still open QuickBooks' own PDF; (9) the two routes trace
  `pdf-parse` and `pdfjs-dist` (`next.config.ts`; the build's `.nft.json` lists
  `pdf.worker.mjs` for both) and have `maxDuration` (SOA 300, Save PDF 60).
  Accepted, not covered: a file for the right invoice with the right number,
  date, customer, amounts and total but different descriptions, terms or
  address (edited in QuickBooks after the copy was attached — INV-QB-036
  deliberately never refreshes a split invoice's copy) is used; descriptions
  are not compared because accounting rewrites them when it splits. State on
  2026-10-06 evening, after the SERVER ROUND (Vincent: "我要你去 server 走一轮，把那些找不到原发票
  的发票置入到QB的附件上"): the file server's invoice backup folders were READ (a directory
  listing and reading files, copied to a local folder — nothing on the server was
  written, moved or deleted) for the 155 open invoices that carry a Deferred line;
  every one has a file named after its number; the proof accepted 127, and 4 more once it
  ignored an invoice's exchange-rate footer (131 in all), and all 131 (TAB 113,
  TAC 18) were attached to the invoice in QuickBooks — each against the LIVE
  invoice, with the server's file name, IncludeOnSend false and the Note "Original
  invoice PDF from the company file server, attached on 2026-10-06 after the system
  checked it …", then confirmed by the real look-up; the first alone (TAB #02611114,
  byte-identical to the server file). The other 24 stay for a person: 13 are pictures
  (no text), 5 were restructured by accounting after sending, 3 totals and 3
  dates were changed after sending — with their server paths in
  `Server-round-originals-2026-10-06.xlsx`. The system's own copies on three new invoices
  (#02611136, #02611140, TAC #02680325) show INV-QB-036 works in production. Source tip from the council: the 60 split
  invoices first emailed through the system went out from staff's Outlook
  before the redraw existed, so Sent Items holds the PDF the client got — but
  only the proof says whether a file is the original. Where staff work on it: Billing System > Invoice Originals
  (`/billing/soa/originals`) is the TO-DO LIST of the open invoices accounting
  has split (they carry a Deferred line) that have NO original the system
  accepts — and only those. An invoice whose original is in use is finished
  work and is not listed (Vincent, 2026-10-06: "已经拿到原装发票的其实就已经不需要在
  Invoice Originals 页面内了，因为没有意义"; the header only counts them). 24 on the
  night of 2026-10-06, all "nothing attached". The queue is computed LIVE on
  each visit by the SOA's own proof: the synced rows only name the candidates;
  per book it reads the open invoices in batches (`Id IN (…)`, 50 at a time,
  `lib/original-status-core.ts` invoicesByIdQuery), the payment terms once and
  every attachment in one paged read, rebuilds each invoice's facts with the SAME
  `prepareInvoiceForClient` that `getClientInvoicePdf` uses, and runs
  `selectVerifiedOriginal` on its files — so the page can never list an invoice
  the PDF path would serve its original nor hide one it would redraw. An invoice
  paid, voided or no longer split since the last sync is not listed; a book (or
  one invoice) QuickBooks cannot judge is reported as "not checked", never as
  done and never as "nothing to do". Measured on the real books: 21.7 s cold
  (155 invoices, 131 files opened and proven), 4.9 s when the answers are
  remembered (in memory, per server instance, keyed by the invoice's facts AND its
  files, so an edited invoice or a new or replaced file is asked again; a failed
  download or read is never remembered). STAFF UPLOAD the original they found
  (Outlook Sent Items, the file server) on its row: `POST
  /api/billing/originals/upload` (the account must be able to open the page —
  the proxy only checks sign-in on /api; TAB or TAC; one PDF of at most 1 MB)
  reads the LIVE invoice and answers "already" when the invoice has an accepted
  original (nothing is attached twice: a double click, or two people on the same
  invoice) or "not-split" when it carries no Deferred line any more; otherwise it
  proves the file against the live invoice with `checkOriginalCopy` — the same
  proof, nothing waived — and only then attaches it (IncludeOnSend false, a name
  built from the invoice and not from the person's file, and a Note that names who
  uploaded it, when, and the file's sha256 — never the system's own copy note, which
  the system replaces when an invoice is edited), then confirms it the way the SOA
  reads: "attached" only when the real look-up now picks exactly that file
  ("unconfirmed" otherwise, never rolled back). A file the proof does not accept
  is refused with the reason and what to do and attaches NOTHING, so no wrong file
  can be pushed through the page: the 13 pictures and the restructured invoices
  cannot be uploaded past the proof, and stay listed until a file the proof
  accepts is found (a confirm-anyway or OCR path for them is an OPEN QUESTION for
  Vincent, not built; the 6 invoices changed after sending must never be
  confirmable — the redraw is right for them). Nothing is ever removed or changed
  in QuickBooks by the page; the upload is the ONLY write and adds one attachment
  to one invoice. It sits under `/billing/soa`, so the existing "outstanding"
  page rule decides who sees it, and both routes check that rule themselves.
  Verified with the real code on the real books, read only: the queue (24 waiting,
  131 done, 0 unknown), and the real upload wiring on cases that cannot write —
  an invoice that already has its original ("already"), another invoice's real
  original, a picture-only file, a garbage PDF and a text file offered for waiting
  invoices (all refused with the right reason). Guarded by `test-original-copy.ts`
  (122 checks: the proof on synthetic and generated PDFs, which file is chosen and
  what is said about each, the QuickBooks reader against a fake fetch, that
  `getClientInvoicePdf` looks BEFORE it redraws), `test-original-upload.ts` (34:
  every branch of the upload against fakes) and `test-original-status.ts` (64: the
  queue, the batched read, the remembered answers, who may call, the page); with
  each safeguard removed one at a time on a copy (36 of them for the queue,
  the upload, the routes and the page, on top of the proof's own), the tests fail.

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
  more than once in this codebase. **Since 2026-09-24 this is enforced
  centrally, not just by convention** — see INV-DATA-066: `pageAll()` now
  orders every page uniquely, and `createAdminClient()` completes any plain
  read that hits the cap (logging which call site did, so it can be converted
  to an explicit `pageAll()`).
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

- **INV-DATA-063** — Reports' AI Analysis moved from on-demand generation
  (24h cache + a manual "重新生成" button) to a WEEKLY cron, no manual
  trigger at all, per Vincent: "为了不要浪费Token，这个AI Analysis，一周只
  做一次更新描述，不能refresh, 并且这个更新是按照每星期一早上6点更新" (to
  avoid wasting tokens, update once a week only, no manual refresh, every
  Monday 6am).
  - New `app/api/reports/narrative-cron/route.ts` is now the ONLY caller of
    `generateReportsNarrative()` in the whole app — cron-only (added to
    `proxy.ts`'s `CRON_PATHS` + `vercel.json`'s `"0 22 * * 0"`, 22:00 UTC
    Sunday = 06:00 SGT Monday, the same UTC+8 conversion every other cron
    in that file already uses), wrapped in `withAutomationRun('reports_
    narrative', ...)` like every other scheduled job.
  - `app/api/reports/narrative/route.ts` (the page's own read endpoint) is
    now a PURE cache read — no generation on a cache miss, no staleness
    check, no `?refresh=true`. Removing the capability server-side, not
    just hiding the UI button, was deliberate: a button-only fix would
    still let anyone hit the URL with `?refresh=true` and burn a real API
    call, exactly what Vincent asked to stop. Returns `narrative: null`
    (200, not an error) when no row exists yet or the only row is
    shape-stale — `app/reports/page.tsx` renders this as "analysis will be
    generated next Monday 6am SGT," not an error banner.
  - `app/reports/page.tsx`'s manual refresh button (and the `cached`
    boolean it depended on, which no longer means anything once there's
    only ever one write path) removed entirely, along with the now-unused
    `RefreshCw` import.
  - `reports_narrative` added to `lib/automation-sync.ts`'s
    `AutomationSource` union AND `app/api/automation/health/route.ts`'s
    `SOURCES` (per that file's own repeatedly-rediscovered gap: a real
    `AutomationSource` not listed there is invisible to Vincent's health
    dashboard — already happened for `teamwork_secretary`, `ai_learning`,
    `ai_quality_review`). Unlike every other source in that file
    (daily crons, flagged "attention" after a flat 30h without a success),
    a WEEKLY job needs its own threshold — flagging it "attention" for ~6
    of every 7 days between runs would be pure false-alarm noise, not a
    real signal. Added a `STALE_HOURS` per-source override map (defaulting
    to the existing 30h for every other source, 192h/8 days for
    `reports_narrative` — one day of slack past the 7-day cadence).
  - **Not verified against a real production run** — the cron hasn't fired
    yet (first scheduled run is the next Monday after deploy) and there is
    no way to trigger it locally (`OPENAI_API_KEY`/`CRON_SECRET` are both
    Vercel-only). Whether the FIRST cache row lands correctly, and whether
    the health dashboard's new `reports_narrative` tile behaves as
    designed, can only be confirmed after that first real run — flagged
    to Vincent as an open item, not silently assumed working.
  - `npx tsc --noEmit`, `npx eslint` (every changed file), `npm run build`
    (cold, confirms both `/api/reports/narrative` and `/api/reports/
    narrative-cron` compile as separate serverless functions) all clean.

  **Amended, same day**: "no manual refresh" softened to "no manual refresh
  for anyone but Vincent" — his own immediate follow-up: "这样有一点不方便，
  这样我觉得保留那个 refresh 按钮给我，但是其他人是看不到的...只有Vincent
  可以选择强制 refresh". `app/api/reports/narrative-cron/route.ts`'s GET
  now accepts a SECOND caller beyond the cron bearer token: any request
  that isn't the cron must be a real session AND `account.email ===
  'vincent@tassure.com'` — the SAME hardcoded-to-Vincent check (not a
  generic `account.admin` flag) `app/api/automation/health/route.ts`
  already uses, kept consistent rather than inventing a second convention.
  `app/reports/page.tsx` re-adds the refresh button, gated behind a new
  `isVincent` state (from `/api/auth/me`'s `user.email`) — this is UI
  convenience only, matching the established "/ai-learning" pattern:
  hiding the entry point is not the real access boundary, the route's own
  check is. Clicking it calls `/api/reports/narrative-cron` directly (the
  SAME route the weekly cron calls — no second, duplicated generation code
  path reintroduced into the read endpoint), then re-reads the cache. Each
  run INSERTS a new row rather than updating one in place, so whatever's
  currently shown never changes mid-week on its own — confirmed as the
  intended design, not just an implementation detail, by Vincent's own
  explicit statement: "生成出来的内容就不变了，直到下次更新显示." `npx tsc
  --noEmit`, `npx eslint` (both changed files), `npm run build` (cold) all
  clean. Still not verified against a real trigger (same
  `OPENAI_API_KEY`/`CRON_SECRET` local-access limitation) — the manual path
  is code-reviewed and compiles, not yet proven by an actual click.

- **INV-DATA-064** — Moving a Master List row into a new `list_type` must
  never default `status` to a value more FINAL than what's actually known
  at that moment — a staff action (moving a row) is not a TeamWork
  confirmation, and the two must not be conflated. Found live 2026-09-23:
  Vincent flagged YOUWE SOLUTIONS PTE. LTD (Strike Off list) showing
  "STRUCK OFF" while TeamWork itself still showed "Striking Off" — live-
  confirmed by fetching TeamWork's own `getCompanies` response directly
  (`status: "Striking Off"`, `liquid_strike_off_date: "23/09/2026"` — the
  strike-off was still IN PROGRESS, finalizing that same day). Root cause:
  `app/master-list/active-clients/page.tsx`'s `moveTargets` hardcoded
  `statusValue: 'STRUCK OFF'` for the Strike Off target — every row ever
  moved Active Client -> Strike Off via the UI got this literal, final-
  sounding value stamped on unconditionally by `app/api/master-list/
  move/route.ts` (`status: statusValue ?? rest.status`), regardless of
  what TeamWork's real status was at that instant. This is NOT overwritten
  immediately — it sits until the next successful `teamwork/sync` cron
  run corrects it via `companies.tw_status`, matched by UEN; a row moved
  the same day it's viewed (as YOUWE was — `updated_at` was hours old)
  will show the wrong, more-final status for up to a full day. Vincent's
  own framing of the fix: "一开始Move 过来的时候，也应该是先默认显示是
  Striking Off，等到同步TW过后，才根据TW的 status 更新，而不是一开始move
  过来，就是默认 Struck off" — the move-time value is a PLACEHOLDER until
  a real sync confirms it, and the placeholder must be the more
  conservative one. Fixed by changing that one `statusValue` to `'Striking
  Off'` — the exact wording TeamWork's own API uses (confirmed via the
  live fetch above), so `components/MasterListTable.tsx`'s `statusColor()`
  (`s.includes('STRIKING OFF')`) still renders the same red badge, and the
  nightly sync (which does NOT set `manual_fields.status` on a move) is
  still free to correct it to whatever TeamWork's real status turns out to
  be the next time it runs. `TERMINATED`'s own `moveTargets` entry is
  unchanged — Vincent's report and fix request were specifically about the
  Strike Off transition, and TERMINATED has no equivalent
  in-progress-vs-final distinction to get wrong the same way.
  **Also directly corrected the one flagged row** (`master_list` id 1644,
  `status`: `STRUCK OFF` -> `Striking Off`, audit-logged as
  `changed_by: 'system:teamwork'` to match what the sync itself would have
  written) — using the SAME real, just-fetched TeamWork status as ground
  truth, not a guess, rather than making Vincent wait for that night's
  cron to self-correct it. **Not audited for other rows in the same
  state** — any OTHER row moved via this same path before this fix, still
  unlocked (no `manual_fields.status`) and not yet re-synced, could carry
  the same stale "STRUCK OFF" default; flagged to Vincent as a real
  possibility, not silently assumed to be a one-off, but not backfilled
  here since only this one company was reported and a full cross-check
  against live TeamWork data for every Strike Off row is a materially
  bigger, unrequested task. `npx tsc --noEmit`, `npx eslint`, `npm run
  build` (cold) all clean.

- **INV-DATA-065** — A wide, horizontally-scrollable `display: grid` list
  (fixed-px `gridTemplateColumns`, wrapped in `.system-list-scroll`'s
  `overflow: auto`) must give its trailing interactive column (a Mail/
  action icon) `position: sticky; right: 0; background-color: inherit`,
  not leave it as a plain cell at the natural end of the grid. Found live
  2026-09-23: Vincent — "当被挤压到宽度，信封就会出现在不对的位置...就是
  导致我每次要在浏览器ZOOM小画面尺寸" (when squeezed for width, the
  envelope icon ends up in the wrong position, forcing him to zoom the
  browser out every time). Root cause, confirmed by computing the real
  minimum width: `app/billing/soa/_components.tsx`'s `soaListColumns` (14
  columns, mostly fixed px) sums to ~1650px of REQUIRED width — comfortably
  wider than the available content area once the sidebar is expanded (less
  space left for `<main>`). The table already scrolls horizontally
  correctly, but the Mail-icon column — the very LAST column, 36px wide —
  sat at the natural end of that scroll, so reaching it required either
  scrolling all the way right or (Vincent's own workaround) zooming the
  whole browser out to shrink everything enough to fit without scrolling.
  `app/billing/page.tsx`'s Billing Drafts row (`billingListColumns`, same
  fixed-grid pattern, same trailing Mail-icon column) has the identical
  structural bug — Vincent confirmed directly: "其实这个情况不只是出现在
  这个页面" (this isn't only happening on this one page). Fixed in both
  files (both the header's blank trailing cell AND every row variant's
  Mail-icon cell — SOA's group row, SOA's per-source child row, and
  Billing Drafts' row) by adding `position: 'sticky', right: 0, zIndex: 1,
  backgroundColor: 'inherit'` to that one cell — `backgroundColor:
  'inherit'` rather than a hardcoded color specifically because
  `.system-list-row`'s own background (default/hover/selected/
  soa-group-open/soa-group-child, all `!important`-guarded CSS classes)
  varies per row state, and `inherit` tracks the parent's live computed
  value automatically instead of needing to be kept in sync by hand.
  **Verified empirically, not just reasoned about** — built an isolated
  static HTML reproduction (real CSS custom properties, real
  `soaListColumns` grid template, deleted after use) in the browser tool
  and drove `scrollLeft` directly via JS to a PARTIAL scroll position
  (enough to reveal Source through Total, well before PIC/Main PIC/
  Remarks); without the fix the Mail icon would only appear after
  scrolling all the way right, but with it, it stayed pinned at the right
  edge at every scroll position tested, exactly the desired behavior. This
  same technique (sticky-right on a wide grid's trailing action column)
  applies to any FUTURE wide `display: grid` list in this codebase with a
  small trailing icon/action column — worth applying proactively rather
  than waiting for the same zoom-workaround complaint again. `npx tsc
  --noEmit`, `npx eslint` (both changed files), `npm run build` (cold) all
  clean.

- **INV-DATA-066** — Supabase reads must never silently return an incomplete
  or duplicated row set. Two failure modes, both SILENT (no error, no
  warning), both measured on real data 2026-09-24 and now closed centrally:
  1. **Unstable offset paging.** `.range()`/`pageAll()` without a total order
     is not stable in PostgREST — pages overlap and skip rows. On the real
     `quickbooks_invoices` table with a `txn_date` filter (2,324 rows) 307 to
     650 rows came back duplicated and the same number MISSING, depending on
     the exact filter. It was LIVE on the AR Reminder page
     (`app/api/ar-reminder/route.ts`, the year-filtered invoice lookup that
     was introduced ~2026-09-14 as "a pure completeness fix"): the 2,326
     invoices of 2026 came back as 2,017 distinct, so 182 of the 638 AR rows
     that really have a 2026 invoice showed an incomplete "QB Invoices" list
     in their row detail and 34 showed none (identical on every load, e.g.
     LOYANG BESTCONN Apr 2026 → 02611026, ASIA BLUE Jun 2026 → 02610940). That
     panel is display-only; Billing Drafts' "not invoiced yet" logic reads the
     renewals route's data instead. Fix: `lib/page-all.ts` appends a unique
     `id` tiebreaker (AFTER the caller's own ordering) to EVERY page request,
     and a failed page now THROWS — it used to be swallowed, and if it was the
     last page of a wave the "short page means done" check ended the read
     early. The 5 hand-rolled `.range()` loops (`master-list` route, 4 in
     `teamwork/sync`) got `.order('id')`.
  2. **The 1,000-row cap on unpaginated reads.** This project's PostgREST
     returns at most 1,000 rows for a read that does not page (`limit=1500`
     and `Range: 0-1499` are capped too); a truncated response carries
     `Content-Range: 0-999/*`. Real, present-day loss: the assistant's Master
     List edit tool (`lib/company-update-lookup.ts`) and former-client lookup
     (`lib/company-deep-lookup.ts`) read `master_list` (1,599 rows)
     unpaginated and could not see 599 of them — 218 of the 788 ACTIVE clients
     among them ("has no Master List row, so there is nothing to edit
     there"); `billing/compare` reads whole years of invoices (2.3-2.9K rows).
     And weeks away: `generated_invoices` 945 rows (+41/month), `ar_reminder`
     917 (+50/month), `companies` 952 (+10/month), each under dozens of
     unpaginated reads (a static scan flagged 122 candidate reads on
     near/over-cap tables outside `pageAll`, many of them bounded by filters).
     Fix, at the one place every server-side read goes through:
     `lib/supabase-auto-page.ts`, installed by `createAdminClient()`,
     re-issues a plain GET read that came back with EXACTLY the cap signature
     (no explicit limit/offset/Range, no count preference, not
     single-object/RPC) with a unique `id` tiebreaker appended to its ordering
     and returns every page. Anything else is returned untouched, and if
     completing fails the original response comes back unchanged. Each
     completion logs `[supabase] unpaginated read of "<table>" hit the
     1000-row cap` — a call site that shows up there should be converted to
     `pageAll()`; the safety net is not a licence to skip pagination. Kill
     switch: `SUPABASE_AUTO_PAGINATE=0`.
  3. **Same-day ties are now settled by an explicit rule, not by row order.**
     Two places used to depend on whichever order the database happened to
     return tied rows in (measured by running old and new code SIMULTANEOUSLY
     on the same data: the row SETS were identical, only tied rows moved).
     (a) The SOA Main-PIC suggestion (`computeSuggestedOwner()` in
     `lib/soa-owner.ts`) takes the first resolvable Class of the most recent
     invoice, and a month-end batch of same-day invoices is a tie. It flipped
     between runs: HAN KUN LLP (TAO) opened and self-resolved a
     `stale_confirmed_pic` exception on 2026-09-17 purely because of that.
     The tie now goes to the lower (earlier-created) QuickBooks Id, compared
     numerically. Measured on all 411 TAB/TAO customers, only TWO are
     sensitive to the choice at all (MINYOTECH TAB, HAN KUN LLP TAO); this rule
     reproduces the old code's usual answer for both (Hoo Seng Xin, Lee Jing
     Fei — the latter is also its human-confirmed PIC), so nothing visible on
     the SOA pages moved. The opposite rule (later-created wins) would have
     changed both (Tey Shemin, Clarence Saw) and put HAN KUN LLP back into
     `soa_owner_audit` every night. This is NOT a rule Vincent stated: if the
     business wants "the later-created invoice decides", flip the sign in
     `compareQbIds` and expect exactly those two to change
     (`test-soa-owner-tiebreak.ts`). The class lines inside one invoice are
     read in `(qb_invoice_id, line_num)` order for the same reason.
     (b) TAO's display-only "last invoice" (`computeTaoCompanies()`,
     `previewTaoBilling()`): a tie on the last billing day now goes to the
     highest `invoice_no` ("last" = most recently issued). The database `id`
     is NOT a usable "newest" proxy (only 10 of 83 same-day groups agree with
     invoice-number order), so the paging `id` tiebreak alone would have been
     deterministic but meaningless; and the old output followed no coherent
     rule either (it matched neither ascending nor descending). Measured
     2026-09-24, 8 of 810 TAO rows show a different invoice because of it (e.g.
     BLUEWHALE 02660605 → 02660606, HAN KUN LLP 02660512 → 02660518, Kim Pan
     Investment 02660299 → 02660300); the field is display-only and never
     prices anything. Comparing two runs of `computeTaoCompanies()` by company
     NAME alone is a trap: some companies legitimately appear on 2 rows (one
     per matched TAO customer name — JULLY TECHNOLOGIES, TARGET CAPITAL
     MANAGEMENT, APOLLO CAPITAL MANAGEMENT), and the order of those rows moves
     between runs; compare the multiset of rows per (id, name) instead.
  Guards: `test-page-all.ts` (a fake backend that reproduces the instability —
  the OLD implementation fails on it with the same 650-missing figure),
  `test-supabase-auto-page.ts` (the real supabase-js client over a mini
  PostgREST fake: completes truncated reads and leaves everything else
  byte-for-byte alone), `test-paging-guard.ts` (static: every hand-written
  `.range(` outside `page-all.ts` must be ordered; `createClient` may only be
  called in `lib/supabase.ts` so nothing bypasses the safety net). Verified on
  the real database: all 18 real multi-page query shapes returned exactly the
  true rows in every repeated run through the fixed `pageAll` (the AR shape was
  the one that failed before), and plain unpaginated reads of `master_list`
  (1,599), `quickbooks_invoices` (8,047), `quickbooks_invoice_items` (18,973)
  and `email_drafts` (2,039) now come back complete in 1 to 2 seconds. Known
  and NOT fixed: an explicit `.limit(N)` with N > 1,000 is still capped by the
  server (the wrapper deliberately leaves a caller-set limit alone). Audited
  2026-09-24: no call site does that today — the largest are
  `app/api/teamwork/sync-secretary/route.ts` (≤ 900), `lib/audit-lookup.ts`
  (exactly 1,000 = the cap, so nothing is hidden) and `lib/team-activity.ts`
  (`cap = 400`); every other `.limit()` is ≤ 500. A NEW `.limit(2000)` would
  quietly reintroduce the cap — use `pageAll()` for anything that can exceed
  1,000 rows. Also not fixed: offset paging can still duplicate or skip a row
  if the table changes between two page requests of one read (rare, and far
  smaller than the unordered failure).

- **INV-DATA-067** — Master List `status` mirrors TeamWork's own company
  Status; in Terminated Services "Terminate" and "Terminated" are DIFFERENT on
  purpose, and a row TeamWork can say nothing about must not keep a legacy
  placeholder. **"Terminate" is the placeholder** — the row was filed here (by
  a Move, by hand, by an old import) but TeamWork has not confirmed it.
  **"Terminated" is TeamWork's own word**, which only ever arrives when the
  nightly sync copies it, so it means CONFIRMED. Vincent: "Move 到 Terminated
  现在放的 'Terminate'…和TW确认后才变成 Terminated". The overnight change from
  "Terminate" to "Terminated" is the confirmation signal, not a bug, and a row
  that still says "Terminate" after a sync is exactly the kind to review
  ("看看之前有没有错误显示的 或者没有同步正确的"). **Lesson — this entry's first
  version got it wrong:** commit 15a6c57 "unified" the Move placeholder and the
  backfill to TeamWork's final "Terminated" so that nothing would "change by
  itself"; that claims a confirmation that has not happened (the INV-DATA-064
  "STRUCK OFF" mistake again) and erases the very signal the design relies on.
  Vincent caught it the same evening, before anything was written (no sync had
  run since the push; `audit_log` had no `system:terminated-list-default`
  rows); 5af0e63 fixed it. Never "tidy" a placeholder into the confirmed word.
  Found 2026-09-24: the colleague who works the Strike Off / Terminated
  Services lists (relayed by Vincent) — "strike off & terminate的status 不要
  自己变…follow teamwork", then "你可以帮我把之前的都放Terminate 吗 — 就是不是
  terminated status 的…一直比较好"; Vincent: "这个处理一下，并且避免下次发生同样
  问题". Measured against TeamWork's live list (1,382 companies, matched by
  UEN) the 269 Terminated Services rows were: 63 "Terminated" (correct,
  mirrored), 1 more "Terminated" (company not in TeamWork), 10 "TERMINATED"
  (the old Move placeholder; company not in TeamWork), **180 "YES"** (178 not
  in TeamWork at all + 2 in TeamWork with a blank status), 7 "Active" and 2
  "Striking Off" (TeamWork itself says so), and 6 hand-typed leftovers
  ("RENAMED", "to be terminate", "terminate", blank, "Mary", "NO"). Root cause:
  the nightly sync's status block (2026-09-04) only ever writes rows TeamWork
  has a non-blank status for, so a company TeamWork no longer lists keeps
  whatever was imported or typed FOREVER — that is how 180 "YES" survived in a
  list called Terminated. Rules, all in `lib/master-list-status.ts` (one
  framework-free file; the sync, the Move route and the pages import it):
  (1) TeamWork's non-blank status wins, and a manual lock
  (`manual_fields.status`) beats everything — unchanged; (2) a Terminated
  Services row TeamWork cannot inform (UEN not in TeamWork, or a blank
  TeamWork status) becomes exactly "Terminate" — same as a fresh Move —
  unless it already says exactly "Terminate" or TeamWork's exact
  "Terminated" (kept: TeamWork's own spelling, so one TeamWork response that
  omits a company must not downgrade a confirmed status). CASE MATTERS
  (Vincent, 2026-09-24: "terminate 要改成 Terminate"; "TERMINATED 要换成
  Terminate 或者是 Terminated, 这个要按照TW，如果TW有Status 显示就换成 TW的
  status, 如果没有就和Move的显示一样 Terminate"): "terminate", "TERMINATED",
  "terminated" are rewritten; a row TeamWork knows already got TeamWork's
  own word from rule 1; (3) the
  Move placeholder is decided by the SERVER (`placeholderStatusForMove()` in
  `app/api/master-list/move/route.ts`, which ignores a client-sent
  `statusValue` for these two lists): Strike Off → "Striking Off" (TeamWork's
  own in-progress wording, INV-DATA-064), Terminated Services → "Terminate";
  the Active Client page imports the constants instead of typing literals, so
  a stale browser tab or a copy-pasted string can't bring back a different
  word. **A row TeamWork itself reports as non-terminated is deliberately NOT
  forced** ("follow teamwork"; forcing it would be undone by the next sync
  anyway): 7 companies still "Active" in TeamWork although filed under
  Terminated Services (XSPY, SINGAPORE CHINESE ARTS CENTER, SATORISYS, HALOFUN,
  ANABLE MANAGEMENT SERVICES, ARK PARTNERS MANAGEMENT, SINO MINING HEAVY
  INDUSTRIES — the same 7 flagged on 2026-09-04 and still open) and 2 "Striking
  Off" (WEIOT, ALLIED CHANCE INTERNATIONAL LIMITED (SINGAPORE BRANCH)). Those
  need a TeamWork-side fix (or a move back to Active Client); the "TW CSS
  Clients" card on the Terminated Services page lists the Active ones. The
  planner takes TWO TeamWork inputs on purpose — the mirror map AND the set of
  every UEN with any non-blank TeamWork status — because the sync skips a few
  TeamWork records (ambiguous name, duplicate stub, INV-TW-023) before it
  fills the mirror map, and a company TeamWork DOES describe must never be
  mistaken for one it knows nothing about. The sync reports
  `master_list_terminated_defaults`; each change is audit-logged with the old
  value (`changed_by = 'system:terminated-list-default'`, filtered out of
  human team-activity like every `system:` writer). Dry run against the live
  data: exactly 196 rows change to "Terminate" (180 "YES", the 10 old
  "TERMINATED", and "RENAMED", "to be terminate", "terminate", blank, "Mary",
  "NO"), all in Terminated Services, 0 pending TeamWork-mirror changes;
  afterwards the list holds 196 "Terminate", 64 "Terminated" (63 mirrored + 1
  TeamWork-spelled row TeamWork does not list), 7 "Active", 2 "Striking Off".
  Guards: `test-master-list-status.ts` (the planner
  incl. the real 269-row shape, the Terminate/Terminated distinction, and
  source guards that fail if the Move route, the page or the sync go back to
  their own copy of the rule or the Terminated Services Move target becomes
  the final word). NOT covered, needs Vincent: Strike Off's own
  TeamWork-unknown leftovers (5 "YES", 1 blank — "Struck Off" vs "Striking
  Off" is a business call, INV-DATA-064: never claim more than is known), and
  Active Client's Move placeholder "YES" (rewritten to "Active" by the next
  sync for rows TeamWork knows — the same overnight-change shape, and by the
  same logic an intended confirmation signal, so left alone).
- **INV-DATA-068** — A write route that returns `.select('*').single()` and
  hands the result straight to the frontend to REPLACE its local copy of
  the row must select every joined/synthesized field the row's type
  actually carries, not just the base table's own columns — `select('*')`
  silently drops anything joined in from another table, and the frontend
  has no way to know a field went missing; it just renders undefined as
  blank. Found 2026-10-04 (Vincent, after the Turnover AI review-table
  redesign went fully inline-editable with save-on-blur, so every keypress
  round-trips through this): `app/api/turnover-ai/line-items/[id]/route.ts`
  PATCH returned `select('*')` on `turnover_line_items`, whose `file_name`
  is joined in from `turnover_documents` (same join the GET route already
  used) — not a real column on this table. The frontend's `patchItem`
  replaces the whole line item with the PATCH response
  (`app/turnover-ai/project/[id]/page.tsx`), so every single inline edit —
  not just editing the date, just whichever field a staff member happened
  to touch first — blanked the source-filename line under the vendor the
  instant it saved. Fix: PATCH now runs the identical
  `select('*, turnover_documents(file_name)')` join as GET and flattens it
  the same way before responding. Verified read-only against a real row
  (not a write): the join returns `turnover_documents: {file_name: "..."}`
  and the flattened shape carries every column the frontend's
  `TurnoverProjectLineItem` type expects. General rule: when a PATCH/POST
  response is used to replace (not merge into) frontend state, its
  `select()` must mirror the GET route's shape exactly — diff the two
  `select()` strings, don't assume `'*'` is enough just because it passed
  typecheck.
- **INV-DATA-069** — Page access is ONE rule: `lib/workspaces.ts`'s
  `canSubjectOpen()` — the account's department workspace page list AND,
  for a gated page, the account's own flag. proxy.ts (via
  `canAccountOpen()`), the assistant's page map and billing tools, My Tasks'
  sections, and the client menus (Sidebar, MobileNav, Dashboard links via
  `components/SessionContext.tsx`) all call it; the menus draw ONE tree,
  `lib/nav-tree.ts`. Never a hand-written page block in proxy.ts, never a
  second link list, never a string comparison against a page href to decide
  scope. Found while building the department split (2026-10-04 — Vincent:
  "按照部门去区分...数据还是共通的，只是显示的区别", 7 decisions via
  AskUserQuestion after a 4-agent council review), all real traps of the old
  per-account `restrictedTo`: (1) `lib/my-tasks-data.ts` decided My Tasks'
  sections with `account.restrictedTo === '/billing?tab=ar'`, so dropping
  that field would have silently handed TCS ACCOUNT/TAX every section;
  (2) `components/MobileNav.tsx` kept its own hard-coded menu that ignored
  every access rule and had drifted from the desktop one; (3) the old
  matcher compared whole paths, so opening `/companies` would still have
  bounced Company 360 (`/companies/123`) — patterns now match segment by
  segment; (4) deny-by-default for unknown paths redirected static files in
  `public/` (`/my-tasks-robot.gif`, `/assets/…`), already breaking them for
  the old AR-only accounts — a path no rule classifies now passes, and
  `test-account-access.ts` fails on any `app/**/page.tsx` without a rule
  instead; (5) `/billing` renders AR Reminder for ANY `?tab=` other than
  `billing`, so the rule normalises the tab the same way. Rules that keep it
  honest: `ApprovedAccount.workspace` is required (a new account nobody
  placed fails to compile, it never defaults to "every page"); the per-
  account flags stay explicit and must agree with the page list for every
  account (moving someone into a department must never silently grant, e.g.,
  the power to create real QuickBooks Estimates); every workspace home must
  be openable (no redirect loop); and the expected access is written out
  route by route for all 21 accounts in `test-account-access.ts`,
  independently of the workspace lists — an unapproved list change fails
  there (negative control: adding Post Incorporate to FINANCE fails both
  Finance accounts). The 切换部门 picker (Vincent + MANAGEMENT) is display
  only: a cookie that `/api/auth/me` validates, shown as the previewed
  department's list ∩ the viewer's own access; proxy.ts, the APIs and the
  assistant never read it. `staff-directory`'s `team` is NOT the department
  (there "Management" = Esther/Chelsea and Cindy is "Partners", and it drives
  SOA-owner/assistant logic), nor is QuickBooks' Department/Location.
- **INV-DATA-070** — Turnover AI files handed from the Projects list to a
  project page (`components/turnover-ai/upload-handoff.ts`; Vincent,
  2026-10-05: drop first, name the client, the files go straight in) must
  be TAKEN exactly once, never peeked: `reactStrictMode` runs effects twice
  in development, and a second read sends every file to extract again —
  every receipt counted twice, and the duplicate check can't flag it because
  both reads race past it. The project page also guards with a ref. The
  in-memory hand-off only survives a client-side navigation; Next does a
  full page reload when the browser's build is older than the server's
  (several deploys a day here), so the target URL carries `?incoming=N`,
  cleared only once the files arrive — if they didn't, the page says "your
  N files didn't carry over — drop them again" instead of showing a silently
  empty project. The project is always created BEFORE any file is read:
  extract reads the project's `gst_enabled` per file and GST can't be
  changed later. And an upload round's progress rows are keyed per file,
  never by file name: keyed by name, two same-named files in one round
  (scans are routinely all "scan.pdf") let the first completion mark both
  done, and the second one's failure never showed. Verified in a harness
  2026-10-05: 2 files → exactly 2 extract calls in dev StrictMode, 105 →
  exactly 100, the lost-files notice, and two "same.pdf" rows showing done +
  their own error.
- **INV-DATA-071** — A restructure that stops writing a column must check
  that column's live constraint, and a write path is only verified against
  the REAL schema, never a mocked API. The Turnover AI Projects restructure
  (7b24883, 2026-10-04) stopped writing `turnover_documents.client_name`,
  but the column stayed NOT NULL with no default (scripts/add-turnover-ai.sql;
  the projects migration only added `project_id`) — so every upload after it
  failed at the document insert, and nobody saw: the projects that looked
  fine ("AAAAAA" etc.) held OLD documents the migration had moved in, and
  every browser check since (that session's and 2026-10-05's) mocked the
  extract API entirely, so no real insert ever ran. Found 2026-10-05 by the
  council reviewing the upload limits; confirmed read-only from the live
  PostgREST schema (`GET /rest/v1/` → `definitions.turnover_documents.required`
  lists `client_name`). Fixed by writing `client_name: project.name` (plus
  `client_company_id`) on insert — harmless whatever the live state. Check:
  for any insert, every column in that table's live `required` list without
  a default must be provided.
- **INV-DATA-072** — A Turnover AI file must either be read in full or say
  plainly why not, and stay visible until fixed. Fixed 2026-10-05 (Vincent:
  "超过约 4.5MB 的文件会被挡、HEIC 照片读不了、读失败的文件在项目页看不到 —
  这个现在处理"; 4-agent council review, each claim re-checked): (1) the
  real upload ceiling is Vercel's ~4.5MB function request body — over it the
  platform answers a non-JSON 413 before the route runs, so the route's old
  15MB check never ran and the file's row showed only a raw JSON parse
  error (the page now reads a non-JSON reply as 413/504 text); local `next dev`
  has no such limit, so only a deployed test proves it. The ceiling is now
  `UPLOAD_MAX_BYTES` (4.4MB) in `lib/turnover-ai-files.ts`, shared by browser
  and server: photos over it are shrunk in the browser (JPEG, longest edge
  2576px — Claude's own working size), PDFs over it are stopped before
  sending with "split it". (2) Claude reads only JPEG/PNG/GIF/WebP images,
  never HEIC; Windows browsers often give a `.heic` no type at all, so files
  are matched by type OR extension, HEIC is converted to JPEG in the browser
  (the browser's own decoder first; where it has none — Chrome/Edge — the
  `heic-to` libheif decoder is fetched on demand; the stored file is then the
  .jpg), and the server decides the type from the file's first bytes and
  refuses raw HEIC with a clear message. (3) A reply cut off at `max_tokens`
  (was 2048 — about two dozen receipts) still parsed, so a fuller file was
  marked done with receipts silently missing: now 8192, and `stop_reason
  === 'max_tokens'` fails the file with "split it". (4) Storage keys are
  ASCII-only (`{documentId}/original.{ext}`) — Supabase rejects non-ASCII
  keys and the old `{documentId}/{file name}` key's failure was swallowed,
  so a Chinese-named e-invoice's original was never stored. (5) A read
  killed by the time limit (now 300s, was 60s) never reaches its catch and
  stays 'processing' forever; it is SHOWN as interrupted after 6 minutes
  (`documentOutcome()`), never written back. (6) Failed and interrupted files
  are listed on the project page with their reason, and the Projects card
  counts them separately instead of as files — both by the one rule
  `isUnread()`. (7) Staff can Remove such a file once it's been dropped
  again (Vincent, same day, AskUserQuestion: "加移除按钮"):
  `DELETE /api/turnover-ai/documents/:id` re-checks on the server that it is
  unread (never one still being read, never a done one) and has no line
  items, then deletes its stored original before the row. Verified in a browser harness
  with a real iPhone HEIC (converted in Chromium to a 1932×2576 JPEG), a 19MB
  photo (→ 2576px, 3.3MB), a 5MB PDF (stopped, nothing sent) and a mocked
  non-JSON 413 (readable message); `test-turnover-files.ts` pins the rules.
- **INV-DATA-073** — Every new table's own migration must turn row level
  security on (`ALTER TABLE … ENABLE ROW LEVEL SECURITY;` — no policy when
  only the server reads it). "Only `createAdminClient()` reads it" is NOT a
  reason to leave it off: that says what THIS app does, while PostgREST
  serves any table without RLS to whoever holds the anon key, and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to every browser
  (`lib/supabase-browser.ts`). The service-role client bypasses RLS, so
  turning it on costs the app nothing. Found 2026-10-05, before the script
  was ever run: `scripts/add-ai-quality-reviews.sql` (staff questions and
  assistant replies about clients) had no RLS line, following the "No RLS"
  notes in `scripts/add-ai-conversations.sql` / `scripts/add-turnover-ai.sql`
  — fixed in the script. The same day, a count-only check (HEAD requests,
  no rows read) compared what the service role and the anon key see for all
  51 tables PostgREST exposes: 37 tables with rows hide every row from anon
  (including `ai_messages` and `ai_conversations`, whose scripts never turn
  RLS on — production does not match those scripts), but 8 are fully
  readable with the anon key: `companies`, `master_list`, `audit_log`,
  `annual_returns`, `late_filing_companies`, `nd_appointments`,
  `nominee_directors`, `sync_log`. Three of those have a policy NAMED
  `service_role_all` that is really `FOR ALL USING (true) WITH CHECK (true)`
  with no `TO service_role`, so it applies to every role (reads confirmed;
  writes deliberately not tested). Not fixed here — several server routes
  (`/api/companies`, `/api/stats`, `/api/nominee-directors`,
  `app/address-service/page.tsx`) read those tables through the anon client,
  and Master List's Realtime subscription watches `master_list` through the
  browser client (see `docs/CURRENT_STATE.md`). Never write a policy like that again,
  and once a new table has rows, run the same anon-vs-service count on it.
- **INV-DATA-074** — Company 360's "no confident QuickBooks invoice match"
  warning (`lib/company-360.ts`) fires ONLY when the closest QuickBooks
  customer name is a plausible near miss — 70–84% similar (`closestNearMiss()`
  in `lib/company-name.ts`; 85 is the match threshold, unchanged) — and it
  names that customer and its score. It used to fire whenever the company's
  search word (its longest word) was shared with ANY other customer. Found
  2026-10-06 on 1 MIDAS VENTURES PTE. LTD., a client added 2026-09-30 with no
  invoices yet: the search word "ventures" pulled in 5 unrelated companies
  (similarity 33–50), none attached (correct), and the page still warned.
  Replayed over all 957 companies: 103 warned, 101 of them only because of a
  shared common word, while 60 companies with no invoices at all showed
  nothing — so the old warning said nothing about whether this company's
  invoices were really missing. Vincent chose the new rule via AskUserQuestion
  ("只在很像时才亮，并写出名字"). The two real near misses are the same company
  spelled differently in QuickBooks (ACG INTERIOR AND EXHIBITION ↔ "ACG
  Interior & Exhibition Pte Ltd"; SOON & GUAN MANPOWER TRAINING ↔ "…Trading Pte
  Ltd"); their invoices were not attached on Company 360 (billing pages
  accept 70), and the warning now says so. The "and" vs "&" half of that was
  fixed the same day (INV-DATA-076): ACG now scores 99 and no longer warns;
  SOON & GUAN (Training vs Trading — a different word) stays the one real
  near miss. Pinned by `test-company-near-miss.ts`.
- **INV-DATA-075** — Typed search text goes into a PostgREST `.or()` filter
  ONLY through `lib/postgrest-or.ts` `ilikeAny()`. A raw
  `` .or(`company_name.ilike.%${text}%,…`) `` reads a comma in the text as the
  start of the next condition, so searching "Han Kun, LLP" — or the real
  client "500 DURIANS II, L.P" — failed with `failed to parse logic tree`: a
  500 from the Companies, Master List and AR Reminder search boxes. Found by
  the council review of 2026-10-06 and reproduced against the live database;
  a bracket or a quote alone never broke it (the review's claim that ")" did
  was wrong, tested). `ilikeAny()` double-quotes the value and escapes `\`
  and `"`; `%` and `_` stay LIKE wildcards. Verified read-only against
  production: 30 ordinary-term comparisons (10 terms x 3 tables) returned the
  same rows as the old string, 10 hard terms x 3 tables were all accepted,
  and the real comma name is found. Guarded by `test-postgrest-or.ts` (fails
  on any `.or(` with `ilike.…${…}`). `.ilike(column, pattern)` takes the
  pattern as its own parameter and was never affected.
- **INV-DATA-076** — A company name written with the word "and" on one side
  and "&" on the other is the same name: `matchScore()`
  (`lib/company-name.ts`) scores 99 for a pair that is IDENTICAL once an
  interior word "and" is ignored, and EVERY OTHER pair keeps exactly the score
  it had (`max(old, 99)` — no score can go down). Why 99 and not 100: QuickBooks
  can hold both spellings as separate customers, and `findCustomer()`
  (`lib/qb-invoice-conventions.ts`, used by create-invoice, create-customer,
  create-quotation, update-invoice and the SOA PDF) needs ONE unique best match
  — with 100 for both the exact spelling and its twin it would tie and return
  null, `create-customer`'s duplicate guard would then let a second QuickBooks
  customer be created, and create-invoice would say "Customer not found"; 99 is
  above every score the overlap and containment rules give and below an exact
  match, so the exact spelling still wins. Only an INTERIOR "and" (a word on each
  side) counts, and only as a whole space-separated word — never a regex, whose
  `\b` also matches inside "andé" or "and/or" — so a leading or trailing "AND",
  "grand" and "sands" never become twins.
  Found 2026-10-06 (Vincent: "都要修好") from ACG INTERIOR AND EXHIBITION
  PTE. LTD. ↔ QuickBooks "ACG Interior & Exhibition Pte Ltd": `normalize()`
  turns "&" into a space but keeps the word "and", so they scored 75 and
  Company 360 (needs 85) never attached that client's invoices. Same cause,
  same day: GARY AND SEVEN FAMILY MUSIC TOGETHER (83). Two things must stay
  true. (1) **`normalize()` is never changed for this.** Its output is
  STORED — `soa_owners.customer_name_norm` and `soa_remarks.customer_name_norm`
  are written by `normalize(name)` (`app/api/billing/soa/route.ts`) and looked
  up by equality (`lib/soa-data.ts`, `lib/soa-remarks.ts`,
  `app/api/soa-owners/audit/route.ts`), and it is the Map key all over billing.
  Dropping "and" inside it would orphan the stored SOA owner and remarks of
  every customer whose name contains "and". (2) **"and" is not dropped from the
  words when scoring, and "&" is not mapped to "and".** Both were tried on real
  data and rejected: dropping it made a renamed company's "原名 … AND …" match
  fall 85 → 43 (REZNOS DESIGN ↔ NORTHWEST DESIGN AND BUILD: the renamed
  company would lose its old-name history) and two probably different sibling
  companies rise 60 → 75 (HONG YANG CONSTRUCTION AND TRADING ↔ HONG YANG
  CONTRACTOR f.k.a. … CONSTRUCTION GROUP), because removing a word shrinks the
  denominator of every pair that contains it; mapping "&" to "and" makes
  unrelated names look closer ("A & B" ↔ "C & D" 0 → 100 on the shared word
  "and"); and re-scoring the "and"-free forms through the overlap rules lowered
  pairs that merely share an "and" (75 → 67, reproduced by the council). Measured with `scripts/diff-company-name-matching.ts` (read-only,
  the working tree against git, over all 956 companies and all 4,788 distinct
  names in the 21 name columns the app matches on): `normalize()` differs for
  0 names; 4,576,372 company × name pairs and 66,349 name × name pairs inside
  the same search-word group changed exactly 2 decisions (ACG 75 → 99, Gary &
  Seven 83 → 99); 3 scores rose, all to 99, 0 fell; no best match and no
  ambiguity changed. Pinned by `test-company-name-and.ts` (real names, the
  exact-spelling-wins tie, the interior-whole-word edge cases, the two
  rejected-design regressions, the real `normalize()` outputs, and a guard that
  `lib/company-name.ts` holds no control characters — a Windows Bash heredoc once
  turned `\b` into a backspace character there and the first version silently did
  nothing). Open, not changed: (1) a QuickBooks name that ABBREVIATES a word is a
  different problem — Q&E SMART HOME SYSTEM AND ELECTRICAL ENGINEERING ↔
  "…Electrical Engrg Pte Ltd" scores 67, so billing, SOA and Company 360 do not
  link them. (2) Found by the council reading the code, to be fixed as its own
  change because it touches stored keys: the SOA Main PIC save writes
  `soa_owners.customer_name_norm = normalize(<company-table name>)`
  (`app/billing/soa/_components.tsx` sends `row.companyName`;
  `app/api/billing/soa/route.ts`) while `computeSoaRows` reads it back by
  `normalize(<QuickBooks customer name>)` (`lib/soa-data.ts`), so for a row whose
  two names normalize differently — ACG is one — a saved Main PIC is not shown
  after reload. No victim yet: all 308 `soa_owners` rows date from the
  2026-09-07 bulk seeding. (3) Unverified, from code reading only:
  `lib/client-comms-resolve.ts` looks invoices up by the display name, so an SOA
  reminder email for such a client may list no invoices and $0.

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

- **INV-AI-012** — The AI answer-quality learning loop's foundation (Unit 2,
  2026-10-05). The design came from the full council of 2026-10-05; Vincent
  chose "行为类自动 + 考试", "存 30 天" and "每周一次". Every later unit must
  keep these rules.
  (1) Reply evidence (`ai_turn_evidence`: each tool's input and result,
  compacted by `compactEvidence`) is written AFTER the reply, in its own
  table, and only once the run has an id (`trackTurnEvidence`). It is never
  a column on the `ai_agent_runs` insert: `recordAgentRun()` returns null on
  ANY insert error, so the reply would lose its `agent_run_id` and the
  quality judge would silently never see it. Post Incorporate identity data
  never enters it (the route already leaves that tool out of
  `toolEvidence`). It is kept 30 days and purged by the nightly
  `/api/ai-quality/review` after its reviews are saved.
  (2) Learned guidance is GLOBAL (`ai_answer_guidance`), never
  `user_memories` (INV-AI-011). At most 8 rules of 280 characters or less,
  oldest first, each expiring after 30 days and never edited in place (a
  change is a new row). It goes in as its own cached system block, between
  the static and per-user blocks, and is left out entirely when there are
  no rules. The table's CHECK allows only the four behaviour categories
  (`tool_routing`, `ask_first`, `caveat`, `format_language`), so a pricing,
  status, client-matching or reminder rule cannot even be stored (CLAUDE.md
  non-negotiables). `GUIDANCE_CATEGORIES` in `lib/ai/answer-learning.ts`
  must stay identical — `test-answer-learning.ts` checks both.
  (3) The master switch (`ai_guidance_switch`) fails CLOSED: if it is off
  or can't be read, no prompt gets any guidance. It takes effect within
  60s (a per-instance cache) and needs no deploy.
  (4) Every evidence row records which guidance ids were in that answer's
  prompt, so a rule is judged by its effect, never assumed to work.
  (5) The judge leaves a reply alone after 3 failed attempts
  (`ai_quality_judge_attempts`).
  Every function here does nothing when its table is missing, so the code
  could be deployed before `scripts/add-ai-answer-learning.sql` ran.
  Not built yet (Unit 3): the reviewer and checker; the replay exam that a
  rule must pass before it goes live; `claude-opus-5` in `lib/ai/pricing.ts`
  before any Opus call; spend caps of US$1 a night and $20 a month; the
  weekly council. Until then the guidance table stays empty and answers are
  unchanged.

- **INV-AI-011** — What the user asked the assistant to remember must
  always reach its prompt, and every memory line must say where it came
  from. The prompt's memory block (`app/api/assistant/route.ts`
  `dynamicSystemPrompt()`) took the 8 most recently seen `user_memories`
  under the header "Things this user has explicitly asked to be
  remembered". Found 2026-10-05 on real data, during the council review of
  Vincent's learning-loop idea: 20 of all 22 memories are `inferred` (AI
  Learning, INV-DATA-019), and the nightly AI Learning keeps refreshing
  their `last_seen`. So on Vincent's own account (2 explicit + 8 inferred)
  his only 2 explicit requests (2026-09-08) were dropped from every prompt,
  and the model was told 8 inferred guesses were his explicit requests.
  Fixed by `lib/prompt-memories.ts`: explicit memories first, then inferred,
  each group newest first, at most 8; every line is labelled `asked` or
  `inferred`, and the header says inferred ones are guesses to hold
  loosely. Pinned by `test-prompt-memories.ts` (its first case is that real
  account's shape). A future learning loop must not reuse `user_memories`
  for global answer guidance — it is per person and its 8 slots are already
  contested.

- **INV-AI-010** — Every paid AI API call this app makes is recorded, ONE
  ROW PER CALL, in `ai_usage_events` (`scripts/add-ai-usage-events.sql`),
  so the only way to call a model is `lib/ai/anthropic.ts`
  `claudeMessages()` or `lib/ai/openai.ts` (`openAIJson`/`openAIText` →
  `callResponses()`), and both REQUIRE an `AiUsageTag` (feature, trigger,
  actor) — a call that doesn't say who it is for does not compile.
  Vincent, 2026-10-05: "为了准确的知道每个人使用了多少TOKENS，我要有一个明确
  的实时记录"; his decisions: only he sees the usage; under View As usage
  counts for the person who pressed the button ("算真正操作的人"), the viewed
  account noted beside it; automatic calls a person causes (the My Tasks
  brief on opening the page, the learning pass after their chat) count
  under them, shown apart ("算本人，单独标「自动」"); USD. What keeps it
  accurate:
  (1) Per CALL, written the moment its response arrives
  (`trackAiUsage()` starts the insert at once and hands it to `after()`) —
  never per chat question: one question is up to 7 billed calls (OpenAI
  router, up to 4 Claude rounds, OpenAI synthesis, the learning pass), and
  one that fails in round 3 was still billed for rounds 1–2.
  `ai_agent_runs` (assistant only, written once at the end, and under View
  As it holds the VIEWED account) cannot be the ledger.
  (2) The same four token buckets for both providers
  (`lib/ai/usage-ledger.ts` `normalizeUsage()`): Anthropic's
  `input_tokens` EXCLUDES cache reads/writes, OpenAI's `input_tokens`
  INCLUDES cached tokens and `output_tokens` includes reasoning. The
  assistant re-sends a ~19K-token cached prompt every round, so logging
  `input_tokens` alone would miss most of it, and summing the buckets
  naively makes cheap cache reads (0.1x) look like the bulk — hence tokens
  AND estimated cost.
  (3) Cost is a snapshot: `lib/ai/pricing.ts` (the providers' official
  pages, 2026-10-05) is applied when the row is written and stored with
  `price_version`, so a price change never rewrites past rows. A model not
  in the table gets NO cost, never a guess. Web search: $10 per 1,000 on
  both providers.
  (4) Attribution: `actorEmail` is always the real signed-in person
  (`realAccount`, never the View-As `account`). Scheduled jobs use
  `lib/ai/job-usage.ts` `scheduledJobUsage()`: the real CRON_SECRET means
  the system (no actor), a person's own button counts under them.
  (5) Recording never breaks the call it records: errors are swallowed and
  logged, and until the SQL is run the missing table is skipped quietly.
  Limits: a request cut off by its own timeout returns no usage and can't
  be recorded, though the provider may bill it. The providers' consoles
  (one shared key) can't split usage by person, so they only check the
  ledger's totals. Never store prompt or reply text in the ledger.
  `test-ai-usage.ts` guards all of this, including that no file other than
  those two calls `api.anthropic.com`/`api.openai.com` directly.
  The ledger is read by Admin › AI Usage (`app/ai-usage`,
  `GET /api/ai-usage`, `lib/ai/usage-report.ts`): per person and per
  feature for today / 7 days / this month in SINGAPORE time (a window
  starts at SGT midnight, not UTC), calls with no person shown apart as
  system (cron) or unidentified, the person's automatic calls in their own
  column, and an unpriced call shown as "+?", never as $0. Vincent only,
  through its OWN flag `canViewAiUsage` (not `admin` — giving someone
  admin must not also show them everyone's usage): the `ai-usage` page
  rule in `lib/workspaces.ts` gates the page, and the API checks the flag
  itself because APIs are not gated by department.

- **INV-AI-009** — `PAGES` (now `lib/assistant-pages.ts`) is the
  assistant's ONLY map of the app (rendered into the static prompt's
  "System map" and used by `intentAnswer()`'s keyword navigation). A page
  that ships without being added there is a page the assistant will
  confidently say does not exist. Found live 2026-09-28: Billing System ›
  Quotation (`/billing/quotation`, shipped 2026-09-24) was never added;
  Vincent asked "Hi Quotation 怎么样使用" and Claude answered "我这边系统里
  没有单独一个叫「Quotation」的模块/页面" with ZERO tools called
  (`ai_messages` 310 / `ai_agent_runs` 8). The generic capability-denial
  guard (INV-AI-004) did not fire because the reply was phrased as a
  clarifying question, which that guard deliberately exempts. Fixed by
  adding the page to `PAGES` with an `access` predicate
  (`canViewQuotation`) plus a how-to paragraph in `staticSystemPrompt()`.
  A gated page must carry `access`: the static (cached, shared) map only
  flags it as restricted, `dynamicSystemPrompt()` states per request
  whether THIS account can open each restricted page, and `pagesFor()`
  hides it from the fallback engine's navigation for everyone else — so a
  staff member is told the page isn't open to them instead of being handed
  a link `proxy.ts` will bounce. Rule: a new page (or a new gate on an
  existing one) updates `PAGES` in the same change.

  Completed the same day (Vincent: "要，一次补全"): 21 more real pages had
  never been added (SOA ×4, TAO billing, Reports, My Tasks, Post
  Incorporate, Trademark ×2, EOT, Email Templates, SG News, Turnover AI ×3
  — shipped that very day — Proposal Generator, and the 4 Admin pages).
  The map moved out of `route.ts` into `lib/assistant-pages.ts` so it can
  be tested: `test-assistant-pages.ts` fails if any `app/**/page.tsx` has
  no entry (only login, redirect-only routes and the per-company
  `/companies/[id]` are exempt), if a flag-gated page rule lacks the same
  gate in `access` (or an ungated page carries one), or if a real account
  sees the wrong pages (`canOpenPage()` goes through
  lib/approved-accounts.ts's `canAccountOpen()` — since the 2026-10-04
  department split that is lib/workspaces.ts's one rule, INV-DATA-069, the
  same check proxy.ts, the menus, this map and the assistant's billing tools
  all call; `pageAccessLine()` now names the account's department and lists
  exactly what it can and cannot open). Each entry now carries a
  one-line `desc` of what the page does. Keyword navigation now takes the
  MOST SPECIFIC matching keyword (`matchPage()`), not the first entry in
  list order — the bare 'ar' keyword used to claim anything containing
  "ar" ("turnover summary", "share transfer").

  Caught for real within the hour (2026-09-28 → fixed 2026-10-04): commit
  `328acfd` consolidated Turnover AI's Inbox / Review Queue / Summary
  routes into one `/turnover-ai` page with tabs and moved the `proxy.ts`
  gate to that path, without touching the map — so the assistant kept
  offering three dead links. `test-assistant-pages.ts` flagged it (the
  new route unmapped, the three old entries pointing at nothing, the
  gate unmatched). Run it whenever a page is added, moved, merged or
  re-gated, not only when the assistant itself changes.

- **INV-AI-008** — A knowledge tool added to the My Tasks assistant has
  three traps, all found 2026-09-28 while adding `get_sop_guide` (the
  secretarial team's client-communication SOP, `lib/client-comms-sop.ts`),
  none of which would ever surface as an error:
  (1) `claudeAnswer()` cuts every tool result to
  `JSON.stringify(result).slice(0, 6000)` before the model sees it, so a
  payload over 6000 chars reaches the model as truncated, invalid JSON —
  and the `note` carrying the tool's caveats sits LAST in every object, so
  it is the first thing cut. Build the exact payload in a pure module and
  test its real size (`test-sop-guide.ts` holds every SOP topic ≤ 5600;
  the largest, `annual_return`, is ~4.8K).
  (2) `lib/ai/orchestrator.ts` only keeps a turn on Claude
  deterministically when it matches `INTERNAL_TERMS`/`MUTATION_TERMS`;
  anything else goes to the learned router, which may pick `openai_only` —
  and that path has no Claude tools at all. SOP questions often name no
  company or client ("股份转让要准备什么", "S156 是什么"), so they could
  silently get a web answer instead of Tassure's own SOP. Such a tool needs
  its own terms in the deterministic guard (`SOP_ROUTING_TERMS`, checked by
  `isInternal()` everywhere `INTERNAL_TERMS` used to be), per INV-AI-003.
  (3) Vincent's rule for this knowledge (2026-09-28: "先上流程和文件解释，
  日期/金额等确认后补"): the source document's specific dates, fees,
  penalties, tax rates, monetary thresholds and statutory deadlines are
  NOT shipped until the team confirms them — `PENDING_REVIEW` names each
  held-back part by title only, and the tool note tells the model never to
  present a figure for those as Tassure's position (Tassure's own prices
  come only from `service_pricing_lookup`). `test-sop-guide.ts` fails if a
  held-back figure (e.g. the AR penalty, the ND fee, the DPO fee, tax
  tiers) appears anywhere in the payload. When one is confirmed, move it
  into `SOP_SECTIONS` and drop it from `PENDING_REVIEW` in the same change,
  updating the test's list.

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
  reviews.sql` (found never run on 2026-10-05 — PGRST205 — and run by
  Vincent the same day, now with RLS on, INV-DATA-073). Without the table the route does
  not crash, but that is worse than it sounds: each candidate is still
  judged — a paid call — and only then fails to insert, so nothing is ever
  marked reviewed and the same replies are paid for again on every run.
  Daily cron `0 23 * * *` (`vercel.json`) — it could not run at all until
  `/api/ai-quality/review` was added to `proxy.ts`'s `CRON_PATHS` on
  2026-10-05 (INV-CRON-011) — plus a manual "立即抽查" button on
  `/ai-quality` for an on-demand run. The page and the reviews API
  (`/api/ai-quality/reviews`, `/[id]`) are gated on `account.admin`
  (Vincent-only today), same as `/ai-learning`. The run route itself
  (`GET /api/ai-quality/review`) was NOT until 2026-10-05 — any signed-in
  account could start a paid run by opening its URL; it now takes the exact
  `CRON_SECRET` or an admin account (INV-CRON-018).

  **Hardened 2026-10-05, before its first real run** (pure part in
  `lib/ai-quality/judge.ts`, pinned by `test-ai-quality-judge.ts`): (1) The
  judge asked `claude-sonnet-5` for `max_tokens: 800` with no `thinking`
  setting — Sonnet 5 thinks by default and thinking counts toward
  `max_tokens`, so the JSON verdict could be cut off; it now sends adaptive
  thinking at `effort: "low"` with `max_tokens` 4000 (billed per token used),
  and a `max_tokens` or `refusal` stop throws instead of yielding a guessed
  verdict. (2) Errors used to vanish: the summary only counted them and a
  failed run read "ai_quality_review failed."; the first three messages now
  go into `errorSamples`, and a failed run records the first as its error.
  (3) The batch throws before any judge call when it can't read
  `ai_quality_reviews`, instead of paying to judge replies it can't save.
  (4) It stops starting judge calls after 90s (the route's limit is 120s and
  a platform kill skips cleanup — INV-CRON-008); the rest stay unreviewed for
  the next run (`skippedForTime`). A reply whose judge call fails is still
  re-tried, and re-billed, on later runs — there is no attempt cap yet.
  Same day, after the council review of the learning loop: (5) the rubric
  gained `over_caution` — a judge that only lists defects pushes the
  assistant toward hedging, so the flag rate could fall while answers got
  worse; (6) replies whose run is `intent_fallback` (the generic menu shown
  when the Claude call itself failed) are skipped before sampling and counted
  as `skippedFallback` — they are not the model's answer, and their real
  error is in `ai_agent_runs.error`; (7) a failed `ai_agent_runs` read stops
  the batch, since without it every reply would look like it called no tools.

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
  Anthropic call — since 2026-10-05 made only through `lib/ai/anthropic.ts`
  `claudeMessages()`, which sends the same request claudeAnswer() always
  did and records its usage (INV-AI-010; never a raw `fetch`) — never
  `lib/ai/openai.ts`'s multi-model path, UNLESS that OpenAI path's
  production config has been
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
- **INV-DOC-022** — HTTP header values must be Latin-1: `new Response()`
  throws `TypeError: Cannot convert argument to a ByteString` for any
  character above U+00FF. The SOA PDF route named its download "SOA -
  ${companyName} - date.pdf" in `Content-Disposition`, so for a
  Chinese-named client (思店科技(杭州)有限公司, 江苏日月照明电器有限公司) it
  did all the work and then crashed on its last line — a 500, the SOA
  page's download badge turned red, and Draft Email (which attaches the same
  PDF) failed too. That had been true since the route shipped; found
  2026-10-05 when Vincent clicked the badge to check the Chinese cover-page
  fix. Every `Content-Disposition` is built ONLY with
  `lib/content-disposition.ts` `attachmentDisposition()` (an ASCII
  `filename` fallback plus the RFC 6266/5987 `filename*` with the real
  UTF-8 name), and every downloader reads it with `filenameFromDisposition()`
  (prefers `filename*`). All 10 download routes and 4 downloaders were
  switched; at risk besides SOA were the Turnover AI export (project name)
  and the post-incorporation pack (company name). Any other header carrying
  data must go through `headerDetail()` (URI-encoded, cut by whole
  characters, bounded): a bare `encodeURIComponent(x.slice(0, 1500))`, which
  the `X-Soa-*` and `X-Client-Invoice-Fallback` headers used until
  2026-10-06, throws URIError when the cut splits an emoji or a rare Chinese
  character (CJK Extension B) — the same crash on the same last line. The
  council review (4 of 4 members) found it and it reproduces. Three more
  guards from that review: the SOA route answers any throw as JSON (the page
  only ever said "Unable to generate the combined PDF"), the grouped TAB TAC
  chip shows each book's error on hover (the single-book badge always did),
  and the cover's Chinese-font fallback is no longer silent (a log line plus
  `X-Soa-Cover-Font-Fallback`, which the page turns into a warning). Guarded
  by `test-content-disposition.ts` (fails on a hand-built header in any
  letter case, on an X-* header that encodes free text by hand, and on a
  lone surrogate) and `test-pdf-chinese-text.ts`.
- **INV-DOC-023** — An ALL-mode SOA Draft (the All page's Draft Email and the
  assistant's SOA card — `buildSoaDraft`) asks TAB, TAC and TAO for their own
  SOA PDF and attaches each that answers. Only a **404** — the route's "No
  outstanding invoices found" — may be left out: that book owes nothing for
  this client. Any other failure (a 500, a timeout, a network error) used to
  be skipped the same way (`catch { return null }`), so a statement the
  client owes could silently be missing from a collections email; Vincent
  chose "改成明确报错" on 2026-10-06 (council review of the red SOA download
  chip). The draft now stops and names the book (`lib/soa-book-pdfs.ts`
  `settleBookPdfs`; the client raises `SoaPdfError` with the HTTP status; a
  plain Error that merely says "404" is not trusted). Honest scope: this was
  NOT what hid the Chinese-name outage — both books failed for those
  clients, so the draft already errored visibly — it closes the
  partial-failure path. Guarded by `test-soa-book-pdfs.ts`.

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
