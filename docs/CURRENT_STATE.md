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
| `sg_news_sync` | 22:30 (really starts ~22:44) | succeeds every night, but in 6 of the 9 reports from 09-29 to 10-07 at least one source failed on Vercel (`ERR_INSUFFICIENT_RESOURCES` / "browser has been closed", mostly the last ones — INV-CRON-019); mitigation shipped 2026-10-07, **not yet seen on a real run** |

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

**2026-09-17 — `replaceAutomationExceptions()` timing bug fixed (see
`docs/INVARIANTS.md` INV-CRON-015).** Every exception type except
`teamwork_nd` (the one caller passing a real `graceMs`) was self-resolving
within ~2 seconds of being created, so the dashboard and `open` counts above
have been silently blind to `quickbooks/duplicate_doc_number_*`,
`quickbooks/oauth_refresh_*`, `teamwork_companies/unknown_pic_id`, and
`teamwork_companies/missing_from_teamwork` for as long as this function has
existed — those 4 exception types will show 0 open even when the real
underlying problem is still happening. The fix is live, but it is
forward-only: it was not retroactively applied by manually re-running those
sources' syncs today, so their historical exceptions will only start
correctly showing as `open` from each source's own next scheduled cron run
(which will re-observe and persist them under the corrected logic). Don't
read "0 open" for those 4 types as "no problem" until at least one cron
cycle has passed after 2026-09-17. A new source, `soa_owner_audit` (daily,
22:00 UTC), was added the same day — a self-check that a human-confirmed SOA
Main PIC (`soa_owners.soa_pic`) still matches the current invoice-derived
suggestion; it flags contradictions for human review rather than
auto-correcting (see `app/api/soa-owners/audit/route.ts`).

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
  not merged into one. This is about the LIST/on-screen view only — since
  2026-09-17, the "All" page's own Draft Email / Download PDF actions
  (SoaDraftPopover, SoaDetail) are the one deliberate exception: clicking
  either on the All page combines that customer's TAB+TAC+TAO into a
  single Statement (combined cover page, combined merged invoice pages,
  combined email body/total) — every single-book page (TAB/TAC/TAO) still
  stays scoped to its own book, unchanged. Owner edits made from "All" write through
  `rowCompany()` to the exact same `soa_owners` row (customer name + that
  row's own qb_company) the single-system pages read — same data, not a
  copy, so it's immediately consistent both ways (`lib/soa-data.ts`'s
  `computeAllSoaRows()`, `app/api/billing/soa/all/route.ts`). The Owner column's default is
  now computed automatically from each company's own real QuickBooks
  Class/Location data (`lib/soa-owner.ts`, see INV-QB-013) instead of
  needing a manual Google Sheet backfill — a human pick in `soa_owners`
  still overrides it when set. Since 2026-09-17 that automatic signal (plus
  the `companies.pic` union) is also restricted per QB company to the staff
  team that actually services that book — TAB only Corporate Secretarial,
  TAO only Accounting/Tax (INV-PIC-007); TAC has no such restriction (its
  PIC is the current Nominee Director, INV-QB-008). Verified end-to-end against real data
  2026-09-07 after the SQL migration + a full production sync: TAB
  94.6%, TAC 81.4%, TAO 98.5% of companies with an outstanding balance
  now get a real computed owner with zero manual input. As of 2026-09-16
  the underlying `quickbooks_ar_aging_detail` snapshot (INV-QB-017) that
  drives every one of these SOA/Outstanding numbers refreshes near-
  real-time via the QuickBooks webhook whenever an Invoice/Payment/
  CreditMemo/JournalEntry/Deposit changes for a company (INV-QB-021),
  not just once daily — the daily cron (`vercel.json`, 19:30 UTC) remains
  as the unconditional fallback. Real end-to-end responsiveness (webhook
  fires → total visibly updates within ~a minute) has not yet been
  observed against a live Intuit-delivered webhook event in this
  sandbox — see REG-021's own note on the Intuit Developer Dashboard
  subscription dependency this can't verify from inside the repo.
- Client Communications (campaigns, templates, drafts, send history) +
  Draft Helper (separate desktop app) for the real Outlook send
- Post Incorporate document generation (1 of 13 planned document types —
  see Pending Improvements)
- Company 360 (`/companies/[id]`) and My Tasks (`/my-tasks`) — shipped
  2026-08-31, `npx tsc --noEmit`/`npm run build` clean; not yet exercised
  against real production data by a real login (see Pending Improvements).

## Active issues

**SG Latest News — links, sources and server runs: fixed in code 2026-10-07, none of it seen on a real server run yet (INV-DATA-077, INV-CRON-019, REG-042).** Vincent: "ICA 和 ACRA 我没来得及实测…线上页面我没能亲眼看到…同步在服务器上的实际运行也没有验证 — 这个找办法解决". Found by testing every source on its LIVE page with the app's real fetch code and by reading the stored history (sg_news_daily_reports, automation_sync_runs): every card linked to its source's front page (all 222 stored items had no address); IRAS and ISCA were pointed at MENU pages and had never stored an item while every night said "success, 0 items"; CSIS's 403 came from our own outdated "Chrome/124" declaration (the real version gets the full page), and a 403 was recorded as success because `page.goto` does not throw; ACRA's and ISCA's card links did not match; in 6 of the 9 reports from 09-29 to 10-07 at least one source failed on Vercel (`ERR_INSUFFICIENT_RESOURCES` / "browser has been closed", mostly the LAST sources — not overlap with another Playwright job, not reproducible locally); and new items were stored BEFORE the report, so a failed digest lost them for good. Changed: matcher (card headings, one headline ↔ one page across the whole run, no tag pages, no address from the model, redirects, stored items given their link in hindsight), IRAS/ISCA on their real list pages, a blocked or empty page is a failed source, every run records each source's facts in `automation_sync_runs.summary`, items are stored after the report, the first read of a new source is stored silently (Vincent's choice), a source silent for 3 days is raised on Automation Health (`source_silent`), image/media/font requests blocked (the last retry is not) plus the no-cache launch flags, the nightly run is `lib/sg-news-run.ts` (executed with fakes in `test-sg-news.ts`). Verified locally: 101 checks, 54 negative controls, `scripts/check-sg-news-sources.ts` on all 9 live pages (no matcher miss, the new fetch sees what the old one saw except CSIS), the real page component at 1668 px (a 2-card row keeps the 4-column width), and a forecast that 8 of today's 10 cards get an article link. **NOT verified:** any real Vercel run since the change — after the first one read `automation_sync_runs.summary` (REG-042): each source's `facts.status`, `chars`, `attempts`, `tmpFreeMB`, `blockedHeavy`; IRAS/ISCA `firstRun: true` and `reported: 0`; whether IRAS (behind Cloudflare) answers Vercel's addresses at all; whether the resource mitigation was enough (INV-CRON-019 (7)). Not built: RSS feeds for ST and BT (would remove two browser renders and give exact links), a "search the original" link for cards whose headline has left its page.

**8 tables are readable with the public anon key (found 2026-10-05, not fixed — security).** A count-only check (HEAD requests, no rows read, writes not tested) shows `companies` (956 rows), `master_list` (1,608), `audit_log` (4,958), `annual_returns` (1,655), `late_filing_companies` (40), `nd_appointments` (222), `nominee_directors` (14) and `sync_log` (4) fully readable by anyone holding `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which ships to every browser; the other 37 tables with rows hide them from that key. `master_list`, `audit_log` and `late_filing_companies` carry a policy named `service_role_all` that is really `USING (true) WITH CHECK (true)` for every role (INV-DATA-073). Fixing it needs an order: `/api/companies`, `/api/stats`, `/api/nominee-directors` and `app/address-service/page.tsx` read these tables through the anon client, and Master List's Realtime subscription watches `master_list` through the browser client — those move first, then Vincent runs the lockdown SQL. Raised as its own task. Side effect seen while checking: `/api/stats` reads `automation_sync_runs` through the anon client, which sees none of its rows, so its `lastSynced` is always `null` — harmless today, since no page calls `/api/stats`.

**Invoice number / amount from QuickBooks — FIXED, not yet seen on the deployed site (2026-10-05).** `generated_invoices` logs the number and total at creation and nothing updates them; staff had renumbered 1X EXCHANGE in QuickBooks (#02611111 → #02611112, #02611111 being Nucon's) and changed 7 totals. Now Billing Drafts, the AR email list, AR Reminder and Company 360 read QuickBooks' current number and total by Id; a generated invoice's chip opens by Id (opening by number refuses when two invoices share it); the pre-send check refreshes number and amount on every send path; the last duplicate check fails closed and a same-number invoice is reported after create (INV-QB-030, REG-030). Verified on live data, read-only, through the changed code. Still open: 2 AR emails already sent show amounts that differ from QuickBooks today (KINPLUS 24/09 S$1,120 vs S$1,220; ADVANCE CF 29/09 S$1,120 vs S$1,070) — only QuickBooks' Audit Log tells whether the change came before the email. The assistant and team-activity still quote logged numbers (history, internal).

**Clients see split service amounts — OPEN, being fixed in the system (2026-10-05).** Done the same afternoon: Billing Drafts' invoice editor shows each service once at its full amount and saves accounting's split back untouched (`lib/deferred-pairing.ts`, INV-QB-029/031). The PDF clients receive is live too for TAB and TAC (`lib/client-invoice-pdf.ts`, `CLIENT_INVOICE_PDF_MODE`, switched on after Vincent approved real samples) — not yet seen on a real sent email. Chinese client names and full-width brackets print too (embedded Noto Sans SC, 2026-10-05), so 152 of the 154 open split invoices go out redrawn; the other 2 can't be paired exactly and go out as QuickBooks' PDF (staff are told why). A client asked why Novozee's invoice showed address 180 + 180 and payroll 300 + 300. Those lines are Chelsea's deferral split in QuickBooks — it stays, and the system must neither touch nor record it (Vincent, correcting the earlier "stop splitting" reading; INV-QB-029). What leaks it to clients is the system attaching QuickBooks' own invoice PDF (Email Drafts via `/api/quickbooks/invoice-pdf`, the SOA PDF via its `fetchInvoicePdf`), which prints every line; the email body and the SOA cover already show whole-invoice totals. Planned: the system produces the client-facing invoice PDF itself, each service once at its full amount; 154 open invoices carry a deferred line today. Nothing was changed in QuickBooks. Separately, the SOA cover lists each invoice with only its FIRST service's text against the whole amount (325 of the 547 invoices open that morning have several services) — a format choice for Vincent, not yet made.

**Invoice copies in QuickBooks — live from 2026-10-06 (INV-QB-036).** Every invoice the system creates (Billing Drafts TAB/TAC, the TAO builder, the assistant) gets QuickBooks' own PDF attached to the invoice in QuickBooks, and the system's own copy is replaced when the invoice is edited before sending — accounting's new rule ("From now onwards, kindly attached the invoice copy as attachment here"). Checked on a real invoice (TAB #02611136) with Vincent's approval. Watch: (1) staff were already attaching copies by hand that afternoon — once this is deployed they should stop, or each new invoice ends up with two files (the system never touches a hand-attached file, and adds none next to one on an edit); (2) a failure shows as a ⚠ beside the invoice and is logged ("Invoice copy not attached" in the Vercel logs) — nothing retries it, staff attach by hand; (3) invoices that existed before, and ones accounting has already split (e.g. #02611099), are not backfilled — the copy would be the split version; (4) each attach or delete moves the invoice's SyncToken, so never hold one across it.

**Split invoices: the original from QuickBooks attachments — server round done 2026-10-06 (INV-QB-037).** Vincent's order: the original attached in QuickBooks, then the one fetched from the file server and attached, and only then the system's redraw. For every invoice accounting has split, `getClientInvoicePdf` looks first among its QuickBooks attachments for a PDF that proves it is the original (not the system's own drawing; every page read; "Invoice No. / Date / customer / total" on the page in either of the two real layouts; the printed amounts equal the invoice's lines with each Deferred twin folded into one line); otherwise the redraw, or QuickBooks' PDF with a notice where the system cannot draw. The first version of this lookup was reviewed by a council the same morning and let 7 wrong files through (a Save PDF redraw above all) — fixed before any original was attached. **The server round (Vincent: "去 server 读，然后拉文件", then attach):** the invoice backup folders on the file server (`Q:\Finance\…\TAB_All invoices backup\<year>`, `TAC_All invoices backup\Invoice_<year>`) were read — read only, nothing on the server written, moved or deleted — for the 155 open invoices that carry a Deferred line (TAB 130, TAC 25); every one has a file named after its number. 131 are provably the original (127, then 4 more once the proof ignored an invoice's exchange-rate footer) and all 131 (TAB 113, TAC 18) were attached to the invoice in QuickBooks, each checked against the LIVE invoice first and confirmed by the real look-up after (`attach-log.jsonl` in the scratch folder; the first, TAB #02611114, byte-identical to the server file). Both invoices whose Deferred twin accounting had labelled with the wrong service (TAB #02611114 Hong Ming, #02611078 Fuyuan) now have their true original, which prints 600/200 and 700/360 as the council predicted. **24 invoices are left for a person** (13 server files are pictures with no text, 5 were restructured by accounting after sending, 3 totals and 3 dates were changed after sending) — each with its server path and what to do in `Server-round-originals-2026-10-06.xlsx` (delivered to Vincent, not in the repo); until someone uploads a file the system can prove, those 24 are redrawn. **Staff clear them on Billing System › Invoice Originals (redesigned 2026-10-07, Vincent: "已经拿到原装发票的……就已经不需要在 Invoice Originals 页面内了"):** the page lists ONLY the invoices still waiting for an original (24 today, all "nothing attached"; those whose original is in use are only counted), computed live with the SOA's own proof; the person finds the original (Outlook Sent Items, the file server) and uploads it on the row — the system proves it against the live invoice, attaches it in QuickBooks and the row leaves the list; a file it cannot prove is refused and attaches nothing, so the 13 pictures and the 5 restructured invoices stay listed until a provable file is found (settled 2026-10-07 — see below). **Checked 2026-10-07 (Vincent: are the 24 even in the SOA?):** yes — all 24 are open invoices of customers with an SOA row, 22 on the live Outstanding list (19 are 91+ days overdue); DEMIRER KABEL TAC #02680124 and Sanli TAB #02511395 net to 0 and are not listed. But for 18 the redraw already equals or correctly replaces what the client received (12 of the 13 picture files were rendered and compared by eye and are identical; the 6 changed after sending show the current invoice); 4 more differ only in line breakdown (EVOP #02610547, Nova Golden #02610907, Soon & Guan #02611000 and the 13th picture, Minyotech #02610788). The one real flaw on a live SOA is Co-Operate Associates TAB #02610167 (S$1,860, 212 days overdue): no payment terms in QuickBooks, so the SOA carries QuickBooks' own PDF with accounting's Deferred line visible (Sanli #02511395 the same, but net 0). **Decided by Vincent (2026-10-07):** the 18 where the redraw is the same or right, and Sanli (no SOA is sent), are LEFT AS THEY ARE — removed from the Invoice Originals list, the SOA keeps merging the redraw; the 4 appearance-only differences (EVOP #02610547, Nova Golden #02610907, Soon & Guan #02611000, Minyotech #02610788) use the ORIGINAL — attached in QuickBooks 2026-10-07 and accepted by sha256 through `lib/original-decisions.ts` (a person's decision, narrow, lapses when the invoice changes); only Co-Operate Associates TAB #02610167 stays on the list. Live check: the list has 1 row, 135 invoices have their original in use, 19 are decided, and the real SOA route merges the originals for the four. **Still open (his call):** whether an invoice with no payment terms in QuickBooks may take them from its due date (7 days = Net 7) so Co-Operate is redrawn instead of sent as QuickBooks' split PDF; and everything above was pushed on 2026-10-07 (0402863..745b61a, by Vincent) and has not yet been looked at on the deployed site (REG-040). **Checked end to end with the real code (this PC, the real database and QuickBooks; 2026-10-06 night):** `getClientInvoicePdf` — the function behind the SOA PDF, Email Drafts and Save PDF — for all 155 open split invoices returns the attached original for 127 (bytes identical to the server file), the redraw for 26 and QuickBooks' own PDF for 2 (their payment terms could not be read); 0 errors. The real SOA route handler for four customers (Hong Ming, Advance CF Technology, Siehi Shipping, Kinplus Trading) put the originals into the merged PDF page by page — Hong Ming's invoice prints the true 600 + 200 + 60 = 860, not the redraw's 650 + 150 — and the redraw only for the invoices left for staff. Still unseen: Vercel itself (the PDF reader's worker file) — the first load of the Invoice Originals page is that check (it opens the 131 PDFs; a book or invoice that cannot be read shows as "could not be fully checked"). Watch: (1) the PDF reader's worker file has not run on the deployed site yet — the first load of Billing System › Invoice Originals is that check (REG-039, REG-040); (2) a wrong file attached by hand is not used and the invoice is redrawn — the Vercel log line "Attached original not used (TAB 02611112): …" and that page say why; (3) each split invoice costs one more QuickBooks call per SOA / email / Save PDF, and a download + read when a PDF is attached — time not measured; (4) a copy of the right invoice with edited descriptions or address is used (accepted risk); (5) every attach moves the invoice's SyncToken (harmless — `update-invoice` reads it live).

**SOA Drafts after Vincent's first live test (2026-10-07) — FIXED, not yet seen on the deployed site (INV-MAIL-006, INV-MAIL-007, INV-DOC-024, INV-QB-038).** He pushed 745b61a and reported: the merged SOA is right, some invoices opened from the SOA still showed the split ("Source" — he says it is individual ones, thinks it is solved, will check again himself), and Draft Email failed on EVOP. Fixed: (1) a Draft for a company that still owes works even when it is inactive, Terminated or no longer in TeamWork (his decision: "我们还是需要发SOA 去追债"; exact name, never fuzzy; EVOP's draft now carries TAB #02610547 S$1,800); (2) the email body lists the invoices its statement shows — 11 of the 400 Outstanding rows said "(no invoices)" before (ACG Interior, Soon & Guan, Yu An (SGP) Holding …), none do now — with a look-alike guard, and an SOA draft with no invoice in its body is refused; (3) the invoice numbers in the SOA detail open the client's copy; (4) his three answers of the same day, all done: the send-time refresh reads what is STILL OWED for an SOA email ("改成读未付余额" — 26 invoices, TAB 20 / TAO 6, e.g. Easybook Pay TAB #02510178 S$1,660 invoice, S$200 owed, the body used to say 1,660; plus FAITH CAPITAL's four USD invoices, which it wrote as "S$507.55" instead of S$652.76 — now converted at the invoice's rate; checked against all 576 open references: the old rule rewrote 30, the new one none), the statement route refuses a customer that fits ANOTHER company at least as well ("加" — Yu An (SGP) Holding's "All" draft used to attach Yu An Bulk Holding's TAB statement), and a debt with no invoice behind it gets a cover-page-only statement ("要，做成只有封面页的对账单" — 12 of 413 rows: INVENTA TECHNOLOGIES TAB S$1,505.50, EASYFLY S$2 …; an invoice among the items stays "not found" so a lagging sync is never papered over). Checked with `tsc`, eslint, `next build`, the new tests (86 + 14 + 44 checks; negative controls 37 + 41 + 12), `test-company-lifecycle.ts`, two independent read-only reviews (the second found four real problems, all fixed: an applied credit counted twice, a look-alike's address on a cover-only page, a needless read on every "All" draft, a vacuous test), and the REAL preview, statement and client-invoice routes on the real data (read-only; the INVENTA statement was rendered and looked at). **Still open — his call:** (a) **the four originals in use** (EVOP #02610547, Nova Golden #02610907, Soon & Guan #02611000, Minyotech #02610788): if QuickBooks cannot be read at that moment the SOA carries the redraw without any notice (585 + 315 where the original shows 900, 500 + 500 for 1,000, 285 + 315 for 600) — he wants the list to judge himself, no warning built; (b) 55 Outstanding rows have no `companies` row (TAB 10, TAC 7, TAO 38), so no email address and no draft; 7 more have a company but no email; (c) Campaign Centre's BULK SOA list still offers only active companies (not touched; a hand-added inactive company now resolves by exact name); (d) FAITH CAPITAL GLOBAL FUND VCC (TAB): its body total (2,611.04) differs from its SOA row (2,550) — two QuickBooks customers, one spelled "Glocal" — accounting's data; (e) the assistant's own "draft an SOA email" lookup is still active-only, and a debtor with no company row can still be addressed to a similarly named live company (0 of 400 rows today) — a stricter rule is a client-matching rule only he can state.

**Chinese-name PDFs — what is still open after the council review (2026-10-06).** Fixed the same day with Vincent's go-ahead: the ALL-mode SOA Draft now stops and names a book that fails instead of leaving it out (INV-DOC-023), and the company, master-list and AR-reminder search boxes accept commas (INV-DATA-075). Still open, none of it live breakage: (1) TAB's 130 open split invoices have not been measured for long BILL TO addresses (TAB's QuickBooks token had expired; TAC measured: 1 of 24, fixed); (2) every system-drawn invoice is ~200–260 KB (its PNG parts aren't shared), so an SOA of roughly 18–24 redrawn invoices would pass Vercel's 4.5 MB response limit — today's largest customer has 15 open invoices across all books; (3) the Draft Helper (`draft-helper/app.py`, Python, installed per machine, unchanged) cuts an attachment name at `/` — SOA attachment names are now cleaned before they reach it (`safeFileLabel`) and no open customer has such a name today.

**AI usage ledger — recording ready, waiting for its table (2026-10-05).** Every paid Claude/OpenAI call now goes through one recorder that writes one row per call to `ai_usage_events`: who caused it (the real signed-in person, never the View-As account), which feature, which model, tokens in four buckets, and estimated USD at the published price (INV-AI-010). Nothing is recorded until Vincent runs `scripts/add-ai-usage-events.sql` in the Supabase SQL editor (the code skips quietly until then). Admin › AI Usage (Vincent only) shows it per person and per feature for today / 7 days / this month, refreshing every 30 seconds; until the SQL is run it says what to run. Neither the recording nor the page has been seen on real calls yet (REG-029). Since 2026-10-07 the My Tasks daily reminder counts as the system's, not the person's (Vincent: "My Tasks 提醒的 token 全部算系统的"; `SYSTEM_OWNED_FEATURES`, applied to old and new rows alike — nothing rewritten); the learning pass after a chat still counts under the chatter.

**Turnover AI uploads — fixed, not yet seen working in production (2026-10-05).** Every upload had been failing at the document insert since the Projects restructure (`client_name` is still NOT NULL — INV-DATA-071, fixed in 1e928e1). Then the same day: files are prepared in the browser before sending — photos (and HEIC, converted to JPEG) shrunk under Vercel's ~4.5MB request limit, PDFs over 4.4MB stopped with "split it" — and files that fail or get cut off are listed on the project page with a Remove button and counted on its card (INV-DATA-072). All verified locally and in a browser harness only; the 4.5MB limit and a real Claude read exist only on the deployed site — REG-028 is the real check. Still open, by Vincent's choice (AskUserQuestion, 2026-10-05: keep blocking for now): a PDF over 4.4MB cannot be uploaded at all (staff must split it). Blocked attempts are logged as `turnover_upload_rejected` in `user_activity_events` — look at that count after 1–2 weeks to decide whether direct-to-Storage upload is worth building.

**Statement memo written by the app (2026-10-04).** Every new invoice the app generates — TAB/TAC from Billing Drafts and TAO — carries QuickBooks' Statement memo, written automatically from its lines the way staff type it; there is no memo field anywhere (Vincent: "自动就好了，也不需要特地多一个东西显示这个Memo"), and staff no longer add it in QuickBooks afterwards (INV-QB-027). Verified on real data (TAB 86/99 and TAC 20/20 identical to staff's own; TAO: the same YA as staff on 425/428, wording standardised where staff's own varies) and in a local preview; not yet on a real generated invoice (REG-027 steps 5–6). The "Print later" flag stays as it is (Vincent's choice).

**The system is split into 6 TCS departments (2026-10-04).** Every login belongs to TCS ADMIN (Vincent), MANAGEMENT (Cindy/Samuell/Yee Soon), FINANCE (Esther/Chelsea), CORPSEC (7; was SECRETARIAL — renamed 2026-10-05, display only), ACCOUNT (Jay + 4) or TAX (Clarence + 2); each sees its own header title and only its own pages, and a page outside its list is really blocked (`lib/workspaces.ts`, INV-DATA-069). Versus before: Finance lost Post Incorporate and Proposal Generator; ACCOUNT/TAX gained Dashboard, Companies, all of Billing Drafts (TAB/TAC too), Quotation and all 4 Outstanding books (ACCOUNT also Turnover AI) and keep AR Reminder as their home; Quotation is open to every department. Vincent and Management have a 切换部门 picker next to Logout — display only. Proven by an access table for all 21 accounts × every route (`test-account-access.ts`) and a before/after diff that changed nothing Vincent didn't approve, plus a browser preview of each department's menu; **not yet seen through a real login of each department** (REG-016). Their TAB and TAO invoices carry their QuickBooks Location (INV-QB-028 — the TAB Locations existed in QuickBooks and were mapped the same evening); their TAC invoices carry none, because QuickBooks TAC has no Location for them and creating one would also make them the TAC SOA owner of clients whose ND invoice they key — Vincent decided the same evening not to create them for now (revisit only if ACCOUNT/TAX actually start keying TAC/ND invoices). Tan Min Quan, who has no Location in any book, stays as is too (Vincent: 暂时不用). Quinnie Tan and Victoria Yap's first real sign-in is still to be seen.

**Per-line PIC column on Billing Drafts invoices is new and not yet used for real (2026-10-04).** Every invoice line now has its own PIC (= its QuickBooks Class) in the Billing Drafts popup, like QuickBooks' own Class column (INV-QB-026). Verified against real data and in a local preview where nothing was written to QuickBooks; the first real edit/generate from a signed-in session is the real check (REG-027). Editing an existing invoice no longer re-assigns line Classes to the company's current PIC — the old behaviour would have changed 80 of 163 line Classes across 40 real invoices (whether earlier saves already did this cannot be told: line Classes have no history). The TAO page now restores QuickBooks' own TAO settings too — each line's PIC from the client's history, the generator's TAO Location, and a Statement memo written from the lines — also not yet used for real (REG-027 step 5). Still open: 3 company PIC values (Chelsea Ang, Min Quan Tan, Vincent Seow) have no TAB Class, so those companies' Secretary/XBRL lines default to no PIC (the popup says so).

**Company-lifecycle safeguards are new and not yet seen in a real run (2026-09-28).** `lib/company-lifecycle.ts` now owns every rule about a company's TeamWork status, "is it terminated" and — since INV-AR-018, same day — "is it an active client" for EVERY feature (AR Generate, Late Filing, Billing Drafts, Companies, Master List, ND, Dashboard, Reports, Client Comms, TAO, the assistant; `test-company-lifecycle.ts` fails on any private copy) (INV-TW-024, INV-AR-017, INV-AR-018): stubs can't claim rows, a blank TeamWork status never changes a company, blank is never "terminated", AR rows the system hid are auto-restored, a mass hide/restore is blocked, and any Active company with ALL its AR hidden raises `active_company_ar_all_hidden`. Dry-run against live data changed nothing, and every roster selects exactly the same companies as before (by id) — the first real `teamwork/sync` (13:00 UTC) and `late-filing/sync` (21:00 UTC) after deploy are the real check (REG-026). Expected on Automation Health from the first run: 2 `tracked_record_blank` (EVOP (SINGAPORE) INTERNATIONAL — a "CSS Client" in TeamWork with no status, so it can never get AR until someone completes it — and WORLD PRECISION MACHINERY) and 0 `lifecycle_fields_inconsistent`; anything else new there is a real finding. On the TAO page those same 2 companies now count as TeamWork-tracked and can no longer be deleted there (the INV-AR-018 fix). Still open, cosmetic only now: the 7 companies filed under Master List's Terminated Services that TeamWork shows Active (INV-DATA-067) — they no longer affect AR.

**Master List Terminated Services statuses — cleanup waits for its first sync run (2026-09-24).** 196 of the 269 rows carry a status TeamWork cannot correct because those companies are not in its list ("YES" ×180, the 10 old "TERMINATED", plus "NO", "terminate", "to be terminate", "RENAMED", blank, "Mary"). The rule that sets them to the placeholder "Terminate" (INV-DATA-067; "Terminate" = filed here, not yet confirmed; "Terminated" is TeamWork's own word and only ever arrives from TeamWork) is in the nightly `teamwork/sync` — the first run after the 5af0e63 deploy applies it (check that run's `master_list_terminated_defaults` ≈ 196, then the Terminated Services page has no "YES"). A direct one-off write was attempted and blocked by the session's permission guard, so nothing was hand-written. Not fixable from the app: 7 companies still "Active" in TeamWork (XSPY, SINGAPORE CHINESE ARTS CENTER, SATORISYS, HALOFUN, ANABLE MANAGEMENT SERVICES, ARK PARTNERS MANAGEMENT, SINO MINING HEAVY INDUSTRIES) and 2 "Striking Off" (WEIOT, ALLIED CHANCE INTERNATIONAL LIMITED (SINGAPORE BRANCH)) although filed under Terminated Services — the list follows TeamWork, so staff must fix TeamWork's Status (or move the row back to Active Client). Also open: Strike Off has 6 stale rows (5 "YES", 1 blank) that need Vincent's wording decision.

**Supabase paging / 1,000-row-cap safeguards are new and not yet seen in production (2026-09-24).** `pageAll()` now orders every page by a unique key and throws on a failed page; `createAdminClient()` completes any plain read that hits PostgREST's 1,000-row cap (`lib/supabase-auto-page.ts`); 5 hand-written `.range()` loops got an ordering; SOA/TAO same-day ties use explicit rules (INV-DATA-066, REG-023). Verified against the real database and fake backends from a dev machine only — nothing has run on Vercel yet. After the first deploy check: (1) the AR Reminder rows that used to lose 2026 invoices (LOYANG BESTCONN, ASIA BLUE, ECAPTIAL) now list them; (2) the Vercel logs — a `[supabase] unpaginated read of "<table>" hit the 1000-row cap` warning is expected and harmless (it names a call site worth converting to `pageAll()`), whereas `[supabase] read of "<table>" hit the 1000-row cap and could NOT be completed` or `[supabase] auto-pagination failed` are real problems (kill switch: `SUPABASE_AUTO_PAGINATE=0`); (3) `soa_owner_audit` stays free of HAN KUN LLP (TAO) — if it reappears, the same-day tie rule in `lib/soa-owner.ts` has changed. Not covered: an explicit `.limit(N)` above 1,000 (none exists today) and offset drift when a table changes between two page requests of one read.

**AI quality spot-check — running; first real run verified 2026-10-06.** The cron fired 2026-10-05 23:56 UTC and succeeded: 6 replies judged (5 pass, 1 flag — `unfounded_specificity`, for Vincent to mark on `/ai-quality`), 3 fallback menus skipped, 0 errors; 6 distinct `ai_quality_reviews` rows (the public key sees none — RLS works); 6 `ai_usage_events` rows at about US$0.002 each (output tokens 18–177, nowhere near the cap). Original notes follow: It has never produced a single review, for two reasons confirmed on real data: `/api/ai-quality/review` was scheduled (`0 23 * * *`) but missing from `proxy.ts`'s `CRON_PATHS`, so Vercel's nightly call was answered 401 every night (zero `automation_sync_runs` rows ever, while `sg_news_sync`/`soa_owner_audit`/`ai_learning` run nightly — INV-CRON-011); and `ai_quality_reviews` was never created (PGRST205), so not even the "立即抽查" button could have saved a review. Vincent ran `scripts/add-ai-quality-reviews.sql` (with RLS on — INV-DATA-073) on 2026-10-05, and only then was the path added to `CRON_PATHS` on main (guarded by `test-cron-wiring.ts`) — in that order because a run without the table pays to judge every reply and saves nothing (INV-CRON-012). Don't click 立即抽查 before the first nightly run: it would use up the replies that run is checked against, and it goes through the signed-in path, not the cron path. **How to check the first run** (23:00–23:59 UTC the night after both are live): one `automation_sync_runs` row, source `ai_quality_review`, `trigger_type` `cron`, status `success`, summary `reviewed` = the number of eligible replies (assistant replies with an `agent_run_id`, over 20 characters, not a fallback menu, capped at 20 — as of 2026-10-05 that is at most 6: 9 have an `agent_run_id`, the last from 2026-10-02, and 3 of them are `intent_fallback` menus, skipped and counted as `skippedFallback` 3), `errors` 0, `skippedNoKey` false; that many new `ai_quality_reviews` rows with distinct `message_id`s; and the anon key counting 0 rows there while the service role counts them all. Status `success` alone proves nothing — the route counts a run as successful if even one review was written. The 3 `intent_fallback` replies of 2026-09-23/28 (the generic menu shown when the Claude call failed) are not judged — there is no model answer in them to judge. Later nights should review only new replies (usually 0) and never repeat a `message_id`. If the summary shows `errors` > 0, its `errorSamples` say why (the judge's hardening is described in the next paragraph).

**AI quality judge — hardened before its first run (2026-10-05), not yet seen on real calls.** Sonnet 5 thinks by default and thinking counts toward `max_tokens`, so the judge's original `max_tokens: 800` could cut its JSON verdict off — and the error was swallowed (the summary only counted `errors`), so that reply would be judged and paid for again every night. Now (INV-AI-006): adaptive thinking at low effort with `max_tokens` 4000; a cut-off or refused reply throws instead of guessing; the summary carries `errorSamples` (the first three messages) and `skippedForTime`, and a failed run records its first error; the batch throws before any paid call if it can't read `ai_quality_reviews`; it stops starting judge calls after 90s of the route's 120s. The run route now takes only the exact `CRON_SECRET` or an admin account — before, any signed-in staff account could start a paid run by opening the URL (INV-CRON-018). On the first run, `errorSamples` says what failed if `errors` > 0, and `ai_usage_events` (the AI usage ledger, created the same day) shows each judge call's tokens. Still open: a reply whose judge call keeps failing is re-tried and re-billed every run (no attempt cap). Cost is small — Sonnet 5 is $2 / $10 per million tokens, about 1–2 US cents per judge call.

**AI answer-quality learning loop — designed and decided, built in units (2026-10-05).** Vincent asked whether every Q&A could go through a nightly 8-role council so the assistant answers better next time. The full council (14:07 SGT, 4 members, unanimous ranking) said no to 8 roles per reply. The reviewers would see only the reply text, never what the tools returned, so their agreement is not correctness — and most past failures were fixed in code. Vincent then chose (AskUserQuestion): behaviour-type rules apply automatically only after passing an exam ("行为类自动 + 考试"), evidence is kept 30 days ("存 30 天"), and a weekly full council ("每周一次"). The design:
- Store each reply's tool evidence: 30 days, RLS on, server-only, written separately so a failed write can never cost a reply its `agent_run_id`.
- Two reviewers — one diagnoses, one checks independently — and only on flagged, confirmed or corrected replies.
- A new GLOBAL guidance table: at most about 8–10 short rules, each expiring after 30 days and revocable on its own, a master switch, and the active rule ids logged per reply. Not `user_memories` (INV-AI-011), and no real answers used as examples.
- Only behaviour rules (tool routing, ask first, caveats, format/language) may auto-apply, and only after a replay exam: the source case passes and past incidents don't break. Business rules, facts and permissions never auto-apply; they go to Vincent or become code tickets.
- Once a week a full council in Claude Code turns the week's findings into code and tests.

Units:
1. Shipped 2026-10-05: the judge's `over_caution` category and fallback skip, plus the prompt memories fix (INV-AI-011).
2. Shipped in code 2026-10-05 (INV-AI-012): evidence capture, the empty guidance table with its fail-closed switch and injection point, a judge retry cap, and the 30-day evidence purge. Vincent ran `scripts/add-ai-answer-learning.sql` on 2026-10-05 (4 tables verified, RLS on); no assistant question has been asked since, so no evidence row exists yet — the first one is the real check. Answers are unchanged either way: the guidance table is empty.
3. Later:
   - the reviewer/checker pair;
   - the replay exam (needs `claudeAnswer` pulled out of `route.ts`);
   - `claude-opus-5` added to `lib/ai/pricing.ts` before any Opus call;
   - spend caps of US$1 a night and $20 a month;
   - scheduling the weekly council.

None other currently known-broken as of this writing, but the TeamWork
automation collision (see Automation health above) is a real, recent
recurrence of a previously-"fixed" problem — treat its fix as
**unconfirmed until 5-7 real clean days are observed**, not resolved. See
`docs/INVARIANTS.md` INV-CRON-013.

Company 360 / My Tasks are freshly shipped (2026-08-31) and haven't had a
real post-deploy login check yet — see Pending Improvements, not listed as
an issue since nothing is known wrong, just not yet confirmed right.

**Internal-network document search — cloud-side plumbing only, NOT yet a
working feature (2026-09-16).** The assistant's `search_documents` tool,
`app/api/nas-index/ingest/route.ts`, and `nas_documents` (`scripts/add-nas-
document-index.sql`) are deployed and `tsc`/build-clean, but three real
pieces are still missing before this actually does anything: (1) Vincent has
not yet run the migration, so the table does not exist in production; (2)
`NAS_INDEX_SECRET` is not set, so the ingest route currently returns 503 for
any request; (3) the indexing script that actually walks the file share,
extracts content, and POSTs batches has not been written yet.

**Correction, 2026-09-16 (real, tested — not the original assumption):**
`\\Rainbow` (the file share this targets, mapped as `Q:\RainbowData` from
Vincent's own machine) is **not a NAS appliance** — live testing (port scan
+ `net view` showing it also hosts `NETLOGON`/`SYSVOL`) confirmed it is a
Windows Server that is also the company's Active Directory domain
controller. Running extra scripts/scheduled tasks directly on a domain
controller is against normal security practice, so Vincent chose (asked via
`AskUserQuestion`) to have the indexing script run on a SEPARATE always-on
machine that reaches `\\Rainbow\RainbowData` over the network instead —
which specific machine is still to be designated by Vincent/IT. Content
extraction itself is confirmed technically easy: a real `.docx` on that
share was unzipped and its `word/document.xml` read directly (no Word
needed) to pull real text. Folder structure under "All Clients Profile" is
letter (A-Z) → `"<code>_<COMPANY NAME>"` (e.g. "CA029_ACG INTERIOR AND
EXHIBITION PTE. LTD") — matches `lib/company-name.ts`'s `normalize()` once
the leading `CA029_`-style code is stripped, a detail the original plan
missed. See `PROJECT_STATUS.md`'s dated entry for the full investigation.

The assistant will call `search_documents` and get back a real, honest "0
results" for any query until all of the above is in place — that is
expected, not a bug, but do not describe this feature as "live" to Vincent
without checking first.

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

**My Tasks now has a multi-model agent and controlled conversation
learning (code-complete 2026-09-21; database migration still required).**
`app/api/assistant/route.ts` uses `lib/ai/orchestrator.ts` to divide work:
clearly external/general questions can go directly to OpenAI; ordinary
Tassure lookups stay on Claude's established tool-use path; complex
internal analysis runs Claude tools first and lets OpenAI synthesize the
result without changing tool facts. The user still sees one final answer.
Every OpenAI Responses request sets `store:false`, and Post Incorporate
identity intake stays Claude-only. `ai_agent_runs` plus provenance columns
on `ai_messages` make provider/model/route/tool usage auditable.

Saved My Tasks conversations are now a second AI Learning evidence source,
alongside `user_activity_events`. `lib/ai-learning/conversations.ts`
analyzes the last 30 days for durable preferences, workflows, corrections
and decisions, excludes secrets/sensitive data/one-off business facts, and
upserts evidence-backed candidates. It never promotes one casual message
directly into memory: the existing `confidence >= 0.9 AND distinct_days >=
5` rule remains the only automatic promotion path, and everything below
that stays reviewable in AI Learning. The daily automation scans both
sources; relevant new chat wording also schedules a best-effort background
scan after the reply is safely returned. Before production can use these
new fields/tables, run `scripts/add-ai-multi-model-and-conversation-
learning.sql`. `OPENAI_API_KEY` and the three optional model variables must
exist in the deployment environment; Vincent confirmed the production key
was saved in Vercel, but a fresh deployment is still needed to load it.

**2026-09-22 — My Tasks' per-person scope widened past AR Reminder + Late
Filing for the first time since 2026-08-31 (INV-DATA-057).** Vincent, on a
real screenshot of the still-v1 page: "现在这部分那么简陋，根本都称不上是
提醒". Added SOA collections owed (attributed via the exact same
`effectiveOwner()` the SOA pages themselves show) and Trademark renewals
due within 180 days (attributed via `companies.pic`/`sec_pic`, the same
join Late Filing's own PIC fallback already uses) — both reuse existing,
already-tested rules, nothing invented. Nominee Director subrole review and
Client Communications drafts are still NOT included — neither has an
equally clean existing attribution rule or "needs attention" threshold; a
real decision from Vincent is still needed before either can be added the
same way (what makes an ND review "whose job", how long an unsent draft
should sit before it counts as overdue). Same change fixed 2 unrelated real
bugs found in the same file: the "Today's Priority" banner and its
rule-based fallback were hardcoded English in an otherwise all-Chinese
page, and the Claude-generated version of that banner was still running on
`claude-haiku-4-5-20251001` — the exact model INV-DATA-047 already
diagnosed elsewhere as producing degraded replies — never updated when
`app/api/assistant/route.ts`'s own `ASSISTANT_MODEL` moved to Sonnet on
2026-09-10; now shares that same env var on purpose. Also added
`preferredRegion = 'sin1'` to `/api/my-tasks` (INV-PERF-001), which had
none even before this change. Verified against real data for 2 real staff
accounts (33 and 1 real SOA collections respectively, correctly attributed)
— `npx tsc --noEmit` and `npm run build` both clean. **Not yet exercised by
a real browser login** — same caveat as most of this session's other
AI-assistant work.

**2026-09-22 — the reply-scanning "false capability denial" guard family
generalized, plus a real structural gap closed (INV-AI-004).** Prompted by
Vincent's own review of this AI Agent/My Tasks area ("我还是觉得少一些东
西"): the 3 existing guards (INV-DATA-022/023) each exist because Vincent
found one specific fabricated "I can't do X" reply after the fact, for one
specific feature. Added a 4th, generic backstop
(`claimsGenericCapabilityDenial`, `app/api/assistant/route.ts`) that catches
a NEW denial-shaped reply for a capability none of the three name, using a
structural signal (zero tools called that turn) instead of predicting its
exact wording — verified it would have caught all 3 real historical
incidents on this signal alone, plus 6 new cases, `test-reply-guards.ts`,
20/20 passing. Same change fixed a real latent gap found while doing this
(not yet observed misfiring in production, but structurally certain to):
the guard chain used to run inside `claudeAnswer()` on its own draft, before
`POST()`'s `claude_then_openai` route could still feed that text into
OpenAI's `synthesizeWithOpenAI()` for a free rewrite — meaning OpenAI's
"improve clarity" pass could silently drop the ⚠️ warning banner or
introduce its own fresh denial claim, unguarded either way. Moved to a
single `applyCapabilityGuards()` call in `POST()` on whichever text is
actually about to be shown, whichever engine produced it. `npx tsc --noEmit`
and `npm run build` both clean. **Not yet exercised against a real live
conversation** — same "code-complete, verified via diagnostic script, not
yet a real click-through" caveat as everything else in this section; the
next real My Tasks/AssistantWidget chat session is the first real test.

**2026-09-28 — the assistant can now answer from the secretarial team's
own SOP (`get_sop_guide`, INV-AI-008), process/document parts only.**
Held back until the team confirms the figures (listed in
`lib/client-comms-sop.ts`'s `PENDING_REVIEW`; the assistant says these are
"not confirmed yet" instead of quoting a number): DPO section, director
contact/alternate address, share-capital amounts/deadline/example,
first-FYE advice, tax exemption/ECI, filing-deadline table, audit/XBRL, AR
follow-up/overdue scripts with the penalty, dormant relevant company, ND
fee/interest clause, and the standard "公司什么时候年检" answer. Also
waiting on the colleague: one payment-chasing script had an unclear word
("还麻烦您这集团安排…", dropped). Not yet exercised in a live chat; like
every Claude-path My Tasks answer it needs Anthropic credit.

**2026-09-28 — My Tasks was on the keyword fallback 2026-09-23 → 09-28
(Anthropic credit, then the org's self-set monthly spend limit; Vincent
raised it, Claude answering again from 16:32 SGT).** If the generic
"我可以帮你: 查公司…" menu comes back, the real API error is in
`ai_agent_runs.error`. OpenAI is not a failover for Claude-path turns.
The assistant's system map (`lib/assistant-pages.ts`, INV-AI-009) now
covers every real page, each with a one-line description and the same
access gate the page enforces; `test-assistant-pages.ts` fails when a new
page ships without an entry. The keyword fallback engine's static help
texts (`FAQ`, `currentPageHelp()`) were not rewritten — only its page
navigation uses the full map.

## Known risks (not bugs — things worth remembering before relying on data)

- **A QuickBooks customer name that ABBREVIATES a word is not linked to its
  company** (found 2026-10-06). Q&E SMART HOME SYSTEM AND ELECTRICAL ENGINEERING
  PTE.LTD. ↔ QuickBooks "Q&E Smart Home System & Electrical Engrg Pte Ltd" scores
  67, below the 70 line billing and SOA use, so that client's invoices do not
  attach there (nor on Company 360, which needs 85). The "and" vs "&" cases
  (ACG, Gary & Seven) were fixed the same day (INV-DATA-076); abbreviations are
  a different matching problem. Quickest remedy for this one client: make the
  QuickBooks customer name and the company name agree. SOON & GUAN MANPOWER
  TRAINING ↔ "…Trading" (75) stays a near miss on purpose — Company 360 names
  it in its yellow warning, and a person decides whether it is the same company.

- **Automation Health reads only the newest 120 `automation_sync_runs`
  rows across ALL sources** (`app/api/automation/health/route.ts`).
  `quickbooks` alone writes about 30 a day (webhook and manual syncs — 240
  in the 8 days to 2026-10-05), so the window reaches back only about 3
  days (on 2026-10-05 its oldest row was from 2026-10-02 03:46). The weekly
  `reports_narrative` (Sundays) drops out of it by mid-week and then shows
  `attention` with no run, although it ran — its `STALE_HOURS` override
  can't help a run the query never fetched; on a heavy day (77 rows on
  2026-10-02) a daily source could do the same. Found 2026-10-05 while
  checking the AI quality cron, not fixed: reading each source's own
  latest run instead of one shared 120-row slice would fix it.
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

- **2026-09-22 — Vincent's own "AI Agent/My Tasks 少一些东西" review queue,
  being worked one item at a time ("一个一个优化").** 6 gaps identified;
  #1 shipped same day (see `PROJECT_STATUS.md`'s dated entry, INV-AI-004 —
  the generic capability-denial guard backstop). Remaining 5, in the order
  proposed to Vincent:
  1. **Verification backlog** — this file already lists 7-8 separate
     "code-complete, `tsc`/build clean, never actually clicked through"
     write paths scattered across this section (floating widget drag/
     resize, deep-link auto-open, the 3 agentic-chat phase-2-4 actions,
     agentic invoicing step 2, View-As-for-chat). Needs a real consolidated
     checklist plus Vincent (or a designated staff account) actually
     clicking through each one — not something that can be verified by
     reading code.
  2. Done — see the INV-AI-004 entry above.
  3. **No proactive/outbound channel** — My Tasks is 100% pull: nothing
     reminds a staff member who simply never opens the page that day. No
     email digest, WeChat Work, or Telegram push exists. Needs Vincent to
     decide a channel before this can be built.
  4. **Mostly done, 2026-09-22 — see INV-AI-005.** Every chat-confirmed
     write now logs a `chat_`-prefixed, page-distinct `logActivity()` event
     carrying the real `conversationId` (fixed a real name COLLISION —
     `LateFilingResolveCard` and the Late Filing page's own manual resolve
     both used to log identical `'late_filing_resolve'` — and closed 2 real
     silent gaps, `InvoiceEditCard`/`PostIncorporateCard`, which logged
     nothing at all before). **Still explicitly NOT covered**: real
     QuickBooks invoice creation (`InvoiceDraftCard`) and real TAO invoice
     creation (`TaoBillingCard`) only get an "opened from chat" signal, not
     a "really generated, and it was chat-originated" one — both route
     through the same shared, reused, real-money editor modal
     (`BillingDraftsModal`/`TaoBuilderModal`) every MANUAL invoice also
     goes through, and giving the real generate-success event a chat-origin
     tag means threading that into this shared code path carefully, as its
     own change — deliberately deferred, not silently skipped.
  5. **`search_documents`/NAS document search is a dead entry point** —
     already covered under Active issues above (migration not run, secret
     not set, indexing script not written, machine not designated).
  6. **Built 2026-09-22 — see INV-AI-006; has never actually run (see
     Active issues, 2026-10-05).** Vincent chose "自动LLM抽查判分".
     Daily cron (`0 23 * * *`) + a manual "立即抽查" button on the new
     `/ai-quality` page sample real recent replies and have Claude judge
     each against a fixed rubric, writing every verdict to
     `ai_quality_reviews` (migration `scripts/add-ai-quality-reviews.sql`,
     **not yet run in production**). A human (Vincent) can mark a flagged
     row confirmed-issue or false-positive from the page. **Honest scope,
     not yet fully realized**: the judge can only see the reply's text and
     which tools were called, never what those tools actually returned
     (never persisted) — so it catches behavioral defects (a capability
     denial, a confident claim from a zero-tool turn), not factual errors
     like a wrong dollar figure. A real ground-truth checker would need the
     judge to re-run the same tools itself — a bigger follow-up, not
     attempted here. Not yet exercised against real production traffic —
     same "code-complete, not yet a real click-through" caveat as
     everything else in this section; needs the migration run, then a real
     day or two of the cron actually firing.
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
  before it takes effect in production); (2) ~~no dedicated audit trail
  distinguishing "AI proposed this draft" from "human clicked confirm"~~ —
  mostly fixed 2026-09-22, see INV-AI-005 and the Pending improvements entry
  below; for THIS specific card it's still only "opened from chat", not
  "really generated" — see INV-AI-005's own note on why. (This paragraph
  also predates `GenerateConfirmModal`'s later removal — `InvoiceDraftCard`
  now opens the real `BillingDraftsModal` editor instead of its own simplified
  confirm dialog; not rewritten here to stay in scope.)
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
