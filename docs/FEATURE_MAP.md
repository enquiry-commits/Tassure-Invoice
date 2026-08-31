# Feature Map

Critical workflows, where their code/data actually live, and what a change
to them can ripple into. Built for impact analysis before a change — "if I
touch this, what else might break?" — not as full API documentation. Verify
against current code before trusting a specific file path; this can drift.

---

## Core features

| Feature | UI entry | Main logic | Data | External dependency | Critical? |
|---|---|---|---|---|---|
| AR Reminder (cycle tracking & reminders) | `app/billing/page.tsx` (AR tab), `app/ar-reminder/page.tsx` | `app/api/ar-reminder/{generate,sync-workflow,search,latest,history,export}` | `ar_reminder` | TeamWork (AGM/AR event scrape via `lib/teamwork-agm.ts`) | Yes — drives client reminders and billing eligibility |
| EOT (Extension of Time) | `app/master-list/eot/page.tsx`, `components/EotTable.tsx` | `app/api/ar-reminder/eot` (read); detection lives inside `late-filing/sync`'s own loop | `ar_reminder` (`ar_/agm_original_due_date`, `ar_/agm_revised_due_date` columns) | TeamWork (struck-through due-date HTML, `parseLatestDmy`) | Yes — wrong parsing here directly causes false OVERDUE flags |
| Late Filing detection | `app/late-filing/page.tsx` | `app/api/late-filing/sync` | `late_filing_companies`, mirrors into `ar_reminder` | TeamWork | Yes |
| Master List (Active Client, Ad-hoc, MAS, Name Change, Strike Off, Terminated, Trademark) | `app/master-list/*` | `app/api/master-list`, `app/api/master-list/move` | `master_list`, `companies` | TeamWork company sync (`app/api/teamwork/sync`) | Yes — visibility for compliance/billing status across the whole client base |
| Nominee Directors (ND) | `app/nominee-directors/page.tsx` | `app/api/nominee-directors`, `app/api/nominee-directors/subrole-remark`, scrape via `app/api/teamwork/sync-nd` (4-batch daily cron) | `nominee_directors`, `nd_appointments`, `automation_exceptions` (`missing_nominee_subrole`) | TeamWork scrape (Playwright, `lib/teamwork-nd.ts`) | Yes |
| Companies / Active Client roster | `app/companies/page.tsx` | `app/api/companies`, `.../parent`, `.../service-override` | `companies` | TeamWork sync (`app/api/teamwork/sync`, `lib/teamwork-company-profile.ts`) | Yes — source of truth PIC/active-status/UEN most other features join against |
| Company 360 (per-company aggregate view) | `app/companies/[id]/page.tsx` | `lib/company-360.ts` (`getCompany360`, shared by the page and `app/api/companies/[id]/route.ts`) | Reads across `companies`, `master_list`, `ar_reminder`, `generated_invoices`, `quickbooks_invoices`, `nd_appointments`, `email_drafts`, `post_incorporate_operations`, `trademark_records` — see this file's own module comment for which links are real FKs vs. fuzzy `company_name` matches | none beyond the DB itself | Medium — a read-only aggregate view; a wrong fuzzy match shows a `matchScore`/`matchedVia` flag rather than failing silently |
| My Tasks (per-staff task aggregation) | `app/my-tasks/page.tsx` | `app/api/my-tasks` | `ar_reminder`, `late_filing_companies` (via `mirrored_ar_reminder_id`) | none beyond the DB itself | Yes for the 6 AR-Reminder-restricted accounts, whose only other page is AR Reminder itself — a bug here is their primary way to know what's overdue |
| Billing & QuickBooks invoicing | `app/billing/page.tsx` | `app/api/billing/*`, `app/api/quickbooks/*` | `generated_invoices`, `invoice_creation_reservations`, QuickBooks Online (TAB + TAC company files) | QuickBooks Online API | Yes — real money, real invoices |
| Client Communications | `app/client-communications/{campaigns,templates,drafts,history}` | `app/api/client-communications/*` | `email_drafts` + campaign tables | TeamWork (recipient/contact sync, `lib/teamwork-recipients.ts` + `lib/teamwork-contact-report.ts`); Draft Helper (separate desktop app, `lib/draft-helper-client.ts`) for the real Outlook send | Yes — real outbound client email |
| Post Incorporate document generation | `app/post-incorporate/page.tsx` | `app/api/post-incorporate/{generate,enrich,parse-bizfile}` | `post_incorporate_operations` | Bizfile PDF parsing (`lib/bizfile-parse.ts`) | Medium — only 1 of 13 planned document types is live (see `docs/CURRENT_STATE.md`) |
| Trademark tracking | `app/master-list/trademark/*`, `components/TrademarkTable.tsx` | `app/api/trademark` | `master_list` (trademark rows) | — | Medium |
| Automation Health dashboard | `app/page.tsx` (home) | `app/api/automation/health` | `automation_sync_runs`, `automation_exceptions` | — (reads the other crons' own audit trail) | Yes — the early-warning system for every other automation in this table; if this breaks, every other row's failures go silent |
| Assistant (AI chat widget) | `components/AssistantWidget.tsx` | `app/api/assistant` | reads across most tables above | Anthropic API | Medium |

---

## High-risk shared logic

A bug in any of these fans out across many features at once — treat a
change here with the widest blast-radius assumption, not the narrowest.

| Module | Used by | Risk if broken |
|---|---|---|
| `lib/teamwork-agm.ts` (`parseLatestDmy`, event scraping) | AR Reminder generate/sync-workflow, Late Filing sync, EOT | Wrong due dates / wrong "is this cycle still open" across the whole client base |
| `lib/teamwork-pic.ts` (`resolveTeamworkPic`) | AR Reminder, Master List, Active Client, Billing | Companies show raw TeamWork ids instead of staff names, or a co-assigned company loses one PIC |
| `lib/automation-sync.ts` (`withAutomationRun`, `AutomationRun`, `replaceAutomationExceptions`) | Every cron route (all rows in the Core Features table with a "TeamWork"/QuickBooks external dependency) | A bug here can silently break the Automation Health dashboard for *everything at once*, or wrongly auto-resolve/never-resolve exceptions |
| `lib/campaign-recipients.ts` | Every outbound email flow (Client Communications, Draft Helper hand-off) | Wrong To/CC on a real client email — see `docs/INVARIANTS.md` INV-MAIL-* |
| `lib/company-name.ts` (`normalize`, `matchScore`, `findUniqueBestMatch`) | Fuzzy company-name matching wherever a TeamWork `company_name` string must match a `companies` row (ND page, Master List reconciliation, Company 360's fuzzy sections, others) | A change here can shift which rows match across many features simultaneously, not just one |
| `lib/staff-directory.ts` (`findStaffEmails`) | Client communication CC resolution (`lib/client-comms-resolve.ts`) AND, since 2026-08-31, My Tasks' entire "is this row mine" logic (`app/api/my-tasks/route.ts`) | Previously only miscounted a CC list; now a bug here also means a staff member sees someone else's tasks, or misses their own (see the real Samuell Ng email-mismatch bug this exact risk produced, `docs/INVARIANTS.md`) |
| `lib/docx-xml.ts` (OOXML engine) | Every document-generation workflow (Post Incorporate now; the 12 planned future ones will all depend on this too) | A bug here breaks document generation project-wide, not per-workflow — has its own 46-check regression suite (`test-docx-xml.ts`), run it before changing this file |
| `lib/quickbooks.ts`, `lib/qb-invoice-conventions.ts` | Billing, TAB/TAC dual-company logic, invoice PDF/create/update routes | Wrong invoice amounts, wrong DocNumbers, or writes that don't match what QuickBooks itself shows — real financial risk |
| `lib/playwright-tmp-cleanup.ts` | Every Playwright-browser-launching route (`lib/teamwork-agm.ts`, `lib/teamwork-nd.ts`) | Missing this on a new browser-launching route silently contributes to Vercel `/tmp` exhaustion for *every* route sharing that pool — see `docs/INVARIANTS.md` INV-CRON-004 |

---

## Cron / automation dependency map

What actually runs daily and what depends on what completing first. See
`vercel.json` for the authoritative schedule (verify there — see
`docs/INVARIANTS.md` INV-CRON-010, this table can drift from it).

```text
12:00–18:00  teamwork/sync-nd  (4 batches: teamwork_nd_1..4)
18:30        teamwork/sync              → refreshes companies, PIC, campaign recipients, contact persons
18:45,22:45,02:45  teamwork/sync-secretary
19:00        ar-reminder/generate        → depends on companies being current (runs after 18:30 sync)
19:30        quickbooks/sync
20:00        ar-reminder/sync-workflow   → depends on ar_reminder rows existing (runs after 19:00 generate)
21:00        late-filing/sync            → depends on ar_reminder + sync-workflow's date corrections (runs after 20:00)
```

The 19:00 → 20:00 → 21:00 ordering is load-bearing, not incidental — each
step reads data the previous step is expected to have already refreshed
that day. Moving one of these times without checking this chain risks a
step reading yesterday's data.
