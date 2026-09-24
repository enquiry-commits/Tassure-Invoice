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
Check `automation_sync_runs` for the prior 24h. Confirm every expected
source in `docs/FEATURE_MAP.md`'s cron table shows `status: success` with
no stale/missing entries, and cross-check `docs/CURRENT_STATE.md`'s
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
Open Company 360 (`/companies/[id]`) for a company with multiple AR/AGM
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
Log in as one of the 6 AR-Reminder-restricted accounts — confirm
`/my-tasks` is reachable, the sidebar shows exactly two items, the
response's `lateFiling` is `null` (not empty), and `/companies/[id]`
stays unreachable (redirects to `/billing?tab=ar`, unchanged).
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
account only had `admin: true` at the time).
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
one as authoritative.
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
no "YES", blank or hand-typed status: the only values left are "Terminate",
"Terminated", and rows TeamWork itself reports as something else (2026-09-24: 7
"Active", 2 "Striking Off"; fix those in TeamWork, do not force them here).
(3) A row whose Status was typed by hand (manual lock) must keep what was typed
through a sync. (4) `audit_log` shows the old value for every rewritten row,
`changed_by = 'system:terminated-list-default'`.
**Guards:** `docs/INVARIANTS.md` INV-DATA-064, INV-DATA-067.

---

## Automation priority

Automate a check here only when it is frequent, historically buggy, cheap
to verify programmatically, and either business-critical or expensive to
keep checking by hand — not for completeness. REG-008 (automation-run
status) is the strongest automation candidate of the twelve, since it's
already a structured DB query rather than a real UI/data walkthrough; the
rest are deliberately manual for now.
