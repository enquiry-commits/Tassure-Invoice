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

**Step 1 of the agentic-invoicing direction has now shipped**: a
READ-ONLY `preview_invoice_draft` chat tool (`lib/billing-lookup.ts` +
`lib/billing-draft.ts`, both new) shows exactly what a Billing Drafts
invoice would contain for one company — real pre-fill rules, ported
verbatim from `app/billing/page.tsx`'s own `initialLines`, verified
against real data. It cannot create anything in QuickBooks; there is no
write path in this tool at all. Gated by the same `isWithinRestriction()`
check the Billing Drafts page itself uses, so the 6 AR-Reminder-restricted
accounts can't get billing data through chat that the page itself blocks
them from. **Step 2 (the real confirm-and-execute card + popup) shipped
2026-09-09** — see Pending Improvements for its own not-yet-tested
caveat and known follow-up gaps.

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

**`ANTHROPIC_API_KEY` was set in Vercel production 2026-09-08** (Vincent
provided a real key to experiment with — "先实验一下免费的API效果"). Added
via the Vercel API as a `sensitive`-type env var (write-only — its value
can never be read back via the API or dashboard once created), Production
target only, then a redeploy to pick it up (env var changes need a fresh
deployment on Vercel — an already-running deployment doesn't hot-reload
new env vars). Every AI-assistant feature shipped this session
(`app/api/assistant`'s Claude tool-use engine, `my_tasks_summary`/
`my_activity_pattern`/`recent_activity_summary`/`remember_this` tools,
`lib/my-tasks-brief.ts`'s Claude-phrased daily briefing) is CODE-COMPLETE
and was already degrading correctly to its own rule-based/keyword fallback
with no key — now it should run real Claude reasoning instead. **Not yet
confirmed by an actual live chat exchange** — verify by asking the My
Tasks chat something no regex could match (e.g. Vincent's own test:
"根据chelsea 最近做的东西，你判断接下来应该会做什么") and checking the
reply is a real reasoned answer, not the old capability-list fallback. If
the key runs out of credit or hits a spend limit later, `POST /api/
assistant` degrades automatically back to `intentAnswer()` with no error
surfaced to the user (confirmed by reading the route's own try/catch — see
`docs/PROJECT_STATUS.md`'s 2026-09-08 entry) — this is not something to
treat as broken if it happens.

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

- **Floating AssistantWidget rebuilt as a draggable/resizable/collapsible
  popup, shipped 2026-09-09** — full functional parity with My Tasks chat
  (same cards, same attachments, now shared via `components/assistant/
  ChatCards.tsx`), plus a real conversation lifecycle (open = conceptually
  a new conversation; navigate away without closing = same conversation
  keeps going; manually close = ends it, already saved to My Tasks' Recent
  chat via the existing lazy-creation-on-first-message pattern; collapse =
  shrinks to a small icon without losing anything; a real reload always
  starts fresh). Hidden on `/my-tasks` itself; the first click each session
  redirects there instead of opening the popup, to nudge people toward the
  full chat experience. See PROJECT_STATUS.md's dated entry for Vincent's
  full 7-rule spec and the implementation notes. **Not yet exercised in a
  real browser** — drag, resize, collapse/expand, and the close-vs-collapse
  distinction are real interaction behavior only a live click-through can
  actually confirm; Vincent needs to try it on a few different pages.
- **Smart deep links for the agentic-chat preview cards, shipped 2026-09-09**
  — Vincent: "当用户点击去开单的时候你应该是带用户去到开单的接口，并且协
  助好找到对应的公司和点击好打开了那个发票编辑的弹窗，不只是带到 Billing
  draft 的接口页面就停了". `app/billing/page.tsx` and `app/late-filing/
  page.tsx` both now accept an `?openCompany=<name>` query param (plus
  `month`/`year` on the Billing page) and auto-open the real per-company
  edit dialog a manual click would — never auto-submitting anything, just
  landing the user in a ready-to-review state. `lib/deep-links.ts` is the
  one shared URL-format contract (server + client). Verified via a
  diagnostic script (URL construction + the real `findUniqueBestMatch()`
  matching against 16 real Late Filing rows and 792 real Billing rows,
  exact and partial-name cases both). **Not yet click-through tested** —
  whether the modal/dialog actually pops open correctly on a real browser
  navigation needs Vincent to try it.
- **Agentic-chat phases 2-4 all shipped 2026-09-09** — the "preview tool +
  real card/modal + write through the exact existing validated endpoint"
  pattern now covers 4 real actions: invoice draft generation (step 1/2
  above), editing an already-generated QuickBooks invoice
  (`preview_invoice_edit` → `PATCH /api/quickbooks/update-invoice`),
  marking a Late Filing record resolved (`preview_late_filing_resolve` →
  `PATCH /api/late-filing`), and generating the Post Incorporate document
  set (`preview_post_incorporate` → `POST /api/post-incorporate/generate`).
  Post Incorporate is structurally different from the other three: it's a
  genuine multi-turn GUIDED INTAKE conversation (Claude collects company,
  then each director, then each shareholder, a few real fields at a time,
  tracking progress itself across turns — the tool has no memory between
  calls) rather than a one-shot lookup, and its real endpoint returns a
  binary ZIP file, not JSON, so the frontend card does a `res.blob()` +
  `URL.createObjectURL()` + synthetic `<a download>` click instead of
  `res.json()`. The absolute constraint that survived Vincent's explicit
  push for genuine task-completion ("我比较极端 我希望是可以真正协助执行
  操作的...你要思考用户真正要的是什么") is that Claude must never invent,
  infer, or auto-fill any identity value (ID numbers, addresses, DOB,
  share details) — see `docs/INVARIANTS.md` INV-DATA-021. `claudeAnswer()`'s
  history window widened from `messages.slice(-8)` to `-24` so the guided
  intake doesn't lose earlier-collected director/shareholder details.
  Verified: `validatePostIncorporateInput()` (the real function the tool's
  completeness check depends on) exercised against 5 real cases via a
  throwaway diagnostic script (empty input, minimal valid, bad chairman
  match, UEN shareholder missing corporate director names, duplicate share
  certificate numbers) — all 5 behaved exactly as the real validator's own
  code says they should. `npx tsc --noEmit` and `npm run build` both
  clean. **Not yet end-to-end tested against the real endpoint** (would
  actually write a `post_incorporate_operations` audit row and download a
  real ZIP) — Vincent needs to try the real button himself, same reasoning
  as the other three phases' own un-exercised write paths.
- **Agentic invoicing step 2 shipped 2026-09-09** (`InvoiceDraftCard` +
  `GenerateConfirmModal` in `app/my-tasks/page.tsx`) — real styled card,
  real popup confirmation, wired to the exact existing `/api/quickbooks/
  create-invoice`. **Not yet end-to-end tested with a real invoice** (only
  build/type-checked and the data layer verified against real company
  data) — Vincent needs to try the real button himself. Known follow-up
  gaps, not yet started: (1) ~~none of the 4 preview cards' structured data
  is persisted to `ai_messages`~~ — fixed 2026-09-09, see the dated entry
  above (`preview_data` column, needs Vincent to run the migration SQL
  before it takes effect in production); (2) no dedicated audit trail
  distinguishing "AI proposed this draft" from "human clicked confirm" —
  today it's implicit (whatever `/api/quickbooks/create-invoice` itself
  already logs to `generated_invoices.created_by_email`, same as a manual
  Billing Drafts submission, nothing chat-specific).
- **Investigate why `ai_conversations`/`ai_messages` have zero real rows**
  despite real successful chat exchanges (Vincent's own screenshots,
  2026-09-08) — the DB write path itself is confirmed working (isolated
  `createConversation`/`appendMessage` directly, bypassing HTTP, a real
  row was created/read/cleaned up successfully), so the gap is somewhere
  in `/api/ai/conversations` POST or the real deployed request's
  `getRequestAccount` resolution, not the table or the admin client.
  `sendChatMessage()`'s own try/catch around conversation creation
  swallows a failure silently (deliberately, so a save failure never
  blocks getting an answer) — which is exactly why this went unnoticed.
  Not yet root-caused.
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
