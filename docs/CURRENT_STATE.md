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
- Billing / QuickBooks invoice generation (TAB + TAC dual company files) —
  plus ACC's own TAO Accounts/Tax billing (`/billing/tao`, shipped
  2026-09-05) and SOA collections (shipped 2026-09-06, split into 3
  company-scoped pages 2026-09-07 — `/billing/soa/tab`, `/billing/soa/tac`,
  `/billing/soa/tao`, each its own SOA sidebar entry with data scoped to
  just that QuickBooks system, aged the same way as QuickBooks' own AR
  Aging report, with real PDF-merge automation for the statement Chelsea
  previously built by hand; `/billing/soa` itself still redirects to the
  TAB book for any old bookmark/link — unchanged by the entry below). Plus
  a 4th "All" sidebar entry (`/billing/soa/all`, same day) showing every
  TAB+TAC+TAO row TOGETHER, un-deduplicated — a company owing on 2+
  systems shows as 2+ separate rows (each tagged with a Source column),
  not merged into one. Owner edits made from "All" write through
  `rowCompany()` to the exact same `soa_owners` row (customer name + that
  row's own qb_company) the single-system pages read — same data, not a
  copy, so it's immediately consistent both ways (`lib/soa-data.ts`'s
  `computeAllSoaRows()`, `app/api/billing/soa/all/route.ts`). The Owner column's default is
  now computed automatically from each company's own real QuickBooks
  Class/Location data (`lib/soa-owner.ts`, see INV-QB-013) instead of
  needing a manual Google Sheet backfill — a human pick in `soa_owners`
  still overrides it when set. Verified end-to-end against real data
  2026-09-07 after the SQL migration + a full production sync: TAB
  94.6%, TAC 81.4%, TAO 98.5% of companies with an outstanding balance
  now get a real computed owner with zero manual input.
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

All 4 of the AI-feature migrations shipped 2026-09-08 (`user_activity_
events`, `ai_conversations`/`ai_messages`, `user_memories`) have now been
run by Vincent and confirmed live with a real write+read round trip on
each (not just "table exists") — Activity Insights, My Tasks' chat
persistence/pinning, and the assistant's `remember_this` tool are all
genuinely functional now, not just deployed. Real accumulated behavioral
data (Activity Insights' own "top pages/actions" becoming meaningfully
populated) still needs real usage over time — that's expected, not a bug.

**Management (`canViewAsOthers`: Vincent, Cindy Zhang, Samuell Ng, Tan Yee
Soon) can now use the My Tasks chat to ask about or fully act as ANOTHER
staff member**, added 2026-09-08 — two complementary mechanisms, both
gated on the existing `canViewAsOthers` flag (no new permission
introduced):
- **Ask about someone else while staying yourself** — "如果我是HC，我要做
  什么今天？" (or any phrasing naming a staff member) resolves the person
  via `findMentionedAccount()` (`lib/approved-accounts.ts`, built on
  `lib/staff-directory.ts`'s existing name/alias table) and answers with
  THEIR task digest, saved in the ASKER's own conversation. A non-
  privileged account asking about someone else gets an explicit refusal,
  never the caller's own data mislabeled or someone else's data leaked
  silently. Works in both engines (Claude tool-use and the no-key
  `intentAnswer()` fallback that's the only one actually live in
  production today — see below).
- **Full "View As" identity substitution** — the My Tasks page's existing
  View As picker (previously Tasks-tab only) now also drives the chat
  sidebar/thread/composer: a privileged account can select a target and
  genuinely operate AS them — new conversations are created under the
  TARGET's own email and become part of their real `ai_conversations`
  history, not a copy or a read-only preview (`resolveViewAsAccount()` in
  the same file, wired through `/api/ai/conversations`, `[id]`,
  `[id]/messages`, and `/api/assistant`'s POST). A persistent banner
  states whose account is active whenever this is in effect.

Both are `tsc`-clean and logic-verified via a standalone diagnostic script
(12/12 cases, including Vincent's exact screenshotted phrase) — **not yet
exercised by a real browser login** (same "code-complete, not yet
click-through-verified" caveat as Company 360/My Tasks' own original ship
below).

Vincent has also named the real long-term direction this is heading:
agentic action-taking through chat (e.g. "开A 公司的TAB INVOICE" → the
assistant confirms FYE/details conversationally → creates the QuickBooks
invoice itself). Explicitly a FUTURE step, not started — see Pending
Improvements.

**My Tasks gained a real "what has this person actually done" activity
timeline** (`lib/recent-activity.ts`, same day), after Vincent caught the
View-As-Chelsea screen showing 0 tasks despite her real, heavy daily use
and pushed back: "没有真正了解到这个系统在干嘛，我们的员工在做什么". A
direct Supabase check (not a guess) found her real footprint — 89
generated invoices, 41 real AR Reminder edits, 95 email campaigns — none
of it visible to My Tasks, because Billing Drafts and Email Campaigns have
no per-person "queue," only an audit trail of who did what. The new
"Activity" sidebar tab (My Tasks) and the assistant's `recent_activity_
summary` tool read across every such pre-existing `created_by_email`/
`updated_by_email`/`sent_by_email` column in the system (invoices, AR
edits, campaigns, Master List, sent emails, Post Incorporate, Trademark,
SOA owners) — no new table. Confirmed this generalizes across roles, not
just Chelsea's own pattern: Corporate Secretarial staff (Lim Hoe Chyi, Ang
Shi Ming, Chin Kah Ye) show mostly AR Reminder + Master List edits, not
invoicing. This needed NO Anthropic API key — it's plain SQL aggregation,
same as Activity Insights' own top-pages/actions; only turning it into an
interpreted narrative (vs. a raw list) would benefit from real Claude
reasoning once a key is set.

**Vincent independently re-derived the same root cause from his own
research** (2026-09-08, same day): he tried an open-ended phrasing
("根据chelsea 最近做的东西，你判断接下来应该会做什么") that no regex
could ever generalize to, then shared a doc reaching the same conclusion
already stated below — system prompt (business/SOP context) + tool use
(real-time data) + memory (RAG-lite) is exactly what `claudeAnswer()`
already is, it's just never running. Used the doc's prompt-caching note as
a real improvement made regardless: `app/api/assistant/route.ts`'s system
prompt is now split into `staticSystemPrompt()` (cached, identical per
user) and `dynamicSystemPrompt()` (current user/location/memories, sent
fresh) — the previous single-string version interleaved dynamic content in
the middle, which would have defeated a cache-prefix match almost every
call. Zero effect until the key is set, but correct groundwork rather than
something to redo later.

**`ANTHROPIC_API_KEY` has never been set in Vercel production** (confirmed
directly via the Vercel API's env list, 2026-09-08 — the key is simply
absent from the project's environment variables). Every AI-assistant
feature shipped this session (`app/api/assistant`'s Claude tool-use
engine, `my_tasks_summary`/`my_activity_pattern`/`remember_this` tools,
`lib/my-tasks-brief.ts`'s Claude-phrased daily briefing) is CODE-COMPLETE
and degrades correctly to its own rule-based/keyword-matching fallback —
nothing is broken — but production has only ever run that fallback, never
real Claude reasoning. This is very likely the real substance behind
Vincent's "现在的回答还是很基础的AI模型，都是固定嵌套式的回答" feedback —
the fallback IS exactly that, by design. Setting the key in Vercel is the
one remaining step to actually turn this on, and it's not something
Claude Code can do — it needs a real Anthropic API key, which only
Vincent can provide.

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

- **Agentic action-taking through the assistant chat** (e.g. "开A 公司的
  TAB INVOICE" → assistant confirms FYE month + intent conversationally →
  creates the QuickBooks invoice itself) — Vincent, 2026-09-08, named as
  the real long-term direction: "我后续要做的是除了回答问题，甚至是可以协
  助操作...员工全程只是一句话和回答你提出的确认问题，最终的操作，你协助
  完成，这个是我要做的大方向，目前你先把内容都完善". Explicitly NOT
  started — this is real billing/QuickBooks automation triggered by chat
  and needs its own careful design pass (confirmation-loop UX, which
  actions are safe to automate first, audit trail) when Vincent is ready
  to actually scope it, matching the shared blueprint's own v1 guidance
  (Read+Recommend+Draft only, no auto-actions yet).
- **A real "still-outstanding" queue for Billing Drafts / Email Campaigns**
  (not just the "recent activity" display shipped 2026-09-08) — Vincent,
  when asked to choose between the two: "两个都要，先做展示版" (want both,
  display version first). This second half needs genuinely NEW business
  rules (e.g. "which companies are overdue for invoicing, and whose job is
  it") that don't exist anywhere in the system today — unlike the display
  version, this can't be built from existing audit-trail columns alone and
  needs a real design discussion with Vincent before starting.
- Verify the new View-As-for-chat identity substitution (2026-09-08) with
  a real login click-through: a privileged account selects a target,
  starts a New Chat, sends a message, and the row is confirmed to land
  under the TARGET's own email in `ai_conversations`/`ai_messages` — see
  the dated entry above, logic-verified only so far.
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
