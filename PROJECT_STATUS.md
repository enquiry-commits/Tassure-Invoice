# TASSURE Invoice - Shared Project Status

Last updated: 2026-08-06 (Fixed Active Client's Secretary checkbox drifting out of sync with whether the Secretary cell actually has a name in it — Vincent, looking at the newly-added companies: "这个secretary, 有内容就需要打勾啊，没有打勾就是没有内容的意思，但是现在你有内容有些却没有打勾，那个打勾只是为了让我方便辨认那些是有内容的." Measured the real scope first rather than assuming it was just the 15 new rows: 30 of 794 active_client rows had secretary text but secretary_active=false/null, including a genuinely pre-existing one unrelated to today's work (ACG INTERIOR AND EXHIBITION PTE. LTD.) — confirming this is a real, general gap, not something introduced today. Root cause: unlike nd_active/acc_active/tax_active (genuine independent "is this service currently subscribed" flags, with nd_active specifically driven by real nd_appointments state), secretary_active has never had any automation writer at all — a grep confirmed the only way it's ever set is a manual checkbox click, completely decoupled from whatever the secretary text field says. Per Vincent's stated intent, Secretary's checkbox isn't a business-status flag, it's purely a visual "does this cell have content" indicator for scanning the table — so it must always equal `!!secretary`, never an independent state. Fixed at both write paths: app/api/master-list/route.ts's PATCH now sets `secretary_active: stored !== null` in the same update whenever `field === 'secretary'` is manually edited; app/api/teamwork/sync-secretary/route.ts now sets `secretary_active: true` alongside `secretary` whenever it writes a real name from TeamWork. Also removed the ability for it to independently drift again: ServiceChip's `onToggleActive` prop is now optional (mirrors CheckSquare's existing pattern), and the Secretary checkbox specifically (Table view's plain CheckSquare, and the Modal's ServiceChip via `renderField`) no longer takes a click handler — nd_active/acc_active/tax_active toggles are untouched, this only applies to Secretary. One-time backfill fixed all 30 already-mismatched rows (0 errors, re-verified 0 remaining mismatches after). `npx tsc --noEmit` clean, `npm run build` clean. Vincent tested it live and found the fix was still incomplete: "我特地删了内容，打勾还在，我刷新页面后，打勾才不见，我重新填写内容后，打勾又没有实现打勾回去，意思就是不同步" — the DATABASE write was correct (confirmed by the checkbox eventually catching up on a full page reload), but the CLIENT's optimistic local state wasn't: `handleSave(id, field, val)` (the single shared callback both the Table view's EditCell and the Modal's ServiceChip call through) only ever patched the one field being edited into local React state, with no knowledge that the server was now also deriving secretary_active from that same write — so the checkbox stayed visually stale until the next full refetch. Fixed by mirroring the same derivation client-side: `handleSave` now also sets `secretary_active: !!val` in the same local state update whenever `field === 'secretary'`, so typing or clearing the name updates the checkbox instantly, matching what the server persists, with no refresh needed. `npx tsc --noEmit` clean, `npm run build` clean.)

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
