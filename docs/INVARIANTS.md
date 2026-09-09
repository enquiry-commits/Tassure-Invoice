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

- **INV-DATA-017** — `user_memories` (added 2026-09-08, from Vincent's
  shared AI-assistant blueprint) may ONLY be written to through an
  EXPLICIT, user-initiated path — today that's the assistant's
  `remember_this` tool, which its own system-prompt instruction fires
  only when the user directly asks to be remembered/noted (`app/api/
  assistant/route.ts`). Never wire automatic pattern-mining from
  `user_activity_events` (or conversation tone/sentiment) into a write to
  this table — the blueprint that introduced this schema explicitly warns
  against exactly that shortcut ("AI 不应因为一次对话就永久定义用户";
  "用户的一次情绪性表达不应被直接写成永久性格或偏好"). The schema's own
  `source` column (`'explicit' | 'inferred'`) exists so a FUTURE, properly
  confidence-scored auto-learning pass (the blueprint's own Phase 3) can
  be added later without a migration — but until that pass exists and is
  deliberately built, `'inferred'` should never actually appear as a
  written value.

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
  2026-09-08, `lib/ai-learning/candidates.ts`'s `analyzeUserActivity()`)
  is a DELIBERATE, negotiated exception to INV-DATA-017's "explicit only"
  rule for `user_memories` — not a contradiction of it, and not a
  precedent for lowering the bar further without going back to Vincent.
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
