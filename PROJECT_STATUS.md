# TASSURE Invoice - Shared Project Status

Last updated: 2026-07-17

## Purpose

This file is the shared handoff record for Codex and Claude Code. Before making
changes, read this file together with `git status`, `git log -5`, and the diff.
After completing a meaningful unit of work, update the sections below and make
one focused Git commit.

## Current state

- Application: TASSURE Invoice / Billing Automation Dashboard
- Location: `C:\Users\vincent\tassure-invoice`
- Stack: Next.js 16.2.9, React 19, TypeScript, Supabase, Playwright
- Branch: `main`
- Git remote: `https://github.com/enquiry-commits/Tassure-Invoice.git`
- Working tree at handoff creation: clean and aligned with `origin/main`
- Vercel project name recorded locally: `tassure-invoice`
- Vercel note: the local `.vercel` link currently cannot retrieve project
  settings with the active Vercel account. Confirm the correct Vercel team and
  relink before using `vercel --prod`.

## Latest completed work

- Corrected QuickBooks custom-number creation so TAB/TAC invoices always send
  the latest validated numeric DocNumber and never send the literal
  `AUTO_GENERATE`. Exact-number reservations now serialize concurrent system
  users, live duplicate checks run again immediately before the QB create, and
  reservation persistence failures are surfaced instead of being ignored.
- Reconciled the four affected TAB invoices after confirming their QB IDs,
  companies, and totals: 19161-19164 now consistently use 02610852-02610855 in
  `generated_invoices`, invoice reservations, synced QB invoices, and line
  items. All four reservations are finalized as `created`; no legacy automatic
  placeholder remains in either local billing-history table.
- Improved invoice PDF saving: folder selection requests write access before
  showing a saving state, user cancellation is handled separately, and a
  blocked/network folder automatically falls back to a normal browser download
  with an accurate result message.
- Fixed AR Reminder ND details so the newest active TeamWork appointment always
  supplies the director name even when QuickBooks already supplies the ND
  billing period and rate. Older duplicate appointment rows can no longer
  replace the current director.
- Rebuilt the complete Chinese user manual as a formal 29-page monochrome
  document. The cover and document furniture are black on white; only the
  TASSURE logo and 19 verified production screenshots retain colour. The
  screenshots now cover login, Dashboard, Companies, every Master List page,
  ND, Address Service, AR List/Table/detail/history, Late Filing, Billing
  Drafts, invoice generation, and Automation Health. The PDF was rendered page
  by page and checked for A4 sizing, metadata, bookmarks, clickable contents,
  blank pages, clipping, out-of-bounds objects, screenshot fidelity, and
  pagination. Production screenshot source files remain local under untracked
  `tmp/` for confidentiality; the completed PDF and generator are versioned.
- Mapped approved Google login accounts to the existing TAB and TAC QuickBooks
  Locations and now writes the signed-in user's configured Location onto newly
  generated invoices without creating any new QB Location records.
- Implemented the first authentication phase using Supabase Google OAuth: a
  minimal bilingual sign-in screen, approved-account admission, persistent
  sessions, protected pages/APIs, account display, and logout. Supabase Google
  Provider activation and its Google OAuth credentials are still required.
- Added the 12-person Google account allowlist with canonical staff
  display names; all approved accounts currently share the same access level.
- Corrected AR Reminder SEC PIC values that contained TeamWork numeric user IDs,
  updated affected company master records, and added ID-to-name normalization
  for newly generated reminder rows.
- Imported the Google Drive workbook's January, February, and March 2026 AR
  Reminder batches into Supabase: 15, 17, and 62 rows respectively.
- Unified AR Reminder and Late Filing UEN typography with the system UI font
  used by other pages instead of monospace.
- Restored Late Filing FYE values to plain text while keeping Late FY and AGM
  due-date semantic pills.
- Increased Late Filing page top padding and vertical spacing between its
  header, risk cards, year filters, and table.
- Standardized populated Companies ND and Address Service pills as green active
  states while retaining grey pills for missing or inactive services.
- Converted Companies Nominee Director and Address Service cells into semantic
  service pills for both active and inactive states on desktop and mobile.
- Replaced Companies status badges with consistent semantic status pills using
  solid dots, soft fills, thin borders, and lifecycle-specific colors.
- Converted the standalone Companies summary cards to the same auto-fitting
  full-width grid used by Master List and AR Reminder.
- Changed shared Master List category cards from fixed-width flex items to an
  auto-fitting full-width grid across all Master List pages.
- Combined narrow Active Client FYE mismatches into one editable two-source
  pill showing manual FYE and TeamWork month without vertical text wrapping.
- Reorganized the Dashboard as a spacious bento layout with distinct Command,
  Portfolio Pulse, Planning, Annual Rhythm, and Coverage zones.
- Refined the Dashboard with a restrained premium palette of deep navy, muted
  teal, bronze, slate blue, soft plum, and brick rose across cards and charts.
- Rebuilt the Dashboard into a portfolio command centre with an executive
  summary, KPI navigation, action queue, and complete use of dashboard data.
- Added a dedicated centered Billing Status column to Billing Draft, moving To
  invoice/Invoiced out of Company and using the released company-column space.
- Matched the Billing Draft header's four-pixel column gap to the body grid,
  eliminating the cumulative horizontal offset after the Company column.
- Moved the Billing Draft header into the same scroll container as its rows so
  scrollbar width can no longer shift header and body grid tracks apart.
- Restored Billing Draft group dividers as non-layout background lines so the
  centered headers and contents remain on the exact same vertical axes.
- Corrected Billing Draft optical alignment by removing offsetting cell
  dividers and standardizing all centered status cells to the same full width.
- Centered all Billing Draft columns except Company and PIC, including matching
  header and row-content alignment.
- Reduced the Billing Draft company column and arranged Renewal and Annual
  status pills horizontally within their wider dedicated columns.
- Simplified Billing Draft status spacing to match the AR Reminder list: clean
  white rows, borderless pill groups, subtle dividers, and generous whitespace.
- Restyled the five Billing Draft status columns as semantic pills for renewal
  services, ND, annual obligations, TAB invoices, and TAC invoices.
- Standardized Late Filing FYE, Late FY, and Next AGM Due values as semantic
  status pills, including an integrated overdue state.
- Redesigned the AR modal Nominee Director area as an explicit interactive card
  with director-detail disclosure and clearly explained workflow flag controls.
- Restyled AR due dates as semantic status pills matching the Services visual
  language, with soft colors, thin borders, rounded shape, and status dots.
- Removed dashed auto-state borders from the AR modal service panel and expanded
  spacing throughout for a calmer, less crowded layout.
- Refined the AR modal service configuration into a lighter pill-based layout
  while preserving all state guidance and billing warnings.
- Upgraded the AR detail modal service controls into a prominent review panel
  with automatic versus adjustable groups, state labels, legend, and guidance.
- Refined AR Reminder services into a compact active-only summary with
  service-specific colors and reduced whitespace.
- Redesigned AR Reminder list services into a bordered 4x2 service panel inside
  a separately spaced company card, improving company-to-service grouping.
- Added a Resolved archive to Late Filing. Under Review rows now use a teal
  check action that retains the record instead of deleting it.
- Added independently collapsible SEC/ACC/TAX PIC columns to AR Reminder; SEC
  defaults open while ACC and TAX default collapsed.
- Tightened AR Reminder workflow columns: UEN is 70px; Reminder through ROND
  RONS are 90px; renamed SW Update to TW Update.
- Reduced the Active and FYE columns to 60px on Active Client only; shared
  Master List pages retain their default 220px and 180px widths.
- Made the AR Reminder table header stay fixed while table rows scroll.
- Fixed editable-column type checking for `in_teamwork`.
- Tightened the Non-TeamWork filter to match by UEN.
- Added the Master List Non-TeamWork filter card.
- Added TAC Invoice fallback to the latest historical ND invoice.

## Work in progress

- None at the time this handoff file was created.

## Next actions

1. Confirm the correct Vercel account/team for the existing project.
2. Relink the local directory only after confirming the target project.
3. Run `npm run build` before any production deployment.
4. Record the deployment URL and verification result here.

## Collaboration rules

1. Only one agent edits this repository at a time.
2. Before editing, run `git status --short --branch` and inspect existing diffs.
3. Never overwrite or discard changes whose owner or purpose is unclear.
4. Keep secrets in `.env.local`; never copy secret values into this file,
   commits, chat messages, or logs.
5. Make focused commits after verified units of work. Do not push or deploy
   unless Vincent explicitly requests it.
6. After each unit of work, update this file with:
   - completed changes;
   - files or modules affected;
   - verification performed;
   - remaining work or known risks;
   - deployment status, if applicable.

## Handoff log

### 2026-07-17 - Codex (QB invoice recovery and ND/PDF fixes)

- Removed the invalid `AUTO_GENERATE` QuickBooks DocNumber flow and replaced it
  with live next-number validation, an exact Supabase reservation, and a final
  pre-create duplicate check. Retry and local-persistence failures now retain a
  visible reconciliation trail.
- Read back QB and Supabase before mutation. QuickBooks had already been
  manually corrected, so QB was not changed. Repaired only the matching local
  `generated_invoices` and `invoice_creation_reservations` rows for QB IDs
  19161-19164, then verified numbers 02610852-02610855, status `created`, exact
  totals, null errors, and zero remaining `AUTO_GENERATE`/`AUTO-*` placeholders.
- Made invoice PDF saving resilient to unsupported or non-writable network
  folders by downloading through the browser when direct folder writing fails.
- Merged TeamWork's newest active nominee-director name into the AR billing
  detail independently of whether a QB-derived billing period already exists.
- Verification: `npm run build` completed successfully; targeted ESLint reported
  zero errors (six pre-existing unused-code warnings in Billing); `git diff
  --check` passed. No push or Vercel deployment was performed.

### 2026-07-17 - Codex

- Added Chelsea Ang (`chelsea@tassure.com`) to the Google login allowlist and
  AR Reminder Realtime RLS policy source. A read-only QuickBooks Department
  lookup confirmed an active `Chelsea Ang` Location in both TAB and TAC; her
  login now maps to those two existing records without creating a new Location.
- Replaced all illustrated/anonymised manual figures with real screenshots
  captured from the signed-in production system on 17 Jul 2026.
- Added screenshot coverage for Google sign-in, Ad-Hoc, MAS, Strike Off,
  Terminated Services, Change Co Name, and AR Reminder History.
- Restyled the cover, headings, tables, callouts, captions, headers, and footers
  to black-and-white; only the logo and system screenshots retain colour.
- Updated the manual to version 1.1 and regenerated
  `output/pdf/Tassure-Corporate-Services-System-User-Manual-ZH.pdf`.
- Verification: Python syntax check; 29 A4 pages; 29 top-level PDF outlines;
  156 link annotations; no blank pages, clipped text, or out-of-bounds images;
  all 29 rendered pages visually reviewed, including full-size checks of the
  screenshot-heavy login, Master List, AR, Billing, and Automation pages.
- Production screenshot PNGs are intentionally left untracked under
  `tmp/manual-screenshots-real/`; no push or deployment was performed.

### 2026-07-15 - Codex

- Imported 94 AR Reminder records from `AR FYE 2026 - 18.06.2026.xlsx` for
  January (15), February (17), and March (62). Verified every target month has
  unique, nonblank UENs and spot-checked workflow dates, PICs, remarks, invoice,
  and email-sent values. Non-date labels found in date columns are preserved in
  Remarks as `Source status` notes.
- Added `scripts/import-ar-reminder-workbook.py`, which is dry-run by default,
  validates the expected source counts, resumes by UEN/name after interruption,
  and imports through the local AR API. AR POST now accepts `fye_date`.
- Removed monospace styling from UEN values in AR Reminder list/table/mobile/
  modal views and the Late Filing UEN column; sizes and colors are unchanged.
- Removed the status-pill treatment from Late Filing's FYE column only; Late FY
  and New AGM Due/Overdue remain semantic pills.
- Opened up Late Filing's vertical rhythm with 12px page-top padding, taller
  summary cards, 24px section gaps, and a larger header-to-content gap.
- Updated Companies service semantics so any populated ND or active Address
  value is green; empty ND and unused Address values remain grey.
- Added reusable Companies service pills: populated ND names and active address
  services use green, while unavailable services use quiet grey.
  Desktop and mobile now share the same visual language.
- Standardized Companies Active, Striking Off, Terminated, and Pending Sync
  states as semantic pills; removed emoji/gradient-style status indicators.
- Updated Companies separately from the shared Master List component: all seven
  category cards now distribute across the full page width and wrap responsively.
- Made all five shared Master List category cards divide the full available
  page width like AR Reminder, while retaining responsive wrapping on narrow
  screens. This applies to every page using `MasterListTable`.
- Added a compact integrated FYE mismatch component for columns at or below
  80px: manual `FYE MMM` and warning `TW MMM` now share one clickable pill;
  wider Master List pages retain their existing comparison layout.
- Rebuilt Dashboard information architecture to eliminate card stacking: paired
  Command and Action centres, added section-level visual pauses, enlarged chart
  canvases, increased gaps, and separated Planning, FYE, and Coverage zones.
- Replaced the Dashboard's saturated SaaS palette with a centralized muted
  professional-services palette and applied it consistently to the hero, KPIs,
  action queue, donut, service mix, FYE, and nominee charts.
- Redesigned the Dashboard with a responsive executive summary, five linked KPI
  cards, six-month AR workload, action centre, client-status donut, service mix,
  FYE calendar, and nominee-director workload. Existing API data remains the
  source of truth; no synthetic metrics were added.
- Split Billing Draft invoice state into a new 110px Billing Status column with
  semantic pills and reduced the Company column's minimum width to 180px.
- Corrected the final Billing Draft grid mismatch: body rows had a four-pixel
  column gap while the header did not; both grids now use identical parameters.
- Fixed the remaining Billing Draft header/body mismatch by making the header a
  sticky row inside the body scroller with the same three-pixel left geometry.
- Restored visual separators before Renewal and TAB using background gradients;
  unlike borders, these consume no width and do not offset centered content.
- Fixed apparent Billing Draft misalignment caused by Renewal and TAB left
  dividers/padding; all centered cells now share identical full-width geometry.
- Center-aligned FYE, Renewal, ND, Annual, TAB, and TAC in Billing Draft while
  retaining left alignment for Company and PIC.
- Rebalanced Billing Draft desktop widths: the Company column now uses less
  space while Renewal and Annual service pills stay on one horizontal line.
- Refined Billing Draft desktop rows to mirror the AR Reminder list language:
  removed nested status cards, kept semantic pills, and used subtle dividers,
  white rows, wider columns, and calmer spacing.
- Unified Billing Draft service and invoice states with rounded semantic pills,
  including explicit grey `Not issued` states for empty invoice columns.
- Added a reusable Late Filing `SemanticStatusPill` and applied it to FYE, Late
  FY, and Next AGM Due. Overdue text is now integrated into the red due-date
  pill; future due dates use green.
- Made the Nominee Director service card visibly interactive even without a
  service period. Added a View/Hide director affordance, TeamWork source label,
  and descriptive Strike-Off Pending / ND Assignment Pending state cards.
- Converted AR due-date badges (including Filed) into reusable-style semantic
  status pills. Urgency colors and day calculations are unchanged.
- Simplified the service-state visual language by replacing dashed borders with
  solid borders; AUTO/MANUAL/OFF labels now carry the meaning. Increased panel,
  section, label, and chip spacing for improved readability.
- Simplified the AR modal service configuration visual treatment: removed heavy
  nested colored panels, restored service-specific pills, and reduced state
  information to compact badges, dividers, and a subtle billing reminder.
- Redesigned the AR detail modal's service configuration as a billing-critical
  review panel. System services are clearly locked, adjustable services expose
  AUTO/MANUAL/OFF states, and a legend plus action guidance explains the colors.
- Replaced the heavy nested service grid with a compact active-only service
  summary. Reduced the oversized company column, removed inactive service noise,
  and used service-specific pill colors; service data and ordering are unchanged.
- Restyled the desktop AR Reminder list: each company is now a distinct card,
  and its fixed service slots sit in a dedicated 4x2 panel with clearer active
  and inactive states. Service logic and ordering are unchanged.
- Added the Late Filing Resolved category. Resolving an Under Review row changes
  its persisted remark from `Review:` to `Resolved:` and retains it for history;
  other manual rows keep their existing delete action.
- Added PIC column collapse controls to AR Reminder. Expanded columns are 100px;
  collapsed columns remain as identifiable 34px tabs. SEC defaults expanded,
  ACC and TAX default collapsed.
- Updated AR Reminder table column widths and renamed the SW Update header to
  TW Update; underlying `software_update` data behavior is unchanged.
- Added per-page Master List column-width overrides and set Active Client's
  `status` column to 60px without changing the shared default.
- Set Active Client's `fye` column to 60px without changing the shared 180px
  default used by other Master List pages.
- Added a bounded vertical scroll area to the AR Reminder table so its sticky
  header remains visible; preserved the existing horizontal scrollbar and
  sticky identity columns.
- Refined AR Reminder desktop column sizing: row number is 30px, company is
  200px, UEN is 80px, and the ten workflow columns are 100px each. Updated the
  sticky identity-column offsets to match.
- Added a live Dashboard Excel export. The generated dated workbook contains
  two filterable sheets: all current Active Client master-list records and all
  non-excluded AR Reminder records, with readable column sizing.
- Restricted QuickBooks PIC Class assignment to Secretary and XBRL invoice
  lines only. Address, AR, ND, Accounts, Tax, discounts, and other services no
  longer inherit the company PIC when sharing an invoice.
- Added TAC PIC handling through the Nominee Director service item rather than
  a QuickBooks Class. Active ND names now resolve to their service shorthand
  (for example `Nominee Director Fees - WKX`) and are shown in the TAC draft.
- Consolidated TAC ND billing into one draft line. The named Nominee Director
  fee and its matching deferred ND fee are summed from the same prior invoice,
  while the generated line keeps the named ND item and one-year period text.
- Made the latest active TeamWork nominee appointment authoritative for TAC PIC
  and service shorthand. QuickBooks history is used for fee totals and periods,
  but never overrides the current TeamWork-appointed director.
- Added editable live QuickBooks invoice-number fields beside the TAB and TAC
  draft headers. Both numbers are fetched from their QB realms, revalidated
  together before creation, checked for manual-override duplicates, and safely
  refreshed with a conflict warning if another QB invoice advances a sequence.
- Added post-creation QuickBooks invoice PDF saving. Successful TAB/TAC results
  can fetch their official QB PDFs and save one or both directly into a folder
  selected by the user, with a normal browser-download fallback.
- Restored PDF actions when reopening an already-invoiced Billing Draft by
  returning the persisted QB invoice id for current-cycle TAB/TAC invoices,
  rather than relying only on temporary state from the creation response.
- Verification: `npm run build`.
- Established shared Codex / Claude Code collaboration files.
- No application source code was changed.
- Confirmed the repository was clean before creating the handoff files.
