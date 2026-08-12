import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { withAutomationRun } from '@/lib/automation-sync';
import { getSessionCookie, fetchAgmList, parseDmy, toIsoDate } from '@/lib/teamwork-agm';

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
 * never-generated company's real AGM/AR history and only inserts when a
 * genuinely open (not yet held/filed) cycle is found, using TeamWork's own
 * year/date for that cycle — never a computed guess.
 *
 * Triggered by a daily Vercel Cron (see vercel.json) and can also be
 * called manually.
 */

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EXCLUDED_STATUSES = ['Striking Off', 'Terminated'];
const WINDOW_MONTHS = 6;
const CATCH_UP_CONCURRENCY = 10;

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

function fyeDateFor(year: number, monthIndex0: number, preferredDay: number | null) {
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex0, Math.min(preferredDay ?? lastDay, lastDay)));
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addMonths(date: Date, n: number) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
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
        };
      });

    if (toInsert.length) {
      const { error: insErr } = await supabase.from('ar_reminder').insert(toInsert);
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
  // Runs once per company with no live row under its current fye_month. For
  // each, fetches its REAL TeamWork AGM/AR event history and only inserts
  // when a genuinely open cycle is found (an AGM or AR row with no
  // held/filing date yet — the earliest one, if more than one is open) —
  // using TeamWork's own year and FYE date for that cycle, never a
  // computed guess. A company with no open cycle at all (e.g. its only
  // history is years-old and already completed) is left alone and counted
  // in `catchUpSkipped` rather than guessing at a fabricated cycle.
  const eligibleForCatchUp = (companies ?? []).filter(c => c.fye_month && MONTH_NAMES.includes(c.fye_month) && c.internal_id);
  let catchUpInserted = 0;
  let catchUpSkipped = 0;
  const catchUpErrors: string[] = [];
  if (eligibleForCatchUp.length) {
    const eligibleIds = eligibleForCatchUp.map(c => c.id);
    const { data: anyExisting, error: anyExistingError } = await supabase
      .from('ar_reminder')
      .select('company_id, fye_month, status')
      .in('company_id', eligibleIds);
    if (anyExistingError) {
      catchUpErrors.push(anyExistingError.message);
    } else {
      const liveMonthsByCompany = new Map<number, Set<string>>();
      for (const r of anyExisting ?? []) {
        if (!r.company_id || r.status === 'Excluded') continue;
        if (!liveMonthsByCompany.has(r.company_id)) liveMonthsByCompany.set(r.company_id, new Set());
        liveMonthsByCompany.get(r.company_id)!.add(r.fye_month);
      }
      const neverGenerated = eligibleForCatchUp.filter(c => !liveMonthsByCompany.get(c.id)?.has(c.fye_month as string));
      if (neverGenerated.length) {
        try {
          const cookie = await getSessionCookie();
          const catchUpRows: { entity_name: string; company_id: number; uen: string; fye_month: string; fye_year: number; fye_date: string; due_date: string; pic: string | null }[] = [];
          let nextIndex = 0;
          const worker = async () => {
            while (nextIndex < neverGenerated.length) {
              const c = neverGenerated[nextIndex++];
              try {
                const result = await fetchAgmList(cookie, c.internal_id as string);
                let openYear: string | null = null;
                let openFyeDate: string | null = null;
                let openDueDate: string | null = null;
                for (const ev of result.data ?? []) {
                  const [event, yearLabel, fyeRaw, , dueRaw, heldRaw, filingRaw] = ev;
                  if (event !== 'AGM' && event !== 'AR') continue;
                  if (toIsoDate(parseDmy(heldRaw)) || toIsoDate(parseDmy(filingRaw))) continue; // already completed
                  const fyeDate = toIsoDate(parseDmy(fyeRaw));
                  if (!fyeDate) continue;
                  if (!openFyeDate || fyeDate < openFyeDate) {
                    openYear = yearLabel;
                    openFyeDate = fyeDate;
                    openDueDate = toIsoDate(parseDmy(dueRaw));
                  }
                }
                if (openYear && openFyeDate && openDueDate) {
                  catchUpRows.push({
                    entity_name: c.company_name,
                    company_id: c.id,
                    uen: c.registration_no || '',
                    fye_month: c.fye_month as string,
                    fye_year: Number(openYear),
                    fye_date: openFyeDate,
                    due_date: openDueDate,
                    pic: resolveTeamworkPic(c.sec_pic ?? c.pic),
                  });
                } else {
                  catchUpSkipped++;
                }
              } catch (e) {
                catchUpErrors.push(`${c.company_name}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(CATCH_UP_CONCURRENCY, neverGenerated.length) }, worker));
          if (catchUpRows.length) {
            const { error: catchUpInsErr } = await supabase.from('ar_reminder').insert(catchUpRows);
            if (catchUpInsErr) catchUpErrors.push(catchUpInsErr.message);
            else catchUpInserted = catchUpRows.length;
          }
        } catch (e) {
          catchUpErrors.push(`TeamWork login failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  totalInserted += catchUpInserted;
  errors.push(...catchUpErrors);

  const result = { ok: errors.length === 0, window: targets.map(t => `${t.monthName} ${t.year}`), totalInserted, catchUpInserted, catchUpSkipped, summary, errors };
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ar_generate', generateArRows);
}
