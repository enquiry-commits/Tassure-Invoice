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

All 10 daily cron sources landed green on their most recent run as of this
writing (checked directly against `automation_sync_runs`, not assumed):

| Source | Schedule (UTC) | Last run status |
|---|---|---|
| `teamwork_nd_1..4` | 12:00 / 14:00 / 16:00 / 18:00 | success (all 4) |
| `teamwork_companies` | 18:30 | success |
| `teamwork_secretary` | 18:45 / 22:45 / 02:45 | success |
| `ar_generate` | 19:00 | success |
| `ar_workflow` | 20:00 | success |
| `late_filing` | 21:00 | success |
| `quickbooks` | 19:30 | success |

Open `automation_exceptions`: **3**, all `teamwork_nd` /
`missing_nominee_subrole` — a real TeamWork data-content gap staff should
review (visible on the Nominee Directors page's "TeamWork Review" panel),
not an automation failure. Zero exceptions on any other source.

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

None open as of this writing. Company 360 / My Tasks are freshly shipped
(2026-08-31) and haven't had a real post-deploy login check yet — see
Pending Improvements, not listed as an issue since nothing is known wrong,
just not yet confirmed right.

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
- **Two separate QuickBooks company files** — TAB (default/basic services)
  and TAC (专开 ND) — always confirm which one a change or query is meant
  to touch; see `lib/qb-invoice-conventions.ts`.
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
- `C:\Users\vincent\.claude\plans\atomic-wandering-locket.md` currently
  holds the Company 360 / My Tasks plan (2026-08-31) — it gets overwritten
  by whatever real feature is planned next; it is not a permanent record,
  `PROJECT_STATUS.md` is.
