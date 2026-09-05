# Current State

A snapshot of **what's true right now** — not a history. `PROJECT_STATUS.md`
(repo root) is the permanent, append-only, never-rewritten log of every
change ever made; this file is the opposite — it should be *rewritten* as
reality changes, and only describes the present. When something here goes
stale, fix this file directly rather than appending to it. For the full
story behind any one-line claim below, search `PROJECT_STATUS.md`'s dated
entries.

Last verified against real production data: **2026-08-31**.

---

## Automation health

**Schedule as of 2026-08-31** (re-spaced the same day — see
`docs/INVARIANTS.md` INV-CRON-013 and `PROJECT_STATUS.md`'s 2026-08-31
entry: `teamwork_companies`, `teamwork_secretary`'s first run, and ND batch
4 had drifted into sharing hour 18, causing a real, confirmed collision):

| Source | Schedule (UTC) | Status as of last check |
|---|---|---|
| `teamwork_nd_1..5` | 12:00 / 14:00 / 16:00 / 17:00 / 18:00 | `teamwork_nd_1` failed 08-31 (TeamWork API timeouts, 4-person batch — fixed same day by rebalancing to 5 batches, not yet re-verified over real days) |
| `teamwork_companies` | 13:00 (was 18:30) | failed 08-31 (the confirmed collision — see INV-CRON-013); schedule fix + retry safety net shipped same day, not yet re-verified over real days |
| `teamwork_secretary` | 15:00 / 22:45 / 02:45 (1st was 18:45) | now surfaced on the Automation Health dashboard for the first time (was a real blind spot — see INV-CRON-013) |
| `ar_generate` | 19:00 | success as of last check |
| `ar_workflow` | 20:00 | success as of last check |
| `late_filing` | 21:00 | success as of last check |
| `quickbooks` | 19:30 | success as of last check |

**Do not treat the fix above as "considered fixed" from this table alone**
— this exact class of problem was declared fixed once already (2026-08-29)
and recurred 2 days later via a different mechanism. Real confirmation
needs 5-7 consecutive clean days checked directly against
`automation_sync_runs` for wall-clock overlap between any pair of
Playwright-launching sources, not just `status`/`error` text (a run can
succeed while still having overlapped another — confirmed this is exactly
what happened to `teamwork_secretary` on 08-31). Update this section once
that window has actually been observed.

Open `automation_exceptions`: **3** as of the last full check, all
`teamwork_nd` / `missing_nominee_subrole` — a real TeamWork data-content gap
staff should review (visible on the Nominee Directors page's "TeamWork
Review" panel), not an automation failure. Re-check this count too, it may
have drifted.

If this table looks stale, re-check directly:
`GET automation_sync_runs?order=started_at.desc&limit=30` and
`GET automation_exceptions?status=eq.open` against Supabase, or open the
Automation Health dashboard (`app/page.tsx`) itself.

## Known-good core workflows

Stable, in daily real use, verified against real data as of their last
change (see `docs/FEATURE_MAP.md` for the full breakdown):

- AR Reminder generation, cycle tracking, and reminders
- Late Filing detection (incl. Extension-of-Time / EOT auto-detection)
- Master List (Active Clients, Ad-hoc, MAS, Name Change, Strike Off,
  Terminated, Trademark)
- Nominee Directors tracking (appointments + subrole review)
- Billing / QuickBooks invoice generation (TAB + TAC dual company files)
- Client Communications (campaigns, templates, drafts, send history) +
  Draft Helper (separate desktop app) for the real Outlook send
- Post Incorporate document generation (1 of 13 planned document types —
  see Pending Improvements)
- Company 360 (`/companies/[id]`) and My Tasks (`/my-tasks`) — shipped
  2026-08-31, `npx tsc --noEmit`/`npm run build` clean; not yet exercised
  against real production data by a real login (see Pending Improvements).

## Active issues

None currently known-broken as of this writing, but the TeamWork
automation collision (see Automation health above) is a real, recent
recurrence of a previously-"fixed" problem — treat its fix as
**unconfirmed until 5-7 real clean days are observed**, not resolved. See
`docs/INVARIANTS.md` INV-CRON-013.

Company 360 / My Tasks are freshly shipped (2026-08-31) and haven't had a
real post-deploy login check yet — see Pending Improvements, not listed as
an issue since nothing is known wrong, just not yet confirmed right.

## Known risks (not bugs — things worth remembering before relying on data)

- **Billing draft auto-fill accuracy varies by field** — Secretary ~85%
  and Address ~95% reliably auto-fillable; XBRL and ND status change too
  often to trust without a human check before invoicing. Re-run
  `scripts/validate-billing-accuracy.js` if this needs re-confirming.
- **No automated CI/test suite** — `package.json` has no `test` script.
  Verification for every change in this project has always been "trigger
  the real route against real data, check the real result." This is a
  deliberate, working pattern given the project's actual scale (solo
  operator, no dedicated QA), not a gap to silently "fix" by bolting on a
  test framework — see `PROJECT_STATUS.md`'s 2026-08-31 entry for why the
  full "Stability Foundation" governance package was not adopted wholesale.
- **Three separate QuickBooks company files** — TAB (default/basic
  services, billed by Chelsea via Billing Drafts), TAC (专开 ND), and TAO
  (专开 Accounts/Tax, billed independently by ACC). As of 2026-09-05 ACC can
  generate real TAO invoices through their own page, `/billing/tao`
  (`app/billing/tao/page.tsx` + `app/api/billing/tao/route.ts`) — a manual
  line-item builder, not a due-date-driven draft list like Billing Drafts,
  since Accounts/Tax services have no renewal-cycle tracking anywhere in this
  system and real invoice amounts are individually negotiated per client.
  DocNumber series digit is "6" (confirmed against ACC's own pre-existing
  manual QuickBooks numbering); TAO invoices carry no PIC/Class, same as TAC.
  `invoice_creation_reservations`'s CHECK constraint was widened to allow TAO
  (`scripts/add-tao-invoice-reservations-support.sql` — run this in the
  Supabase SQL editor before this feature works end-to-end).
  **Still explicitly deferred** (see `PROJECT_STATUS.md`'s 2026-09-05 entry):
  the "flag for Chelsea" mechanism, where ACC marks a payment-risk client so
  its Accounts billing routes through TAB/Chelsea instead of TAO — today
  `app/api/billing/renewals/route.ts`'s TAB-Accounts carry-forward keeps
  firing unconditionally for every client, independent of the new TAO page
  (confirmed via real data on 2026-09-05: the two don't currently produce
  genuine double-billing — they cover different scopes of work — so this is
  safe to leave unconditional for now, not yet a bug). Always confirm which
  company a change or query is meant to touch; see
  `lib/qb-invoice-conventions.ts`.
- **`docs/INVARIANTS.md` is a snapshot, not enforced by tests** — reading
  it before touching a risky area is a discipline, not a safety net a
  linter or CI gate would catch you missing.

## Pending improvements (known, not yet scheduled)

- Port the remaining 12 of 13 desktop-tool document-generation workflows
  (Pre Incorporate, Share Transfer, AGM, Strike Off, Change Business
  Activity/Registered Address/Secretary/Director, Update Particulars,
  Increase Share Capital, Update Paid Up Capital, RORC/RONS/ROND/DPO
  standalone) — only Post Incorporate is live so far. This note is based
  on an older record; confirm the current count with Vincent before
  treating it as exact.
- Have a real staff member (ideally one of the 6 AR-Reminder-restricted
  accounts, and separately Samuell Ng specifically) actually log in and
  use Company 360 / My Tasks post-deploy — this can't be confirmed by
  reading code (auth flow, real PIC data, real restricted-account routing)
  and hasn't happened yet as of this writing.
- Monitor real `automation_sync_runs` for the TeamWork collision fix
  (INV-CRON-013) over the next 5-7 days — check wall-clock overlap between
  every Playwright-launching source, not just status/error text — before
  treating it as actually confirmed, per the bar set in Automation health
  above.
- `C:\Users\vincent\.claude\plans\atomic-wandering-locket.md` currently
  holds the TeamWork automation collision fix plan (2026-08-31, same day it
  was written over the earlier Company 360 / My Tasks plan) — it gets
  overwritten by whatever real feature/fix is planned next; it is not a
  permanent record, `PROJECT_STATUS.md` is.
