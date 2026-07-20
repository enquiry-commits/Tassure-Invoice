# TASSURE Invoice - Shared Project Status

Last updated: 2026-07-20 (Client Communications: invoice PDF attachment)

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

- Client Communications: Campaign Centre now previews the resolved company
  list and lets a reviewer edit it BEFORE anything is written, instead of
  generating drafts directly from an opaque auto-resolution. Follow-up
  polish: delete actions use the app's existing `ConfirmDeleteModal` (red
  icon, real confirm dialog) instead of a browser `confirm()`; the review
  table's To field is directly editable for companies with no email on
  file; a CC column was added; and both fields accept more than one
  address (comma- or semicolon-separated — normalized to RFC 6068 commas
  when the Outlook mailto: link is built in Draft Review). See the
  2026-07-20 (review-before-generate) handoff entry below for the full
  design and files touched.

- Fixed a broken seed in `scripts/add-client-communications.sql` (the 3
  default-template INSERTs declared 5 columns but selected only 4 values,
  missing `is_default` — Postgres rejected it and Supabase's SQL editor
  rolled back the WHOLE script, including the CREATE TABLE statements,
  since it runs as one transaction). Vincent re-ran the fixed migration
  successfully; all 4 tables + seed data confirmed present.
- Fixed Draft Review's first-run UX: an empty campaign list showed a
  blank `<select>` and "No drafts in this view" with no explanation.
  Now shows a proper empty state with a link to Campaign Centre, gated
  on a dedicated loading flag so it can't flash before the initial
  fetch resolves.
- Imported the historical `BULK.xlsm` records (`scripts/import-bulk-
  history.js`) into Client Communications so Delivery History starts
  populated instead of empty: 1914 drafts across 5 campaigns (List_soa2
  had no real rows). See the 2026-07-20 handoff entry for the full
  parsing approach and caveats (invoice-company attribution, "UNKNOWN"
  prefix on unparseable free-text invoice refs, etc).
- Noted: `tassure-invoice.vercel.app` now 307-redirects to the actual
  current production domain, `tassure-corporate-services.vercel.app`
  (Codex or Vincent renamed the Vercel project at some point — use the
  new domain going forward). The whole app now requires Google OAuth
  login (including API routes), so `curl`-based production checks from
  an agent session no longer work without a real session cookie.
- Added a new Billing System > Client Communications section (4 pages:
  Campaign Centre, Draft Review, Delivery History, Templates & Senders)
  replacing the manual `BULK.xlsm` bulk-email workbook found on Vincent's
  desktop. Generates AR renewal / SOA / letter reminder drafts from real
  `generated_invoices`/`quickbooks_invoices`/`ar_reminder` data instead of
  hand-maintained Excel rows. Sending stays manual via each staff member's
  own Outlook (mailto: link) per Vincent's explicit decision — no email
  API/SMTP was wired up. See "2026-07-19 - Claude Code" below for full
  detail, known gaps, and the required SQL migration.
- Rebalanced the Billing Draft line-item table columns in
  `app/billing/page.tsx`: Status 90->110px, Rate (S$) 100->90px, Amount
  110->100px, Qty unchanged at 44px. Header and row grids kept in sync.
- Standardized saved invoice PDF filenames: TAB is
  `INV<invoiceNo>-<companyName>-S$<amount>.pdf`, TAC is
  `TAC<invoiceNo>-<companyName>-S$<amount>.pdf` (no spaces around dashes).
  Extracted a shared `invoicePdfFileName()` helper in `app/billing/page.tsx`
  and threaded the invoice total through both the post-creation and
  reopened-draft PDF flows (`GeneratedPdf` now carries `total`).
- Corrected Billing Draft renewal-fee pairing for split QuickBooks items.
  `Deferred Revenue - Corp Sec` now belongs only to Corporate Secretarial
  Services, while `Deferred Revenue - Reg Addr` belongs only to Registered
  Address Services; each pair is summed into its visible primary line. The
  selector also rejects newer one-off work that reused a Secretary product,
  while retaining verified annual invoices through period, AR/ACRA, generated
  invoice, or tightly bounded two-service annual recurrence evidence.
- Hardened Billing Draft period renewal so the latest QuickBooks renewal line
  is always considered even when its description could not previously be
  parsed. Supported historical period formats are reparsed, Accounts/Tax/
  Discount template years roll forward, and both the UI and create-invoice API
  reject missing or overlapping Secretary/Address/ND periods. Unreadable latest
  periods require an explicit QuickBooks review instead of silently repeating
  last year's period.
- Normalized Billing Draft invoice-number presentation so legacy QuickBooks
  values beginning with `TAB` or `TAC` display as the number only (for example,
  `TAC02580262` becomes `#02580262`). The source QB/database value remains
  unchanged; the same display-only normalization is used in invoice pills,
  history summaries, Save As filenames, and PDF status messages.
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
- Replaced whole-folder invoice PDF access with a per-invoice Windows Save As
  flow after Chrome rejected some network folders as containing protected
  system files. Separate TAB/TAC buttons open Save As directly from the click,
  prefill the real invoice/company filename, and fetch/write the QB PDF only
  after the user chooses the file location. Unsupported picker errors fall back
  to a normal Chrome download.
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

1. After deployment, work through Billing Draft's amber period-review cases;
   317 active latest core-service records currently lack a readable period in
   their QuickBooks description and must be confirmed rather than guessed.
2. Confirm the correct Vercel account/team for the existing project.
3. Relink the local directory only after confirming the target project.
4. Run `npm run build` before any production deployment.
5. Record the deployment URL and verification result here.

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

### 2026-07-20 - Claude Code (Client Communications: invoice PDF attachment)

Vincent's real workflow always attaches the actual invoice PDF when sending
these emails - the drafts built so far only prepared To/CC/Subject/Body via
a `mailto:` link, which cannot carry a file. `mailto:` has no attachment
mechanism in any browser/OS for security reasons — there's no way around
that within a `mailto:` link itself.

- Traced the closest fixable gap: `InvoiceRef` (`lib/email-merge.ts`) only
  carried `qbCompany`/`invoiceNo`/`amount`, not QuickBooks' own internal
  invoice Id — but `generated_invoices.qb_invoice_id` and
  `quickbooks_invoices.qb_invoice_id` both already store it, and
  `/api/quickbooks/invoice-pdf?company=&id=` (built for Billing Draft's
  "save PDF" button) already streams the real PDF given that Id. Wired
  the missing piece: `lib/client-comms-resolve.ts`'s `loadInvoicesByCompany`
  now selects `qb_invoice_id` and threads it through as `qbInvoiceId` on
  every `InvoiceRef` (optional field — no DB migration needed, it just
  rides along in the existing `email_drafts.invoice_refs` jsonb).
- Extracted `invoicePdfFileName()`/`displayInvoiceNo()` out of
  `app/billing/page.tsx` into a new shared `lib/invoice-filename.ts`, so a
  PDF downloaded from Draft Review has the exact same
  `INV<no>-<company>-S$<amt>.pdf` / `TAC<no>-...` name as one saved from
  Billing. Left billing/page.tsx's own copy in place rather than editing it
  to import the new module — that file has a `\u0000-\u001F` regex literal
  that corrupted the source once already this session when touched via the
  Edit tool's escape handling (see the file-corruption entry below); not
  worth the risk for a pure dedup with no user-facing change.
- Draft Review (`app/client-communications/drafts/page.tsx`): each invoice
  badge with a resolvable `qbInvoiceId` (TAB/TAC only — TAO still isn't
  connected) now has a small download icon that fetches the PDF and saves
  it under the house filename. A one-line note appears above "Compose in
  Outlook" on any draft with a downloadable invoice, explaining plainly
  that mailto: can't attach files and the PDF has to be downloaded first,
  then dragged into the Outlook window that opens - this is a manual
  two-step by necessity, not a bug to "fix" later; there is no browser API
  that lets a mailto: link pre-attach a file.
- Historical-import drafts (BULK.xlsm) and letter-type drafts correctly
  show no download button - the import script never had a QB invoice Id
  to record, and letters have no invoices at all.
- Verification: `npm run build` exit code 0. Not verified in a live
  logged-in browser session (same login-gate limitation as prior entries)
  - the actual QuickBooks PDF fetch (`getValidToken` + Intuit API call)
    needs a real, currently-connected QB OAuth session for TAB/TAC to
    confirm end-to-end, which only exists in production.

### 2026-07-20 - Claude Code (Client Communications: review-before-generate)

Vincent's feedback on the first cut of Campaign Centre: template flexibility
is low (several fixed templates), so beyond automated resolution he wanted
to be able to add/remove companies himself per template, wanted Recent
Campaigns to support deleting a wrongly-generated campaign, and wanted
Generate Drafts to first show exactly which companies would get a draft so
a reviewer can check it before anything is created.

- Split candidate resolution from draft creation so they can no longer
  drift apart:
  - New `lib/client-comms-resolve.ts` holds the shared resolver (company
    lookup/fuzzy match, per-type invoice lookup for ar/soa, the AR-cycle/
    unpaid-SOA/manual-letter target list, and `buildRow()` which decides
    the suggested checkbox state + a human-readable reason). Both the
    preview and the create endpoint now import this — previously the
    logic lived inline in the POST handler and any future edit could
    silently make preview and creation disagree.
  - New `POST /api/client-communications/campaigns/preview` resolves the
    same candidate set Campaign Centre would generate, without writing
    anything, and returns each row's include/exclude suggestion + reason
    (already sent this cycle / no invoice found / no email on file).
  - New `GET /api/client-communications/campaigns/preview?lookup=<name>&
    type=...` resolves ONE company on demand, deliberately outside the
    auto target-list membership check, for the Campaign Centre "add a
    company" control - the reviewer can pull in someone the automatic
    rules wouldn't have picked (e.g. no invoice synced yet) and decide
    for themselves whether to include them.
  - `POST /api/client-communications/campaigns` no longer resolves
    anything itself. It now requires a `companies: FinalizedCompany[]`
    array (companyName/companyId/toEmail/ccEmail/contactName/
    invoiceRefs/totalAmount) and writes exactly that list. This is a
    breaking change to the route's request shape - anything else calling
    it with the old `companyNames`-only body will get a 400.
- `app/client-communications/campaigns/page.tsx` reworked into a two-step
  flow: `setup` (unchanged form, button now reads "Preview Companies") ->
  `review` (editable table: checkbox per row, remove-row trash icon, a
  debounced "add a company by name" search box backed by `/api/companies`
  + the single-lookup endpoint above, a live "N of M selected" counter,
  and only then "Confirm & Generate N Drafts"). Checkboxes are disabled
  only when there is truly no email on file (nothing to send to);
  "already sent" / "no invoice found" rows default unchecked but stay
  toggleable, since those are judgement calls, not hard blocks.
- Added `DELETE` to `app/api/client-communications/campaigns/[id]/route.ts`
  and a per-row trash-icon button in Recent Campaigns (with a confirm
  dialog). `email_drafts.campaign_id` already has `on delete cascade` in
  the schema, so deleting a campaign removes its drafts automatically -
  no extra cleanup query needed.
- Verification: `npm run build` exit code 0 (checked via the real file-
  written exit code, not a background task's own reported code, per the
  standing rule in this log). Did not verify in a live logged-in browser
  session - the whole app now requires Google OAuth (see the entry
  below), so this needs Vincent (or a session with real login cookies)
  to click through Campaign Centre once in production.
- Known gap carried over: the "add a company" lookup and the bulk preview
  both still only see TAB/TAC invoices (TAO not connected), so a manually
  added company whose only invoice is TAO-only will show "no invoice
  found" even though one genuinely exists - the reviewer can still tick
  it on with $0/blank invoice list if they know this is the case.

**Same-day follow-up (Vincent's feedback on the first review-step UI):**

- Delete now goes through `components/ConfirmDeleteModal.tsx` (already
  used by `app/late-filing/page.tsx`) instead of `window.confirm()`, and
  every delete/trash icon on the page is red (`#dc2626`) rather than grey,
  matching the rest of the app's destructive-action styling.
- The review table's "To" cell is now a real `<input>`, not static text -
  a company with no email on file shows a red-bordered empty box the
  reviewer can type straight into; its checkbox unlocks the instant a
  non-empty value is typed, and the stale "No email on file" note clears
  itself once resolved.
- Added a "CC" column (same free-text input, optional) - Vincent pointed
  out most companies realistically have more than one relevant contact,
  not just one email.
- Both To and CC accept multiple addresses. Storage keeps whatever the
  reviewer typed (comma or semicolon separated - Outlook's own compose
  window displays semicolons, so that's the format staff will reach for
  first). `app/client-communications/drafts/page.tsx`'s `buildMailto()`
  now runs both fields through `normalizeRecipients()` (split on `[;,]`,
  trim, rejoin on `,`) before building the `mailto:` link, since RFC 6068
  only recognises comma as the recipient separator - semicolon-separated
  input would otherwise arrive as one malformed address.

### 2026-07-20 - Claude Code (Client Communications: historical import + fixes)

- Ran the `add-client-communications.sql` migration after fixing the
  missing `is_default` value bug (see Latest completed work). Confirmed
  live: `email_senders` (2 rows), `email_templates` (3 rows), empty
  `email_campaigns`/`email_drafts`.
- Vincent's first look at Draft Review (empty state, before any campaign
  existed) read as "the system feels incomplete" - clarified this meant
  two things: (1) a genuine UX gap (blank dropdown, no guidance - fixed,
  see Latest completed work), and (2) he wanted the BULK.xlsm's own
  historical records imported so the system doesn't start from zero.
- Built `scripts/import-bulk-history.js` to parse and import all 5 data
  sheets (List_letter 1758 rows, List_AR1/2/3 68+16+11, List_SOA1 61 -
  List_SOA2 had zero real rows among its "1100" template rows). Key
  findings from inspecting the raw workbook before writing the parser:
  - Column layout is completely different per sheet; fields are located
    by header text (the `<Placeholder>` cells), never a hardcoded index.
  - `Send Email ?` is NOT a sent/not-sent flag - rows marked "n"/"N"
    still had real send timestamps in the tracking columns after them.
    The actual sent evidence is a numeric Excel date serial (~40000-
    60000) anywhere after the named columns; used the earliest one found
    as `sent_at`. Zero such values -> would be `pending`, but in practice
    every real row across all 5 sheets had at least one, so the imported
    set is 100% `status='sent'` - these sheets are apparently an archive
    of already-processed batches, not a full active/pending client list.
  - List_AR1/AR3's free-text `<INV>` column and AR2's `<INV 1/2/3>` are
    regex-parsed into `(company-prefix?, invoiceNumber)` pairs; a prefix-
    less number inherits the last-seen prefix in the same cell, or
    `qbCompany: 'UNKNOWN'` if none appeared yet. List_SOA1's structured
    `<Invoice TAB/TAO/TAC N>` + matching amount columns are read directly
    (no regex needed) - more trustworthy than the AR sheets' free text.
  - Verified the "SOA1 shows 1100 rows but I only parsed 61" discrepancy
    by direct inspection before trusting the parser: 1038 of those rows
    are fully blank template rows (Amount cell defaults to 0, every
    other cell is `''`) - not a parsing bug.
  - Company matching reuses the same normalize+fuzzy approach as the
    rest of the app (inlined here rather than importing `lib/company-
    name.ts`, since this is a one-off Node script, not app code) - left
    `company_id` null rather than guessing when a match was ambiguous.
  - Ran `--dry-run` first (the default; `--commit` writes), inspected
    per-sheet stats and 2 sample rows per sheet, only then committed.
- Result written to Supabase: 5 `email_campaigns` (`status: 'completed'`,
  named `Historical Import — <SheetName>`), 1914 `email_drafts` total,
  all `status: 'sent'` with real historical `sent_at` timestamps and
  `sent_by_name: 'BULK.xlsm Import'`. Verified row counts directly
  against the table after the commit run, not just the script's own log.
- Also discovered while testing the earlier build: `tassure-
  invoice.vercel.app` now 307-redirects to `tassure-corporate-
  services.vercel.app` (the real current production domain), and the
  whole app - including every API route - now requires a Google OAuth
  session. Both are noted in Latest completed work; the practical effect
  is that an agent session can no longer curl-verify production without
  a real logged-in browser session.
- Verification: `npm run build` exit code 0 for the empty-state fix;
  the import script's own dry-run/commit output plus a direct Supabase
  read-back for the historical import (no build step involved there -
  it's a standalone data migration script, not application code).

### 2026-07-19 - Claude Code (Client Communications: bulk email prep)

- Context: Vincent's team runs bulk reminder emails today from a manual
  Excel/VBA workbook on the desktop (`BULK.xlsm`, 5 sheets: List_letter
  1762 rows, List_AR1/AR2/AR3, List_SOA1/SOA2 1100+ rows) with columns
  mail-merging company name, contact, invoice numbers/amounts across
  THREE QuickBooks companies referenced in the sheet: TAB, TAC, and a
  previously-unknown **TAO** (confirmed by Vincent as a third real QB
  company, not yet connected to this system the way TAB/TAC are).
- Built a system-native replacement under a new nav group (Sidebar.tsx):
  Billing System > Client Communications > {Campaign Centre, Draft
  Review, Delivery History, Templates & Senders} - the exact structure
  Vincent specified.
- New tables (`scripts/add-client-communications.sql`, **not yet run** -
  needs the Supabase SQL editor, same as every prior migration in this
  project): `email_senders`, `email_templates`, `email_campaigns`,
  `email_drafts`. Seeded with the two known senders
  (finance@/contact@tassure.com) and one default template per type.
- `POST /api/client-communications/campaigns` generates drafts:
  - `type=ar`: pulls the AR Reminder batch for a chosen FYE month/year,
    matches each company (via `lib/company-name.ts` normalize/fuzzy-match,
    same helper the rest of the app uses) to its `generated_invoices` for
    that exact `fye_cycle`, sums TAB+TAC amounts, skips companies with no
    invoice yet or no email on file.
  - `type=soa`: pulls every company with `balance > 0` on a synced
    `quickbooks_invoices` row (TAB/TAC only).
  - `type=letter`: manual company-name list (no invoice data needed).
  - Drafts are optimistic-locked (`version` column) on update, same
    pattern as the AR workflow sync Codex added, so two staff reviewing
    one campaign can't silently overwrite each other's "mark as sent".
- Draft Review's "Compose in Outlook" builds a `mailto:` link (truncates
  the body under ~1900 chars with a notice, since mailto: has no hard
  standard but most clients choke well before Outlook's own limits) -
  this is intentionally the ONLY send mechanism. Vincent explicitly ruled
  out building real email-sending (Gmail API/SMTP/Resend) for now:
  "邮件发送功能先不管，我们是用 outlook 的."
- Known gaps / next steps for whoever picks this up:
  1. **Run `scripts/add-client-communications.sql`** before anyone opens
     these pages - GET routes will error on the missing tables until then.
  2. **TAO is not connected.** AR/SOA totals silently miss any TAO-only
     invoice until someone with TAO admin rights authorizes it via
     `/api/quickbooks/auth?company=TAO`-equivalent (TAO doesn't exist yet
     in `lib/quickbooks.ts`'s `QbCompany` type - that needs extending
     to `'TAB' | 'TAC' | 'TAO'` first, mirroring how TAC was added).
  3. Email template body/subject wording was written fresh (not
     reverse-engineered from the Excel's VBA macros, which would need
     unzipping the .xlsm and decompiling `vbaProject.bin`) - staff should
     paste their exact existing wording into Templates & Senders before
     relying on this for real client communication.
  4. Not yet verified against a live Supabase instance (migration hasn't
     been run) - only `npm run build` (exit code 0) has confirmed this
     end-to-end. Vincent should generate one small test AR campaign after
     running the migration and sanity-check the merged amounts against a
     real company before broader use.
- Verification: `npm run build` exit code 0 (checked directly, not via
  grep on "Compiled successfully" — see 2026-07-18 entry for why that
  matters on this machine's Turbopack).

### 2026-07-18 - Claude Code (invoice PDF filename convention)

- Standardized the Save-As filename per company: TAB uses
  `INV<invoiceNo>-<companyName>-S$<amount>.pdf`, TAC uses
  `TAC<invoiceNo>-<companyName>-S$<amount>.pdf`, replacing the previous
  `<no> - <company> - TAB/TAC.pdf` form. Extracted `invoicePdfFileName()`
  in `app/billing/page.tsx`; `GeneratedPdf` now carries `total` so the
  amount is available both right after creation and when reopening an
  already-invoiced draft.
- Pushed two commits to `origin/main`: `94f0753` (Codex's pending deferred
  renewal-fee pairing fix, verified already committed locally and pushed
  on Vincent's request) and `b596b6b` (this filename change).
- Verification: `npm run build` exit code 0 (confirmed via exit status, not
  just grepping for "Compiled successfully" - Next.js 16's TypeScript pass
  runs after that line and can still fail the build).
- No push conflicts; production Vercel deploy triggered automatically.

### 2026-07-17 - Codex (renewal fee service pairing)

- Added an explicit primary/deferred classifier for Secretary, Address, and ND
  QuickBooks products, including the historical `Coporate` spelling.
- Replaced broad keyword grouping with invoice- and QB-company-scoped pairing.
  Deferred Corp Sec is added only to the Secretary primary item; Deferred Reg
  Addr is added only to the Registered Address primary item; generated drafts
  expose only the primary product name with the combined amount.
- Prevented later one-off Secretary lines from becoming the annual price or the
  prior renewal template. Annual evidence is restricted to a matching deferred
  line, readable service period, Annual Return/normal ACRA fee, the system's own
  generated-invoice record, or two services recurring together about one year
  after verified annual fees.
- Added 24 regression assertions covering the reported 600/200 split, ND
  1500+1500 pairing, one-off ACRA 5.50 exclusion, generic annual descriptions,
  generated invoices, typo compatibility, and primary-only display.
- Live read-only audit covered 870 active companies and 5,472 relevant QB
  lines. All 335 four-way split invoices produced both service pairs with zero
  failures; 28 newer one-off Secretary items were correctly excluded.
- Verification: targeted ESLint, `npm run test:billing-fees`,
  `npm run test:period`, `npx tsc --noEmit`, and `npm run build` all completed
  successfully.

### 2026-07-17 - Codex (invoice period renewal hardening)

- Replaced the narrow QuickBooks period parser with a shared service-aware
  parser covering the real historical month/year, apostrophe-year, full-width
  bracket, numeric-date, and FYE formats. Future incremental QB syncs now store
  those results consistently.
- Billing renewal aggregation now retains the newest primary QB line even when
  its period is unreadable. It proposes the month after the latest verified
  period, while unreadable latest records show a review warning and cannot be
  included until the user enters a complete period and confirms it against QB.
- Added the same missing/overlap checks to the server-side invoice creation API
  so a stale UI or direct request cannot bypass the protection. Recurring
  Accounts, Tax, and Discount descriptions now roll their dated wording forward
  one year instead of copying last year's period verbatim.
- Safely backfilled only missing Secretary/Address/ND periods and AR/XBRL FYE
  values from 12,913 historical QB lines. Existing non-null values and Deferred
  rows were never overwritten; invalid source dates such as 31 Nov or year 0025
  remain unparsed for manual review. A final dry run returned zero remaining
  parseable changes.
- Real-data regression over 868 active clients found 1,159 latest primary
  core-service records: 842 are automatically readable, 317 require manual QB
  review, and zero now produce a repeated-period proposal.
- Verification: 17 parser/rollover assertions passed; targeted ESLint reported
  zero errors (six pre-existing Billing warnings); `npx tsc --noEmit`, `npm run
  build`, and `git diff --check` passed. No push or Vercel deployment was
  performed.

### 2026-07-17 - Codex (invoice number display cleanup)

- Added one display-only invoice-number formatter for Billing Draft. It removes
  a leading legacy `TAB`/`TAC` company code only when followed by a number or a
  separator; ordinary numeric invoice numbers remain unchanged.
- Applied it consistently to desktop/mobile invoice pills, renewal and QB
  history, prior-ND references, PDF Save As filenames, and PDF result messages.
  QuickBooks values and Supabase records were not mutated.
- Verification: explicit formatter cases passed for `TAC02580262`,
  `TAB02610834`, `TAC-02580262`, and `02610852`; targeted ESLint completed with
  zero errors (six pre-existing warnings); `npm run build` succeeded. No push
  or Vercel deployment was performed.

### 2026-07-17 - Codex (Chrome-protected PDF folders)

- Reproduced the remaining failure boundary from the production screenshot:
  Chrome rejected the selected directory inside its own folder picker before
  the page could receive an error and activate the previous fallback.
- Removed the whole-directory File System Access picker from Billing Draft PDF
  saves. Each available TAB/TAC PDF now has its own button which opens a
  single-file Save As dialog immediately from the click, with the invoice
  number, company, and QB company already in the filename. The verified QB PDF
  is fetched and written after location selection, eliminating the manual drag
  step; unsupported save pickers fall back to Chrome downloads.
- Verification: targeted ESLint completed with zero errors (the same six
  pre-existing unused-code warnings); `npm run build` completed successfully.
  No push or Vercel deployment was performed.

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
