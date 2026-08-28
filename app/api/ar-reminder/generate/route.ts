import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { loadCarriedForwardPics } from '@/lib/pic-sync';
import { withAutomationRun, replaceAutomationExceptions } from '@/lib/automation-sync';
import { getSessionCookie, fetchAgmList, parseDmy, toIsoDate } from '@/lib/teamwork-agm';
import { toDateStr, addMonths } from '@/lib/date';

/**
 * Auto-generates ar_reminder rows for a rolling 6-month window (current
 * month + next 5), based on each company's fye_month. Due date = FYE date
 * + 7 months (Singapore's standard AR filing deadline — confirmed against
 * existing manually-entered rows, e.g. FYE 2026-04-30 -> due 2026-11-30).
 *
 * Only inserts new (entity_name, fye_month, fye_year) rows — never
 * overwrites existing rows, so manually-tracked workflow fields on
 * existing entries are untouched. Safe to call repeatedly; the window is
 * computed from "today" each time, so it naturally rolls forward.
 *
 * Also runs a one-time-per-company catch-up pass (see below, near
 * `catchUpInserted`) for companies whose fye_month had already rolled out
 * of the forward window before they ever appeared in `companies` — the
 * main loop above is forward-only and would otherwise never backfill them.
 * Deliberately does NOT guess the catch-up year from the calendar (an
 * earlier version of this pass did — "June" plus "today is past June"
 * doesn't mean this year's June cycle exists: a recently-incorporated
 * company's FIRST-EVER cycle can land next year instead, e.g. HUAKO KIDS/
 * HUAKO PHOTO ALPHA/HUAKO PHOTO BETA/ALPHA Z all have fye_month=June but
 * their only real TeamWork cycle is June 2027, not 2026 — confirmed live
 * against TeamWork after Vincent caught 4 of these showing the wrong year.
 * Same root cause as an even earlier manual one-off
 * (scripts/generate-ar-reminder-month.js, run 2026-07-07) that inserted 86
 * "June 2026" rows the same way — 31 of those 141 rows turned out wrong
 * when audited against real TeamWork data). This pass instead fetches each
 * catch-up-eligible company's real AGM/AR history and only inserts when a
 * genuinely open (not yet held/filed) cycle is found, using TeamWork's own
 * year/date for that cycle — never a computed guess.
 *
 * Eligible for catch-up: a company with NO live row at all under its
 * current fye_month — unchanged. Vincent, 2026-08-27, surfaced a related,
 * real gap this does NOT cover: once the forward-window loop above creates
 * a company's upcoming cycle, that month counts as "generated" forever,
 * even if an OLDER cycle was never backfilled — found this way in 20
 * companies, all sharing one FYE (December 2025, genuinely unfiled per
 * TeamWork, overdue since 2026-07-31) sitting invisibly behind an
 * already-tracked 2026 row. Deliberately NOT folded into this route's own
 * eligibility condition as "every live row under this month is still
 * future-dated" — that matches most healthy companies most of the time
 * (897 eligible companies system-wide; December alone had 359/369 with
 * only a future row), so as a DAILY cron re-check against live TeamWork
 * it would be an unbounded, near-full-company-base scan every single day
 * forever, not a one-time catch-up, and risks blowing this route's own
 * 300s budget. The 20 found this way were backfilled once by hand instead
 * — a similar one-time sweep across the other months, not a permanent
 * change here, is the safer way to close this for good. (An open cycle
 * already covered by an existing fye_year for that company is still never
 * re-inserted regardless — see coveredYears below — this just protects
 * against the narrower case where that could still matter.)
 *
 * "Open" cycle detection groups TeamWork's AGM and AR event rows by their
 * shared Actual FYE date before deciding — NOT per-event-row in isolation.
 * Caught live on SCIENCE IN SPORT SINGAPORE: its FYE-2025-10-31 AR event
 * row had no held/filing date of its own, but the sibling AGM event row
 * for the SAME FYE did (27/03/2026) — TeamWork's own consolidated report
 * treats that as the whole cycle being done. Reading only the AR event's
 * own two columns (this route's original behaviour) reached the opposite,
 * wrong conclusion — inserted once as a "missing overdue AR", caught by
 * Vincent showing the real consolidated TeamWork view, deleted. A cycle
 * only counts as open now if NEITHER its AGM nor its AR event shows a
 * held/filing date.
 *
 * Triggered by a daily Vercel Cron (see vercel.json) and can also be
 * called manually.
 */

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EXCLUDED_STATUSES = ['Striking Off', 'Terminated'];
const WINDOW_MONTHS = 6;
const CATCH_UP_CONCURRENCY = 10;
// Vincent, 2026-08-28: the catch-up pass below (real per-company TeamWork
// fetches, no bound on how long that can take) had no self-imposed deadline
// at all, unlike late-filing/sync's own WORK_DEADLINE_MS — found while
// investigating a DIFFERENT route (teamwork/sync-nd) stuck "running" forever
// on the Automation Health dashboard: Vercel's hard maxDuration kill doesn't
// let this route's own cleanup/error-handling code run at all, so the
// automation_sync_locks row never gets released and the NEXT day's run
// reports "Previous run lease expired" instead of the real cause. Stops the
// catch-up pass gracefully (not the whole route — the main forward-window
// loop above has already fully committed by this point regardless) well
// before the 300s maxDuration, same margin late-filing/sync already uses.
const CATCH_UP_DEADLINE_MS = 230_000;

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

function fyeDateFor(year: number, monthIndex0: number, preferredDay: number | null) {
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex0, Math.min(preferredDay ?? lastDay, lastDay)));
}

async function generateArRows() {
  const supabase = createAdminClient();

  const now = new Date();
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();

  const targets = Array.from({ length: WINDOW_MONTHS }, (_, i) => {
    const idx = (currentMonthIndex + i) % 12;
    const yearOffset = Math.floor((currentMonthIndex + i) / 12);
    return { monthName: MONTH_NAMES[idx], monthIndex0: idx, year: currentYear + yearOffset };
  });

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, company_name, registration_no, fye_month, fye_day, pic, sec_pic, is_active, tw_status, internal_id')
    .eq('is_active', true)
    .not('tw_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // No upstream system tracks Accounts/Tax PIC assignment (unlike Secretary,
  // sourced from companies.pic above) — carry forward each company's own
  // most recent prior acc_pic/tax_pic as a starting suggestion on new rows.
  const { accFor, taxFor } = await loadCarriedForwardPics(supabase);

  const summary: { month: string; year: number; matched: number; inserted: number; error?: string }[] = [];
  let totalInserted = 0;
  const errors: string[] = [];

  for (const target of targets) {
    const matching = (companies ?? []).filter(c => c.fye_month === target.monthName);

    // Intentionally counts ALL rows for the cycle, including soft-deleted
    // ('Excluded') ones — that's how a user-removed company stays removed and
    // isn't auto-recreated. Do NOT filter out status='Excluded' here.
    const { data: existing, error: existingError } = await supabase
      .from('ar_reminder')
      .select('entity_name, company_id')
      .eq('fye_month', target.monthName)
      .eq('fye_year', target.year);
    if (existingError) {
      errors.push(`${target.monthName} ${target.year}: ${existingError.message}`);
      summary.push({ month: target.monthName, year: target.year, matched: matching.length, inserted: 0, error: existingError.message });
      continue;
    }
    const existingNames = new Set((existing ?? []).map(r => r.entity_name));
    const existingCompanyIds = new Set((existing ?? []).map(r => r.company_id).filter(Boolean));

    const toInsert = matching
      .filter(c => !existingCompanyIds.has(c.id) && !existingNames.has(c.company_name))
      .map(c => {
        const fyeDate = fyeDateFor(target.year, target.monthIndex0, c.fye_day);
        const dueDate = addMonths(fyeDate, 7);
        return {
        entity_name: c.company_name,
        company_id: c.id,
        uen: c.registration_no || '',
        fye_month: target.monthName,
        fye_year: target.year,
        fye_date: toDateStr(fyeDate),
        due_date: toDateStr(dueDate),
        pic: resolveTeamworkPic(c.sec_pic ?? c.pic),
        acc_pic: accFor(c.id, c.registration_no),
        tax_pic: taxFor(c.id, c.registration_no),
        acc_pic_manual: false,
        tax_pic_manual: false,
        };
      });

    if (toInsert.length) {
      // Vincent, 2026-08-28: this route has failed EVERY day for at least a
      // week straight with "duplicate key value violates unique constraint
      // ar_reminder_entity_month_year_uniq" — confirmed live this is not a
      // duplicate company_name within `companies` (checked directly, none
      // found) nor a duplicate within toInsert itself; by the time the
      // failure is investigated hours later, whatever row conflicted has
      // always already been filled in by some other path, so the exact
      // trigger keeps escaping direct capture. Regardless of the precise
      // cause, a plain .insert() has the wrong failure mode for it: ONE
      // stray row that slips past the existingNames/existingCompanyIds
      // check above aborts the ENTIRE batch, silently losing every other
      // genuinely-new row in the same target month too (Vincent's
      // Automation Health dashboard showing "AR Generate: never" despite
      // this running every single night). Upsert with ignoreDuplicates
      // makes a stray duplicate a silent no-op instead — matches this
      // route's own stated intent ("never overwrites existing rows") more
      // precisely than a failing insert did, and stops one collision from
      // costing every other legitimate row in the run.
      const { error: insErr } = await supabase.from('ar_reminder')
        .upsert(toInsert, { onConflict: 'entity_name,fye_month,fye_year', ignoreDuplicates: true });
      if (insErr) {
        errors.push(`${target.monthName} ${target.year}: ${insErr.message}`);
        summary.push({ month: target.monthName, year: target.year, matched: matching.length, inserted: 0, error: insErr.message });
        continue;
      }
    }

    summary.push({ month: target.monthName, year: target.year, matched: matching.length, inserted: toInsert.length });
    totalInserted += toInsert.length;
  }

  // Catch-up pass: the loop above only ever looks forward from "today," so a
  // company whose fye_month had ALREADY rolled out of the window by the time
  // it first appeared in `companies` (newly onboarded, or newly matched by
  // some other sync) never gets a row — not now, not ever, since the window
  // never looks backward. Confirmed as a real, ongoing gap: Vincent reported
  // active CSS Clients "missing in June 2026" despite fye_month=June; found
  // 55 eligible companies system-wide with ZERO ar_reminder rows across
  // every fye_year, all created_at between 2026-06-17 and 2026-08-07.
  //
  // Also catches a second, related case: a company whose FYE self-corrected
  // (sync-workflow excludes the stale-month row when that happens — see
  // that route's docstring) but whose NEW month had already rolled out of
  // the forward window by the time the correction landed, so no
  // replacement row was ever created either. Checking "has ANY row at all"
  // misses this — the company has a row, it's just Excluded and under the
  // OLD month. What actually matters is "has a LIVE row under the
  // company's CURRENT fye_month" (Vincent caught this too: YAN BIN/GOLDHILL
  // MEMORIAL CENTRE/SFS CARE all had an Excluded row from a past FYE
  // correction and nothing live since).
  //
  // Runs for each catchUpTargets company (see this file's own top docstring
  // for the exact eligibility condition). For each, fetches its REAL
  // TeamWork AGM/AR event history and only inserts when a genuinely open
  // cycle is found (neither its AGM nor its AR event shows a held/filing
  // date — the earliest such cycle, if more than one is open, and not one
  // some existing row already covers) — using TeamWork's own year and FYE
  // date for that cycle, never a computed guess. A company with no open
  // cycle at all (e.g. its only history is years-old and already
  // completed) is left alone and counted in `catchUpSkipped` rather than
  // guessing at a fabricated cycle.
  const eligibleForCatchUp = (companies ?? []).filter(c => c.fye_month && MONTH_NAMES.includes(c.fye_month) && c.internal_id);
  let catchUpInserted = 0;
  let catchUpSkipped = 0;
  let catchUpLinked = 0;
  let catchUpDeadlineHit = false;
  const catchUpErrors: string[] = [];
  if (eligibleForCatchUp.length) {
    const eligibleIds = eligibleForCatchUp.map(c => c.id);
    const eligibleUenMap = new Map<string, (typeof eligibleForCatchUp)[number]>();
    for (const c of eligibleForCatchUp) {
      const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
      if (uen) eligibleUenMap.set(uen, c);
    }
    const eligibleUens = [...eligibleUenMap.keys()];
    // Checked by company_id AND separately by UEN — a legacy row from before
    // company_id was backfilled onto ar_reminder (bulk imports predating
    // that column) has company_id=null and is invisible to a company_id-only
    // check, so this pass would wrongly conclude "never generated" and
    // create a second, empty row duplicating one that already has real
    // staff-tracked progress. Confirmed live: 22 companies had exactly this
    // — e.g. GRAND CHEN RESOURCES had a real row with accounts_status=paid/
    // ar_status/dpo/pic assignments sitting with company_id=null, and this
    // pass (before this fix) created a second, blank "March 2026" row next
    // to it. All 22 were cleaned up by hand (linked the real row's
    // company_id, deleted the empty duplicate) once found.
    const [{ data: byId, error: byIdError }, { data: byUen, error: byUenError }] = await Promise.all([
      supabase.from('ar_reminder').select('id, company_id, uen, fye_month, fye_year, due_date, status').in('company_id', eligibleIds),
      eligibleUens.length
        ? supabase.from('ar_reminder').select('id, company_id, uen, fye_month, fye_year, due_date, status').is('company_id', null).in('uen', eligibleUens)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const anyExistingError = byIdError || byUenError;
    if (anyExistingError) {
      catchUpErrors.push(anyExistingError.message);
    } else {
      // Every live row per company (not just which months have one) — needed
      // for the "no row at all" catch-up-eligibility check below, and so a
      // found-open cycle can be checked against coveredYears before insert
      // (belt-and-braces: eligibility already guarantees zero rows under
      // this fye_month, so coveredYears is always empty in practice today —
      // kept anyway so this stays correct if eligibility ever widens again).
      const liveRowsByCompany = new Map<number, { fye_month: string; fye_year: number; due_date: string | null }[]>();
      const addLiveRow = (companyId: number, r: { fye_month: string; fye_year: number; due_date: string | null }) => {
        if (!liveRowsByCompany.has(companyId)) liveRowsByCompany.set(companyId, []);
        liveRowsByCompany.get(companyId)!.push(r);
      };
      for (const r of byId ?? []) {
        if (!r.company_id || r.status === 'Excluded') continue;
        addLiveRow(r.company_id, { fye_month: r.fye_month, fye_year: r.fye_year, due_date: r.due_date });
      }
      // Orphaned rows matched by UEN: link company_id now (self-heals the
      // legacy gap instead of leaving it for the next person to rediscover)
      // and count them as live so catch-up doesn't duplicate them.
      for (const r of byUen ?? []) {
        const uen = r.uen ? String(r.uen).trim().toUpperCase() : null;
        const company = uen ? eligibleUenMap.get(uen) : undefined;
        if (!company) continue;
        if (r.status !== 'Excluded') addLiveRow(company.id, { fye_month: r.fye_month, fye_year: r.fye_year, due_date: r.due_date });
        const { error: linkErr } = await supabase.from('ar_reminder').update({ company_id: company.id }).eq('id', r.id);
        if (!linkErr) catchUpLinked++;
      }
      // Catch-up eligible: no live row under the company's current fye_month
      // at all. Vincent, 2026-08-27: considered ALSO widening this to
      // "every live row under that month is still future-dated" (closes a
      // real gap — see this file's own docstring — where an older,
      // already-overdue cycle can sit invisibly behind an already-tracked
      // future one), but that condition matches most healthy companies most
      // of the time (897 eligible companies system-wide; a sample of just
      // the December ones alone had 359/369 with only a future row) — as a
      // DAILY cron re-check against live TeamWork, that's an unbounded,
      // near-full-company-base scan forever, not a one-time catch-up, and
      // risks blowing this route's own 300s budget. Left the eligibility
      // condition as-is; the real December gap it surfaced (20 companies)
      // was instead swept once by hand, same shape as the one-off
      // catch-up scripts this docstring already references — a similar
      // one-time sweep across the other months is the safer way to close
      // this for good, not a permanent daily behaviour change.
      const catchUpTargets = eligibleForCatchUp.filter(c => {
        const rowsUnderMonth = (liveRowsByCompany.get(c.id) ?? []).filter(r => r.fye_month === c.fye_month);
        return !rowsUnderMonth.length;
      });
      if (catchUpTargets.length) {
        const catchUpController = new AbortController();
        const catchUpDeadline = setTimeout(() => {
          catchUpController.abort(new Error(
            `AR Generate's catch-up pass stopped safely before the Vercel timeout because TeamWork did not finish within ${CATCH_UP_DEADLINE_MS / 1000} seconds.`,
          ));
        }, CATCH_UP_DEADLINE_MS);
        try {
          const cookie = await getSessionCookie();
          const catchUpRows: { entity_name: string; company_id: number; uen: string; fye_month: string; fye_year: number; fye_date: string; due_date: string; pic: string | null; acc_pic: string | null; tax_pic: string | null; acc_pic_manual: boolean; tax_pic_manual: boolean }[] = [];
          const skippedCompanies: { id: number; company_name: string; fye_month: string }[] = [];
          let nextIndex = 0;
          const worker = async () => {
            while (nextIndex < catchUpTargets.length) {
              if (catchUpController.signal.aborted) return;
              const c = catchUpTargets[nextIndex++];
              try {
                const result = await fetchAgmList(cookie, c.internal_id as string, catchUpController.signal);
                // Group by shared Actual FYE date FIRST — an AGM and an AR
                // event for the same cycle are two separate TeamWork rows,
                // and only one of them may end up carrying the real
                // completion date (see this file's own docstring: SCIENCE IN
                // SPORT SINGAPORE's AR event row was blank while its sibling
                // AGM event for the identical FYE showed 27/03/2026 — reading
                // either event in isolation reaches the wrong answer for the
                // other). A cycle counts as open only if NEITHER shows one.
                const cycles = new Map<string, { yearLabel: string; agmDone: boolean; arDone: boolean }>();
                for (const ev of result.data ?? []) {
                  const [event, yearLabel, fyeRaw, , , heldRaw, filingRaw] = ev;
                  if (event !== 'AGM' && event !== 'AR') continue;
                  const fyeDate = toIsoDate(parseDmy(fyeRaw));
                  if (!fyeDate) continue;
                  if (!cycles.has(fyeDate)) cycles.set(fyeDate, { yearLabel, agmDone: false, arDone: false });
                  const done = !!(toIsoDate(parseDmy(heldRaw)) || toIsoDate(parseDmy(filingRaw)));
                  const g = cycles.get(fyeDate)!;
                  if (event === 'AGM') g.agmDone = g.agmDone || done; else g.arDone = g.arDone || done;
                }
                const coveredYears = new Set((liveRowsByCompany.get(c.id) ?? [])
                  .filter(r => r.fye_month === c.fye_month).map(r => r.fye_year));
                let openYear: string | null = null;
                let openFyeDate: string | null = null;
                for (const [fyeDate, g] of cycles) {
                  if (g.agmDone || g.arDone) continue; // already completed
                  if (coveredYears.has(Number(g.yearLabel))) continue; // some row already tracks this one
                  if (!openFyeDate || fyeDate < openFyeDate) {
                    openYear = g.yearLabel;
                    openFyeDate = fyeDate;
                  }
                }
                if (openYear && openFyeDate) {
                  catchUpRows.push({
                    entity_name: c.company_name,
                    company_id: c.id,
                    uen: c.registration_no || '',
                    fye_month: c.fye_month as string,
                    fye_year: Number(openYear),
                    // Deliberately NOT using either event's own "due date"
                    // column — AGM due is FYE+6mo, AR due is FYE+7mo, and
                    // TeamWork's scraped column reflects whichever event
                    // happened to carry it, not this system's own due_date
                    // convention (always FYE+7). Computed from the confirmed
                    // real fyeDate instead, so it can never inherit the
                    // wrong one. Caught after an earlier one-off fix script
                    // (fix-ar-mismatch-years.js) used the scraped due date
                    // directly and got 27/27 rows wrong by exactly one month.
                    fye_date: openFyeDate,
                    due_date: toDateStr(addMonths(new Date(`${openFyeDate}T00:00:00Z`), 7)),
                    pic: resolveTeamworkPic(c.sec_pic ?? c.pic),
                    acc_pic: accFor(c.id, c.registration_no),
                    tax_pic: taxFor(c.id, c.registration_no),
                    acc_pic_manual: false,
                    tax_pic_manual: false,
                  });
                } else {
                  catchUpSkipped++;
                  skippedCompanies.push({ id: c.id, company_name: c.company_name, fye_month: c.fye_month as string });
                }
              } catch (e) {
                // A company whose in-flight fetch got aborted BY the
                // deadline (not a genuine per-company failure) shouldn't
                // count as an error — that would make the whole route
                // report ok:false for expected, graceful degradation.
                // It's simply left for a future run, same as one the
                // deadline check above never even started.
                if (!catchUpController.signal.aborted) {
                  catchUpErrors.push(`${c.company_name}: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(CATCH_UP_CONCURRENCY, catchUpTargets.length) }, worker));
          catchUpDeadlineHit = catchUpController.signal.aborted;
          if (catchUpRows.length) {
            // Same reasoning as the main loop's own insert above: upsert
            // with ignoreDuplicates so a stray collision here can't cost
            // every other genuinely-new catch-up row in the same run.
            const { error: catchUpInsErr } = await supabase.from('ar_reminder')
              .upsert(catchUpRows, { onConflict: 'entity_name,fye_month,fye_year', ignoreDuplicates: true });
            if (catchUpInsErr) catchUpErrors.push(catchUpInsErr.message);
            else catchUpInserted = catchUpRows.length;
          }
          // Surface skipped companies on the automation health dashboard
          // instead of them silently vanishing — a company with no live row
          // and no open TeamWork cycle needs a human to check TeamWork
          // itself (same "flag, don't guess" pattern as teamwork_nd's
          // missing_nominee_subrole). Auto-resolves once the company either
          // gets a real open cycle in TeamWork or otherwise gets a live row.
          await replaceAutomationExceptions('ar_generate', 'catch_up_no_open_cycle', skippedCompanies.map(c => ({
            key: String(c.id),
            name: c.company_name,
            details: {
              company_id: c.id,
              fye_month: c.fye_month,
              reason: 'No ar_reminder row under this fye_month, and TeamWork has no open (unheld/unfiled) AGM/AR cycle to backfill from — check TeamWork directly.',
            },
          })));
        } catch (e) {
          catchUpErrors.push(`TeamWork login failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          clearTimeout(catchUpDeadline);
        }
      }
    }
  }
  totalInserted += catchUpInserted;
  errors.push(...catchUpErrors);

  const result = { ok: errors.length === 0, window: targets.map(t => `${t.monthName} ${t.year}`), totalInserted, catchUpInserted, catchUpSkipped, catchUpLinked, catchUpDeadlineHit, summary, errors };
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ar_generate', generateArRows);
}
