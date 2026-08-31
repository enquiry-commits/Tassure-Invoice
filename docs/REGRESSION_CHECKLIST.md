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
1000.
**Guards:** INV-DATA-006.

### REG-012 — Chinese name entry
Type a Chinese company name or PIC name into any inline-edit table cell.
Confirm a mid-composition Enter (used by the IME to confirm a candidate)
does not prematurely commit/close the cell before the full name lands.
**Guards:** INV-DATA-010.

---

## Automation priority

Automate a check here only when it is frequent, historically buggy, cheap
to verify programmatically, and either business-critical or expensive to
keep checking by hand — not for completeness. REG-008 (automation-run
status) is the strongest automation candidate of the twelve, since it's
already a structured DB query rather than a real UI/data walkthrough; the
rest are deliberately manual for now.
