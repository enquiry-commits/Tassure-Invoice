# Regression Checklist

This is not a full test matrix — this project has no automated test suite
(see `docs/CURRENT_STATE.md`), and that's a deliberate choice given its
scale. This is a **manual** checklist of the workflows that have actually
broken before (see `docs/INVARIANTS.md` for the incidents each check
guards against) or would cause real operational/financial damage if broken
silently. Run the relevant checks after any change that touches the
matching area in `docs/FEATURE_MAP.md` — you don't need to run all 12 for
every change, just the ones your change could plausibly affect.

"Check" here means: trigger the real route/page against real data (locally
or in production, per this project's own established verification style)
and look at the actual result — not "read the code and confirm it looks
right."

---

### REG-001 — AR/AGM cycle correctness
Pick a company with a known FYE. Confirm `ar_reminder` shows exactly one
open (not-yet-filed) cycle under the current `fye_month`, no orphaned row
under a superseded old month, and `due_date` equals FYE + 7 months exactly.
**Guards:** INV-AR-001, INV-AR-002, INV-TW-005.

### REG-002 — EOT / Late Filing cross-check
Pick a company with a real, active TeamWork Extension of Time. Confirm it
does **not** show as overdue in Late Filing, and that the date actually
used everywhere (Late Filing badge, AR Reminder due date, EOT table) is the
**revised** date, not the struck-through original.
**Guards:** INV-TW-001, INV-AR-004.

### REG-003 — Historical record unchanged
Open an older, already-filed `ar_reminder` cycle (not the current one).
Confirm its stored values are byte-for-byte the same as before your change
— especially after anything touching FYE correction, catch-up backfill, or
bulk sync logic.
**Guards:** INV-AR-001, INV-DATA-002 (see `CLAUDE.md`'s red-line rules).

### REG-004 — QuickBooks invoice generation (TAB)
Review an actual generated draft invoice on the default (TAB) company file.
Confirm PIC/Class is set only on Secretary and XBRL lines (never
Address/AR/ND/Accounts/Tax/discount lines), the DocNumber is a real
resolved number (never the literal `AUTO_GENERATE`), and the amount matches
QuickBooks' own live total.
**Guards:** INV-QB-005, INV-QB-007.

### REG-005 — QuickBooks invoice generation (TAC / ND)
Same as REG-004 but on the TAC company file for a company with an active
nominee director. Confirm the **currently TeamWork-appointed** ND is shown
(not a stale one carried over from QB invoice history).
**Guards:** INV-QB-008.

### REG-006 — Draft Helper email send
Send (or review a queued draft for) a company with **multiple** To or CC
recipients. Confirm addresses landed semicolon-separated in Outlook (not
literally containing a newline), the recipient policy was applied correctly
(external → To, Tassure-domain → CC, `hoechyi@tassure.com` always in CC,
`cindy@tassure.com` always excluded), and the greeting reads "All" when
more than one To-recipient is present.
**Guards:** INV-MAIL-001, INV-MAIL-004, INV-HELPER-001.

### REG-007 — Generated document matches stored data
Generate one real Post Incorporate document. Confirm names/dates/amounts in
the output match the source record exactly, and (if a ROND/RONS-style
clause is involved) both the "has nominee"/"no nominee" clauses are still
present with the inactive one struck through, never deleted outright.
**Guards:** INV-DOC-001, INV-DOC-003.

### REG-008 — Daily automation landed clean
After ANY change to `vercel.json`'s crons, `proxy.ts`'s `CRON_PATHS`, the
`AutomationSource` union or the health route's `SOURCES`, run
`npx tsx test-cron-wiring.ts` — it must print `ALL OK` (a scheduled path
missing from `CRON_PATHS` is answered 401 every night and never runs —
INV-CRON-011). Then check `automation_sync_runs` for the prior 24h: every
daily source in `SOURCES` (`app/api/automation/health/route.ts` — 18 as of
2026-10-05, of which `nas_index` is started by the NAS device, not a cron,
and `reports_narrative` runs weekly on Sundays; `docs/FEATURE_MAP.md`'s
cron map shows only the 7 with ordering dependencies) shows a `cron` run
with `status: success`, and the run's `summary` says it did its work (e.g.
`ai_quality_review`: `errors` 0, not just `success`). A scheduled source
with no row at all is the INV-CRON-011 signature. Cross-check `docs/CURRENT_STATE.md`'s
automation table is still accurate.
**Guards:** INV-CRON-001 through INV-CRON-012 (all of them, in effect).

### REG-009 — PIC two-way sync
Edit ACC/TAX PIC on Active Client for a company with multiple `ar_reminder`
cycles. Confirm it mirrors onto **every** cycle for that UEN. Then edit the
same field from AR Reminder itself and confirm it mirrors back to Active
Client.
**Guards:** INV-PIC-004.

### REG-010 — Manual-field protection survives a sync
Set a manual override on a normally-automated field (e.g. `reminder_note`,
`acc_pic`). Trigger the sync that would normally populate that field.
Confirm the manual value is completely untouched afterward.
**Guards:** INV-DATA-002, INV-DATA-003.

### REG-011 — Large-list pagination
On a large Master List page (Active Clients), confirm the displayed total
row count matches the real underlying row count — not silently capped at
1000 — and that no row appears twice (a count can match while duplicates and
gaps cancel out; compare DISTINCT ids, see REG-023).
**Guards:** INV-DATA-006, INV-DATA-066.

### REG-012 — Chinese name entry
Type a Chinese company name or PIC name into any inline-edit table cell.
Confirm a mid-composition Enter (used by the IME to confirm a candidate)
does not prematurely commit/close the cell before the full name lands.
**Guards:** INV-DATA-010.

### REG-013 — Company 360 multi-source accuracy
Run `npx tsx test-company-near-miss.ts` and `npx tsx test-company-name-and.ts`
(each must print `ALL OK`): the yellow "no confident QuickBooks match" warning
appears only for a 70–84% near miss and names it (INV-DATA-074), and an
"and" / "&" name pair scores 99 while `normalize()` is unchanged
(INV-DATA-076). After ANY change to `lib/company-name.ts`, run
`npx tsx scripts/diff-company-name-matching.ts` (read-only, needs `.env.local`,
about a minute): `normalize()` must differ for 0 names (its output is stored in
`soa_owners` / `soa_remarks`) and every changed decision it lists must be
judged right or wrong by a person. Then open Company 360 (`/companies/[id]`) for a company with multiple AR/AGM
cycles across years, at least one generated invoice, and ND history
(active or ceased). Confirm every section shows the correct rows, each
AR/AGM cycle's `matchedVia` correctly reflects company_id vs uen vs fuzzy,
and a company with none of the above renders clean empty states rather
than errors. Also confirm a company whose `ar_reminder` row has
`company_id IS NULL` (the legacy-row class from INV-AR-003) still surfaces
via the `uen` fallback.
**Guards:** INV-DOC-004, INV-TW-005, INV-DATA-012, INV-AR-003.

### REG-014 — My Tasks PIC attribution and restricted-account scope
Log in as a staff member with `pic`/`acc_pic`/`tax_pic` assignments
including at least one alias/initial value (e.g. "YH", "Kah Ye"). Confirm
`/my-tasks` shows exactly their rows (all three PIC fields checked) and
excludes `late_filing_companies` rows with no `mirrored_ar_reminder_id`.
Since the department split (2026-10-04) My Tasks shows a section only if
the account's department opens that section's page: log in as a TCS
ACCOUNT or TAX account (e.g. Jay Tay) — confirm the AR and SOA Collections
sections show, the response's `lateFiling` and `trademarkRenewals` are
`null` (not empty), and the scope note names "TCS ACCOUNT"; as TCS FINANCE
(Chelsea) all four sections show.
**Guards:** none yet in `docs/INVARIANTS.md` — this is the first feature
built on PIC-based task attribution; add an INV-PIC entry here if a real
attribution bug is ever found.

### REG-015 — No Playwright-launching cron collision
Query `automation_sync_runs` for every Playwright-launching source
(`teamwork_companies`, `teamwork_secretary`, `teamwork_nd_1..5`,
`ar_generate`, `ar_workflow`, `late_filing`) over the prior 5-7 days.
Programmatically check every pair for wall-clock overlap between
`started_at`/`finished_at` — not just `status`/`error` text, since a run
can succeed while still having overlapped another. Confirm zero runs show
the disk-space signature ("Less than 64MB of free space...") in `error`.
Confirm `teamwork_nd` batch sizes stay ≤3 people and no batch shows a
multi-person timeout failure. Confirm the Automation Health dashboard UI
shows tiles for `teamwork_secretary` and `teamwork_nd_5`, not just the raw
DB rows. Run this after any future change to `vercel.json`'s cron times
too, not only after this specific fix.
**Guards:** INV-CRON-013, INV-CRON-014.

### REG-016 — Reports access gate and permission-flag independence
Log in as an approved account WITHOUT `canViewReports` — confirm the
Reports sidebar item never renders, `/reports` redirects to `/`, and a
direct `GET /api/reports` returns 403 (not just a client-side redirect —
this is a real permission boundary, same bar as My Tasks' View-As). Log in
as one of the 4 `canViewReports` accounts and confirm `/reports` loads.
Separately: after ANY future change to `ApprovedAccount` gating logic in
`lib/approved-accounts.ts` or its consumers, re-check every existing flag
(`admin`, `canViewAsOthers`, `canViewReports`) still resolves correctly for
every account that should have it — this exact class of regression shipped
once already (2026-09-02: switching My Tasks' View-As gate from `admin` to
the new `canViewAsOthers` silently dropped Vincent's own access, since his
account only had `admin: true` at the time). Since 2026-10-04 (department
split, INV-DATA-069) also run `npx tsx test-account-access.ts` and
`npx tsx test-assistant-pages.ts` (`ALL OK` / `ALL PASSED`): every one of
the 21 accounts opens exactly its department's routes. Then log in as one
account per department and confirm the header title (TCS FINANCE, TCS
ACCOUNT, …), the sidebar AND the phone menu: Jay Tay (ACCOUNT) sees
Dashboard, My Tasks, Companies, Billing System (AR Reminder, Billing Drafts
TAB/TAC + TAO, Quotation, Outstanding ×4) and Turnover AI, lands on AR
Reminder, and `/late-filing` sends him back there; Clarence (TAX) the same
without Turnover AI; Chelsea (FINANCE) has Master List but `/post-incorporate`
sends her to the Dashboard. As Vincent, 切换部门 → TCS FINANCE shows
"预览中" and Finance's menu while every page still opens for him; Cindy's
picker has no TCS ADMIN.
**Guards:** none yet in `docs/INVARIANTS.md` — Reports is new; the
permission-flag-independence lesson above is currently only recorded here
and in `PROJECT_STATUS.md`'s 2026-09-02 entry.

### REG-017 — SOA/Outstanding Balance matches QuickBooks' own AgedReceivableDetail total
For each of TAB/TAC/TAO: call QuickBooks' own report API directly
(`GET /v3/company/{realmId}/reports/AgedReceivableDetail?report_date=<today>`),
read its Grand Total, and compare against `computeAllSoaRows()`/
`GET /api/billing/soa/all`'s summed total for that company — should be at
or very near an exact match (small deltas from real activity between the
two checks are expected; a gap in the thousands or a fixed percentage is
not). Spot-check the specific customers already implicated in this
incident: **Cyber Quantum Pte Ltd**/`(USD)` shows its Journal Entry
correctly (not invisible); **TASSURE PAC** never appears anywhere (SOA
list, detail modal, PDF, collections email candidate list, assistant
tools) regardless of how large its raw QuickBooks activity is; **Ligang
Limited** still nets to its correct CreditMemo-adjusted total (a
no-regression check on the INV-QB-015 fix, not new functionality).
Separately, force a degraded-mode check: mark one company's
`quickbooks_ar_aging_sync_state.last_status` as `'error'` (or backdate
`last_synced_at` past 36h) and confirm `computeSoaRows()` falls back to a
real nonzero legacy number for that company only (never `$0`), and that
the SOA detail modal / merged PDF / Client Communications SOA candidate
list all degrade to the SAME (legacy) mode for that company at the same
time — never a mix where the total uses one mode and the detail list uses
the other.
Also spot-check one real non-SGD customer (e.g. a `CurrencyRef: USD`
`Customer` — `SELECT * FROM Customer WHERE ... ` for any with a nonzero
`Balance` and non-SGD `CurrencyRef`): confirm the figure this app stored in
`quickbooks_ar_aging_detail.open_balance` equals that customer's raw
transaction amount × its own `ExchangeRate` (both readable on the live
QuickBooks transaction object), not the raw foreign-currency figure passed
through unconverted.
**Guards:** `docs/INVARIANTS.md` INV-QB-015, INV-QB-016, INV-QB-017.

### REG-018 — SOA detail modal / merged PDF resolve for a company whose display name differs from its real QuickBooks customer_name
Pick a company whose `companies.company_name` (or fuzzy-matched display
name) differs from its real QuickBooks `customer_name` in more than
case — different punctuation (`&` vs `and`, `Pte. Ltd.` vs `Pte Ltd`), or
any spelling variant that still fuzzy-matches via `lib/company-name.ts`'s
`normalize()`/`matchScore()`. Open that company's SOA detail modal and
confirm it shows its real invoice/line-item rows (not empty, even though
the on-screen Outstanding total for the same company is correct) — then
confirm "Download SOA PDF" for the same company produces a real, non-empty
merged PDF.
**Guards:** `docs/INVARIANTS.md` INV-QB-018.

### REG-019 — ND (or Secretary/Address) renewal period is correct when one invoice splits a renewal across a primary + deferred line
Pick a company whose most recent ND (or Secretary/Address) invoice has BOTH
a primary line (e.g. "Secretary:Nominee Director Fees - X") and a deferred
line (e.g. "Deferred - ND Fees - X") in the SAME invoice, where the two
lines' parsed periods are DIFFERENT sub-periods (not the same period
twice) — Siehi Shipping Pte. Ltd. (TAC) is a known real example. Open
Billing Drafts for that company and confirm the proposed next ND period
starts the month immediately after the LATER of the two lines' period_end
(not the earlier/primary line's), and does not overlap any month already
billed in either line. Cross-check: query `quickbooks_invoice_items` for
`service_type IN ('Secretary','Address','ND')` grouped by
`(customer_name, invoice_no)`, and for any group with both a primary and a
deferred row whose `period_end` differ, confirm the app treats the later
one as authoritative. Also run `npm run test:billing-fees` and `npm run
test:period` — each must print its "checks passed" line (both had been
failing unnoticed, since 764dab8 and 1fd45b3, until 2026-10-06). Second real
example: ELITE GATHERING PTE. LTD. — TAB #02611051 carries a director's
residential-address disbursement tagged Address; its ADDR tile must read
active to 2027-06-30. After ANY change to `compareRenewalPeriodProductLines()`,
diff every client's renewal tiles before/after (the real
`GET /api/billing/renewals` can be run read-only) and explain each change.
**Guards:** `docs/INVARIANTS.md` INV-QB-019.

### REG-020 — SOA Excel export shows real bucket activity and a correct TOTAL row even when a bucket nets to zero or negative
Export the Full Workbook (or a single TAB/TAC/TAO sheet). Pick a company
known to have a bucket with real, mixed-sign line items netting to zero or
negative (ACCADIA MANAGEMENT SERVICES PTE.LTD.'s TAO 91+ bucket is a known
real example — 7 line items netting to $0.00). Confirm that bucket's cell
shows the real net (not blank) and hovering it shows a comment/note
listing every underlying line item. Then confirm the sheet's own bottom
TOTAL row for that bucket column equals the real sum across ALL companies'
`aging[bucket]` values for that column (spot-check by summing the column
in a scratch formula) — not silently short by every company whose net in
that bucket happened to be zero or negative.
**Guards:** `docs/INVARIANTS.md` INV-QB-020.

### REG-021 — Webhook-triggered AR-aging re-sync (near-real-time Outstanding updates)
Simulate an AR-relevant webhook event (real end-to-end requires the Intuit
Developer Dashboard's webhook subscription to actually include Payment/
CreditMemo/JournalEntry/Deposit — see INV-QB-021's own caveat; until
confirmed, insert a row directly into `quickbooks_webhook_events` for a
real connected `realm_id` with `entity_name` one of `Payment`/
`CreditMemo`/`JournalEntry`/`Deposit`, `status: 'pending'`). Trigger
`processQuickBooksWebhookQueue()` (directly, or via `GET /api/quickbooks/
sync`, which calls it first). Confirm: the event is marked `processed`;
`quickbooks_ar_aging_sync_state.last_synced_at` for that company advances;
`quickbooks_ar_aging_detail` rows for that company have a fresh
`scraped_at`. Then insert another AR-relevant event for the SAME company
within 60 seconds and re-trigger — confirm `last_synced_at` does NOT
advance again (debounced) and the response/log shows
`ar_aging_debounced: true`. Wait past 60 seconds and trigger once more —
confirm it DOES sync again. Separately, confirm the existing Invoice CDC
sync (`syncQuickBooksInvoiceChanges`) still runs and its own
processed/failed status is unaffected by whatever happens with the
AR-aging trigger (they're independent — a broken AR-aging sync must never
mark an otherwise-successful Invoice webhook event as failed, or vice
versa). If real Intuit-side webhook delivery is available, the one check
that actually validates the end-user-visible feature: record a real
Payment/CreditMemo/JournalEntry/Deposit change in QuickBooks and confirm
the on-screen Outstanding/SOA total changes within roughly a minute,
without waiting for the daily cron.
**Guards:** `docs/INVARIANTS.md` INV-QB-021.

### REG-022 — Quotation trace matches QuickBooks and never silently loses rows
Run `npx tsx test-quotation-trace.ts` (pure join, 33 fixture checks — must
print `ALL OK`). Then against real data (`npx tsx --env-file=.env.local` a
scratch script calling `loadQuotationData()` from `lib/quotation-data.ts`):
confirm (1) every book reports `ok` and each book's `count` equals what
`SELECT COUNT(*) FROM Estimate WHERE TxnDate >= '<windowStart>'` returns in
QuickBooks itself — TAO 2 / TAC 0 were true on 2026-09-24, TAB 48; (2)
`PI260067` (TAO) traces to TAO `02660590` as a QuickBooks link with the amount
highlighted; (3) a split quotation such as `PI260088` shows TAB `02611060` (●)
plus TAC `02680304` (○) and "Traced S$8,050.00 = quotation S$8,050.00"; (4)
Bestar's later August invoices (`02660637`/`02660638`/`02610944`/`02680264`) do
NOT appear under `PI260067`; (5) invoice loading is complete — distinct ids
loaded equals the head count of `quickbooks_invoices` on/after `windowStart`
(the loader throws on a mismatch; if it ever does, look at INV-DATA-066
first). Permissions: an account WITHOUT `canViewQuotation` gets a redirect to
`/` on `/billing/quotation`, a 403 from `GET /api/billing/quotation`, and no
sidebar entry; re-run REG-016's flag check for every account (only Vincent
has `canViewQuotation`).
**Guards:** `docs/INVARIANTS.md` INV-QB-024, INV-DATA-066.

### REG-023 — Paging returns every row exactly once (after ANY change to `lib/page-all.ts`, `lib/supabase.ts` or a paged query)
Run `npx tsx test-page-all.ts`, `npx tsx test-supabase-auto-page.ts`,
`npx tsx test-paging-guard.ts` and `npx tsx test-soa-owner-tiebreak.ts` — each
must print `ALL OK`. Then against real
data: (1) through the real `pageAll()`, read the multi-page shapes that
matter and compare with the same query fetched sequentially ordered by `id` —
today's set: `quickbooks_invoices` year-filtered (2,326 rows: the AR Reminder
shape that used to lose 309), `quickbooks_invoices` since 2024 (8,047),
`quickbooks_invoice_items` (18,973), `master_list` (1,599), `email_drafts`
(2,039) — every row present once, zero duplicates, over several repeats (the
instability is plan-dependent; one clean run proves nothing). (2) A plain
`createAdminClient().from('master_list').select('id')` returns 1,599 rows, not
1,000. (3) On the AR Reminder page, expand a 2026 row whose invoice used to
vanish (LOYANG BESTCONN TRADING & SERVICES, April 2026 → 02611026; ASIA BLUE,
June 2026 → 02610940; ECAPTIAL, June 2026 → 02610948 + 02680266) and confirm
"QB Invoices" lists it. (3b) SOA Main-PIC suggestions must stay put: with no
confirmed PIC MINYOTECH PTE. LTD. (TAB) suggests Hoo Seng Xin, and HAN KUN LLP
(TAO) suggests Lee Jing Fei (= its confirmed PIC, so `soa_owner_audit` must NOT
list it) — those two are the only customers the same-day tie-break can move
(INV-DATA-066 part 3). (4) Watch the Vercel logs for `[supabase] unpaginated
read of "<table>" hit the 1000-row cap` after a few days: each line names a
call site that should be converted to `pageAll()`, and a table that keeps
appearing is approaching a real problem.
**Guards:** `docs/INVARIANTS.md` INV-DATA-006, INV-DATA-066.

### REG-024 — Master List status: Move stamps the placeholder, only TeamWork writes "Terminated" (after ANY change to `lib/master-list-status.ts`, `teamwork/sync`'s status block, the Move route or a Move menu)
Run `npx tsx test-master-list-status.ts` — it must print `ALL OK`. Then against real
data: (1) Move a test row Active Client → Terminated Services: it must show
"Terminate" (NOT "Terminated"); Move → Strike Off must show "Striking Off". After
the next `teamwork/sync` a row whose company TeamWork lists as Terminated must
have become "Terminated" — that change is the confirmation — and a row TeamWork
does not list must still say "Terminate". (2) After a sync run, its JSON
reports `master_list_terminated_defaults` and the Terminated Services page shows
no "YES", blank, "terminate" / "TERMINATED" (case matters) or other hand-typed
status: the only values left are exactly "Terminate",
"Terminated", and rows TeamWork itself reports as something else (2026-09-24: 7
"Active", 2 "Striking Off"; fix those in TeamWork, do not force them here).
(3) A row whose Status was typed by hand (manual lock) must keep what was typed
through a sync. (4) `audit_log` shows the old value for every rewritten row,
`changed_by = 'system:terminated-list-default'`.
**Guards:** `docs/INVARIANTS.md` INV-DATA-064, INV-DATA-067.

### REG-025 — Terminated-exclusion pass never disagrees with the marker-clearing pass about "is this UEN terminated" (after ANY change to `app/api/late-filing/sync/route.ts`)
Against real data: build the same two sets the route builds internally
(`terminatedUenKeys` from `companies`, `terminatedUens` from `master_list`
`terminated`/`strike_off`) and confirm every UEN in their union that ALSO has
a live `companies` row with `is_active=true` and `tw_status` NOT in
`['Terminated','Striking Off']` is excluded from the final
`allTerminatedUenKeys` (i.e. `isTerminatedCompany(uen, '')` returns false for
it) — a company whose `master_list` entry is stale must never be excluded
from AR Reminder while its live `companies` row says Active. Confirm the
opposite too: a UEN with NO `companies` row at all but a `master_list`
`terminated`/`strike_off` entry still IS excluded (the real fallback case —
MIX POINT PTE. LTD., ADVANCE BRIGHT GLOBAL, FULLRICH INTERNATIONAL are the
known real examples). After a real run, spot-check that no `ar_reminder` row
for a company whose `companies.is_active=true` currently shows
`status='Excluded'` with `updated_by_email='system:late-filing'`.
**Guards:** `docs/INVARIANTS.md` INV-AR-013, INV-AR-014, INV-AR-015, INV-AR-016.

### REG-026 — Only the real TeamWork record changes a company; no live client's AR can silently vanish; one definition of "active client" everywhere (after ANY change to `lib/company-lifecycle.ts`, `teamwork/sync`'s matching/status code, `late-filing/sync`'s termination/exclusion code, or ANY code that decides whether a company is active / terminated / tracked — a roster, a filter on `is_active`/`tw_status`, a status list)
Run `npx tsx test-company-lifecycle.ts` — it must print `ALL OK` (rules,
replayed incidents, source guards, the "who may write status 'Excluded'"
tripwire, and the "one definition" guard — if it names a file, move that
rule into `lib/company-lifecycle.ts`; only add to its reviewed-reads list a
read that truly just DISPLAYS the value). Then after the next real runs:
(1) `teamwork/sync`'s JSON reports `stub_records_ignored`,
`blank_status_ignored`, `tracked_records_blank` — each one is a TeamWork
record that was REFUSED, and the matching `teamwork_companies` exceptions on
Automation Health name them (2026-09-28 baseline: 0 / 0 / 2 — EVOP
(SINGAPORE) INTERNATIONAL, WORLD PRECISION MACHINERY). (2) `late-filing/sync`'s
JSON: `activeCompaniesWithAllArHidden` must be 0; `exclusionBlocked`/
`restoreBlocked` 0 unless a real mass event is under review;
`restoredExcluded` explains itself in `ar_reminder_audit` (actor
`system:late-filing-restore`). (3) Spot-check the replay: XGC SINGAPORE (UEN
202006514R) stays `tw_status='Active'`, `internal_id='978'`, its March 2026 AR
cycle `Pending`. (4) `teamwork/sync`'s JSON `lifecycle_fields_inconsistent`
is 0 (2026-09-28 baseline: 0). (5) The rosters still agree: AR Generate, Late
Filing sync and the Companies page select the same companies (904 on
2026-09-28) and Billing Drafts is their CSS Client subset (794).
**Guards:** `docs/INVARIANTS.md` INV-TW-022, INV-TW-023, INV-TW-024, INV-AR-015, INV-AR-016, INV-AR-017, INV-AR-018.

---

### REG-027 — Per-line PIC (QuickBooks Class) on Billing Drafts invoices (after ANY change to `lib/invoice-pic-class.ts`, `buildInvoiceLineArray()` / `listActiveClasses()` / `findPicClass()` in `lib/qb-invoice-conventions.ts`, the create/update invoice routes, `getLiveInvoice()`, or the popup's PIC column)
Run `npx tsx test-invoice-pic-class.ts` — it must print `ALL OK` (the
default rule is still INV-QB-007, explicit choices win, an edit round-trips
every line's Class, source guards). Then in the real app, signed in:
(1) open a company that already has a TAB invoice this cycle — the PIC
column must show exactly the Classes on that invoice in QuickBooks (e.g.
#02611099: Secretary = Jenny Lai, the other lines "— No PIC"); save without
changing anything and confirm in QuickBooks that no line's Class changed.
(2) change one line's PIC, save, and confirm only that line's Class changed.
(3) for a new invoice, Secretary/XBRL lines pre-fill the company PIC's Class
and other lines show "— No PIC"; a company whose PIC has no QuickBooks Class
shows "no matching QuickBooks Class — pick per line". (4) a TAC Nominee
Director line shows "<initials> · in ND item", never a dropdown. (5) TAO: open
a client with TAO history (e.g. 1V CAPITAL: Yearly Accounts / Compilation
= Lee Jing Fei, Corporate Tax = To Be Assign, OPE "— No PIC") — each line's
PIC is the one on its last QuickBooks line; after generating, QuickBooks
must show those Classes per line, the generator's own Location, and a
Statement memo written from the ticked lines (e.g. "Yearly accounting
services,Compilation report,Tax YA 2027").
(6) Statement memo: run `npx tsx test-statement-memo.ts` (`ALL OK`). No
memo field appears anywhere (it is automatic); after generating a new TAB
invoice, QuickBooks' Statement memo reads like staff's own and matches the
ticked lines (e.g. "Sec,addrs (Oct 2026 - Sep 2027),AR 31.12.2026");
editing an existing invoice leaves its memo untouched.
(7) Location (INV-QB-028): signed in as a TCS ACCOUNT/TAX account (e.g. Jay
Tay), generate one TAB invoice — QuickBooks shows Location "Jay Tay", the
Secretary/XBRL lines still carry the company PIC's Class, and that client's
TAB Owner on Outstanding is unchanged. A TAC invoice he generates carries no
Location (none exists for him in TAC). If a QuickBooks Location is ever
added, renamed or deactivated, re-read the book's list into
`test-invoice-pic-class.ts` first.
**Guards:** `docs/INVARIANTS.md` INV-QB-007, INV-QB-013, INV-QB-026, INV-QB-027, INV-QB-028.

### REG-028 — Turnover AI uploads actually land, at any file size or format staff use (after ANY change to `app/api/turnover-ai/extract/route.ts`, `lib/turnover-ai.ts`'s extraction call, `lib/turnover-ai-files.ts`, `components/turnover-ai/prepare-upload.ts`, the upload loop in `app/turnover-ai/project/[id]/page.tsx`, or the `turnover_documents` / `turnover_line_items` schema)
Run `npx tsx test-turnover-files.ts` (`ALL OK`). Then on the DEPLOYED site
(local `next dev` has no 4.5MB limit and a mocked API never runs a real
insert — INV-DATA-071), signed in: (1) drop one small real PDF into a
project — it reads, receipts appear, and the file is NOT listed under
"couldn't be read". (2) drop an iPhone HEIC photo in Chrome/Edge — it
converts and reads (its receipts' source and "View original" are the
converted .jpg).
(3) drop a phone photo over 4.4MB — it is shrunk and reads. (4) drop a PDF
over 4.4MB — its row says to split it and nothing is sent. (5) a file whose
read fails shows on the project page with its reason, and the Projects card
counts it as "couldn't be read", not as a file; its Remove button takes the
line away (and the card's count with it after going back). (6) a
Chinese-named PDF's "View original" opens.
**Guards:** `docs/INVARIANTS.md` INV-DATA-070, INV-DATA-071, INV-DATA-072.

### REG-029 — AI usage ledger stays complete and correctly attributed (after ANY change to `lib/ai/*`, any code that calls an AI model, an AI feature's route, or `scripts/add-ai-usage-events.sql`)
Run `npx tsx test-ai-usage.ts` (`ALL OK`). It fails if any file outside
`lib/ai/anthropic.ts`/`lib/ai/openai.ts` calls an AI API directly, if the
token buckets or the price table drift, or if a feature stops tagging the
real person. Then on the DEPLOYED site, once `scripts/add-ai-usage-events.sql`
has been run, signed in: (1) ask the assistant one question —
`ai_usage_events` gains one row per model call within seconds (e.g.
`round_1`, `round_2`…), all with your email as `actor_email`, one shared
`turn_key`, the model, non-zero tokens and a `cost_usd`. (2) ask one under
View As — `actor_email` is still you, `subject_email` the viewed person.
(3) open My Tasks with tasks on it — one `my_tasks_brief` row, trigger
`auto`, with you as `actor_email`; on Admin › AI Usage it counts under 系统
(not under you, and not under the colleague whose page you viewed), shown
as "给 <name>" (INV-AI-010, 2026-10-07). (4) compare one day's total with the Anthropic/OpenAI
consoles for the same day; a real gap means a call path isn't recorded
(or requests are timing out). (5) as Vincent, open Admin › AI Usage — the
calls from (1)–(3) are there under the right person within 30 seconds (the
View-As one under you, "代 …" beside it; the brief in "自动"); as any other
account `/ai-usage` sends you to your home page and `GET /api/ai-usage`
returns 403.
**Guards:** `docs/INVARIANTS.md` INV-AI-010.

### REG-030 — A generated invoice always shows and sends QuickBooks' current number and amount (after ANY change to `lib/current-invoice-values.ts`, the `generated_invoices` reads in `app/api/billing/renewals/route.ts` / `lib/client-comms-resolve.ts` / `app/api/ar-reminder/route.ts` / `lib/company-360.ts`, `app/api/quickbooks/invoice-pdf/route.ts`, the refresh-amounts route, `lib/draft-helper-client.ts`, or the duplicate-number check in create-invoice)
Run `npx tsx test-current-invoice-values.ts` (`ALL OK`). Then signed in on
the deployed site: (1) Billing Drafts, 1X EXCHANGE's row (Dec FYE) shows
TAB #02611112, and its chip opens 1X's own invoice (not Nucon's); its
"Editing invoice #" header says #02611112. (2) Novozee's row says S$1,720.
(3) Quick Draft an AR email for a company whose invoice was changed in
QuickBooks after generation — the review screen shows QuickBooks' current
number and amount, and the attachment file name carries the current number.
(4) Generate a test invoice normally — it is created; QuickBooks being
unreachable must instead give "didn't answer … nothing was created".
**Guards:** `docs/INVARIANTS.md` INV-QB-030, INV-QB-005, INV-QB-010.

### REG-031 — Editing a split invoice shows each service once and keeps accounting's lines (after ANY change to `lib/deferred-pairing.ts`, the edit/save path of `components/billing/ExpandedBillingRow.tsx`, `lib/quickbooks-invoice-lines.ts`, or `app/api/quickbooks/update-invoice/route.ts`)
Run `npx tsx test-deferred-pairing.ts` (`ALL PASSED`). Then signed in on
the deployed site, on an unpaid invoice the system generated that
Chelsea has since split (e.g. 1X EXCHANGE TAB #02611112): (1) Billing
Drafts' editor shows Secretary S$700 as ONE line, no Deferred row, same
total as QuickBooks. (2) Save without changes — in QuickBooks the invoice
still has Secretary 175 + Deferred Revenue - Corp Sec 525, same Class.
(3) A TAB invoice carrying ND fees keeps its ND line in the TAB table and
after a TAB save. (4) An invoice whose twin can't be paired shows the
yellow notice and a read-only deferred row.
**Guards:** `docs/INVARIANTS.md` INV-QB-029, INV-QB-031.

### REG-032 — The invoice PDF a client receives shows each service once (after ANY change to `lib/client-invoice-*.ts`, `lib/pdf-chinese-text.ts`, `lib/deferred-pairing.ts`, `templates/client-invoice/`, `/api/billing/client-invoice-pdf`, the SOA PDF route, or the attachment code in `lib/draft-helper-client.ts`)
Run `npx tsx test-client-invoice-model.ts` and `npx tsx test-deferred-pairing.ts`
(`ALL PASSED`). Then signed in on the deployed site: (1) Billing Drafts →
a split invoice (e.g. 1X EXCHANGE TAB #02611112) → Save TAB PDF: one
Secretary line S$700, total = QuickBooks, letterhead/bank/PayNow QR as
QuickBooks prints them. (2) Quick Draft an AR email for a split invoice —
the attachment is the same one-line version, with no amber note. (3) An
SOA PDF for a client with a split invoice shows it the same way. (4) An
invoice with no Deferred line is QuickBooks' own PDF, unchanged. (5) A
Chinese-named client's split invoice (e.g. 江苏日月照明电器有限公司, TAC
#02680202) prints the Chinese name in BILL TO — no amber note, no blank or
boxed characters, English on the same line in the same font as the rest.
(6) That same invoice's long one-line address wraps onto a second line and
stays clear of the DATE / DUE DATE column on the right (it ran through it
until 2026-10-06).
**Guards:** `docs/INVARIANTS.md` INV-QB-029.

### REG-033 — TAO builder offers every QuickBooks TAO item with its description (after ANY change to `lib/tao-services.ts`, `components/billing/TaoInvoiceBuilder.tsx`, the TAO branch of create-invoice, or `getItemMap`)
Run `npx tsx test-tao-catalog.ts` (`ALL OK`). Then signed in, Billing System › TAO, expand any client: (1) "Add line" lists the 5 categories plus "No category" (Discount Given, Sales, Contra…), 129 items in all today. (2) Choosing Accounts › Yearly Accounts Services fills "Being professional services rendered for the year ended … - Yearly accounting services"; Discount Given fills "Goodwill discount". (3) "Custom / Other…" adds a custom line, not ACRA Fees. (4) Generate a TAO invoice with a Secretary item (e.g. Admin Fee) and a discount at a negative rate — it is created, no period error. (5) TAB/TAC renewals still stop on a missing period.
**Guards:** `docs/INVARIANTS.md` INV-QB-032.

### REG-034 — TAB/TAC items resolve exactly and one-off services are not period-checked (after ANY change to `buildInvoiceLineArray` / `getItemMap` / `pickItem`, `needsRenewalPeriodCheck`, the create/update invoice or create-quotation routes, or the editor's save)
Run `npx tsx test-item-resolution.ts` (`ALL OK`). Then signed in: (1) Billing Drafts, add "Change of Director" to a TAB draft with a plain description — Generate is not blocked by a period message. (2) a normal renewal (Corp Sec with no period text) still stops with "enter a complete service period". (3) edit an existing invoice and save without changes — every line keeps its QuickBooks item (compare in QuickBooks). (4) Quotation page, TAC: a TAB-only item gives "QuickBooks has no item named …" and nothing is created.
**Guards:** `docs/INVARIANTS.md` INV-QB-033.

### REG-035 — Billing Drafts' Add line lists the book's live QuickBooks items with their description and no price (after ANY change to `lib/qb-item-classify.ts`, `lib/qb-item-catalog.ts`, `/api/billing/item-catalog`, `components/billing/BookItemPicker.tsx` or the Add line wiring)
Run `npx tsx test-book-catalog.ts` (`ALL OK`). Then signed in, Billing Drafts: (1) TAB "Add line" shows QuickBooks' groups (Accounts, Disbursement, Other, Secretary, Tax, No category) incl. ACRA Fees and Discount Given; (2) picking Change of Director fills QuickBooks' text and an EMPTY highlighted rate, Generate waits for it; (3) on a company with an ND line, the TAC list has "Nominee Director Fees - EL" and TAC-named items (e.g. CPF Submission); (4) a generated invoice shows those items in QuickBooks with the picked text.
**Guards:** `docs/INVARIANTS.md` INV-QB-034, INV-QB-033.

### REG-036 — The SOA PDF cover prints Chinese client names (after ANY change to `lib/statement-pdf.ts`, `lib/pdf-chinese-text.ts`, `templates/client-invoice/NotoSansSC-Regular.ttf`, or the SOA PDF route)
Run `npx tsx test-statement-cover-chinese.ts`, `npx tsx test-content-disposition.ts` and `npx tsx test-client-invoice-model.ts` (`ALL PASSED`). Then signed in, SOA → All: click the "TAB TAC" badge of 思店科技(杭州)有限公司 — both PDFs download (the badge must NOT turn red; it did until 2026-10-05, INV-DOC-022 — if a book ever fails, hover the chip: it names the book and the reason), and Draft Email attaches them (in All mode a failing book now stops the draft and names the book instead of being left out — INV-DOC-023); the cover's TO line reads 思店科技(杭州)有限公司 in bold (not "()"), and the 【Lzs Travel Pte. Ltd.】 description keeps its brackets; an English-named client's cover looks exactly as before. Checking the SOA web page is NOT enough — it always showed the name.
**Guards:** `docs/INVARIANTS.md` INV-DOC-011, INV-DOC-022, INV-DOC-023, INV-QB-029.

### REG-037 — Company searches accept commas (after ANY change to `lib/postgrest-or.ts`, `app/api/companies/route.ts`, `app/api/master-list/route.ts` or `app/api/ar-reminder/search/route.ts`)
Run `npx tsx test-postgrest-or.ts` (`ALL PASSED`). Then signed in, type `500 DURIANS II, L.P` into the Companies search, the Master List search and AR Reminder's search: each finds that company (it used to answer with an error), and an ordinary search (a few letters of a name) returns the same rows as before.
**Guards:** `docs/INVARIANTS.md` INV-DATA-075.

### REG-038 — A new invoice carries its copy in QuickBooks (after ANY change to `lib/quickbooks-attachments.ts`, `lib/quickbooks-attachments-http.ts`, `lib/quickbooks-invoice-copy.ts`, `lib/quickbooks-invoice-pdf.ts`, or the create-invoice / update-invoice routes)
Run `npx tsx test-qb-attachments.ts` (`ALL PASSED`). Then signed in, Billing Drafts: generate an invoice (and one in the TAO builder) — the result line ends "invoice copy attached in QuickBooks". Open that invoice in QuickBooks: Attachments holds ONE file named like Save PDF's (`INV<no>-<customer>-S$<amount>.pdf`). Edit its lines in the editor and save — the message says its copy in QuickBooks was refreshed, and Attachments still holds one file (the new one); a file attached by hand next to it is untouched. If QuickBooks refuses the file, the result line shows a ⚠ naming the book and the reason, and the invoice itself is fine.
**Guards:** `docs/INVARIANTS.md` INV-QB-036, INV-QB-029, INV-QB-009.

### REG-039 — A split invoice goes out as its original when one is attached in QuickBooks (after ANY change to `lib/original-copy.ts`, `lib/pdf-text.ts`, `lib/quickbooks-original-copy.ts`, `lib/quickbooks-attachments-http.ts`, `lib/client-invoice-pdf.ts`, or the `pdf-parse` tracing in `next.config.ts`)
Run `npx tsx test-original-copy.ts` (`ALL PASSED`). Then on the DEPLOYED site (the PDF reader's worker file only exists there): take ONE open split invoice (two lines in QuickBooks: the service and "Deferred Revenue …"), have staff attach its original PDF to it in QuickBooks, and download that customer's SOA PDF — the invoice inside shows the service ONCE at its full amount, and it is the attached file (QuickBooks' own letterhead and layout, not the system's drawing); Draft Email and Save PDF give the same file. On a second split invoice attach the PDF that Save PDF produced (the system's own drawing), and on a third a PDF of another client's invoice: both still come out as before (the redraw), and the Vercel log has "Attached original not used (…)" naming the reason. An invoice with nothing attached is unchanged. If a good attachment still comes out redrawn, read that log line first — "Setting up fake worker failed" means `pdf.worker.mjs` is missing from the function (the `next.config.ts` tracing).
**Guards:** `docs/INVARIANTS.md` INV-QB-037, INV-QB-029, INV-QB-036.

### REG-040 — The Invoice Originals page lists only the split invoices without an accepted original, and its upload attaches only provable files (after ANY change to `lib/original-status-core.ts`, `lib/original-status.ts`, `lib/original-upload.ts`, `lib/original-upload-live.ts`, `lib/original-decisions.ts`, the proof in `lib/original-copy.ts`, `app/api/billing/originals/**`, `app/billing/soa/originals/page.tsx`, the bulk read in `lib/quickbooks-attachments-http.ts`, or `prepareInvoiceForClient` / `loadInvoiceForClient` in `lib/client-invoice-pdf.ts`)
Run `npx tsx test-original-status.ts`, `test-original-upload.ts`, `test-original-decisions.ts`, `test-original-copy.ts`, `test-account-access.ts` and `test-assistant-pages.ts` (`ALL PASSED` / `ALL OK`). Then on the DEPLOYED site, signed in: Billing System › Invoice Originals lists — within about a minute the first time, seconds after — exactly the open invoices that carry a Deferred Revenue line and have no accepted original (none on the evening of 2026-10-07, once the 13 originals Vincent named were attached; the 153 open split invoices are only counted in the header: 146 with the original in use, 7 decided to stay as they are), and an account of a department without Outstanding (check the sidebar of a TCS CORPSEC or TCS ACCOUNT login) sees the entry exactly when it sees Outstanding. Offer a WRONG file to a waiting invoice (another invoice's PDF; the Save PDF file; a screenshot): each is refused with its reason and a hint, nothing is attached in QuickBooks, the row stays. Then the RIGHT file for one invoice — a real write to QuickBooks, so only with Vincent's go-ahead and an invoice he names: the row leaves the list, the invoice in QuickBooks carries a new attachment named "<book> <no> - <customer> - original.pdf" whose Note names who uploaded it, the SOA / Email Drafts / Save PDF for that customer now contain that file, and the Vercel log shows "[originals/upload] <book> <id> attached (<email>)". Uploading it again answers that the invoice already has its original and attaches nothing. The SOA PDF (Outstanding › PDF) of EVOP (Singapore) International, NOVA GOLDEN ALPHA, Soon & Guan Manpower Trading and Minyotech (TAB) carries the ORIGINAL pages of #02610547, #02610907, #02611000, #02610788 and #02610789 (the last two are pictures); Co-Operate Associates carries the original of #02610167 (the older layout: 600 / 600 / 60 / 600, "Net Total S$1,860.00" — no Deferred line and no split-fallback warning); British Sports #02610680 (2 pages: the second only holds the PayNow QR), Goldhill, International LCM #02610687 (its second page is blank, as the client received it), Kindle Beacon and the TAC customers Aries Honor, DEMIRER KABEL, Yu An Bulk, Singapore Hua Jin (#02680153), Sunterra, Warm Sea Wind and Najiwan carry their original pictures; the redraw stays only for the six invoices changed after sending (TAB #02610402, #02610580, #02610747, #02610888, #02611080, #02611099) and QuickBooks' own PDF only for Sanli #02511395 (no SOA is sent). A book QuickBooks cannot read shows the red "could not be fully checked" chip, never an empty list.
**Guards:** `docs/INVARIANTS.md` INV-QB-037, INV-QB-036, INV-QB-029.

### REG-041 — An SOA draft goes to the right company and lists what its statement shows; the SOA detail opens the client's invoice (after ANY change to `lib/soa-draft-resolution.ts`, `loadCompanies()` in `lib/client-comms-resolve.ts`, `app/api/client-communications/campaigns/preview/route.ts`, `lib/campaign-draft-client.ts`, `lib/soa-actions-client.ts`, `components/billing/BillingInvoiceReference.tsx`, `lib/invoice-pdf-request.ts`, or the SOA detail in `app/billing/soa/_components.tsx`)
Run `npx tsx test-soa-draft-resolution.ts`, `npx tsx test-soa-invoice-chip.ts` and `npx tsx test-company-lifecycle.ts` (`ALL OK`). Then on the DEPLOYED site, signed in, SOA: (1) EVOP (SINGAPORE) INTERNATIONAL — Draft Email opens a draft to its contact with TAB #02610547 S$1,800 in the body (it used to answer "No matching company found"); (2) SOON & GUAN MANPOWER TRAINING's TAB draft lists #02611000 S$1,460 (it used to list nothing) and the "All" draft of YU AN (SGP) HOLDING lists the TAC and TAO invoices (S$6,365) and attaches only its TAC and TAO statements — not Yu An Bulk Holding's TAB #02610643 S$800; (3) a company that has no row in the company list (e.g. Ainex Education) says there is no email address on file; (4) open a company's detail and click the number of an invoice accounting has split — the PDF shows each service once (no Deferred line), and a credit note still opens QuickBooks' own PDF; (5) Campaign Centre's SOA auto list still offers only active companies, and an AR or letter draft for an inactive company still answers "No matching company found".
**Guards:** `docs/INVARIANTS.md` INV-MAIL-006, INV-QB-038, INV-QB-029, INV-TW-024, INV-AR-018.

### REG-042 — SG Latest News: every card opens its own article, and every source actually delivers (after ANY change to `lib/sg-news-links.ts`, `lib/sg-news-fetch.ts`, `lib/sg-news-sources.ts`, `lib/sg-news-sync-plan.ts`, `lib/sg-news-report.ts`, `lib/sg-news-digest.ts`, `app/api/sg-news/**`, `app/sg-news/page.tsx`, or the SG News entry in `vercel.json`)
Run `npx tsx test-sg-news.ts` (`ALL OK`). Then the read-only live check — it runs the app's REAL fetch code (headless Chromium) on the 9 real pages and the real matcher over the stored headlines, with no model call and no writes: `ENV_FILE=<path to .env.local> npx tsx scripts/check-sg-news-sources.ts [--compare-old] [source keys]`. Expect every source fetched with HTTP 200 and well over 300 characters; `MISS 0` (a stored headline that IS on the page but got no link); no `SAME ADDRESS` line; each `CHECK BY EYE` line judged by a person (MOM's abbreviated addresses are fine). A source with no stored items must list headline links — if it lists none, its URL is a menu, not the list (INV-DATA-077 (6)). `--compare-old` also fetches every page the way the code did before 2026-10-07 and must say SAME for every source (CSIS is the one expected DIFFERENT: old HTTP 403, new 200). It cannot show the Vercel Lambda itself (its Chromium, memory, `/tmp`, how the sites treat its addresses): only a real run does, and every real run now documents itself. Then on the DEPLOYED site, after the next 06:30 SGT run (or one press of 「手动运行一次」 — safe, a second run on the same day adds to the report), read `automation_sync_runs.summary` for the latest `sg_news_sync` run (read-only): per `sources[]` entry `facts.status` 200, `facts.chars` above 300, `facts.finalUrl`, `facts.tmpFreeMB`, `facts.attempts` (3 = every retry used), `extracted`, `linked`; `silent` empty; `warnings` empty; also `sg_news_sync_state` (every source `success`; CSIS is expected to be empty) and the day's `sg_news_daily_reports.sources_failed`. The FIRST run that reads IRAS and ISCA must show `firstRun: true`, their whole page stored (`newItems`) and `reported: 0` (silent baseline, Vincent 2026-10-07); the run after it reports only what is new. Count `sg_news_items` rows with `url` set per source and open 3 cards from different sources — each "来源 · host" opens ITS article, not a menu or the front page; a section with only 2 cards shows them at the 4-column width with the right half empty. An open `sg_news_sync/source_silent` exception on the Dashboard's Automation Health means "this source has read nothing for 3 days". Never trigger the production sync from a script (no CRON_SECRET use, no ad-hoc writes).
**Guards:** `docs/INVARIANTS.md` INV-DATA-077, INV-CRON-016, INV-CRON-017, INV-CRON-019.

---

## Automation priority

Automate a check here only when it is frequent, historically buggy, cheap
to verify programmatically, and either business-critical or expensive to
keep checking by hand — not for completeness. REG-008 (automation-run
status) is the strongest automation candidate of the twelve, since it's
already a structured DB query rather than a real UI/data walkthrough; the
rest are deliberately manual for now.

### REG-043 — SOA PIC column = QuickBooks' own PIC (after ANY change to `picShownFor` / `picShown` in lib/soa-data.ts or the SOA page's PIC column / PIC filter)
Run `npx tsx test-soa-pic-column.ts` (`ALL OK`). Then signed in, Billing System › Outstanding › ALL: ACN CONSULTANTS' TAB row shows only Ang Shi Ming, its TAO row Tee Yu Heng, the combined row both; the owner dropdown still offers Chin Kah Ye; a TAC company whose invoices carry no Class and are not all Nominee Director services still shows its TeamWork PIC (an all-ND one shows "—", REG-046); filtering by Chin Kah Ye no longer lists ACN's TAB row unless she is its chosen owner.
**Guards:** `docs/INVARIANTS.md` INV-PIC-008, INV-PIC-007.

### REG-044 — SOA Main PIC follows the system; only people's picks and BD override it (after ANY change to `lib/soa-main-pic.ts`, `soaPicSource` / `classOwner` in lib/soa-data.ts, the SOA page's owner dropdown/filters, or the soa-owners audit)
Run `npx tsx test-soa-main-pic.ts` (`ALL OK`). Then signed in, Outstanding: FINSIGHTS MEDIA TAB and 1X EXCHANGE show Main PIC Jenny Lai (= the PIC column); Quantum Marine / RTG Projects / Monster Game still show Bad Debt; picking someone in the dropdown sticks (navy, bold) and survives a reload; My Tasks shows the same owner as the page.
**Guards:** `docs/INVARIANTS.md` INV-PIC-009, INV-PIC-008, INV-PIC-007.

### REG-045 — An SOA email quotes what is still owed; a debt with no invoice behind it has a cover-page statement; the statement never uses another company's customer (after ANY change to `lib/draft-refresh.ts`, `app/api/client-communications/drafts/refresh-amounts/route.ts`, `app/api/billing/soa/pdf/route.ts`, `lib/statement-pdf.ts`, `coverOnlyRefs` / `customerBelongsToAnotherCompany` in `lib/soa-draft-resolution.ts`, or the cover-only step of the preview route)
Run `npx tsx test-draft-refresh.ts`, `npx tsx test-soa-draft-resolution.ts` and `npx tsx test-company-lifecycle.ts` (`ALL OK`). Then on the DEPLOYED site, signed in: (1) open the SOA Draft Email of a customer with a partly paid invoice (Easybook Pay TAB #02510178: invoice S$1,660, S$200 owed) and let the page prepare it — the body still lists S$200 and the total matches the statement (it used to turn into 1,660); an AR renewal draft's amounts are unchanged; (2) INVENTA TECHNOLOGIES (TAB, S$1,505.50): Download SOA PDF gives a one-page statement with OPNG JE, and Draft Email opens a draft whose body lists OPNG JE S$1,505.50 with that statement attached; EASYFLY likewise; (3) YU AN (SGP) HOLDING on the All page: Draft Email attaches TAC and TAO statements only, and Download SOA PDF for TAB answers "No outstanding invoices found"; (4) a company with an unpaid invoice whose document has not synced yet still answers "No outstanding invoices found" (never a cover page alone); (5) an SOA draft whose lines include a credit note keeps its amounts when it is opened after accounting applied that credit to the invoice (the body does not drop by the credit twice).
**Guards:** `docs/INVARIANTS.md` INV-MAIL-007, INV-DOC-024, INV-MAIL-006, INV-QB-017.

### REG-046 — A TAC row that is all Nominee Director services has no PIC and follows TAB's Main PIC (after ANY change to `ndFollowsTab` / `tabMainPic` / `loadNdOnlyInvoiceIds` / `attachTabMainPic` in lib/soa-data.ts, the ND branch of `lib/soa-main-pic.ts`, or a `computeSoaRows('TAC')` caller that passes `tabRows`)
Run `npx tsx test-soa-main-pic.ts` (`ALL OK`). Then signed in, Outstanding › TAC: ADVANCE CF TECHNOLOGY shows PIC "—" and Main PIC Jenny Lai (its TAB Main PIC); ALL: its combined row shows PIC Jenny Lai and one Main PIC; EARLY SUMMER GROUP (ND + EP application) still shows Hoo Seng Xin in the PIC column; Cumaster International (HK) shows an empty Main PIC; a non-ND TAC row (e.g. HUASHENG TECH) is unchanged; My Tasks for Jenny Lai lists ADVANCE CF's TAC balance.
**Guards:** `docs/INVARIANTS.md` INV-PIC-010, INV-PIC-009.

### REG-047 — SOA: clients who overpaid are listed (red negative); the full workbook has per-person sheets (after ANY change to `app/billing/soa/_components.tsx`'s list filter / cards / row actions, `app/api/billing/soa/export-all/route.ts`, `lib/soa-export.ts` or `lib/soa-person-book.ts`)
Run `npx tsx test-soa-person-book.ts` (`ALL OK`). Then on the DEPLOYED site, signed in: (1) open Billing System › Outstanding › All: a client with a negative Total shows it in red with "We owe client" instead of a Reminder, no mail icon, and its detail panel says "We owe this client S$…" with no download/draft button; Total = 0 clients are not listed; (2) the cards read Clients With a Balance / Total Outstanding (= owed minus overpaid) / Current / Overpaid — click Overpaid: only those clients, click again: all; (3) Export Full Workbook: sheets All, TAB, TAO, TAC, then one per person (Bad Debt last); an overpaid client is there with a negative Total and "We owe client (overpaid)"; open one person's sheet and check a client they own one source of shows ALL its sources.
**Guards:** `docs/INVARIANTS.md` INV-DATA-078, INV-PIC-009.

### REG-048 — SOA: no Main PIC — everyone the PIC column lists is responsible (after ANY change to `lib/soa-main-pic.ts`, the SOA page's people filter / PIC cell, `lib/my-tasks-data.ts`'s SOA collections, `lib/soa-person-book.ts`, or the PIC column's source in `lib/soa-data.ts`)
Run `npx tsx test-soa-main-pic.ts`, `npx tsx test-soa-person-book.ts` and `npx tsx test-soa-pic-column.ts` (`ALL OK`). Then on the DEPLOYED site, signed in: (1) Billing System › Outstanding › All: there is no "Main PIC" column; CO-OPERATE ASSOCIATES shows its PIC people (Ang Shi Ming / Jay Tay / Clarence Saw) and picking ANY ONE of them in the people filter shows the company with all its sources; (2) the Remarks box is still free text and its small arrow offers "Bad Debt" — choosing it shows a red "Bad Debt" tag (on a multi-book company: all its books) and "Remarks only" removes it; the Bad Debt filter then lists it; (3) My Tasks for each of those three people lists the company under SOA Collections; (4) Export Full Workbook: each of the three has a sheet containing the company (all its sources), and the PIC column of the All sheet lists all the people.
**Guards:** `docs/INVARIANTS.md` INV-PIC-011, INV-PIC-008, INV-PIC-010.

### REG-049 — SOA: the Group email (after ANY change to `components/billing/SoaGroupModal.tsx`, `lib/soa-group-draft-client.ts`, `lib/soa-group-email.ts`, `fetchAllBookSoaPdfs` in `lib/soa-actions-client.ts`, or the Group button on the SOA page)
Run `npx tsx test-soa-group-email.ts` (`ALL OK`). Then on the DEPLOYED site, signed in, with the Outlook Helper running: (1) Billing System › Outstanding: a navy "Group" button sits beside "Export Full Workbook" on All / TAB / TAC / TAO; (2) click it, tick the three Aquila companies, type a subject, "Create draft": the review window opens with that subject, the three companies' recipients merged, the body in Chelsea's layout (total across the group, "1. Company (S$…)" sections) and each company's SOA PDF(s) attached; the total equals the sum of the three companies' Total in the list; (3) tick a company that has no email on file: no draft is made and the message names it; (4) close the review window WITHOUT sending, then open Email Activity: the group draft is there, and the companies' "1st Reminder (Done)" status on the SOA list did NOT change.
**Guards:** `docs/INVARIANTS.md` INV-MAIL-009, INV-MAIL-006, INV-MAIL-007.

## REG-050 — Quotation: Completed + Remarks
**Trigger:** any change to `app/billing/quotation/page.tsx`, `lib/quotation-data.ts`, `lib/quotation-reviews.ts`, `app/api/billing/quotation/route.ts`.
**Run:** `npx tsx test-quotation-reviews.ts` (`ALL OK`). After `scripts/add-quotation-reviews.sql` is run, on the DEPLOYED site: (1) Billing › Quotation shows Completed and Remarks columns and a 5th "Completed" card; (2) type a remark, click elsewhere, reload: it persists; (3) an Open PI shows "—" (cannot complete); on a Closed PI press Completed, confirm: the row leaves the list, the Completed card count rises, clicking the card shows it with date/person and its remarks still editable; (4) Reopen returns it to the list; (5) the list starts 12 months back.
**Guards:** `docs/INVARIANTS.md` INV-QB-039.

## REG-051 — Typography: one font, weights
**Trigger:** any change to `app/globals.css` font rules, `lib/theme-tokens.ts` FONT_OPTIONS, or adding `fontFamily`/`fontWeight` in pages.
**Run:** `grep -rn "fontFamily" app components --include=*.tsx | grep -v inherit` should list only OutlookStyleSendModal and the Appearance code input; no `fontWeight` 750/800/850/900/650. On the DEPLOYED site: buttons, inputs and dropdowns look the same font as the text beside them; Chinese company names sit in one font; SOA aging numbers and invoice numbers still line up.
**Guards:** `docs/INVARIANTS.md` INV-UI-001.

## REG-052 — Typography: size scale
**Trigger:** any change that adds `fontSize`/`font-size`/`fontWeight` in app/ or components/.
**Run:** `npx tsx test-typography-scale.ts` (`ALL OK`). On the DEPLOYED site, look at the densest screens (Billing list + expanded row, SOA, Master List, Assistant chat, Quotation): no column wraps or overflows that did not before; small badges (9px) still readable.
**Guards:** `docs/INVARIANTS.md` INV-UI-002.

## REG-053 — SOA manual PIC dropdown
**Trigger:** any change to `lib/soa-main-pic.ts`, `applyPicOverrides` in `lib/soa-data.ts`, the PIC cell or `PATCH /api/billing/soa` (picOverride).
**Run:** `npx tsx test-soa-main-pic.ts`, `test-soa-pic-column.ts`, `test-soa-person-book.ts` (`ALL OK`). After `scripts/add-soa-pic-overrides.sql` is run, on the DEPLOYED site: (1) Outstanding › TAB: Inventa Projects' PIC cell is a dropdown showing Chin Kah Ye; (2) pick another person: the cell shows them in navy bold, reload keeps it, the people filter and My Tasks follow the new person; (3) "Back to QuickBooks PIC" restores Chin Kah Ye; (4) the same company in TAO/TAC is unaffected.
**Guards:** `docs/INVARIANTS.md` INV-PIC-012.

## REG-054 — Invoice Original/Latest card + monthly originals export
**Trigger:** any change to `lib/invoice-versions.ts`, `lib/invoice-pdf-lookup.ts`, `find_invoice_pdf` / `InvoicePdfCard`, `lib/originals-export.ts`, `/api/billing/invoice-original`, `/api/billing/originals-export` or the export page.
**Run:** `npx tsx test-originals-export.ts`, `test-account-access.ts`, `test-assistant-pages.ts` (`ALL OK`). On the DEPLOYED site, signed in: (1) My Tasks assistant: "give me invoice 02610167" → a card; the split TAB invoice shows 原装 Original + 最新 Latest, both download a PDF (Original = the attached file); an unsplit invoice shows one Download; (2) as Vincent/Chelsea open /billing/soa/originals-export, pick last month: three cards with counts; Download TAB ZIP shows progress then downloads a ZIP with PDFs + manifest.csv (+ MISSING.csv); a colleague without access gets a 403 message; (3) after `scripts/add-originals-exports.sql`, the card shows "Exported …" and the My Tasks reminder lists only the books still to do.
**Guards:** `docs/INVARIANTS.md` INV-QB-040, INV-QB-037.

## REG-055 — AR Reminder: a returning FYE brings its own hidden row back
**Trigger:** any change to `lib/ar-fye-restore.ts`, the catch-up pass in `app/api/ar-reminder/generate/route.ts`, or the FYE-correction backfill in `app/api/ar-reminder/sync-workflow/route.ts`.
**Run:** `npx tsx test-ar-fye-restore.ts` (`ALL OK`). Read-only dry run against production: `restoreFyeExcludedRows(supabase, slots, newRestoreBudget(), { apply: false })` — for the BEAUTY ASSET slot it must answer "restore #714 → Pending" and for a person's exclusion "hidden-by-someone-else". After the next AR generate (cron 19:00 UTC = 03:00 SGT; the FYE correction runs at 20:00 UTC): BEAUTY ASSET appears in AR Reminder under September 2026 (due 30 Apr 2027); `automation_sync_runs.summary` shows `catchUpRestored: 1` and `catchUpInserted` equal to the rows really inserted; no `catch_up_blocked_by_excluded` exception unless a person excluded a row.
**Guards:** `docs/INVARIANTS.md` INV-AR-019, INV-AR-020, INV-AR-001, INV-AR-002, INV-AR-003.

## REG-056 — AR Reminder coverage (the independent outcome check)
**Trigger:** any change to AR row creation / hiding (generate, sync-workflow, late-filing sync, the AR page Add / Trash), to Master List's next_agm_due_date derivation, or to `lib/ar-coverage.ts`; and EVERY MONTH before that month's reminders go out (Chelsea reviews the list).
**Run:** `npx tsx test-ar-coverage.ts` (`ALL OK`), then `NODE_PATH=<stub of server-only> npx tsx scripts/ar-coverage-report.ts --csv <file>` (read-only). Expect MISSING 0; review every WRONG_MONTH, DUPLICATE, LABEL_MISMATCH, STALE_OPEN, DATE_INCONSISTENT and STALE_MASTER row in TeamWork / BizFile+; the "not evaluated" count (companies without a unique Master List row) should not grow.
**Guards:** `docs/INVARIANTS.md` INV-AR-020, INV-AR-019, INV-AR-017.

## REG-057 — AR Reminder: the FYE month AR runs on, and the nightly state-based plan
**Trigger:** any change to `lib/ar-fye-resolve.ts`, `lib/ar-fye-manual.ts`, `lib/ar-cycle-plan.ts`, `lib/ar-plan-apply.ts`, `lib/ar-fye-reanchor.ts`; the FYE derivation / plan blocks and `AR_PLAN_APPLY` in `app/api/ar-reminder/sync-workflow/route.ts`; the effective-month view in `app/api/ar-reminder/generate/route.ts`; the `fye` branch of `app/api/master-list/route.ts` (PATCH and GET); or `parseTwCycles` / TeamWork's AGM list format.
**Run:** `npx tsx test-ar-fye-resolve.ts`, `test-ar-cycle-plan.ts`, `test-ar-plan-apply.ts`, `test-company-lifecycle.ts` (`ALL OK`). Read-only against live TeamWork + production: `NODE_PATH=<stub of server-only> npx tsx scripts/ar-plan-dryrun.ts "BEAUTY ASSET" "MAPLE GROVE"` (BEAUTY: restore #714, hide #867; MAPLE GROVE: hide #866) and `--all` (the numbers tonight's run would record). After a nightly run, `automation_sync_runs.summary` of `ar_workflow`: `ar_plan.mode`, `restored` / `inserted` / `hidden` / `blocked` / `failed`, `exceeds_limit` false, `fye_slip_cycles`, `fye_master_list_differs`, `teamwork_bad_date_cells`; in shadow mode the AR page must be unchanged. After flipping `AR_PLAN_APPLY`: BEAUTY ASSET shows September 2026 and no October ghost, and the next night's `ar_plan` shows 0 wanted / 0 hide. On the DEPLOYED site, Master List › Active Client: change one test company's FYE to another month — within seconds AR Reminder shows its pending row under the new month (the old one gone, restorable from the trash list); change it back — the old row returns; the FYE mismatch badge's tooltip says which month AR follows; clear the cell — AR follows TeamWork again.
**Late Filing part (trigger: `app/api/late-filing/route.ts`'s `nextAgmDue` / `getLateFilingList`, or the mirror in `app/api/late-filing/sync/route.ts`):** `npx tsx test-ar-fye-resolve.ts` (`ALL OK`), then read-only `NODE_PATH=<stub of server-only> npx tsx scripts/late-filing-impact.ts` — today it must show 0 newly shown; on the Late Filing page a company's "Next AGM Due" is FYE + 6 months (BEAUTY-style: 30 Sep FYE → 30 Mar) and an AR Reminder row mirrored by the sync carries the cycle's own FYE month and exact date (never the company's latest month).
**Guards:** `docs/INVARIANTS.md` INV-AR-021, INV-AR-019, INV-AR-020, INV-AR-017, INV-TW-006 (superseded).
