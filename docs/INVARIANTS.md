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
