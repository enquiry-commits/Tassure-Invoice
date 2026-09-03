# TASSURE Invoice - Shared Project Status

Last updated: 2026-09-03 (Company 360 header layout, take two — Vincent came back with an exact row spec: row 1 UEN/Status/Client Type/Company Type/FYE/Secretary PIC, row 2 Customer Source/Contact/Invoice Address, row 3 SSIC Primary/Secondary. The previous fix (moving SSIC later in DOM order within one flat auto-fit grid) only worked by coincidence of how many items fit per line at a given viewport width — not a real guarantee, and Customer Source/Contact were in the wrong relative order for his spec anyway. Restructured `app/companies/[id]/page.tsx`'s header card into three explicit row `<div>`s, each its own `repeat(auto-fit,minmax(180px,1fr))` grid, so the grouping holds regardless of window width instead of depending on wrapping. Parent Company (conditional) placed in row 1 with the other identity fields; Tel (conditional) placed in row 2 with the other contact fields — neither was in Vincent's list since both are conditional/uncommon, but this is the natural grouping for them. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-03 (Company 360 header layout — moved SSIC to its own row, same day as the SSIC fix below. After Vincent confirmed the SQL migration and a manual one-off sync got real SSIC data showing for BAO FORTUNE SHIPPING, he looked at the real result and asked to move it: "SSIC 可以放在第3行" — SSIC's descriptions run long ("SHIPPING COMPANIES, INCLUDING CHARTERING OF SHIPS AND BOATS WITH CREW (FREIGHT)"), and mixed into the same auto-fit grid row as short fields (UEN/Status/FYE/etc.) it forced that whole row taller and looked cramped, visible in his own screenshot. Moved both SSIC fields (`app/companies/[id]/page.tsx`) to the end of the header card's field list, after Contact/Customer Source/Invoice Address/Tel — since the grid is a plain CSS auto-fit flow (no explicit row assignment anywhere in this codebase), moving them later in DOM order is what pushes them into their own row without adding a new layout mechanism; gave each `gridColumn: 'span 2'`, same treatment Invoice Address already gets, so the long text has room. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-03 (Fixed a silent-failure bug in the SSIC write path, found because Vincent asked directly why a real company's Company 360 still showed no SSIC ("目前SSIC 还没有出来吗？"). Investigated before answering rather than guessing: confirmed live that `companies.ssic_code_1` **does not exist in production at all** — Vincent had run the customer_source and trademark-remarks SQL scripts but not `scripts/add-companies-ssic-fields.sql` — and, separately, that `teamwork/sync-secretary` HAD already run successfully several times since the SSIC code shipped (most recently 2026-09-03 03:16-03:20 UTC). That combination exposed a real bug in the SSIC-writing loop added earlier today (`app/api/teamwork/sync-secretary/route.ts`): it never checked the `.update()` call's own `error`, so every write against a nonexistent column failed with "column companies.ssic_code_1 does not exist" completely silently — `ssicUpdated` kept incrementing regardless, meaning the route's own response would have claimed success while writing nothing at all for every company, every run, since it shipped. Fixed to actually check and count `error`, added `ssic_write_errors`/`ssic_first_error` to the response so a future version of this exact failure mode (wrong column name, permissions, anything) is visible immediately instead of silently eating writes. Acknowledged directly to Vincent rather than deflecting — this was a real gap in my own verification (I confirmed the extractor against real HTML before shipping, but never confirmed an end-to-end write actually landed in production afterward). `npx tsc --noEmit` and `npm run build` both clean. **Still needs**: Vincent to run `scripts/add-companies-ssic-fields.sql` (not yet done, confirmed live), then either wait for the next `teamwork/sync-secretary` cron or trigger one manually, then re-check a real company (e.g. BAO FORTUNE SHIPPING (G) PTE. LTD., the one in his screenshot) to confirm SSIC actually lands this time.)

Previous update: 2026-09-03 (Trademark — added a Remarks field + a visual marker, same day as the Late Filing PIC column below. Vincent: "Trademark 那边也是要有一个备注，就是ADD MANUAL 那边，因为有一些不是我们的客户，我们可以手动备注，然后在master list 那边有一个小标记" — some manually-added trademark records aren't actually for a Tassure client (added for reference only), and he wants a way to note that plus a small marker visible on the table. Checked the existing schema first: `trademark_records` already had an `updates_note` field, but it's In Progress-only and serves a different purpose (filing-progress updates, not a general note) — confirmed via `components/TrademarkTable.tsx`'s own `CATEGORY_COLUMNS` that Master Records has no free-text field at all. New `remarks` column (`scripts/add-trademark-records-remarks.sql`), added to `EDITABLE_FIELDS` in `app/api/trademark/route.ts` (its existing generic field-iteration loop in POST already picks up any `EDITABLE_FIELDS` member present in the request body, so the manual-add flow needed no separate change there), and to `CATEGORY_COLUMNS` for BOTH `master` and `in_progress` — the only column shared by both, on purpose, since Vincent's ask wasn't category-specific. Small marker: a `StickyNote` icon rendered next to the company name (not just relying on the Remarks column, which can be scrolled past) whenever a row's `remarks` is set, tooltip showing the actual note text — "master list 那边" turned out to mean the Trademark page itself (it lives under Master List in the sidebar, confirmed via the breadcrumb "Dashboard › Master List › Trademark › {title}" already in this component), not a separate list elsewhere. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-03 (Late Filing — added a Secretary PIC column, same day as the SSIC work below. Vincent asked directly: "Late Filing 那边也是要加上 PIC 的列 秘书部门的PIC为了方便知道是谁负责的". `app/api/late-filing/route.ts`'s GET handler already groups `ar_reminder` rows by `entity_name` to detect late filers, but never selected `pic` at all — added it to the existing select and to `ArGroup`'s per-year shape, then read it off the specific outstanding year (`lateFy.pic`), not just the entity's latest row, so the PIC shown matches the actual overdue cycle. Deliberately read-only, live from `ar_reminder`, not stored on `late_filing_companies` and not editable from this page — same treatment every other date field on this row already gets, and keeps PIC owned in exactly one place (AR Reminder) rather than risking two copies drifting apart. `app/late-filing/page.tsx` adds the column between "Late FY" and "Last AR Date", through `formatStaffName()` (not shown raw) — confirmed necessary via a real data check, not assumed: real `ar_reminder.pic` values are often short aliases ("Shemin", "Jenny", "Shi Ming"), not full names. **Verified against real production data**: confirmed `pic` is populated on 871/908 (96%) of all `ar_reminder` rows generally; the 25 rows currently overdue-and-unfiled specifically all happen to have an empty (not null) `pic` today — a real, plausible correlation (chronically-overdue companies may be exactly the ones with no assigned PIC), not a bug — so the column will show real names for the normal case and "—" for these until someone assigns them, not silently blank across the board. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-03 (SSIC scraper shipped — the "phase 2" work flagged as pending in the Reports entry below, done same day after Vincent separately asked for it on Company 360 too ("这个SSIC也可以加到 360里面"). Investigated the real HTML before writing any regex, per this codebase's own established discipline for `lib/teamwork-company-profile.ts` (every existing extractor there was "verified against a live fetch of a real company before writing this") — used a one-off diagnostic script (Playwright login + raw HTTP fetch, deleted after use) to capture real company-profile HTML and confirm the "Principal Activities" table's actual markup, rather than guessing a selector from Vincent's earlier screenshot alone. **Caught two real bugs this way, before shipping, not after**: (1) TeamWork's own template reuses the exact CSS class `tble principal_activities` for an UNRELATED PIC/Group/Holding-Company/Team table elsewhere on the same page — a real company's page had 3 occurrences of that class string, and a naive class-only selector silently grabbed the wrong table's content (a real name, "Hoe Chyi Lim", ended up in the "SSIC code" field during testing). Fixed by anchoring the search to start after the real "Principal Activities" heading text, the exact same defensive pattern `extractOfficials` already uses in this same file for its own class collision — new `INV-TW-016`. (2) A 15-real-company spot check turned up one company with Activity I's `code` blank but Activity II's populated (and Activity I's own `remarks` non-empty) — the originally-planned "skip write unless code1 is present" rule would have silently discarded a company that genuinely has real SSIC data on file; changed to `code1 OR code2` — new `INV-TW-017`. New `extractSsic()` in `lib/teamwork-company-profile.ts` (wired into the existing `fetchCompanyProfileFull`, no new TeamWork request — same profile-page fetch already made nightly for Secretary/Officials/Shareholders), writes straight onto 6 new `companies.ssic_code_1/description_1/remarks_1` + `_2` columns (`scripts/add-companies-ssic-fields.sql`) from `app/api/teamwork/sync-secretary/route.ts`, non-destructively (only writes when the scrape found at least one real code — never blanks a previously-good value on a bad fetch). Surfaced on Company 360's header card (`app/companies/[id]/page.tsx`) right next to Company Type, and wired into `lib/company-360.ts`'s existing type/mapping. Reports' phase-2 SSIC donut and the `data/ssic-codes.json` reference table (already saved 2026-09-03, still unused) are NOT part of this change — this ships the raw per-company data only; the code→category rollup for a meaningful chart is still pending. `npx tsc --noEmit` and `npm run build` both clean. `docs/INVARIANTS.md` gained INV-TW-016/017; `docs/FEATURE_MAP.md`'s Company 360 row updated. **Still needs**: Vincent to run `scripts/add-companies-ssic-fields.sql` in Supabase before this does anything in production (same as the customer_source migration earlier today), and a real nightly `teamwork/sync-secretary` run (or a manual trigger) before any company actually shows SSIC on Company 360.)

Previous update: 2026-09-03 (Company 360 — Officials & Shareholders, same day as the Reports phase 1 entry below. Vincent asked whether director/shareholder/paid-up-capital data was already being captured from TeamWork and just not shown ("我不确定你之前在读取TW的时候是否都有记录"). Investigated before answering: it was — `teamwork_company_officials` (Director/Secretary/Controller/Representative/Contact Person, with ID info/address/appointment date/DOB/email/mobile/telephone) and `teamwork_shareholder_shares` (the real share register, including `paid_up_capital`) have both been synced nightly by the existing `teamwork/sync-secretary` cron for a while already — they just feed Post Incorporate's own UEN lookup (`app/api/post-incorporate/enrich/route.ts`) and were never surfaced on Company 360. No new scraping needed, unlike the still-pending SSIC work below — this was purely "wire up data that already exists." Confirmed Vincent wanted the full picture (both officials and shareholders, not a trimmed subset) via `AskUserQuestion`. Added two new queries to `lib/company-360.ts`'s existing parallel batch (matched by exact UEN via `.ilike('uen', uen)`, the same pattern `enrich/route.ts` already uses — no fuzzy company-name matching needed here, unlike most of this file's other sections, since both tables store the real registration number directly), a new `Officials`/`Shareholders` section pair in `app/companies/[id]/_components.tsx` (matching every other section's `DataCard`+percentage-colgroup convention exactly), wired into the page right after the header card, before AR/AGM cycles — this is foundational company-identity data, ahead of the operational sections. **Verified against real production data before calling it done**, not just build-clean: a one-off diagnostic script (deleted after use) confirmed the UEN join returns real rows for 5 real active companies (5-22 officials, 0-5 shareholders each — the one 0-shareholder company is a "Limited" guarantee company, which correctly has no share capital), and confirmed 6,647 official rows / 1,254 shareholder rows exist in production total. `npx tsc --noEmit` and `npm run build` both clean. `docs/FEATURE_MAP.md`'s Company 360 row updated with the two new tables.)

Previous update: 2026-09-03 (Shipped Reports phase 1 — customer-profile analytics for leadership. Vincent asked for a new top-level "Reports" nav item below My Tasks, gated to himself + Cindy/Samuell/Tan Yee Soon, analyzing customer source, customer type (SSIC), customer flow, and asked what else was worth adding, plus year-over-year trends and potential-customer direction. Investigated real data availability before designing anything (Explore agents on nav/permission/chart patterns and on real schema) rather than assuming the ask was fully buildable as stated: confirmed **SSIC industry data does not exist anywhere in this codebase** — not on `companies`, not in any TeamWork sync payload (`TwCompany` interface has no such field), not persisted anywhere Post Incorporate's Bizfile-derived "Primary/Secondary Activity" fields touch (confirmed live: not even saved to `post_incorporate_operations.form_data`) — and that `master_list.referral` (the closest existing "customer source" field) is ~99% empty and, where filled, holds a person's name, not a channel category. Vincent confirmed via `AskUserQuestion`: build the SSIC scraper now (needs him to confirm exactly where on TeamWork's UI it lives — he then sent a real screenshot of a company's TeamWork profile page's "Principal Activities" section, confirmed it's a genuine TeamWork page, not Bizfile), and add a real data-entry field for customer source (not reuse the broken `referral` field). **Phase 1 shipped this session** (real, already-clean data only): new `ApprovedAccount.canViewReports` flag (`lib/approved-accounts.ts`) — deliberately separate from `canViewAsOthers` even though today's 4 grantees are identical, same "don't conflate unrelated permissions" principle as that flag's own comment states; `app/api/auth/me/route.ts`/`components/AppShell.tsx`/`components/Sidebar.tsx` (new `REPORTS_NODE`, spliced in right after My Tasks via a robust href-lookup rather than a hardcoded array index) wire it through; `app/reports/page.tsx` follows Appearance Settings' client-side-guard-plus-server-403 pattern (the only other named-people-only page in this app — no `proxy.ts` precedent for this shape of gating, so none added). New `app/api/reports/route.ts` aggregates real data the exact way `app/api/dashboard/route.ts` already does (`pageAll()` + in-memory grouping, `Pt[]`-shaped series feeding `components/dashboard/Charts.tsx`'s existing `Donut`/`VBars`/`HBars` unchanged): active-client KPIs, client type by legal entity structure (`company_type` — explicitly labeled as NOT SSIC in the UI, to avoid confusion once the real SSIC chart lands), service mix, client flow (new via `master_list.join_date`, churned via `.update_date` on Terminated/Strike Off rows — both explicitly caveated in the UI as staff-typed free text in inconsistent date formats, not a guaranteed field, backed by a best-effort multi-format date parser), revenue/invoice-volume trend from `quickbooks_invoices`, and staff workload from `ar_reminder`'s existing PIC fields (reusing My Tasks' own "open cycle" logic, no new attribution mechanism). New `companies.customer_source` column (`scripts/add-companies-customer-source.sql`) + fixed-taxonomy dropdown (`lib/customer-source.ts` — deliberately closed-list, not free text, to not repeat `referral`'s failure) editable from Company 360 (`app/companies/[id]/CustomerSourceField.tsx`, `app/api/companies/customer-source/route.ts`) — Company 360's first editable field. "Potential Customer Direction" shipped as an honest placeholder explaining why it's empty (no prospect/lead data exists anywhere) rather than faking a section. Also received and safely archived Vincent's official SSIC 2026 code-list PDF for the still-pending phase 2: extracted all 988 code/EN/ZH entries **programmatically via PyMuPDF** (not hand-transcribed from the rendered PDF, to eliminate transcription-error risk on official codes) into `data/ssic-codes.json`, cross-verified against two entries the PDF's own rendering shows as genuinely garbled Chinese text (font-embedding defects in Vincent's source PDF itself, confirmed reproduced faithfully rather than "fixed" by guessing) — this data is not yet wired into any feature, just durably saved so phase 2 doesn't need to re-parse the PDF. `npx tsc --noEmit` and `npm run build` both clean; `/reports`, `/api/reports`, `/api/companies/customer-source` all confirmed registered in the build output. `docs/FEATURE_MAP.md`/`docs/REGRESSION_CHECKLIST.md` (new REG-016) updated. **Not yet done**: SSIC scraper itself (phase 2, needs `lib/teamwork-company-profile.ts` extended, `companies.ssic_code_1/2` columns, and the industry-grouping logic on top of the now-saved reference data), "Potential Customer Direction" real content, and a real post-deploy login check by one of the 4 gated accounts.)

Previous update: 2026-09-02 (Fixed a real regression from the View-As-extension commit earlier today — Vincent noticed his own My Tasks "View as" picker had disappeared and asked directly ("Vincent 作为最大的admin 为什么 My Tasks 的功能不见了"). Root cause, found immediately: when extending the View-As permission to Cindy/Samuell/Yee Soon, the gate in `app/api/my-tasks/route.ts` was switched from `realAccount.admin` to the new, separate `realAccount.canViewAsOthers` flag (`lib/approved-accounts.ts`) — correct in principle (keeps it independent from Appearance Settings access), but Vincent's own `APPROVED_ACCOUNTS` entry only ever had `admin: true`, never `canViewAsOthers: true` — he'd been relying on the old `admin`-based gate for his own access, so switching the gate silently took the feature away from the one person who originally asked for it and used it daily. A real violation of this repo's own standing rule (never narrow existing behavior as a side effect of an unrelated change) — acknowledged directly rather than deflected. Fix: added `canViewAsOthers: true` to Vincent's own entry alongside his existing `admin: true`. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 (Extended My Tasks' "View as" beyond Vincent alone, same day as the entry below that first shipped it — Vincent asked directly: "这个权限你也开放给 cindy/ samuell / yee soon". The original ship gated the picker on the existing `admin` flag, reasoning at the time that `admin` currently belongs to Vincent alone so it had the right effect — that reasoning stopped holding the moment more than one person needed the permission, since `admin` also gates Appearance Settings editing (`app/admin/appearance`), explicitly scoped to Vincent only by an earlier decision; reusing it here would have silently handed Cindy/Samuell/Yee Soon that unrelated permission too. Introduced a new, separate `canViewAsOthers?: boolean` field on `ApprovedAccount` (`lib/approved-accounts.ts`) instead, with a comment explaining why it's kept apart from `admin` — grant exactly what was asked, nothing implied. `app/api/my-tasks/route.ts`'s `?viewAs=` gate (both the 403 check and whether `viewableAccounts` is included in the response) switched from `realAccount.admin` to `realAccount.canViewAsOthers`; `app/my-tasks/page.tsx`'s comments updated to match (no functional change there — the client always gated on the server-controlled `viewableAccounts` field being present, never on `user.admin` directly). Set `canViewAsOthers: true` on Cindy Zhang and Samuell Ng's existing entries. Yee Soon turned out to have no login account at all — only present in `lib/staff-directory.ts` (the broader PIC-matching directory, not a login list) as "Tan Yee Soon" / `yeesoon@tassure.com`; did not assume that email was correct for a real login and asked Vincent to confirm first rather than guessing — he confirmed "准确是 Tan Yee Soon (yeesoon@tassure.com)". Added a brand-new `APPROVED_ACCOUNTS` entry for them with that name/email and `canViewAsOthers: true`, unrestricted (same full-access shape as Cindy/Samuell, matching how the request grouped all three together). `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 ("View as" added to My Tasks, same day as the Company 360 fixes below — Vincent, looking at his own My Tasks page (all zeros, since he as admin has no real PIC assignments), asked to be able to see what OTHER staff members' My Tasks looks like, explicitly scoped to himself only ("希望可以从这边看到不同权限的人看到的内容是什么...一个DEMO只开放给我一个人vincent@tassure.com看"), to tune the feature. Gated on the existing `admin` flag (`lib/approved-accounts.ts`) rather than hardcoding his email — `admin` currently belongs to Vincent alone, so this has the exact effect requested today, but stays correct if that ever changes, matching how `admin` already gates Appearance Settings elsewhere in this app. `app/api/my-tasks/route.ts`: a new `?viewAs=<email>` param, checked server-side (not just hidden in the UI) — a non-admin real account passing it gets a real 403, since this is a genuine permission boundary (seeing another named person's PIC assignments), not a display preference. The whole computation (PIC matching, `arOnly` scope) already ran against a single `account` variable, so impersonation was a matter of swapping which `ApprovedAccount` that variable points to — the real account (`realAccount`) is used ONLY for the admin check and to decide whether to include the account picker list at all; everywhere else already correctly used the (possibly swapped) `account`, verified directly by grep before shipping. Response gained `viewingAs`/`viewableAccounts` (the latter only ever sent to an admin viewer, full stop, regardless of whose tasks are being shown). `app/my-tasks/page.tsx`: a "View as" `<select>` (only rendered when the response actually included `viewableAccounts` — never trust a client-side admin flag alone for showing sensitive UI) and an amber "Viewing as X — this is a preview, not your own tasks" banner so the impersonated view can never be mistaken for a real session; deliberately not persisted anywhere (resets to "Me" on reload) since this is a one-off inspection tool. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 (Company 360 table proportions, same day as the invoice-source-labeling fix below — adding the new Source column to the Invoices section's system-generated table (previous entry) reintroduced the exact class of misalignment fixed earlier the same day, since only that one table's colgroup was updated and the stacked QuickBooks table below it wasn't touched to match. Vincent caught it immediately ("水平垂直又不整齐了") and separately flagged the fixed-pixel-width approach itself as feeling cramped with everything piled on the left ("有点太挤了，全部都堆在了左边") — correct: a `<colgroup>` of fixed pixel widths summing to well under the container's real width leaves the unclaimed remainder entirely on whichever column has no explicit width, rather than distributing it. Converted every `<colgroup>` in `app/companies/[id]/_components.tsx` (all 7 tables) from fixed pixels to percentages summing to 100% per table, so each table's own columns always fill its container evenly with no dead space regardless of actual rendered width — and, critically, the two stacked Invoice sub-tables (system-generated + QuickBooks) now share the exact same percentages for their common first 4 columns (Invoice No./Company/date-ish/Amount), so they align as one visual grid again despite still being genuinely separate `<table>` elements with different total column counts. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 (Company 360 invoice-source labeling, same day as the load-speed fix below — Vincent noticed a 2024-dated invoice under "Generated by this system" for BAO FORTUNE SHIPPING (G) PTE. LTD. and asked why ("为什么会有在2024年在系统的开单记录"). Investigated with real data before answering: confirmed the specific invoice (`02410879`) is genuine — the `quickbooks_invoices` mirror shows the same invoice, same $1060 amount, same 2024-08-26 transaction date, status Paid — not a data error. But `generated_invoices.created_by_email`/`idempotency_key` were both null on that row, which a row genuinely created through this app's own invoice-generation flow always has (`app/api/quickbooks/create-invoice/route.ts`'s own upsert convention). Queried the full table: **845 rows** have `created_by_email = null`, **89** have it set, with a clean, sharp cutover — the latest null-creator row is 2026-07-16, the earliest real-creator row is 2026-07-17 — almost certainly this feature's real go-live date. The 845 are a one-time historical backfill seeding real QuickBooks history before the live feature existed, not literally "generated by this system." Fixed the label rather than just explaining it once: `app/companies/[id]/_components.tsx`'s Invoices section header changed from the overclaiming "Generated by this system" to "This system's invoice records," and added a per-row **Source** column — a green pill showing the real creator's name (new `nameForEmail()` export in `lib/staff-directory.ts`, the reverse of the existing `findStaffEmails()`/email→name direction, since `formatStaffName()` only resolves PIC-style name/alias text, not raw emails) for real app-generated rows, a muted "Imported (historical)" pill for backfilled ones. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 (Company 360 load speed, same day — Vincent asked directly whether clicking into a company could be made faster ("目前这部分的公司点进点的速度可以提升吗"). Investigated with real data before changing anything: checked the actual row counts of every table `getCompany360` (`lib/company-360.ts`) queries (largest is `quickbooks_invoices` at ~5,200 rows, `generated_invoices` ~930 — all small enough that full-table/ilike scans aren't themselves the bottleneck) and found three real, verifiable architectural issues instead. **(1) No region pin, Tokyo-hosted Supabase**: `app/companies/[id]/page.tsx` and `app/api/companies/[id]/route.ts` were the only Supabase-heavy routes in the app with no `preferredRegion` set — confirmed only the 5 TeamWork-scraping cron routes set `preferredRegion='sin1'` anywhere in this codebase (for latency to TeamWork's own servers), while every regular data API route, including this one, defaults to Vercel's standard region. Since `getCompany360` fires ~11 separate Supabase queries and Supabase itself is Tokyo-hosted, every one of those round-trips was crossing the Pacific from a non-Asia default region. Added `preferredRegion='sin1'` to both files. **(2) A real, avoidable sequential round-trip**: the AR/AGM fuzzy-match fallback query was a separate `await` fired AFTER the main `Promise.all` batch resolved, not inside it — adding one full extra Supabase round-trip to every single page load regardless of whether anything was actually found. Folded it into the same parallel batch (`ar_reminder` is a small table, ~900 rows, cheap to always include) — the exactIds-filtering and scoring logic that depends on the batch's OTHER results already runs safely after the batch resolves, since that part is pure in-memory computation, not a second fetch. **(3) Zero visual feedback on click**: this is the app's only server-rendered page (every other page is `'use client'` + `useEffect`, which shows its own loading state for free) — with no `loading.tsx`, the browser showed nothing at all for however long the fetch took, unlike every other page in the app. Added `app/companies/[id]/loading.tsx` (Next.js App Router's automatic Suspense-boundary convention) using the exact same "Loading…" style already established elsewhere (`app/companies/page.tsx`, `app/my-tasks/page.tsx`) — the click now gets instant feedback regardless of the underlying fetch time. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-09-02 (Company 360 match-confidence badge readability, same day as the table-alignment fix below — Vincent pointed at a real screenshot of the Invoices > QuickBooks history Status column showing "Paid~100"/"Open~100" concatenated with no separation and said it was unreadable/would confuse staff. Root cause: `MatchBadge` (`app/companies/[id]/_components.tsx`) rendered a fuzzy-match confidence score directly appended to the status text with no gap, and — worse — showed itself on literally every row, including a perfect 100/100 exact match, which carries zero actual signal (the whole point of this badge is to flag an UNCERTAIN match, per this same file's own INV-DOC-004-adjacent design intent from when Company 360 shipped 2026-08-31). Fixed by having `MatchBadge` return `null` outright for any score of 100 — most rows (exact matches) now show clean, unadorned status text exactly as before this feature existed — and, for the genuinely uncertain minority (score < 100), restyled it as a separated, visually distinct amber pill ("`87% match`" with `marginLeft`, its own background/border) instead of bare concatenated text, plus a fuller tooltip explaining what it means. Also relabeled the AR/AGM Cycles table's fuzzy-match indicator from the equally cryptic "~name" to "name match only" with matching pill styling, for the same reason. Along the way, re-hit and fixed the recurring Bash-tool cwd-reversion issue from earlier in this session (`tsc`/`build` briefly picked up an unrelated file under the home directory until re-run with an explicit `cd`). `npx tsc --noEmit` and `npm run build` both clean from the correct directory.)

Previous update: 2026-09-02 (Company 360 table alignment, same feature as the 2026-08-31 entries below — Vincent pointed at a real screenshot of the AR/AGM Cycles and Invoices sections and said the columns looked ragged/misaligned ("这些列的水平可以稍微整齐一点吗"). Root cause: `.system-list-table` (`app/globals.css`) sets `table-layout: fixed`, but none of `app/companies/[id]/_components.tsx`'s tables had a `<colgroup>` — with fixed layout and no explicit widths, each `<table>` independently divides its total width equally across however many columns IT has. The Invoices section renders two SEPARATE stacked tables ("Generated by this system" with 5 columns, "QuickBooks history" with 6) — dividing the same width by 5 vs 6 gave each table completely different column boundaries, which is the actual raggedness Vincent was seeing. Added explicit `<colgroup>` with fixed pixel widths to every table in the file (AR/AGM Cycles, both Invoice sub-tables, Nominee Director, Communications, Documents Generated, Trademark) — the two Invoice sub-tables specifically share identical widths for their common columns (Invoice No./Company/date-ish column/Amount) so they now line up as one visual grid despite still being two logically-separate tables. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-31 (Fixed a real, recurring TeamWork automation collision — Vincent flagged the Automation Health dashboard again with "TeamWork ND (Batch 1)" and "TeamWork Companies" both red, explicitly: "这个问题比想象中严重，最近一直触发" (more serious than expected, keeps triggering). This is a genuine recurrence of a class of problem already investigated and "considered fixed" on 2026-08-29 (see that day's own entry below) — treated the bar as real proof this time, not another declaration. Investigated with real data first: queried `automation_sync_runs` directly and programmatically detected genuine wall-clock overlaps between every Playwright-launching cron's actual `started_at`/`finished_at`, not inferred from error text. **Root cause 1 (primary, confirmed not guessed)**: on 2026-08-31, `teamwork_secretary` (19:05:03-19:09:09 UTC) and `teamwork_companies` (19:08:02-19:08:28) genuinely overlapped — both routes launch a real headless Chromium via `lib/teamwork-agm.ts`'s shared `getBrowser()`, and since the 2026-08-29 ND-batch redesign, THREE separate cron entries (ND batch 4 at `0 18`, Companies at `30 18`, Secretary's first run at `45 18`) had silently drifted into sharing the same Vercel Hobby-tier jitter hour (18) — a real gap the redesign never checked against routes OUTSIDE its own 4 ND batches. Companies failed with the exact recurring "Less than 64MB of free space" signature — a NEW failure mode (two different concurrent invocations colliding) the 2026-08-29 fix structurally cannot prevent (it only fixed one invocation launching twice). One honestly-flagged anomaly: Companies' real start (19:08) fell outside its own documented 18:00-18:59 jitter window entirely — unexplained, treated as evidence real-world jitter can occasionally exceed the documented bound, hence the retry safety net below, not scheduling alone. **Root cause 2 (secondary, unrelated)**: `teamwork_nd_1` failed the same day in isolation (no concurrent automation) with TeamWork API timeouts for 2 of its 4 people — the real ND roster grew to 14 (from the 13 the 4-batch design was built around), so `of=4` against 3 workers gave batches 1-2 FOUR people each, exceeding 1:1 worker capacity (exactly the INV-CRON-003 risk). Used Plan mode given the stakes and the fact a prior "definitive fix" in this same area already didn't hold: a Plan-agent validation pass (given full file reads, not just the investigation report) caught real issues in the first-draft fix — found an existing ad hoc retry (`getSessionCookieWithOneRetry`, used only by Companies) that needed replacing not stacking with; found the ND API-timeout "fix" I'd proposed (a 3rd retry attempt) was pointless since `scrapeMember()` already retries twice internally and the failure happened despite that — the real fix is rebalancing batch count, not more retries; and found a genuine dashboard blind spot (`teamwork_secretary` was a valid `AutomationSource` with real data but never surfaced on Automation Health anywhere — the exact route involved in the collision was invisible to "the early-warning system for every other automation"). **Fix 1 (re-spaced schedule)**: moved only the 3 colliding entries — Companies `30 18`→`0 13`, Secretary's first run `45 18`→`0 15`, added a 5th ND batch at `0 17` — every Playwright-launching cron entry now sits on its own distinct hour; verified against `app/api/teamwork/sync/route.ts`'s own comment that the whole chain "targets finishing by SGT 05:00, before business hours" to keep the new slots (SGT 21:00/23:00) consistent with that intent, not just avoiding exact-hour collisions. ND rebalanced from 4 to 5 batches (`app/api/teamwork/sync-nd/route.ts`'s `CRON_SCHEDULE_BATCH`/`batchSource`, `of: 4`→`5` everywhere) — with the real 14-person roster this gives batches of 3,3,3,3,2, every one at or under the 3-worker concurrency. New `teamwork_nd_5` source added everywhere `teamwork_nd_4` already was (`lib/automation-sync.ts`, `app/api/automation/health/route.ts`, `app/page.tsx`, `app/api/assistant/route.ts`, `app/nominee-directors/page.tsx`), and `teamwork_secretary` added to the same 3 dashboard-surfacing places to close the blind spot found during validation. **Fix 2 (retry-with-cleanup defense-in-depth)**: new `withPlaywrightRetry()` in `lib/playwright-tmp-cleanup.ts` — retries the WHOLE "acquire a working browser/session" unit (not just `launch()`, since the failure can plausibly surface at `newContext()`/`newPage()` too), re-runs the stale-profile cleanup before each retry, capped by both attempt count (3) and total elapsed time (75s, checked against every affected route's real `maxDuration=300`/self-deadline budgets so retries can never themselves cause a timeout). Applied uniformly in `lib/teamwork-agm.ts`'s `getSessionCookie()` (config-missing check kept outside the retry, since that can never succeed) and `lib/teamwork-nd.ts`'s new `acquireNdSession()` (self-contained, closes its own browser on a failed attempt so nothing leaks). Removed the old one-off `getSessionCookieWithOneRetry` from `app/api/teamwork/sync/route.ts` entirely — stacking it with the new inner retry would have meant up to 6 real launch attempts for that one route alone. **Fix 3**: raised `removeStalePlaywrightTempDirs`'s age cutoff from 2 to 6 minutes, re-derived from every route's real `maxDuration=300` ceiling instead of the now-disproven "cron schedules keep invocations an hour apart" assumption — real timeline evidence shows the OLD 2-minute cutoff plausibly caused Companies' own cleanup pass to delete Secretary's still-live profile mid-run (Secretary's profile was ~179s old, past the old cutoff, while Secretary was still running for another ~67s) — a highly plausible mechanism for the failure, not just a coincidence. Added `docs/INVARIANTS.md` INV-CRON-013/014 capturing both real lessons (schedule-spacing checks must be project-wide, not per-route-family; retry timeout math must derive from `maxDuration`, never schedule assumptions) plus `docs/REGRESSION_CHECKLIST.md` REG-015 and updated `docs/CURRENT_STATE.md`/`docs/FEATURE_MAP.md` to the new schedule. `npx tsc --noEmit` and `npm run build` both clean. **Explicitly NOT claiming this is confirmed fixed** — per the plan's own verification bar, given this exact class of problem was declared fixed once already and recurred 2 days later via a different mechanism: real confirmation needs 5-7 consecutive clean days checked directly against `automation_sync_runs` for wall-clock overlap between every pair of Playwright-launching sources, tracked in `docs/CURRENT_STATE.md`'s Active Issues until that window is actually observed.)

Previous update: 2026-08-31 (Made the Send review modal's Subject field editable, same day — grew out of a real investigation Vincent asked for: he questioned whether Billing's "sent date" auto-fills, which led to confirming (via real production data, not just code reading) that `app/api/client-communications/drafts/route.ts` already auto-writes AR Reminder's Remarks/Email Sent fields (`billing_remarks`/`accounts_status`) the instant a real send completes — 14 real rows confirmed via the `system:draft-send` audit stamp, all from 2026-08-27 onward; the messier legacy content Vincent screenshotted (e.g. "Dec 2026,AR 2025", "18/8 email" stamped `system:teamwork`) turned out to be pre-automation manual entries whose row-level `updated_by_email` stamp had later been overwritten by an unrelated field edit — a real, worth-remembering gotcha: `updated_by_email` is a whole-row stamp, not per-field, so it can misattribute which automation/person actually wrote a specific column's value once anything else on that row is touched afterward. Explained to Vincent why Chelsea's "I typed it myself" was likely a stale habit-memory, not a live bug: zero rows show her manually typing this pattern after 2026-08-27, while she's continued actively editing the same Remarks field daily for unrelated notes — a plausible, evidenced explanation, not confirmed with her directly. During this, Vincent separately asked to make the Send modal's Subject field editable (`components/client-communications/OutlookStyleSendModal.tsx`) — it was a plain read-only `<div>` showing `draft.subject` while To/Cc/Bcc/Body were already editable. Added `editedSubject` state (seeded from `prepared.draft.subject` post amount-refresh, matching how `editedBody` already does), wired it into the actual `sendDraftsInOutlook` payload (so an edited subject actually goes out, not just cosmetic), into `handleSend`'s post-send PATCH (`email_drafts.subject`), and into `handleClose`'s existing save-on-close mechanism (`subjectChanged` alongside the existing body/To/Cc checks) — matching the exact pattern already established for the other editable fields, not a new one. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-31 (Company 360 follow-up, same day — Vincent sent a screenshot of the "View 360" links stacked in their own column and asked for the whole row to be clickable instead, with a `>` chevron on the left so it's clear each row leads somewhere. This directly reverses the Plan agent's original recommendation to use a dedicated link cell instead of a whole-row click (no precedent existed anywhere in the app, and the row has selectable text like UEN/PIC) — Vincent's explicit call overrides that concern, so implemented exactly as asked rather than re-litigating the earlier tradeoff. `app/companies/page.tsx`: removed the "View 360" column entirely; added a new first `<col>`/`<th>` holding a `ChevronRight` icon; each `<tr>` now has `onClick`/`onKeyDown` (Enter/Space) navigating to `/companies/${c.id}` via `useRouter().push()`, plus `role="button"`/`tabIndex={0}`/`aria-label` for keyboard accessibility — matching the same pattern `components/MasterListTable.tsx`'s own row-click-to-open-details already uses elsewhere in this app, just newly applied here. Mobile's card (already a full-card `<Link>` from the original Company 360 change) needed no change — it already matched what Vincent asked for. Removed the now-unused `.company-360-link` CSS class. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-31 (Shipped two new features Vincent asked for directly ("那根据我们公司的业务，你觉得还有什么功能是可以添加的？" — what else could be built given the business) and then approved from a shortlist: **Company 360** (`/companies/[id]`) and **My Tasks** (`/my-tasks`); explicitly declined KYC ("要做KYC的前提是这个客户还不是我们的客户，我们并没有资料" — correct, no data exists for a prospect yet). Used Plan mode given the real scope (first page-level dynamic route in the app, a security-relevant `proxy.ts` change): 3 parallel Explore agents mapped real schema/join-keys, UI/nav patterns, and task-urgency logic; a Plan agent synthesized a design; every one of its most consequential claims (an `app/api/companies/route.ts` gap, `proxy.ts`'s exact gate text, `Sidebar.tsx`'s `level1For`, `MobileNav.tsx`'s real shape, `lib/request-account.ts`'s existence) was independently re-verified by direct file reads before finalizing the plan — all confirmed correct. Two real open questions were resolved with Vincent via `AskUserQuestion` rather than assumed: (1) discovered mid-research that Samuell Ng's login email (`lib/approved-accounts.ts`: `samuell@tassure.com`) disagreed with his PIC-matching email (`lib/staff-directory.ts`: `samuellng@tassure.com`) — confirmed `samuellng@tassure.com` is correct, fixed the TS file, and found (beyond the original ask) the same wrong email baked into two **live Supabase RLS realtime policies** — added `scripts/fix-samuell-ng-realtime-rls-email.sql` for Vincent to run himself; (2) whether the 6 AR-Reminder-restricted staff accounts get My Tasks — confirmed yes, filtered to their AR items only, matching the access they already have. **Company 360** (`lib/company-360.ts`'s `getCompany360`, shared by the page and `app/api/companies/[id]/route.ts`): aggregates `companies` + `master_list` + `ar_reminder` (dual company_id/uen check + fuzzy fallback, matching the existing pattern in `ar-reminder/generate/route.ts`) + `generated_invoices` + `quickbooks_invoices` (fuzzy, ilike-prefiltered + `matchScore>=85`) + `nd_appointments` + `email_drafts` (via the real `company_id` FK, INV-DOC-004) + `post_incorporate_operations` + `trademark_records` (fuzzy) into one page — every fuzzy-matched row carries its own `matchedVia`/`matchScore` so a surprising match is flagged, not silently presented as authoritative. Confirmed via direct schema research that most of these tables have NO real foreign key to a company at all, only `company_name` string matching — this shaped the whole design. `app/companies/page.tsx` got a "View 360" link (new column desktop, whole-card link mobile) plus the previously-missing `id` field it needed to link anywhere. **My Tasks** (`app/api/my-tasks/route.ts`): scoped to AR Reminder + Late Filing only for v1 — the only two areas with real per-person PIC data (confirmed via research that Nominee Director review, Client Communications drafts, and Trademark have no assignee column at all); reuses `findStaffEmails` (`lib/staff-directory.ts`, previously only used for CC resolution) to check `pic`/`acc_pic`/`tax_pic` against the logged-in user, and reuses the exact `daysUntilDue` formula already established in `app/api/ar-reminder/route.ts` rather than recomputing it. `proxy.ts` gained one exception clause so `/my-tasks` is reachable for restricted accounts (data narrowing happens inside the route itself, not the routing layer); `Sidebar.tsx`'s `level1For` now appends a My Tasks node for restricted accounts instead of returning only their one page. `npx tsc --noEmit` and `npm run build` both clean, both new routes (`/companies/[id]`, `/my-tasks`, and their API counterparts) confirmed registered in the build output. `docs/REGRESSION_CHECKLIST.md`/`docs/FEATURE_MAP.md` updated with the two new features per this repo's own standing rule to keep those current. **Update, same day**: Vincent ran `scripts/fix-samuell-ng-realtime-rls-email.sql` against Supabase — confirmed live (not just "ran without error") by having him separately run `SELECT tablename, policyname, qual FROM pg_policies WHERE tablename IN ('ar_reminder','master_list') AND policyname LIKE 'Authenticated users can receive%'` and see `samuellng@tassure.com` in the returned `qual` — this is the one piece of the whole change I genuinely could not verify myself (my own Supabase credentials are service-role, which bypasses RLS entirely, so I have no way to test a SELECT-policy's effect from here). Still not yet done: a real post-deploy login check of Company 360/My Tasks — tracked in `docs/CURRENT_STATE.md`'s Pending Improvements.)

Previous update: 2026-08-31 (Added `docs/CURRENT_STATE.md`, `docs/FEATURE_MAP.md`, `docs/REGRESSION_CHECKLIST.md`, same day as the INVARIANTS.md entry below. Vincent sent a third, much better-scoped governance package ("AI Coding Stability Lite Pack") explicitly built for a solo operator — its own README says outright not to build a full CI/staging/feature-flag platform, universal canonical-ID redesign, or an MCP/agent for everything "unless there is a concrete need," which is exactly the critique given on the two earlier, heavier packages. Assessed it against what already existed: its `INVARIANTS.md`/`DOMAIN_RULES_LITE.md` were redundant (already covered, more thoroughly, by the doc added earlier today), but three pieces were genuinely new and cheap — a concise **current-state snapshot** (distinct from this file, which is a permanent append-only log with no "what's open right now" view), a **Feature Map** (critical workflow → code/data/external-dependency table, plus a "high-risk shared logic" table and the real cron execution-order dependency chain), and a **Regression Checklist** (12 concrete manual checks tied to real past incidents, matching this project's actual verification style — no automated test suite exists, `package.json` has no `test` script). Vincent confirmed: "把值得做的执行." Built all three with real content (not templates) verified against the live system: queried `automation_sync_runs`/`automation_exceptions` directly for `docs/CURRENT_STATE.md`'s automation-health table (confirmed all 10 daily cron sources green, 3 open exceptions, all expected `teamwork_nd` data-content flags) rather than assuming; enumerated the real `app/`/`app/api/`/`lib/` structure for `docs/FEATURE_MAP.md` rather than reconstructing it from memory; each `REGRESSION_CHECKLIST.md` item cites the specific `docs/INVARIANTS.md` rule(s) it guards against. Named the new snapshot file `docs/CURRENT_STATE.md`, not `docs/PROJECT_STATUS.md` (the Lite pack's own suggested name) — deliberately avoided colliding with this file's name/identity, since the two serve opposite purposes (this file never gets rewritten; that one always should). Added 4 more rules to `CLAUDE.md`: don't invent status-transition/client-matching/reminder rules either (not just pricing), stop and explain rather than silently resolve a conflict with an invariant, run the matching regression checks after touching high-risk shared logic, and update `docs/CURRENT_STATE.md` too when a fix changes what's currently open. No app code changed, no build/typecheck needed (docs only).)

Previous update: 2026-08-31 (Added `docs/INVARIANTS.md`, same day as the EOT/Companies-verification entry below. Vincent sent two generic AI-governance template packages (an "AI Software Stability Foundation" kit and a much bigger "AI-native Company OS" architecture roadmap) with no instructions, asking what to do with them. Assessed both honestly rather than pitching adoption: the Company OS package is designed for a team with engineers/QA/CI and is not proportionate to a solo non-developer operator running Claude Code sessions — recommended treating it as reference only, not an execution plan. The Stability Foundation package's heavier machinery (full CI gates, staging environments, feature flags, a formal Test Matrix) has the same problem — confirmed `package.json` has no `test` script at all; this project's real verification method has always been "trigger the actual route against real data and check the real result," which has worked. But one specific piece was cheap and directly useful: the package's own `INVARIANTS.md` concept, applied to knowledge this project already paid for the hard way. Had an Explore agent read all 3771 lines of this file's own history end-to-end and extract every concrete, checkable business rule/gotcha (not generic advice) into `docs/INVARIANTS.md`, organized by category (TeamWork parsing, AR/AGM cycle logic, PIC assignment, recipient/CC rules, document generation, cron reliability, QuickBooks/invoicing, data integrity/concurrency, Draft Helper/Outlook COM) with an INV-ID per rule and a source citation back to the incident. This was previously scattered across dozens of long prose entries in this very file — useful but not quickly scannable before touching a risky area. Added a pointer to it in `CLAUDE.md`'s "before changing this repository" checklist (read it first when touching any of the listed risk areas) plus a few explicit red-line rules Vincent specifically wanted stated outright (never infer pricing logic, never silently rewrite historical data, never narrow existing behavior as a side effect) and a standing instruction to add new lessons to `docs/INVARIANTS.md` in the same change that fixes the bug — the actual point, so this stays a living document instead of a one-time snapshot. No code changed, no build/typecheck needed (docs only).)

Previous update: 2026-08-31 (Verified the TeamWork Companies `/tmp`-exhaustion fix against real production data (Vincent asked directly: "TeamWork Companies 所以这个问题处理好了？"), plus a small EOT visual tweak. **Verification**: the ND-batching half of the 2026-08-29 fix below had been extensively tested already, but the Companies half (eliminating the double Chromium launch) had only been verified by reading code, never by an actual post-deploy run — flagged that gap honestly instead of just answering "yes." Triggered a real `/api/teamwork/sync` against production (`tassure-corporate-services.vercel.app`, 100.8s, HTTP 200, `ok:true`, no disk-space warning, both `campaign_recipients`/`contact_person_fill_in` sections completed normally). More convincing than the manual run: queried the real `automation_sync_runs` history for `source='teamwork_companies'` directly — the two most recent entries are the ACTUAL daily cron firings (2026-08-29 18:33 and 2026-08-30 18:33 UTC, not manually triggered), both `status:'success'`, `error:null` — i.e. the same daily time window that showed red for two straight days pre-fix has now been green for two straight real days post-fix. Considered fixed. **EOT tweak**: Vincent sent a screenshot of the EOT table's AR/AGM Revised Due columns asking for a yellow background on the two date columns specifically, excluding the gray header row above them ("这两列的背景标记为黄色，但是不包括上方的灰色表头"). `components/EotTable.tsx`'s two `<td>` cells (`ar_revised_due_date`/`agm_revised_due_date`) now carry `background: '#fef3c7'` (the same amber-100 highlight color already used elsewhere in the app — `MasterListTable.tsx`'s terminated-badge/strike-off-banner, `QBConnectButton.tsx`) — the shared `<th>` header row loop (`COLUMNS.map`) was left completely untouched, so the header stays plain gray as asked. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-29 (Fixed two more-persistent-than-suspected Automation Health failures — "TeamWork ND" and "TeamWork Companies" had shown red for two straight days, and Vincent was explicit: "这两个东西已经连续出现两天了，我觉得是蛮严重的，需要确切的保证，不能有失误的部分" (two days straight, this is serious, I need a definitive guarantee, no room for error). Used Plan mode given the stakes — an Explore agent gathered real production data (`automation_sync_runs` history, real Chromium error output) and full code reads before anything was designed, a Plan agent then designed the fix, and I independently re-verified its two highest-risk claims directly against Vercel's real current docs (fetched live, not from training data) and Playwright's actual compiled source before trusting them — both checked out exactly. **TeamWork ND**: the 13-person roster's real scrape work had ALWAYS landed at 256-298s, even on OLD "successful" runs before yesterday's timeout-margin fix — dangerously close to Vercel's 300s hard kill (confirmed Hobby-tier, non-negotiable, via a real prior failed deployment elsewhere in this codebase). Split the daily cron into multiple smaller batches instead of re-tuning the timeout number a second time — `app/api/teamwork/sync-nd/route.ts` now reads which batch to run from the officially-documented `x-vercel-cron-schedule` header (confirmed word-for-word against Vercel's real docs), partitioning the roster **interleaved by position**, not a contiguous id range, so a handful of consistently-slow individuals (documented in `lib/teamwork-nd.ts`'s own comment) can't cluster into one batch by coincidence. **Started at 2 batches — real testing then disproved a core assumption**: one 7-person batch (containing 2-3 of the historically-slow people) still landed within ~40s of the 240s budget, and outright failed twice before that. Root cause, found by actually reading how the concurrency model works: 3 concurrent workers pick up people via work-stealing, so a 6-7 person batch can easily stack 2+ slow individuals SEQUENTIALLY onto one worker. **Redesigned to 4 batches** (mostly 3 people, one of 4) so, with exactly 3 people and 3 workers, everyone gets their own worker running in PARALLEL — confirmed live: a real 3-person batch containing WANG YIDONG (the single slowest individual seen all day, 79s alone) still finished the WHOLE batch in 104s, not the ~139s a sequential stack would produce. Batches now run at 4 non-adjacent hours (12:00/14:00/16:00/18:00 UTC) — confirmed directly against Vercel's docs that Hobby-tier cron jitter is *confined to the specified hour* ("`0 8 * * *` could trigger anytime between 08:00:00 and 08:59:59"), so non-adjacent hours give a real, guaranteed ~1h+ gap regardless of jitter, unlike a same-hour stagger which would have no real guarantee at all. Each batch gets its own `AutomationSource` (`teamwork_nd_1..4`) so a batch-specific stuck problem shows up as its own dashboard tile instead of hiding behind another batch's success — Vincent will now see 4 ND tiles instead of 1. `automation_exceptions` stay under the shared `teamwork_nd` source (data content, not run-health) with a new 30-hour grace period on `replaceAutomationExceptions` (`lib/automation-sync.ts`, purely additive — defaults to 0 for its other 6 existing callers) so batches 2-hours-through-a-day apart don't wrongly auto-resolve each other's still-open exceptions between runs. **TeamWork Companies**: unrelated to timeouts (real runs finish in 90-140s) — root cause was `/tmp` disk exhaustion from launching Chromium TWICE, seconds apart, within one invocation (`syncTeamworkCampaignRecipients` + `syncTeamworkContactPersons`, both independently calling `getSessionCookie()`), confirmed by matching real failed-run Chromium stderr ("Less than 64MB of free space...") to a failure mode this codebase already half-anticipated but hadn't fully solved. Checked Playwright's actual compiled source before proposing a fix (`node_modules/playwright-core/lib/coreBundle.js`): passing an explicit `--user-data-dir` is a **hard thrown error**, ruling out "give each launch its own immediately-deletable directory" — instead eliminated the redundant second login entirely: both helper functions now accept an already-obtained `cookie: string` parameter, fetched ONCE in `app/api/teamwork/sync/route.ts` (with a one-retry hedge preserving the old independent-retry resilience). Also found and fixed a real, separate gap: `lib/teamwork-nd.ts`'s own browser-launch path never called the existing stale-`/tmp`-profile cleanup at all (unlike `lib/teamwork-agm.ts`'s, which did) — extracted the cleanup into a new shared `lib/playwright-tmp-cleanup.ts` both files now import, so ND's now-4x-daily browser sessions protect the same shared `/tmp` pool too. Also surfaced the REAL error on the dashboard: `syncTeamworkCompanies()`'s response never set a top-level `error` field even when parts failed, so the dashboard always showed a generic fallback string — now joins whichever specific failures actually happened into one real message. **Verified against real production data throughout, not just compiled** — this is what caught the 2-batch design being insufficient in the first place: ran real batches against real TeamWork repeatedly (including catching and correcting a `cwd` mistake mid-verification that produced a misleading 401), confirmed the final 4-batch partitioning covers the full roster with zero overlap/gaps, and confirmed a real 3-person batch containing the single slowest individual of the day still finished with a comfortable margin. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (EOT header + metric cards, same day — Vincent showed a screenshot of Late Filing's header (warning icon/title/"Auto-detected from AR records" pill/Refresh button) and its 5 clickable metric cards, asking EOT to match ("EOT 页面也是要有趋同的UI"). Read `app/late-filing/page.tsx`'s actual structure to copy it precisely rather than eyeballing the screenshot: the icon/title/pill/buttons row and the metric-card grid are BOTH standalone, sitting above a separate `.system-list-shell` that wraps only the table itself — not a colored title bar inside the shell, which is what EOT had until now. Restructured `EotTable.tsx` to match: plain header row (Calendar icon, "EOT" title, pill, Refresh button — no "Add Manual", since EOT rows are TeamWork-detected, not staff-created), then a 4-card metric grid (`MetricCard`, the same shared component Late Filing uses) breaking the total down by AR-only / AGM-only / both-extended, each clickable to filter the table below — matching Late Filing's own "click a card to filter" interaction, not just its visual look. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (EOT mirrored scrollbar, same day — Vincent pointed at a screenshot of the pill-shaped horizontal scrollbar every other wide table has ("EOT页面也要下面这条东西滚动条"). Added the exact same mechanism `MasterListTable.tsx`/`ARTableView` (app/billing/page.tsx) already use — a fixed-to-viewport-bottom mirrored scrollbar (native overflow hidden on desktop instead) with click-to-jump and drag-to-scroll, so the control stays reachable without first scrolling a possibly-tall table down to its own bottom edge. Copied the refs/`updateSb`/mount-effect/JSX pattern directly rather than reimplementing it, matching the same behavior other tables already have exactly. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (EOT visual polish, same day — Vincent confirmed the data/logic below was correct but the table itself was a plain, unstyled HTML table that didn't look like anywhere else in the app ("这个UI我要和其他的TABLE那样的UI"). Found the real shared design system before reaching for ad-hoc styling: `.system-list-shell`/`.system-list-title-bar`/`.list-column-header-gray`/`.system-list-row`/`.system-list-table` (app/globals.css) is the established chrome behind every data-grid page — explicitly documented there as covering "AR Reminder, Billing Drafts, Address Service, ND" specifically (as opposed to `.system-list-column-header`'s navy variant for plainer list pages), which is exactly EOT's own situation. Rewrote `components/EotTable.tsx` to use these classes instead of one-off inline styles, matching `MasterListTable.tsx`'s own construction pattern precisely: sticky No./Company Name/UEN columns (same `left` stacking offsets), `company-name-text`/`company-registration-text` for those two cells, the same header/row padding, borders, and hover behavior every other table already has. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (EOT rebuilt as a filtered view of AR Reminder instead of a separate master_list category. Vincent sent the exact column set he wants EOT to show — No./Company Name/UEN/Code/Reminder/Report Ready/AR Original Due/AR Revised Due/To Client/Signed/AGM Original Due/AGM Revised Due/XBRL/DPO/ROND RONS/SEC PIC/ACC PIC/TAX PIC/Remarks — and asked for "the same logic as AR Reminder" on the Reminder field specifically. **Investigated AR Reminder's real column definitions before assuming anything** (an Explore agent's full report of `app/billing/page.tsx`): 11 of the 19 requested columns turned out to be AR Reminder's OWN existing fields verbatim (reminder_note/prepared_date/sent_date/received_date/xbrl/dpo/ond_ron/pic/acc_pic/tax_pic/remarks) — meaning an EOT company is fundamentally an ALREADY-tracked ar_reminder cycle whose due date TeamWork shows extended, not a new set of companies. Confirmed this architectural pivot with Vincent directly rather than assuming, then reworked the whole feature built earlier today: removed the standalone `master_list` list_type='eot' category entirely (reverted `MasterListTable.tsx`/`app/api/master-list/route.ts`'s eot_* additions, deleted the 32 rows that category had already collected — now genuinely orphaned since nothing reads them anymore) and rebuilt on top of `ar_reminder` directly. Added 4 new columns there instead (`scripts/add-ar-reminder-eot-fields.sql` — ar/agm_original/revised_due_date; Vincent ran the migration himself, no direct Postgres connection available from this environment). `late-filing/sync/route.ts`'s Pass 3 (the `<strike>` auto-detection, unchanged in what it detects) now updates the MATCHING ar_reminder row via the SAME `arByKey` map that route's own late-filing mirror already builds — zero new preload query needed — instead of writing a separate master_list row. New lean `GET /api/ar-reminder/eot` (filters ar_reminder to rows with at least one eot_* column set, joins `companies.internal_code` for the one genuinely new column in Vincent's list — confirmed via the same investigation that AR Reminder has no existing "Code" column at all). New `components/EotTable.tsx` reuses AR Reminder's own `EditField`/`SelectField`/`AutoFillDot` components and every one of their option constants (XBRL/DPO/ROND/SEC-ACC-TAX-PIC/REPORT_READY) directly imported from `app/billing/page.tsx` (exported them there — purely additive, zero behavior change to the existing Billing page) rather than reimplementing equivalent logic that could drift from the original — an edit made on the EOT page is the literal same PATCH `/api/ar-reminder` call, same manual-flag/auto-fill-dot conventions, same audit trail as editing the identical row from AR Reminder itself. The 4 due-date columns themselves render read-only (pure TeamWork mirrors, not editable). **Verified against real production data before shipping**: ran the actual `late-filing/sync` route locally end to end (first attempt hit the same transient TeamWork login flakiness seen repeatedly today, unrelated to this change — retried, succeeded: `ok:true`, `eot_refreshed:32, eot_errors:0`, all 32 real EOT cycles matched an EXISTING ar_reminder row with no inserts needed); confirmed FOMO PAY PTE. LTD.'s real row (id 1012) now carries `ar_original_due_date:2026-07-31 → ar_revised_due_date:2026-09-29`, `agm_original_due_date:2026-06-30 → agm_revised_due_date:2026-08-29` alongside its own pre-existing `reminder_note`/`pic` completely untouched — confirming this is genuinely the same row, not a duplicate copy; replicated the new `/api/ar-reminder/eot` route's own query directly against production (auth-gated, can't curl it as Vincent) — 19 rows match (roughly half of 32, expected: a company with EOTs on both AGM and AR now collapses onto one row instead of two). Page itself confirmed served correctly (redirects to `/login` when unauthenticated, no server error) — full visual check needs Vincent's own real session, the same limitation as the QuickBooks-invoice-edit feature earlier this session. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (Fixed two standing Automation Health failures — Vincent's own screenshot of the dashboard showed "AR Generate: never" and "TeamWork ND: never" both red, asked to investigate, then explicitly: "你先想办法恢复，要稳定，并且阅读上下文完整内容后，才开始操作" (find a way to restore it, make it stable, and only act after reading the full context) — read both routes' complete source (not just grepped) before touching anything, including correcting a claim made earlier in the same conversation (said sync-nd had no self-imposed deadline at all before actually reading `lib/teamwork-nd.ts` in full — it does, just too tight a margin, see below). **AR Generate**: `automation_sync_runs` showed it failing every single day for at least a week with "duplicate key value violates unique constraint ar_reminder_entity_month_year_uniq" — confirmed directly this isn't a duplicate `company_name` within `companies` (checked live, none found) nor a duplicate within one run's own insert batch; by the time it's investigated hours later, whatever row conflicted has always already been filled in by some other path, so the exact trigger keeps escaping direct capture. Fixed the actual failure MODE regardless of not being able to pin down the precise trigger: a plain `.insert()` had the wrong shape for this — ONE stray row slipping past the existingNames/existingCompanyIds pre-check aborted the ENTIRE batch, silently losing every other genuinely-new row in the same target month too. Switched both the main forward-window loop's insert and the catch-up pass's insert to `.upsert(rows, { onConflict: 'entity_name,fye_month,fye_year', ignoreDuplicates: true })` — a stray duplicate now silently no-ops instead, matching this route's own stated intent ("never overwrites existing rows") more precisely than a failing insert did. **Verified the exact mechanism directly before trusting it**: ran an isolated upsert against a real `ar_reminder` row with a deliberate conflict — confirmed 201 response, no row created, the original completely unchanged byte-for-byte; then a genuinely new row via the same call shape — confirmed it inserts normally, cleaned up after. Also gave the catch-up pass's own TeamWork-fetching loop a self-imposed deadline it never had (`CATCH_UP_DEADLINE_MS = 230_000`, an `AbortController` matching late-filing/sync's own established `WORK_DEADLINE_MS` pattern) — found while investigating the SECOND issue below that this route had no protection at all against the same "hard-killed before cleanup can run" failure mode. **TeamWork ND**: `automation_sync_runs` showed repeated "Previous run lease expired before completion" and one run stuck in status='running' forever (heartbeat frozen at its own start time) — root cause, confirmed by fully reading `lib/teamwork-nd.ts`: it DOES have a self-imposed `overallTimeoutMs` safety valve (a `Promise.race` against the real scraping work), just set to 290 seconds against the route's own `maxDuration=300` — only a 10-second margin for the `finally` block's `browser.close()` (a real headless Chromium process, not instant) plus propagating the error back up through `withAutomationRun`'s own DB writes to release the lock. One already-observed successful run took 283 seconds on its own, and a single slow person has been clocked near 100 seconds — confirming this margin was already realistically too tight, not a hypothetical risk. Widened to 240 seconds (a real 60-second buffer) rather than guessing at a smaller nudge. **Verified both fixes against real production data before shipping**: ran the actual `ar_reminder/generate` route locally (first attempt hit the same transient TeamWork login timeout this session kept seeing today, unrelated to the code — retried, succeeded: `ok:true`, zero errors, the catch-up pass found and correctly inserted 4 real missing rows, `catchUpDeadlineHit:false`); ran `teamwork/sync-nd` scoped to one real person (`?member_id=`) as a regression smoke test on the timeout-constant change — `ok:true`, 27 real appointment rows scraped and inserted correctly. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (EOT follow-up, same day — Vincent's own screenshot of the live Late Filing page showed EASYBOOK PAY/EASYBOOK.COM PTE. LTD. still badged "30 Jun 2026 · OVERDUE" despite both now having a confirmed EOT in the new list below (revised due 29 Aug 2026), and asked directly whether EOT is really wired into the daily automation. Confirmed the cron IS daily (`vercel.json`: `/api/late-filing/sync` at `0 21 * * *`, EOT detection lives inside that same route) — but found a real, separate gap the screenshot exposed: once a `late_filing_companies` row stops being `isLate`, NOTHING in this route ever touches it again — `next_agm_due_date` freezes at whatever it was on the day it left `isLate`, even as the real due date keeps moving. Confirmed live: these two rows cleared `isLate` on 2026-08-21 (an unrelated, earlier change — the historical-average-only flagging trigger's removal that day, nothing to do with EOT), and had shown that stale June date ever since, with no way for a human to fix it short of manually re-typing the field. Added a small block right before the existing `if (!isLate) continue` gate: for any successfully-evaluated company that is NOT currently late, refresh `next_agm_due_date` to the freshly-computed value (respecting `manual_fields` protection same as everywhere else) — deliberately leaves `remarks`/the Review-Resolved workflow completely untouched, only the due-date display itself needs to never go stale. **Verified against real production data again before shipping**: re-ran the actual route locally (first attempt hit the same transient TeamWork login timeout this session saw earlier today, unrelated to the code change — retried and it succeeded), confirmed EASYBOOK PAY/EASYBOOK.COM's `next_agm_due_date` is now `2026-08-29` (matching their EOT's revised date exactly), no longer the stale `2026-06-30` — since that date hasn't passed yet, the OVERDUE badge should now correctly disappear from the live page. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (New EOT (Extension of Time) Master List category, plus a real underlying bug fix it depends on. Vincent showed a real TeamWork screenshot for FOMO PAY PTE. LTD. — its 2025 AGM/AR Due Dates render with the ORIGINAL date struck through and a REVISED (extended) date after it, and asked for a new "EOT" third-level nav entry (Master List → Strike Off/Terminated group, right after Terminated Services) so staff can see which companies currently have an approved extension, and for Late Filing to judge lateness against the revised date, not the original. **Investigated the raw TeamWork API response directly before assuming anything about how EOT data is structured** (fetched FOMO PAY's own `company_agm/agm_list_ajax` response live): the due-date field genuinely contains `"<strike>30/06/2026</strike> <br> 29/08/2026"` in the RAW DATA, not just TeamWork's own UI rendering — meaning full auto-detection is possible, and also surfaced a real, currently-live bug completely independent of the EOT feature request: `parseDmy` (`lib/teamwork-agm.ts`) strips HTML tags and returns the FIRST dd/mm/yyyy match, which for a struck-through field is the ORIGINAL, now-superseded date — silently wrong wherever a Due Date field gets parsed this way, confirmed affecting three real call sites: `late-filing/sync`'s own overdue-day calculation, `ar-reminder/sync-workflow`'s Active Client "Next AGM Due" computation, and `ar_reminder.due_date` itself. Added `parseLatestDmy` (finds every dd/mm/yyyy substring regardless of HTML wrapping, returns the latest) and switched all three call sites to it — a plain never-revised date still parses identically, so this is a pure bug fix with no behavior change for the non-EOT case. New `master_list` category `list_type='eot'`: explored the existing Strike Off/Terminated/Name Change architecture first (an Explore agent's full report, confirmed a brand-new `list_type` string needs zero changes to `MasterListTable.tsx`/the API routes, which are already fully generic) rather than guessing at the pattern. Added 4 new bespoke columns (`scripts/add-master-list-eot-fields.sql` — `eot_event`, `eot_fye_year`, `eot_original_due_date`, `eot_revised_due_date`; TEXT for the year, matching `kyc_year`'s own convention on this generically-string-typed table, not INTEGER) — Vincent ran this migration himself (no direct Postgres connection available from this environment, only PostgREST). New page `app/master-list/eot/page.tsx`, nav entries in `Sidebar.tsx`/`MobileNav.tsx`. **Auto-detection hooked into `late-filing/sync/route.ts`'s existing daily per-company loop** (per Vincent's explicit choice over a standalone EOT-only sync) — reuses the SAME already-fetched TeamWork event rows that loop's overdue check already iterates, zero extra TeamWork calls; scans for the `<strike>` pattern on still-open (not yet held/filed) AGM/AR due dates, upserts into `master_list` keyed by UEN+event+FYE year, never touches the `remark` field (left entirely for staff notes). Runs independent of `isLate` — an active EOT is exactly what can make a company NOT late, so gating this on the lateness check would have skipped the very companies it exists to track. **Verified against real production data before shipping, not just compiled**: ran the actual `late-filing/sync` route against a local dev server with real TeamWork + real Supabase (mirroring this session's established verification discipline) — result: `eot_inserted: 32, eot_errors: 0`, FOMO PAY's own two rows (AGM 30/06→29/08/2026, AR 31/07→29/09/2026) matched Vincent's screenshot exactly, and confirmed FOMO PAY correctly does NOT appear in `late_filing_companies` at all post-fix (its revised due dates haven't passed yet) — the actual point of the `parseLatestDmy` fix, not just the visibility feature. The scan also surfaced 31 other companies sharing this exact EOT batch (many "FOMO"-family group companies with identical revised dates, suggesting one bulk extension request) — real, previously-invisible data nobody had a way to see before this. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (Draft Helper 1.7.4 follow-up, same day — Vincent pushed back directly on the deferred-close fix below: "这个顺序其实也更贴近老宏本身的做法; 为什么不能完全复制做法" (why not fully copy the macro's own approach, if this is already closer to it). Good question, checked rather than just asserting "closer" was good enough: the macro's real Display()-only workflow never proactively closes the Inspector AT ALL — it stays open until the human dismisses the window themselves. `_open_one_draft` (the Display() path) can fully match that: removed the `.Close(1)` call entirely, verified directly that `Display()` correctly reuses the still-open Inspector (real window, right content, no exception) rather than needing one closed-then-reopened. `_send_one_draft` (the programmatic `.Send()` path) genuinely can't fully match the macro the same way — the macro never calls `.Send()` at all, only `.Display()` for a human to send manually, so there's no macro precedent for this path in the first place; the Close() there stays, since Send() with an Inspector still attached throws `(-2147024809, 'The parameter is incorrect.')` (an Outlook COM constraint discovered through direct testing, unrelated to anything the macro does). Verified the simplified open path through the real Flask endpoints and the actual rebuilt exe before shipping, same as the deferred-close fix itself. **Caught and immediately corrected a mistake while cleaning up test artifacts**: used a PowerShell `-like` pattern with literal `[TEST]` in it, not realizing square brackets are a character-class wildcard in PowerShell (matches any single T/E/S character, not the literal string) — it matched and closed-with-discard a real, unrelated compose window ("ELEMETALL CONCEPTS... Renewal") that had nothing to do with this work and was explicitly meant to be left alone. Checked immediately: no content was actually lost, since Outlook had already auto-saved it to Drafts before the close (confirmed by reading the saved Drafts copy back — full To/CC/attachments/body all intact) — closing an already-saved item only closes the window, not the underlying saved copy (the exact distinction this whole fix is about, for a *never*-saved item). `VERSION`/`LATEST_HELPER_VERSION` stay at 1.7.4 (same version, refined before Chelsea even got a chance to retest 1.7.3's replacement) — rebuilt, mirrored, redeployed. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (Draft Helper 1.7.4 — 1.7.3's own fix broke outright on Chelsea's real machine within a day of shipping: "Property 'CreateItem.To' can not be set" the instant `mail.To =` ran, right after `mail.GetInspector().Close(1)`. Reproduced directly rather than guessing: on a freshly COM-launched Outlook (no window ever shown), calling `Close()` immediately after `GetInspector()` — before the Inspector has actually finished initializing — can tear down the whole not-yet-saved item, and in one isolated repro crashed Outlook's whole process outright ("RPC server is unavailable"). With Outlook already running beforehand, the same immediate-close sequence worked fine in isolation — meaning 1.7.3's own pre-ship testing (done on this machine's one personal, fast-initializing account) never actually lost the race, while a slower real Exchange/M365 profile (exactly what this targets) reliably does. **Fix**: keep the Inspector reference (still calling `GetInspector` in the same early position, right after `SendUsingAccount`, for the account-binding side effect the whole 1.7.3 fix was about) but defer the actual `.Close(1)` until right before `Save()`/`Send()`/`Display()` — after every field (To/CC/Subject/body/attachments) is already set, giving Outlook the entire rest of the request's real wall-clock time to finish initializing before anything touches the Inspector again. This is also a closer match to the macro's own real behavior, which never explicitly closes the Inspector at all until its window is dismissed — 1.7.3's "close it immediately" was an unconfirmed guess to avoid a hypothetical visible flash, not something the macro itself does. Verified directly, repeatedly, before shipping: isolated PowerShell COM (both the crash reproduced and the fix's absence of it), then the actual Flask `/drafts/send` and `/drafts/open` endpoints against a locally-run `python app.py`, then the actual **compiled** `TassureDraftHelper.exe` — all three landed a real email in Sent Items / opened a real Display() window with no exception. Along the way found and cleared an unrelated local snag: a stale 1.7.3 `TassureDraftHelper.exe` had been running as a background tray app since that morning, silently winning the port-51820 race against every local test run until killed — worth remembering for any future local Draft Helper testing on this machine. `VERSION`/`LATEST_HELPER_VERSION` bumped together to 1.7.4, mirrored into `tassure-draft-helper`, rebuilt, redeployed. **Still unverified**: whether this specific race was really what Chelsea hit (plausible and reproduced, but her exact machine/timing wasn't directly observed) — asked her to retry and report back rather than declaring this confirmed-fixed. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-28 (Permanent, cost-controlled fix for the "newer ar_reminder row masks an older still-open cycle" class of bug — Vincent asked whether the December-2025 incident (20 real companies missing from Late Filing, see 2026-08-27 entry below) could recur, including for 2027. It structurally could: `/api/ar-reminder/generate`'s catch-up pass only ever backfills a company with ZERO rows under its current fye_month, so once the plain forward-window loop creates any newer row, an older gap behind it becomes permanently invisible to that mechanism — and deliberately did not widen catch-up's daily eligibility to also cover this (897 companies system-wide match "only a future row tracked," not a rare edge case — a daily full scan would risk the route's own timeout). Vincent's explicit call: "做这个吧，要稳定靠谱的" (build the narrower, correction-triggered version, make it reliable). Implemented in `app/api/ar-reminder/sync-workflow/route.ts`, hooked into its EXISTING per-company FYE-month-correction logic — since a correction only fires when `companies.fye_month` genuinely changes (a naturally small, bounded, rare event), and this route already fetches the company's full TeamWork event history for its normal date-sync work, so the new check reuses that same already-fetched data at zero extra TeamWork-call cost. Groups every AGM+AR event by shared FYE date (same corrected cross-referencing the Science In Sport mistake required — a cycle is open only if NEITHER its AGM nor its AR event shows a held/filing date), then backfills the earliest open cycle not already covered by a live row under the corrected month, using the same `resolveTeamworkPic`/carried-forward-PIC/due-date-formula helpers `/generate`'s own catch-up pass uses. Moved `toDateStr`/`addMonths` out of `/generate/route.ts` (their original home) into shared exports in `lib/date.ts` so both routes use the exact same due_date formula (FYE + 7 months) instead of risking a second copy drifting from it. **Caught and fixed a real bug during review, not after**: an early `return` inside a defensive `if (!fullCompany)` guard was nested inside the per-company `while` loop of `sync-workflow`'s concurrent worker pool with no intervening function boundary — would have silently aborted that entire worker's remaining company queue, not just skipped one company. Restructured to `if/else` with no early return. **Verified against real production data before shipping, not just compiled**: picked one of the 20 December companies already manually fixed (BYF INTERIOR PTE. LTD., id 1713) as a live test subject — with Vincent's explicit approval first, since this meant temporarily writing to production. Set its `fye_month` to a wrong value and deleted its already-correct 2025 `ar_reminder` row (simulating the exact pre-fix state), ran the real `sync-workflow` route against a local dev server (so the NOT-yet-deployed code under test, not whatever's live in production) with real TeamWork + real Supabase, then confirmed: `fye_month_corrected: 1`, `fye_correction_backfilled: 1`, and the backfilled row (new id 1034) matched the original manually-verified row field-for-field (same PIC "Hoe Chyi Lim", same fye_date 2025-12-31, same due_date 2026-07-31) — the automated logic independently re-derived the identical correct result. No manual cleanup needed afterward; the company's real state is already correct. This does not retroactively find existing gaps in the other 11 months (only December got a manual audit-and-backfill sweep) — it only prevents this specific class of gap from recurring going forward, at the moment a company's FYE month gets corrected. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Draft Helper 1.7.3 — the real fix for "From shows finance@, sends from contact@ anyway." The 1.6.2 Save()-before-Send() theory (this file's own 2026-08-26 entry) was never actually right — Chelsea tested it for real and it still sent from the wrong account. Rather than theorize again, extracted BULK.xlsm's real VBA source directly (`python -m oletools.olevba`, since this machine's Excel has "trust access to the VBA project object model" off) and diffed it line by line against `_open_one_draft`/`_send_one_draft`. Found the actual difference: the macro calls `.GetInspector` — a pure side effect of how it pastes its Word-built body in, not a deliberate fix — immediately after `SendUsingAccount`, before To/CC/Subject/body/attachments are ever touched; this file's own body-setting (`mail.HTMLBody = ...`) never touches an Inspector at all, and the only `GetInspector`-triggering call was `Display()` at the very end, after everything else was already set. Added `mail.GetInspector()` in the same early position in both functions. **First attempt broke `.Send()` outright** — leaving the Inspector open (even hidden via `Visible = False`, itself not a real property on this Inspector type) made `.Send()` throw `(-2147024809, 'The parameter is incorrect.')`, confirmed by isolating each step directly against a real Outlook COM session via PowerShell before touching the Python again. Fixed by closing the Inspector immediately (`mail.GetInspector().Close(1)`) rather than leaving it open — verified directly, both with and without the immediate close, that the realize/bind effect the fix depends on survives the close, and that `.Send()` and `.Display()` (re-opening its own real window later) both work cleanly afterward. Rebuilt, verified with a real end-to-end send through the actual compiled exe (not just the isolated COM test) before shipping. **What's still unverified**: this machine only has a personal `vincenttassure@outlook.com` account, so the actual multi-account scenario (finance@/contact@ on Chelsea's real M365 profile) that originally broke still needs a real test there — flagged directly to Vincent rather than claimed as confirmed-fixed. `VERSION`/`LATEST_HELPER_VERSION` bumped together to 1.7.3. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Followed up on the Science In Sport mistake — Vincent asked if December had the same problem. It did, at scale: wrote a standalone audit script (reusing `lib/teamwork-agm.ts`'s login+fetch approach, correctly grouping AGM/AR events by shared Actual FYE date this time — the exact cross-reference the Science In Sport mistake got wrong) against all 359 December-FYE companies whose only tracked `ar_reminder` row was a not-yet-due future cycle. Found 20, every one sharing the identical shape: FYE 2025-12-31, genuinely unfiled per live TeamWork (both AGM and AR event rows blank), overdue since 2026-07-31 — invisible because `/api/ar-reminder/generate`'s catch-up pass only ever backfills a company with ZERO rows under its current fye_month; once the plain forward-window loop creates the newer 2026 row, that month counts as "generated" forever and an older gap behind it is never reconsidered. Backfilled all 20 by hand (verified field-for-field, same due_date formula the system itself uses). **Also fixed in code, not just data**: `/api/ar-reminder/generate`'s own catch-up cycle-detection had the identical per-event-row bug that caused the Science In Sport mistake — checking each TeamWork AGM/AR event row's own held/filing columns in isolation, never cross-referencing the sibling event for the same FYE. Rewrote it to group by FYE date first (a cycle is open only if NEITHER its AGM nor its AR event shows completion), so this can't quietly happen again for whichever companies DO go through catch-up. **Deliberately did NOT widen catch-up's daily eligibility** to also catch "only a future row tracked" the way the December audit did — checked first: 897 eligible companies system-wide, and the December sample alone had 359/369 matching that shape, meaning it describes most healthy companies most of the time, not a rare edge case. Baking it into the daily cron would mean a near-full-company-base live TeamWork scan every single day forever (risking the route's own 300s budget), not a one-time catch-up. Documented the reasoning directly in the route's docstring and offered Vincent the same one-time audit-and-backfill approach for the other 11 months if he wants full coverage, rather than a permanent behavior change. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Two real companies missing from Late Filing, two different root causes. Vincent showed SILVER RIVER TECHNOLOGY's real TeamWork event history (two genuinely unfiled, years-overdue AGM/AR cycles) and separately named SCIENCE IN SPORT SINGAPORE — neither showing on the page. **Silver River**: had a `late_filing_companies` row with remarks "STRIKE OFF - CLIENT LODGED OBJECTION" — the detection loop's skip condition (`/api/late-filing/route.ts`) matched any "STRIKE OFF" remark, objection or not, per an explicit 2026-08-20 decision ("with or without a client objection... nothing left to chase"). Narrowed it to exclude the CLIENT LODGED OBJECTION variants specifically — an objection means the outcome isn't settled, and getting the overdue AR filed can be part of resolving it, so it no longer belongs in the same bucket as an uncontested strike-off. **Flagging this as a reversal of a named prior decision**, not a silent bug fix — worth Vincent confirming this is really what he wants going forward, not just for this one company. **Science In Sport**: genuinely missing `ar_reminder` row, not a detection-logic issue — confirmed by fetching its real TeamWork history directly (a standalone script replicating `lib/teamwork-agm.ts`'s login+fetch): a real, unfiled AR (FYE 2025-10-31, due 2026-05-31 per TeamWork's own due date, matching the system's independently-computed FYE+7mo convention exactly) that the existing catch-up pass in `/api/ar-reminder/generate` never covers, since that pass only fires for a company with ZERO rows under its current fye_month — Science In Sport already has one (a newer, not-yet-due 2026 cycle), so the older open one silently never got backfilled. This is very likely a systemic gap (any company with a newer row masking an older still-open one), not unique to this company — manually backfilled just this one row for now (verified field-for-field against real TeamWork data before inserting) rather than rushing a change to the catch-up pass itself, given its own extensive history of subtle bugs from past hasty edits; flagged to Vincent as a separate follow-up worth a careful look, not folded into this fix. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Fixed "can't type a Chinese company name" across the app, not just where Vincent noticed it. He asked why he couldn't type a company name into a Trademark Master Records cell — reproduced the mechanism: every inline-edit input's `onKeyDown` blurred/committed/submitted on ANY Enter press, with no check for `isComposing`. That's the exact key an IME sends to CONFIRM a Chinese candidate mid-composition (e.g. typing "潮八八" — row 62's own company name in his screenshot) — so the cell closed and saved/discarded before the real text ever landed in the input, on every single attempt. `AssistantWidget.tsx`'s chat input already had the correct `!event.nativeEvent.isComposing` guard (someone had already hit and fixed this exact bug there, just never carried it to the table components) — confirmed it's the right, established fix and applied it everywhere else the same unguarded pattern existed: `TrademarkTable.tsx` (2 spots — the cause of this report), `MasterListTable.tsx` (5 spots — PIC name inputs, a textarea-as-commit-on-Enter field, two date-style inputs), `app/billing/page.tsx` (3 spots — AR Reminder/Billing Drafts' shared EditField and SelectField-custom-input, plus a date field), `app/late-filing/page.tsx` (1 spot). Left `MasterListTable.tsx`'s one other Enter-handler alone — a keyboard-accessibility row-open handler (`Enter || ' '`), not a text field, IME composition doesn't apply. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Made To/Cc/Bcc editable in OutlookStyleSendModal. Vincent: all three should stay editable after the review screen opens, and more than one address on the same line should end up one-per-line. To/Cc were previously read-only display divs (Bcc was already an editable single-line input). New `RecipientField` component — an auto-growing textarea (same no-internal-scroll technique the body field already uses) that reformats onto one-address-per-line on blur via a new `splitToLines()` helper (splits on comma/semicolon/newline, rejoins with `\n`) — matches how the app already stores a multi-recipient field (`recipientLines()` in `lib/campaign-recipients.ts` joins with `\n`) and how Draft Helper now normalizes recipients right before `.Send()` (today's earlier `_normalize_recipients` fix). Reformats on blur, not every keystroke, so typing a second address mid-line isn't split prematurely. `editedTo`/`editedCc` feed into `handleSend`'s payload and are now also covered by the existing save-on-close mechanism (extended the change-check and PATCH payload alongside `editedBody`) — `editedBcc` stays send-only, deliberately excluded from save-on-close since `bcc_email` has no database column to persist into at all. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Draft Helper 1.7.2 — Chelsea's first real multi-recipient Send() failed outright: `(-2147352567, 'Exception occurred.', (4096, 'Microsoft Outlook', 'Outlook does not recognize one or more names. ', ...))`. Root cause: `lib/campaign-recipients.ts`'s `recipientLines()` joins multiple To/CC addresses with `\n` (newlines) in the app's own stored data — `draft-helper/app.py` assigned that raw string straight to `mail.To`/`mail.CC`/`mail.BCC`, but Outlook's own convention for those COM properties is semicolon-separated, and a literal embedded newline isn't a recognized separator. This exact bug has always existed in `_open_one_draft` (the `.Display()` path) too, completely unfixed — it never surfaced because `.Display()` doesn't force name resolution; a human sees the compose window and could always retype a garbled field before manually clicking Send. `.Send()` (this session's new web-driven flow) resolves immediately and hard-fails the instant it hits one, with no human left to notice or fix it first — the first time this exact code path had ever actually been exercised with a real multi-recipient CC. Fixed with a new `_normalize_recipients()` helper (splits on `;`/`,`/`\n`/`\r`, rejoins with `; `), applied to `mail.To`/`mail.CC`/`mail.BCC` in both `_open_one_draft` and `_send_one_draft` — matching `lib/draft-helper-client.ts`'s own `normalizeRecipients`, which already did the identical fix but only for the `mailto:` fallback link, never for the Draft Helper JSON payload path. Verified directly before shipping, not just reasoned about: rebuilt the exe, sent a real test through the new `/drafts/send` with a newline-joined 2-address CC (the exact failure shape) — succeeded, and the landed Sent Items copy confirmed the CC field correctly resolved to two distinct semicolon-separated recipients. `VERSION`/`LATEST_HELPER_VERSION` bumped together to 1.7.2, rebuilt, redeployed. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Chelsea reported the Send review screen suddenly closed on her mid-edit, forcing her to click Draft all over again. Found two real bugs in the same day's own earlier changes, both plausible causes, fixed both rather than guessing which one she hit. (1) The modal's backdrop still closed-on-click like an ordinary dismissable popover — but `handleClose` now saves-and-closes whenever the body was edited (an earlier fix, so a Draft-then-abandon doesn't lose work), so any stray click near the edge silently saved and closed the whole screen instead of doing nothing. Widening and auto-growing the modal earlier today made this easier to trigger (a taller panel needs backdrop scrolling more often, and scroll gestures on a trackpad can register as a stray click). Removed backdrop-click-to-close entirely — a screen reviewing a real outgoing email should only close on a deliberate click on X or Close, matching how serious compose/confirm flows usually behave. (2) The drag-and-drop-attachment handlers added earlier today called `preventDefault()` unconditionally on dragover/drop — which also hijacks the body textarea's own NATIVE drag-to-reposition-selected-text (an ordinary editing gesture: a bubbled dragover/drop still lets an ancestor's `preventDefault()` block the original target's default action). Scoped every drag handler to bail out first unless `dataTransfer.types` actually includes `'Files'`, so a text-only drag now passes through to the browser's normal handling untouched, only a real file drag gets intercepted. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Still slow after the previous fix — Vincent: "之前是直接点击就直接飞去OUTLOOK的速度是很快的...秒开", i.e. even after parallelizing the popover's own DB queries, the Send review screen's "Resolving attachments…" wait still felt nothing like the old native-Outlook flow. Measured the two actual QuickBooks calls directly against production Intuit (not our own DB — a completely different bottleneck from the same-day company-list one): a live amount re-check took ~1.7s, the live invoice PDF fetch ~1.9s, run together ~2.8s — genuine external API latency, not something client-side parallelizing alone fixes (parallelizing them, done in the prior update, already cut this from a ~3.6s sequential floor). Cut one of the two round-trips out entirely for the actual common case: the amount re-check exists to catch a draft that's sat around since being prepared and might have drifted in QuickBooks since — but `quickEmailDraft` (`app/billing/page.tsx`) opens the review screen on a draft it JUST created, seconds earlier, from a `generated_invoices` lookup it just made itself. New `DraftLike.skip_amount_refresh`, set true only at that one call site; `refreshAmount` (`lib/draft-helper-client.ts`) now honors it. Low-stakes even in the near-zero chance someone hand-edits the exact same invoice in QuickBooks in that exact window: the attached PDF is always fetched live regardless of this flag (that's what actually matters for payment) — this only skips a redundant re-check of the email body's own dollar figure. Other callers (`history/page.tsx`'s reopen flow, genuinely-older drafts) never set the flag, so they keep the full check. Halves the real wait for the primary "Draft, review, Send" workflow down to roughly the PDF fetch alone (~1.9s) — told Vincent this floor is genuine Intuit latency, not fully eliminable from here. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (OutlookStyleSendModal (the Send review screen) — four fixes from Vincent's real usage. (1) Widened it: `min(860px,100%)` → `min(1500px,95vw)`. (2) The body was a fixed-height (`rows=14`) textarea with its own internal scrollbar, with the PayNow payment-image preview rendered as a separate block below it — cramped, and scrolling the text didn't carry the image with it ("我想要...文字和图片都是一起滚动的，不只是文字中间区域可以滚动"). Switched to the same auto-growing-textarea technique `billing/page.tsx`'s own `AutoTextarea` already uses elsewhere (`rows={1}` + a ref that sets `style.height` to `scrollHeight` on every change) — the textarea now has no scroll of its own, so the modal's own single scrollbar carries text and image together, same as scrolling a real email. (3) Drag-and-drop attachments: drop a file anywhere on the panel to attach it (`onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` on the panel, feeding the same `manualFiles` list "Add attachment" already does) — used a drag-counter (not a plain boolean) for the highlight, since dragenter/dragleave fire per-child-element as the pointer crosses them, not just once for the panel. (4) "文件的自动导入也是很慢" — `prepareDraftForSend` (`lib/draft-helper-client.ts`) ran its live QuickBooks amount-check THEN its live QuickBooks PDF fetch, sequentially, when neither depends on the other's result (the PDF fetch only needs qbInvoiceId/qbCompany, which the amount-check can never change) — parallelized via `Promise.all`, roughly halving the real wait for the common case of two genuine external API round-trips. Confirmed this was unrelated to the same-day company-list bottleneck below — traced both underlying routes directly, neither touches the `companies` table at all. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Sped up the Email Drafts popover — Vincent: clicking the envelope icon on Billing took ~2s before the Draft button became clickable ("点击DRAFT...至少要2秒"). Root cause was in `/api/client-communications/campaigns/preview`'s GET handler (the single-lookup path this popover's `resolveDraftPreview` calls): it unconditionally fetched all ~906 active companies (measured ~850ms — several JSON/array columns per row) and awaited that BEFORE starting the other three queries, when it only ever needed to fuzzy-match ONE already-known company name. Measured each of the four underlying queries directly against production before touching anything, to find the real bottleneck rather than guessing. Fixed two ways: (1) added a fast path — an indexed exact `company_name` match, since this route's Billing Drafts caller always passes back a name it already got from this same table byte-for-byte (confirmed against the real screenshot's company, A.S.TAN GROUP ENGINEERING PRIVATE LIMITED — matched); only falls through to the old full fuzzy-scan (unchanged) for Campaign Centre's "add a company" control, which does type a genuinely approximate name. (2) That fast-path attempt now runs inside the same `Promise.all` as the other three queries instead of before them, since none of them depend on which company it resolves to — same change applied to the POST (bulk) handler's own `loadCompanies` call, zero behavior change either way, pure latency. Measured the full four-query set in parallel post-fix: ~344ms, down from a ~1.1s+ sequential floor before serverless/network overhead. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-27 (Auto-fill the "email sent" date into Remarks on a real send. Vincent's own habit: after actually sending an AR reminder, he manually types "18/8 email" (D/M, no year) into Billing Drafts' Remarks — mirrored automatically into AR Reminder's "Email Sent" (`accounts_status`) via the existing PATCH /api/ar-reminder mirroring. Asked the system to do this for him going forward, only for emails that actually went out. Hooked into `PATCH /api/client-communications/drafts` — the one route both real send paths already go through when a draft's status becomes 'sent' (`OutlookStyleSendModal`'s `handleSend`, a genuine `.Send()` confirmation, and `history/page.tsx`'s manual "Mark as Sent" fallback) — so both automatically get this for free. **Caught a real bug before shipping, not after**: assumed (from an old PROJECT_STATUS note) that `email_drafts.company_id` was the underlying `ar_reminder.id` — checked live against 5 real sent drafts and found every single one pointed at a completely unrelated company's `ar_reminder` row (`email_drafts.company_id` is actually `companies.id`, confirmed by cross-checking the same ids against the `companies` table directly, which matched exactly). Fixed by resolving the correct row through `company_id` + the draft's own campaign `fye_month`/`fye_year` (a letter/soa campaign has neither, so nothing is written for those, only 'ar' campaigns) — re-verified against the same 5 real rows, all five now resolve the exact right `ar_reminder` row (confirmed by `entity_name` matching `company_name` exactly), and one even already held a real "26/9 email" a human had typed, confirming the exact format match. Also caught by `tsc`: `email_campaigns` embeds as a single object in the real PostgREST response (confirmed live) but types as an array in Supabase-js's generic embed typing — handled defensively (`Array.isArray` check) rather than force-casting past the mismatch. `npx tsc --noEmit` and `npm run build` both clean; live-tested post-deploy against a disposable test campaign/draft pointed at a real company (cleaned up afterward) before calling this done.)

Previous update: 2026-08-27 (AR Reminder's "Invoice" column now shows the real TAB/TAC invoice numbers Billing Drafts already tracks, instead of relying on someone re-typing them into `ar_status` by hand. Vincent: wanted a sync similar to the existing Email Sent <-> Billing Drafts Remarks mirroring, but for Invoice — pull in Billing Drafts' own "TAB #..."/"TAC #..." numbers, stacked on two lines when both exist (e.g. "TAB #02610943" / "TAC #02680263"). Investigated the Billing tab's existing mechanism first: `latestInvoiceNo(c, company)` resolves the latest `generated_invoices` row for a company's CURRENT FYE cycle, rendered via the existing `BillingInvoiceReference` pill ("TAB #...", "No system invoice" when none). AR Reminder's own `ar_status` field (labeled "Invoice") had no connection to this at all — just a free-text `EditField`, which is why it showed "—" for almost every row. Added the same join server-side in `app/api/ar-reminder/route.ts`: fetches `generated_invoices` (same query shape as `billing/renewals/route.ts`), matches each AR row to its OWN cycle via `fyeDateString(row.fye_month, row.fye_year)` — not the currently-browsed month/year, since a stale-overdue row can carry a past `fye_year` — and resolves `tab_invoice_no`/`tac_invoice_no` per row. New `ArInvoiceCell` component (`app/billing/page.tsx`) renders both stacked via `BillingInvoiceReference` when a system invoice exists for that cycle, falling back to the original editable `ar_status` field only when it doesn't. Verified the fallback design against real data before shipping, not just assumed: queried every non-null `ar_status` value and found the large majority (59/89) were literally staff manually retyping the exact same invoice number(s) `generated_invoices` already had (e.g. "R&RONG TRADING PTE. LTD" -> `ar_status` "02610600 & TAC02680157", matching its real TAB/TAC invoices exactly) — confirming this was genuinely a manual-copy pain point to automate away, not a spot where free-form notes would get silently hidden. Join uses an exact normalized-name match (mirroring `billing/renewals/route.ts`'s own precedent for this specific table, not the fuzzy `wordMatch()` this route uses for its other QuickBooks joins), preferring the already-resolved `compMatch.company_name` over the raw `entity_name` when available. Spot-checked the live June-2026 cycle (88 rows) before shipping: 47 now resolve a real system invoice (9 with both TAB+TAC, 38 TAB-only), the remaining 41 correctly fall back to the manual field. `npx tsc --noEmit` and `npm run build` both clean.)

Previous update: 2026-08-19 (Turned period-overlap from a hard block into a confirmable warning. Follow-up to the false-positive fix below — Vincent's actual ask once that was explained: even a *genuine* overlap shouldn't always be impossible to invoice past, "有时候有特别情况" (sometimes there are special cases), so long as staff still see the warning and have to deliberately confirm. `servicePeriodOverlapError` (`lib/invoice-period.ts`) now returns `{kind: 'incomplete'|'overlap', message}` instead of a bare string — 'incomplete' (no readable period at all) still always blocks, only 'overlap' became confirmable. `create-invoice/route.ts`'s `validateRenewalPeriods` returns `{blocking, overlapWarnings}`; a new `overlapConfirmed` request flag lets a resubmission (same `idempotencyKey`, so it reuses the existing `invoice_creation_reservations` retry path — no new reservation plumbing needed) proceed past warnings that would otherwise return `409 overlapConfirmationRequired` with nothing created. Frontend: the amber warning banner stays visible either way, but Generate is no longer disabled by it — clicking pops a confirm dialog (styled after the existing `ConfirmDeleteModal` pattern but inline, since this needed different wording/tone, not a destructive action) instead of submitting; confirming retries with `overlapConfirmed:true`. The server independently re-checks and can pop the identical dialog even if the client's own renewal data was stale and never showed a warning to begin with. **Caught a real bug during review before shipping, not after**: the button used `onClick={createInvoice}` directly — since `createInvoice` now takes an `overlapConfirmed` parameter, React would have passed the click event itself as that argument (always truthy), silently skipping the confirmation dialog on every single first click. Fixed to `onClick={() => createInvoice()}`. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-19 (Fixed false "period overlap" blocks. Vincent showed two real screenshots — DIN FUNG CONSTRUCTION and CBD TECHNOLOGY FOUNDATION — both blocked from generating a genuinely-due renewal with "the proposed period overlaps the latest invoiced period ending [date]", and said he was seeing "很多" (many) of these. Investigated with real production data, not guesses: queried `quickbooks_invoice_items` directly for both companies. CBD Technology's case cracked it open — its real Secretary renewal covers through 2026-06-30 (invoice #02511007), but a one-off "Secretary:CPF Submission" line (invoice #02680010, `classification_source: "description"` — matched the 'Secretary' service pattern purely because the QB item name contains the substring "secretary") has a description mentioning "Jan 2026 - Dec 2026" for its own unrelated calendar-year CPF service — which `parseInvoicePeriod` parses exactly like a real renewal period, into `period_end: 2026-12-31`. Traced the actual mechanism (compiled `lib/invoice-period.ts` standalone with `npx tsc` and ran the real functions against the real stored description strings, rather than reasoning about regexes by eye): `compareRenewalPeriodProductLines` sorted candidate history lines by parsed `period_end` FIRST, using `isPrimaryRenewalProduct` only as a tie-breaker — so the bogus, later-sorting Dec-2026 date from the CPF line silently outranked the real Jun-2026 renewal, everywhere this function is used: the renewals-status computation (`app/api/billing/renewals/route.ts` — Billing/AR Reminder's "Expired Xd ago" badges and auto-proposed next period) and, separately, `create-invoice/route.ts`'s own hand-rolled duplicate of the same sort inside `validateRenewalPeriods`. Fixed by flipping the priority — primary-product-ness decides first, period_end only breaks ties among lines that are equally primary (or equally not), the one case where "latest period wins" is actually correct — and refactored `validateRenewalPeriods` to call the shared, now-fixed function instead of maintaining a separate copy that could drift again. Verified the fix directly against the real competing rows (not just re-reading the diff) before shipping: recompiled and confirmed the real 2026-06-30 renewal now correctly outranks the bogus 2026-12-31 CPF line. The DIN FUNG case turned out to be a *different*, genuine issue — two real, correctly-classified Secretary invoices (#02610677 June, #02610947 August) already cover the exact same period, an actual duplicate needing a QuickBooks-side fix (void one), not something this bug or its fix touches — flagged to Vincent separately rather than papered over. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-18 (Edit an un-sent, system-created QuickBooks invoice — Vincent: staff sometimes spot a mistake right after generating (wrong rate, a line that shouldn't be there) and currently have to go into QuickBooks itself to fix it. Explicitly scoped down when asked: only invoices this system created, not yet sent to the client — asked via AskUserQuestion, not assumed. Used Plan mode for this one given the scope (new QB write capability, financial data) — plan researched via a Plan agent, verified its file/schema claims directly (`generated_invoices` columns, `email_drafts.invoice_refs`'s `InvoiceRef` shape) before trusting them, one clarifying question asked (Edit replaces Generate once an invoice exists, confirmed) before writing the final plan and getting ExitPlanMode approval.

Prerequisite refactor: extracted `findCustomer`/`getItemMap`/`findLocation`/`pickItem`/`requiresPicClass`/the Line-array builder (now `buildInvoiceLineArray`) out of `create-invoice/route.ts` into `lib/qb-invoice-conventions.ts`, so create and edit build a QB invoice's lines identically instead of risking drift between two copies. Surfaced and fixed a real pre-existing gap while moving them: that lib's own `QB_BASE` never respected `QB_ENVIRONMENT=sandbox`, unlike `lib/quickbooks.ts` — the functions moving in previously did respect it in their old home, so the move would have quietly dropped sandbox support for them.

New `PATCH /api/quickbooks/update-invoice`, gated three ways before it ever touches QuickBooks, nothing trusted from the client: (1) structural — refuses unless a matching `generated_invoices` row exists (`qb_company`+`qb_invoice_id`), so a manually-created QB invoice can never be reached through this route regardless of what id is sent; (2) sent — refuses if any `email_drafts` row with `status='sent'` has this exact `qb_invoice_id` in its `invoice_refs` array (per-invoice, not just "some AR email went to this company this cycle" — a company can have a TAB invoice already emailed and a separate TAC one that isn't); company-name matching uses `lib/company-name.ts`'s `normalize()`, the one canonical normalizer, not a fresh one; (3) payment — a live QB read right before writing refuses if `Balance !== TotalAmt` (anything paid/credited) or the invoice is voided — an addition beyond what was literally asked, directly addressing Vincent's own stated worry about partial payment. The write is a QB sparse update (`Id` + live `SyncToken` + `Line` only) — `CustomerRef`/`TxnDate`/`DocNumber` are never included in the payload, so QB can't change them regardless of what's sent; on success, proactively calls `syncQuickBooksInvoiceChanges` (already-existing webhook-sync internals, exported `classify()` from it for reuse) so the local mirror updates immediately rather than waiting on the webhook round-trip. New `GET /api/quickbooks/invoice-lines` reads an invoice's current lines live, separately, with no gate (reading is always safe — only the write needs the safety checks). Both new routes validate `qbInvoiceId`/`id` as a plain digit string before interpolating into the QBQL query, tighter than the pre-existing `refresh-amounts` route's same pattern, given this route can write.

Frontend: `app/billing/page.tsx`'s "Build & generate invoice" panel (`ExpandedBillingRow`) now switches a company's section straight to "Edit invoice" once one exists for that company+cycle (confirmed with Vincent: Generate is no longer offered for that company+cycle once one exists), pre-filled from the live QB lines instead of the historical template (`initialLines`), with its own "Save … changes" button — TAB and TAC toggle independently via `tabInvoice`/`tacInvoice` derived from the existing `generatedPdfs` state. The combined bottom Generate button now only creates invoices for whichever side doesn't have one yet (`needsGenerateTab`/`needsGenerateTac`), and disappears entirely once both sides already exist. Caught and removed a piece of genuinely dead state during review — `editSyncToken` was written but never read, since the update route always re-reads the invoice's current SyncToken itself right before writing; the client never needed to track it.

**Deliberately not tested against a real QuickBooks invoice** — build/type-check verified clean, but an actual live write to production financial data is Vincent's call to make himself, on a real cycle, same reasoning as not triggering a real email send earlier this session. Asked him to try it and report back. `npx tsc --noEmit` and `npm run build` both clean throughout.

Previous update: 2026-08-18 (Fixed Billing Drafts' row tint — shipped earlier today (green sent / amber drafted) but Vincent reported rows never turned amber after drafting. Root cause: `.system-list-row`'s own `background: ... !important` in `globals.css` was silently beating the feature's inline `style={{background: draftRowBg}}` the whole time — it only ever looked like the pre-existing `isOpen` blue highlight worked via inline style, when that was actually coming from the `.system-list-row--selected` class (same `!important` tier, so IT was winning, not the inline background). Exactly the collision an AR Reminder comment elsewhere in this file already warned about — missed applying that same lesson here. Fixed the same way `--selected` does it: two new real classes (`.system-list-row--draft-sent`, `.system-list-row--draft-pending`), each with their own `!important` background, toggled onto the row instead of an inline style; `isOpen` still takes priority when a row is both expanded and has a draft. Diagnosed via direct DB query (confirmed real `email_drafts` rows existed with the right company name and cycle, ruling out a data/matching bug) before finding the actual CSS cause. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-18 (Draft Helper v1.5.4 — two fixes to the payment image, both caught from Vincent reviewing a real received copy. (1) Gmail still listed `payment_options.png` as a separate downloadable attachment ("3 Attachments") even though it also rendered inline — `PR_ATTACH_CONTENT_ID` alone isn't sufficient for every client to treat it as purely inline; added `PR_ATTACHMENT_HIDDEN=True` (proptag `0x7FFE000B`) on that one attachment only, the standing Bank Details PDF stays a normal visible attachment. (2) Vincent asked for an explicit 14cm x 7cm size — first attempt used CSS `style="width:14cm;height:7cm"`, which Outlook's own HTML renderer (Word-based, not a browser engine) silently ignores on `<img>`, just showing the native pixel size instead — caught immediately from Vincent's own screenshot of Outlook's Picture Format panel showing 46.95 x 23.47cm, exactly the source file's 1774x887px at 96 DPI. Fixed by switching to the classic `width`/`height` HTML attributes in pixels (529x265, the 96-DPI equivalent of 14cm/7cm) — that's what Outlook's renderer actually respects — kept a matching CSS style too for any other client that reads inline style instead. Verified visually this time (not just by reading the HTML back, since that already looked "correct" once before and still rendered wrong) — screenshotted a real unsent test draft and confirmed the image renders compact now. Both fixes landed before v1.5.4 was ever pushed/deployed, so no staff downloaded the broken CSS-only intermediate. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-18 (Draft Helper v1.5.3 — Vincent: 字体 Arial, 大小 10. Previously only templates reaching `PAYMENT_MARKER` got an HTML body at all (to embed the payment image) — everything else used plain `.Body`, which carries no font metadata and just renders in whatever font each individual staff machine's own Outlook default happens to be, so drafts looked inconsistent depending on who sent them. `_set_body` now always builds an HTML body wrapped in a fixed `font-family:Arial,sans-serif;font-size:10pt` div regardless of the payment marker. Verified via COM, not just visually — opened a real (unsent, discarded) test draft with no payment section and read `HTMLBody` back directly to confirm the exact style attribute landed. **Also flagged, not yet resolved**: Vincent showed a screenshot with "From: contact@tassure.com" selected and reiterated the From should default to finance@tassure.com — checked both live sender-default code paths (Billing Drafts' quick-envelope, `app/billing/page.tsx`'s `senders.find(s => s.is_default)`; Campaign Centre's picker, `campaigns/page.tsx`'s identical pattern) and both already correctly resolve to finance@tassure.com (`email_senders.id=1`, `is_default=true`) — couldn't reproduce contact@tassure.com as a default from the code as it stands. Likely candidates not yet checked: History's "reopen in Outlook" flow intentionally defaults to whatever sender the campaign was *originally* created with (`reopenSenderEmail` ← `campaignSender`), not the global default — that's by design, not a bug, if that's what the screenshot was showing. Asked Vincent to confirm which page. Bumped `VERSION`/`LATEST_HELPER_VERSION` to 1.5.3 together, rebuilt, shipped.

Previous update: 2026-08-18 (Draft Helper v1.5.2 — swapped `payment_options.png` again, this time to Vincent's own `Desktop\PAYNOW.png`, overriding the v1.5.1 fix below. Checked it first the same way as before (pyzbar + OpenCV, several scales) — it has the exact same problem, doesn't decode as a QR at all. Told Vincent directly before touching anything. His reply: "你不需要扫得出来，我就是要这张图片" (it doesn't need to scan, I just want this image) — his own company's payment collateral, his call once he's been told the tradeoff, not something to keep pushing back on. Swapped it in as-is, no re-compositing this time (unlike v1.5.1, no attempt to preserve/repair scannability, since that's explicitly not wanted). Bumped `VERSION`/`LATEST_HELPER_VERSION` to 1.5.2 together, rebuilt, shipped.

Previous update: 2026-08-18 (Draft Helper v1.5.1 — the payment QR code didn't actually scan. Vincent, after seeing a real AR reminder draft, asked whether the embedded image was really his own PayNow QR since it "看起来很模糊不清晰" (looks blurry/unclear). It was his own image (content matched exactly), but investigating turned up something more serious than blur: `payment_options.png` (479x215, the QR itself only ~76x72px within it) failed to decode as a QR code at every tested scale, with two independent decoders (OpenCV and pyzbar/ZBar) — the actual module data had been destroyed by whatever compressed the file originally, not just visually soft. This is a real client-facing bug, not cosmetic — every AR reminder sent through the Helper has been shipping a QR that doesn't scan. Given this touches real payment routing, verified extremely carefully before changing anything: rendered the official `Bank Details 2026 - Tassure Group.pdf` at 600 DPI, extracted its QR at full resolution, decoded it to confirm the exact PayNow payload (merchant "TASSURE ASIA BIZSERVICES", ID 201325157G) matches what's printed in both the PDF and Vincent's own screenshot — only then rebuilt `payment_options.png` at 4x the old file's linear size (composited: the original text upscaled to avoid any risk of a transcription error on bank details, with the QR region replaced by the freshly-verified crisp crop), and re-verified the new composite still decodes correctly. `app.py`'s `_set_body` now sets an explicit `width="700"` on the embedded `<img>` so the email's on-screen layout looks the same as before — only the underlying resolution changed. Verified live: rebuilt the exe, opened a real (unsent, discarded via COM automation, never touched Send) test draft, screenshotted the actual Outlook compose window to confirm the payment block now renders sharp. **Aside, worth remembering**: mid-verification, an attempt to screenshot-scroll the test draft via simulated mouse/keyboard input misfired onto an unrelated window (another Claude Code session's own UI) instead of Outlook — stopped that approach immediately and switched to precise COM automation (`.Close(1)`, olDiscard) to close the test draft safely instead of further simulated input. Bumped `VERSION`/`LATEST_HELPER_VERSION` to 1.5.1 together — staff on 1.5.0 need to redownload to actually get the fix. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-18 (Draft Helper v1.5.0 — auto-detect real Outlook sends. Vincent asked whether the system can tell a draft was actually sent, not just opened — answer at the time was no: `.Display()` never calls `.Send()`, and the only path to status `sent` was a human manually clicking "Mark as Sent" in Delivery History. Vincent: "直接做真正的自动侦测发送功能" (just build the real automatic detection). Design: `draft-helper/app.py` tags every MailItem it creates with the draft's own database id via a hidden MAPI property (`DRAFT_ID_PROP`, a fixed custom GUID), then keeps a long-lived `Outlook.Application` COM event connection open on its own background thread (separate from the short-lived one `/drafts/open` uses per-request) so `ItemSend` fires even hours later when staff finally hit Send. On a tagged item's `ItemSend`, it POSTs to a new `POST /api/client-communications/drafts/mark-sent` (`app/api/client-communications/drafts/mark-sent/route.ts`) — idempotent, leaves already-sent/skipped rows alone. **Real blocker found and fixed along the way**: `proxy.ts` requires a Tassure login session on every API route, which a background COM event thread obviously doesn't have — added a `DRAFT_HELPER_SECRET` bearer-token bypass for this one path, matching the existing `CRON_SECRET`/`CRON_PATHS` pattern already used for scheduled jobs; added the env var to Vercel directly via the API (Vincent's explicit choice when asked, over doing it manually himself) and baked the same value into `app.py`. **Second real blocker found and fixed**: `DispatchWithEvents` (needed to catch `ItemSend`) requires a generated Python wrapper for Outlook's COM type library — generating one fresh works fine unpackaged but throws `ModuleNotFoundError` inside the frozen PyInstaller exe (reproduced directly, twice, on a fully wiped gen_py cache — PyInstaller's import system can't pick up a module written to disk mid-run). Fixed by pre-generating the wrapper once and shipping it as bundled data (`draft-helper/outlook_gen_py_cache/`, `--add-data` in `build.ps1`) — required also directly overwriting `sys.modules["win32com.gen_py"].__path__` at runtime, since merely reassigning `win32com.__gen_path__` doesn't retroactively affect it (`win32com`'s own `__init__.py` already freezes that path into `gen_py.__path__` at first `import win32com`, before any of this app's own code runs). Documented the whole mechanism and how to regenerate it in `BUILD.md`, since it'll need touching again if Outlook's typelib version ever changes enough to break it. Explicitly designed so a total failure here (missing Outlook, a version mismatch, COM registration failing for any reason) degrades silently — send-detection just doesn't activate that session, and the existing manual "Mark as Sent" fallback still works; the core open-draft feature everyone uses daily never depends on any of this. Verified everything short of an actual send myself (deliberately — sending real mail isn't something to trigger without a human actually choosing to): COM event registration succeeds on a fully wiped cache in both dev and the frozen exe, the draft-id property round-trips correctly through a real Outlook compose window, and the mark-sent callback reaches the deployed endpoint correctly (404 for a fake id, proving the secret auth path works end to end). **Still needs**: one real send-to-self test from Vincent to confirm the last untested link (a real `ItemSend` firing and correctly reading the property back) — flagged to him directly, not yet confirmed. Bumped `app.py`'s `VERSION` and `lib/draft-helper-client.ts`'s `LATEST_HELPER_VERSION` together to 1.5.0, rebuilt, shipped. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-18 (Draft Helper source now under version control. Follow-up to the v1.4.1 fix below — its own history noted the Python source had apparently never been committed to any git repo, only the compiled `.exe`. Vincent: "那就加进去吧" (add it in). `gh` CLI isn't available on this machine (checked both Bash and PowerShell), ruling out spinning up a separate dedicated repo matching the "one tool = one repo" convention used elsewhere — committed the source into this repo instead, alongside the exe it already ships. New `draft-helper/` folder: `app.py`, `main.py`, `requirements.txt`, `TassureDraftHelper.spec`, `build.ps1`, `BUILD.md`, `assets/` (payment-options image + standing bank-details PDF). Deliberately excluded `__pycache__/`, `build/` (46MB PyInstaller intermediate cache), `dist/` (35MB, the exe itself — already tracked separately under `public/downloads/`), and four transient `.log` files — none of that is source. Added a note at the top of `BUILD.md` that the actual day-to-day working copy stays `C:\Users\vincent\tassure-draft-helper\`; changes there should be copied back into this folder and committed after they're confirmed working, so this copy doesn't silently drift from what's shipping. This is a backup/continuity measure only — the build/ship workflow itself is unchanged.

Previous update: 2026-08-18 (Draft Helper v1.4.1 — fixed a real silent-failure bug, not a stale-install issue. Vincent reported a staff member downloaded `tassure-draft-helper` multiple times (browser duplicate filenames confirmed this) and clicking it did nothing every time. Investigated live on Vincent's own machine: the running Helper was already the latest version (1.4.0) with the payment-image asset correctly bundled — ruled that theory out directly via `/health` and by inspecting the PyInstaller onefile's live runtime-extraction folder. Root cause was actually in `main.py`: `if _already_running(): sys.exit(0)` had zero user feedback — since the Helper auto-starts at every Windows login, re-downloading and double-clicking almost always hits this exact silent-exit path, with the already-running copy's tray icon easy to miss (hidden behind the "^" overflow arrow by default). Fixed by adding a native `MessageBoxW` (no new dependency) explaining it's already running and where to find it. Verified directly: launched a second copy against a running instance, confirmed the dialog now actually appears, then closed it. Rebuilt, bumped `app.py`'s `VERSION` and `lib/draft-helper-client.ts`'s `LATEST_HELPER_VERSION` together (bumping only one would silently break the existing "your Helper is outdated" banner for anyone still on 1.4.0) to 1.4.1, copied `dist/TassureDraftHelper.exe` to `public/downloads/TassureDraftHelper.exe` per `BUILD.md`'s own release process. Verified post-deploy that the live download link serves the new build (`Content-Length` matches the local file exactly once past a stale CDN edge-cache hit). **Separately noted, not yet acted on**: `tassure-draft-helper`'s Python source has apparently never been committed to any git repo — only the compiled `.exe` is tracked, via this repo. Worth flagging to Vincent as a standing risk (source-only-on-one-machine) independent of this fix.

Previous update: 2026-08-17 (Empty Remarks placeholder reverted to the standard "—" instead of the custom "Type your remarks…" text added a turn earlier.

Previous update: 2026-08-17 (Billing Drafts Remarks -> always-visible auto-growing textarea. Vincent, referencing a screenshot of Late Filing's own remarks box: wanted the same look, not the click-to-reveal single-line input every other `EditField` use gets. Added a `multiline` prop to `EditField` instead of a separate component, so it keeps all the existing PATCH/optimistic-update/conflict handling — when `multiline`, the field starts (and stays, unlike every other field) in its "editing" render, now a second branch rendering a `<textarea>` (auto-grow logic borrowed from this file's own `AutoTextarea`) instead of the single-line `<input>`; save still fires on blur, just without collapsing back to a plain span afterward. Every other `EditField` call site unaffected — `multiline` defaults to `false`, a no-op through every changed line. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Custom Remarks column on Billing Drafts. Vincent: free-typed, right after PIC. New `ar_reminder.billing_remarks` column (`scripts/add-ar-reminder-billing-remarks.sql`, Vincent ran it, confirmed live via the PostgREST OpenAPI spec before deploying) — deliberately separate from the existing `remarks`, which already drives the AR Reminder tab's TERMINATED/STRIKE OFF/AR COMPLETED dropdown and whole-row tint; sharing it would let a billing note collide with that compliance-workflow status. Each Billing Drafts row's `companyId` is the underlying `ar_reminder` row's own id (already established by `arToBillingRow`'s existing comment), so this is just `'billing_remarks'` added to `EDITABLE_FIELDS` and a new `handleArSave` callback keeping `arList` (and therefore `monthCompanies`, derived from it) in sync after a save — no new API route. Widened the desktop grid by one 160px column, inserted 'Remarks' into the header between PIC and the action column, wrapped the cell in `stopPropagation` since the row itself is click-to-expand. Verified end-to-end post-deploy with a real write/read/revert against a live row (`ar_reminder.id=901`). `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Billing Drafts PIC display fix. Vincent noticed the Billing Drafts tab showed raw PIC shorthand ("shi ming", "jenny", "shemin") — the exact same messy-shorthand-vs-display-name problem just fixed in the Excel export, except this was the live UI. AR Reminder's own List view already ran `r.pic` through `formatStaffName()`; Billing Drafts' three PIC display spots (desktop row, mobile card, `ExpandedBillingRow`'s "SEC / XBRL PIC" line) never did — a plain oversight, not a deliberate difference. Fixed all three. Left the one non-display PIC reference (the `/api/quickbooks/create-invoice` request payload) untouched — QuickBooks needs the raw value for its own PIC/Class matching, formatting it there could break invoice generation. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Two follow-ups. (1) Removed Status and Last Updated columns from `AR_REMINDER_COLUMNS` (`lib/export-columns.ts`) per Vincent — affects both export routes since they share the column list. (2) Data fix, not code: Vincent noticed May 2026's AR cycle had no FYE Date. Found all 31 May-2026 `ar_reminder` rows (plus 1 stray April-2026 row) had `fye_date = null` — every other cycle across the whole table was fine, isolated to this one batch (`created_at` identical across all 31, 2026-06-30, so a one-off gap in whatever generated them, not the current code — both the regular `/generate` insert path and the catch-up path already set `fye_date` correctly today). Backfilled safely: recomputed each row's FYE date from `companies.fye_day` (same `fyeDateFor()` formula the app itself uses) and only wrote it where the recomputed value's derived due date matched the row's own already-stored `due_date` exactly — 32/32 rows passed this cross-check with zero mismatches, so nothing was guessed. Verified post-write: 0 rows with null `fye_date` remain anywhere in the active table.

Previous update: 2026-08-17 (Excel export formatting fix: real names, real dates, left-aligned. Vincent showed a screenshot of raw SEC/ACC/TAX PIC values in the export — "jenny", "shi ming", "Shi Ming Ang", "Jay" — none matching what the app itself shows for those same records. Root cause: the free/community `xlsx` package (still used elsewhere for *reading* uploaded workbooks) silently drops cell styling on write — confirmed by unzipping a generated file, no `s="..."` on any cell and no alignment entries in `styles.xml` even with `cellStyles: true` passed. "全部列向左对齐" was never actually going to work through it. Switched `lib/export-columns.ts` to `exceljs` (new dependency; verified it actually persists alignment before trusting it — same raw-XML check, this time `styles.xml` has a real `<alignment horizontal="left"/>` entry referenced by every cell). `ExportColumn` gained an optional `format`: `'date'` runs the same `toDisplayDate()` the app uses everywhere ("D MMM YYYY", falling back to raw text for a non-date value like Report Ready's "DORMANT"), `'staffName'` runs `formatStaffName()` — tagged on every PIC/ND/Secretary/Contact-Window/Add-@ column in both the AR Reminder and Active Client column sets, not just the ones in the screenshot, since they're the same underlying problem. Both export routes moved to the new async `buildWorkbook()`. Hand-traced `formatStaffName` against all 8 raw values from Vincent's screenshot before reporting the fix (jenny→Jenny Lai, shemin→Tey Shemin, shi ming→Ang Shi Ming, Shi Ming Ang→Ang Shi Ming via word-order-independent match, Jay→Jay Tay, Vernice→Vernice Chai, DORMANT/dormant→Dormant now consistent, Client→Client). `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Export Excel on AR Reminder. Vincent: left side of the toolbar, downloads exactly the FYE cycle currently selected. New `GET /api/ar-reminder/export?month=&year=` mirrors `GET /api/ar-reminder`'s own filtering (`fye_month`/`fye_year`, exclude soft-deleted rows) so the file can't drift from what's on screen. Extracted the AR Reminder/Active Client column lists and the sheet-builder out of `company-data/route.ts` into `lib/export-columns.ts`, shared by both this new route and the existing Dashboard export — one column definition instead of two that could quietly diverge. Button styled after the Dashboard's "Export Company Data" (same teal, same `FileSpreadsheet`+`Download` icons). Verified post-deploy that both export endpoints still respond correctly unauthenticated (401 from `proxy.ts`, not a 500 — confirms the `company-data` refactor didn't break anything). `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Report Ready dropdown: date / DORMANT / custom. `ar_reminder.prepared_date` was a strict `date` column, so this needed a real migration first — `scripts/alter-ar-reminder-prepared-date-to-text.sql` (Vincent ran it in Supabase SQL Editor; confirmed live via the PostgREST OpenAPI spec, format changed `date` -> `text`, before deploying any code that depends on it). Moved `prepared_date` from `STRICT_DATE_FIELDS` to `DATE_OR_STATUS_FIELDS` server-side (same bucket XBRL's "NO"/"FULL" already uses — normalizes to ISO when the input parses as a date, accepts it as-is otherwise) and out of `DATABASE_DATE_FIELDS` now that the column itself is text. Added a `plainDates` prop to `SelectField` (narrower than the PIC dropdowns' `plainDisplay`): only a date-shaped value renders plain, a matched preset chip (DORMANT, amber) still keeps its color. Applied in both the table and the modal's Progress section (pulled out of its generic date-fields loop, same treatment PIC fields got in the Team section). Verified end-to-end post-deploy with a real write/read/revert against a live row (`ar_reminder.id=137`): wrote `"DORMANT"`, confirmed it read back correctly, reverted to the original value, confirmed the revert matched exactly. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Restricted 5 accounts to AR Reminder only. Vincent: Jay Tay, Lee Jing Fei, Tee Yu Heng, Vernice Chai, Chee Wei En should only ever see AR Reminder — everything else in the system hidden. New `restrictedTo` field on `ApprovedAccount` (`lib/approved-accounts.ts`) holding a single allowed page (path + required query params, since AR Reminder is `/billing?tab=ar` — a tab on the Billing page, not its own route). Enforced in two places sharing one `isWithinRestriction()` helper so they can't drift apart: `proxy.ts` redirects any page navigation outside the allowed page back to it (page nav only — API routes stay reachable, since this is a display restriction per Vincent's own wording, not a data-security lockdown, and locking down APIs risked breaking the allowed page's own fetches); `Sidebar.tsx` renders only that one nav item for a restricted account via a new `level1For()` helper, so there's nothing to click into that would just bounce back. `/api/auth/me` now returns `restrictedTo` so `AppShell` can pass it down to `Sidebar`. Given `proxy.ts` runs on every request for every user, verified the path/query matching logic against 6 cases in isolation (exact match, missing tab, wrong tab, dashboard, an unrelated page, allowed plus an extra param) before trusting it, then smoke-tested production post-deploy (unauthenticated requests still redirect to `/login` correctly, no 500s) — a bug here risks locking out everyone, not just these 5. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Added the rest of the Accounting team to tassure-invoice login access: Lee Jing Fei, Tee Yu Heng, Vernice Chai, Chee Wei En — the same 4 names (plus Jay Tay, added earlier) used to build the ACC PIC dropdown. No `qbLocations` entry, same as Jay Tay. Only added to `lib/approved-accounts.ts` (tassure-invoice) this time, not the separate Proposal Generator project — that was a distinct, explicit ask for Jay Tay specifically, not implied here.

Previous update: 2026-08-17 (Widened the expanded SEC/ACC/TAX PIC columns from 100px to 120px — single shared width in `picHeader()`, applies to all three. Collapsed width (34px) unchanged.

Previous update: 2026-08-17 (PIC dropdown follow-up: "Client" option + plain display. Vincent, after seeing the three PIC dropdowns: no grey chip outline once a value is picked — just plain text next to the dropdown arrow, matching how a free-typed custom value already rendered. Added a `plainDisplay` prop to `SelectField` that skips the chip/date-chip branches for the CLOSED state only (the open picker menu still shows each option as a chip, unaffected — only the selected/closed display changed). Applied to all three PIC dropdowns (table + modal). Also added "Client" to all three option lists — a real pre-existing non-person value already documented in `lib/staff-directory.ts`'s own comment ("Client"/"dormant"/"Waiver"/... deliberately left unmatched), not a new concept. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (AR Reminder SEC/ACC/TAX PIC dropdowns. Vincent gave exact per-column option lists — SEC PIC: Lim Hoe Chyi/Hoo Seng Xin/Jenny Lai/Chin Kah Ye/Ang Shi Ming/Tey Shemin/Tan Min Quan; ACC PIC: Jay Tay/Lee Jing Fei/Tee Yu Heng/Vernice Chai/Chee Wei En; TAX PIC: Clarence Saw/Quinnie Tan/Victoria Yap — matching `lib/staff-directory.ts`'s own groupings exactly, plus a plain "Custom…" free-text option, explicitly no semantic color (neutral grey chip for every option, unlike Remarks/XBRL/DPO/ROND). Replaced the free-text `EditField` with `SelectField` in both the table (`ARTableView`) and the detail modal's "Team" section — same fields, kept both editing surfaces consistent rather than leaving the modal as plain text. Added a `formatDisplay` prop to `SelectField` so a messy legacy value ("JF", "Kah Ye Chin") still normalizes through `formatStaffName()` before chip-matching — the same normalization `EditField` used to do inline for exactly these three fields; removed that now-dead special case from `EditField` since nothing calls it with `pic`/`acc_pic`/`tax_pic` anymore. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-17 (Added Jay Tay's login access. Vincent: he's already known to `lib/staff-directory.ts` for PIC name-matching, but that's unrelated to login — the real gate is `lib/approved-accounts.ts`'s `APPROVED_ACCOUNTS`, checked in `app/auth/callback/route.ts` right after Google OAuth completes. Added `{ name: 'Jay Tay', email: 'jaytay@tassure.com' }`, no `qbLocations` entry since he doesn't handle QuickBooks PIC billing (matching the other accounts without one). Also added to the separate Proposal Generator project (tassure-contracts-web) earlier the same day — see that repo's own history, not tracked here.

Previous update: 2026-08-17 (Login page subtitle fix. `app/login/page.tsx` said "Tassure Review System" — a pre-existing copy-paste leftover, unrelated to any other project — while every other branding spot in this app (`layout.tsx` title, `AppShell.tsx` header, the in-app assistant's system prompt) already correctly said "Tassure Corporate Services System". Surfaced while investigating a naming collision Vincent caught between this app and the separate Tassure Review System project (repo `Review-Form`, see its own memory) — that collision was resolved by reverting an unrelated rename there, not by touching this app. Fixed this one line to match the rest of this app's own established branding.

Previous update: 2026-08-13 (AR Reminder Remarks dropdown + row tint. Vincent: convert the AR Reminder table's free-text Remarks column into a dropdown — TERMINATED / STRIKE OFF / AR COMPLETED as quick-select presets, plus a "Custom…" option for free-typed text (same interaction pattern already used for XBRL/DPO/ROND, referencing a screenshot of that exact component) — with a special rule: selecting TERMINATED or STRIKE OFF turns the whole row grey, AR COMPLETED turns it green, and a free-typed custom remark leaves the row unchanged. Confirmed first that `remarks` is already plain free text server-side (not in `STRICT_DATE_FIELDS`) and that the legacy "⚠ LATE FILING: Overdue X days" / "Source status: ..." values already sitting in the column came from a one-off import script (`scripts/import-ar-reminder-workbook.py`), not any live automation — so switching the editor to a constrained dropdown carries no risk of an automated process clobbering a manual selection. Extended the shared `SelectField` component with `customLabel`/`dateHelper` props so the same component can offer a plain "Custom…" trigger instead of the existing "Date / custom…" one (XBRL/DPO/ROND keep their original label via the new props' defaults). Row tinting is applied via a new `tint` prop threaded through every `<TD>` in the row rather than styling the `<tr>` itself — `globals.css`'s `.system-list-row { background: ... !important }` would silently win over a `<tr>`-level inline override, so every cell (including the sticky and finance-tinted ones) gets its own explicit background instead. `npx tsc --noEmit` and `npm run build` both clean.

Previous update: 2026-08-13 (AR Reminder "Reminder" column automation. Vincent: pull TeamWork's own "Reminder dates" column into the AR Reminder page's existing "Reminder" column (`reminder_note`), same request referencing a real TeamWork screenshot showing `Event Type | FY | FYE Date | Sent Date | Due Date | Held Date | Filling/Completed Date | Reminder dates | Action`. Confirmed via live `company_agm/agm_list_ajax` fetches that the Reminder-dates cell is index 7 of each event row, populated on AGM events only (AR events always leave it blank), and can hold more than one `<br>`-joined dd/mm/yyyy date. Implemented as a straight extension of the same `sync-workflow` cycle-matching logic already fixed today for `date_of_agm`/`filling_date`: added `reminder_note_manual` (new column, `scripts/add-ar-reminder-note-manual-flag.sql`, run by Vincent in Supabase SQL Editor — same shape as the existing `date_of_agm_manual`/`filling_date_manual`) so a direct staff edit on the Reminder cell is never overwritten and clearing it hands control back to automation; `latestReminderIso()` splits multi-date cells and keeps the latest; reconciles both directions (fills a new value, clears a stale one back to null) exactly like the ghost-date fix above. `billing/page.tsx` shows the same blue `AutoFillDot` used for date_of_agm/filling_date, with matching optimistic-update handling. Sequenced deploy correctly around the new column: held the code (unpushed) until Vincent confirmed the SQL had run — pushing `sync-workflow`'s new `.select(...)` before the column existed would have 500'd the ENTIRE route, breaking date_of_agm/filling_date reconciliation too, not just this feature — verified the column existed live before deploying. First full production run after deploy reported 0 changes despite spot-checking a company (MEGASTAR SHIPPING) with clearly matching live TeamWork data — a deployment-propagation race (the same stale-instance pattern hit once earlier this session), confirmed by a scoped re-run (`?month=December&year=2025`) succeeding immediately after. Re-ran the full pass once deployment had settled: 656 of 841 rows updated, 0 errors, 0 conflicts; `reminder_note` population went from 151/841 to 761/841 (the remaining 80 have no matching AGM reminder date in TeamWork yet — future cycles TeamWork hasn't generated a reminder for, expected to fill in as their cycles approach). `npx tsc --noEmit` clean.

Previous update: 2026-08-13 (AR Reminder ghost-date reconciliation bug. Vincent reported KANG HUA CONSTRUCTION's Master List row showing red AGM/AR mismatch badges that "看起来放错日期了" (looked like the AGM and AR columns had their dates crossed). Investigated with a live TeamWork fetch (`company_agm/agm_list_ajax`, 14 raw events) against `ar_reminder` row id 144: Master List's own `last_agm_date`/`last_ar_date` (28 Nov / 26 Dec 2025) were correct — exact match to TeamWork's real latest completed (FYE-2025) cycle. But the `ar_reminder` row's `date_of_agm`/`agm_held_date`/`filling_date` (30 Dec 2025 / 23 Jan 2026) matched NOTHING in TeamWork's current 14-event history at all — a "ghost" value, not a real cycle. Root cause: `ar-reminder/sync-workflow` only ever wrote a Held/Filing date forward when TeamWork showed a new one; if TeamWork's own entry was later corrected back to blank (e.g. staff had mis-keyed a date onto the wrong FYE cycle, then fixed it), the stale synced value stayed in `ar_reminder` forever with no manual flag to explain it — not just a cosmetic badge issue: `billing/page.tsx`'s AGM Held/AR Filed workflow stages are derived straight from these same fields being non-null, so staff could see a cycle marked "already done" that TeamWork itself no longer shows as done. Fixed `sync-workflow/route.ts` to reconcile in both directions: when a same-cycle TeamWork event is found this run, its own Held/Filing field is now authoritative — blank clears a previously-synced non-manual value back to null, exactly like a new value gets written forward (never guesses a clear when no matching cycle event was found at all). Also fixed a separate, compounding UI bug in `MasterListTable.tsx`: the AGM-column mismatch badge displayed an "AR:" prefix instead of "AGM:", which is what made the two columns look crossed even before the ghost-data issue. Ran the fixed sync twice in production (scoped to May/2026 to confirm the fix, then a full unscoped pass across all 927 companies/841 active `ar_reminder` rows) — found and cleared exactly 2 affected companies system-wide: KANG HUA CONSTRUCTION and SINO MINING HEAVY INDUSTRIES. Zero fetch/update errors, zero version conflicts on both runs — this was a narrow, occasional edge case (TeamWork data being corrected after a sync captured it), not a widespread backlog, and the nightly cron now self-heals it going forward. `npx tsc --noEmit` clean; both fixes deployed and confirmed READY via the Vercel API before running the production reconciliation passes.

Previous update: 2026-08-12 (ND page + duplicate AR rows, closing out the AR Reminder chain. Vincent: ND page's numbers should match Active Client's "Has Nominee Dir" count. Root cause: the ND page derived "active appointment" purely from nd_appointments' own cessation_date, never checking whether the company itself is still an active CSS Client — an appointment TeamWork never marked ceased can belong to a company that's Struck Off (found live: PRIMATECH). Fixed `app/nominee-directors/page.tsx` + `NDDirectory`/`NDPersonCard` to also require `companies.is_active && client_type==='CSS Client'` (checked directly, not via master_list's separately-synced nd_active flag, which has its own gaps). Verified against real data: 152 vs 145 became 152, with the residual explained by 2 companies pending a sync catch-up + 4 companies whose master_list company_name used non-standard "(FKA...)" formatting ("——FKA", "FKAZHICHUANG" no space, Chinese "旧", "a.k.a") that the shared normalize() didn't recognize — fixed those 4 names directly, and added SINGAPORE MINING SOLUTIONS INVESTMENT (already known missing from Active Client) to master_list. Vincent manually triggered `/api/teamwork/sync` to apply immediately; all 7 confirmed nd_active=true afterward with real data.

That same manual sync run surfaced a second, unrelated real bug: GRAND CHEN RESOURCES showing twice on the AR Reminder page. Root cause: the catch-up pass's "has this company ever had a row" check only looked up ar_reminder by company_id — but 22 legacy rows (from a bulk import that predates that column being populated) had company_id=null, invisible to that check, so catch-up concluded "never generated" and created a second, empty row next to a real one that had genuine staff-tracked progress (accounts_status, ar_status, dpo, PIC assignments). Cleaned up all 22 pairs by hand (linked the real row's company_id, deleted the empty duplicate — preserving every field of real data) plus 3 further orphaned rows with no duplicate. Fixed the route so this can't recur: catch-up now also checks by UEN, and any orphaned row found that way gets its company_id linked on the spot rather than just avoided. `npx tsc --noEmit` clean at every step; deploys confirmed READY via the Vercel API.

Previous update: 2026-08-12 (Vincent: "AR REMINDER页面一直停留在DEC" — Billing/AR Reminder tabs both default to whatever `/api/ar-reminder/latest` returns, which picked the single most-recently-created row in `generated_invoices`. Verified live: staff were still squarely on May 2026 (29 of the last 30 invoices), but one December 2026 invoice for an unrelated company, created 6 days after the last May entry, was that single latest row and hijacked the default for the whole page. Fixed to take the mode (most common fye_month/year) among the last 30 invoices instead — a lone out-of-sequence invoice can no longer flip the default. `npx tsc --noEmit` clean, deploy confirmed READY.

Previous update: 2026-08-12 (AR Reminder generation chain — several real bugs found and fixed while chasing one report. Started with a discrepancy question ("Missing from Active Client" showed 5 when TW Total/list counts only differed by 2): traced to `app/api/master-list/route.ts`'s "TW CSS Clients" card counting matched rows regardless of TeamWork active status, and the "Missing" panel not requiring active status either (one inactive, no-UEN company was slipping in). Fixed both to be active-only, and added a small "Inactive in TeamWork" exception panel next to the TW CSS Clients card so staff can see which Active Client rows now point at a company TeamWork itself shows as no longer active — real data: SHOGUN SPA and FUTURUM SPACE.

Vincent then reported 6 specific companies "missing in June 2026" on the AR Reminder tab. Root cause was real and systemic, not those 6: `/api/ar-reminder/generate` only ever looks 6 months forward from today — any company whose fye_month had already rolled out of that window by the time it first appeared in `companies` never gets a row, not now, not ever. Found 55 such companies system-wide (all `companies.created_at` between 2026-06-17 and 2026-08-07). Added a catch-up pass and backfilled all 55.

That catch-up pass's first version guessed the year from the calendar ("month already past this year -> this year's cycle exists") — wrong for recently-incorporated companies whose FIRST-EVER cycle lands next year. Vincent caught 4 (ALPHA Z, HUAKO KIDS/PHOTO ALPHA/PHOTO BETA) showing FYE 2026 when TeamWork's own record says 2027. Audited all 141 potentially-affected rows (the 55 just backfilled + 86 from an even earlier manual one-off run of `scripts/generate-ar-reminder-month.js` on 2026-07-07, which had the identical flaw) against real TeamWork AGM/AR history: 27 had one unambiguous real cycle exactly a year later and were corrected in place; 4 (PARTICAL TRADING, ARK PARTNERS VCC, NORTHWEST INTERIOR DESIGN, REZNOS DESIGN) had no clean answer in TeamWork at all (stale/multiple years, nothing near 2026-2027) and were excluded for manual review rather than guessed. Rewrote the catch-up pass to fetch each never-generated company's real TeamWork history and only insert when a genuinely open (unheld/unfiled) cycle is found, using TeamWork's own year/date — never a computed guess.

Vincent then asked why PARTICAL TRADING and YAN BIN specifically had no record. PARTICAL TRADING was already-flagged/excluded (expected). YAN BIN was a THIRD related bug: the catch-up pass's "has this company ever had any row" check missed companies whose OLD-month row had been excluded by `sync-workflow`'s FYE self-correction (a 2026-08-11 fix) without a replacement ever being created for the NEW month — same forward-only-window root cause, different trigger. Broadened the check to "has a LIVE row under the company's CURRENT fye_month," which surfaced 2 more (GOLDHILL MEMORIAL CENTRE, SFS CARE) beyond YAN BIN; backfilled all 3 with verified TeamWork data.

Last self-caught bug in this chain: the correction script for the 27 wrong-year rows read TeamWork's own scraped "due date" column directly — AGM rows show FYE+6mo, AR rows show FYE+7mo, and this system's own convention (this file's docstring, every other row in the table) is always FYE+7. All 27 "fixed" rows inherited whichever event happened to match first, off by exactly one month. Recomputed all 27 directly from their already-correct fye_date; fixed the deployed catch-up pass to always compute `addMonths(fyeDate, 7)` rather than trust the scraped column, so it can't recur regardless of which event TeamWork returns first. Final sweep confirmed: 0 companies missing a live row under their current fye_month (besides the 4 correctly-excluded ones), 0 due_date/FYE+7 drift anywhere in the table caused by this chain (6 pre-existing, unrelated discrepancies found and left alone — different subsystems, predate this work). `npx tsc --noEmit`/`npm run build` clean at every step; `scripts/audit-ar-reminder-years.js` and `scripts/fix-ar-mismatch-years.js` kept as reusable tooling for this bug class; a warning was added to `generate-ar-reminder-month.js` so it isn't reached for the same way again.

Previous update: 2026-08-12 (Table-view-only fix on `components/MasterListTable.tsx`: Vincent — "这个ACTIVE CLIENT的TABLE中的那个蓝色打勾去掉，但是LIST那边的打勾保留不变." The table view's Nominee Dir./Secretary columns had their own `CheckSquare` + name rendering; removed the checkbox there, left the List view's compact ND/SEC pills (which use the same `CheckSquare` component elsewhere in the same file) untouched. `npx tsc --noEmit` clean.

Previous update: 2026-08-12 (ND roster follow-up. Vincent showed CHEN DE's TeamWork Director History with two (Proposed)-status Nominee Director appointments (YU AN SHIPPING, TIMES SHIPPING) that weren't showing up in the system, worried the "(Proposed)" status itself was being filtered out. Investigated live rather than assuming: replayed `lib/teamwork-nd.ts`'s exact scrape logic against CHEN DE's real data — the primary filter (`row.role === 'Nominee Director'`) has never cared about Effective vs. Proposed, and both rows' Subrole text came back clean. Confirmed via the database directly that neither row existed yet in `nd_appointments` NOR in the `missing_nominee_subrole` exceptions table — the real explanation was that TeamWork's own Subrole field was genuinely blank until Vincent filled it in moments earlier ("我知道了subrole 刚刚添加上去"), and the system's existing "flag a blank-Subrole appointment for staff review instead of silently guessing" design (already built, not new) had correctly done exactly that. No code bug here — asked Vincent to trigger `/api/teamwork/sync-nd` once now that TeamWork's own data is fixed.

Vincent then asked whether the missing-Subrole check itself runs daily (yes — confirmed via `vercel.json`, same `teamwork_nd` cron, `0 18 * * *`) and whether the two other currently-open exceptions (WANG YIDONG/JIN MU TECHNOLOGY, LIU XIAOMEI/LOYANG GUOAN TRADING) were real or false positives. Verified both against live TeamWork data from TWO sources (the AJAX status-selector endpoint AND each person's own profile page — the field staff actually edit) — both genuinely blank in both sources, confirmed real, not false positives; the detection logic itself needed no fix.

Added a 14th person to Tassure's own ND roster (`nominee_directors`), per Vincent's real TeamWork profile screenshot: LOO HUI CHIN, member_id 3290, one Active appointment (GOLDEN BRIDGE MARTEC PTE. LTD.). Also added a `?member_id=` scope to `/api/teamwork/sync-nd` (previously always synced the full roster) — replace_nd_appointments' own `DELETE ... WHERE nd_id = ANY(p_nd_ids)` is already safely scoped per-person, confirmed by reading its real SQL definition before relying on it, so this was a small, low-risk addition — so a newly-added person's appointments can be confirmed immediately instead of waiting for the next full nightly run, which Vincent asked for directly ("先单独为这个做更新"). `npx tsc --noEmit`/`npm run build` clean; all temporary verification scripts deleted after use.

Previous update: 2026-08-11 (Real, confirmed data bug on the AR Reminder tab — Vincent: a company whose FYE self-corrected JUN→DEC still showed up under BOTH months at once ("明明DEC才是最新的，JUN不应该再出现了"), and asked to investigate the root cause before fixing anything ("我要你先排查为什么会出现在两个不同的FYE先"). Traced precisely, not guessed: `ar_reminder` rows are immutable snapshots — a row's own `fye_month` is set once by `/api/ar-reminder/generate` and never revisited by anything else, including `sync-workflow`'s own FYE self-correction (which only updates `companies.fye_month`, never touches any existing `ar_reminder` row). Meanwhile `/generate` runs daily and, for the company's NOW-corrected month, finds no existing row there yet and creates one — the OLD row under the stale month never gets cleaned up, so the same company shows under both. Confirmed by querying the actual data before touching anything: 14 companies system-wide currently had this exact mismatch (not just the one Vincent found).

Fix, confirmed with Vincent via AskUserQuestion before writing it: `sync-workflow/route.ts`'s FYE-correction block now also excludes (soft-delete via `status: 'Excluded'`, the same reversible mechanism the manual delete button already uses) that company's still-pending (`filling_date` empty) `ar_reminder` rows under the OLD month, logged through `logFieldChange` for the audit trail. Already-filed rows under the old month are real history and are deliberately never touched — only matches by `company_id` + the specific stale `fye_month`. This only prevents the bug going forward (only fires when a NEW correction happens); ran a one-time backfill for the 14 already-affected companies using the identical exclusion logic, verified by re-querying afterward that all 14 succeeded. `npx tsc --noEmit`/`npm run build` clean; temporary diagnostic/backfill scripts deleted after use.

Previous update: 2026-08-11 (Small visual fix on `app/billing/page.tsx`: Vincent, from a screenshot of the Due Date column's green "354d left" pills next to the "Invoiced" pill elsewhere on the same page — "DUE DATE那边的胶囊优化成invoiced 的那种胶囊格式和颜色设计." `DueBadge` (Due Date pills) had its own bespoke solid-colored-background styling; `BillingStatusPill` (what the "Invoiced" pill and others already use) renders white/neutral-bordered with just a colored dot + text. Rewrote `DueBadge` to delegate to `BillingStatusPill` instead of re-implementing a similar look inline, so both stay visually identical going forward rather than needing to be kept in sync by hand. All 5 states (Filed/overdue/due-today/<30d/<90d/else) preserved, only the container styling changed. `npx tsc --noEmit`/`npm run build` clean.

Previous update: 2026-08-11 (The bigger rebuild flagged as in-progress in the previous entry — Vincent pointed at TeamWork's real Shares module (`shares/share_list/<id>`, a per-transaction allotment/transfer ledger, not the company profile page's own "Shareholders Information" table this system had been scraping since early this session) and confirmed directly which source is actually current: "最新股权登记只有WANG WEI，另外一个应该就是历史存档." Investigated and built against real data throughout, not assumptions.

Technical hurdles, each resolved by testing against the real endpoint rather than guessing: (1) the data loads via a POST AJAX call (`shares/load_sahre_list` — TeamWork's own typo) that only fires from real page JS, appearing to need a full Playwright page load per company (which would have been far too slow for the nightly batch) — but the endpoint's own CSRF token field is genuinely blank even after the real page's JS runs, and a plain HTTPS POST with an empty token value works identically (confirmed: real data back, ~250-300ms), so the existing lightweight "one login, many plain requests" architecture still applies. (2) The response is a raw, deliberately-unclosed-`<table>` HTML fragment (zero `</table>` occurrences, confirmed) meant to be dropped into an existing DOM — parsed by finding the NEXT table's own opening tag as the boundary, same pattern already used for `extractOfficerDetails`'s card boundaries. (3) One table per currency actually in use (unused currencies render "Shares not found.."), and a person can have multiple transaction rows for the same current holding (confirmed: WANG WEI's 5,852,120 total is genuinely 2 summed allotments, 10,000 + 5,842,120) — summed per person rather than taking the first row, using the endpoint's own `status=Valid` (Active) scope so the sum reflects current holdings only. (4) The "Total Consideration Paid" cell nests `<a data-content="Cash: X<br>...">` — the `<br>` INSIDE the quoted attribute value broke a naive tag-stripper into treating it as a tag boundary, corrupting the visible text; fixed by blanking quoted attribute values before stripping tags.

Replaced `lib/teamwork-company-profile.ts`'s `extractShareholderShares`/`ShareholderShareInfo` (both fully removed, confirmed no other callers) with `fetchShareRegister`/`ShareRegisterHolding`, run in `Promise.all` alongside the existing profile-page fetch (not after it) so the added latency costs roughly max(profile, shares) rather than their sum. Verified against the real library function end-to-end (not just the standalone prototype) for both 1V Capital and PORTOUT — exact match to the values confirmed by Vincent and by the earlier live-HTML investigation.

`sync-secretary/route.ts` writes the new fields through (`share_certificate_no` is genuinely new — no source ever had it before; `scripts/add-shareholder-cert-no.sql` — not yet run by Vincent). Real, measured end-to-end timing (~750-800ms/company sequential, via the actual `fetchCompanyProfileFull`, not an optimistic isolated estimate) is meaningfully higher than the original ~500ms profile-only baseline, and — flagged honestly rather than assumed safe — this project has no observed data on how this NEW endpoint behaves under real 10-worker concurrent production load, unlike the profile page's own well-established fixed-throughput behavior. Reduced `BATCH_SIZE` 450→280 (conservative on purpose) and added a THIRD nightly cron trigger (02:45 UTC, alongside the existing 18:45/22:45) in `vercel.json` — 3×280=840 comfortably covers the ~783-company roster even if real concurrent throughput turns out worse than the sequential measurement suggests. Explicitly left as a follow-up: check `automation_sync_runs`' actual duration after the first few real nightly runs and tighten/loosen `BATCH_SIZE` from real evidence, not this estimate.

Extended `/api/post-incorporate/enrich` with `teamworkShareholderDetails` (numberOfShares/paidUpCapital/currency/shareCertificateNo per shareholder) and wired it into Post Incorporate: for a Bizfile-matched shareholder, Number of Shares/currency stay authoritative from Bizfile itself (never overwritten — TeamWork only fills the two fields Bizfile has no source for at all, Paid-Up Capital and Share Certificate No.); for one added via the "missing shareholders" popup (no Bizfile data at all), all four now come from this source instead of leaving the row blank. Corporate shareholder cards ("Corporate Shareholders" cardType, e.g. XINGLONG SGP/CHINA PRECISION MATERIAL from the earlier "missing" popup investigation) use an entirely different field set (Reg.No, no personal fields) not covered by this pass — still out of scope, individual shareholders and the share register itself only. `npx tsc --noEmit`/`npm run build` clean.

Previous update: 2026-08-11 (Vincent: "Paid up capital那边的currency要按照BIZFILE的，BIZFILE那边已经写了shareholder的是（CHINA YUAN RENMINBI），但是系统还是显示（SINGAPORE DOLLAR）." Real bug chain, all three layers: `extractShareholdersFromItems`'s currency detection was hardcoded to only ever recognize "SINGAPORE DOLLAR"/"SGD" — any other currency (confirmed: a real CNY-denominated shareholding) silently came back as an empty string; `parse-bizfile/route.ts`'s shareholders mapping then discarded `currency` entirely, never including it in the API response at all; and the frontend's Paid-Up Capital field had a literal hardcoded `"SINGAPORE DOLLAR"` JSX string, not derived from any state. Fixed generically rather than adding more hardcoded currency names: `extractShareholdersFromItems` now captures whatever text follows the "N (TYPE)" share-count match as the currency's own full name, verified against both real Desktop PDFs (still correctly "SINGAPORE DOLLAR" for both — no regression). Added `currency` to the API response and to the page-local `ShareholderRow` type (not the shared `PostIncorporateShareholder` doc-generation type — confirmed no template references a per-shareholder currency), wired through Bizfile parsing, falling back to the original hardcoded default only when nothing was actually parsed. `npx tsc --noEmit`/`npm run build` clean.

This surfaced while investigating a bigger, related finding: Vincent pointed to a different TeamWork page entirely (`shares/share_list/<id>`, the real Share Register with per-transaction allotment history) as having "准确的shareholder的paidup capital" — turns out the "Shareholders Information" table this system has been scraping since early this session (`extractShareholderShares` → `teamwork_shareholder_shares`, used for the "missing shareholders" cross-check) is a STALE/historical source: for a real test company, it showed 4 shareholders with numbers that don't match the current Share Register at all, while the Share Register shows only 1 (confirmed by Vincent: "最新股权登记只有WANG WEI，另外一个应该就是历史存档"). That's a separate, larger rebuild (new scraper, throughput-budget-driven batch resizing, cross-check logic pointed at the right source) — in progress separately, not yet shipped.

Previous update: 2026-08-11 (Small, self-contained addition to `app/client-communications/campaigns/page.tsx`: Vincent, from a screenshot of the existing "Outlook Helper" readiness widget showing a healthy `READY`/`v1.4.0` state — "这个 OUTLOOK HELPER 如果没有更新到最新，在进入这个页面的时候要出现一个弹窗提醒更新最新的HELPER." The outdated-version detection and an inline "Update available" banner+"Download update" button already existed (`lib/draft-helper-client.ts`'s `isHelperOutdated`/`LATEST_HELPER_VERSION`), just easy to miss without scrolling to it. Added a modal that appears automatically the moment the page determines the local Helper is outdated — scoped to the initial mount check only (`recheckHelper({ announceOutdated: true })`), not the manual "Recheck" button, since an explicit recheck already gives its own visible feedback via the banner and a second popup on top of that would just be noise. Dismissible ("Remind me later") rather than blocking, matching the existing banner's own tone (staff may continue working with an outdated Helper, just gets reminded). Styled to match this file's existing plain-CSS conventions (same amber/warning palette as the outdated banner state) rather than introducing Tailwind into a page that doesn't use it. `npx tsc --noEmit`/`npm run build` clean.

Previous update: 2026-08-11 (Vincent sent a real screenshot of a shareholder's (WANG WEI, on PORTOUT SINGAPORE PTE. LTD.) fully-populated TeamWork "Shareholders" tab card — full address/ID/D.O.B./nationality/Individual Email/Individual Mobile — next to the system's "missing shareholders" popup, saying the two didn't match: "你检测到的结果和我在TW直接看到的结果完全不同." Investigated with real data rather than guessing: `teamwork_shareholder_shares` already correctly had WANG WEI (11,714,240 ordinary shares) — he wasn't actually missing from that comparison, that part was working. The real gap was elsewhere: fetched PORTOUT's live TeamWork profile directly (internal_id 1211) and confirmed individual shareholders get their OWN rich detail card under a `cardType` of exactly `"Individual"` (distinct from `"IndividualDirector"`) — already scraped by `extractOfficerDetails` (same fields as Directors: ID/Address/D.O.B/Nationality/Individual Email/Individual Mobile), but `sync-secretary/route.ts`'s `officialRows` only ever built rows from `p.officials` (the plain "Active Officials" summary table), which has no Shareholder role at all (confirmed by an earlier 2026-08-06 finding, still holds) — so a correctly-scraped shareholder's data was fetched every night and then silently thrown away, never written to `teamwork_company_officials`. Also found "Corporate Shareholders" cards (for entity shareholders like the two also shown in that same popup, XINGLONG SGP PTE. LTD. and CHINA PRECISION MATERIAL LIMITED) use an entirely different field set (Reg.No, no D.O.B/personal email) that `extractOfficerDetails` doesn't parse at all — left out of scope for this pass, individual shareholders only.

Fixed: `sync-secretary/route.ts` now also builds rows from `p.officerDetails` where `cardType === 'Individual'`, tagged `role: 'Shareholder'` — verified against the real PORTOUT HTML (saved and diffed field-by-field, not assumed) that this produces exactly WANG WEI's own screenshot values. While wiring this through, found the enrich API and `addMissingDirector`/`addMissingSecretary`/`addMissingShareholder` had a second, adjacent gap: `teamworkOfficials` only ever returned dob/email/mobile/telephone, never address/ID number, even though `teamwork_company_officials` has always had those columns — so adding a TeamWork-only person (one Bizfile's own parse didn't include) filled in contact details but left Address/ID Number blank for no real reason. Extended `/api/post-incorporate/enrich`'s `teamworkOfficials` to include `address`/`idNo`/`idType`, and all three `addMissing*` handlers in `page.tsx` to use them. `addMissingShareholder` previously only ever had a bare name (from `teamworkShareholderNames`, the share-register table, which is name-only) — lifted `officialByName` to page-level state (`teamworkOfficialByName`) so it can also look up whichever of these newly-added Shareholder-role people matches by name, rather than adding a fully-blank row. `npx tsc --noEmit`/`npm run build` clean; the extraction logic itself verified against real saved HTML before shipping.

Previous update: 2026-08-11 (Vincent pushed back on the multi-night rotation design directly: "我要的是每一天都能分批轮完，但是一天内要轮完全部公司，不是一天只轮250家，这样数据就很难同步了." That design (250 companies/run, oldest-`secretary_synced_at`-first) existed specifically to fit under Vercel's classic 300s function timeout — the route's own comment measured ~500ms/company fixed TeamWork throughput regardless of concurrency, so all ~783 current Active Client companies would take ~390s, over that cap. First attempt: queried the Vercel project API, found `resourceConfig.fluid: true` (Fluid Compute enabled), and reasoned that would cover a single ~390s run, so removed the batch cap entirely (`maxDuration` 300→650, `BATCH_SIZE` 250→1200) — wrong, and caught immediately rather than left broken: the actual deployment errored (`readyState: ERROR`, pulled via the same Vercel API used to confirm every other deploy this session), with a precise reason — "Serverless Functions must have a maxDuration between 1 and 300 for plan hobby." Fluid Compute being enabled doesn't override the plan's own hard ceiling. Corrected: `maxDuration` back to 300 (Hobby's real max), `BATCH_SIZE` to 450 (~225s of TeamWork fetch time, leaving ~75s margin for login/DB writes within the 300s cap), and added a SECOND daily cron trigger for the same route in `vercel.json` (22:45 UTC, ~4h after the existing 18:45 one, both still within Singapore's overnight window) rather than one oversized run — two 450-company runs/night now cover the full ~783-company roster with headroom to grow before needing a third. `npx tsc --noEmit`/`npm run build` clean, this time confirmed `READY` via the Vercel API before reporting it fixed, not just deployed-and-assumed. This also makes the earlier `UPDATE master_list SET secretary_synced_at = null WHERE id = 757` fix (to bump 1V Capital to the front of the next batch) unnecessary — two full-ish sweeps a day reach every company regardless of that ordering now, so Vincent doesn't need to run it.

Also hit the session's recurring cwd-drift bug at the worst possible moment: the first `git push` for this exact change silently ran from `C:\Users\vincent` (an unrelated personal git repo also present there) instead of `tassure-invoice`, reported "Everything up-to-date" (technically true for the WRONG repo), and came close to being reported to Vincent as pushed when the real commit was still sitting local-only. Caught by explicitly re-`cd`ing and diffing `git log` against `origin/main` before trusting that result — exactly why that verification step exists.

Same message also confirmed dob/D.O.B. mapping is already correct — TeamWork's own "D.O.B:" label already maps directly to the `dob` field name used throughout (`teamwork_company_officials.dob`, `OfficerDetail.dob`), no gap there; no code change needed.)

Previous update: 2026-08-11 (Third item in the same thread — Vincent's screenshot showed the "Nominee Director details" (nominator) sub-panel rendering for a director whose ND arrangement Tassure doesn't actually supply, with every field genuinely blank: "这个是只针对当秘书提供ND服务...并且这些信息都应该是自动填好的，毕竟都是有数据的." Two real issues, both fixed. (1) The panel gated on the same broad `isNomineeDirector` flag the previous entry deliberately widened to include ACRA's own Bizfile marker — but that panel specifically needs Tassure to be the one supplying the arrangement, otherwise Tassure has no "nominator" bio to offer at all. Added page-level `tassureNdNames` (a `Set` of the currently-parsed company's Tassure-roster-matched names, kept at page level rather than only inside the parse handler, so gating stays correct even for a director added or renamed after the initial parse) and re-gated the panel on `d.isNomineeDirector && isTassureNd` instead of the flag alone. (2) Confirmed via `lib/docx-post-incorporate.ts`'s `nomineeDirectorItem()` (`signature_position: 'Director'`) that "Nominator" here means the SAME nominee director acting in that capacity, not some third party — so when Tassure supplies the arrangement, its own bio data (address/ID/DOB/email/mobile) IS genuinely on file, sourced from the exact same `teamwork_company_officials` snapshot already used elsewhere on this page. Extended `/api/post-incorporate/enrich` with `nomineeDirectorDetails`: for each of Tassure's 13-person roster (`nominee_directors`) matched to the current company via `nd_appointments`, a global (not UEN-scoped) lookup by name against `teamwork_company_officials` — verified against a real active appointment (CHEN DE / AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING, appointed 2023-11-21) that every field resolves correctly, not assumed. `nd_appointments.appointment_date` (already ISO) fills "Date Became Nominator" directly. Nationality still isn't captured anywhere in the synced snapshot (never added when dob/email/mobile were), so that one field stays blank — flagged to Vincent rather than fabricated.

While wiring this, found and fixed a real, previously-invisible bug affecting every Date of birth field on this page, not just the new nominator one: TeamWork's own dob is scraped as "DD/MM/YYYY" text, but every Date of birth field here is `<input type="date">`, which silently renders BLANK for any value not already in "YYYY-MM-DD" — meaning the dob auto-fill "worked" (real data was being set) but was never actually visible in the UI, for Director/Secretary/Shareholder alike. This had been hiding behind the more visible "hasn't synced yet" explanation in earlier entries — some of it was that, but even for already-synced people the date was never going to display correctly. Added `teamworkDateToIso()` and applied it everywhere a scraped dob feeds a date input (Director/Secretary/Shareholder auto-fill, `addMissingDirector`/`addMissingSecretary`, and the new nominator birth date). `npx tsc --noEmit`/`npm run build` clean; verified the new enrich-route query chain against real Supabase data before shipping, not just type-checked.)

Previous update: 2026-08-11 (Second correction in the same thread, immediately after the previous entry shipped — Vincent: "DIRECTOR是 ND，不代表需要秘书公司有提供ND服务...(是否需提供ND服务) and (是否为名义董事)这两个属于不同的东西." The previous entry's fix conflated two genuinely different questions under one signal: whether a specific director IS a nominee (per-director, `isNomineeDirector`) vs. whether TASSURE's own secretarial firm is the one SUPPLYING that nominee-director arrangement for this company (company-level, `needNdService`). ACRA's own "ND" marker on the Bizfile only answers the first question — a director can be a nominee through some other arrangement entirely, unrelated to Tassure. Confirmed the right source for the second question: `nominee_directors` has exactly 13 rows (CHEN DE, ZHANG DAN, ...) — verified this literally IS Vincent's "我原定的13人" roster, not a guess. Split the two: `needNdService` now derives ONLY from `nomineeDirectorNames` (Tassure's own `nd_appointments`-joined roster, unchanged), while the per-director `isNomineeDirector` flag keeps the OR-of-both-sources logic from the immediately-previous entry (still correct per Vincent's own confirmation on that one). `npx tsc --noEmit`/`npm run build` clean.

Separately investigated why Secretary's Date of birth/Email/Contact Number were still blank in the UI for 1V Capital specifically, despite Supabase now genuinely having ZHANG DAN's dob/email/mobile populated (confirmed the same sync, and the same live-fetch verification, from two entries ago). Root cause: NOT a bug — ZHANG DAN is Tassure's own staff secretary for many companies, each with its OWN row in `teamwork_company_officials`/`master_list.secretary_synced_at`, and 1V Capital's specific row (`master_list.id=757`, `internal_id=1075`) simply hasn't rotated into a fresh nightly batch yet (still dated 2026-08-08, before the new columns existed) — the sync only processes 250 of ~900+ companies per run, oldest-`secretary_synced_at`-first, exactly as documented in `sync-secretary/route.ts`'s own comments. Attempted a direct one-row `UPDATE master_list SET secretary_synced_at = null WHERE id = 757` (to bump it to the front of the next run) via the same admin-client script pattern used all session for reads — blocked by the auto-mode safety classifier as a direct production database write; did not attempt to work around it. Left for Vincent to either run himself or wait out the natural rotation (a few more nightly cycles at 250/night will reach it on their own).)

Previous update: 2026-08-11 (Small correction to the previous entry's own fix, caught by Vincent right after it shipped: that entry deliberately made ACRA's own "ND" (nominee director) superscript marker pure noise to be filtered out of Bizfile parsing entirely, reasoning that Tassure's internal nd_appointments roster was the more authoritative source — Vincent pointed out this was wrong with a concrete case: ZHANG LIN is clearly marked "ND" on the real Bizfile extract, but "是否为名义董事" still came back NO ("ZHANG LIN那边都有标记他是ND了...是否为名义董事那边是YES"). Corrected: added `isNomineeDirector: boolean` to `ParsedOfficer`, capturing the bare "ND" marker per-row (now that the row-boundary fix correctly attributes it to its own row) instead of discarding it — split the old combined noise-filter into `isNomineeDirectorLegend` (the one-off "ND – Nominee Director" explanatory line after the table, still pure noise, dropped for both officers and shareholders) and left the bare "ND" marker itself flowing through for officers specifically, stripped out of the name/address text at the nameCol-processing step rather than at the dataItems filter. `app/api/post-incorporate/parse-bizfile/route.ts` now passes this through on each director; `app/post-incorporate/page.tsx`'s nominee-director detection ORs it together with the existing nd_appointments roster check (`d.isNomineeDirector || nomineeDirectorNames.includes(...)`) — either source is enough, neither overrides the other, matching Vincent's framing that the Bizfile's own official marker is a real signal in its own right, not just a fallback. Re-verified against both real Desktop PDFs: 1V Capital now correctly shows ZHANG LIN with `isNomineeDirector: true` (and everyone else still `false`, no over-firing), A Plus Manpower (a different filing with no ND marker on it) still correctly `false` for everyone — confirming this didn't reintroduce the original stray-", ND"-in-address bug the previous entry had just fixed. `npx tsc --noEmit` and `npm run build` clean.)

Previous update: 2026-08-11 (Follow-up to the previous entry's two "still open" Bizfile parsing bugs — Vincent sent closer screenshots plus the underlying raw data, and this time found the real test PDF (`2026.07.28-Bizfile-1V Capital Pte Ltd.pdf`) sitting on his Desktop, letting every fix below be verified against real coordinates end-to-end rather than reasoned about blind. Dumped the actual pdfjs item (x,y) coordinates for both the Officer(s) and Shareholder(s) tables and found the true mechanism, which turned out bigger than the superscript theory from the previous entry: EVERY column header on these tables wraps onto 2-3 stacked lines ("Name"/"Address", "Identification"/"Number", "Nationality/"/"Citizenship", "Date of"/"Appointment", "Number of"/"Shares"/"Currency") — the code only ever excluded the header's FIRST line from the data region, so every wrapped second/third line leaked into row 0 and got read as if it were that row's own name/ID/nationality/date (confirmed: row 0 literally coming back as name="Address", idNo="Number S8776552J"). Separately, a superscript annotation (ACRA's "ND" nominee-director marker) measured ~4.5pt above its own row's baseline — enough to cross the original code's fixed "+2" row-boundary buffer and get misattributed to the row above. Both root causes traced to the same undersized buffer, so both got fixed by ONE change: widened `ROW_BOUNDARY_EPSILON` from 2 to 8 (large enough to cover the measured ~4.5pt superscript offset with margin, small enough to stay well clear of a genuine wrapped address line's ~12-15pt line spacing) and applied it uniformly to every row boundary including row 0's own top, replacing an earlier (this-session, not-yet-shipped) midpoint-based approach that turned out fragile — a live test showed the midpoint sitting a mere 0.375pt inside the safe zone for row 0's header exclusion, and actively wrong for a person whose own multi-line address needed more room below their row than the midpoint allowed. Also: the "ND" superscript and its "ND – Nominee Director" legend line aren't officer data at all (the system already derives nominee-director status from Tassure's own more-authoritative `nd_appointments` roster) — added `isNomineeDirectorAnnotation()` to filter both out entirely rather than trying to attribute them to a row. Fixed two more real, distinct bugs surfaced by the same coordinate dump: (1) `extractShareholdersFromItems`'s dead `changedX` mechanism (already flagged for removal in the previous entry) needed to come back correctly-implemented, not stay removed — "Number of Shares" was getting corrupted with the neighboring "Address Changed" column's date glued on once nothing bounded the shares column's right edge; the real "Address Changed" header text is genuinely at the same Y as "Name"/"Number of" (the true first header line), but that same literal text ALSO appears a second time as the Name column's own wrapped sub-header two lines down — a plain first/last-match pick got the wrong one in production, fixed by scoping the match to items at the same Y as the header's own first line. (2) A pre-existing `!/^\d$/` filter (meant to drop ACRA's own footnote-reference superscripts like "²"/"³" near some column headers) was ALSO dropping a genuine single-digit share count — a real company with exactly 1 share came back with `numberOfShares: ''`; removed the filter entirely since the widened row-boundary already excludes header-adjacent footnote markers by position, making the digit-blacklist both redundant and actively wrong. (3) The SAME footnote-superscript-offset pattern existed in `sectionBand()` itself — the footnote legend text ("Includes nationality and citizenship") it anchors a table's lower bound to also has its own "²" floating ~4.5pt above it, letting that stray digit leak onto the last row's address as a trailing ", 2"; fixed by applying the same epsilon there. Verified every fix against BOTH real Bizfile PDFs on Desktop (1V Capital: 2 directors + 1 secretary with a nominee-director superscript and multi-line wrapped addresses, HUANG YUEYUE as both director and 1-share shareholder; A Plus Manpower: the original single-director/single-shareholder 10,000-share reference sample) — both now parse with every field exactly matching the source document, a regression check confirming the original sample wasn't broken by any of this. One cosmetic-only imperfection knowingly left as-is (pre-existing behavior, not introduced here): multi-line wrapped addresses always join with ", " regardless of whether the source line actually had a comma there, occasionally producing an extra comma at a wrap point (e.g. "INTERNATIONAL, PLAZA" instead of "INTERNATIONAL PLAZA") — no data lost, just a stray comma. `npx tsc --noEmit` and `npm run build` clean; all temporary coordinate-dump/debug scripts deleted after use.)

Previous update: 2026-08-11 (Vincent asked "刚才的同步做好了？" after running the SQL migration from the previous entry. Queried Supabase directly rather than guessing: columns existed, the most recent `teamwork_secretary` sync run reported success (`officials_synced: 1440`), but every freshly-synced row still showed `dob/email/mobile: null`. Root-caused with real data, not assumption: that "successful" sync ran 2026-08-10T18:51-18:53 UTC — about 8 hours BEFORE commit `1defffd` (the dob/email/mobile scraping+join code) was even made (2026-08-11T03:09 UTC), so it ran on the OLD code that never wrote those columns at all. Confirmed by replaying `extractOfficerDetails` + the name-join against a fresh live fetch of a real company (1527/1V CAPITAL-style: WANG ZHAOJIE, XING WENQIN, ZHANG DAN) — every field matched correctly, proving the shipped logic itself is fine. Confirmed current deployment (`e1c64e6`) is `READY` on Vercel and matches HEAD. Asked Vincent to trigger a fresh sync via the direct URL (same falls-through-to-session-auth mechanism as before); he agreed to trigger manually rather than wait for tonight's cron. Deleted the four temporary diagnostic scripts used for this investigation, per the established one-time-script cleanup pattern.\n\nWhile that sync was pending, Vincent came back with real screenshots from a Bizfile test showing several NEW data-quality problems, all with concrete evidence rather than a vague complaint. Read `lib/bizfile-parse.ts` closely instead of guessing and found two confirmed, mechanical bugs: (1) `sectionBand()`'s lower bound stays `-Infinity` when a table (Officer(s)/Shareholder(s)) has no following section heading on the same PDF page — its own comment claims \"a sensible floor when it's the last table on the page\" but that floor was never actually implemented, so extraction ran straight through the page footer (page number, the \"Verify Document Instantly...acratrustbar.gov.sg\" QR blurb) and glued it onto the last row's address/nationality — exactly matching Vincent's \"Page 3 of 5\"/\"CHINESE Verify Document Instantly...\" screenshots. Fixed by detecting the same footer boilerplate patterns `normalizeText` already filters (as items, not lines, since this coordinate-based path never goes through `normalizeText`) and using the topmost footer line's Y as the floor when no next-heading bound exists. (2) `labelValueActivity()`'s continuation-line loop had no guard for a genuinely blank value — Secondary Activity is routinely blank on a real Bizfile, but the code only stops slurping subsequent lines once it sees a `(NNNNN)` ending or a `\\t:` line, so a blank value kept eating unrelated following content looking for a continuation that was never there. Fixed with an early return when the first captured value is empty. Also wired up \"是否需提供ND服务\" (previously a pure-manual toggle) to auto-set from the SAME nominee-director detection Directors already use (Tassure's own `nd_appointments` roster) — confirmed the rule with Vincent via AskUserQuestion first rather than guessing at \"如果秘书是ND\" literally: any Bizfile-parsed director matching the ND roster now sets `company.needNdService = true` on parse. `npx tsc --noEmit` clean for all three changes.\n\nStill open, NOT yet fixed: (a) a director's \"ND\" superscript annotation appears to be bleeding into the WRONG person's address field (Zhang Dan's address got a stray \", ND\" that belongs near Zhang Lin's row instead, while Zhang Lin's own row separately picked up the full \"ND – Nominee Director\" legend text) — plausible mechanism is a superscript's slightly-raised Y offset crossing the row-boundary cutoff into the row above it, but this needs the actual PDF's real coordinates to confirm rather than a guessed fix; (b) shareholders' Number of Shares came back blank — not yet diagnosed, may or may not share the footer-bleed root cause above. Both need Vincent to resupply the test PDF (or confirm which company) before touching `extractShareholdersFromItems`/the officer row-bucketing further.)

Previous update: 2026-08-09 (Vincent ran the SQL migration from the previous entry and asked for a manual sync trigger before continuing — couldn't fetch `CRON_SECRET`'s value via the Vercel API (sensitive-type env vars are write-only even to a valid project-scoped token, confirmed via `decrypt=true` returning an empty value), so instead gave Vincent the direct URL to hit while logged into his own browser session (`https://tassure-corporate-services.vercel.app/api/teamwork/sync-secretary` — `proxy.ts`'s CRON_PATHS check only intercepts requests carrying the bearer secret; anything else falls through to the normal session-auth check, which a real logged-in visit satisfies) rather than a token he'd have to hunt down. Also fixed a real, separate visual bug he flagged from a screenshot: "POST INCORP这些格子内部要是白色的，不是（透明和卡片背景一个色）" — `inputClass` never had an explicit background at all; harmless while `cardClass` was plain white, but visibly wrong now that the earlier design-tokens export changed the card background to `#fafafa` — every input/select/textarea was rendering transparent, showing the card's off-white through it. Added `bg-white` to `inputClass` (fixes all of them from one place) and to the three person-tab form panel wrappers, which had the identical gap. `npx tsc --noEmit`/`npm run build` clean; pushed (`8a62799`, one retry for the usual git-push credential hang, no stuck process found), deployment confirmed `READY`.)

Previous update: 2026-08-09 (Vincent sent real TeamWork screenshots showing populated Individual Email/Individual Mobile No #/D.O.B. per person, directly contradicting the 2026-08-06 finding that this data was empty on TeamWork ("你之前讲找不到具体的DIRECTORS / SHAREHOLDERS/SECRETARIES详细资料，我这边给你看"). Investigated live before touching anything — fetched a real company's profile HTML with the existing session-cookie mechanism, found the earlier finding was correct for the two sources it actually checked (the bulk getCompanies API and the plain "Active Officials" summary table `lib/teamwork-company-profile.ts` already scraped) but never covered a THIRD section on the same page: the tabbed per-person "Directors / Shareholders / Secretaries / Controllers / ..." detail cards, which do have real data. Built `extractOfficerDetails()` there, verified field-by-field against the live fetch (matched every value in Vincent's screenshots) before shipping — caught two real regex bugs and one sizing bug along the way, all found by testing against the actual HTML rather than trusting the code on read-through: labels sometimes have a leading space before them and sometimes don't (">ID:" vs "> Address:"), a pre-escaped label string got double-escaped by the function's own escaping step (broke D.O.B. matching entirely), and a fixed 6000-char per-card window was too small for a director with a populated "Main Role" table (real content pushes the trailing fields further down) — replaced with the actual next-card boundary. Added `scripts/add-teamwork-officer-contact-details.sql` (dob/email/mobile/telephone/sub_roles on `teamwork_company_officials`, not yet run by Vincent), wired it through `sync-secretary`'s existing nightly fetch (joined by name, no extra TeamWork call), extended `/api/post-incorporate/enrich` to return the full officials list plus real shareholder-register names, and updated Post Incorporate's Bizfile-upload flow to fill dob/email/phone into matched people (Secretary and Shareholder tab forms gained the fields to show it; Director's already had them). Second half of the same message: "系统只会从BIZFILE读取一个人...因此我要你从TW做比对...跳出弹窗提示是否要修改" — read `lib/bizfile-parse.ts`'s officer/shareholder extraction closely first and confirmed it already loops over every ID-anchored row found, not hardcoded to one person, so this wasn't a blanket bug to patch; built the TW cross-check as real insurance regardless — after a Bizfile parse, compares its director/secretary/shareholder names against TeamWork's own lists, and shows a popup (`missingFromBizfile` state) listing anyone TeamWork knows about in a role that didn't make it into the parse, each with an Add button pre-filled from TeamWork's own detail. `npx tsc --noEmit`/`npm run build` clean; pushed (`1defffd`), deployment confirmed `READY`. Still need to paste the SQL migration to Vincent for him to run — new columns don't exist in Supabase yet, so dob/email/mobile/telephone will read as null/absent until then.)

Previous update: 2026-08-09 (Vincent asked for the Design Lab rebuilt to match the new tab+form structure ("OK 给我针对这个页面做细节UI处理的编辑器") — redeployed to the same Artifact URL (v2: 14 token groups instead of 18, since the table-specific ones (`COL_W`/`thClass`/`tdClass`/cell-input tokens) no longer exist; preview rebuilt to mirror the real card sequence including the newly-split Secretarial Firm card and per-person tab+form sections; Capital tabs and person tabs now share one `tabClass` token group in the tool too, matching how the real code actually shares `tabClass` between them). He used it and exported a real `design-tokens (1).json` from his Desktop; diffed it against the tool's defaults and applied the actual changes to `app/post-incorporate/page.tsx`: `cardClass`'s background lightened from pure white to `#fafafa` with a deeper shadow (`shadow-sm` → `shadow-md`), `Field`'s label text shrunk 14px → 13px (`text-[13px]`, since Tailwind has no default 13px step), and `inputClass`'s vertical padding increased `py-1.5` → `py-2.5` (6px → 10px) for slightly taller fields. `npx tsc --noEmit`/`npm run build` clean. Push hit a transient DNS failure ("Could not resolve host: github.com") — different from the usual credential-manager hang — cleared on the very next retry, `git fetch` confirming connectivity was fine again by then. Pushed (`6b90d14`), deployment confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Small follow-up: Vincent, from a screenshot of the Secretarial Firm Name/Address/Currency/FYE/ND-service row: "这个单独一张卡片" — that row was a divided sub-section (border-top) inside the Company Information card; split into its own standalone `<section className={cardClass}>`, matching the pattern every other section on the page already uses. `npx tsc --noEmit`/`npm run build` clean, pushed (`d92572a`), deployment confirmed `READY`.)

Previous update: 2026-08-09 (Vincent answered the "tabs or table" question raised in the previous entry via AskUserQuestion: "改成每个人一个Tab+完整表单" — rebuilt Director/Secretary/Shareholder in `app/post-incorporate/page.tsx` to match the reference desktop app's actual screens exactly, replacing the table-row layout with a tab per person (name as the tab label, reusing the same dark-navy-active/white-inactive tab style already established for the Capital tabs rather than inventing a third look) and a full 2-column field form below for whichever person is currently selected. Field order and grouping copied directly from the reference screenshots: Director = Name/ID Type, Identification Number/Nationality, Date of birth/Gender, Email Address/Contact Number, Address (full width), 是否为名义董事; Secretary = same shape minus the fields it never had a source for anyway (Birth Date/Gender/Email/Contact); Shareholder = Name/ID Type, Identification Number/Nationality, Number of Shares/Paid-Up Capital (with a "SINGAPORE DOLLAR" suffix label matching the reference), 是否fully paid-up/Share Certificate No., 是否为Registrable Controller, Address, 是否为名义股东. Every "是否..." field became a YES/NO `<select>` (new `YesNoField` helper) instead of a checkbox, again matching the reference's own screens rather than the shorthand used before. Add Row now switches the active tab to the new person; deleting the active person falls back to the previous tab; a fresh Bizfile parse resets each section to tab 0 (`setActiveDirectorTab(0)` etc., added alongside the existing `setDirectors`/`setSecretaries`/`setShareholders` calls in `handleBizfileUpload`). Removed `COL_W`/`thClass`/`tdClass`/`cellInputClass`/`cellTextareaClass` — the entire earlier table-alignment apparatus from several rounds of polish this same day — since nothing renders as a `<table>` anymore; a real, deliberate pivot on Vincent's explicit direction, not code left to rot. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed (`1f3464b`), deployment confirmed `READY` via the Vercel API. The ND-templates question from several entries ago is still open, unrelated to this one.)

Previous update: 2026-08-09 (Vincent answered the Secretarial Firm Name/Address question with a real screenshot of the reference desktop app's own output for a real company, rather than typing the values out: Secretarial Firm Name reads "TASSURE ASIA BIZSERVICES PTE LTD", and — genuinely useful detail, not assumed — its Secretarial Firm Address matched the named Secretary's own parsed individual address exactly (same building/unit, one comma different), because Tassure's appointed secretary staff work out of Tassure's own office. `emptyCompany()` now defaults `secretaryCompanyName` to that constant; `secretaryCompanyAddress` auto-fills from the parsed Secretary's own address in `handleBizfileUpload` rather than a second hardcoded string, since that's what the real example showed and it correctly tracks whichever staff member is actually named Secretary. Both stay editable. `npx tsc --noEmit`/`npm run build` clean, pushed (`b8be15a`), deployment confirmed `READY`. Vincent's same message also included a broader observation — "我应用程序的内容是更完整的，排列也整齐，包括秘书内容也能解析到" — comparing the reference app's per-director tabbed full-form layout (Chairman dropdown → click a director's name as its own tab → full 2-column field form below, not a compact table row) against this system's table-row design, which has already been through many approved rounds of polish this same day. Given the real risk of guessing wrong on a structural rebuild this size, asked Vincent directly whether he wants Directors/Shareholders rebuilt as per-person tabs+full-forms, or whether the screenshots were shown specifically to answer the Secretarial Firm question — not yet answered.)

Previous update: 2026-08-09 (Vincent pointed out several Post Incorporate fields were still empty after a Bizfile upload (Birth Date/Contact No/Email Address/Nominee flag/Secretarial Firm Name+Address/FYE), then, after being told most genuinely have no source, pushed back with a real correction: "能不能把这些空的值做成自动填写，因为这些资料在 TW其实都可以拿到，你之前也拿到了，只是我现在要你填写进去系统内的空格." He was right about some of them — checked every field against the system's actual data (not assumed) before wiring anything: Financial Year End (`companies.fye_month`/`master_list.fye`, the same self-corrected value used throughout this project) and Nominee Director status (Tassure's own `nd_appointments`/`nominee_directors` roster — a currently-active appointment for a name matching a parsed director) ARE real, already-synced answers this system has — added `/api/post-incorporate/enrich` (GET by uen/company, two-query-then-join-in-JS against nd_appointments+nominee_directors, matching the same pattern `app/api/nominee-directors/route.ts` already uses rather than assuming a PostgREST-embeddable FK exists), called automatically right after a Bizfile parse succeeds. Nominee Director enrichment only sets the boolean flag + a default nominator type — the actual nominator's own details aren't tracked anywhere. Contact No/Email Address/Birth Date/Nominee Shareholder status were deliberately NOT wired up after checking each: Contact/Email were already investigated and found essentially empty/placeholder garbage in TeamWork back on 2026-08-06 (`lib/teamwork-company-profile.ts`'s own documented finding — 0/18 and 2/18 real values, phone almost always a bare "65-" stub — deliberately never extracted for exactly this reason), Birth Date has no scraper anywhere in this codebase (grepped to confirm), and there's no nd_appointments equivalent for shareholders. Secretarial Firm Name/Address remain unfilled for an unrelated reason — that's Tassure's own fixed registered details, not TeamWork client data, so there's nothing to look up; still waiting on Vincent to supply the actual value. `npx tsc --noEmit` and `npm run build` clean; pushed (`d69539b`), deployment confirmed `READY` via the Vercel API. The ND-templates question from two entries ago is still open too, unrelated to this one.)

Previous update: 2026-08-09 (Several items since the last entry, none touching the ND question, which is still open and awaiting Vincent's answer. (1) Vincent asked for a fundamentally different way to communicate UI changes, tired of round-tripping through descriptions I kept slightly misreading: "你能不能做一个虚拟的系统UI模拟器...我可以随意调整每一页的固件和字体样式和颜色...当我调整过后按SAVE，你就要根据调整，去修改UI代码...这个UI设计器是额外的虚拟链接，不是安装在系统内的." Built a standalone Artifact (published separately from this app, not a route in it) — "Post Incorporate Design Lab": a faithful HTML/CSS/JS mock of the real page's structure, with every design token (card, section title, field label, standard input, table header, table cell, both Capital tab states, tab bar, Add Row button, primary button, Bizfile upload button, sub-panel, checkbox accent, delete icon, success/error alerts, column widths) editable via a sidebar grouped and labeled to match the actual Tailwind class names in `page.tsx` (`cardClass`, `cellInputClass`, `tabClass`, `addRowButtonClass`, `COL_W`, …) — clicking any preview element jumps to its matching control group. "Save" computes a diff against the real code's current defaults and exports a `design-tokens.json` (copy or download, via the `downloads` capability). First version only had ~10 groups; Vincent tried it, liked the concept, but wanted finer control ("你可以调整的东西太少了...当然是按照我现在的系统的风格来") — expanded to 18 groups covering effectively every visual surface in the real page, added border-width/hover-state/padding-X-vs-Y fields to existing groups, and added a search box so the now-large sidebar stays navigable. Redeployed to the same Artifact URL both times (same link, no need to re-share). (2) Vincent used the tool and sent back a real `design-tokens.json` export; applied it directly to `app/post-incorporate/page.tsx` rather than asking him to re-describe it: `inputClass`/table text shrunk 14px/12px → 12px/11px, Capital tab active state + the "Generate Documents" primary button recolored from Tailwind's default blues to a specific dark navy `#1d395e` he picked in the tool. (3) Vincent asked why a generated ZIP only had 10 files instead of 16 — read `generatePostIncorporateDocuments` in `lib/docx-post-incorporate.ts` line by line rather than guessing, confirmed the exact math: 10 files (Readme + First Board Resolution + Consent to Act as Director ×1 director + Secretary Appointment + Engagement Letter + RORC Authorisation + RORC Declaration + ROND Maintenance + RONS Maintenance + S156 ×1 director) are unconditional for his 1-director/1-individual-shareholder test data, and the other 6 (Share Certificate, ND_AGREEMENT, Cert of Corp Representative, Appointment of Company Representative, Local Director Declaration, ND Fit and Proper Declaration) are each gated on a specific condition (fully-paid-up flag / needNdService checkbox / UEN shareholder / nominee-director flag) that his test data didn't trigger — working as designed, not a bug, explained with the exact condition table. (4) Vincent sent two screenshots of green "active service" indicators (Active Client's ND/Secretary toggle checkboxes, and billing's AR/AGM/SEC/XBRL summary row) asking for `#60a5fa` instead. Recolored `MasterListTable.tsx`'s `CheckSquare`/`ServiceChip` (green → blue, together, since the code's own comment already established this as one shared "active" color across the whole table, not per-service) — and, while fixing `app/billing/page.tsx`'s summary row, found a real pre-existing bug: it hardcoded `SVC_SQUARE_COLOR.manual` (green) for every active service regardless of actual state, ignoring the auto/manual distinction the modal elsewhere gets right — fixed both the desktop and mobile-card renderings to respect real state via `svcStateOf`, which both correctly fixes the bug AND satisfies the color request (auto-derived services, the majority, now show `#60a5fa`; genuinely manual overrides correctly stay green, preserving that real distinction rather than flattening it). Deliberately left the many other green usages elsewhere in `billing/page.tsx` (AR filing/invoice/stage-progress colors) untouched — different concept, not what was shown. `npx tsc --noEmit` and `npm run build` clean for all code changes; the git-push credential-manager hang recurred again (3 retries with no stuck process found this time, unlike last time's stuck `git.exe`/`git-credential-manager.exe`) — cleared again only after Vincent pushed once from his own terminal.)

Previous update: 2026-08-09 (Two more items from the same continued back-and-forth. (1) Vincent: "被选中的按钮是深蓝色背景白字，没有选中的是白背景灰色字" — swapped the Capital tab colors in `tabClass`: active tab is now a solid dark blue (`bg-blue-700`) with white text, inactive is plain white with gray text (previously the reverse, left over from the earlier full-bar design this was iterated on top of). (2) Vincent asked why the ND (Nominee Director)-related fields exist and said to remove them if unused: "我不理解为什么要那个ND的信息，如果没有用到就去掉." Verified against `lib/docx-post-incorporate.ts` before touching anything, since this looked like it could be real load-bearing logic rather than leftover UI — confirmed it is: `company.needNdService` gates whether template 12 (`ND_AGREEMENT.docx`) generates at all (`generateNdAgreement` returns `null` otherwise), and `isNomineeDirector`/`isNomineeShareholder` per-row flags drive clause selection and wording across at least 5 more templates (08 ROND, 09 RONS, 16 Local Director declaration, 17 ND Fit and Proper Declaration, Share Certificate signer selection). ND (Nominee Director) is a real Tassure service — providing a local resident director for foreign-owned companies that need one — which is why it doesn't appear anywhere in the ACRA Bizfile extract Vincent has been comparing the UI against; that's presumably why it read as unexplained/unused to him. Reported this back rather than removing real functionality on a mistaken premise, and asked him to confirm either way. No code changed for this one — awaiting his answer. Also hit the git-push credential-manager hang harder than usual this round: normal single-retry-after-taskkill didn't clear it (found and killed a stuck `git.exe` AND two stuck `git-credential-manager.exe` processes across several attempts, `git fetch` kept working throughout confirming it was push-auth-specific, not network), eventually asked Vincent to push once from his own terminal — that's what cleared it. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed (`170e7fc`), deployment confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Two more small real fixes to `app/post-incorporate/page.tsx` from continued back-and-forth on the same page. (1) Vincent, after Bizfile-parsing a company with one director: "这部分为什么是默认（-）" — the Chairman dropdown never got a default even though the parsed director was right there. Root cause: `handleBizfileUpload` set company name/UEN/regDate/address/secretaryName from the parse response but never touched `chairmanName` at all — a genuine gap, not a rendering bug. ACRA's Bizfile extract has no "chairman" field, so this can't be inferred in the general case, but fixed the unambiguous one: when exactly one director is parsed, auto-select them as chairman; multiple-director cases are still left blank for staff to pick, unchanged. (2) Vincent, on the Capital tabs after the color correction: "这两个要有按钮外轮廓啊，为什么不见了" — the individual tab border existed in the very first folder-tab restyle earlier the same day but got dropped when that was replaced by the full-bar design, and stayed dropped through the subsequent color fix. Added `border border-slate-300` back to both tab states in `tabClass` so each one reads as a distinct button sitting on the light background bar, rather than just colored text. `npx tsc --noEmit` and `npm run build` (Turbopack) clean for both; pushed together, deployment `86ee53b` confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent color-picked the reference app's Capital tab bar directly rather than eyeballing it from a screenshot: "能看出来重点吗？不是去掉之前的结构，我只是要在后面加一个背景条，背景条的颜色是（#e4e9ef）" — the earlier same-day guess (a saturated steel-blue `#8ea1c2`) was too dark; the real color is a near-white, pale blue-gray. Swapped `bg-[#8ea1c2]` → `bg-[#e4e9ef]` in `app/post-incorporate/page.tsx`'s Capital tab bar, and fixed a consequence of that swap before it could ship as a visible bug: `tabClass`'s inactive-tab text was `text-white/90`, chosen when the bar was dark enough for white text to read — against a near-white `#e4e9ef` bar that would have rendered as nearly invisible white-on-white, so changed it to `text-slate-500` for correct contrast. Tab structure itself (bar + two buttons + filler) explicitly left unchanged per Vincent's own framing. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed, deployment `b4eea75` confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent's most detailed pass yet on the Post Incorporate tables, comparing against his own earlier reference screenshots again: "现在的UI感觉混乱不协调，就是我不理解为什么已经在框内了，还要再来一个小框在内的设计很复杂...DIRECTOR董事那边也是不协调，Chairman主席可以设置在标题下行...上下列可以同样的内容可以对齐宽度，第一列是空的那个可以去掉." Four distinct, concrete fixes in `app/post-incorporate/page.tsx`: (1) table cell `<input>`/`<select>`/`<textarea>` elements previously carried their own visible border + rounded corners while sitting inside a table cell that already has a border — a genuine doubled-boundary "box inside a box," not just a style complaint. Stripped the cell control's own border/radius entirely (`cellInputClass` now `border-0`, transparent background, focus state is an inset ring + light tint rather than a permanent border) so the table cell's own border is the only visible boundary. (2) Director/Secretary/Shareholder tables share several identical columns (No/Name/Birth Date/Contact/Email/ID Type/ID Number/Nationality/Address) but each table previously auto-sized its own columns from its own content (`table-auto` default), so matching columns landed at different pixel widths across the three stacked tables and didn't line up — added one shared `COL_W` literal pixel-width map applied via `<colgroup>` + `table-fixed` identically in all three, guaranteeing exact alignment regardless of content (not a visual approximation — `table-fixed` ignores content for sizing once widths are set). (3) Removed the blank leading column that existed solely to hold the per-row delete button; delete now lives inside the No. column itself, revealed on row hover (`opacity-0 group-hover:opacity-100`), so one column does what two did before. (4) Chairman/Secretary dropdowns moved off the same row as the section title onto their own row beneath it, for both Director and Secretary sections (only Director was explicitly named, but Secretary has the identical inline pattern — fixed both for consistency). Skipped Vincent's offered fallback ("如果列很难统一，那这个POST INCORP页面内的所有字缩小35%") since the `table-fixed`+shared-widths approach solves the alignment deterministically rather than needing a font-size workaround. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed, deployment `429e0a6` confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent sent a closer screenshot of the reference app's Capital tab control specifically ("有没有办法优化成这种呢？") — a solid steel-blue bar spanning the full section width, active tab popping forward in white, inactive tab and the empty filler space to its right both sitting flush in the same blue. The prior folder-tab restyle (bordered, connects to the panel below) was a reasonable generic tab but didn't match this specific native-control look. Replaced `tabClass` and the tab bar markup in `app/post-incorporate/page.tsx`: a flush `bg-[#8ea1c2]` bar containing the two tab buttons plus a `flex-1` filler div (matching the reference's bar extending past the tabs), active tab white/dark text, inactive tab transparent with light text; content panel below simplified to a plain bottom-attached box (`border-t-0`, no more folder-tab corner join) since the bar itself is now the visual header rather than a floating folder tab. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed, deployment `d52a64d` confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent compared the restyled Post Incorporate tables against the reference screenshots again and gave specific polish feedback: "细节要处理到位，按钮UI也要凸显，不能偷懒...过长的内容不可以被遮挡要转到下行，所以为了保持平衡感，每个格子的上下大小，最少要显示出两行." Two real, distinct issues, not just taste: (1) table cells for Name/Email/Nationality/Address used a single-line `<input>`, which can only ever show one line and has no way to wrap — long values were genuinely getting hidden (truncated within the input, or requiring horizontal scroll to read), not just "look plain." Switched those specific fields to a 2-row `<textarea>` (new `cellTextareaClass`, `min-h-[2.75rem]`) across all three tables (Director/Secretary/Shareholder) so long content wraps onto a second line within the cell instead of disappearing — this was a real capability gap a CSS tweak alone couldn't fix, since `<input>` fundamentally cannot wrap. (2) The "新增一行 Add Row" buttons (all three tables, identical className, fixed with one `replace_all`) were styled as plain blue text links — restyled into an actual bordered/shadowed button (`addRowButtonClass`) to look as prominent as the reference's native-looking button. Also restyled the Capital tabs from a flat underline-tab into a folder-tab look (border connects to the panel below, matching the reference's native tab control), widened the page container to 1500px, and added more vertical padding to table rows/cells for breathing room. Hit the cwd-drift issue again while verifying (same root cause as the prior entry — background bash starts fresh at `$HOME`) — worked around it the same way, embedding `cd` in each backgrounded command. `npx tsc --noEmit` and `npm run build` (Turbopack) clean; pushed and confirmed deployment `af427a2` `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent, after seeing the restyled Auto-fill from UEN card was now redundant next to the working Bizfile upload, said to remove it: "这部分可以去掉了." It had been the substitute auto-fill source built earlier in the day before the real Bizfile parser existed. Removed the card from `app/post-incorporate/page.tsx` along with everything that existed ONLY to support it, rather than leaving orphaned code — `handleUenLookup`, its loading/message state, the amber "reference notes from existing records" hint panel, the shareholder-candidate suggestion chips (`addShareholderFromCandidate`), and, since a grep confirmed page.tsx was its only caller anywhere in the repo, the `/api/post-incorporate/lookup` route itself (deleted the whole file, not left as dead code) — its data source (`teamwork_company_officials`/`teamwork_shareholder_shares`, the nightly sync-secretary cron) stays untouched since those serve other purposes. Also removed the now-unused `Search`/`Info` icon imports. Hit the local cwd-drift bug again partway through (background bash commands here start fresh at `$HOME`, not inheriting the interactive shell's cwd — confirmed by `tsc` picking up unrelated files under `C:\Users\vincent\AppData\...`) — fixed by embedding `cd` directly inside each backgrounded command rather than relying on a prior `cd`. First rebuild after deleting the route failed on a stale `.next/dev/types/validator.ts` still referencing the removed file; cleared `.next` entirely and rebuilt clean. `npx tsc --noEmit` and `npm run build` (Turbopack) both clean; pushed (one retry needed for the known intermittent Windows git-push hang, no stuck `git.exe` process found), deployment `80aa16f` confirmed `READY` via the Vercel API.)

Previous update: 2026-08-09 (Vincent confirmed the DOMMatrix fix worked in production — Bizfile upload finally parses correctly end-to-end — then, from screenshots of the real desktop app's Company Information/Director/Secretary/Shareholder screens (the actual source this whole port is replacing), asked to restyle the ported form to match that arrangement as closely as possible: "可以把UI排列尽量还原成截图的那种排列形式在系统吗？" Restructured `app/post-incorporate/page.tsx`: Company Information reordered to Name/UEN, Incorporation Date/Company Type, a Capital section with Issued/Paid-Up tabs (Amount/Number of Shares/Currency/Share Type), then Address/Primary Activity/Secondary Activity — mirroring the ACRA extract's own page layout exactly as shown. Company Type/Activity/Capital detail are kept as page-local state (a new `CompanyExtra` type), deliberately NOT added to `PostIncorporateCompany` — same precedent the Bizfile route's own `extra` field already established, since none of the 16 real templates reference them. Directors/Secretary/Shareholders converted from stacked per-person cards to horizontally-scrollable tables (No/Name/Birth Date/Contact/Email/ID Type/ID Number/Nationality/Address, plus Date of Appointment for Directors/Secretary or Number of Shares+是否RORC for Shareholders) with a "新增一行 Add Row" button and per-row delete, matching the reference's exact table shape. Chairman moved out of Company Information into a dropdown next to the Director table (options = current director names), and Secretary became its own repeating table (was a single text field) with the same dropdown-selects-the-active-one pattern as Chairman, kept in sync with `company.secretaryName` on add/rename/remove. While wiring the Secretary table to Bizfile data, found the parse-bizfile route had been silently dropping the secretary's address/ID/nationality/date-of-appointment the whole time — only the name ever made it past the API response even though the parser already extracted the rest — so extended the route to return the full secretary record, plus each director's Date of Appointment (also previously parsed but discarded). Tried to verify visually in a browser per this repo's own CLAUDE.md convention for UI changes — added a temporary local-only auth bypass for `/post-incorporate` so Playwright could reach the page without a real Google/Supabase login; blocked by the session's own safety classifier same as the earlier temporary-public-debug-route attempt, even though this one was local-only and never intended to be pushed. Reverted the bypass immediately rather than working around the block, and fell back to careful manual review of the state-update logic plus `npx tsc --noEmit`/`npm run build` (Turbopack, both clean) as the verification available without real auth — flagged to Vincent that this specific change couldn't get a full authenticated browser pass and asked him to check the live result matches what he asked for.)

Previous update: 2026-08-09 (Vincent retested the previous fix and it still failed — proof the worker-path fix, while real, wasn't the whole story. This time got real production evidence instead of reproducing locally: local `next dev`/`next start` always has the full `node_modules` present, so it can't catch bugs in what Vercel's own output-tracing actually bundles into the deployed Lambda — that gap is exactly where this one hid. Tried pushing a temporary public no-auth debug route to see the real error directly; blocked by the session's own safety classifier (a public endpoint on a real production app, even briefly, wasn't an acceptable way to get there). Asked Vincent for a Vercel access token instead — he generated one scoped to this project with no expiration and said to save it permanently for future use ([[vercel_token]], stored in memory) — and pulled the actual runtime log via the Vercel REST API (`/v2/deployments/{id}/events`; the installed Vercel CLI itself had no stored auth and its `whoami`/`logs` commands don't work with a project-scoped token, but the raw API does). Real error: `ReferenceError: DOMMatrix is not defined`. Root cause: pdfjs-dist's legacy/Node build references the browser-only `DOMMatrix` global at module-evaluation time (`const SCALE_MATRIX = new DOMMatrix()` in its bundled source — runs unconditionally just from importing the module, before any of this app's own code executes), normally polyfilled from the optional `@napi-rs/canvas` native addon — which fails to load in the deployed bundle (`Cannot find module '@napi-rs/canvas'`, confirmed in the same log), so every single request crashed before parsing even began. Read pdfjs-dist's actual bundled source (not assumed) to confirm every OTHER DOMMatrix method it calls (`preMultiplySelf`, `invertSelf`, `multiplySelf`, etc.) lives exclusively inside the `CanvasGraphics` rendering path used by `page.render()` — which this parser never calls, only `getTextContent()` — so a real native canvas binary was never actually needed, just something satisfying a bare `new DOMMatrix()`. Added `dommatrix` (a small pure-JS, zero-dependency package) as a targeted polyfill, installed on `globalThis` before either `pdf-parse` or `pdfjs-dist` get imported (pdf-parse uses pdfjs-dist internally too and would hit the same crash first otherwise). Verified by reproducing the exact production condition locally rather than trusting the fix blind — temporarily renamed `node_modules/@napi-rs/canvas` out of the way, ran a real `next build && next start` (not the dev server), and confirmed the same real sample PDF now parses with fully correct data with the native addon completely absent, matching production's actual condition. Confirmed `dommatrix` gets automatically traced into the deployed function bundle (inlined directly into a chunk, visible in the route's `.nft.json` manifest) with no `outputFileTracingIncludes` entry needed, unlike the worker-file fix from earlier the same day. Pushed, polled the Vercel API until the new deployment (`46833be`) showed `readyState: READY`, and asked Vincent to do the real test himself — the one that actually matters, since this whole detour started because a previous "verified locally" claim didn't hold in production. `npx tsc --noEmit` and `npm run build` clean.)

Previous update: 2026-08-09 (Vincent tested the just-shipped Bizfile upload feature live and hit a failure: "为什么我上传同样的PDF不能" — the exact same sample PDF that worked during local development failed in production. Root-caused via direct reproduction rather than guessing: stood up a temporary local debug route against the real Next.js dev server running under Turbopack (matching production's bundler) and reproduced the identical "Could not parse this PDF" failure locally — even for pdf-parse's own bare `getText()` call, proving it wasn't specific to the coordinate-extraction code in `lib/bizfile-parse.ts`. Traced to a pdfjs-dist+Turbopack incompatibility: pdfjs-dist dynamically imports its worker script (`./pdf.worker.mjs`) relative to its own bundled chunk at runtime, and that relative path doesn't exist in Turbopack's bundled serverless output. Iterated through three real error states before landing on the fix: nonexistent `disableWorker`/`worker` options (no effect) → `pdf-parse/worker`'s own `getPath()` helper (introduced a NEW error, since that module's top-level imports also pull in `@napi-rs/canvas`, an unrelated native binary that separately fails to load under Turbopack) → final fix: resolve the real worker file path directly via `createRequire(process.cwd()+'/package.json').resolve('pdf-parse')` + `path.resolve(dirname, 'pdf.worker.mjs')`, convert to a `file://` URL via `pathToFileURL().href` (bare `C:\...` paths aren't valid ESM import specifiers on Windows), and set it explicitly on both `PDFParse.setWorker()` and pdfjs-dist's own `GlobalWorkerOptions.workerSrc`. Also added an `outputFileTracingIncludes` entry for `/api/post-incorporate/parse-bizfile` (pdf-parse + pdfjs-dist's `node_modules` trees) since the worker file's path is resolved via a dynamic `require().resolve()` call that Vercel's automatic dependency tracing can't statically discover — without it the file wouldn't even be present in the deployed function bundle. Verified end-to-end against the real local dev server (curl, fully correct parsed data matching the known-good sample) before committing; cleaned up all temporary debug artifacts (the debug route, `proxy.ts`'s temporary `PUBLIC_PATHS` entry) beforehand. `npx tsc --noEmit` and `npm run build` clean. Windows-vs-Linux serverless differences mean local success is strong evidence but not an absolute guarantee — asked Vincent to retest the live upload once this deploys.)

Previous update: 2026-08-09 (Vincent compared the real desktop app's screens against what got ported and found a genuine gap: "你导入到系统的内容丢失了很多东西...一开始是需要先选择BIZFILE/CDD PDF FILE进行解析,然后再到填写公司资料的步骤." Verified precisely rather than assuming: grepped all 16 real Post Incorporate templates for Company Type/Primary Activity/Secondary Activity/Issued Share Capital — none are referenced, so nothing was actually lost there (those fields serve OTHER of the original app's 13 workflows that share its "Company Information" page, e.g. Change Business Activity, Increase Share Capital). But the Bizfile/CDD PDF upload+parse entry point — the original's real primary intake, ~1800 lines of Python — genuinely had no equivalent; the TeamWork-based auto-fill built earlier that day was a substitute, not the real thing. Vincent supplied a real sample (`2025.11.28-Bizfile-A Plus Manpower.pdf`, an official ACRA Business Profile export) to build against. First attempt (line-based text-wrap heuristics on pdf-parse's linearized text) produced genuinely wrong data — an address fragment landing in the Name field — because ACRA's Officer(s)/Shareholder(s) tables have no drawn grid lines and each row's Address/Nationality wraps across a variable number of lines, so line-position guessing isn't reliable. Rebuilt on pdfjs-dist's raw per-item (x, y) coordinates instead (`lib/bizfile-parse.ts`): each row's ID number — a reliably-shaped, always-once-per-person anchor — marks that record's row-start Y; every item between one row-start and the next gets bucketed into columns by X position (derived from the header row's own item positions, not hardcoded pixels) and joined top-to-bottom per column. Caught and fixed two more real bugs before trusting it: page-1 activity fields truncating due to overly strict continuation-line matching (fixed with paren-balance detection instead of a character-class check), and the Shareholder table's last row silently absorbing the page footer/footnotes because it had no lower Y boundary (fixed by bounding every table between its own heading and the next one, found via item position rather than assumed). Verified against the real sample end-to-end: company name/UEN/incorporation date (converted to ISO)/registered address/secretary/one director (name, address, correctly-inferred NRIC, nationality)/one shareholder (plus share count) all matched exactly. Wired into `/api/post-incorporate/parse-bizfile` (new route, multipart PDF upload) and an "Upload Bizfile PDF" button on the form, pre-filling Company Info + Directors + Shareholders in one step — positioned above the existing UEN/TeamWork auto-fill as the recommended path, since it's the official registry extract rather than a synced snapshot. Also cleaned up a self-inflicted mess mid-task: an `npm install pdf-parse` run during a moment of the known cwd-drift bug landed in `C:\Users\vincent`'s own unrelated package.json/package-lock.json instead of tassure-invoice's — caught it via `git diff`, reverted cleanly, removed the stray node_modules entries, then reinstalled correctly from the right directory. `npx tsc --noEmit` and `npm run build` clean.)

Previous update: 2026-08-09 (Vincent: "那这些可以做每天更新吗？虽然不直接出现在系统页面，但是可以记录在数据库，更方便调用在post incorp" — moved the Post Incorporate UEN lookup's Director/Shareholder source from a live on-demand TeamWork login+fetch to a nightly-synced Supabase snapshot. Rather than add a second nightly TeamWork fetch (redundant load on top of the existing 18:45 UTC sync-secretary cron, which already fetches this exact company profile page for the Secretary column), extended that SAME route to also write through the full officials list and share register it now already has in hand: added `fetchCompanyProfilesFull` (bulk variant of the on-demand fetchCompanyProfileFull), switched sync-secretary to call it instead of the secretary-only fetchCompanyProfiles, and added a wholesale delete+insert per company into two new tables — `teamwork_company_officials` and `teamwork_shareholder_shares` (SQL: `scripts/add-teamwork-company-officials.sql`, not yet run by Vincent). The Post Incorporate lookup route (`/api/post-incorporate/lookup`) now reads purely from these two tables — no more live TeamWork login on that request path at all, so it's fast and no longer needs Playwright/the `outputFileTracingIncludes` entry that was added for it that same day (removed from `next.config.ts`). `npx tsc --noEmit` and `npm run build` clean; the nightly sync itself can't be exercised end-to-end until the new tables exist, since it's a rotating-batch cron, not something run on demand from here.)

Previous update: 2026-08-09 (Follow-up to the same-day UEN auto-fill work: Vincent pointed out — correctly — that TeamWork's company page (screenshot: `view_company/1075/?comp`, tabs "Company / Directors / Shareholders / UBO / ... / Controllers / ...") has real Shareholders data too, deeper than the single "Active Officials" table already scraped: "其实具体内容还是有的只是会比较深入，需要先通过record到companies到每个公司的view内部." Investigated with a real Playwright session against that exact company and found the page renders a "Shareholders Information" heading/table **three times** — an empty hidden-state placeholder, the real current share register (Shareholder Name/Issued Share Capital/Paid-up Capital/Consideration Paid-up Capital/Number of Share/Currency/Share Type/Share Class), and an unrelated share-transaction-history table with a different column set — confirmed by writing the raw HTML to disk and diffing all three occurrences byte-by-byte rather than guessing which one was live. `html.indexOf('Shareholders Information')` naively picks the first (empty) one, so anchored the new parser on `"Consideration Paid up Capital"` instead — a header phrase confirmed unique to the real table — then locates its enclosing `<table>` directly. Added `extractShareholderShares`/`ShareholderShareInfo` to `lib/teamwork-company-profile.ts`, verified against 3 more real companies (one single-shareholder, one with 11 shareholders spanning Ordinary/Preference share types and SGD/USD, one single corporate shareholder) before wiring in. The lookup route now joins this share register by name against the existing `officials` list to pull address/ID number for the same person where available, returning richer `shareholderCandidates` (name, address, ID, number of shares, paid-up capital, currency, share type) — the "click to add" suggestion chip UI from earlier today now shows the actual share count per candidate. This supersedes the earlier same-day design (Controllers-as-shareholder-proxy) now that the real share register turned out to be reachable after all. `npx tsc --noEmit` and `npm run build` clean.)

Previous update: 2026-08-09 (Vincent's real goal for Post Incorporate was UEN-only entry — "能不能用户只需要填写UEN，剩下的数据可以自动匹配填写好全部要的内容." Built `/api/post-incorporate/lookup?uen=...`: pre-fills Company Information (name/UEN/address/secretary/FYE) from master_list/companies. Investigated whether Director/Shareholder detail could come from TeamWork per Vincent's hunch ("我相信TW里面都是有的，只是之前没有特地去找出这些数据") — confirmed correct: TeamWork's per-company profile page (`view_company/<id>/?comp`, same page `lib/teamwork-company-profile.ts` already scrapes for Secretary sync) has a full "Active Officials" table with Name/Role/ID No./Address/Date of Appointment for every Director, Secretary, and Controller — verified against 5 real companies before wiring anything up. Extended that file with `fetchCompanyProfileFull` (all officials, not just Secretary-filtered) and `inferIdType` (NRIC/FIN/UEN/PASSPORT from the ID number's shape). The lookup route now auto-fills Directors in full (name/address/ID number) from the Director-role rows — high confidence, direct match. Deliberately did NOT auto-fill Shareholders from "Controller" rows: Controller (Registrable Controller under RORC) is often but not legally the same set of people as Shareholder, and the table has no share-count/paid-up-capital column at all — those come back as `shareholderCandidates`, rendered as one-click "add as shareholder" suggestion chips on the form rather than silently inserted. master_list's own free-text `directors`/`shareholders`/`nominee_director` hints (from the previous session's finding — inconsistent "YES"/"NO" flags, names mixed with flags) now only show for a company TeamWork has no record for, since TeamWork's structured data is the more reliable source when available. `npx tsc --noEmit` and `npm run build` clean; the new route reuses the existing TeamWork Playwright-login session mechanism (`lib/teamwork-agm.ts:getSessionCookie`), so needed its own `outputFileTracingIncludes` entry in `next.config.ts` for the chromium binaries, same as `/api/late-filing/sync`.)

Previous update: 2026-08-08 (Found the other 12 workflows' actual template files (Share Transfer, AGM, Change Director, etc.) don't exist anywhere locally — the Python source's paths all point to sibling folders under `Docs template/` that were never copied to Desktop/DOC, and the company network drive (`\\10.0.0.12\RainbowData`, also mapped as Q:) is unreachable from here. Reported this to Vincent plainly rather than guessing at template content. He redirected: leave the other 12 for later, first make Post Incorporate itself fully complete. Closed the one real functional gap flagged at the end of the previous session — RONS (09 Declaration of Maintenance of RONS) was hardcoded to always render "no nominee shareholder" because the shareholder form had no nominee-shareholder fields at all (only directors had them). Added the same nominee fields to `PostIncorporateShareholder` (isNomineeShareholder, nominatorType, individual/corporate nominator details) mirroring the director model, a `nomineeShareholderItem` builder, and rewired `generateRonsMaintenance` to the same repeat+strike-through-inactive pattern already proven on ROND, instead of the old always-empty branch. Wired the matching UI onto each shareholder row in `app/post-incorporate/page.tsx`. Caught one more real bug immediately via the extended `test-orchestrator.ts` scenario: the individual-nominator branch of the new item builder never set `signature_position`, leaving a literal `{{signature_position}}` in the generated RONS document — the Python source explicitly blanks it there (`"signature_position": ""`), which the port had silently dropped. Fixed, both test suites pass, `npx tsc --noEmit` and `npm run build` clean. The secretaryCompanyName/secretaryCompanyAddress fields (Tassure's own registered name/address, needed to fill 06 Authorisation Letter) remain user-entered on the form each time — Vincent hasn't supplied a fixed value to hardcode as a default yet.)

Previous update: 2026-08-07 (Ported the first of 13 corporate-secretarial document-generation workflows from Vincent's existing Python desktop tool (`Operation_Docxs Generator - Tassure V3.py`, Desktop/DOC) into tassure-invoice as a new top-level section: "接下来我要加多一个一级标题在这系统内，这个新的内容是已经有完整的代码了和结构了，我要你把这个应用程序变成我系统的一部分." Started with "Post Incorporate" (Vincent's choice, to prove the whole pipeline first) then given explicit authorization to run the rest fully autonomously: "反正接下来我要你全自动跑完整个项目，你要自己判断，要智能自问自答，做每个决策的时候要判断是否合理准确，确保整个原本的项目和内容都能99%的搬到系统内." Copied the 16 real Tassure-variant templates (verified against the Python source's own file-path constants, not the folder's duplicate/stale filenames) into `templates/post-incorporate/`. Built `lib/docx-xml.ts`, a from-scratch OOXML manipulation engine (no docxtemplater — templates use raw `[SECTION:x]`/`[[SECTION:x]]` marker pairs baked into the Word XML, ported from the Python tool's own lxml-based approach): paragraph/table-row/whole-body-child extraction, run-splitting-safe placeholder and marker text replacement, and section repeat/keep/choose primitives — all matching the original's exact `find_all_body_sections`/`find_all_body_sections_any_marker` semantics (a marker's "content" is the sibling top-level body blocks between paired markers, or up to the next differently-named marker when no explicit END exists, not text inside the marker's own paragraph). Caught and fixed two serious bugs before they could reach real documents: (1) the balanced-tag block scanner mistook self-closing `<w:p/>` empty paragraphs (Word emits these routinely) for unclosed opens, desyncing its depth counter and silently truncating processing partway through every document; (2) marker-stripping only matched text within a single `<w:t>` run, missing markers Word had split across multiple runs (e.g. `[SECTION:` + `appointND` + `]` as three separate runs) — both fixed and covered by a permanent regression suite (`test-docx-xml.ts`, 46 checks against the real templates). Built `lib/docx-post-incorporate.ts`, the orchestrator, after reading the Python source's ~600-line `generate_post_incorporate_record` and its data-builder helpers in full — replicating business rules that turned out far more specific than "conditionally include a template": 08 ROND / 09 RONS keep BOTH the "has nominee"/"no nominee" declaration clauses and strike through the inactive one (matching the template's own "* Delete as appropriate" instruction) rather than removing it; the per-nominee block repeats once per nominee director with the individual/corporate nominator sub-paragraphs both left in place per copy (the inapplicable one just renders blank fields, not a bug to fix); template 16's equivalent markers are top-level and get filtered per-type instead; Share Certificate signer/title selection follows a specific fallback order (explicit non-nominee director → any nominee director → any other director → company secretary); templates 13/14 sign using the shareholder's OWN declared corporate director names, not the company's. Added `app/api/post-incorporate/generate/route.ts` (validates input, generates all applicable docs, zips via jszip, streams the ZIP — no direct network-drive write since Vercel can't reach `//10.0.0.12/RainbowData/...`, staff file the downloaded ZIP in manually same as any other download — records a row in the new `post_incorporate_operations` table), `app/post-incorporate/page.tsx` (company info + repeating Directors/Shareholders sections, conditional nominee-director and corporate-shareholder sub-fields), and a Sidebar nav entry. End-to-end verified with a second permanent test (`test-orchestrator.ts`, generates a full real 20-document set across nominee-director/ND-service/corporate-shareholder/no-nominee scenarios, checks every document for unresolved `{{...}}` or leftover `[SECTION:...]` text) — caught two more real data-mapping bugs (a missing opposite-branch field blank in the nominee-director item builder; a missing top-level `ND_name` fill on template 16) before landing on a fully clean run. `npx tsc --noEmit` clean, `npm run build` clean (`/post-incorporate` + `/api/post-incorporate/generate` both compiled). SQL for the new `post_incorporate_operations` table (`scripts/add-post-incorporate-operations.sql`) still needs to be run manually in the Supabase SQL editor — pasted to Vincent separately. The other 12 workflows (Share Transfer, AGM, Strike Off, Change Director/Business Activity/Registered Address/Secretary, Update Particulars, Increase Share Capital, Update Paid Up Capital, RORC/RONS/ROND/DPO, Pre Incorporate) remain out of scope for this pass, as agreed.)

Previous update: 2026-08-07 (Root-caused a real FYE mismatch badge Vincent flagged on MAPLE GROVE CAPITAL VCC (screenshot: badge showing "FYE DEC ⚠ TW JUN" while TeamWork's own Company Due Dates page clearly showed December): "这家公司对到有点不准确，明明TW那边的显示就是DECEMBER." Confirmed companies.fye_month was still "June" — the original stale value from TeamWork's bulk API, never corrected — while master_list.fye was already correctly "DEC" and already safely flagged manual (protected from ever being silently overwritten, not at risk). Fetched this company's live AGM/AR event history directly (same endpoint ar-reminder/sync-workflow's self-correction reads) and confirmed it DOES have a real event with FYE 31/12/2026 — the data needed to self-correct was there, it just hadn't been applied yet, most likely because this company (added earlier this session) hadn't been through a successful sync run since that event data existed. Re-triggered ar-reminder/sync-workflow manually rather than waiting for the next nightly run — its own self-correction logic (already verified correct multiple times today) picked it up immediately: `fye_month_corrected: 1`, confirmed companies.fye_month now reads "December", matching both master_list and live TeamWork. No code changes — this was a data-freshness gap, not a logic bug; the existing self-correction mechanism worked exactly as designed once given a chance to run.)

Previous update: 2026-08-07 (Replaced Active Client's "MAS Regulated" card with a new "TW Total Client" card at the very front, per Vincent: "把这个MAS regulated的卡片去掉，换成一张新的卡片，显示TW TOTAL CLIENT，目前数据是786（这个你要确保每天可以自动化准确的匹配到TW的数量），并且这个卡片要放在最前方，前提卡片往后移动一个位." Backend: app/api/master-list/route.ts's GET now also returns `twTotalClientCount` (active_client only) — `companies.filter(c => client_type === 'CSS Client' && is_active === true).length`, computed from the SAME `companies` query the route already runs (added `is_active` to its select list) rather than a new query. No new automation needed for the "每天自动化准确匹配" requirement — companies.client_type/is_active are already kept fresh every night by the existing teamwork/sync cron for every TeamWork company (confirmed earlier today when investigating a different count question), so this card just reads already-current data live on each page load. Frontend: new state `twTotalClientCount`, rendered as a standalone, non-clickable MetricCard (Building2 icon, "TW Total Client" / "CSS Client, active in TeamWork") placed before the `catCards.map()`, making it the first card in DOM/grid order. Removed MAS Regulated's card entry and, since it was the ONLY thing that could ever set `catFilter` to `'mas'`, also removed the now-fully-unreachable `'mas'` union member, its `catMatch` switch branch, and the `isSet()` helper function it was the sole caller of, rather than leave dead code — matching the precedent already set today for `resumeAutomation`. Also removed the now-unused `Landmark` icon import. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-07 (Reordered Active Client's metric cards per Vincent, from a screenshot of the current 7-card row: "non teamwork / missing from active client 卡片放到 第3/第4张的排序." Along the way, precisely explained what the "782 TW CSS Clients" card actually counts (Vincent had been comparing it directly against his own live TeamWork tally of 786, assuming they should be the same number): it's `rows.filter(r => r.is_css_client === true).length` — of the CURRENT 783 Active Client rows loaded in the table, how many are confirmed matched to a `companies` row with `client_type === 'CSS Client'` — a subset of the list itself, not TeamWork's total CSS Client count. Traced the exact 783-vs-782 gap to one specific row, MD WRAP PTE. LTD. (added earlier this session), whose `roc_no` doesn't yet match any row in the `companies` mirror table (TeamWork's own live data already knows about it — its invoice_address came from there — but the periodic bulk company sync hasn't picked it up as its own row yet), so `is_css_client` resolves to `null` rather than `true` for it. Also reconciled the separate 786-vs-787 gap (Vincent's live count vs. `companies` table's CSS-Client-and-active count) as ordinary, self-correcting sync lag, not a bug. Reorder itself: `catCards` array reordered so `non_teamwork` is 3rd; `Fragment`-wrapped the array map so the "Missing from Active Client" card (previously always rendered last, outside the array since it toggles a different panel rather than `catFilter`) renders immediately after `non_teamwork` specifically, landing as the 4th card — grid position is pure DOM order (`gridTemplateColumns: repeat(auto-fit,...)`, no CSS `order` overrides anywhere), so this fully determines on-screen placement. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-07 (Found and fixed a real, widespread data corruption bug while explaining the Active Client count mismatch Vincent flagged next: "ACTIVE CLIENT 那边我的TW记录是786家，系统TOTAL LIST应该是784家，但是数量现在有点对不上." Direct answer: current count is 783, not 784 — the 1-off gap is ALITA PTE. LTD. (ROC 202412314N), which the newer master file still lists as Active but whose real TeamWork status is "Striking Off" (is_active:false), matching what the system already has it filed as — the file is one company behind reality here, not a system error. While inspecting ALITA's row to confirm this, noticed its invoice_address held a bare date ("31/12/2025") and its kyc_year held a real postal address — the two fields' values were swapped. Rather than fix just that one row, checked the full scope: 213 rows system-wide (Strike Off 101, Terminated 110, Ad-Hoc 2), all sharing the exact same created_at batch timestamp (2026-07-01T09:26:4x, a prior bulk import), had invoice_address holding something that strictly matches a date pattern. Vincent's instruction: fix it, but only where genuinely confirmed as a real swap. Verified rigorously before touching anything — content-based, not assumed: required BOTH invoice_address to strictly match a date regex AND kyc_year to independently look like a real Singapore address (contains "Singapore"/road-type keywords/unit-number patterns), eyeballed a spread-out random sample of 15 across the full range and every one showed an unambiguous swap (a real address sitting in kyc_year, a bare date sitting in invoice_address). Found and deliberately excluded 2 edge cases rather than force-fitting them into the same fix: XIN YU CULTURE LINKS (SG) PTE. LTD's kyc_year was the literal placeholder "N.A" (no real address to restore — just cleared its garbage invoice_address date instead of swapping in a placeholder); EMPEROR INVESTMENT PTE. LTD's kyc_year held a person's name ("Lily / Jessie", not a date, not an address) — left entirely untouched and flagged, since this row likely has broader corruption beyond just these 2 fields (matching what was also observed on ALITA and EMOTION ELEMENTS EARLIER — several OTHER fields, e.g. corporate_tax/efiling_authorization/ac/gst/contact_window, also hold clearly-wrong-typed values on some of these 2026-07-01-batch rows, but there's no reliable way to reconstruct the correct mapping for those without the original source file, so that broader issue was reported to Vincent but not guessed at). Executed the swap for the 211 confirmed-clean rows (swap invoice_address ↔ kyc_year) plus 1 clear-only row; re-verified afterward that exactly 1 row (the deliberately-excluded EMPEROR INVESTMENT) still shows a date in invoice_address, confirming the fix was complete and precise, not partial. Data-only change, no code touched; all one-time scripts deleted after use.)

Previous update: 2026-08-07 (Re-verified Active Client's count against Vincent's newer Master Client List file ("Copy of 2026.08.01- Master Client List (ACTIVE CLIENTS)" on his Desktop, dated after the 2026.04.10 file used for the earlier 15-company addition) — "最新 ACTIVE CLIENT LIST的数量再排查一次." Diffed all 784 file companies against master_list (all list_types, learning from the earlier missingCssClients false-positive investigation) both directions: zero genuinely new companies (everything in the file already exists in the system) — but found 9 companies currently filed under Active Client that are no longer in the new file at all. Didn't assume this meant they should just be deleted or ignored — cross-checked each against companies.tw_status first and found all 9 read "Terminated" or "Striking Off" with is_active:false, cleanly explaining why the newer file dropped them: they're genuinely no longer active clients. Presented the finding with the exact split (6 Terminated, 3 Striking Off) via AskUserQuestion; Vincent confirmed moving them to match TeamWork's status. While executing the moves, one (EASYFLY TRAVEL TECHNOLOGY, id 935) appeared to vanish after its update — investigated immediately rather than assuming success or shrugging it off: turned out a colleague, Lim Hoe Chyi, had independently moved that exact company via the app's own Move button (POST /api/master-list/move, which inserts a new row in the target list_type carrying over all fields then deletes the original) moments earlier the same morning — a genuine coincidental race, not data loss; the row now exists as id 1591 under Strike Off with real curated data (status "STRUCK OFF", grade "A", a specific real update_date) that's arguably better than what the script would have set. Confirmed via a full re-check that all 9 are correctly filed, one row each, no duplicates: TREE ART PAYA LEBAR/TAFA HOLDING/AI KING ROBOTICS/GAIAX INTERNATIONAL/OPENKIDS INTERNATIONAL/SINGAPORE CAMBRIDGE → Terminated; HHCLOUD TECHNOLOGY/HUOHONG/EASYFLY TRAVEL TECHNOLOGY → Strike Off. Data-only change, no code touched; all one-time scripts deleted after use.)

Previous update: 2026-08-06 (Fixed a real layout bug affecting every Master List Table view (Active Client, Strike Off, Terminated, Ad-Hoc, MAS, Name Change — all share this one component): a column filter dropdown got visually clipped whenever the current result set had few rows. Vincent, from a screenshot: "当我的数据很小的时候，窗口会变到很小，导致我很难使用filter功能，能不能默认窗口大小." Root cause: the table's scrollable wrapper (`outerRef`'s div in components/MasterListTable.tsx, `overflowX/overflowY: auto` for the sticky-header/sticky-column scroll-sync behavior) only ever had a `maxHeight` cap, no `minHeight` — its actual rendered height is driven purely by its normal-flow content (the table rows), and a `ColumnFilterMenu` dropdown opened from a header cell is `position: absolute`, which does NOT contribute to that flow height. With only a handful of rows, the wrapper's box was too short to contain the dropdown's full rendered size (search box + option list + Select All/Clear + OK/Cancel, ~300px), so `overflowY: auto` silently clipped the bottom of the dropdown — genuinely explaining "窗口变得很小...很难使用filter功能" rather than being about browser window size at all. Fixed by adding `minHeight: 400` to that same wrapper — a minimal, targeted change that doesn't touch the carefully-tuned sticky-header/sticky-column/mirrored-scrollbar logic already built around this exact container. `npx tsc --noEmit` clean, `npm run build` clean. Asked Vincent to confirm the fix visually in production since this is a rendering/interaction bug only really verifiable by eye.)

Previous update: 2026-08-06 (Refined the CODE/Email/FYE manual_fields rule per Vincent's correction, looking back at the earlier automation report: "只要是和TW的自动化内容是一致的，就先默认为自动化内容，要有小蓝点，如果原本内容为空，做自动化; 但是后续如果有用户手动改了，才判断为手动内容（没有小蓝点）." The rollout backfill earlier today had flagged manual_fields for ALL 794 rows' existing non-empty CODE/Email/FYE values indiscriminately (the same blanket rule the original 7 auto-synced fields use: any non-empty value = manual) — Vincent's point is that this is too conservative for these 3 specifically, since their automation source is one cheap `companies` row lookup: a value that already happens to match automation's current output isn't really a "manual override" at all and should show the blue dot, not be silently protected forever. Implemented as a genuinely different rule for just these 3 fields (added `LIVE_COMPARISON_FIELDS`) — both retroactively and going forward: (1) retroactive correction (one-time script, deleted after use) re-compared all 794 rows' current CODE/Email/FYE against `computeAutomationValue()`'s live companies-table lookup and un-flagged whichever matched exactly — CODE 782/791 un-flagged (9 genuinely differ), FYE 766/791 un-flagged (25 genuinely differ, up from an earlier snapshot's 1 — reflects real drift since then, not a bug), Email only 237/777 un-flagged (540 genuinely differ) — spot-checked several of the "differs" cases and confirmed they're real, meaningful differences (different contact sets, e.g. BLOCKCHAIN.COM's master_list email doesn't overlap TeamWork's contact report at all), not just cosmetic formatting noise, so leaving them protected is correct, not overly cautious; (2) `app/api/master-list/route.ts`'s PATCH handler now computes `isManual` differently for `internal_code`/`email`/`fye` specifically: `stored !== computeAutomationValue(...)` (a live `companies` lookup by roc_no, comparing internal_code directly, email against `tw_to_emails.join(', ') ?? best_email`, fye against fye_month converted to 3-letter abbreviation) instead of the simpler `stored !== null` the other 5 auto-synced fields still use (their automation sources aren't a cheap single-row lookup — dates need a live TeamWork AGM/AR fetch, Secretary needs a live profile-page fetch — so extending this same live-comparison treatment to them isn't practical the same way, and wasn't asked for). A save with no matching companies row (no roc_no, or roc_no not found in TeamWork) falls back to the original null-check behavior, matching the pre-existing safe default. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-06 (Fixed a real false-positive class in Active Client's "Missing from Active Client" panel, caught by Vincent from a screenshot showing 14 flagged companies: "这几家公司排查更新一下，看看是不是还是MISSING." Investigated each of the 14 individually (by ROC against both master_list and companies) rather than trusting the panel — found only 5 are genuinely missing from the system entirely (EVOP (Singapore) International, FUSIONSIGHT, IUIGA CAPITAL MANAGEMENT LLP, SINGAPORE MINING SOLUTIONS INVESTMENT, SUNYANG NJ); the other 9 (Fun Bridge, GENERAL MINING RESEARCH, HUASHENG GLOBAL TRADING, NEW LIFE TECH, Perennial Summit Holdings, SCOTIA SG GLOBAL, SPRING MUD, TREE ART INTERNATIONAL, Y&G MANPOWER AGENCY) already exist in master_list — just under Strike Off or Terminated, not Active Client. Root cause: app/api/master-list/route.ts's `missingCssClients` query only ever checked `master_list` rows `WHERE list_type = 'active_client'` — a company TeamWork still tags `client_type = 'CSS Client'` (its own strike-off/termination status not yet updated to match) but that staff have already filed elsewhere was flagged as missing even though it's fully accounted for. Presented the finding to Vincent with a fix-or-leave choice; he chose to fix it. Changed the check to look for the UEN anywhere in master_list, not just active_client — closes this exact false-positive class permanently, not just for these 14. Caught and fixed a second, more serious bug of my own while testing the fix against real data before deploying, per this session's standing practice of never trusting a diff without verifying against live data: the new all-list_types query was unpaginated, and master_list has ~1587 rows — well past PostgREST's default 1000-row page cap (a limit this exact codebase has hit and fixed elsewhere before, e.g. teamwork/sync's mlRows) — so the first version of the fix would have silently missed ~587 rows' worth of legitimate matches and made the panel show ~279 false positives instead of the 9 it was already showing, a regression far worse than the bug being fixed. Added the same explicit `range()` paging loop already used elsewhere in this file. Re-verified against live data after the pagination fix: exactly 5 remain, matching the manual per-company investigation precisely. Incidentally surfaced two more findings while investigating, reported to Vincent but not auto-corrected (needs human judgement): GENERAL MINING RESEARCH and SPRING MUD are already filed under Strike Off in master_list, but companies.tw_status still reads "Active" (TeamWork's own strike-off action may not have been actioned/synced yet) — worth a manual check; EVOP (Singapore) International has no registration_no/UEN on file in TeamWork at all (`is_active: false` there despite being tagged CSS Client), so it can't be reliably onboarded via the usual ROC-matching flow until that's resolved. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-06 (Strike Off / Terminated pages now sort by Update Date, newest first — Vincent: "为了方便看，我要这两个TABLE的排序是按照最新的日期在最上方，以此类推往下." update_date is free-text with genuinely mixed formats across this dataset (confirmed by querying real rows, not assumed) — DD/MM/YYYY, DD.MM.YYYY, "14 Nov 2019", and outright non-dates like "struck off by client" or "24/4/2026 (Liquidation)" — so a plain SQL `.order('update_date')` would sort it lexicographically as text, not chronologically (e.g. "14 Nov 2019" would land nowhere near "23/12/2019"). Reused lib/date.ts's `toIsoDateValue`, the date parser already calibrated to this exact dataset's ambiguous dd/mm-vs-mm/dd conventions (shared with the existing display formatter, toDisplayDate) rather than writing a new one — app/api/master-list/route.ts's GET now re-sorts in JS by parsed ISO date descending (nulls/unparseable last) whenever `type` is strike_off or terminated, after the existing SQL order. While testing this against real data, found a genuine gap in toIsoDateValue/toDisplayDate: neither recognized year-first dot-separated dates ("2022.10.27") — confirmed via query this isn't noise, 16 real rows (3 strike_off + 13 terminated) use exactly this format — added a new, unambiguous pattern (`^(\d{4})[./](\d{1,2})[./](\d{1,2})$`, a 4-digit leading group can only be the year) to both functions, fixing it at the shared-utility level rather than special-casing it just for this sort. Coverage after the fix: 216/258 strike_off and 205/258 terminated rows now parse cleanly (up from 213/192); the remainder are genuinely non-date free text ("Dissolved", "terminate by client", "Not client") or corrupted placeholder values ("00/01/1900", day=00) — correctly left unparsed and sorted last rather than guessed at. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-06 (Added Active Client CODE/Email/FYE to the auto-synced field set, per Vincent: "ACTIVE CLIENT的 CODE / EMAIL / FYE(FYE MONTH) 都要做自动化处理，这个应该也是有很直接的数据可以获取的." Verified he was right before writing any code — checked all 794 active_client rows against real automation sources that already existed but were never wired into master_list: CODE — companies.internal_code (already synced from TeamWork's own client_id) — 785/794 already match exactly, 8 differ, 0 empty; EMAIL — companies.best_email/tw_to_emails (already kept populated by two existing mechanisms: the upcoming-events recipient report, and lib/teamwork-contact-report.ts's contact-person-report fill-in, together covering all but ~260 of ~1136 TeamWork companies) — 778/794 already have a value (spot-checked several against the automation source: mostly matching, but some genuinely differ, e.g. CHINA SHIPBUILDING's master_list contacts don't overlap at all with TeamWork's contact report, confirming staff-curated data can be more accurate and must be protected, not silently replaced), 13 empty rows have a real automation source (immediate win), 2 empty with no source anywhere; FYE — companies.fye_month (the same self-corrected value proven reliable earlier today) — 792/794 already agree, 1 differs, 0 empty (strong incidental validation of today's earlier FYE root-cause fix). Wired up all three following the exact established manual_fields/blue-dot pattern: added to AUTO_SYNCED_FIELDS in master-list/route.ts (generic isManual = stored !== null, no special-casing needed, none are boolean). CODE and EMAIL write from teamwork/sync/route.ts — CODE reuses the same tw-bulk-loop map pattern as invoice_address's regAddrByRegNo (new codeByRegNo, same loop, no extra TeamWork call), merged into the same batched patch loop as invoice_address for one query instead of two; EMAIL placed AFTER contactPersonFillIn runs (re-reading companies.best_email/tw_to_emails fresh at that point) so a company that only just got its email filled in by that same run's fill-in step still gets it mirrored into master_list same-day instead of waiting for tomorrow's sync. FYE writes from ar-reminder/sync-workflow/route.ts, folded directly into the existing FYE self-correction block — reuses `correctMonth` (already computed there) as the source, so master_list.fye always mirrors today's true latest FYE the moment it's known, not a second independent computation that could drift from it. Before deploying any of this, ran a one-time backfill (batched, script deleted after use) to flag manual_fields for every one of the 794 rows' EXISTING non-empty CODE/Email/FYE values FIRST — this had to land before the code did, since the very next scheduled cron after deploy would otherwise treat unprotected pre-existing values as fair game to silently overwrite, which for Email specifically (778 rows, some genuinely diverging from TeamWork's data as found above) would have been real data loss; verified 0 rows left unprotected afterward. While implementing this, also noticed and fixed a latent instance of the exact bug Vincent caught for Secretary/ND earlier today (blue dot only catching up on reload, not instantly) — `handleSave`'s manual_fields mirroring had only ever been special-cased for secretary_active/nd_active, never generalized, so CODE/Email/FYE (and in fact the original last_agm_date/invoice_address/etc. fields too) would have had the same staleness; generalized it to mirror `manual_fields[field]: !!val` for any field in AUTO_SYNCED_FIELDS_UI on save, fixing it for all auto-synced fields at once rather than waiting to be asked again per-field. `npx tsc --noEmit` clean, `npm run build` clean. Verified in production after deploy: teamwork/sync gave `active_client_email_updates: 13` (exactly the predicted gap count, 0 errors) and `active_client_code_updates: 0` (correct — every existing CODE value was already protected by the backfill). Directly tested the clear-and-resume path on a real row (1V CAPITAL PTE. LTD, id 757) rather than trusting the 0-updates count alone: cleared its internal_code/fye and their manual_fields flags, re-triggered both routes, and both correctly auto-refilled the original values ("C8004"/"DEC") with manual_fields cleared back to automation-owned — ar-reminder/sync-workflow needed 3 attempts due to unrelated TeamWork/Playwright resource exhaustion (`ERR_INSUFFICIENT_RESOURCES`, from repeated rapid triggers earlier in the day, not a code issue) before it finally succeeded (`active_client_fye_updated: 1`, 0 errors). All three fields now confirmed working end-to-end, not just deployed.)

Previous update: 2026-08-06 (Extended the just-shipped Secretary checkbox fix to Nominee Director, per Vincent: "ND的打勾也做一样的处理." Checked first whether nd_active genuinely needed the same treatment (it previously had real independent automation, unlike secretary_active, which had none at all) — queried all 794 active_client rows and found 0 cases where nd_active and nominee_director's content currently disagree, confirming that in practice they're already meant to move together and the "independent status" distinction wasn't being used for anything real. Applied the identical pattern: app/api/master-list/route.ts's PATCH now sets `nd_active: stored !== null` in the same update whenever `field === 'nominee_director'` is manually edited (mirroring the secretary_active line added earlier); app/api/teamwork/sync/route.ts's ND block reworked so nd_active is derived from nominee_director's final effective value (freshly synced name, or the existing name if protected by manual_fields.nominee_director) rather than independently from `ndSet` — this also closes a latent edge case the old logic had, where `ndSet` (any active appointment) and `ndNamesByCompany` (only appointments whose nd_id resolves to a real name) were built from slightly different filters and could in principle disagree. `handleSave` in MasterListTable.tsx now also mirrors `nd_active: !!val` locally when `nominee_director` is saved, for the same instant-UI-sync reason as secretary. Removed the checkbox's independent click handler in both the Table view and the Modal (ServiceChip's `onToggleActive` prop, already optional from the secretary fix, is simply omitted for both fields now) — and since nd_active can no longer be independently set from the UI at all, the entire nd_active-specific `resumeAutomation` mechanism (its dedicated RotateCcw button, the `resumeAutomation` callback, the `onResumeAutomation` prop threaded through CompanyDetailModal) became dead code and was removed rather than left orphaned; `toggleActive`'s field type narrowed from the 4-field union down to just `'acc_active' | 'tax_active'`, its only remaining legitimate uses. `npx tsc --noEmit` clean, `npm run build` clean. No backfill needed — 0 mismatches existed before this change and the derivation is purely additive.)

Previous update: 2026-08-06 (Fixed Active Client's Secretary checkbox drifting out of sync with whether the Secretary cell actually has a name in it — Vincent, looking at the newly-added companies: "这个secretary, 有内容就需要打勾啊，没有打勾就是没有内容的意思，但是现在你有内容有些却没有打勾，那个打勾只是为了让我方便辨认那些是有内容的." Measured the real scope first rather than assuming it was just the 15 new rows: 30 of 794 active_client rows had secretary text but secretary_active=false/null, including a genuinely pre-existing one unrelated to today's work (ACG INTERIOR AND EXHIBITION PTE. LTD.) — confirming this is a real, general gap, not something introduced today. Root cause: unlike nd_active/acc_active/tax_active (genuine independent "is this service currently subscribed" flags, with nd_active specifically driven by real nd_appointments state), secretary_active has never had any automation writer at all — a grep confirmed the only way it's ever set is a manual checkbox click, completely decoupled from whatever the secretary text field says. Per Vincent's stated intent, Secretary's checkbox isn't a business-status flag, it's purely a visual "does this cell have content" indicator for scanning the table — so it must always equal `!!secretary`, never an independent state. Fixed at both write paths: app/api/master-list/route.ts's PATCH now sets `secretary_active: stored !== null` in the same update whenever `field === 'secretary'` is manually edited; app/api/teamwork/sync-secretary/route.ts now sets `secretary_active: true` alongside `secretary` whenever it writes a real name from TeamWork. Also removed the ability for it to independently drift again: ServiceChip's `onToggleActive` prop is now optional (mirrors CheckSquare's existing pattern), and the Secretary checkbox specifically (Table view's plain CheckSquare, and the Modal's ServiceChip via `renderField`) no longer takes a click handler — nd_active/acc_active/tax_active toggles are untouched, this only applies to Secretary. One-time backfill fixed all 30 already-mismatched rows (0 errors, re-verified 0 remaining mismatches after). `npx tsc --noEmit` clean, `npm run build` clean. Vincent tested it live and found the fix was still incomplete: "我特地删了内容，打勾还在，我刷新页面后，打勾才不见，我重新填写内容后，打勾又没有实现打勾回去，意思就是不同步" — the DATABASE write was correct (confirmed by the checkbox eventually catching up on a full page reload), but the CLIENT's optimistic local state wasn't: `handleSave(id, field, val)` (the single shared callback both the Table view's EditCell and the Modal's ServiceChip call through) only ever patched the one field being edited into local React state, with no knowledge that the server was now also deriving secretary_active from that same write — so the checkbox stayed visually stale until the next full refetch. Fixed by mirroring the same derivation client-side: `handleSave` now also sets `secretary_active: !!val` in the same local state update whenever `field === 'secretary'`, so typing or clearing the name updates the checkbox instantly, matching what the server persists, with no refresh needed. `npx tsc --noEmit` clean, `npm run build` clean.)

Previous update: 2026-08-06 (Found and fixed a second, unrelated real bug while adding 13 new companies to Active Client for Vincent (source: "Copy of 2026.04.10- Master Client List (ACTIVE CLIENTS).xlsx" on his Desktop, instruction: prefer automation's own data over the file per field, fall back to the file only where automation has nothing, and flag file-sourced auto-synced fields as manual — same manual_fields/blue-dot convention built earlier today). Diffing the file's 785 companies against master_list's 779 active_client rows (by ROC/name/internal_code) found 15 real differences, not 13 — 14 genuinely new companies never in the system, plus one, EMOTION ELEMENTS AND WELLNESS (ROC 201734464G), already present but filed under Strike Off with badly column-shifted legacy data (its email/phone/secretary were sitting under unrelated field names like efiling_authorization/ac/gst from a past mis-mapped import) — confirmed with Vincent via AskUserQuestion and moved (not duplicated) to Active Client, overwritten cleanly with fresh data exactly like a new row. Inserted all 15 with only the non-automated fields from the file first (auto-synced fields left empty), then triggered the real production automation in sequence — teamwork/sync (15/15 got invoice_address, 5/15 got nd_active/nominee_director from nd_appointments), ar-reminder/sync-workflow (14/15 got last_agm_date/last_ar_date/last_accounts_date/next_agm_due_date — all except MD WRAP PTE. LTD., the one company not yet in TeamWork at all) — deliberately reusing the real routes rather than hand-reimplementing their date-selection logic, so results are guaranteed to match what nightly automation would produce. While wiring up the third step (teamwork/sync-secretary, needed for the Secretary field), discovered that route returns a bare Vercel-layer 401 for ANY request, authenticated or not — traced to `proxy.ts`'s `CRON_PATHS` allow-list (the set of paths its middleware lets a `Bearer $CRON_SECRET` request skip normal Supabase-session auth for): `/api/teamwork/sync-secretary` was simply never added to it when the route was built earlier today, even though it has its own vercel.json cron entry and doc-comment claiming "Cron: 18:45 UTC daily" — confirmed via automation_sync_runs that source `teamwork_secretary` has ZERO rows ever, meaning this cron has been silently 401'd by middleware every single night since it shipped, never once actually running on schedule (the one successful secretary backfill so far was the local one-time script, which bypasses the deployed app entirely). Fixed by adding the path to CRON_PATHS. `npx tsc --noEmit` clean, `npm run build` clean. After the fix deployed, triggered teamwork/sync-secretary for real (its first-ever successful run, confirmed via automation_sync_runs) — 14/15 companies got a real Secretary name. Final tally across all 8 auto-synced fields for all 15 companies: only ONE field on ONE company had genuinely zero automation data anywhere — MD WRAP PTE. LTD.'s Secretary (MD WRAP has no internal_id in the TeamWork-mirrored `companies` table at all, so sync-secretary could never check it — notably its invoice_address and next_agm_due_date-adjacent data still came through automation from TeamWork's raw bulk company list, which apparently already knows about it even though our own mirror doesn't yet). Filled that one field from the file ("ZHANG DAN") and flagged manual_fields.secretary=true via the RPC; every other field on every other company is fully automation-sourced (manual_fields stays `{}`, blue dot shows). Two things surfaced by automation that disagree with the file were flagged to Vincent rather than silently resolved; he reviewed both and decided the file should win for each ("那两家就先按文件内容走，判定为手动记录") — applied as explicit manual overrides, same mechanism as any staff edit: GOLDEN BRIDGE MARTEC PTE. LTD. (id 1578) set nd_active=true/nominee_director="LOO HUI CHIN" with both flagged manual (nd_appointments still has no matching active entry, so this placement isn't yet reflected in TeamWork — automation will leave it alone until staff register it there or someone clears the cell); MAPLE GROVE CAPITAL VCC (id 1580) set next_agm_due_date="2027-06-30" (overriding automation's 2021-12-27, derived from real but apparently stale/incomplete TeamWork AGM history) with next_agm_due_date flagged manual. Both confirmed via direct query after the write. All 15 rows confirmed list_type=active_client (EMOTION ELEMENTS moved from Strike Off, id 144 preserved). All one-time scripts/JSON working files for this task deleted after use.)

Previous update: 2026-08-06 (Found and fixed the REAL root cause of the FYE Mismatch bug class, which had never actually been removed — only reactively patched over. Vincent asked a natural follow-up to the day's FYE fixes: "那之前都已经确定排查好了FYE的逻辑，那是不是就说系统可以很准确的判断那些公司是哪月的FYE在AR REMINDER了对吗？" Rather than assuring him yes, re-verified live: fetched BYTESFORCE/YINDA TECHNOLOGY/FUN FLARE's real TeamWork AGM/AR history directly (the same 3 companies fixed and verified December on 2026-08-05) — all 3 confirmed December from live data, but `companies.fye_month` had REVERTED to their old stale months (February/May/February). Root cause: `app/api/teamwork/sync/route.ts` line ~201 has always unconditionally overwritten `companies.fye_month` from TeamWork's bulk `fye_date` field (the same field proven stale — it can sit unchanged for years after a company's real FYE moves) with zero protection, no manual_fields gate, nothing — `if (fyeMon && fyeMon !== row.fye_month) patch.fye_month = fyeMon;`. ar-reminder/sync-workflow's self-correction (added 2026-08-05) was only ever a reactive nightly fix, never a structural one — whichever route ran LAST simply won, and the two routes had just happened to run in a lucky order since the fix shipped. Caught live: my own manual trigger of teamwork/sync minutes earlier (while verifying the ND legacy-text cleanup below) reintroduced the stale value for these 3 companies immediately — confirmed via automation_sync_runs (`teamwork_companies` run at 14:05–14:06 UTC today). Checked the actual blast radius rather than assuming it was just these 3: re-ran ar-reminder/sync-workflow and it reported `fye_month_corrected: 19` — 19 companies had reverted, not 3. Fixed the root cause, not just the symptom: changed the write condition to `if (fyeMon && !row.fye_month)` — teamwork/sync now only ever POPULATES fye_month on a brand-new/empty row (still useful to bootstrap a company ar-reminder/sync-workflow hasn't evaluated yet), and never again overwrites an already-set value; every subsequent correction is now permanently deferred to the self-correction logic, which is the only place with access to real AGM/AR event history and is proven more accurate. `npx tsc --noEmit` clean, `npm run build` clean. Immediately re-ran ar-reminder/sync-workflow again after the code fix shipped to restore all 19 regressed companies (verified BYTESFORCE/YINDA/FUN FLARE back to December, matching live TeamWork data) — production is correct again, and this specific bug class can no longer recur regardless of trigger order. Reported the full finding to Vincent, including that this was caught in the middle of an unrelated verification and that the honest answer to his question is "the LOGIC is now correct everywhere, but there was still a live structural hole letting it get silently undone" — now closed.)

Previous update: 2026-08-06 (Verified the manual_fields protection pattern actually does what Vincent expects for the "cleared back to empty → hands back to automation" case, per his question: "只要手动内容还在，就不自动化，所谓的手动内容是不包括空值的." Confirmed via code read (master-list/route.ts's PATCH: `isManual = stored !== null`, so an empty value always computes isManual=false) plus a live RPC test against a real row (1V CAPITAL PTE. LTD, id 757) — marked manual, cleared, restored — proving the write path behaves exactly as required, and cross-referenced all 4 automation writers (ar-reminder/sync-workflow, teamwork/sync, teamwork/sync-secretary, late-filing/sync) to confirm every one gates on `!manual_fields?.field` before overwriting. In the course of that check, Vincent asked a follow-up ("这边的都是自动化的吗？" — Active Client's Nominee Dir. column showing text like "Yes (chen De)" / "YES(LIU XIAOMEI)") that surfaced a much bigger, real finding: of 779 Active Client rows, 776 (99.6%) still held LEGACY pre-automation text in master_list.nominee_director — 174 as "YES (name)"/"YES", 602 as bare "NO" — a single combined Yes/No-plus-name text encoding from before nd_active/nominee_director were split into a separate checkbox + name field. Confirmed via direct nd_appointments lookups on 3 sample companies that these were never touched by the nominee_director auto-sync added earlier this same day, not because they were manually protected (manual_fields was `{}` for all 776) but because teamwork/sync's `nextName = ndNamesByCompany.get(key)?.join(', ') ?? null` only computes a value when TeamWork's nd_appointments has a CURRENTLY ACTIVE (not missing, not ceased) match for that company, and simply never overwrites when it doesn't — leaving decades-old free text sitting inertly in what is nominally an "auto-synced" field. Also found the exact root cause of the visible casing bug Vincent flagged ("chen De" / "ng Lay Kian" instead of "Chen De" / "Ng Lay Kian"): `lib/text-case.ts`'s `titleCase()` splits on whitespace and capitalizes `word.charAt(0)`, so a token like "(CHEN" has its capitalization applied to the parenthesis (a no-op) instead of the letter after it, leaving "chen" lowercase — confirmed this reproduces the exact screenshot text for both examples. Presented Vincent two options (fix the legacy text's display casing in place, vs. clear it and let real automation take over) with a preview of each; Vincent chose to clear: `clear-legacy-nd-text.ts` (one-time script, deleted after use) cleared all 776 legacy rows' nominee_director to NULL, first verifying none were manually flagged (0/776 — safe), then triggered `teamwork/sync` in production to prove the "hands back to automation" claim wasn't just theoretical — 138 of the 776 immediately auto-filled with real clean names from nd_appointments (e.g. "CHEN DE", "LIU XIAOMEI", no more Yes/No wrapper, and title-cased correctly on display since there's no more leading "(" to trip up titleCase()), the remaining 641 correctly sit empty pending real TeamWork data, and a follow-up query confirmed zero rows still carry legacy YES/NO text. Incidentally surfaced (not investigated further, not Vincent's ask): that same teamwork/sync run returned `ok:false` due to an unrelated `contact_person_fill_in` Playwright step failing to click TeamWork's login button (recaptcha/browser-closed error) — the ND patches had already committed by that point in the route so this didn't affect the fix, flagged to Vincent as a separate pre-existing issue, not yet triaged.)

Previous update: 2026-08-06 (Fixed a second, independent instance of the "topmost FYE instead of latest FYE" bug, this time in late-filing/sync/route.ts, found only because Vincent explicitly challenged whether the fix already proven in ar-reminder/sync-workflow had actually been applied everywhere: "首先，我要提出质疑，这个FYE的逻辑是否有按照之前设置ACTIVE CLIENT的逻辑一致（不是读取最上方，而是读取最新的 FYE MONTH）." Grepped the whole codebase for the same anti-pattern (`latestFyeMonth|fyeRaw|ev\[2\]`) and confirmed late-filing/sync/route.ts was the only other place with it: `if (fyeDate && !latestFyeMonth) latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()];` — the `!latestFyeMonth` guard only allows the assignment once, on the FIRST non-null fyeDate hit while looping a company's TeamWork AGM/AR history, and permanently blocks every later row regardless of its actual date; a company that changed FYE partway through has older cycles (under the old month) sitting earlier in TeamWork's own history, so this route could silently keep computing the WRONG month for exactly the same class of company ar-reminder/sync-workflow was fixed for on 2026-08-05. Fixed by porting the identical comparison pattern already proven there: added `latestFyeIso` tracked alongside `latestFyeMonth`, converting each row's fyeDate to ISO via the already-imported `toIsoDate` and only updating both when the new ISO string is greater than the best one seen so far (`if (fyeDate && fyeIso && (!latestFyeIso || fyeIso > latestFyeIso)) { latestFyeIso = fyeIso; latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()]; }`) — a mechanical port, no other logic in the loop touched. Confirmed this bug is independent of, and was not accidentally fixed by, any of the manual_fields protection work also landed in this same file recently — that work only gates WHETHER a computed value gets written, not HOW the value itself is computed. `npx tsc --noEmit` clean, `npm run build` clean. Verified after deploy: manually triggered `late-filing/sync` against production (`ok:true`, 905 checked, 0 errors, 38 refreshed). Cross-checked every company present in BOTH late_filing_companies and companies (joined on registration_no/uen, 45 overlapping rows) — financial_year_end (this fix) and companies.fye_month (the already-proven-correct ar-reminder/sync-workflow fix) now agree on all 45, two independently-computed "latest wins" derivations from the same underlying TeamWork history landing on the same answer for every case, including TAFOS CAPITAL PTE. LTD. (MAY/May) which came up earlier in the ND subrole work as a company with real appointment-history complexity. Confirmed result reported back to Vincent.)

Previous update: 2026-08-06 (Closed a real coverage gap in ar-reminder/sync-workflow, per Vincent's explicit follow-up ("彻底覆盖漏洞" — fully close the coverage gap) after the FYE Mismatch incident above dropped from 17 companies to 3 instead of 0: those 3 (including BYTESFORCE, the original tracked example) shared one trait — zero ar_reminder rows at all. The FYE Month correction and Active Client date sync both key off `companyId` alone, but the per-company loop they live inside was only ever populated from ar_reminder rows (`byCompany` built by grouping `rows as ArRow[]`), so a company with no ar_reminder row — new, or never had a cycle generated — could never have its fye_month re-checked no matter how many times the sync ran successfully; the ONE-TIME local backfill script from 2026-08-05 never had this limitation (it iterated every company directly), which is exactly why it looked fixed that day and then silently drifted back. Fixed by adding every remaining company with a TeamWork internal_id into `byCompany` with an empty row array after the existing ar_reminder-driven grouping (926 total vs. 743 previously covered) — the ar_reminder-specific patch loop at the bottom is already a correct no-op for an empty array, so this purely extends Active Client/FYE coverage without touching any other logic; verified by manually correcting the 3 stragglers first (direct TeamWork fetch, same "latest FYE wins" logic, all 3 confirmed December — FYE mismatch count independently re-verified at 0 before this change even shipped, so the DB state is already correct; this fix is about the nightly cron never regressing back to missing them). Raised concurrency from 10 to 15 for the ~25% larger workload (926 vs. 743), still well inside late-filing/sync's own proven range (up to 20) for the identical fetchAgmList call. Follow-up to the ar-reminder/sync-workflow timeout fix below: the first attempt (230s deadline) turned out too conservative — verifying it live, the route self-aborted immediately, and re-checking automation_sync_runs showed the last KNOWN-GOOD run (2026-08-04) had itself taken 244s, already past a 230s cutoff. Raised to 270s and re-triggered — still timed out, and the error message still said "230 seconds" even though the deadline was genuinely 270s now (a real bug: the abort message was a hardcoded string literal, never updated when WORK_DEADLINE_MS changed — fixed by interpolating the constant instead). With the message bug fixed, confirmed the SAME run was consistently exceeding even 270s: this route processed one company at a time with no concurrency at all, unlike late-filing/sync (its own proven WORK_DEADLINE_MS source) which uses a 12-way worker pool for the identical fetchAgmList call. Rather than keep raising a number against Vercel's fixed 300s ceiling, converted the main per-company loop to the same worker-pool pattern (companyEntries array + shared nextIndex + Promise.all(10 workers)) — a mechanical refactor that kept every line of per-company logic (Active Client dates, FYE correction, ar_reminder patch) identical, just no longer gated to run strictly one-at-a-time. Verified structurally sound via a careful re-read (brace balance, closure capture of shared counters — safe under JS's single-threaded execution model, same reasoning late-filing/sync's own worker pool already relies on) before building. Found and fixed a real production incident, reported by Vincent: "关于那个 ACTIVE CLIENT的 MISMATCH 我记得我昨天都已经处理好了，为什么今天又出现了同样的17家" — the FYE Mismatch self-correction fixed 2026-08-05 (ar-reminder/sync-workflow deriving companies.fye_month from the company's real AGM/AR history instead of trusting TeamWork's stale getCompanies fye_date field) had gone silent: automation_sync_runs showed ar_workflow's last actual SUCCESS was 2026-08-04, then every attempt since either got stuck at status="running" indefinitely or failed with "Previous run lease expired before completion" — meanwhile teamwork/sync's OWN unprotected fye_month write (from the known-stale bulk field) kept running successfully every night with nothing correcting it back, silently reopening the exact bug fixed the day before; confirmed live — BYTESFORCE, the original example company from that fix, was back to showing "February" instead of "December", and a fresh count found 17 companies with a real mismatch, matching Vincent's number exactly. Root cause: ar-reminder/sync-workflow has no timeout safety net — unlike late-filing/sync (which has an explicit 230s soft deadline that aborts cleanly and releases its lease before Vercel's 300s hard kill), this route just runs until either it finishes or Vercel kills it mid-flight; a hard kill never reaches the function's own cleanup code, so the lease sits until it naturally expires, and the next scheduled run either finds it still held or finds it just-expired-and-failed — either way, no clean success, and the self-correction never gets to run to completion. The exact trigger (why THIS route tipped over 300s starting 2026-08-05, when a 08-04 run of similar size completed in ~4 minutes) wasn't conclusively isolated, but the fix needed regardless of root cause is the same one late-filing/sync already proved: added the identical WORK_DEADLINE_MS(230s)/AbortController pattern (checked at the top of the per-company loop and passed into fetchAgmList so an in-flight TeamWork request also cancels promptly) so a slow run now always exits cleanly with a partial, honest result and a released lock, instead of ever hanging silently again. Active Client's Nominee Director column (the NAME text, not just the nd_active checkbox) now auto-syncs from the same nd_appointments register the Nominee Directors page and nd_active already use — Vincent: "ACTIVE CLIENT 页面的 ND 也是要同步，同步的数据可以和ND页面同步." Previously only nd_active mirrored nd_appointments (sub_role='Nominee Director', no/future cessation_date); the name itself had to be typed by hand even though the system already knows who it is. teamwork/sync's existing has_nd/nd_active block now also joins nd_appointments.nd_id against nominee_directors.name to build a company→name(s) map (joined with ", " for the rare multi-ND case) and patches master_list.nominee_director the same way, through the same manual_fields protection (nominee_director added to AUTO_SYNCED_FIELDS in both master-list/route.ts and MasterListTable.tsx) — a name a staff member typed in stays put, and nd_active/nominee_director are independently protected (a row can have one manually set and not the other). Extended the manual-override protection to Late Filing, closing the last gap the earlier audit found: late-filing/sync/route.ts used to gate its ENTIRE row-level overwrite on a single regex, `/^AUTO:/i.test(existing.remarks)` — so if staff opened the Edit modal, fixed only last_agm_date, but left remarks untouched (still "AUTO: Overdue 95 days", since the modal always round-trips the whole form), the row was still nominally "AUTO" and the very next sync could silently revert that just-corrected date. Replaced with the same manual_fields JSONB pattern as master_list, but WITHOUT a separate atomic-merge RPC this time — late_filing_companies already has a row-level optimistic-concurrency check (previousUpdatedAt vs. updated_at) in the PATCH route that already serializes two staff editing the same row, so a plain read-then-merge in that same request is safe (no separate per-field race exists to guard against, unlike master_list's independent per-field PATCHes). scripts/add-late-filing-manual-fields.sql adds the column plus a one-time backfill: any existing row whose remarks didn't already start with "AUTO:" gets ALL 5 protected fields flagged manual, preserving exactly what was already protected under the old row-level gate (financial_year_end/last_agm_date/last_annual_return_date/next_agm_due_date/remarks — last_accounts_date and company_name/uen are excluded: the first is never written by automation at all, the latter two are this route's own lookup keys). late-filing/route.ts's PATCH now flags a field manual only when its NEW value genuinely differs from what's currently stored (not just because the whole-form save round-tripped it unchanged) — comparing against a freshly-fetched row rather than trusting client state. The Table view (not the edit modal — Vincent's request said "mainly TABLE") now shows the same blue AutoFillDot on financial_year_end/last_agm_date/last_annual_return_date/next_agm_due_date/remarks whenever the value is auto-filled and not manually flagged. Built Active Client's Secretary auto-sync and manual-override protection for all 7 of today's automated fields, per Vincent's two follow-up requests. Secretary: found TeamWork's per-company profile page (view_company/<id>/?comp, Vincent supplied the URL) has an "Active Officials" table with the real Secretary appointment — verified against 4 real companies, all matched master_list exactly (ZHANG DAN/LIU XIAOMEI) — unlike getCompanies' company_secretary_staff, which is blank for every company checked. That page is slow and TeamWork throttles it at a fixed ~500ms/company total throughput regardless of concurrency (tested 5/10/20 — all ~25s for 50 companies), so all ~779 Active Client companies in one Vercel invocation would take ~6.5 minutes, over the 300s cap; ran a one-time local backfill instead (bypassing that cap, same pattern as the FYE-month backfill — 779 checked, 43 corrected, 0 errors) and added a new nightly cron (app/api/teamwork/sync-secretary, 18:45 UTC) that processes a 250-row rotating batch ordered by oldest-checked-first (master_list.secretary_synced_at), cycling the full roster over about 3 nights instead of needing to fit in one run. lib/teamwork-company-profile.ts extracts Secretary via regex (not DOMParser — this endpoint is fetched with plain https, no Playwright page), scoped past the "Active Officials" heading first since its table shares a CSS class with an unrelated earlier "Articles/Constitution" table on the same page (caught via a real extraction bug — first pass silently matched the wrong table and returned zero secretaries).
Then a full audit (Explore agent, cross-referencing every cron in vercel.json against every PATCH route touching the same tables) found that Secretary, Invoice/Reg Address, Last AGM/AR/Accounts Date, Next AGM Due, and nd_active — all 6 fields wired to automation today plus nd_active — had ZERO protection against a nightly sync silently overwriting a staff member's manual edit; the existing "mismatch badge" on last_agm_date/last_ar_date is purely informational and doesn't block the overwrite. Fixed by extending the SAME pattern already proven for ar_reminder.date_of_agm/filling_date (a `_manual` companion flag + a small blue AutoFillDot shown only on auto-filled values) — but as ONE JSONB `manual_fields` column on master_list rather than 6 separate boolean columns (mirroring companies.services_manual's existing atomic-merge-RPC pattern instead, since 6+ fields on the same table would mean 6+ migrations for a class of field that keeps growing): scripts/add-master-list-manual-fields.sql adds the column plus set_master_list_manual_field(row_id, field, manual) — the same atomic UPDATE...SET manual_fields = manual_fields || jsonb_build_object(...) trick already used for services_manual, avoiding the read-modify-write race that pattern exists to prevent. master-list/route.ts's PATCH now flags a field manual whenever staff save a non-empty value into it (clearing it back to empty un-flags it, handing control back to automation) and adds a distinct `resumeAutomation` action (touches only manual_fields, never the value) for nd_active specifically, since a checkbox has no "empty" state to clear — any click marks it manual, and a small blue reset icon (RotateCcw) appears next to it in both the Table view and the modal's Services section to hand it back. All three cron routes (ar-reminder/sync-workflow, teamwork/sync, teamwork/sync-secretary) now check `!manual_fields?.<field>` before overwriting; teamwork/sync-secretary still advances secretary_synced_at even for a manually-protected row so it doesn't permanently sort first and starve the rotation. AutoFillDot appears in both the Table view (EditCell) and the detail modal (ModalField, plus a hand-added case for Secretary specifically since it renders through the ServiceChip branch, not the generic ModalField path) — confirmed via full build that every other Master List page (Ad-Hoc/MAS/Strike Off/Terminated/Name Change) still compiles and renders normally, since none of their rows will ever have a populated manual_fields (only Active Client rows are ever touched by these crons). Late Filing's own weaker "AUTO:"-prefix-on-remarks protection (same class of gap, per-row not per-field) was also found in the audit but is a separate, not-yet-started follow-up — Vincent has not yet been asked to confirm scope/priority for that piece. Fixed a real production incident from the invoice_address auto-sync just added: it patched Active Client rows one at a time (update + audit-log call sequentially awaited per row) instead of batching like every other bulk patch in the same file (updates/ndPatches/mlPatches all use Promise.all in chunks of 10) — across ~900 Active Client rows this pushed app/api/teamwork/sync past Vercel's 300s cap and left the run stuck at "running" in automation_sync_runs (caught via FUNCTION_INVOCATION_TIMEOUT on the very first production trigger); fixed by batching the invoice_address patch loop the same way; Added two Active Client auto-update fields per Vincent's request, backed by real TeamWork screenshots and empirical verification, not guesses: (1) master_list.last_accounts_date/next_agm_due_date now fill from the same per-company AGM/AR event history ar-reminder/sync-workflow already fetches for last_agm_date/last_ar_date — Vincent's screenshot pinned the exact mapping: Last Accts Date = the FYE Date on the SAME AR row as the latest filing (not just the newest FYE on file, which could be an unfiled future cycle), Next AGM Due = the Due Date of the nearest not-yet-held AGM event; (2) master_list.invoice_address for Active Client now mirrors TeamWork's company_reg_Office_address field (app/api/teamwork/sync, which already fetches it for the uses_address flag) — verified against 18 real companies first (16/18 matched known-good addresses) before wiring it up; Vincent also asked for Secretary/contact email/Tel No. to auto-update, but empirically these come back essentially empty from TeamWork's getCompanies bulk API — checked the same 18 companies: company_secretary_staff was blank for all 18 (0%) even for companies with a known correct secretary in master_list already, company_email_address was blank for 16/18, company_telephone_number was blank or just the "65-" country-code placeholder for all 18 — none of these are wired up since there's no reliable automated source yet; Secretary is likely derivable the same way Controller History was for the ND fix (each staff member's own profile page has a Secretary History table listing their companies — already proven scrapable in lib/teamwork-nd.ts — just needs inverting into a company→name map), but that's a separate, not-yet-started build; Trimmed the Active Client Table/List/Modal column set per Vincent's request — removed ACC/TAX, Incorp w/ Us, MAS, Add @, Contact Window, and >13M Accts from app/master-list/active-clients/page.tsx's ACTIVE_CLIENT_FIELDS; since MasterListTable's Table columns, List-view row, and CompanyDetailModal are all generically driven off this one `fields` array (confirmed by reading through the component before editing — Company Detail Modal's `services`/`notes`/`contactAddress` groups just render however many fields land in each FIELD_SECTIONS bucket, no hardcoded assumption of 4 Services items or any specific field being present), a single edit there cleanly removes all three surfaces at once; the one place NOT driven by `fields` was the List-view's compact row summary (hardcoded ND/SEC/ACC/TAX checkbox pills) — removed the ACC/TAX pills there by hand too so it doesn't keep showing checkboxes for fields that no longer exist anywhere else in the view; data itself is untouched (still in master_list, still shown on every other Master List page that uses the full default column set) — this only hides the columns/fields on the Active Client view specifically; Added a manual Remark column to the TeamWork subrole review table (nominee-directors page) so staff can leave a free-text note per flagged row — e.g. "confirmed with client, fixing in TeamWork this week" — while the underlying automation keeps re-checking it nightly; stored as a new `remark` column directly on `automation_exceptions` (**requires running scripts/add-automation-exception-remark.sql in Supabase**), safe because replaceAutomationExceptions does an upsert keyed on (source, exception_type, entity_key) that only sets the columns it explicitly lists, so nightly syncs update entity_name/details/status/last_seen_at without ever touching or clearing remark; new PATCH /api/nominee-directors/subrole-remark route updates by entity_key, no conflict/CAS handling since this is a single free-text field with low collision risk (not the same class of bug as the boolean-toggle CAS gap fixed earlier); NDSubroleReview.tsx's RemarkCell saves on blur only, no visible saving indicator, matching Vincent's established preference against visible save chrome; while testing this, caught a near-miss: a stray `npm run build` accidentally ran from C:\Users\vincent itself (a different repo, tassure-contracts-web) instead of tassure-invoice due to a working-directory drift bug that recurred many times this session — that repo is memory-flagged as unsafe to build locally (bulk npm run build there is known to leak 50GB+ RAM and black-screen the machine); no crash this time since the build finished fine, but a reminder to always cd explicitly before every command; Vincent caught one more gap in the ND missing-subrole fix: CHEN DE's BELTROAD INTERNATIONAL INVESTMENT CONSULTING was flagged as a genuine missing-subrole case, but his profile page's Controller History table clearly shows a standing Controller registration for that company (29/10/2021) — "这个是CHEN DE的那家公司，你可以看到下面是还有记录的"; the previous commit had dropped the Controller-History-table cross-check entirely in favour of only checking the profile page's own Subrole text, which correctly caught ZHANG DAN's 5 Controller rows but wrongly dropped the Controller-History signal that Chen De's case actually needed — his Director History row's Subrole is genuinely blank, but a separate standing Controller History entry (a different date, a different registration) still means he's accounted for at that company; both signals are real and independent, so scrapeMember now applies them together: filter blank-subrole candidates against the Controller History table first (already present in the same AJAX response, no extra fetch — catches Chen De and 4 of Zhang Dan's 5 companies for free) and then re-verify whatever's left against the profile page's Subrole text (catches Zhang Dan's Tafos Capital, the one company with no separate Controller History row but "Controller" written directly in its own Subrole field); re-verified against live TeamWork data before deploying: total local run dropped to 269.5s (0 errors), missing_subrole_rows dropped from 5 to 3, and WANG YIDONG's SINGAPORE MINING SOLUTIONS INVESTMENT correctly disappeared from the list too — confirmed by direct re-fetch that this wasn't a bug, TeamWork staff had manually filled in its Subrole as "Nominee Director" sometime between yesterday's and today's check; final genuine missing-subrole set is 3: LI JIANWEI's DB AI HE JIU, LIU XIAOMEI's LOYANG GUOAN TRADING & SERVICES, WANG YIDONG's JIN MU TECHNOLOGY; Vincent caught that the Controller History table-matching heuristic from the previous fix was itself still wrong ("你要看清楚也，TAFOS 很明显有记录是 CONTROLLER"), and provided the real ground truth: a screenshot of ZHANG DAN's own individual profile page (https://apps.teamworkcss.com/tassure_asia/view_member/39/?v), whose Director History table has an explicit "Subrole" column showing "Controller" in plain text for TAFOS CAPITAL/2 CWIOS companies/LIONWIT ADVISORY/TA ASIA MANAGEMENT — while the AJAX endpoint lib/teamwork-nd.ts had been scraping (mainadmin/ajax_get_appointment_history_status) reports blank Role for those exact same rows; confirmed this is a genuine data discrepancy between two TeamWork surfaces, same pattern as the FYE Month bulk-API-vs-UI bug found earlier — the AJAX endpoint simply never surfaces "Controller" as a Role value, it also doesn't correspond 1:1 with the separate Controller History table by company name (CHEN DE's Beltroad matched by name in the old Controller-History cross-check but its own Subrole column is genuinely blank — that row was a false exclusion); rebuilt scrapeMember as a hybrid: keep the fast AJAX POST for appointments and candidate blank-subrole rows (unchanged, ~50s/person), then for the handful of candidates only, re-verify against the profile page's own Subrole column as ground truth — first tried via parserPage.goto() (a full rendered page load), which added enough per-person overhead to blow past both the 275s internal ceiling and intermittently the 45s per-page timeout (lost 3 people's already-fetched appointments when their profile-page step failed, since the whole scrapeMember threw); switched to context.request.get() for the profile HTML (a plain HTTP fetch through the same authenticated session, no browser rendering) — dropped total local time for 12 people from >354s to 276.6s with zero errors; also wrapped the verification step in try/catch so a profile-page failure now falls back to keeping the AJAX candidate unverified rather than losing that person's already-successful appointment data; tested concurrency 4 hoping to buy more safety margin — made it worse (390s, 6 timeouts), confirming TeamWork throttles concurrent requests per session rather than per request, so kept concurrency at 3 and set the internal timeout to 290s (10s under Vercel's maxDuration=300 hard cap); final verified missing-subrole set is 5 genuine gaps: LI JIANWEI's DB AI HE JIU, LIU XIAOMEI's LOYANG GUOAN TRADING & SERVICES, WANG YIDONG's 2 companies, and CHEN DE's BELTROAD (now correctly included, reversing the previous fix's false exclusion) — ZHANG DAN has zero genuine gaps, all 5 of her candidates confirmed as real Controller appointments via the profile page's own Subrole column; Applied a second ND missing-subrole rule Vincent had originally set but wasn't documented anywhere ("subrole 显示 ND 才是真ND，controller 不算" — a blank-role Director History row only counts as a genuine missing-ND-subrole if this person isn't already registered as that company's Controller): verified live against TeamWork's HTML that of the 10 rows the previous fix surfaced, 6 (CHEN DE's Beltroad, and 4 of ZHANG DAN's 5 companies) have a matching entry in that person's Controller History table — same company, independent appointment date — confirming they're Controller appointments, not pending ND placements; lib/teamwork-nd.ts's scrapeMember now also parses the Controller History table (when present) and drops any Director History row whose company matches, alongside the existing Secretary History table-scoping fix; the review queue should now show only genuine gaps: LI JIANWEI's DB AI HE JIU, LIU XIAOMEI's LOYANG GUOAN TRADING & SERVICES, WANG YIDONG's 2 companies, and ZHANG DAN's TAFOS CAPITAL (the one of her 5 with no Controller History match); Root-caused and fixed the ND missing-subrole false positives that the LI JIANWEI/ZHANG DAN/LIU XIAOMEI name-based exclusion list was band-aiding: TeamWork's appointment-history AJAX response embeds several history sections back to back as separate <table>s (Director, Shareholder, Secretary, Contact Person...), and Secretary History happens to share Director History's exact 5-column shape with a permanently blank Role column — lib/teamwork-nd.ts's scrapeMember was scanning the whole response for <tr>, so every Secretary appointment was misread as an ND appointment missing its subrole; verified directly against TeamWork's live HTML for all 3 previously-excluded people before touching code (Vincent had just asked to revert LIU XIAOMEI's exclusion — "麻烦把LIU XIAOMEI恢复回去" — and the resulting review queue plus his own screenshot of her Secretary History for FUTAI RENOVATION/ARK PARTNERS MANAGEMENT/LITTLE WHITE TRADE & TECHNOLOGY made the pattern obvious) — the whole-document scan produced 46 false positives for LI JIANWEI and 599 for ZHANG DAN, vs. their real counts of 1 and 5 once scoped to just the Director History table; fix scopes row extraction to the <table> that follows the "DIRECTOR HISTORY" <th>, throwing if that table can't be found rather than silently falling back to the buggy whole-document scan; SUBROLE_REVIEW_EXCLUDED_PEOPLE is now removed entirely (no longer needed) — the review queue will show LI JIANWEI's DB AI HE JIU PTE. LTD., ZHANG DAN's 5 companies (CWIOS INTERNATIONAL ENTREPRENEUR INCUBATOR, CWIOS INTERNATIONAL BLOCKCHAIN TECHNOLOGY, TAFOS CAPITAL, LIONWIT ADVISORY, TA ASIA MANAGEMENT), and LIU XIAOMEI's LOYANG GUOAN TRADING & SERVICES as genuine open items on the next ND sync — these are real TeamWork data gaps, not Secretary-role false positives, and Vincent has not yet confirmed whether to re-suppress any of them after checking with staff; Fixed a real regression from today's Master List conflict-detection feature: a checkbox that had never been touched before (stored NULL, not false) looked like a false conflict on its first-ever click and snapped back unchecked — the CAS check now treats NULL and false as equivalent "was unchecked" for boolean fields; Root-caused the FYE Mismatch badges — verified live against TeamWork's own API that companies.fye_month's source field (getCompanies' fye_date) can sit stale for years after a company's real AGM/AR cycles moved to a new FYE month, confirmed by directly querying TeamWork for BYTESFORCE (API says February, actual cycles have been December since FYE2023); ar-reminder/sync-workflow now self-corrects fye_month from the latest actual AGM/AR cycle instead of trusting that stale field, reusing the same per-company TeamWork fetch already done there, no extra API calls; Master List's realtime sync no longer ever reloads the table for an UPDATE, full stop — the previous same-day fix narrowed when it reloaded, this removes the reload path entirely and also skips re-applying a client's own edits back to itself; also removed the "last edited by" trace display Vincent had asked for earlier the same day, after deciding he didn't want it visible after all; Master List's realtime sync was reloading the whole page after every single edit, not just ACC/TAX PIC ones — **requires running scripts/fix-master-list-realtime-full-reload.sql in Supabase**; also removed the "Live update" toast and the saving/saved status dot from both Master List and AR Reminder per Vincent's request; SSO to Proposal Generator: fixed the redirect target — was landing directly on the receiving app's API endpoint as raw JSON with no browser JS to act on it, now goes to its /sso/callback page per its redesigned no-OTP flow; measured real-time delivery latency empirically — 370-712ms — and applied Supabase's documented RLS perf fix (wrap auth.jwt() in a SELECT) to both realtime policies — **requires running scripts/optimize-realtime-rls-policies.sql in Supabase**; Master List now live-syncs across users in real time, matching AR Reminder — **requires running scripts/enable-master-list-realtime.sql in Supabase**; app-wide multi-user overwrite audit: fixed a real JSONB lost-update bug in Companies' service overrides, added conflict detection to Late Filing and Email Templates, added a persistent "last edited by X · time ago" trace to Master List replacing the fading checkmark — **requires running scripts/add-service-override-merge-function.sql and scripts/add-master-list-updated-by.sql in Supabase**; Master List now has optimistic-concurrency conflict detection like AR Reminder; cut Master List field-save latency by removing two redundant round trips per write; Late Filing companies mirrored into AR Reminder; fixed AR Reminder's cross-cycle search so mirrored/orphaned rows are actually findable, and widened the year dropdown past 2024-2027; nightly cron chain shifted 3h earlier to finish by SGT 05:00; AR Reminder's AGM/AR date columns: manual edits now win over automation, with a blue auto-fill dot in the Table view — **requires running scripts/add-ar-manual-date-flags.sql in Supabase before the next `ar_workflow` cron, now 20:00 UTC / SGT 04:00**)

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

- **Fixed a real regression Vincent hit from today's own Master List
  conflict-detection feature: checking a Service checkbox
  (Nominee Dir./Secretary/ACC/TAX) for the first time on a row that had
  never had that box touched before immediately snapped back unchecked.**
  Reported directly ("这边的我打勾了又会变成没有打勾"), verified against the
  actual row (`BHAKTI CITRA INVESTAMA PTE. LTD.`, id 1575 — all four
  `*_active` columns genuinely `NULL`, matching the screenshot exactly)
  before writing a fix.
  - **Root cause**: `app/api/master-list/route.ts`'s PATCH does an
    optimistic-concurrency compare-and-swap using `previousValue` — for a
    checkbox that's never been set, Postgres stores `NULL`, not `false`,
    but the client always sends a real boolean (`!!current` coerces
    `null`/`undefined` to `false`). The CAS `WHERE field = false` clause
    then never matches a row whose actual value is `NULL` (`NULL = false`
    is never true in SQL) — so the very first click on any untouched
    checkbox looked exactly like someone else had already changed it,
    triggering the new conflict-revert path and snapping straight back to
    unchecked despite nothing else having touched it.
  - **Fix**: for `BOOLEAN_FIELDS`, when the client's previous value is
    `false`, the CAS condition now matches rows where the field is either
    `false` OR `NULL` (both display as unchecked, so both are valid
    "client saw this unchecked" states) via `.or('<field>.is.null,<field>.eq.false')`.
    Matching `= true` stays an exact, unambiguous comparison — no such
    gap exists once a value has actually been set at least once.
  Production build passes; `npx tsc --noEmit` clean.

- **Nominee Directors: added `LIU XIAOMEI` to the subrole-review
  exclusion list** (`lib/teamwork-nd.ts`'s `SUBROLE_REVIEW_EXCLUDED_PEOPLE`,
  which already had `LI JIANWEI`/`ZHANG DAN` for the same reason — reused
  the existing mechanism, no new code path). Context: the "TeamWork
  subrole review" panel on the Nominee Directors page flags any configured
  ND person's appointment that's Effective, not yet ceased, but has a
  blank Nominee Director subrole in TeamWork — meant as "go confirm and
  fix this in TeamWork." Vincent relayed a WhatsApp thread where staff had
  already checked each of Liu Xiaomei's 3 flagged companies individually:
  Secretary role (not director) at Little White Trade & Technology and
  Futai Renovation, and a genuine but *unpaid* directorship (not a billable
  Nominee Director placement) at Loyang Guoan Trading & Services — none of
  these are something to "repair" in TeamWork, so they'd keep resurfacing
  every sync forever without this exclusion. Her legitimate paid Nominee
  Director appointments elsewhere are untouched — this only silences the
  review-queue reminder, filtered independently in the same function.
  Production build passes; `npx tsc --noEmit` clean. Takes effect on the
  next `teamwork_nd` sync (manually triggered after this deploy, not left
  to wait for the next scheduled run).

- **Root-caused and fixed the FYE Mismatch badges on Active Client
  (16 companies flagged).** Vincent's own hypothesis was that "the system
  only reads the topmost/first FYE entry, not the latest" — investigated
  by directly querying TeamWork's live `getCompanies` API for one flagged
  company (BYTESFORCE INTERNATIONAL, UEN 202010024R) rather than guessing:
  it returned `fye_date: "28/02"`, while the company's own AGM/AR cycle
  history (which Vincent screenshotted) shows FYE moved to December
  starting cycle 2023-12-31, and TeamWork's own "List of Companies" UI
  page *already* shows "December" for the same company. So the mechanism
  Vincent suspected is real, just not in this codebase — it's TeamWork's
  own backend where the bulk `getCompanies` list endpoint and the
  per-company UI disagree, and the bulk endpoint (the only one
  `app/api/teamwork/sync/route.ts` used for `companies.fye_month`) is the
  stale one.
  - **`app/api/ar-reminder/sync-workflow/route.ts`** now self-corrects
    `companies.fye_month`: for each company, scans its already-fetched
    AGM/AR event history (same per-company fetch already done there for
    the Active Client date-filling below — no extra TeamWork call) and
    takes the FYE month of the event with the **latest** FYE date, never
    the first one encountered — a company that changed FYE has older
    cycles under the old month sitting earlier in its history, which is
    exactly the failure mode being fixed. Updates `companies.fye_month`
    when it differs, logs the change (`system:teamwork-agm-history`). New
    response fields `fye_month_corrected`/`fye_month_errors`.
  - Once this runs (tonight's cron, or triggered manually), the FYE
    Mismatch badge should clear for any company whose *only* problem was
    this stale field — no changes needed to the mismatch-detection logic
    itself in `components/MasterListTable.tsx`, it was already correctly
    comparing `master_list.fye` against `companies.fye_month`; the bug was
    that the latter's own upstream source data was wrong, not the
    comparison.
  Production build passes; `npx tsc --noEmit` clean.

- **Master List's realtime sync no longer has ANY reload path for an
  UPDATE, and no longer re-applies a client's own edits to itself either
  — the previous same-day fix (below) narrowed *when* it reloaded, this
  removes that path completely.** Vincent hit the table going blank then
  refreshing again shortly after that first fix shipped — even the
  narrowed condition (comparing old vs new ACC/TAX PIC values) could
  still be wrong or still visibly flicker under a burst of background
  writes, and he was explicit twice in a row that he never wants to see
  the table visibly react to background sync at all, so rather than
  debug that narrower condition further the whole reload-on-UPDATE path
  was removed outright:
  - `components/MasterListTable.tsx`'s realtime handler: `UPDATE` events
    now ALWAYS patch the row directly from the payload, no exceptions —
    including `acc_pic_override`/`tax_pic_override`, whose *displayed*
    value (`acc_pic`/`tax_pic`, a cross-table join) can now go briefly
    stale until the next real page load. Accepted deliberately — a rare,
    minor, self-correcting cosmetic gap versus a table that visibly
    reloads while someone's mid-edit. Only genuine `INSERT` (a brand-new
    row with no local counterpart to patch) still triggers the debounced
    reload.
  - Also skips re-applying an event entirely when
    `next.updated_by_email === me?.email` (the logged-in user's own
    email, fetched via `/api/auth/me`) — a client's own edit is already
    reflected locally the instant it's made (`handleSave`/`toggleActive`
    stamp it optimistically), so the realtime echo of that same edit
    arriving ~400-700ms later was a pure no-op re-render with nothing new
    to show, and cheap to just skip.
  - **Removed the "last edited by X · time ago" trace display added
    earlier the same day** (`LastTouchedTag` and its three call sites,
    plus the modal header's inline version) — Vincent had explicitly
    asked for this Sheets-style trace that morning, then asked for it
    gone in this same message ("不需要显示这些出来"). The underlying
    `updated_at`/`updated_by_name` columns and the stamping logic that
    populates them are untouched (still real, still useful for the audit
    trail) — only the standalone visual tag was removed.
  Production build passes; `npx tsc --noEmit` clean.

- **Fixed a real bug in Master List's realtime sync (from the "wire up
  live sync" work above): it was reloading the whole page after EVERY
  single edit, not just ACC/TAX PIC changes.** Vincent noticed directly:
  "每次我更改一个东西，系统就会LOADING整个页面一轮" — every edit triggered a
  full-page loading flash. Also removed two pieces of routine UI he said
  he didn't want: the "Live update from X" toast, and the per-cell
  yellow-dot→green-check save indicator (both Master List and AR
  Reminder) — kept the error/conflict states, which still need attention.
  - **Root cause**: `components/MasterListTable.tsx`'s realtime handler
    decided whether to fall back to a full reload (needed only for
    `acc_pic_override`/`tax_pic_override`, since their *displayed* value
    is a cross-table join the raw payload can't recompute) by checking
    `Object.prototype.hasOwnProperty.call(next, 'acc_pic_override')` —
    but Postgres always sends the FULL new row in a `postgres_changes`
    UPDATE payload (every column, not just the changed ones), so that
    key always exists, on every single edit. The check needed to compare
    the OLD value against the NEW one instead — only possible once
    `payload.old` actually contains the full previous row, which requires
    **`REPLICA IDENTITY FULL`** (the default only puts the primary key in
    `payload.old`). **New `scripts/fix-master-list-realtime-full-reload.sql`**
    sets that; the comparison logic in the same file was corrected to match.
  - **`app/billing/page.tsx`'s AR Reminder subscription didn't have this
    bug** (its UPDATE branch always took the direct-merge path already,
    no reload-on-every-edit) — confirmed by re-reading it, not assumed.
  - Toast + status-dot removal: deleted `liveNotice` state and its fixed
    bottom-right toast in both `MasterListTable.tsx` and `app/billing/page.tsx`'s
    `ARTab`; `EditCell`/`ModalField` (Master List) and `EditField`/`SelectField`
    (AR Reminder) all had their `statusDot` simplified to always `null` for
    the saving/saved states — the underlying save and its audit-log entry
    are unaffected, this only removes what was shown to the user for a
    routine, already-succeeding save.
  Production build passes; `npx tsc --noEmit` clean.

- **SSO to Proposal Generator: fixed `app/sso/proposal-generator/route.ts`'s
  redirect target** — the ongoing multi-session saga's root cause finally
  identified. Was redirecting straight to
  `tassure-proposal-generator.vercel.app/api/sso?token=...` (an API route);
  every earlier "raw `{"error":...}` shown in the browser" failure across
  this whole saga was because a top-level browser navigation to a JSON API
  endpoint has no page/JS context to act on the response — nothing could
  ever have stored a session or redirected onward from there, regardless of
  what the API itself returned. The other app's 2026-08-05 redesign
  (abandoned OTP/magiclink verification entirely — now creates the
  user+session directly via the Supabase Admin API, no email round-trip)
  confirmed the intended entry point is `/sso/callback` — a real page that
  itself calls `/api/sso` client-side, stores the session, then redirects
  to `/proposal/generator`. Redirect target updated to match. Shared
  `SSO_SHARED_SECRET` value handed to the other session for its Vercel env
  config (HMAC verification requires both sides to hold the identical
  secret). Production build passes; `npx tsc --noEmit` clean. **Not yet
  confirmed working end-to-end** — next step is Vincent clicking the
  sidebar link once the other app's Vercel env vars are set.

- **Measured the real-time delivery latency Vincent asked about ("是可以快速更新了？少过1秒吗？"/"这个延迟有没有网上资料可以降到更低") instead of guessing, and applied the one concrete, low-risk fix the research turned up.**
  - Ran a live measurement (DB `UPDATE` → time until the Realtime event is
    received): **369ms, 389ms, 521ms, 712ms** across four runs — consistently
    under a second, no code involved beyond Supabase's own delivery
    pipeline. Reported this, not a guess.
  - Researched Supabase's current (2026) Realtime docs/guidance: `postgres_changes`
    is WAL-based and typically 50-200ms baseline, single-threaded per change
    (doesn't scale past ~3,000 concurrent subscribers — we have ~12 staff,
    nowhere near that, so no reason to consider migrating to Broadcast, the
    higher-scale/lower-latency alternative Supabase recommends for high-volume
    cases). One documented, applicable perf issue: every change triggers one
    RLS authorization check per subscriber, and Supabase's own RLS-performance
    guidance is to wrap `auth.jwt()` in `(SELECT ...)` so Postgres evaluates
    it once per statement (an "InitPlan") instead of re-evaluating per row —
    both `ar_reminder`'s and `master_list`'s Realtime policies used the bare,
    slower form. **New `scripts/optimize-realtime-rls-policies.sql`**
    recreates both with the wrapped form; same allowlist, same access, purely
    a cheaper evaluation. Not expected to be dramatic (our per-change
    subscriber count is tiny) but it's the one real, documented lever that
    applies to our actual setup rather than a bigger architecture change
    that wouldn't move the needle at this scale.
  Sources: [Postgres Changes | Supabase Docs](https://supabase.com/docs/guides/realtime/postgres-changes),
  [Realtime Postgres RLS](https://supabase.com/blog/realtime-row-level-security-in-postgresql),
  [RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv).

- **Master List now live-syncs across users, closing the gap flagged in the
  previous entry** (Vincent: "尽全力去做这个实时推送，不能卡顿，要快" — do the
  real-time push properly, it must not lag, has to be fast — after being
  told the "last edited by" trace only updated on refresh). Mirrors AR
  Reminder's own proven `postgres_changes` subscription
  (`app/billing/page.tsx`'s `ARTab`) exactly, rather than inventing a new
  pattern:
  - `components/MasterListTable.tsx` opens a Supabase Realtime channel per
    page (`master-list-<listType>`), filtered server-side to
    `list_type=eq.<listType>` so a page never receives another list's
    events. **UPDATE events patch the one changed row directly from the
    payload — no refetch, no round trip, instant** — the actual "not
    laggy" requirement. `acc_pic_override`/`tax_pic_override` are the one
    exception: their *displayed* value is a cross-table join
    (`ar_reminder`, by UEN) the raw payload can't recompute client-side,
    so those (and INSERT, which needs the same enrichment for a brand-new
    row) fall back to a 700ms-debounced reload — same tradeoff AR
    Reminder's own subscription already makes for its equivalent cases.
    DELETE removes the row locally and closes the detail modal if it was
    open for that row. A small "Live update from X" toast (bottom-right,
    auto-clears) confirms when something arrived — same visual AR
    Reminder already uses.
  - The Company Detail Modal was already deriving its displayed row via
    `rows.find(r => r.id === selectedRowId)` rather than a frozen copy, so
    it picks up live updates automatically — confirmed, not something
    that needed changing.
  - **New `scripts/enable-master-list-realtime.sql`** — two things
    without which the subscription connects but silently receives
    nothing: (1) adds `master_list` to the `supabase_realtime`
    publication (parallel to `ar_reminder`'s own `add-ar-collaboration.sql`
    entry); (2) Realtime is filtered through RLS for the *subscribing*
    role, which is `authenticated` (the browser's session) — not
    `service_role` (the server's admin client) — and `master_list` only
    ever had a `service_role`-only policy from its original table
    creation script, so a `SELECT ... TO authenticated` policy was
    missing entirely. Added with the same staff-email allowlist
    `ar_reminder`'s equivalent policy already uses.
  Production build passes; `npx tsc --noEmit` clean.

- **App-wide audit of every PATCH endpoint for multi-user overwrite risk
  (Vincent: "think hard about where else this could happen, and what other
  pages exist"), plus a visual overhaul of Master List's save feedback to
  a persistent Google-Sheets-style trace instead of a fading checkmark.**
  Every `export async function PATCH` in `app/api/` checked:
  - **Already protected**: AR Reminder (pre-existing field-CAS), Master
    List (fixed earlier today), Client Communications Drafts
    (pre-existing real `version` counter).
  - **`companies.services_manual`
    (`app/api/companies/service-override/route.ts`) — the worst pattern
    found, fixed.** Not just a same-field overwrite risk: the route did
    SELECT the JSON → merge one key in JS → UPDATE the whole object back.
    Two staff toggling two *different* services on the same company around
    the same time could have the second write silently revert the
    first's — it read the object before the first write committed, then
    overwrote the entire thing. **New `scripts/add-service-override-merge-function.sql`**
    adds a `set_service_override()` Postgres function that merges the one
    key inside a single `UPDATE`, removing the read step (and the race)
    entirely rather than just detecting it. The route now calls it via
    `.rpc()` instead of SELECT+merge+UPDATE.
  - **Late Filing (`app/api/late-filing/route.ts`) — had no protection at
    all, fixed.** This page saves a whole edit form at once, not per-cell,
    so field-level CAS didn't fit; used the row's own `updated_at` as a
    row-level optimistic-concurrency token instead (optional — an
    'auto'-source row being edited for the first time has no
    `late_filing_companies` row yet, nothing to conflict against). 409 on
    conflict reloads and asks the user to redo their edit.
  - **Email Templates (`app/api/client-communications/templates/route.ts`)
    — had no protection, fixed** with the same field-CAS pattern as Master
    List (client already holds each field's last-loaded value in the
    `templates` array, sent as `previousValue`).
  - **Email Senders — left as-is.** A handful of rarely-touched
    configuration rows (sender identity/default flag); the engineering
    cost wasn't worth it for something nobody collides on in practice.
  - **Other pages carry no risk**: Nominee Directors, Address Service,
    Companies listing, Dashboard are all read-only/TeamWork-derived, no
    PATCH endpoints exist for them.
  - **Master List's save feedback redesigned** (Vincent: the checkmark
    that fades after 1.4s "looks low, looks old" — wants something closer
    to Sheets' own edit-history feel). **New
    `scripts/add-master-list-updated-by.sql`** adds
    `updated_by_email`/`updated_by_name` (mirrors AR Reminder's existing
    columns), populated by the PATCH handler in the same round trip as
    the conflict-safe UPDATE added earlier today. New `LastTouchedTag` —
    a small persistent "🕐 Name · 3m ago" caption (real timestamp on
    hover) — added under the company name in both Table and List views,
    and in the Company Detail Modal's header. `handleSave`/`toggleActive`
    stamp it optimistically from the logged-in user's own name (fetched
    once via `/api/auth/me`) at the same instant as the field value, so it
    updates immediately rather than waiting for a reload — same optimism
    level the rest of the save flow already uses. The checkmark itself
    stays as the instant "saved" flash (useful on its own); the trace tag
    is what persists afterward, which is the part that was actually
    missing. Not done: this doesn't push live to OTHER users' open tabs
    (no realtime subscription on Master List, unlike AR Reminder) — a
    second user only sees a fresh trace after their own next reload; real
    live push would be a larger addition, flagged but out of scope here.
  Production build passes; `npx tsc --noEmit` clean.

- **Master List now detects edit conflicts, matching AR Reminder — two
  staff editing the same cell around the same time can no longer silently
  overwrite each other.** Vincent flagged this as a follow-up to a real
  incident earlier today (his own FYE edits and a colleague's, on the same
  rows, within minutes of each other — traced via `audit_log`, no data was
  actually lost that time, but nothing would have caught it if it had
  landed differently).
  - **`app/api/master-list/route.ts`'s PATCH** now requires `previousValue`
    (428 if missing) and uses it as a compare-and-swap condition on the
    `UPDATE` itself — same technique `ar_reminder`'s PATCH already used
    (`.eq(field, previousValue)` / `.is(field, null)`), just without a
    dedicated `version` column: the field's own current value IS the
    version check. If 0 rows match (someone already changed that exact
    field since this client last saw it), the client gets `409` with the
    real current value — looked up via the latest matching `audit_log`
    entry for who changed it. This also folds the old SELECT-before-UPDATE
    (added earlier today for latency) into the UPDATE's own `RETURNING`,
    so the conflict-safe path costs no extra round trip over the
    already-optimized one.
  - **`components/MasterListTable.tsx`**: `EditCell` and `ModalField` both
    gained a `'conflict'` status — on 409, the cell adopts the real
    current value (via `onSave`), shows it with a distinct amber
    "changed elsewhere" indicator (tooltip names who), and stops there —
    no accept/overwrite choice like AR Reminder's richer UI, since Master
    List's fields don't carry AR Reminder's version-conflict stakes; the
    point is just that an edit can never vanish unexplained again.
    `toggleActive` (checkboxes) reverts to the real value silently on
    conflict (already borderline-instant, no visible state to explain).
    `saveOverride` (ACC/TAX PIC) already reloads the whole row after every
    save, which self-corrects on conflict without extra code. The one
    remaining gap: the Company Detail Modal's Nominee Director/Secretary
    name field (via `ServiceChip`'s inline PATCH) now sends
    `previousValue` too, so a stale write is safely rejected server-side,
    but that one specific path doesn't yet surface the rejection in the
    UI — lowest-traffic of the five edit paths, worth a follow-up if it
    ever bites in practice.
  Production build passes; `npx tsc --noEmit` clean.

- **Cut Master List's per-field save latency (Vincent: felt like 1-2s per
  cell, wanted something closer to Google Sheets).** The UI was already
  optimistic (a cell shows the new value and returns to display mode the
  instant you commit, before the network request even starts — same as
  Sheets), so the 1-2s was entirely the save request itself taking that
  long, visible as a lingering "saving" dot. Two redundant round trips
  removed, both applicable to every write across the app, not just
  Master List:
  - **`lib/request-account.ts`**: `getRequestAccount()` (used by every
    PATCH handler that needs to attribute a change) called
    `supabase.auth.getUser()` — a live network round trip to Supabase's
    Auth server to re-verify the session. But `proxy.ts`'s middleware
    already does exactly that (also via `getUser()`) for every request
    before it ever reaches a route handler (its matcher covers all paths
    except static assets) — a second identical check downstream was pure
    duplicate latency. Switched to `getSession()`, which reads the
    already-verified JWT off the cookie with no network call. Safe
    specifically because the middleware's real check already ran on this
    exact request.
  - **`app/api/master-list/route.ts`'s PATCH**: did a `SELECT *` before
    every `UPDATE` purely to capture the pre-edit value for the audit log
    — but the cell being edited already had that value on screen a moment
    ago. `components/MasterListTable.tsx`'s `EditCell` now sends it as
    `previousValue` (mirroring the pattern AR Reminder's PATCH already
    used for optimistic-concurrency checks), and the route trusts it
    instead of re-reading — except for `acc_pic_override`/`tax_pic_override`,
    which still need a narrow `roc_no` fetch for the two-way AR Reminder
    sync regardless (now `select('roc_no,<field>')`, never `select('*')`).
  Not done: real-time/CRDT-style sync (how Sheets actually achieves
  sub-100ms multi-user feel) would be a much larger rewrite (WebSocket
  transport, conflict-free merge) — out of scope here; these two changes
  just remove work this app was doing twice. Also flagged separately:
  Vincent reported an edit that seemed to silently not save while another
  staff member (hoechyi) was editing the same row around the same time —
  likely a lost-update race (no optimistic-concurrency guard on Master
  List, unlike AR Reminder's `version` column) rather than a latency
  symptom; not fixed in this pass, worth a dedicated look if it recurs.
  Production build passes; `npx tsc --noEmit` clean.

- **Fixed AR Reminder's search so companies mirrored in from Late Filing
  are actually findable, and widened the year dropdown so their (often
  years-old) FYE cycle is reachable at all.** Found live: the Late Filing
  mirror feature above correctly created a row for a struck-off company
  (`ADVANCE BRIGHT GLOBAL PTE. LTD.`, FYE March 2022) but Vincent still
  couldn't find it — two separate, compounding gaps:
  - AR Reminder's cross-cycle search escalation (`useCrossCycleSearch`,
    used when a search term isn't in the currently-loaded month) queried
    `/api/companies` — the TeamWork roster — not `ar_reminder` itself. A
    company mirrored in from Late Filing specifically because it has NO
    `companies` row (struck off, removed from TeamWork) could never be
    found this way, no matter how the ar_reminder row was tagged.
    New **`app/api/ar-reminder/search/route.ts`** searches `ar_reminder`
    directly by name/UEN across every FYE month/year. `useCrossCycleSearch`
    is now generic (takes a `fetchMatch` function per caller instead of a
    hardcoded endpoint) — Billing Drafts keeps searching `/api/companies`
    (its numbers come from the TeamWork/QB side), AR Reminder now searches
    itself. Also switches `year`, not just `month`, when the match's cycle
    differs (previously only `month` — fine when everything was within
    "the current year," not for a cycle several years back).
  - Even with search fixed, the year `<select>` was hardcoded to
    `2024-2027` — 2022 wasn't a selectable option, so the row would still
    have been unreachable by manually picking a cycle. New shared
    `YEAR_OPTIONS` (current year ± a wide margin, 14 years) replaces both
    hardcoded lists (Billing Drafts and AR Reminder).
  Production build passes; `npx tsc --noEmit` clean.

- **Late Filing's companies now also appear in AR Reminder, under their own
  FYE cycle, visibly marked apart from ordinary rows, with the reason
  written into Remarks.** Vincent: Late Filing page companies need to be
  added into AR Reminder by FYE, distinguished in both List and Table
  views, with a late note in Remarks/Notes (same field — Table labels it
  "Remarks", the List/detail view's "Notes" section is the identical
  `remarks` column, just a different heading).
  - **`app/api/late-filing/sync/route.ts`** (the daily cron that detects
    late filers straight from TeamWork's AGM/AR history — a separate,
    stricter 90-day-overdue-or-90-day-historical-average heuristic than
    the Late Filing *page*'s own live derive-from-`ar_reminder` scan, so
    a flagged company doesn't always already have an `ar_reminder` row):
    for each flagged company with an actual outstanding unfiled cycle
    (skipped when the flag is purely from historical average with nothing
    currently due), derives that cycle's FYE month/year from the
    TeamWork-reported FYE month plus the AGM due date (AGM due = FYE + 9
    months, SG private-company rule — comparing month *numbers* rather
    than doing calendar-date subtraction avoids month-arithmetic overflow
    edge cases entirely), then either:
    - finds a matching `ar_reminder` row (by UEN, falling back to
      normalized name, scoped to that exact FYE month/year) and, only if
      its `remarks` doesn't already contain the marker, prepends the late
      note — never rewritten again afterward even if the reason text goes
      stale, so a staff edit to Remarks always sticks (same "manual wins"
      rule just added for the AGM/AR date columns); or
    - inserts a brand-new `ar_reminder` row for that cycle when none
      exists yet (this is the actual gap being closed — a company stuck
      90+ days late sometimes predates AR Generate's rolling window and
      so was invisible in AR Reminder even though 90-day-late is a much
      stricter bar than the page's own definition of "late").
    New response fields `ar_reminder_rows_inserted`/`ar_reminder_rows_noted`
    for observability. Individual insert/update failures are counted, not
    fatal — matches this route's existing per-company resilience.
  - **`app/billing/page.tsx`**: `LATE_FILING_MARKER` (`'⚠ LATE FILING:'`,
    must stay byte-for-byte identical to the route's copy) + `LateFilingBadge`
    — a small red "LATE" chip, tooltip showing the full reason — rendered
    purely by checking whether `remarks` starts with the marker, no new
    column or API field needed since the note doubles as its own flag.
    Added next to the company name in `ARTableView`, the desktop List row,
    and the mobile card (all three fall under "List" at the `view==='list'`
    branch) — not the detail modal, since its existing Notes section
    already shows the raw remarks text including the marker line.
  Production build passes; `npx tsc --noEmit` clean. Takes effect on the
  next `late_filing` cron run (20:00 UTC / SGT 04:00 after today's
  reschedule below) — not backfilled by hand, since unlike the Active
  Client date backfill this one only touches companies actually flagged
  late, a small, self-bounded set.

- **Nightly automation chain shifted 3 hours earlier so it finishes before
  business hours (SGT 05:00), not after (was finishing ~SGT 08:00).**
  Vincent: the automated sync needs to be done by SGT 5:00. Root cause of
  the gap: the chain's actual `vercel.json` schedule (21:00–00:00 UTC) had
  already drifted 3 hours earlier than what two routes' doc comments
  claimed (`teamwork/sync` said 00:30 UTC, `ar-reminder/sync-workflow`
  said 02:00 UTC) — evidence a prior 3-hour shift happened without the
  comments being updated, and even that wasn't early enough. New schedule,
  same relative order/spacing, all times UTC (SGT = UTC+8, next day):
  - `teamwork/sync-nd`: 21:00 → **18:00** (SGT 02:00)
  - `teamwork/sync`: 21:30 → **18:30** (SGT 02:30)
  - `ar-reminder/generate`: 22:00 → **19:00** (SGT 03:00)
  - `quickbooks/sync`: 22:30 → **19:30** (SGT 03:30)
  - `ar-reminder/sync-workflow`: 23:00 → **20:00** (SGT 04:00)
  - `late-filing/sync`: 00:00 → **21:00** (SGT 05:00) — last job, so this
    is the one that determines whether the SGT 05:00 target is met.
  Updated the two stale doc comments (`teamwork/sync/route.ts`,
  `ar-reminder/sync-workflow/route.ts`) to match. Pure config + comment
  change — no application logic touched, `npx tsc --noEmit` clean.

- **AR Reminder's "AGM"/"AR" columns (`date_of_agm`/`filling_date`) now give
  manual edits top priority over the TeamWork sync, and the Table view marks
  which cells are still automation-owned.** Vincent: distinguish automated
  vs. manual dates — a manual edit must never be overwritten by automation,
  clearing a cell should hand it back to automation, and automated cells
  need a visible marker (a blue dot) in the Table view; manual ones display
  plainly.
  - **`scripts/add-ar-manual-date-flags.sql` (NEW — must be run in Supabase
    SQL Editor before the next `ar_workflow` cron, currently scheduled
    02:00 UTC daily; not yet run as of this commit):** adds
    `ar_reminder.date_of_agm_manual`/`filling_date_manual` (boolean,
    default false). Until this runs, `sync-workflow`'s `SELECT` will fail
    on the missing columns.
  - `app/api/ar-reminder/route.ts`'s PATCH: writing `date_of_agm` or
    `filling_date` now also sets the matching `_manual` flag — `true` when
    a value is saved, `false` when the cell is cleared (empty value).
  - `app/api/ar-reminder/sync-workflow/route.ts`: the per-cycle AGM/AR
    patch now skips a field entirely when its `_manual` flag is set,
    instead of only filling `date_of_agm` once while `filling_date` always
    overwrote (the actual source of Vincent's complaint — filed dates kept
    getting silently reverted to TeamWork's value even after being
    corrected by hand). `agm_held_date` (the internal, always-automated
    "AGM was held" progress signal — distinct from the user-facing
    `date_of_agm` column) is unaffected and keeps mirroring TeamWork.
  - `app/billing/page.tsx`: new `AutoFillDot` — a small blue dot rendered
    to the left of the AGM/AR `EditField`s in `ARTableView` only (not the
    List view or detail modal, matching where this was asked for) when a
    date exists and its `_manual` flag is false. `handleSave` flips the
    local `_manual` flag optimistically alongside the value so the dot
    updates immediately, mirroring the PATCH handler's server-side rule.
  Production build passes; `npx tsc --noEmit` clean.

- **Active Client's "Last AGM Date"/"Last AR Date" columns are now fully
  automated from TeamWork, and show a mismatch badge against AR
  Reminder's (staff-editable) AGM/AR columns — functionally splitting
  what used to be "the same data shown two places" into two distinct
  roles.** Vincent, confirmed via a clarifying question first (AR
  Reminder's own `date_of_agm`/`filling_date` columns keep their
  existing automated-but-overridable behavior unchanged — only Active
  Client's side changes):
  - `app/api/ar-reminder/sync-workflow/route.ts`: while processing each
    company's TeamWork AGM/AR event history (already fetched once per
    company for the existing `ar_reminder` per-cycle patch — no second
    scrape), now also computes the LATEST AGM "Held Date" and LATEST AR
    "Filing Date" across the company's *whole* history (not scoped to
    one FYE cycle, since Active Client has no cycle dimension) and
    writes them to the matching `master_list` Active Client row
    (`last_agm_date`/`last_ar_date`, matched by UEN), always
    overwriting — this column is meant to be the fully-automated one.
    Logged via the shared `audit_log` (master_list has no DB-trigger
    audit trail of its own, unlike `ar_reminder`).
  - `app/api/master-list/route.ts`'s GET (Active Client only) now also
    joins `ar_reminder`'s `date_of_agm`/`filling_date` from each
    company's latest FYE cycle, purely for cross-checking — attached as
    `ar_date_of_agm`/`ar_filling_date`.
  - `components/MasterListTable.tsx`: new `dateMismatch()` helper +
    two new Table-view branches for `last_agm_date`/`last_ar_date`,
    mirroring the existing FYE-mismatch red "TW:" chip pattern exactly
    (same colors/icon/layout) — shows AR Reminder's value when it
    disagrees with TeamWork's. Not added to the List view or detail
    modal, matching where the FYE mismatch treatment itself does (and
    doesn't) appear.
  Production build passes; `npx tsc --noEmit` clean. Backfilled against
  production: the first hosted `ar_workflow` run needed to write nearly
  every company's date for the first time and got hard-killed by
  Vercel's `maxDuration=300`, leaving an `automation_sync_runs` row
  stuck at `status:"running"` (self-heals on the next scheduled/manual
  trigger — `lib/automation-sync.ts` only clears an expired lease as a
  side effect of the *next* `begin()` call, no background timer). Ran a
  one-time local script instead (same logic, no Vercel time limit,
  not committed — deleted after use) to complete the backfill without
  needing to touch the route's timeout/batching: 780 Active Client rows
  checked, 381 updated, 0 fetch errors, 133 had no matching Active
  Client row. Feature is fully live; future daily runs only touch
  what's changed, so this slowness was one-time only.

- **Swapped the Proposal Generator sidebar icon for Vincent's high-res
  "Company logo" file (same T-frame + calculator design as before, just
  a sharper 5000x5000 source with real detail like the "SGD" text on
  the calculator display).** Same processing as last time — straight
  resize of the real RGBA data (crop to content bbox, fit 128×128), no
  re-derived thresholding. Production build passes.

- **Corrected the Proposal Generator icon to use the real source image,
  not a re-derived flat version.** Vincent: "我就是要原图的" — pushed back on
  the previous attempt, which had flattened the artwork's shading into
  crisp white line-art via a levels threshold. Root cause of that
  overcorrection: I'd built the alpha channel from a `.convert('L')`
  grayscale view, which PIL flattens onto black by default, discarding
  the source PNG's real alpha — but the original file already had
  proper per-pixel transparency baked in (confirmed: alpha ranged
  0–255, mean ~24, i.e. mostly transparent already). Redid it as a
  straight resize of the actual RGBA data (crop to content bbox, scale
  to fit 128×128, no thresholding, no re-deriving alpha) — this keeps
  the source's real shading/glow intact instead of substituting my own
  interpretation of it. Production build passes.

- **Replaced the Proposal Generator sidebar entry's placeholder lucide
  icon with a custom asset, matching the other nav icons' style.**
  Vincent supplied a ChatGPT-generated image from his Desktop (a glowing
  white "T"-in-a-frame + calculator design, 1024x1024, soft blur/glow on
  a dark background). The existing `/public/nav/*.png` icons are all
  crisp white line-art on transparent, 128x128 — a straight
  luminance-to-alpha conversion of the source kept too much of the glow
  and just produced a blurry white blob, so the conversion instead used
  a tight levels threshold (235–253) to isolate just the crisp bright
  core lines the glow was built around, discarding the soft halo
  entirely — cropped to content, resized with the same ~12% padding as
  the other icons, saved as `public/nav/proposal-generator.png`.
  `components/Sidebar.tsx`'s entry now uses `img` instead of the
  `icon: FileText` fallback added earlier (that fallback machinery
  stays in place for any future icon-less entry, just unused for this
  one now). Production build passes; `npx tsc --noEmit` clean.

- **Sidebar groups now actually start collapsed on a fresh login, not
  just in theory.** Earlier this session the default was flipped to
  collapsed, but that only governs the very first read — every group
  toggle is persisted to `localStorage` (`sidebar-group-*-expanded`),
  which outlives the auth session entirely. Vincent: after logging out
  and back in, Master List/Billing System and their sub-groups were
  still expanded from before, because localStorage doesn't get touched
  by login/logout. `components/AppShell.tsx`'s `logout()` now clears
  every `sidebar-group-*` key before signing out, so the next login
  (anyone's, on that browser) starts from the true collapsed default
  again. Production build passes; `npx tsc --noEmit` clean.

- **Fixed the SSO handoff to Proposal Generator: token format didn't
  match what that app's `/api/sso` actually parses.** Diagnosed by
  curling the endpoint directly rather than guessing — first found
  `/api/sso` 404ing outright (receiving route hadn't deployed yet on
  their side), then after Vincent's other Claude Code session fixed
  that, curling again showed the route live but returning
  `{"error":"Invalid token format"}` for any token, which lined up
  exactly with the other session's independent finding: this app's
  `lib/sso-token.ts` was producing a `base64url(JSON).base64url(sig)`
  token of its own invention, but the receiving side expects plain
  `email:exp:signature` with a hex-encoded HMAC-SHA256. Rewrote
  `signSsoToken()` to produce that exact format instead — same 60s TTL,
  same `SSO_SHARED_SECRET`, just restructured to match. Production
  build passes; `npx tsc --noEmit` clean. Not yet end-to-end tested
  (need a real click-through with both sides deployed and the same
  secret set — I don't have a logged-in session to test the full
  handoff myself).

- **Added a Sidebar link to Proposal Generator (a separate Vercel app,
  different domain) with an SSO handoff so a user already logged in
  here doesn't see a second Google login screen.** Vincent: wants a
  Proposal Generator icon in the sidebar, but the two apps use separate
  Supabase projects on unrelated `*.vercel.app` domains, so no session
  cookie can be shared directly.
  - `lib/sso-token.ts` (new): `signSsoToken(email)` — a short-lived
    (60s) HMAC-SHA256-signed token (`base64url(payload).base64url(sig)`),
    keyed by a new `SSO_SHARED_SECRET` env var known to both apps.
  - `app/sso/proposal-generator/route.ts` (new): reads the current
    session via the existing `getRequestAccount`, signs a token for
    that email, redirects to Proposal Generator's `/api/sso?token=...`.
    Deliberately outside `/api/` so an expired session gets the normal
    `/login` redirect (via `proxy.ts`) rather than a bare 401 JSON.
  - `components/Sidebar.tsx`: `Node` type gained optional `icon`
    (lucide component, fallback for entries with no custom 3D PNG
    asset yet) and `external` (opens in a new tab, `target="_blank"`).
    New entry links to the `/sso/...` route above, not the raw
    Proposal Generator URL directly.
  Production build passes; `npx tsc --noEmit` clean.

- **Nominee Directors page's "TeamWork subrole review" panel now starts
  collapsed instead of expanded.** `components/NDSubroleReview.tsx`'s
  `open` state defaulted to `true`; changed to `false`. Production build
  passes.

- **Master List's Edit History moved from a small collapsed text link at
  the bottom of the modal to a "History" toggle button in the header,
  matching AR Reminder's "Change history" panel exactly.** Vincent, after
  seeing AR Reminder's header button: "那能不能在 MASTER LIST 也做这个
  HISTORY的视觉按钮呢，感觉比较直观". `components/MasterListTable.tsx`'s
  `CompanyDetailModal` now has the same header button as AR Reminder's
  `ARDetailModal` (icon + "History" label, background highlights when
  open) positioned before the row-actions menu; clicking it shows a
  "Change history" card at the top of the scrollable body — same
  layout, same title/description copy, same refresh button — listing
  field/old→new/who/when, fetched from the existing `master_list`
  branch of `/api/audit-log`. (No restore button: that's specific to
  `ar_reminder`'s own dedicated history route, which master_list's
  simpler `audit_log` table doesn't support — not something Vincent
  asked for here, flagged in case he wants it later.)
  - Deleted the old bottom-of-modal `EditHistorySection` component
    entirely (`components/EditHistoryPanel.tsx` removed — its `open`
    state couldn't be driven by an external header button without a
    rework, and once reworked there was nothing else left in that file
    to share, so the fetch logic and `AuditEntry` type moved directly
    into `MasterListTable.tsx`, the only remaining consumer).
  Production build passes; `npx tsc --noEmit` clean.

- **Corrected AR Reminder's Edit History: Table view now opens the same
  detail modal List view already used, instead of a separate, less
  capable popover.** Vincent: "为什么只出现在 TABLE, 没有出现在list?...你要做到
  好像 ACTIVE CLIENT 页面的弹窗一样的". Investigating revealed List view's
  `ARDetailModal` already had a full "History" feature (top-right
  toggle button, "Change history" panel) — reading from
  `ar_reminder_audit` via the pre-existing `app/api/ar-reminder/history`
  route, **with restore** (conflict-protected against newer edits) —
  which last session's Table-view addition duplicated with a strictly
  worse, read-only popover. Rather than layer a third system on top:
  - Gave `ARTableView` a new `onOpenDetail` prop wired to the same
    `setModalRecord` List view already uses, so a row in Table view now
    opens the exact same `ARDetailModal` — full History + Restore +
    service editing, not a copy.
  - Removed the redundant `EditHistoryButton` (component deleted
    entirely — zero remaining callers after this) and the `ar_reminder`
    branch in `/api/audit-log`, which nothing reads anymore now that
    Table view uses the real modal instead. `/api/audit-log` is back to
    `master_list`-only, which is the only table that actually needs it
    (no DB-trigger audit trail of its own).
  Production build passes; `npx tsc --noEmit` clean.

- **ACC/TAX PIC is now two-way synced between AR Reminder and Active
  Client — whichever page it was most recently edited on wins and
  mirrors onto the other.** Vincent, after asking whether the two
  already stayed in sync (they didn't — Active Client's override only
  ever shadowed AR Reminder one-directionally, never wrote back):
  "默认按照 ACTIVE CLIENT 的PIC值，但是当我最新手动更新，不管是 AR REMINDER 页面
  还是ACTIVE CLIENT页面，都是最高优先级...保存PIC的统一".
  - `lib/pic-sync.ts` (new): `syncPicToActiveClient()` (AR Reminder edit
    -> mirrors onto the matching Active Client row's
    `acc_pic_override`/`tax_pic_override`, joined by UEN, logged via the
    shared `audit_log`) and `syncPicToArReminder()` (Active Client edit
    -> mirrors onto every `ar_reminder` row for that UEN, across all FYE
    cycles — there's no per-cycle PIC concept on the Active Client side
    to disambiguate one).
  - Wired into both PATCH handlers
    (`app/api/ar-reminder/route.ts`, `app/api/master-list/route.ts`)
    right after each successful `acc_pic`/`tax_pic`(`_override`) update.
  - **Found while wiring this up**: `ar_reminder` already has its own
    DB-trigger-based audit trail (`ar_reminder_audit` +
    `set_ar_reminder_change_metadata`/`audit_ar_reminder_changes`
    triggers, `scripts/add-ar-collaboration.sql`) that fires on *every*
    update to the row regardless of which code path wrote it — more
    complete than last session's new `audit_log`-based Edit History for
    AR Reminder, since it would've missed this exact sync writeback
    (written directly, not through the app's own PATCH). Removed the
    now-redundant `logFieldChange` call from AR Reminder's PATCH and
    pointed `/api/audit-log?table=ar_reminder` at `ar_reminder_audit`
    instead (column names mapped to the same shape the frontend already
    expects). Master List has no equivalent DB trigger, so it keeps
    using the app-level `audit_log` table as before.
  - Ran a one-off backfill to establish "Active Client wins by default"
    for any pre-existing override — found 0 Active Client rows
    currently have `acc_pic_override`/`tax_pic_override` set at all, so
    there was nothing to migrate; the sync starts from a clean slate
    where AR Reminder's synced value is still what both pages show
    until someone edits either side.
  Production build passes; `npx tsc --noEmit` clean.

- **AR Reminder's Table view now has Edit History too, and the audit-log
  read endpoint is generalized instead of being Master-List-only.**
  Vincent: "AR REMINDER 页面的 TABLE,我也要有一个 edit history". Reused the
  same `audit_log` table (already generic by design — `table_name`/
  `row_id` keyed) rather than building a second one:
  - `app/api/ar-reminder/route.ts`'s PATCH now writes an audit entry on
    every successful field edit. It already does optimistic-concurrency
    compare-and-swap (`previousValue`/`nextValue`, verified equal to
    the actual row at write time via the update's own `WHERE` filter),
    so the old/new diff needs no extra read — cheaper than Master
    List's version, which has to `SELECT` the row first.
  - `app/api/master-list/audit-log/route.ts` (table-specific) replaced
    by a generic `app/api/audit-log/route.ts` — `GET ?table=X&id=Y`,
    table name whitelisted (`master_list`, `ar_reminder`) since it
    becomes a query filter. `MasterListTable.tsx`'s existing Edit
    History section now points at the generic route instead.
  - While wiring the "who made this edit" identity for AR Reminder,
    noticed `app/api/ar-reminder/route.ts` already had its own
    `lib/request-account.ts` (`getRequestAccount(req)`) doing exactly
    what the Master List feature's `lib/current-user.ts` did —
    deleted the duplicate, `app/api/master-list/route.ts` now uses the
    pre-existing shared helper too.
  - `components/EditHistoryPanel.tsx` (new): `EditHistoryButton` — a
    small popover version of Master List's in-modal section, for pages
    with no per-row detail modal to hang a full section off of. AR
    Reminder's Table view has a history-icon button next to the
    existing delete button on every row (widened that trailing column
    from 44px to 68px to fit both).
  Production build passes; `npx tsc --noEmit` clean.

- **Fixed root cause: `companies.pic` values like "9,11" (a company
  co-assigned to two staff) never resolved to names — showed as raw
  TeamWork ids forever, on Address Service and anywhere else `pic` is
  read.** Vincent: "ADDRESS SERVICE页面 内的PIC 为什么还是有号码，找不到对应的PIC人名？"
  Traced to `lib/teamwork-pic.ts`'s `resolveTeamworkPic()`: it only ever
  matched a SINGLE numeric id against `TEAMWORK_PIC_NAMES` — a combined
  string like "9,11" isn't in the map and isn't purely `/^\d+$/`, so it
  fell through and returned the raw string unchanged. Compounded by
  `app/api/teamwork/sync/route.ts`'s overwrite guard (`/^\d+$/.test(
  currentPic)`), which only re-resolves a stored value that's a single
  bare number — "9,11" never qualified, so even future daily syncs would
  never have fixed it.
  - `resolveTeamworkPic()` now splits on `,`, resolves each id
    separately, and rejoins with ", " — "9,11" -> "Kah Ye Chin, Shi Ming
    Ang". A single id still works exactly as before.
  - Sync's guard regex broadened to `/^\d+(,\d+)*$/` so comma-separated
    raw ids are recognised as stale and get overwritten going forward.
  - Ran a one-off fix against production Supabase (reusing the corrected
    `resolveTeamworkPic`) for the 16 companies currently stuck on a raw
    id string — all 16 resolved cleanly, 0 left blank.
  - `components/AddressServiceTable.tsx`'s PIC cell now also runs
    through `formatStaffName()` as a display-time safety net (it does
    its own comma-splitting before delegating to `resolveTeamworkPic`
    per segment, so it already handled multi-id correctly even before
    today's fix) — belt-and-suspenders with the sync-level fix, not a
    replacement for it.
  - Note for Vincent: Companies page (`app/companies/page.tsx`) reads
    the same `companies.pic` column and displays it raw too — today's
    sync-level fix corrects it there as well, but I did not add the
    same defensive `formatStaffName()` wrapper there since only Address
    Service was reported; flag if you want it applied there too.
  Production build passes; `npx tsc --noEmit` clean.

- **Late Filing's Edit Company modal: Remarks/Custom Remarks moved to
  the last row, and Custom Remarks is now a full-width auto-growing
  textarea instead of a single-line input that could clip long text.**
  Vincent: "late filing 弹窗内的 remark 要放在最下一行，并且要完整展示全部内容"
  (the Remarks section should be the last row, and it needs to fully
  show all its content). `app/late-filing/page.tsx`'s edit modal
  previously had Remarks/Custom Remarks between FYE Month and the four
  date fields; moved both below `next_agm_due_date`, right before the
  Save/Cancel buttons. Custom Remarks (e.g. "AUTO: Overdue 1829 days",
  which can run long) switched from the same inline single-line-input
  pattern every other field here uses to a label-on-top auto-resizing
  textarea (same technique as Master List's wide fields), with a
  `useEffect` that sizes it to fit existing content the moment it's
  shown — not just after the next keystroke — so a long note is fully
  visible on open, not clipped until edited. Production build passes;
  `npx tsc --noEmit` clean.

- **Corrected which field "ADDRESS" meant in the PIC-style formatting
  task above.** Vincent: "ADDRESS 对应的就是在说 Invoice/Reg Add" — not
  `add_here` ("Add @") as guessed. Swapped `add_here` out of
  `PIC_STYLE_FIELDS`. `invoice_address` is a real street address, not a
  name list, so it does NOT go through `formatStaffName` (which splits
  on `,`/`/`/`&` — would mangle something like "Blk 5 & 6" or a floor
  "12/F"); added a separate `TITLE_CASE_FIELDS` set that applies plain
  `titleCase()` only, no staff-directory lookup, no delimiter-splitting.
  Threaded through the same three spots as before: `EditCell`'s Table
  view display, `ColumnFilterMenu`/`columnMatch` (already generic via
  `displayFieldValue`, no change needed there), and `ModalField`'s wide
  (non-compact) branch — baked into `inputValue()` itself so the
  textarea's no-op-edit baseline is the same formatted value, same
  never-silently-rewrite guarantee as the PIC fields. AR Reminder has no
  address-type column at all, so no change needed there. Production
  build passes; `npx tsc --noEmit` clean.

- **Unified the text formatting of PIC-style columns (ND, Secretary, ACC
  PIC, TAX PIC, Contact Window, Add @) across Master List and AR
  Reminder — Chinese names untouched, everything else Title Cased and
  expanded from abbreviation to full staff name, for both display AND
  column filtering.** Vincent's rules: (1) Chinese text stays exactly
  as-is, (2) these columns need first-letter-capital/rest-lowercase
  formatting everywhere, whether typed by hand or synced, (3) staff
  abbreviations ("JF", "Kah Ye") should always show the full name he'd
  already given the staff directory, specifically so a column's filter
  dropdown doesn't splinter one person into a dozen variants.
  Interpreted "ADDRESS" in his list as `add_here` ("Add @") — the only
  Master List field that fits a PIC-style short-name pattern; the
  physical address fields (Invoice/Reg Add, Mailing Add) were left
  alone since re-casing a real address isn't the same problem.
  - `lib/text-case.ts` (new): `titleCase()` — the CJK-safe casing rule,
    extracted from `lib/email-merge.ts`'s `formatContactName` (now just
    `export const formatContactName = titleCase`) so it's a neutral
    shared utility instead of living inside an email-specific module.
  - `lib/staff-directory.ts`: `resolveOne()` now returns the full
    `StaffEntry` (not just email), and a new `formatStaffName()` splits
    a raw PIC value on `,`/`/`/`&`, resolves each segment against the
    staff directory to its canonical full name, falls back to
    `titleCase` for anything unmatched (an external contact, a company
    name — never dropped, just not directory-linked), and rejoins with
    a consistent ", " separator.
  - `components/MasterListTable.tsx`: new `PIC_STYLE_FIELDS` set +
    `displayFieldValue()` helper, applied everywhere a value is shown
    OR compared — `EditCell`'s display span, `ModalField`'s compact
    display, and critically `ColumnFilterMenu`'s option list AND the
    actual `columnMatch` filter logic, so raw variants of the same
    person collapse into one filter entry, not just one visual style.
    `PicCell`/`ServiceChip` (ACC/TAX PIC and ND/Secretary's
    always-editable input boxes) now init from the formatted name, with
    the blur-save comparison baseline updated to match — so simply
    clicking into the box and out never silently rewrites a raw "JF" to
    "Lee Jing Fei" in the database; only an actual edit saves anything.
    Editing (Table view's click-to-edit, and the two input boxes) still
    shows/edits the raw stored text — formatting is display/filter-only,
    never a silent rewrite of what's stored.
  - `app/billing/page.tsx` (AR Reminder tab only — Billing Drafts/
    renewals' own PIC displays were left untouched, out of Vincent's
    stated scope): `arColumnValue()` (the single function AR Reminder's
    column filter already routes both its options and its match logic
    through) now formats `pic`/`acc_pic`/`tax_pic`; `EditField`'s
    display span does the same; plus the three remaining plain-text PIC
    spots in AR Reminder's List view (mobile card, desktop row).
  Production build passes; `npx tsc --noEmit` clean.

- **Master List wide-field labels (Remark, Invoice/Reg Add, etc.) now
  match the "NOTES" section header's full type treatment, not just its
  color.** Earlier fix (96fdf2a) only changed the label color to
  `#94a3b8`; Vincent's follow-up: "不是颜色，是字体大小和字型" (not the
  color, the font size and style). `ModalField`'s shared wide-field
  label in `components/MasterListTable.tsx` was `fontSize: 10` with no
  weight/case/spacing, visibly smaller and plainer than `sectionLabel`'s
  `fontSize: 11, fontWeight: 700, textTransform: uppercase,
  letterSpacing: 0.5px`. Brought the wide-field label up to the same
  size/weight/case/spacing (color was already correct). Production
  build passes.

- **Fixed: the detail modal (and therefore the just-added Edit History)
  was completely unreachable from 5 of 6 Master List pages.** Vincent:
  "Edit History 在哪里 我没有看见". `setSelectedRowId` — the only thing
  that opens `CompanyDetailModal` — was only ever called from the List
  view's row click handler, and List view is opt-in (`enableListView`)
  for Active Client only; every other page (Ad-Hoc, MAS, Strike Off,
  Terminated, Change Co Name), and even Active Client's own Table view,
  had no way to open the modal at all. Added a small history-icon
  button next to each Table-view row's existing action menu that calls
  `setSelectedRowId(r.id)` directly — same modal, same Edit History
  section, now reachable everywhere. (The audit_log table itself is
  confirmed created — Vincent ran the migration; the "already exists"
  policy error on a second attempt just meant it had already succeeded.)
  Production build passes.

- **⚠️ ACTION NEEDED: run `scripts/create-audit-log-table.sql` in the
  Supabase SQL Editor** — creates the `audit_log` table. Until this runs,
  Master List field edits still save fine (logging fails open) but
  nothing gets recorded, and Edit History will always show empty.

- **Master List: every field edit now writes a "who changed what" audit
  entry, viewable per-company.** Follow-up to the earlier "为什么没有到
  100%" discussion — Vincent flagged that there's no audit trail for
  Master List edits, then confirmed: Master List only for now (Companies/
  QuickBooks later), log every single field change (not just "important"
  ones), and that `vincent@tassure.com` is the primary admin/operator so
  who-triggered-a-sync tracking isn't a priority right now.
  - `scripts/create-audit-log-table.sql` (new): generic `audit_log`
    table — `table_name`/`row_id`/`field`/`old_value`/`new_value`/
    `changed_by`/`changed_at` — reusable for other tables later, not
    Master-List-specific schema.
  - `lib/current-user.ts` (new): `getCurrentUser()` derives the caller's
    identity from their Supabase session cookie server-side — the same
    lookup `proxy.ts` already does — so `changed_by` can never be spoofed
    by a client-supplied name.
  - `lib/audit-log.ts` (new): `logFieldChange()` — fails open (a logging
    error never blocks the save that already succeeded), and skips
    writing when old === new (a blur with no real change shouldn't
    create a log row).
  - `app/api/master-list/route.ts`'s PATCH — the single choke point
    every Master List edit already goes through (regular field edits,
    ND/Secretary/ACC/TAX active-toggles, ACC/TAX PIC overrides all call
    this same endpoint) — now reads the pre-update value, applies the
    update as before, then logs the diff. One change covers all 6
    Master List pages and every edit surface (table inline edit, modal
    fields, checkboxes).
  - `app/api/master-list/audit-log/route.ts` (new): `GET ?id=<row id>`
    returns that row's history, newest first.
  - `components/MasterListTable.tsx`: new collapsed-by-default "Edit
    History" section at the bottom of the detail modal, fetched on
    first expand (not on every modal open) — shows field, old → new
    value, who, and when.
  Production build passes; `npx tsc --noEmit` clean.

- **⚠️ ACTION NEEDED: run `scripts/add-master-list-new-company-name.sql` in
  the Supabase SQL Editor** — adds `master_list.new_company_name`. Until
  this runs, Change Co Name's Add Manual form will fail to save (missing
  column); every other page degrades safely (rename hints just won't
  show yet, no errors).

- **Change Co Name page: special Add Manual flow + a "renamed" hint on
  every other page/list sharing the same UEN.** Vincent: previously the
  only way to note a rename was typing free text into Remark, which he
  called "设置操作上比较模糊" (vague to operate). New flow, Change Co Name's
  Add Manual modal only: UEN is the first field, and on blur
  (`lookupByUen` in `components/MasterListTable.tsx`) looks up the
  company already on file under that UEN via `/api/companies` (same
  endpoint `lookupTwCode` already used for Code auto-fill elsewhere) and
  fills in its current name + Code — unlike the existing lookup, this one
  always overwrites, since a changed UEN should always re-resolve.
  Added a new "New Name *" field (`new_company_name` — new
  `master_list` column, migration above) that the user types by hand.
  Both Company Name and New Name are required to save (`missingAddRequired`).
  - `lib/company-rename.ts` (new): `loadRenameMap()` reads every
    `name_change` row with both a UEN and a New Name into a UEN-keyed
    map — the single source of truth for "who got renamed", read live
    rather than copied as a note onto every matching row (which would
    drift out of sync). `app/api/master-list/route.ts`'s GET (for every
    list type except name_change itself) and `app/api/companies/route.ts`'s
    GET both join against it by UEN and attach `renamed_from`/`renamed_to`
    (`renamedFrom` on Companies).
  - Shown as a small violet "↺ Formerly {old name}" hint (hover for the
    full old→new text) in: Master List's List view row, Table view's
    company name cell, the detail modal's header badge row, and the
    Companies page (both the mobile card list and desktop table).
  - `app/master-list/name-change/page.tsx` now passes an explicit
    `fields` list (previously used the shared default `COLUMNS`) so
    `new_company_name` only ever appears on this one page — the shared
    default is otherwise off-limits per the warning already documented
    next to `COLUMNS`.
  Production build passes; `npx tsc --noEmit` clean.

- **Master List detail modal's wide-field labels (Remark, Invoice/Reg
  Add, Mailing Address, Mailing List, Referral, Shareholders, Directors)
  now use the same muted color as the "NOTES" section header.** Vincent
  flagged Remark first, then Invoice/Reg Add in the same modal — both go
  through `ModalField`'s shared non-compact label style in
  `components/MasterListTable.tsx`, which was `#64748b` (a noticeably
  darker/greener slate than the section headers' `#94a3b8`). Changed
  the one shared color, which fixes it for every field in
  `WIDE_MODAL_FIELDS`, not just the two Vincent happened to screenshot.
  Only the color changed — kept sentence-case labels ("Remark") rather
  than adopting the section header's uppercase/letter-spacing treatment,
  since Vincent only asked about color. Production build passes.

- **Sidebar's Master List / Billing System groups (and their nested
  sub-groups) now collapse by default instead of starting expanded.**
  Vincent: "这边设置默认是收起的，需要才自行打开". `components/Sidebar.tsx`'s
  `NavTree` previously initialized every group's `expanded` state to
  `true`, with a `useEffect` that only ever downgraded a group to
  collapsed if localStorage explicitly said `'false'` — so a first-time
  visitor (or anyone whose localStorage was cleared) always saw the
  whole tree expanded. Flipped the default to `false` and made the
  `useEffect` respect localStorage in both directions (`'true'` re-opens
  a group the user previously chose to leave open, `'false'` keeps it
  shut), so returning users who'd deliberately expanded something aren't
  reset. Production build passes.

- **Greeting name now says "All" when a draft's To field has more than one
  recipient.** Vincent: "然后当超过一个联系人的稍后 user name 就变成 All" —
  after the previous fix let a company like YWL send to both of its
  contacts, the merged "Dear {{contactName}}" line still used whichever
  contact happened to be first (`primary_contact.contactName`), reading
  like the email was addressed to just one of the two recipients.
  `pickContact()` in `lib/client-comms-resolve.ts` now checks the actual
  To-recipient count in both branches (`toEmails.length` for the
  TeamWork-directory branch, `fallback.length` for the single-contact
  fallback) and uses `'All'` as the contact name whenever more than one
  address is going out; unchanged for the normal single-contact case.
  Production build passes.

- **Fixed recipient resolution silently dropping a known email even after
  the Contact Person fill-in had correctly populated it; extended that
  fill-in to keep every contact person, not just the first.** Vincent
  showed HUAKO KIDS PTE. LTD. and YWL ELECTRICAL ENGINEERING PTE. LTD. —
  both clearly had emails in TeamWork's Contact Person report, but the
  system still showed "no email". Checked Supabase directly: both
  companies already had `best_email`/`primary_contact` correctly filled
  in by the new sync, but `tw_recipient_source` was `'teamwork_report'`
  (set by the *other*, upcoming-events recipient sync) with `tw_to_emails:
  []` — that sync had found a staff CC for them but zero To-emails, and
  `pickContact()` in `lib/client-comms-resolve.ts` trusted the source
  label alone, never checking whether `tw_to_emails` actually had
  anything, so it returned empty and never fell through to the
  fallback. Fixed by requiring `tw_to_emails.length > 0` before taking
  that branch. Separately, YWL has two contact persons (LEI CHI, XU
  WEIMING) in TeamWork — Vincent: "就算有两个，to 就放两个啊" — but
  `syncTeamworkContactPersons()` only ever kept "first email wins".
  Rewrote it to group all contacts per company and write every unique
  email into `tw_to_emails` (the field recipient resolution actually
  sends to), tagging the source as `'contact_person_report'`; also
  broadened its gap detection to key off `tw_to_emails` being empty
  (the field that matters for sending) rather than requiring
  `best_email`/`primary_contact` to also be empty, since a company can
  have one populated without the other. Re-ran the corrected sync once
  by hand against production Supabase: 349 companies filled/corrected,
  confirmed both flagged companies now resolve correctly (YWL shows
  both emails in `tw_to_emails`). Production build passes.

- **Fixed `TassureDraftHelper.exe` failing to download on a computer with
  no existing Tassure session.** Vincent: "我刚才在别人的电脑下载那个HELPER 但是
  都没有反应，我已经确定按了run, 但是一直刷新都没有下载好". `curl -sI` on the
  download URL showed `HTTP/1.1 307` redirecting to `/login` — `proxy.ts`'s
  middleware gates every non-public, non-API path behind an authenticated
  Supabase session, and `/downloads/TassureDraftHelper.exe` was never
  exempted. On a machine that has never logged into the web app, the
  "download" was silently just the `/login` page's HTML, so nothing
  Vincent did with "Run" ever had a real exe to execute. Fixed by
  exempting the whole `/downloads/` prefix from the auth check in
  `proxy.ts` (same reasoning as the existing QuickBooks webhook
  exemption — the installer must be reachable before a session can even
  exist on that machine). Production build passes.

- **Billing Drafts' quick-draft mail icon now always sends from
  `finance@tassure.com`.** Vincent: "并且我要固定这个邮箱是：OUTLOOK SENDER：
  finance@tassure.com". `app/billing/page.tsx`'s `quickEmailDraft` built
  its `draftForOutlook` payload with no `sender_email` at all, so the
  Draft Helper's `_assign_sender()` never ran and every quick draft used
  whatever Outlook's own default account happened to be — unlike
  Campaign Centre's full workflow, which has its own sender picker.
  Added `sender_email: 'finance@tassure.com'` to that payload — fixed,
  not user-selectable, matching that this is specifically Billing
  Drafts' one-click flow, not the full campaign builder. Vincent also
  reported the mail icon being unresponsive when he tested — investigated
  the click handler and popover structure and found nothing that would
  explain it in the code as it stands (confirmed the Helper was up and
  responding at the time); flagged as needing more detail from him if it
  recurs, since nothing pointed to a clear root cause without seeing it
  live. Production build passes.

- **Fixed the attached invoice PDF's filename embedding a stale amount
  even though the PDF's own content and the email body text were
  already correct.** Vincent: "email drafts 那边是要读取最终的QB PDF的 total
  amounts, 但是我发现 PDF的文件名后面的金额不会同步更新最新金额到文件名", with an
  example filename `INV02610834-ALTSTAKE PTE. LTD.-S$1760`. Root cause
  in `lib/draft-helper-client.ts`'s `openDraftsInOutlook()`: `Promise.
  all([refreshAmount(draft), fetchAttachments(draft)])` runs both
  against the *same original* `draft` object, in parallel — but
  `fetchAttachments` builds the filename from `draft.invoice_refs[].
  amount`, and `refreshAmount`'s corrected amount only exists in the
  object it *returns*, which `fetchAttachments` (already mid-flight by
  then) never sees. The PDF's actual bytes were always fine (fetched
  live from QB independently, per the original amount-refresh feature
  earlier this session) — only the filename's embedded amount could
  lag. Fixed by sequencing them: `refreshAmount` now runs first, and
  `fetchAttachments` uses its returned `refreshed.draft` (with corrected
  `invoice_refs`) instead of the original. Also checked
  `app/billing/page.tsx`'s separate, locally-defined
  `invoicePdfFileName` (used only for "save PDF right after generating
  it" — not the Outlook-draft flow) — not affected, since that total is
  always fresh at generation time, not a re-opened older draft.
  Production build passes.

- **Draft Helper v1.4.0: "Bank Details 2026 - Tassure Group.pdf" is now
  attached to every email draft, automatically.** Vincent: "帮我把一个文件
  作为每次 email drafts 都要附带的attactment, 文件在桌面（Bank Details 2026 -
  Tassure Group）". Same architecture as v1.3.0's payment-options image —
  a company-wide, never-per-client static asset, so it's bundled directly
  into the Helper rather than sent over the wire by the web app on every
  request. Copied the PDF from Desktop into
  `tassure-draft-helper/assets/`; added a `STANDING_ATTACHMENTS` list in
  `app.py` and a loop in `_open_one_draft` that adds each one via
  `mail.Attachments.Add()` after the per-draft attachments (invoice
  PDFs) — so every draft now gets both. Bumped `VERSION` to `"1.4.0"`,
  rebuilt the exe (`build.ps1`), copied it to
  `public/downloads/TassureDraftHelper.exe`, and — learning from the
  v1.3.0 gap found earlier this session — bumped
  `lib/draft-helper-client.ts`'s `LATEST_HELPER_VERSION` to match in the
  *same* piece of work this time, not a separate one discovered later.
  Also killed and relaunched Vincent's own running Helper process with
  the new build immediately (confirmed via `/health`: now reports
  `1.4.0`) so he can test right away without a separate restart step.
  Production build passes.

- **Data fix (no code change): 3 companies' `best_email` had a stray
  whitespace character injected mid-address**, e.g.
  `christiezhong@proplusme dia.com` instead of
  `christiezhong@proplusmedia.com` — which `lib/campaign-recipients.ts`'s
  `parseEmailList()` splits ON whitespace, so the corrupted value
  silently parsed into zero valid recipients, looking exactly like "no
  email on file" even though a value was present. Vincent caught this
  by screenshotting TeamWork's own Contact Person report for LING LONG
  E-COMMERCE PTE. LTD., which clearly has an email, right after the
  fill-in below shipped — timing that looked like the new sync was
  still broken, but this was pre-existing corrupted data, unrelated to
  it (confirmed: the new sync's gap-detection correctly skipped this
  company already, since `primary_contact.email` — a *different*, older
  field populated by the original legacy CSS-scraper import script,
  `scripts/import-to-supabase.js` — already had a clean, uncorrupted
  copy of the same address). Scanned all 934 companies for the same
  pattern: found exactly 3 affected (`LING LONG E-COMMERCE`,
  `INOFINITY PTE. LTD.`, `ZEROX GLOBAL PTE. LTD.`) — a handful of other
  `best_email` values contain whitespace too, but those are genuinely
  valid comma-separated multi-recipient lists (e.g. "a@x.io , b@x.io"),
  not corruption, and `parseEmailList` already handles those correctly.
  Repaired all 3 directly via Supabase REST, using each company's own
  `primary_contact.email` (or, for one whose two contact emails
  genuinely differ, just stripping the embedded space from `best_email`
  itself) — a one-off data correction, not a recurring sync issue, so
  no code changed. Also checked the dormant `contact_persons` array
  column (populated by that same legacy import, never read by any live
  code) against the ~128 companies still missing an email after the
  fill-in below: zero overlap, so it offers no further quick win — every
  company with `contact_persons` data already had `primary_contact`
  too, from the same import.

- **Added a second TeamWork data source for recipient emails —
  TeamWork's "Company Contact Person" report — as a fill-in for
  companies our existing sync structurally can never reach.** Vincent
  noticed lots of "To email not found" cases and screenshotted a
  TeamWork report page showing a company (CAI LONG SPORTS CULTURE PTE.
  LTD.) that clearly HAS a contact person + email in TeamWork, even
  though our system had nothing for it. Root cause: our only recipient
  source, `lib/teamwork-recipients.ts`'s `syncTeamworkCampaignRecipients`,
  reads TeamWork's `remainder_upcoming_event_report` — a report scoped
  to companies with a *scheduled reminder*, not a general company
  directory. Confirmed live: 174 of 922 active companies (~19%) had NO
  email source at all (`tw_to_emails`, `best_email`, AND
  `primary_contact` all empty) — CAI LONG among them.
  Reverse-engineered TeamWork's actual "Company Contact Person" report
  AJAX call (`Report_module/comp_contact_default_report`, ~1438 rows,
  one row per contact person — company name+UEN, contact name,
  designation, individual email, individual phone, company email) using
  a real Playwright login + network capture, matching the exact request
  shape from the live report page.
  New `lib/teamwork-contact-report.ts`: `syncTeamworkContactPersons()`
  paginates that report, groups by company (first row with a usable
  email wins), and — for companies with NO existing email source in any
  of the three fields — fills in `primary_contact: {contactName, email,
  phone}` and `best_email`. Deliberately a fill-in only: companies that
  already have data from anything else are left untouched, so this can
  never override a value another sync or manual edit set. Wired into
  `app/api/teamwork/sync/route.ts` to run after the existing recipient
  sync, on the same daily cron. Production build passes; will verify
  live via a manual trigger before considering this done.

- **Found and fixed why the payment-options image (Draft Helper v1.3.0)
  never showed up in Outlook drafts on Vincent's machine, plus a
  version-tracking bug that meant the web app would never have warned
  him.** Vincent: "为什么EMAIL DRAFT的问题还是没有解决, 我刚才打开 OUTLOOK 依然没有
  那个截图图片". Checked the running Helper's `/health` endpoint directly
  — it reported `version: "1.2.0"`, even though `tassure-draft-helper/
  app.py`'s source (and the built exe) is at `1.3.0`. Traced the actual
  process (PID via `netstat`) to `C:\Users\vincent\Downloads\
  TassureDraftHelper (2).exe` — a stale copy sitting in Downloads,
  registered into the Windows Run key (`main.py`'s self-registration
  writes whatever path it was launched from, not a fixed install
  location) and running continuously since before the image feature
  existed. Separately, `lib/draft-helper-client.ts`'s
  `LATEST_HELPER_VERSION` was still `'1.2.0'` — never bumped alongside
  `app.py`'s `VERSION` when 1.3.0 was built — so the web app's own
  "your Helper is outdated" banner would never have fired either, even
  though the code for it exists. Fixed both: killed the stale process,
  launched the current `tassure-draft-helper/dist/TassureDraftHelper.exe`
  in its place (confirmed via `/health` it now reports `1.3.0`, and the
  Run-key registry entry now correctly points at that exe), and bumped
  `LATEST_HELPER_VERSION` to `'1.3.0'` in the web app so this specific
  silent-staleness gap won't recur for future version bumps. Confirmed
  `public/downloads/TassureDraftHelper.exe` (what the web app itself
  would serve to any OTHER staff member downloading it fresh) was
  already the correct up-to-date 1.3.0 build — this was purely a
  stale-local-copy problem on Vincent's own machine. Production build
  passes.

- **Fixed why TeamWork Subrole Review's "Appointment"/"TW status"/
  "Subrole" column headers looked misaligned with their body content.**
  Vincent screenshotted it after the reminder-panel unification above.
  Root cause: `app/globals.css`'s `.system-list-table
  .system-list-column-header > th` rule sets `text-align: left`
  (without `!important`) — and at 2 class-selectors + an element
  selector, that rule's specificity (0,2,1) beats a plain Tailwind
  utility class like `text-center` (0,1,0) regardless of source order.
  So those 3 `<th>` labels were silently forced left-aligned the whole
  time, while their `<td>` cells (Tailwind's `text-center`, with no
  competing rule on `.system-list-row > td` for text-align) were
  genuinely centered — headers left, bodies centered, hence the visual
  mismatch. Not something the reminder-panel change caused; it just
  hadn't been looked at closely before. Fixed by setting
  `style={{ textAlign: 'center' }}` inline on those 3 `<th>` elements in
  `components/NDSubroleReview.tsx` — inline style beats any class-based
  rule short of `!important`, which this CSS rule doesn't use for
  text-align. Production build passes.

- **Unified the three "needs attention" reminder panels (Dashboard's
  Automation Health, Active Client's "Missing from Active Client", ND
  page's "TeamWork Subrole Review") into one shared amber visual
  language.** Vincent: these three are "all the same TYPE of thing"
  (a self-contained callout flagging records needing human review), and
  asked for a consistent — not necessarily identical — style. Published
  a before/after preview artifact first and got explicit sign-off on
  the direction before touching code. Shared tokens: container
  `border:#fde68a` / `background:#fffbeb` / `border-radius:14px`; icon
  badge 34×34 `border-radius:10px`, `background:#fef3c7`,
  `color:#b45309`; count pill `border-radius:999px` (full pill),
  `background:#fff`, `border:#fde68a`, `color:#92400e`; row divider
  `#fef3c7`.
  - `app/page.tsx`'s `AutomationHealthBar` + `AutomationExceptionPanel`:
    replaced the ad hoc oranges (`#f2d6b0`/`#fffaf3`/`#ffedd5`/`#9a5a13`/
    `#fff4e5`/`#f4d3a5`/`#f0dcc0`) with the shared tokens; bumped the
    icon badge from 31×31/9px to 34×34/10px. The "all healthy" green
    state and the red "job failed" alert boxes are untouched — different
    semantics, not part of this unification.
  - `components/MasterListTable.tsx`'s "Missing from Active Client"
    panel: rebuilt with the same icon-badge + title + count-pill header
    row (previously just a plain orange-bordered box with a text line),
    white body with row dividers, and the "Add to Master List" button
    switched to the shared button style. Also updated the triggering
    `MetricCard`'s accent from `#c2410c` to `#b45309` to match.
  - `components/NDSubroleReview.tsx`: already used real Tailwind
    `amber-*` classes, which turn out to be an exact match for the
    shared hex tokens (`amber-50`=`#fffbeb`, `amber-100`=`#fef3c7`,
    `amber-200`=`#fde68a`, `amber-700`=`#b45309`, `amber-800`=`#92400e`)
    — so no color changes needed there, just shape: swapped the neutral
    `.system-list-shell` container for an amber-bordered/amber-filled
    one (the header previously sat on plain white, which is why this
    panel read as less "alert-like" than the other two despite using
    the same color family), fixed the icon badge to 34×34/10px, and
    changed the count pills from `rounded-md` to full pills. Also
    aligned the corner radius and icon-badge size on this component's
    two edge-case states ("awaiting first scan" amber, "clear" emerald)
    for shape consistency, without changing their (correctly distinct)
    colors. Production build passes.

- **Found and fixed why Address Service and Late Filing never showed a
  row divider, even though `.system-list-row`'s CSS looked correct.**
  Vincent: "ADDRESS SERVICE / LATE FILING页面的 row 间隔还是没有看到那个虚线".
  Root cause: `.system-list-row`'s `border-bottom` (`app/globals.css`)
  is set on the row element itself, which works fine for the div-based
  List views (AR Reminder, Active Client) but is a no-op for real
  `<table>`-based pages — browsers don't render a border set on `<tr>`
  under `border-collapse: separate`, which `.system-list-table`
  intentionally uses (the sticky-column performance fix from earlier
  this session). Address Service and Late Filing are both real
  `<table>`s with `.system-list-table`, so their divider was silently
  never rendering, while the div-based pages (never subject to this
  table-specific browser rule) worked the whole time — which is why
  this looked page-specific rather than like a shared-CSS bug. Fixed by
  adding `border-bottom: 1px solid var(--list-border)` to
  `.system-list-table .system-list-row > td` instead (the cell level,
  where table borders DO render), leaving the div-based pages'
  `.system-list-row` divider untouched. Confirmed no inline
  `borderBottom` on any `<td>` in either file that would conflict.
  Production build passes.

- **Master List now sorts by the staff-assigned Code (CA001, CA003, ...
  CB003, CB010, ...) instead of insertion order; TeamWork sync now
  reads and stores that Code; and Master List's "Add Manual" form has a
  new Code field that auto-fills from TeamWork data when the company
  already exists there.** Vincent: "MASTER LIST 内有一个我们自己员工会给每个客户
  记录的CODE...我要你在TW也读取每个公司的这个CODE，并且 MASTER LIST 的排列顺序，要按照
  这个 CODE来排...那个Master List 按钮（+Add Manual）的弹窗内，也要加多一个Code的填写框，
  但是新公司如果已经有数据在TW，要自动匹配好". Ran `client_id` (a live TeamWork API
  field, distinct from `company_id` which is TeamWork's internal
  numeric ID used for `internal_id` matching) through a direct test
  call and confirmed it matches Vincent's Code format exactly, e.g.
  "A PLUS MANPOWER SERVICES PTE. LTD." → "CA001".
  - `app/api/master-list/route.ts`'s GET now orders by
    `internal_code` (nulls last) then `company_name`, instead of
    `row_order` — `row_order` was only ever "append to the end" on
    insert/move (confirmed via `app/api/master-list/move/route.ts` —
    no drag-to-reorder feature exists), which is why originally-imported
    rows (seeded in Code order) looked correctly sorted while newly
    added ones didn't.
  - `app/api/teamwork/sync/route.ts`: added `client_id` to the
    `TwCompany` interface, extracted as `clientCode`, patched into
    matched rows' `internal_code` and set on new inserts. Added
    `internal_code` to the initial `companies` select.
  - New migration `scripts/add-companies-internal-code.sql` (`ALTER
    TABLE companies ADD COLUMN internal_code TEXT` + an index) — Vincent
    ran this in Supabase's SQL Editor; verified live via a direct query
    that the column now exists (all `null` until the next TeamWork sync
    populates it).
  - `app/api/companies/route.ts`'s GET now exposes `internalCode` in
    its response, and `master-list/route.ts`'s `missingCssClients`
    payload now includes each company's `internal_code` too.
  - `components/MasterListTable.tsx`: added a "Code" field to the Add
    Manual form (next to Company Name); `startAddFrom` (the "Add to
    Master List" button from the Missing-from-Active-Client panel) now
    also pre-fills Code from that deterministic match; and a new
    `lookupTwCode()` fires on blur of the Company Name field in the
    general "+Add Manual" flow — searches `/api/companies`, finds an
    exact normalized-name match via `lib/company-name.ts`'s
    `normalize()`, and fills Code from it if found, without overwriting
    a Code the user already typed themselves. Best-effort — fails
    silently on no match or a network error, never blocks manual entry.
  - Production build passes. Held this commit until Vincent confirmed
    the migration had been run, since the TeamWork sync route's
    explicit column list would otherwise 500 on every sync attempt
    (that route runs on a daily cron) until the column existed.

- **Fixed a visible blank line under company names in AR Reminder List
  — the "reserve the FYE line's height for a consistent divider" fix
  from earlier actually rendered a real non-breaking space, not an
  invisible spacer.** Vincent screenshotted the DOM: `<div
  style="...">&nbsp;</div>`. Root cause, found via a direct byte-level
  scan of `app/billing/page.tsx`: the `' '` (intended as a plain space)
  in that earlier edit had been silently corrupted into a literal
  U+00A0 non-breaking space somewhere in the edit pipeline — and the
  code comment right above it had ALSO picked up a corrupted
  replacement-character byte (an em dash mangled into U+FFFD), the same
  failure mode as the CJK-character encoding issue hit earlier this
  session, just not caught at the time since the build doesn't validate
  comment text. On reflection, that "reserve height" fix was likely
  solving the wrong problem to begin with — the row's own `minHeight:
  66` already dominates over the ~2-line company-name-cell's actual
  content height in the vast majority of cases, so the FYE line was
  probably never the real cause of the original "inconsistent divider"
  complaint (more likely candidate: Services chips wrapping to 2 lines
  for companies with many active services — a separate, not-yet-fixed
  issue if it resurfaces). Reverted to the original conditional render
  (`{r.fye_date && <div>...}`) — no line shows at all when there's no
  FYE date. Scanned the rest of `app/billing/page.tsx` and the other
  files touched this session for the same corruption pattern — none
  found elsewhere. Production build passes.

- **Active Client List: removed the UEN line that was duplicated under
  the company name on desktop.** Vincent screenshotted the exact
  element (`<div class="company-registration-text" style="margin-top:
  1px;">202010914N</div>`). `components/MasterListTable.tsx`'s List
  view rendered the UEN twice — once nested under the company name
  (unconditionally, any screen size) and once in its own dedicated
  "UEN / ROC" column (desktop only, since mobile hides that column).
  The nested one only actually needs to exist on mobile, where there's
  no separate column to show it in — added an `isMobile &&` guard so it
  now only renders there, removing the desktop duplicate without
  affecting mobile. Production build passes.

- **AR Reminder List's Services cell chip spacing widened from 6px to
  8px**, per a DevTools screenshot Vincent sent pointing at the exact
  container. `app/billing/page.tsx`, the row's Services `<div>` — `gap:
  6` → `gap: 8`. Production build passes.

- **Diagnosed and fixed why AR Reminder List's row divider looked
  inconsistent — present on some rows, seemingly missing on others.**
  Vincent's screenshot showed rows 24/25 with uneven spacing around
  the divider line; he asked "为什么只有有些row 有虚线...我要全部的 ROW 之间都有这个
  虚线参数隔开，虚线格式要保持一致". Confirmed via code that the divider itself
  (`.system-list-row`'s `border-bottom: 1px solid var(--list-border)
  !important`, `app/globals.css`) is applied unconditionally to every
  row — it was never actually missing. The real cause: each row's
  height wasn't fixed, and `{r.fye_date && <div>FYE ...</div>}` in
  `app/billing/page.tsx` only rendered a second line under the company
  name when `fye_date` existed, so rows without one were shorter —
  making the divider's vertical position (and the gap around it) look
  inconsistent row-to-row even though the line was always there.
  Changed that conditional render to always render the line, showing a
  single space instead of nothing when there's no FYE date, so every
  row reserves the same height. Production build passes. (Row-to-row
  height could still vary slightly for companies with enough active
  services to wrap the Services cell to 2 lines — flagged as a possible
  follow-up if Vincent still sees unevenness after this deploys.)

- **Removed the "VS Vincent / Tassure Asia" text block from the bottom
  of both the desktop sidebar and mobile nav.** Vincent flagged it via
  screenshot: "这部分的文字不需要了". Deleted the whole footer `<div>` in
  `components/Sidebar.tsx` (the `{!collapsed && (...)}` block with the
  border-top divider) and the matching one in `components/MobileNav.tsx`
  — both were static hardcoded text, not derived from session/user data,
  so removing them is a clean, self-contained deletion with nothing else
  depending on it. Production build passes.

- **AR Reminder's List-view PIC column font changed to match a
  `text-xs text-slate-600` reference Vincent screenshotted (a `<td>`
  showing comma-separated PIC names, e.g. "Hoe Chyi Lim, Seng Xin Hoo").**
  In `app/billing/page.tsx`, the desktop row's PIC cell was
  `fontSize: 14, color: '#374151', fontWeight: 500` — changed to
  `fontSize: 12, color: '#475569'` (Tailwind's `text-xs` is 12px,
  `slate-600` is `#475569`), dropping the medium weight to match the
  plainer reference. Scoped to this one cell only — the mobile card's
  separate `PIC: {r.pic}` text and the Table view's PIC column (a
  shared `EditField` instance also used by several other fields) were
  left untouched, since changing `EditField`'s display style would
  affect every field that uses it, not just PIC. Production build
  passes.

- **Extended the just-reverted "no cross on gray" convention to AR
  Reminder's modal and Billing Drafts, and lightened the gray itself.**
  Vincent, after the `CheckSquare` revert above: "把刚才那个去掉打叉的处理方式也
  用在 AR REMINDER 弹窗内容的灰色打叉（我要改成没有打叉的）；BILLING draft 页面也是。
  灰色的颜色也是要改一下". Two changes to `app/billing/page.tsx`:
  (1) `ServiceSquare` gained a `grey?: boolean` prop — when set, it
  renders the plain empty tile (no icon at all) using the same
  `#e5e7eb` fill / `#cbd5e1` border as `CheckSquare`'s unchecked state,
  instead of a colored fill with a check/cross icon. `SVC_SQUARE_COLOR.off`
  itself changed from the darker `#94a3b8` to `#e5e7eb` to match — this
  is the "灰色的颜色也是要改一下" part.
  (2) Wired `grey` in at the two places Vincent named: `OverrideChip`
  (AR Reminder's modal — Auto Off / Manual Off, always the neutral off
  color, so `grey={!on}` unconditionally) and `ServiceMini` (Billing
  Drafts — only its "not applicable" gray state, `grey={color ===
  '#94a3b8'}`; the red "expired/pending" and orange "expiring soon"
  crosses are untouched, since Vincent's ask was specifically about
  the *grey* cross, not every non-green state). Also added a border to
  the modal's small "Off" legend swatch, since the lighter fill needed
  one to stay visible against the panel background. Production build
  passes.

- **Reverted `CheckSquare`'s unchecked-state cross mark (added a few
  entries below) back to a plain empty grey square.** After seeing it
  clearly depicted in a design-reference artifact generated for him,
  Vincent decided against it: "这个里面的灰色打叉不要，保留灰色就好" (don't want
  the grey cross, just keep it grey). `components/MasterListTable.tsx`'s
  `CheckSquare` unchecked branch is back to rendering nothing
  (`{checked && <Check .../>}`), same as before that earlier change.
  Production build passes.

- **Companies page ("Company List") row-2 column header switched to the
  gray/dark-text style too.** Vincent had previously been told this page
  was intentionally left on the navy `.system-list-column-header` (it
  wasn't named in the original Address/AR/Billing/ND request), but a
  screenshot showed he wants it converted as well. Switched
  `app/companies/page.tsx`'s header `<tr>` to `.list-column-header-gray`
  and re-tinted its per-`<th>` inset divider shadow from dark navy
  (`#16304f`) to a light `rgba(15,23,42,0.08)` to match the new
  background. Dashboard (`app/page.tsx`, 3 tables) and Client
  Communications (campaigns/history) still use the navy
  `.system-list-column-header` and haven't been asked about yet — worth
  checking with Vincent if he wants those converted too, rather than
  waiting for another screenshot per page. Production build passes.

- **Active Client's "Missing from Active Client" panel (companies
  TeamWork has as a CSS Client but with no row here yet) now has an
  "Add to Master List" button per company, pre-filling the existing Add
  Manual form instead of making staff retype the name/UEN.** Vincent:
  "我想要做便利性优化，就是在这些公司的右边设置一个按钮（Add to Master List），系统自动匹配（原本+
  add manual）的功能，自动填好公司名字和 UEN". Added `startAddFrom(c)` in
  `components/MasterListTable.tsx` — sets `newRow` from the missing
  client's `company_name`/`registration_no` (uppercased, matching the
  Add Manual form's own `normalize` step for those two fields) and opens
  the same `showAddForm` modal `startAdd`/the toolbar's "+ Add Manual"
  button already use, so every downstream save/reload path is identical,
  just pre-populated. Restructured each missing-client row (name + UEN
  stacked on the left, new button on the right) and widened the panel's
  grid columns from 220px to 300px to fit it. Production build passes.

- **Refined AR Reminder's service-square colors: List-view row now
  always green, and the modal's scheme changed from provenance-only to
  state+provenance.** Vincent's spec, verbatim: "AR REMINDER List 页面的
  services 列的格子要做成 绿色的打勾" and "AR REMINDER List 页面的弹窗中的 services
  Locked 和 Auto On 是浅蓝色打勾, Auto Off 和 Manual Off 是灰色打叉, Manual On 是
  绿色打勾". Two changes to `app/billing/page.tsx`:
  (1) The List-view row's Services cell and its mobile-card equivalent
  only ever display services that ARE active (`SVC_ORDER.filter(k =>
  r.services[k])` / `activeSvc`), so per Vincent's new spec every square
  there is now simply green — dropped the per-service auto-vs-manual
  color branching that used to color some of them blue.
  (2) The modal's scheme changed from "color = provenance always" to
  "color = off (grey) unless on, then color = provenance": redefined
  `SVC_SQUARE_COLOR` from `{locked, auto, manual}` (grey/blue/green) to
  `{off, auto, manual}` (grey/light-blue `#60a5fa`/green) — `off` is new,
  `auto` is now a lighter blue than before. `OverrideChip` now computes
  `!on ? off : isManual ? manual : auto` instead of always branching on
  `isManual` alone, so Auto Off and Manual Off both render grey/cross
  where before Manual Off was green/cross. The "Locked" system-managed
  section switched from grey to the same light blue as Auto On (both are
  always-on states). Updated the modal's own color-key legend (previously
  plain colored text, now small colored swatches: Locked/Auto ·
  Manual On · Off) and two stale code comments describing the old
  scheme. Production build passes (after clearing 10 more stray
  `node.exe` processes via `taskkill` from another session interruption
  mid-build).

- **Active Client's Services column squares (`CheckSquare` in
  `components/MasterListTable.tsx`) now show a cross mark when off,
  instead of sitting empty.** Vincent: "Active Client 页面的 services 列也是
  如果没有就做成灰色格子打叉(之前只是灰色格子)" — the one square style everywhere
  else in this rollout (AR Reminder, Billing Drafts) already always shows
  check-or-cross; this was the one place still left blank for "off",
  since `CheckSquare` predates all of that work. Kept the exact same
  grey fill (`#e5e7eb`, unchanged — Vincent only asked for the cross, not
  a color change) and added an `X` icon in `#94a3b8` for the unchecked
  state (plain white would have had poor contrast against that light
  grey). `CheckSquare` is shared by the ND/Secretary/ACC/TAX toggles in
  both the classic table and the List view, so this covers both. Build
  passes cleanly (after clearing another batch of stray `node.exe`
  processes via `taskkill` — a PowerShell `Stop-Process` attempt hit a
  ".NET CLR failed to start" error mid-session, likely itself a symptom
  of how loaded the machine was; `taskkill` from Bash worked around it).

- **Billing Drafts' Renewal Services / ND (TAC) / Annual Obligations
  columns now use the same square-tile language too, not just AR
  Reminder.** Vincent's follow-up: "我想把这张格子形式的services 列的UI 设计 也搬到
  Billing Drafts 页面的 Renewal services / ND(TAC)/Annual Obligations 列（现在是一个
  四方形的胶囊）". These columns render via `ServiceMini`
  (`app/billing/page.tsx`), which previously called the shared
  `BillingStatusPill` (colored dot + pill) — left untouched, since it's
  also used by the unrelated "To invoice"/"Invoiced" badge. Billing's
  service status isn't a simple binary like AR Reminder's (it has 4
  distinct states: red = expired/pending, orange = expiring soon, green
  = active/billed, grey = not applicable), so generalized `ServiceSquare`
  first — swapped its `tone: 'locked'|'auto'|'manual'` prop for a plain
  `color: string`, updating all 4 existing AR Reminder call sites to
  pass `SVC_SQUARE_COLOR.locked/auto/manual` explicitly — then rewrote
  `ServiceMini` to render `ServiceSquare` with its own 4-color scale
  (check icon only for the "good" active/billed state, cross for
  everything else, color still carries the specific status). Production
  build passes.

- **AR Reminder's Services displays (the List-view row, its mobile card,
  and the detail modal's "Service configuration" panel) now use the same
  small colored checkbox-square + label language as Active Client's
  Services column, replacing pill/capsule badges everywhere.** Vincent's
  spec, verbatim: "ACTIVE CLIENT LIST 页面的 services 列的那个格子形式的显示不错
  ... Locked 的胶囊（现在改成是前面的格子是灰色打勾...) Auto On...(亮蓝色打勾)
  Auto Off...(亮蓝色打叉) Manual On...(绿色打勾) Manual Off...(绿色打叉)".
  Added `ServiceSquare` (`app/billing/page.tsx`) — a 14x14 rounded tile
  matching `components/MasterListTable.tsx`'s `CheckSquare` exactly in
  size/shape, taking an `on` boolean (check vs. cross icon) and a `tone`
  (`locked` = grey `#94a3b8`, `auto` = bright blue `#2563eb`, `manual` =
  green `#16a34a` — color encodes *who* controls the service, the icon
  encodes *current state*, independently, so e.g. "Auto Off" is still
  blue, just with a cross instead of a check). Rewired all three
  consumers: the read-only per-row Services cell (was a white pill + tiny
  colored dot), the mobile card's equivalent, and the modal's two
  sections — "SYSTEM MANAGED" locked services (was a colored pill with a
  tiny "LOCKED" sub-badge) and `OverrideChip` for the four
  click-to-cycle overridable services (was a colored pill with a state
  sub-badge; the click-to-cycle behavior itself is unchanged, only the
  visual). Removed `SVC_STATE_STYLE`, which became entirely unused once
  every consumer switched to `ServiceSquare`'s tone-based coloring.
  Production build passes. Also cleaned up 6 more stray orphaned `node`
  processes left over from more session interruptions during this
  change (same as the previous entry) — worth a permanent note: this
  machine has been dropping the Claude Code session mid-background-task
  repeatedly today, each time abandoning that task's `npm run build`
  process running to completion in the background with nothing left to
  consume its output.

- **Fixed why Late Filing's mirrored scrollbar (added in the previous
  entry below) looked/behaved differently from Master List's: the thumb
  was oversized and dragging it did nothing.** Vincent: "late filing 页面的
  滚动条为什么和 Active Client TABLE 页面的 滚动条不同，late filing 页面的滚动条
  过长，并且不丝滑". Root cause: unlike `MasterListTable.tsx` (where the
  scroll container `<div ref={outerRef}>` is *always* mounted — only the
  rows inside `<tbody>` are conditional on loading/empty state), Late
  Filing had the *entire* `<div ref={outerRef}>...<table>` wrapped in a
  `loading ? ... : displayRows.length === 0 ? ... : (...)` ternary, so on
  first render (`loading` still `true`) the div didn't exist yet. The
  `useEffect` that attaches the scroll/resize/drag listeners to
  `outerRef.current` ran once on that first render, saw `el` was `null`,
  and returned early — since its dependency array never changes again,
  those listeners were never attached once the table actually mounted.
  That left the thumb sized from a single stale `updateSb()` call (via
  the separate `[rows,page]`-triggered effect) and made dragging inert
  (the `document`-level `mousemove`/`mouseup` handlers were inside the
  same dead effect). Restructured to match `MasterListTable.tsx` exactly:
  the scroll container and `<table>`/`<thead>` now always render;
  loading/"no results" states are a single `colSpan={11}` row inside
  `<tbody>` instead of replacing the whole table. Also found and closed
  6 stray orphaned `node` processes left over from background builds
  across several session interruptions earlier — flagged by Vincent as
  making the machine sluggish. Production build passes (clean, no
  leftover processes afterward).

- **Late Filing's horizontal scrolling now matches Master List's classic
  table exactly — sticky leading columns + a draggable mirrored
  scrollbar pinned to the bottom of the viewport.** Verbatim: "late
  filing 由于现在的列太多了，导致要左右移动，麻烦把那个左右滚动的设置，做成和 master list table的
  一样". Late Filing has 11 columns (chevron, Company Name, UEN/ROC, FYE,
  Late FY, 3 date columns, Next AGM Due, Remarks, actions) and no
  existing horizontal-scroll affordance beyond the browser's native
  scrollbar at the very bottom of a potentially tall table. Ported the
  exact mechanism from `components/MasterListTable.tsx` (itself the
  "same pattern as AR Reminder" per its own comment) into
  `app/late-filing/page.tsx`: `outerRef`/`sbRef`/`thumbRef` refs,
  `updateSb()` (recomputes the mirrored thumb's size/position off the
  real scroll container, called on scroll/resize/data-change), a
  drag-to-scroll mouse handler, and a `STICKY_WIDTHS = [32, 300, 120]`
  (chevron, Company Name, UEN/ROC) sticky-offset scheme — the same 3
  columns Master List pins (No./Company Name/UEN-ROC), adapted to Late
  Filing's own column widths. Rendered the identical bottom-fixed
  draggable scrollbar JSX. Late Filing has no existing mobile-specific
  layout (unlike Master List/AR/Billing, which branch on `isMobile`), so
  native horizontal scroll is hidden unconditionally here, matching
  desktop behavior; flagged as a possible follow-up if mobile use turns
  out to need it. Production build passes.

- **Late Filing rows now have the left-side chevron (`>`) indicator too
  — Vincent's follow-up after the No.-column change: "可是左边的那个三角你没有还原"
  (the reference screenshot's chevron column wasn't reproduced).** Late
  Filing never actually had a chevron before (confirmed via the prior
  commit's diff — the removed "No." cell was plain text, no icon), so
  this was a genuine gap against the Active Client List view reference,
  not a regression. Added a narrow 32px `<col>`/`<th>`/`<td>` column
  before Company Name with a Lucide `ChevronRight` icon (`#94a3b8`,
  matching Active Client's List view chevron exactly), and switched the
  header label array's map key from the label text to its index (now
  that both the new leading chevron column and the trailing actions
  column are empty strings, using the text as a key would collide).
  Production build passes.

- **Late Filing's table header is now gray/dark-text, and the separate
  "No." column is gone — row numbers are now inlined into the Company
  Name cell instead, matching Active Client's List view exactly (the
  screenshot Vincent pointed at as the reference).** Verbatim: "late
  filing 页面那边要做和截图一样的处理，不需要 No. 列". In
  `app/late-filing/page.tsx`: dropped the first `<col>` (56px, the "No."
  column width) and widened Company Name's `<col>` from 250px to 300px
  to absorb the space; removed `'No.'` from the header label array and
  switched the header `<tr>` from `.system-list-column-header` to
  `.list-column-header-gray` (also dropped its now-redundant hardcoded
  inline `background:'#1e3a5f', color:'#fff'`, letting the CSS class
  handle it, same as every other page in this rollout); removed the
  separate `<td className="system-list-number">` cell and instead
  prefixed the Company Name `<td>` with `<span style={{color:'#cbd5e1',
  marginRight:6, fontSize:11}}>{row number}</span>` — the exact same
  inline-number styling `MasterListTable.tsx`'s Active Client List view
  already uses. Production build passes.

- **Two follow-ups from Vincent after seeing the collapsible Active
  column live: (1) inconsistent font sizes on collapse-toggle labels,
  (2) two more headers missed by the gray-row-2 rollout.** Verbatim:
  "字为什么不是 11px, 包括 PIC 的字大小也是要 11PX，然后为什么 ACTIVE CLIENT LIST 和
  AR TABLE 页面的第二行没有灰色背景黑字处理".
  (1) The new "Active" collapse-button label in
  `components/MasterListTable.tsx` was `fontSize: 9`, and AR Reminder's
  PIC collapse-toggle buttons in `app/billing/page.tsx`'s `picHeader()`
  were `fontSize: 9`/`8` — both copied from the pre-existing pattern
  without matching the rest of the header row's 11px. All three now
  `fontSize: 11`.
  (2) Two header rows were missed because they don't go through the
  `columns.map` code path already converted: Active Client's **List**
  view (`MasterListTable.tsx`'s `enableListView && view === 'list'`
  branch, a `<div>` grid header, not the classic `<table>`) was still on
  the navy `.system-list-column-header` — switched to
  `.list-column-header-gray`. AR Reminder's **Table** view
  (`ARTableView`'s own `TH` component in `app/billing/page.tsx`) doesn't
  use CSS classes at all — it's a fully self-contained component with
  `background: '#1e3a5f'` hardcoded inline — switched to the same
  `#e4e9ef`/`#1e293b` gray/dark-text pair used everywhere else, updated
  its `borderRight` divider and box-shadow for the lighter background,
  and re-tinted `ARColumnFilterMenu`'s filter icon (previously white/
  yellow, assuming a dark header) the same way `ColumnFilterMenu` was
  fixed earlier. AR Reminder's own row-1 title bar ("FYE JUL 2026" etc.,
  rendered by the parent `ARTab`, not `ARTableView`) is untouched — stays
  navy, matching the row-1/row-2 split established for Master List.
  Production build passes.

- **Master List's classic table "Active" (status) column can now be
  collapsed/expanded, same interaction as AR Reminder's PIC columns.**
  Vincent's ask, prompted by Strike Off's full-width "• STRUCK OFF" pill
  badges eating a lot of horizontal space per row: "MASTER LIST TABLE 的
  ACTIVE 列要做和ACTIVE CLIENT 的table 中的 PIC列那样可以收起来". The referenced
  collapse pattern actually lives in `app/billing/page.tsx`'s
  `ARTableView` (`picOpen` state + `picHeader()`, for AR Reminder's
  SEC/ACC/TAX PIC columns) — no equivalent existed yet in
  `components/MasterListTable.tsx`. Added the same pattern there: a new
  `statusOpen` boolean state (defaults to expanded), a header `<th>` that
  swaps between a `ChevronLeft`+label "collapse" button (full width) and
  a bare `ChevronRight` "expand" button (34px wide) for the `status`
  column specifically, and the body `<td>` renders nothing with
  `padding: 0` when collapsed — mirroring `ARTableView`'s `<TD
  style={!picOpen.x ? {padding:0} : undefined}>{picOpen.x && ...}</TD>`
  exactly. Applies to all six Master List pages (the column is shared
  across `columns`), not just Strike Off. Production build passes (one
  earlier build attempt hit a transient Turbopack timeout processing
  globals.css — unrelated to this change, a clean retry succeeded).

- **Extended the light-gray/dark-text column-header row (row 2) from
  Master List to Address Service, AR Reminder's List view, Billing
  Drafts, and ND (Nominee Director Directory).** Vincent's explicit list:
  "ADDRESS / AR / BILLING/ND 页面的表头第2行也是要做灰色背景和黑色字". Renamed
  the CSS class from `.master-list-column-header` to the more accurate
  `.list-column-header-gray` (same properties, same
  `--list-column-header-*` variables) since it's no longer Master-List
  specific, and switched these four components off the shared
  `.system-list-column-header` class onto it:
  `components/AddressServiceTable.tsx` (row 2, `<tr>`),
  `components/NDDirectory.tsx` (row 2, grid header `<div>`),
  `app/billing/page.tsx`'s Billing Drafts list header and AR Reminder's
  List-view header (both separate `<div>` instances in the same file).
  Added a matching `.system-list-table .list-column-header-gray > th`
  padding rule alongside the existing `.system-list-column-header`
  variant, since Address Service's `<table>` still carries the shared
  `.system-list-table` class for its cell padding/border rules. Left
  Dashboard, Companies, Late Filing, and Client Communications on the
  original navy `.system-list-column-header` — not named in this
  request, and AR/Billing's Table-view toggle (`ARTableView`, the
  Excel-style view) is untouched too, since it uses its own inline
  styling entirely, not this shared class. Production build passes.

- **Tweaked the new Master List column-header row: darker gray, and
  restored the original 11px font size.** Two follow-ups to the previous
  entry below. (1) Gray was too light — darkened
  `--list-column-header-bg` from `#f1f5f9` to `#e4e9ef` and its border
  from `#dde6ef` to `#d3dbe4` to match. (2) Font looked smaller than
  before — root cause: the classic table's `<th>` cells had an inline
  `fontSize: 9` that, it turns out, was NEVER actually rendering — the
  OLD shared `.system-list-column-header > *` CSS rule forced
  `font-size: 11px !important` this whole time, silently overriding that
  inline value (the same "`!important` masks a stale inline style"
  pattern as the earlier background-color and TABLE/LIST border bugs
  this session). When the new `.master-list-column-header` class was
  written, it copied the inline 9px value, not realizing that value had
  never actually been visible — an unintentional shrink. Corrected to
  `font-size: 11px !important` (matching what was actually on screen
  before any of today's changes), and reverted `text-transform`/
  `letter-spacing` to `none`/`normal` for the same reason. Production
  build passes.

- **Master List's classic table now has two visually distinct header
  rows: row 1 (title bar) keeps each page's `accentColor` (red for
  Strike Off, navy for the other five), row 2 (the column-label row —
  No./Company Name/UEN.../...) is now a fixed light-gray background with
  dark text on ALL six Master List pages, including Strike Off.**
  Vincent's precise spec after a few rounds of clarification: row 1 stays
  colored per page, row 2 becomes uniform light-gray/black everywhere,
  Strike Off included (only its row 1 differs, staying red). Implemented
  as a dedicated `.master-list-column-header` CSS class (new
  `--list-column-header-bg`/`--list-column-header-text`/
  `--list-column-header-border` variables — light gray `#f1f5f9`, dark
  slate text `#1e293b`), kept deliberately separate from the shared
  `.system-list-column-header` class so genuine LIST pages (Dashboard,
  Companies, Late Filing, Billing Drafts, Client Communications) are
  untouched — this change is scoped to the Master List family only,
  since every screenshot in this conversation was a Master List column
  header. Removed the `background: accentColor` inline overrides just
  added to the classic table's `<th>` cells (no longer needed — the new
  class handles row 2 uniformly), and re-tinted the column-header cell
  divider (`borderRight`) and `ColumnFilterMenu`'s filter icon (previously
  white/yellow, assuming a dark header) for legibility against the new
  light background. Production build passes.

- **Found and fixed the real bug behind the Strike Off header color
  confusion: the classic Master List table's title bar and column-header
  row have never actually rendered `accentColor` since Codex's redesign
  (`7bdbd44`), for ANY list page — a CSS regression, not a request.**
  After reverting the "Add Manual" button back to red (previous entry
  below), Vincent sent the same screenshot again pointing at the
  Strike-Off table's header row, which is navy, not red — even though
  the JSX at `components/MasterListTable.tsx` already sets
  `background: accentColor` inline on those `<th>` cells. Root cause:
  `app/globals.css`'s `.system-list-title-bar`, `.system-list-column-header`,
  and `.system-list-column-header > *` rules all force
  `background(-color): var(--list-header) !important` — added by
  Codex's redesign for genuine LIST pages (none of which ever set an
  inline background, confirmed by grepping every `system-list-title-bar`/
  `system-list-column-header` usage across the app, so dropping
  `!important` changes nothing for them) but which also silently
  overrode Master List's classic-table header wherever it tried to use
  its own `accentColor`. This means Strike Off's classic-table header
  has quietly been navy instead of red since that redesign landed —
  Vincent just hadn't flagged it until now. Fixed by removing
  `!important` from those three background declarations, and adding the
  previously-missing inline `background: accentColor` to the title-bar
  div and the sticky "No." header cell (the other header cells already
  had it, just blocked). Production build passes.

- **Reverted the previous "Add Manual" button color change — Vincent
  clarified he actually wants both the toolbar button and the table
  header red on the Strike Off page, scoped to that page only.** A
  screenshot led Claude to read Vincent's earlier "the header should be
  red" as "…but not the button," and changed both the toolbar button and
  the modal's Save button off `accentColor` to a fixed teal. Vincent
  corrected this: the intent was that the button and header **both**
  being red is correct and specific to Strike Off (other list pages
  naturally get their own non-red `accentColor` already, so nothing else
  needed changing). `git revert`'d that commit outright rather than
  hand-editing back, since the prior commit was the exact inverse of the
  desired state. Production build passes.

- **Enforced a fixed casing rule for the "Dear {{contactName}}" greeting in
  Outlook drafts.** Vincent's rule: a Chinese name is copied through
  untouched (no such thing as case in Chinese), an English/romanized name
  gets proper title case regardless of how it was entered — e.g. raw
  "TAN QUINI" or "seow jin sheng" both become "Tan Quini" / "Seow Jin
  Sheng". Added `formatContactName()` in `lib/email-merge.ts` (detects any
  CJK codepoint via Unicode range test, leaves Chinese names alone,
  otherwise capitalizes the first letter of each whitespace-separated word
  and lowercases the rest). Applied it at the one true choke point every
  draft-creation path funnels through — `app/api/client-communications/
  campaigns/route.ts`'s POST handler, where `contactName` is finalized
  into both the merged `subject`/`body` and the persisted `contact_name`
  column — so it's guaranteed regardless of whether the name came from
  TeamWork sync, the company-record fallback, or a reviewer's manual edit
  in Campaign Centre's contact-name text box. Also applied it in
  `lib/client-comms-resolve.ts`'s `buildRow()` (the shared preview
  resolver) so the reviewer sees the same correctly-cased name they'll
  actually send, not a mismatched raw value. Production build passes.

- **Fixed a severe page freeze on clicking any cell in either TABLE view
  (AR Reminder's Table toggle and Master List's classic table), reported
  by Vincent immediately after the Excel-style revert below.** Diagnosed
  by diffing exactly what changed between Codex's LIST version (not
  laggy) and the reverted version (severely laggy): the one meaningful
  rendering-affecting difference — everything else was padding/color —
  was `border-collapse`. The pre-revert (Codex) markup used
  `className="system-list-table"`, whose CSS sets
  `border-collapse: separate; border-spacing: 0`. The revert brought
  back the original inline `borderCollapse: 'collapse'`. Both TABLE
  views have 2-3 `position: sticky` columns plus a sticky header;
  `border-collapse: collapse` combined with heavy `position: sticky`
  usage is a well-known browser layout pathology — because collapsed
  border geometry depends on every neighboring cell, ANY DOM change
  inside the table (e.g. a cell's display `<span>` swapping to an
  editable `<input>` on click) forces the browser to re-layout the
  *entire* table rather than just that cell. That exactly matches
  "click any one cell → whole page freezes." Fixed by switching both
  tables to `borderCollapse: 'separate', borderSpacing: 0` while
  keeping every existing per-cell `borderRight`/`borderBottom` — since
  only right/bottom borders are set (never left/top), each column and
  row boundary still gets exactly one line, so the Excel gridline look
  is visually unchanged. Confirmed via `grep` that no other file in
  `app/` or `components/` uses `borderCollapse: 'collapse'`, so this was
  fully scoped to the two affected tables. Production build passes.

- **Restored the Excel-style visual on the two true "TABLE" views Codex's
  "Redesign operational list layouts" (`7bdbd44`) had flattened to match
  the softer "LIST" pages.** Vincent draws a hard line between "TABLE"
  (dense, gridlined, per-row status-colored — literally Excel-like) and
  "LIST" (card/row style) pages, and Codex's redesign mistakenly applied
  the LIST treatment to the two actual TABLE views too. Confirmed the
  exact regressions by diffing `7bdbd44` directly rather than guessing:
  column-divider gridlines removed (globals.css added
  `border-left:0 !important; border-right:0 !important` to
  `.system-list-row > td` and `.system-list-column-header > *` —
  both rule additions were 100% new in that commit, safe to remove
  outright since no genuine LIST page ever sets an inline border-left/
  right for these to suppress), the per-row colored left-border status
  accent deleted from `ARTableView` entirely (and from
  `MasterListTable.tsx`'s List view, where it's since caused the
  `rowColors` undefined-reference bug patched earlier), and row
  padding/`border-collapse` loosened from the original dense spreadsheet
  feel. Reverted **only** `ARTableView` (`app/billing/page.tsx`, AR
  Reminder's "Table" toggle) and `MasterListTable.tsx`'s default/classic
  table (shared by Active Client, Strike Off, Terminated, MAS, Name
  Change, Ad Hoc) back to their exact pre-`7bdbd44` inline styles —
  gridlines, `ARTableView`'s accent-colored left border, tight
  `3px 6px` padding, `border-collapse: collapse` — confirmed via Vincent
  before touching anything. Left every genuine LIST page (Billing
  Drafts, AR's List view, Companies, Late Filing, Email Drafts, History,
  Address Service, Dashboard) on Codex's new shared styling untouched, and
  did **not** revert Address Service's table per Vincent's explicit
  call that it's fine as a LIST page. Production build passes; committed
  locally, pushed.

- **Tassure Draft Helper v1.3.0: the payment-options image is now embedded
  inline in Outlook drafts, matching the original Word templates.**
  Vincent pointed out the real AR1 template (`AR-AUTO EMAIL.docx`) had the
  "PAYMENT OPTIONS" graphic (cheque/bank-transfer/PayNow QR, all one static
  company-wide image, extracted and confirmed via `python-docx` reading
  `word/media/image1.png` inside the docx) embedded right after the
  "PAYMENT METHOD付款方式:" line — my earlier AR1/AR2/AR3 template rewrite
  had only carried over the text, not the image. Rather than moving the
  database templates to HTML (bigger change to the Templates & Senders
  plain-textarea editing UI, for content that's identical on every email),
  scoped this to the one place that actually builds the Outlook item:
  `tassure-draft-helper/app.py`'s `_set_body` now checks the merged body
  for the `PAYMENT METHOD` marker text — if present, switches that one
  draft to an HTML body and embeds the bundled `assets/payment_options.png`
  inline via Outlook's CID-attachment technique (`PR_ATTACH_CONTENT_ID`);
  otherwise behaves exactly as before (plain `.Body`), so a template with
  no payment section (e.g. a document-reminder letter) is unaffected.
  Verified the text-processing logic directly (marker detection, HTML
  escaping, bundled-asset path resolution all correct); could not verify
  the actual rendered Outlook draft in this environment since its Outlook
  install has no configured mail account (a fresh launch just opens the
  "Add Account" wizard) — this needs a quick visual check on Vincent's own
  already-running Outlook. Rebuilt exe copied to
  `public/downloads/TassureDraftHelper.exe`. Still only have the payment
  image from the AR1 docx (`AR2-auto email.docx`/`AR3.docx` are no longer
  on the Desktop) — reused the same image for every template for now;
  flagged to confirm whether AR2/AR3/SOA use an identical image or a
  different one. Production build passes; committed locally, pushed.

- **Operational LIST interfaces were redesigned across the system.** Added a
  shared, restrained list foundation (`system-list-shell`, toolbar, scroll,
  table/grid rows, headers, secondary text and action controls) while keeping
  page-specific information hierarchy. Companies, Active Client, Billing
  Drafts, AR list/table, Late Filing, Nominee Directors, Address Service,
  Email Drafts, Communication History and Dashboard exception tables now use
  clearer column widths, roomier rows, consistent company/UEN typography,
  solid navy headers, neutral row surfaces and light horizontal separators.
  Removed decorative vertical/dashed column dividers, alternating ND row
  colours, redundant coloured left-edge status rails and ad-hoc hover styling;
  business statuses remain visible in compact field-level badges and progress
  values. Wide operational tables now scroll inside bounded list shells instead
  of compressing important columns. TypeScript and the full Next.js production
  build pass. Targeted ESLint still reports existing React hook-rule issues in
  the large legacy Billing, Late Filing and Master List components; this LIST
  refactor introduced no production build failure.

- **CC now defaults to real addresses even without a synced TeamWork
  recipient directory, and includes the company's PIC(s).** Vincent's
  screenshot showed CC textareas displaying only the placeholder example
  text ("hoechyi@tassure.com" / "other@email.com") for "FALLBACK — REVIEW"
  and "NO RECIPIENT SOURCE" rows — `pickContact`'s fallback branch
  (`lib/client-comms-resolve.ts`) hardcoded `ccEmail: null`, so even the
  already-established "always CC hoechyi@tassure.com" rule
  (`lib/campaign-recipients.ts`) never actually ran outside the
  TeamWork-synced path. Fixed via a new shared `buildDefaultCcList()`
  (`lib/campaign-recipients.ts`) used by *both* branches now. Also wired
  in the company's assigned PIC(s) per Vincent's explicit confirmation:
  SEC PIC (`companies.pic`) always, plus ACC/TAX PIC
  (`ar_reminder.acc_pic`/`.tax_pic` — AR-cycle-specific, loaded via new
  `loadArPicByCompany` and threaded through `buildRow`) for AR campaigns.
  New `lib/staff-directory.ts` resolves a stored PIC value into a real
  email — checked the *actual* distribution of values in
  `ar_reminder.pic`/`acc_pic`/`tax_pic` (not just the 9-person
  `lib/teamwork-pic.ts` map, which only covers Corporate Secretarial/some
  Internal/Malaysia staff) before writing the matcher, since real values
  are inconsistent: full names in either word order, given-name-only
  ("Shemin", "Vernice"), ad hoc initials staff type themselves ("YH", "JF",
  "QT", "VY", "CS" — confirmed against the real per-value counts, not
  derived from a formula, since none fit every case), occasional
  unresolved raw TeamWork numeric ids ("9,11"), and non-person values
  ("Client", "dormant", "Waiver", "PAC", "NA") that are deliberately left
  unmatched so no CC is added rather than guessing. Every distinct real
  value queried from the live table resolves correctly (or correctly
  resolves to nothing) against the new matcher. Production build passes;
  committed only the intentional files for this change — a large,
  unrelated in-progress visual-unification edit from another session
  (Codex) is sitting uncommitted across several files including
  `components/MasterListTable.tsx` (which had one clearly broken reference,
  `rowColors`, undeclared — patched minimally to the same plain grey it
  used before, left **uncommitted** on purpose so as not to attribute or
  interfere with that in-progress work).

- **Billing Drafts now uses the same invoice-reference treatment as Email
  Drafts.** Desktop and mobile TAB/TAC references are displayed as compact
  rectangular `TAB #...` / `TAC #...` tags instead of coloured status pills.
  Empty cells now state `No system invoice`; muted historical TAC references
  keep their existing date tooltip and invoice-selection logic. TypeScript,
  diff checks and the full production build pass.

- **Outlook drafts now re-verify their invoice amount against QuickBooks
  right before opening.** Vincent's real scenario: he generated an invoice
  through the system, then corrected its amount directly in QuickBooks
  afterward, bypassing the app. The draft's stored `total_amount` (and the
  "Total S$X" text already merged into `subject`/`body`) went stale — the
  email text would have shown the old amount while the attached PDF
  (always fetched live from QB) showed the corrected one, a bad mismatch
  to send a real client. Went through `EnterPlanMode` given the money
  sensitivity and multiple valid approaches. New
  `POST /api/client-communications/drafts/refresh-amounts` (body `{id}`):
  loads the draft → its campaign's template/FYE → re-queries QuickBooks
  (`qbQuery`, `lib/quickbooks.ts`) for each TAB/TAC invoice ref's live
  `TotalAmt`, and if the total changed, re-merges `subject`/`body` with
  the same `mergeTemplate`/`formatAmount`/`formatInvoiceList`
  (`lib/email-merge.ts`) `campaigns/route.ts` already uses, persisting the
  correction with the same optimistic-lock pattern the existing PATCH
  handler uses. Folded into the **one** shared choke point all three
  Outlook-opening flows already go through —
  `openDraftsInOutlook` (`lib/draft-helper-client.ts`) — instead of
  editing three pages separately: runs alongside the existing attachment
  fetch (same bounded-concurrency pass), fails open (any error here just
  keeps the previously-known amount, never blocks the draft from opening),
  and adds `amountCorrected`/`previousTotal`/`newTotal` to
  `DraftOpenResult`. Billing Drafts' quick-draft
  (`app/billing/page.tsx`'s `quickEmailDraft`) was switched from its own
  client-merged copy to the server-persisted draft row (now returned by
  `campaigns/route.ts`'s POST as `drafts[]`, with a real `id`) so the
  refresh step has something to key off; its popover shows a dedicated
  correction notice instead of auto-closing so it can't flash and vanish.
  The Email Drafts workbench and Delivery History's reopen flow surface
  the same correction in their existing success/warning messages.
  Production build passes; committed locally, pushed.

- **Primary operational lists now use one calmer, consistent visual system.**
  Companies, Active Client / Master List, Billing Drafts, AR Reminder,
  Late Filing, Address Service, Nominee Director review, Email Drafts, Email
  Activity and Dashboard exception details now share a navy column header with
  white 11px/700 labels, white content rows, light neutral separators and one
  consistent blue-grey hover / selected treatment. Alternating row fills,
  finance-header teal, large tinted status pills and multi-colour service chips
  were neutralised; semantic colour is now limited to a small dot, status text
  or the existing thin left status rail. Right-side workflow actions and icons
  were deliberately preserved. User-facing vocabulary is now consistent:
  `No.`, `Company Name`, `UEN / ROC`, `Company Type` and `Address Service`.
  Company identity typography, column widths, data sources, filters, editing
  and all business logic remain unchanged. Targeted ESLint passes on the clean
  list pages; the large Billing, Late Filing and Master List components still
  report only their pre-existing React effect / declaration-order findings.
  TypeScript, diff checks and the full 50-route production build pass.

- **Company identity typography is now consistent across the application.**
  Added shared `company-name-text` and `company-registration-text` styles based
  on the Billing Drafts visual hierarchy: company names are 12px/700 deep navy,
  while registration identifiers are 10px/500 muted monospace text. Applied
  the shared styles to Companies, Active Client/Master List, Billing Drafts,
  AR, Late Filing, Nominee Directors, Address Service, Email Drafts, Email
  Activity and Dashboard exception details. User-facing column labels, form
  labels and search prompts now use `UEN / ROC`, making clear that both names
  refer to the same company registration identifier. Database columns and API
  contracts remain unchanged (`uen`, `roc_no`, and `registrationNo` continue
  to be used internally), and no table structure, width, sorting or data logic
  was changed. TypeScript, diff checks and the full 50-route production build
  pass. Targeted ESLint still reports only the pre-existing React effect and
  declaration-order findings in the large Billing, Late Filing and Master List
  components.

- **The AI assistant no longer blocks page controls and now understands the
  current work area.** Its fixed bottom-right launcher was removed and replaced
  with a compact `AI 助手` action immediately to the right of `Logout` in the
  desktop header. The conversation panel opens below the header at the
  top-right, closes with Escape or its close button, and closes before following
  an in-app navigation link. The assistant now receives the current pathname,
  identifies Dashboard, Companies, Active Client, ND, Address Service, AR /
  Billing, Late Filing, Email Drafts and Email Activity, and presents three
  page-specific quick questions. Its knowledge now covers current Companies
  classification, ND count differences, service/FYE warnings, billing periods,
  the manual-send safeguard, Email Draft readiness, recipient rules, prepared
  email history and Outlook Helper setup. It can also query live automation run
  health and open integration-exception counts instead of claiming that a
  scheduled job succeeded without evidence. The documented SGT Cron schedule
  was corrected to the deployed `vercel.json` sequence (05:00 through 08:00).
  Targeted ESLint, TypeScript, diff checks and the full 50-route production
  build pass.

- **Email Drafts now has a calmer review-first layout and a prominent Outlook
  Helper readiness panel.** The workbench uses navy as its single primary
  action/selection colour; green is reserved for ready states and amber for
  items requiring attention. Template choices, invoice chips, amounts and
  recipient-source badges were visually neutralised and each company row now
  has 15px vertical padding for more breathing room without changing any
  column widths. The Status column continues to show every review warning in
  full so staff do not have to interpret collapsed `+ more` summaries. Its
  row-removal control now uses the same red bordered `Trash2` icon treatment as
  Email Activity / History instead of a faint `X`; it only removes the
  unsaved row from the current batch. The page is organised as
  numbered `Batch setup` and `Review companies` stages. A persistent Helper
  panel now distinguishes checking, not detected, ready and update-available
  states. When no Helper responds, it deliberately says `Not detected` (the
  browser cannot reliably distinguish uninstalled from installed-but-closed)
  and gives staff an explicit Download -> Open -> Recheck sequence. A detected
  Helper shows its version and Classic Outlook verification where available;
  the final action also explains when Helper setup is blocking draft creation.
  Recipient rules, template contents, invoice matching and draft creation
  behaviour are unchanged. Targeted ESLint, TypeScript, diff checks and the
  full 50-route production build pass.

- **Email Activity (Delivery History) can now delete a record.**
  (`app/client-communications/history/page.tsx` +
  `app/api/client-communications/drafts/route.ts`). Vincent's screenshot
  showed duplicate/stray rows (e.g. the same company prepared twice) with
  no way to remove them, and asked for the same small trash-bin icon the
  other List pages use. Added `DELETE /api/client-communications/drafts`
  (removes one `email_drafts` row by id — local audit record only, no
  effect on Outlook or QuickBooks) and wired it up with the exact
  established pattern from `app/late-filing/page.tsx`: a `Trash2` icon
  button (red border/icon, white background) next to the existing "View"
  button, gated behind the shared `components/ConfirmDeleteModal.tsx`
  (same component used everywhere else in the app), not a new one-off
  confirm dialog. Widened the row grid's last column (64px → 100px) to
  fit both buttons. Production build passes; committed locally, pushed.

- **Web app now detects an outdated Draft Helper and prompts to update.**
  Vincent flagged that the Helper (used by staff, not by him directly — he
  can't personally test/reproduce issues on it) had no update mechanism at
  all: every code change meant staff needed to know to manually
  re-download and relaunch, with nothing telling them they were behind.
  Confirmed via a direct question that a lightweight fix — the web app
  detects version drift and prompts a download, rather than a fully
  self-updating exe (more complex, more risk: an exe replacing itself can
  trip antivirus, fail silently, etc.) — was the right scope for now.
  `lib/draft-helper-client.ts` gained `LATEST_HELPER_VERSION` (bump this
  alongside `tassure-draft-helper/app.py`'s own `VERSION` on every rebuild),
  `getHelperHealth()` (the full `/health` payload, not just a boolean) and
  `isHelperOutdated()`; `checkHelperHealth()` now reuses `getHelperHealth`
  internally so its existing boolean contract is unchanged for the callers
  that only care whether it's running (`history/page.tsx`'s reopen-draft
  preflight). Both persistent Helper-status surfaces — the Email Drafts
  workbench (`campaigns/page.tsx`) and Billing Drafts' quick-draft popover
  (`billing/page.tsx`) — now show an amber "Update Outlook Helper" prompt
  with a download link when the running Helper reports an older version,
  distinct from the existing "not running at all" state; an outdated
  Helper still works (button stays enabled), it's a nudge, not a block.
  Production build passes; committed locally, pushed.

- **Tassure Draft Helper v1.2.0: verifies it's actually targeting Classic
  Outlook, not New Outlook** (`C:\Users\vincent\tassure-draft-helper\app.py`
  — separate project, not part of this repo; only the rebuilt exe is
  committed here). Vincent reported a draft opened, but "in the wrong
  version" — on a machine with both Classic and New Outlook installed,
  Windows can resolve the `Outlook.Application` COM ProgID ambiguously.
  Added `_resolve_outlook_exe_path()` (reads
  `HKEY_CLASSES_ROOT\Outlook.Application\CLSID` →
  `HKEY_CLASSES_ROOT\CLSID\{clsid}\LocalServer32`, the exact lookup
  `Dispatch()` performs internally, so this reports the real answer rather
  than assuming) and `_is_classic_outlook_path()` (must end in
  `OUTLOOK.EXE` and not live under `WindowsApps`, where New Outlook's
  MSIX package would be). `/health` now reports `outlookPath` and
  `isClassicOutlook`; `/drafts/open` refuses with a clear, actionable
  error (409 — "turn OFF 'Try the new Outlook'…") instead of silently
  proceeding when verification fails, rather than opening an ambiguous
  window with no explanation. Also gave Vincent the immediate manual
  fix (Outlook's own "Try the new Outlook" toggle, top-right, OFF) as the
  fastest unblock independent of this code change. Rebuilt exe copied to
  `public/downloads/TassureDraftHelper.exe`; his previously-running
  instance (from `C:\Users\vincent\Downloads\TassureDraftHelper.exe`,
  built Jul 27, found via `Get-Process` — not visible through this
  session's bash `ps`, a real gap worth remembering) was stopped so he
  picks up the new version on next download+run. Production build passes;
  committed locally, pushed.

- **Email Drafts workbench: ready/review badges are now pills**
  (`app/client-communications/campaigns/page.tsx`, the merged workbench —
  read fresh since Codex's recent commits substantially restructured this
  page, per this file's own note above about that merge). Vincent's
  screenshot pointed at four plain-text indicators he wanted "胶囊格式"
  (capsule/pill shape): the header's "{N} ready" / "{N} need review"
  counts, and each row's recipient-source label ("TEAMWORK REPORT" /
  "FALLBACK — REVIEW" / "NO RECIPIENT SOURCE"). Converted all four to the
  same rounded-pill convention already established elsewhere in the app
  (`DueBadge`/`BillingStatusPill` in `app/billing/page.tsx`): small dot +
  label, tinted background, colored border, `borderRadius: 999` — this
  file didn't have that convention yet (it used flat text/small rect
  chips), so this introduces it here to match Vincent's repeated pill
  preference app-wide. Colors: ready/TEAMWORK REPORT green, need
  review/FALLBACK amber, and NO RECIPIENT SOURCE red (a harder blocker —
  no email at all, vs. a fallback that still resolved something —
  deliberately distinguished from the amber fallback case rather than
  reusing the same color). Production build passes; committed locally,
  pushed.

- **Top summary and filter cards now use one shared visual system across the
  application.** Dashboard, Companies, Active Client and the other Master
  Lists, Billing Drafts, AR, Late Filing, Nominee Directors and Address Service
  now share the same white card, light border, rounded shape, tinted icon,
  number, label and supporting-text hierarchy. Cards that filter or navigate
  retain their existing behaviour and show a right arrow, hover/focus feedback
  and a clear selected state; information-only cards intentionally have no
  arrow. No counts, service rules or filtering criteria were changed.
  TypeScript, targeted ESLint, diff checks and the full 50-route production
  build pass. Local visual verification reached the expected authenticated
  login boundary, so no login was bypassed.

- **Email Drafts' Company column now matches the typography used by Active
  Client, Billing and AR.** Company names inherit the application font and use
  the standard 14px/700 list-row treatment instead of the previous unusually
  small 11.5px/800 combination. No campaign, recipient or draft behaviour was
  changed. TypeScript, targeted ESLint, diff checks and the full 50-route
  production build pass.

- **Active Client's List view now uses the same unmistakable clickable-row
  design as Billing and AR.** Desktop rows have a persistent right-chevron,
  move the row number beside the company name, use a status-coloured left
  border, and show a blue highlighted outline on hover or keyboard focus.
  A footer explains that clicking any row opens the full company details and
  edit modal. Enter and Space now open the selected row as well, while the
  existing mobile chevron and modal behaviour remain unchanged. TypeScript,
  changed-file lint (with the component's pre-existing effect/unused rules
  excluded), diff checks and the full 50-route production build pass.

- **Client Communications History can now review and reopen prepared Outlook
  drafts.** Every activity row has a `View` action that opens the saved sender,
  To, CC, user name, subject, full body, invoice references, amounts and status.
  Pending/opened records can be reopened as a complete Outlook draft with the
  QuickBooks invoice PDF rebuilt and attached; local/manual attachments must be
  selected again because browsers cannot retain local file access. Older
  campaigns that did not save a sender can use the configured default sender
  from the modal. Staff can also explicitly mark a record as sent or skip it,
  with optimistic version checks preventing silent concurrent overwrites.
  Reopening never sends the email automatically. TypeScript, targeted ESLint,
  diff checks and the full 50-route production build pass.

- **Client Communications now follows the familiar BULK Excel workflow in one
  `Email Drafts` workbench** instead of splitting preparation and review across
  several screens. Staff choose AR Renewal / SOA / Document Letter, template,
  FYE period and the real Outlook sender account; then review one spreadsheet-
  style row per company (Draft, Company, User Name, To, CC, invoice/files,
  amount and readiness), add missing companies/files, and open the selected
  rows as fully populated Outlook drafts in one batch. Nothing is sent
  automatically: Outlook remains the final review and send control. The helper
  now assigns the selected `SendUsingAccount`, supports common and per-company
  attachments, prepares invoice PDFs with bounded concurrency, and opens large
  batches in groups of ten. Draft state now distinguishes `pending` from
  `opened`, while `sent` remains an explicit staff confirmation. The former
  Draft Review route redirects to the new workbench; navigation now shows only
  Email Drafts and History, with Templates & Senders available from Settings.
  Recipient rules also exclude both Cindy aliases, always CC Hoe Chyi, and
  remove Seng Xin when Kah Ye is present. Production build, TypeScript and
  recipient tests pass. Before deployment, run
  `scripts/simplify-client-communications.sql` in Supabase; the updated Windows
  helper binary is `public/downloads/TassureDraftHelper.exe`.

- **Billing Drafts modal header now reproduces `ARDetailModal`'s exact
  markup**, not just its colors. Vincent pasted the real DevTools output
  of AR's header showing a two-row structure (name+close row, then a
  UEN-chip-and-vertical-bar-divider row) and pointed out the divider
  between UEN/FYE/etc. is a `|`-style 1px vertical bar
  (`background: rgba(255,255,255,0.2)`), not the `·` middot text
  separator the previous fix (color/spacing only) still used. Restructured
  to match exactly: row 1 = company name + close button
  (`justify-content: space-between`, `marginBottom: 8`); row 2 = UEN
  rendered as its own pill (`background: rgba(255,255,255,0.08)`,
  `padding: 2px 6px`, `borderRadius: 4`) separated from "FYE {month}" and
  "Build & generate invoice" by real vertical-bar dividers; also added the
  urgency-colored `borderLeft: 4px solid ${accent}` the real modal has
  (computed the same way the table row's own accent already is). Production
  build passes; committed locally, pushed.

- **AR Reminder List's Due Date badges now explain themselves**
  (`app/billing/page.tsx`, `DueBadge` — used by AR Reminder List's row
  cells, its mobile card, and `ARDetailModal`'s header). Vincent's
  screenshot showed a column of "Filed"/"160d left" pills with no
  indication of what they meant. Added a `title` (native hover tooltip) to
  every badge state explaining it in a full sentence (e.g. "160 day(s)
  remain until the Annual Return filing deadline for this FYE cycle."),
  plus a small "?" info icon next to the List view's "Due Date" column
  header with a tooltip summarizing all three states at once (Filed /
  "Xd left" / "Xd overdue") for anyone who wants the full picture without
  hovering each row. Production build passes; committed locally, pushed.

- **Billing Drafts modal header now matches AR modal's chrome**
  (`app/billing/page.tsx`, the "Build & generate invoice" modal opened from
  the Billing Drafts table). Per Vincent's screenshot: removed the leading
  `$` `DollarSign` icon (same "no decorative icon" preference already
  applied to the AR/Active Client modal earlier this session), added an
  8px gap between the company name and the UEN/FYE line (was touching,
  no spacing), and changed that UEN/FYE line from light blue (`#93c5fd`)
  to white (`#fff`) — mirroring `ARDetailModal`'s own header exactly
  (`marginBottom: 8` between name and UEN row; UEN/FYE text `color: '#fff'`),
  per Vincent's explicit "reference the AR page's modal" instruction.
  Production build passes; committed locally, pushed (push to origin main
  is now pre-authorized for this repo per Vincent's instruction — see
  `feedback_tassure_invoice_push` memory and this repo's own `CLAUDE.md`).

- **Fixed the real bug behind the cross-cycle search "still doesn't work"
  report**: Vincent tested with "AI APEX" and its UEN "202436415C" (same
  company, `AI APEX FOUNDATION LTD.`, FYE June) and got
  "undefined has no FYE month on file" instead of a switch to June. Root
  cause, found by re-reading `/api/companies/route.ts` end to end instead
  of guessing again: its response shape is camelCase (`companyName`,
  `registrationNo`, etc.) — I had written `useCrossCycleSearch`
  (`app/billing/page.tsx`) assuming snake_case (`company_name`), so
  `match.companyName` was always `undefined`. Worse, `fye_month` wasn't
  even in the response's field projection at all (the route selects
  `company.*` from Supabase but only re-maps a subset of fields into its
  `enriched` response object) — so the switch could never have worked
  regardless of the naming fix. Fixed both: added `fyeMonth: c.fye_month`
  to the route's projection, and corrected the client-side field names to
  `companyName`/`fyeMonth`. Verified directly against the real data (this
  specific company/UEN resolves to `fye_month: "June"`) before shipping.
  The previous two "fixes" in this thread (auto-switch, then filter-reset)
  were real improvements but neither addressed this — this was the actual
  blocker. Production build passes; committed locally only, not yet pushed.

- **Billing Drafts + AR Reminder List: shared cross-cycle search, now with
  UEN** (`app/billing/page.tsx`). Vincent reported the earlier Billing
  Drafts-only cross-month auto-switch (previous entry below) still wasn't
  finding companies in other months, and asked for the same capability on
  AR Reminder List too, plus UEN as a searchable field on both. Likely root
  cause of the original miss: the auto-switch correctly changed the FYE
  month, but the *other* active filter (status filter on Billing Drafts;
  status/column filters on AR Reminder List) could still hide the
  newly-loaded company, making it look like nothing happened. Extracted
  the escalation logic into one shared `useCrossCycleSearch` hook (defined
  once, used by both `BillingTab` and `ARTab`): local search now checks
  company name OR UEN; when that comes up empty, it escalates to
  `/api/companies?search=` (already matches both `company_name` and
  `registration_no`/UEN server-side) and, if found, switches the month
  selector to that company's real FYE month — **and now also resets the
  tab's own status/column filters back to 'all'/cleared** so the found
  company can't stay hidden behind an unrelated filter. Both pages' search
  placeholders updated to mention UEN. Production build passes; committed
  locally only, not yet pushed.

- **AR1/AR2/AR3 email templates rewritten to match the real legacy wording**
  (Supabase `email_templates` table, ids 1/4/5 — a direct data fix, not a
  code change). Vincent asked to confirm the three AR templates
  ("AR1 - Standard Renewal", "AR2 - Multi-Invoice Renewal",
  "AR3 - Renewal (Batch)" — pre-existing rows from an earlier session, not
  created by this one) actually matched the real desktop docx files
  (`AR-AUTO EMAIL.docx`, `AR2-auto email.docx`, `AR3.docx`, read in full
  earlier this session). They didn't: all three had generic one-line
  English-only placeholder bodies, and AR3's body was byte-for-byte
  identical to AR1's — none of the real bilingual EN/CN wording, the
  distinct tone per template (AR1 = service already ended, AR2 = multiple
  invoices + other outstanding statements, AR3 = advance/pre-emptive
  billing — confirmed genuinely different in the source docs), or the
  `PAYMENT METHOD付款方式:` sign-off line. Rewrote all three
  subject/body_template fields to faithfully port the real wording, mapping
  the legacy `<User Name>`/`<Company Name>`/`<AMOUNT>`/`<INV[...]>`
  placeholders onto the existing merge engine's `{{contactName}}`/
  `{{companyName}}`/`{{totalAmount}}`/`{{invoiceList}}` fields. One
  deliberate structural adaptation (flagged to Vincent, not silently
  assumed): the legacy docs embed the invoice number inline mid-sentence
  ("invoice TAB<INV>"); the current merge model always renders
  `{{invoiceList}}` as a block (one line per matched invoice, needed since
  a company can have 1-3+ invoices), so sentences were reworded to
  introduce the block ("...enclosed herewith our service renewal
  invoice(s) below:\n\n{{invoiceList}}") rather than force an inline
  substitution. Also renamed id 5 to "AR3 - Advance Renewal Notice" for
  clarity, since "(Batch)" didn't describe what actually distinguishes it.
  Applied directly via the Supabase REST API (`scripts` were run ad hoc,
  not committed) after Vincent explicitly confirmed writing straight to
  production. Any future edits to wording should happen in the Templates
  & Senders page (`app/client-communications/templates/page.tsx`), which
  already supports inline editing of these fields.

- **Billing Drafts search now crosses FYE months** (`app/billing/page.tsx`,
  `BillingTab`). The table's company list is scoped to whichever FYE
  month/year is selected (each company has one fixed FYE month, and billing
  math/invoice matching is computed against that specific cycle) — so
  searching for a company outside the current month/year previously just
  showed "no matching records" with no explanation. Vincent asked whether
  search could find any company regardless of month; confirmed via a direct
  question that the desired behaviour is auto-switching the month selector
  to that company's real FYE month (not a flat, cycle-blind company list,
  which would show inaccurate numbers). Now: when the local search comes up
  empty, a debounced (400ms) escalation queries `/api/companies?search=`
  (company-wide, no FYE filter) — if found, the month selector jumps to
  that company's actual `fye_month` (year unchanged) and a small blue notice
  explains the switch; if genuinely not found, the notice says so instead
  of a silent empty table. Implemented with `monthCompaniesRef`/`monthRef`
  refs so the debounce effect only re-runs on search-text changes, not on
  every re-render of the (now up-to-date) company list — avoids a
  notice-flicker/re-trigger loop. Production build passes; committed
  locally only.

- **Billing Drafts: one-click "Email Drafts" button per row**
  (`app/billing/page.tsx`, `BillingTab`'s main table — the `tab=billing`
  view). Vincent wanted the Campaign Centre wizard skippable for the common
  single-company case: an envelope icon now sits in a new column right of
  PIC; clicking it opens a small popover (mirrors `ARColumnFilterMenu`'s
  positioning/click-outside pattern) to pick an AR template and hit "Draft"
  — no campaign setup, no review screen, no separate Drafts-page visit.
  Under the hood it reuses existing Client Communications infrastructure
  end-to-end rather than duplicating logic: `GET
  /api/client-communications/campaigns/preview?lookup=...&type=ar` for the
  same recipient/invoice resolution Campaign Centre uses, `GET
  .../templates?type=ar` for the picker, `mergeTemplate`/`formatInvoiceList`/
  `formatAmount` (`lib/email-merge.ts`) for the merge, then `POST
  .../campaigns` to actually persist a (single-row) campaign + draft — so
  it still shows up in Delivery History like every other draft, just
  without the multi-step review first. Opening in Outlook reuses the
  Draft Helper from the change above (`openDraftsInOutlook`) when detected,
  falling back to a new shared `buildMailtoLink()` export in
  `lib/draft-helper-client.ts` otherwise (extracted from the same logic
  already in `drafts/page.tsx`, not duplicated by hand). Deliberately does
  NOT block when `ResolvedRow.included` is false for soft reasons (already
  sent this cycle, recipient needs review) — only a genuinely missing
  `toEmail` stops it — since this is a manual, deliberate, single-company
  action where the person clicking already has full context, unlike a
  blind 40-company batch. Production build passes; committed locally only.

- **Client Communications: local "Tassure Draft Helper" companion app**,
  closing the gap vs. the legacy `BULK.xlsm` VBA workflow (read in full this
  session, including the `Start_Email` macro) where one click opened ~40
  pre-filled Outlook drafts with matching invoice PDFs already attached —
  something a browser-sandboxed web page cannot do directly (no COM access
  to the user's local Outlook). Built a separate small Windows app at
  `C:\Users\vincent\tassure-draft-helper\` (Python + `pywin32`, packaged as
  a single PyInstaller onefile exe — no installer; it self-registers into
  `HKCU\...\Run` on first launch via `main.py::_register_for_startup`, so
  "download once, run once" is the entire install step, matching the
  already-proven Tassure Proposal Generator distribution model). It serves
  `http://127.0.0.1:51820` (localhost-only, CORS-restricted to the known
  app origins): `GET /health` for detection, `POST /drafts/open` which
  creates real Outlook `MailItem`s via COM and calls `.Display()` only
  (never `.Send()` — a human still reviews/sends every email, unchanged
  from the existing design). The built exe is committed at
  `tassure-invoice/public/downloads/TassureDraftHelper.exe` (~35MB — worth
  knowing this add a real binary to the git history and Vercel's static
  assets, flagged for Vincent rather than assumed fine).
  On the web side, new `lib/draft-helper-client.ts` (`checkHelperHealth`,
  `openDraftsInOutlook` — reuses the existing `/api/quickbooks/invoice-pdf`
  route and `invoicePdfFileName()` exactly like the page's existing
  `downloadEml` already does) and `app/client-communications/drafts/page.tsx`
  gained: a dismissible banner + download link when the helper isn't
  detected, a per-draft "Open in Outlook (with attachment)" button, and a
  batch "Open All Pending in Outlook (N)" action — all additive; the
  existing mailto:/.eml buttons are untouched, per Vincent's explicit
  choice, so nothing breaks for staff who haven't installed the helper.
  TAO-book invoices remain unsupported (same pre-existing gap as today's
  PDF download) — explicitly deferred, not fixed here, per Vincent's
  choice. Verified: helper's `/health` + CORS behavior tested directly via
  curl against the running exe (allowed origins get the CORS header,
  others don't); self-registration into the Startup key confirmed via the
  registry, then cleaned up since it pointed at a dev-build path. Full
  plan at `C:\Users\vincent\.claude\plans\atomic-wandering-locket.md`.
  Production build passes; committed locally only, not yet pushed (repo
  policy — ask before pushing/deploying).

- **Add Manual/Edit modal date fields no longer locale-dependent.** AR
  Reminder's Add Manual Due Date field and Late Filing's 4 modal date
  fields (Last AR/AGM/Accounts Date, Next AGM Due) were plain
  `<input type="date">`, so the visible placeholder/format followed the
  browser/OS locale — showed Chinese `年/月/日` on Vincent's machine
  instead of an English format. Replaced with a new `AddManualDateField`
  component (`app/billing/page.tsx`) / `DateField` component
  (`app/late-filing/page.tsx`), each showing a "D MMM YYYY" text field
  (e.g. `30 Sep 2021`) with a calendar icon button that opens a hidden
  (opacity 0, zero-size) native `<input type="date">` purely to invoke the
  browser's picker via `showPicker()` — the native input itself is never
  rendered, so its locale text never appears. Typing directly into the
  text field is also supported, parsed via `lib/date.ts`'s
  `toIsoDateValue`/`toDisplayDate` (same helpers AR's own `EditField`
  already uses for its date columns) with invalid input reverting to the
  last known-good display on blur. The canonical value held in
  state/sent to the API is unchanged — still ISO `yyyy-mm-dd` — so no
  API/DB changes were needed. Production build passes; not yet pushed.

- **Add Manual modal field-behavior polish** (AR Reminder, Late Filing,
  Master List): Company Name and UEN inputs in AR Reminder's Add Manual
  Entry modal (`app/billing/page.tsx`) and Late Filing's unified Add/Edit
  modal (`app/late-filing/page.tsx`, shared between creating new rows and
  editing existing ones) now uppercase on every keystroke — AR's own
  `ARDetailModal`/`EditField` (editing an existing entry's fields inline)
  was deliberately left untouched, scoped to the Add Manual entry points
  only per Vincent's clarification. Master List's Add Manual modal FYE
  field (`components/MasterListTable.tsx`) changed from a free-text input
  with on-blur normalization to a real `<select>` labeled "FYE Month",
  reusing the existing `MONTH3_ABBR` constant as its options — mirrors
  Late Filing's already-existing FYE Month dropdown pattern. The now-dead
  `normalizeFyeInput()` helper was removed (only consumer was the removed
  on-blur handler). Production build passes; not yet pushed/deployed.

- **Campaign Centre now has one TeamWork-backed recipient policy for all three
  campaign types** (AR Renewal, SOA and Document Reminder). The daily
  TeamWork Companies automation also reads Report → Reminder Upcoming To Be
  Sent → Recipients, groups the rows by company, and stores external customer
  addresses separately from Tassure internal addresses. The canonical rules
  live in `lib/campaign-recipients.ts`: external addresses → To, Tassure/
  Tasure domains → CC, exclude `cindy@tassure.com`, always add
  `hoechyi@tassure.com`, and remove `sengxin@tassure.com` whenever
  `kahye@tassure.com` is present. Campaign preview renders To/CC as multiline
  textareas (one address per line) with a TeamWork/fallback source badge;
  fallback or missing Report records start unchecked for human confirmation.
  Draft creation normalizes and validates the final reviewer-edited lists,
  and Outlook mailto generation now accepts newline-separated recipients.
  Added idempotent migration `scripts/add-teamwork-campaign-recipients.sql`
  and rule tests (`npm run test:campaign-recipients`). Verified against the
  live TeamWork report: 476 rows, 352 with external To, 124 without external
  To (held for review), 42 Kah Ye/Seng Xin cases correctly suppress Seng Xin,
  Hoe Chyi present in every computed CC list. Production build passes. The
  migration must be run before this code is deployed and the first TeamWork
  sync/backfill is triggered.

- **Follow-up on the Active Client detail modal, from Vincent's first-look
  feedback** (screenshot of the real modal): (1) long values — addresses,
  remarks — were clipped behind a single-line input with no way to see the
  full text; `ModalField` now renders an auto-resizing textarea instead.
  (2) Nominee Dir./Secretary checkboxes were purely derived from "does the
  name field have text", not something staff could set independently;
  (3) ACC/TAX were read-only, showing only AR Reminder's synced PIC.
  Asked Vincent where ACC/TAX's data should live once editable before
  building — confirmed: default to AR Reminder's value, but let Master
  List override it once someone edits it here. Added
  `master_list.nd_active/secretary_active/acc_active/tax_active` (freely
  toggleable, independent of any name field — new `CheckSquare` accepts an
  optional `onToggle`) and `acc_pic_override`/`tax_pic_override` (take
  precedence over AR Reminder's value in `/api/master-list`'s GET once
  set — `r.acc_pic_override?.trim() || arDerivedValue`). Editing ACC/TAX's
  name reloads from the server afterwards rather than hand-rolling the
  override-vs-AR-Reminder resolution client-side, so the displayed value
  can never drift from real DB state. `scripts/add-master-list-service-
  toggles.sql` backfills the four boolean columns from today's existing
  derived state (isSet(text) for ND/Secretary, AR Reminder presence for
  ACC/TAX) so nothing visually changed until someone manually re-toggles
  it — confirmed live after Vincent ran it (e.g. YINDA PTE. LTD. correctly
  came back with secretary/acc/tax all true).
- **Two Master List feature additions to `components/MasterListTable.tsx`**,
  both requested together by Vincent, scoped differently on purpose (asked
  explicitly before building — see the two AskUserQuestion confirmations
  in this session's history):
  - **Excel-style column filters, all 6 Master List pages.** Every column
    header gets a funnel icon; clicking it opens a checkbox dropdown of
    every distinct value in that column (with per-value counts, a search
    box, Select All / Clear, OK/Cancel) — true Excel AutoFilter
    interaction, per Vincent's explicit choice over a plain text-search
    box. Deliberate simplification: the value list is computed from the
    full loaded row set, not re-narrowed by other active filters
    (non-cascading) — flagged as a scope cut, not an oversight. Combines
    with the search box and category cards via AND. State:
    `columnFilters: Partial<Record<ColumnField, Set<string>>>`; an empty
    entry is never stored (removing the last unchecked box collapses back
    to "no filter" via `applyColumnFilter`), so newly-synced values in a
    column can never be silently hidden by a stale filter.
  - **Active Client "List" view + detail modal**, opt-in via a new
    `enableListView` prop (`false` by default — every other Master List
    page unaffected). Mirrors AR Reminder's existing List/Table pattern:
    a toggle next to the search bar, List as the default view, each row
    company name/ROC/status/ND·SEC·ACC·TAX checkboxes/FYE, click opens
    `CompanyDetailModal` — every field the page's `fields` prop resolves
    to (respects Active Client's already-reduced field set, not the full
    `MasterListRow` universe), grouped into fixed sections (Company Info /
    Contact & Address / Services / Compliance / Admin / Notes) via a
    `FIELD_SECTIONS` lookup with an "Other" fallback for anything
    unmapped — a deliberate degrade-gracefully choice in case this prop is
    ever turned on for a page with a different field mix later. Edits
    save through the exact same `/api/master-list` PATCH + optimistic
    `handleSave` the table's inline `EditCell` already uses, so a change
    made in the modal is reflected in the table (and vice versa)
    immediately, no separate sync step.
- **Fixed the TeamWork sync's real client-detection bug** (`app/api/teamwork/sync/route.ts`),
  reported by Vincent as two symptoms that turned out to share one root
  cause: Master List → Active Client's "Non-TeamWork" filter was flagging
  genuine clients, and the Companies page had no way to exclude Shareholder/
  related entities that Vincent said shouldn't be there.
  - Diagnosed by calling TeamWork's own `getCompanies` API directly (not our
    stale Supabase mirror) and diffing raw fields between a known real
    client and a known Shareholder ("1X EXCHANGE PSS LIMITED"). The `client`
    field our insert filter relied on (`client==='1' && status==='Active'`)
    is NOT reliable — BIC Systems Asia Pacific, Blue Eagle Supply Chain,
    Benfold Shipping, Billiongold Marine, Bistro Bugis, Care Property
    Holdings, and 26 others are all genuinely Active clients with a proper
    `client_id` (CB003, CB025, ...) yet carry `client="0"`. The field that
    actually distinguishes a real client from a Shareholder/related entity
    is `non_client` (confirmed against every example checked). Why `client`
    is unreliable is still unconfirmed (Vincent's own theory: different
    `client_id` prefixes — C8xxx vs CBxxx/CCxxx — suggest two onboarding
    batches, and the flag may only have been maintained for the older one).
  - Added `companies.is_non_client boolean default false`
    (`scripts/add-companies-non-client-flag.sql`, run by Vincent). Sync now
    uses `non_client !== '1'` for the insert filter and keeps
    `is_non_client` unconditionally up to date on every matched row
    (unlike the other TeamWork-sourced fields, which only overwrite on a
    non-empty value — this one should always reflect current truth).
    `/api/companies` now filters `.eq('is_non_client', false)`.
  - Verified end-to-end after deploying and running a fresh sync: Active
    Client's false "Non-TeamWork" flags dropped from 21 to 1 (the one
    remaining, BYTESFORCE TECHNOLOGIES PTE. LTD., is a genuinely different
    case — it already exists in `companies` but TeamWork's own `non_client`
    flags IT as a Shareholder; needs Vincent to confirm with TeamWork
    whether that classification or the master_list entry is wrong, not a
    code bug). 32 previously-missing real clients got inserted in that
    sync. Companies table: 930 total, 12 correctly flagged
    `is_non_client=true` (listed to Vincent for a sanity check; not yet
    confirmed as of this entry — BYTESFORCE TECHNOLOGIES, ENGAREAT, FIRE
    ROCK HOLDINGS, NORTHWEST INTERIOR DESIGN, PRIMATECH, Q & E ENERGY
    EFFICIENT, REZNOS DESIGN, SICHUAN BAIJIA AKUAN FOOD, TAFOS CAPITAL,
    World Precision Machinery, ZJJ FAMILY OFFICE, ZTT HONGKONG).
  - Also fixed one unrelated data-entry bug found while investigating: a
    trailing `)` in master_list's ROCKFOREST HOLDINGS PTE. LTD. roc_no
    (`202552132E)`) broke its UEN match to `companies` — corrected directly
    in Supabase.
- **Diagnosed and manually unblocked a stale invoice-number reservation**
  for JZ.M SHIPPING PTE. LTD. (TAB). Vincent's real workflow: generate an
  invoice → find an error in it → delete it directly in QuickBooks → try
  to recreate it with the same DocNumber → blocked. The blocker was NOT
  QuickBooks itself and NOT a live numbering race — it's
  `invoice_creation_reservations`, a table with a partial unique index on
  `(qb_company, doc_number) WHERE status IN ('pending','created',
  'uncertain')` that exists to stop two staff from creating the same
  invoice number at once. Deleting an invoice directly in QuickBooks (vs.
  through this app) never updates that table, so the OLD `status=
  'created'` row keeps blocking reuse of that exact number forever — every
  retry hits the same generic "Invoice number changed in QuickBooks" 409
  with no useful detail, because the code path that fires here
  (`reservationError` on insert conflict, `app/api/quickbooks/create-
  invoice/route.ts` ~line 459) returns `numberConflict:true` without
  populating `conflicts`/`nextNumbers` — refreshing the number front-end
  never helps because the real problem is a DB row, not the QB API.
  Confirmed live via QuickBooks' own API before touching anything: TAB
  invoice #21209 (doc 02610876) returned `400 Object Not Found` (genuinely
  deleted); TAC invoice #3826 (doc 02680242, the ND line) returned `200`
  (still live — left untouched). Updated only the TAB reservation row's
  `status` to `'failed'` with an explanatory `error` note, which removes it
  from the partial index's blocking set. **Vincent asked to keep this as a
  manual per-incident fix (report to Claude Code, verify via live QB API,
  update the stale row) rather than building automatic detection or a
  self-serve "release" button** — revisit only if this starts happening
  often enough to be worth automating.
- **Superseded the entry below** ("Services" badge column) after Vincent
  saw it live and reconsidered the design, and — separately — pointed out
  a real bug in it: the combined 6-badge column had been added to
  `MasterListTable`'s shared default `COLUMNS` array, so it silently
  leaked onto Strike Off/Terminated/Change Co Name too (any page that
  doesn't pass an explicit `fields` prop shows every column in that
  default array — adding a column there makes it appear everywhere,
  not just the page it was built for). Replaced it with four separate
  columns, Active-Client-only:
  - **Nominee Dir. / Secretary**: still the existing `master_list`
    columns, now rendered with a green/grey checkbox next to the name
    instead of plain text — gated on `listType === 'active_client'` in
    `MasterListTable.tsx`, so every other page keeps the old plain-text
    rendering of these same two columns unchanged.
  - **ACC / TAX**: new columns, sourced from `ar_reminder.acc_pic`/
    `tax_pic`, joined by UEN in `/api/master-list` (identical exact-match
    pattern to the existing `tw_fye`/`in_teamwork` cross-check). These
    live in a new `EXTRA_COLUMNS` array that is deliberately NOT part of
    the default `COLUMNS` set — a page must name them in its `fields`
    prop to show them, which structurally prevents this exact class of
    leak from recurring for any future derived column.
  - Verified against live data before shipping: ALTSTAKE PTE. LTD.
    resolves to `acc=JAY, tax=QT`, matching its AR Reminder detail panel
    exactly. Sampled 300 Active Client rows: ~20% currently have an ACC/
    TAX PIC in `ar_reminder` at all — the rest will show the grey/empty
    state, which reflects that data not being filled in yet on the AR
    Reminder side, not a bug here.
  - Also reverted the `companies.uses_address/has_nd/has_xbrl` join added
    for the old design (unused now — ADDR/XBRL were dropped from this
    view entirely per Vincent's decision, not carried over to the new
    columns).
- Added a "Services" badge column (SEC/ADDR/ND/ACC/TAX/XBRL) to Master List
  → Active Client, at Vincent's request ("Active Client 第一版采用 SEC /
  ADDR / ND / ACC / TAX / XBRL"). The hand-maintained `master_list` sheet
  has no clean boolean for address/ND/XBRL subscription — only `companies`
  (TeamWork-synced) does — so before implementing, confirmed the data
  source split with Vincent rather than guessing: **ADDR/ND/XBRL** read
  `companies.uses_address/has_nd/has_xbrl`, joined by UEN in
  `/api/master-list` (same pattern as the existing `tw_fye`/`in_teamwork`
  cross-check — extend that same join, don't add a second one).
  **SEC/ACC/TAX** have no such source anywhere, so they read whether the
  matching `master_list` column (`secretary`/`ac`/`corporate_tax`) has any
  value at all, reusing the existing `isSet()` helper (now lifted to
  module scope in `components/MasterListTable.tsx` so both the category
  filter cards and the new badges share it). This is an explicit v1 proxy,
  not a true subscription flag — sampled live data before shipping:
  `secretary` is reliably filled (staff names), but `ac`/`corporate_tax`
  were null on every sampled row, so ACC/TAX will read mostly "off" for
  now purely because that data isn't populated yet, not because of a bug.
  `services` is a derived, non-editable pseudo-column (`ColumnField` type
  extended to include the literal `'services'` alongside real
  `MasterListRow` keys) — clicking a badge does nothing, unlike every
  other cell which is click-to-edit.
- Fixed `/api/ar-reminder/latest` (drives which FYE cycle Billing Drafts /
  AR Reminder open to by default). It picked the max `(fye_year,
  fye_month)` pair present in `ar_reminder`, which tracks how far AR
  Generate's 6-month rolling window has reached — usually a future cycle
  with zero invoices yet, not the cycle staff are actually working. Now
  defaults to the `fye_month`/`fye_year` of the most recently created
  `generated_invoices` row (falls back to the old logic, then January of
  the current year, if no invoices exist yet). Verified against live data
  before shipping: the newest `generated_invoices` row was FYE May 2026
  (created 2026-07-17), matching what Vincent's screenshot showed as the
  page's current default.
- Shifted all six `vercel.json` cron schedules 3 hours earlier at Vincent's
  request (same 30-min spacing/order preserved): ND 21:00 UTC (05:00 SGT),
  Companies 21:30, AR Generate 22:00, QuickBooks 22:30, AR Workflow 23:00,
  Late Filing 00:00 UTC next day (08:00 SGT). Deployed 2026-07-20; since the
  new AR Generate/AR Workflow/Late Filing trigger times had already passed
  by deploy time, those three skipped their run that day (Vercel cron does
  not backfill missed times). Backfilled manually the same day once
  `CRON_SECRET` was working end-to-end (see below) — AR Generate: 3
  inserted; AR Workflow: 740 rows checked, 2 unmatched names, 0 conflicts;
  Late Filing: 878 companies checked, 39 flagged, 36 refreshed. No action
  needed for the schedule itself going forward — tomorrow's run fires at
  the new times normally.
- Rotated `CRON_SECRET` (Vincent asked what access would let Claude Code
  trigger automation endpoints directly instead of hitting a "no session /
  no secret" wall; couldn't locate the old value in Vercel to hand over,
  so generated a fresh one instead). Saved locally in `.env.local` (not
  committed, per this file's standing rule — see CLAUDE.md); Vincent set
  the matching value in Vercel → Settings → Environment Variables and
  redeployed. **Gotcha hit while verifying, worth remembering**: the first
  three `curl` tests against production kept 401ing even after Vincent
  confirmed the Vercel value matched byte-for-byte — turned out the local
  shell's working directory had silently drifted to `C:\Users\vincent`
  (home) between commands, so `.env.local` was being read from an
  unrelated project there (one with no `CRON_SECRET` at all), not
  `tassure-invoice`'s real one. Always `cd` to the repo root (or use an
  absolute path) immediately before reading `.env.local` in a script or
  `source` command — don't assume the shell's cwd persisted correctly
  across an unrelated tool call earlier in the session. Confirmed working
  after fixing the path: `curl -H "Authorization: Bearer $CRON_SECRET"
  https://tassure-corporate-services.vercel.app/api/<cron-path>` returns
  200 with the real job result. `ar-reminder/sync-workflow` and
  `late-filing/sync` can take 2-5 minutes (concurrent TeamWork fetches) -
  give `curl --max-time 320` or longer, a client-side timeout around
  60-90s will kill the connection while the server keeps working, which
  looks like a failure but isn't.
- Auto-grew the Templates & Senders body textarea to fit its content
  (`rows` now derived from line count, min 6) instead of a fixed 6 rows
  that clipped longer templates behind an internal scrollbar.
- Fixed the letter default template's `name` having "(default)" baked
  into the literal string, which combined with Campaign Centre's own
  `{t.is_default ? ' (default)' : ''}` dropdown suffix to render
  "Document Reminder (default) (default)". Renamed the live row (id 3)
  directly in Supabase to just "Document Reminder" via a one-off script
  (run and deleted, not committed), and changed the seed literal in
  `scripts/add-client-communications.sql` (letter row only) so a fresh
  install won't reintroduce it. Deliberately did NOT touch the `ar`/`soa`
  seed literals ("AR Renewal Reminder (default)" / "Statement of Account
  (default)") even though they have the same baked-in suffix — those
  exact strings are the `WHERE name = '...'` match condition in
  `scripts/split-templates-by-sheet.sql`'s AR1/SOA1 rename step, so
  changing them would silently break that script's match on a fresh
  install (0 rows updated, template stuck with the generic name). No
  such downstream script touches the letter template, so it was safe to
  rename outright.
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
- Fixed "Next AGM Due Date" picking an ancient, already-superseded unheld AGM/AR
  cycle instead of the genuinely current one (TeamWork's own historical data
  sometimes leaves an old cycle's Held/Filing Date blank even though every
  cycle since has a real completion date). Applied a two-pass fix — find the
  latest genuinely-completed cycle's FYE first, then only consider unheld
  cycles after it — in `ar-reminder/sync-workflow`, `late-filing/sync`, and the
  standalone `scripts/backfill-late-filing-details.js`. 181 rows corrected.
- Removed FYE-mirroring from `sync-workflow` back to `master_list.fye`, and
  removed `'fye'` from `AUTO_SYNCED_FIELDS`/`LIVE_COMPARISON_FIELDS`/
  `AUTO_SYNCED_FIELDS_UI`. FYE is now purely staff-editable on Active Client;
  previously-automated values are preserved untouched. CODE/EMAIL automation
  is unaffected.
- Hidden the Email and Tel columns across all Master List pages (data and
  automation untouched, just removed from the shared `COLUMNS` array and each
  page's explicit `fields` list) — restorable later if needed.
- Late Filing page: replaced the per-row delete action with a universal "mark
  as resolved" checkmark; resolved rows are now excluded from the default/ALL
  view (not just the "Total Late Filers" count); Struck Off/Terminated
  companies are excluded from the page entirely regardless of historical
  ar_reminder data.
- Fixed AR Reminder/Billing tab's default-cycle selection (`ar-reminder/latest`)
  picking whichever invoice was most recently created instead of the
  representative current month; now uses the mode of the last 30 invoices.
- Fixed Master List "Missing from Active Client" / TW client-count mismatch by
  requiring `is_active = true` in both counts; added an "Inactive in TeamWork"
  exception panel.
- Fixed AR Reminder `generate` catch-up pass missing legacy null-`company_id`
  rows (caused 22 real duplicate `ar_reminder` rows) and calendar-based
  year-guessing producing wrong fye_year for newly-incorporated companies; both
  now verified against live TeamWork data instead of guessed. Also fixed
  `due_date` being read from TeamWork's own AGM/AR "due" column (off by one
  month vs. AR) — now always computed as FYE + 7 months.
- Fixed both Master List and AR Reminder tables losing horizontal scroll
  position when expanding/collapsing a collapsible column (Status; SEC/ACC/TAX
  PIC) — scrollLeft is now saved before toggle and restored via
  `useLayoutEffect`.
- Added `minHeight: 400` to AR Reminder's table scroll container to match
  Master List's table.
- Fixed a CSS bug where table cell text (e.g. dates) could collapse into one
  character per line when squeezed by an adjacent mismatch warning badge
  (`table-layout: fixed` + flex child's implicit `min-width: auto`). Fixed via
  `whiteSpace: nowrap` + `overflow: hidden` + `textOverflow: ellipsis` +
  `minWidth: 0` on the value span, and `minWidth: 0` on all mismatch-badge
  wrapper containers.
