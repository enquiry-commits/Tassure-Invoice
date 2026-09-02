import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { replaceAutomationExceptions, withAutomationRun, type AutomationSource } from '@/lib/automation-sync';
import { scrapeTeamworkNdAppointments, type TeamworkNdPerson } from '@/lib/teamwork-nd';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// Vincent, 2026-08-29: the ND roster (13 people, confirmed live) was landing
// at 256-298s of REAL wall-clock time even on the OLD 290s-budget "successful"
// runs — this was never a new regression, the work has always been
// dangerously close to Vercel's 300s hard ceiling (Hobby plan, non-negotiable
// — confirmed via a real prior failed deployment elsewhere in this codebase).
// Splitting the roster across smaller cron invocations restores a genuine,
// large safety margin instead of trying to shave the internal timeout
// closer to the wall a second time (see PROJECT_STATUS.md).
//
// Started at 2 batches (6-7 people each) — real testing disproved the
// "half the people = half the time" assumption: one 7-person batch (which
// happened to contain 2-3 of the small set of individuals who are
// consistently slow every run, per lib/teamwork-nd.ts's own comment) still
// landed within ~40s of the 240s internal budget on a real run, twice
// actually exceeded it. Root cause, confirmed by reading how concurrency
// actually works here: scrapeTeamworkNdAppointments distributes people to
// 3 concurrent workers via work-stealing (picks up the next index whenever
// a worker frees up) — with 6-7 people, a single worker can easily end up
// processing 2-3 people SEQUENTIALLY, and if 2 of them are the slow ones
// (85-118s each), that worker alone can approach or exceed the budget.
// 4 batches (mostly 3 people, one of 4) removes this risk almost entirely:
// with exactly 3 people and 3 workers, EVERY person gets their own worker
// running in PARALLEL — total time is bounded by the single slowest
// person, not a sum of several. Confirmed live: a real 3-person batch
// containing 2 of the historically-slow individuals still finished
// comfortably under budget, run in parallel rather than stacked.
//
// vercel.json now fires this route FIVE times a day, at five distinct
// hours, well within Vercel's own documented Hobby-tier jitter window (which
// is confined to the cron expression's hour value), so no two batches can
// overlap. Vercel identifies which invocation is which via the officially
// documented `x-vercel-cron-schedule` header (exact schedule string that
// triggered it) — NOT a query string in the cron path, since Vercel's docs
// don't confirm query strings in a cron `path` survive into the request,
// only that this header does, by name, for this exact "same path, different
// schedule" scenario (confirmed directly against Vercel's current docs).
//
// Rebalanced from 4 to 5 batches 2026-08-31: the real ND roster grew to 14
// people since the 4-batch design was built around 13 — with of=4 and only
// 3 concurrent workers (see lib/teamwork-nd.ts), the interleave gave
// batches 1-2 FOUR people each, exceeding the 3-worker capacity this whole
// split exists to match one-to-one. Confirmed live: teamwork_nd_1 failed
// with TeamWork API timeouts on 2 of its 4 people, consistent with 2 of
// them stacking sequentially on one worker (the exact INV-CRON-003 risk).
// of=5 against 14 people gives batches of 3,3,3,3,2 — every batch at or
// under the 3-worker concurrency again. Also found and fixed the same day:
// teamwork/sync (Companies) and teamwork/sync-secretary's first daily run
// had drifted into this route's own hour 18 (see vercel.json/PROJECT_STATUS.md
// 2026-08-31 entry) — a real collision this route's own non-adjacent-hour
// design never checked against OTHER routes' schedules, only its own
// batches. See docs/INVARIANTS.md INV-CRON-013/014.
//
// ?batch=N&of=5 query params are ALSO accepted, for manual testing
// (mirroring the existing ?member_id= precedent below) — a plain
// browser/curl hit has no x-vercel-cron-schedule header, so this is the
// only way to manually exercise one batch in isolation before trusting it.
//
// No batch info at all (no header match, no query params) still runs the
// FULL roster under the original 'teamwork_nd' source — kept only for
// manual/ad-hoc full runs (e.g. re-testing after a scrape-logic change).
// Do NOT put this unscoped form back on a daily cron — it reintroduces the
// exact near-300s risk this split exists to remove.
//
// If the roster keeps growing and a 6th batch is ever needed: add a 6th
// cron entry + schedule string below (checked against EVERY other
// Playwright-launching route's hour, not just this route's own batches —
// see INV-CRON-014), a 6th CRON_SCHEDULE_BATCH entry, a 6th case in
// batchSource(), a 6th AutomationSource literal in lib/automation-sync.ts,
// and a 6th label in the dashboard files listed in this repo's
// PROJECT_STATUS.md entry for this change.
const CRON_SCHEDULE_BATCH: Record<string, { batch: number; of: number }> = {
  '0 12 * * *': { batch: 1, of: 5 },
  '0 14 * * *': { batch: 2, of: 5 },
  '0 16 * * *': { batch: 3, of: 5 },
  '0 18 * * *': { batch: 4, of: 5 },
  '0 17 * * *': { batch: 5, of: 5 },
};

function batchSource(batch: number, of: number): AutomationSource | null {
  if (of !== 5) return null;
  if (batch === 1) return 'teamwork_nd_1';
  if (batch === 2) return 'teamwork_nd_2';
  if (batch === 3) return 'teamwork_nd_3';
  if (batch === 4) return 'teamwork_nd_4';
  if (batch === 5) return 'teamwork_nd_5';
  return null;
}

async function syncNdAppointments(
  req: NextRequest,
  batch: number | null,
  of: number | null,
) {
  const supabase = createAdminClient();
  let query = supabase
    .from('nominee_directors')
    .select('id, name, member_id')
    .not('member_id', 'is', null)
    .order('id');
  // Optional single-person scope (?member_id=3290) — e.g. right after adding
  // someone new to the roster, staff want that one person's appointments
  // confirmed immediately rather than waiting for tonight's full run. Safe
  // to run standalone: replace_nd_appointments below only ever
  // DELETE...WHERE nd_id = ANY(p_nd_ids) before inserting, so scoping to
  // one nd_id never touches anyone else's rows.
  const onlyMemberId = new URL(req.url).searchParams.get('member_id');
  if (onlyMemberId) query = query.eq('member_id', onlyMemberId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let people = (data ?? []) as TeamworkNdPerson[];
  if (batch !== null && of !== null) {
    // Interleaved by sorted position (not a contiguous id range) so a
    // handful of consistently-slow people (see lib/teamwork-nd.ts) can't
    // all land in the same batch just because their ids happen to be close
    // together. See this file's own top comment.
    people = people.filter((_, index) => index % of === batch - 1);
  }

  const scraped = await scrapeTeamworkNdAppointments(people);
  if (scraped.errors.length) {
    return NextResponse.json({
      ok: false,
      batch, of,
      checked_people: people.length,
      people: people.map(p => p.name),
      scraped_rows: scraped.appointments.length,
      errors: scraped.errors,
      error: 'ND scrape was incomplete; database replacement was not started.',
    }, { status: 502 });
  }

  const { data: inserted, error: replaceError } = await supabase.rpc('replace_nd_appointments', {
    p_nd_ids: people.map(person => person.id),
    p_rows: scraped.appointments,
  });
  if (replaceError) {
    return NextResponse.json({ ok: false, error: replaceError.message }, { status: 500 });
  }

  // Exceptions stay under the stable 'teamwork_nd' source regardless of
  // batch — this is DATA content ("this company/ND needs review"), not
  // operational run-health, and app/nominee-directors/page.tsx already
  // queries exceptions with source='teamwork_nd' hardcoded. All 4 batches
  // share this SAME (source, exceptionType) resolve-target, so every run
  // — not just the one that originally saw a given exception — can
  // otherwise resolve it just because it wasn't in THAT run's own ~3-person
  // slice. With batches spread 12:00-18:00 UTC daily, the worst case is a
  // batch's own exceptions not being re-confirmed by that SAME batch for
  // up to ~24h (today's 12:00 run to tomorrow's) — grace comfortably
  // exceeds that (30h) while still resolving a genuine fix within about a
  // day and a half, not leaving it open indefinitely.
  await replaceAutomationExceptions(
    'teamwork_nd',
    'missing_nominee_subrole',
    scraped.missingSubroles.map(item => ({
      key: `${item.nd_id}:${item.appointment_date}:${item.company_name.trim().toUpperCase()}`,
      name: item.company_name,
      details: {
        nd_id: item.nd_id,
        nd_name: item.nd_name,
        company_name: item.company_name,
        appointment_date: item.appointment_date,
        appointment_status: item.appointment_status,
        teamwork_subrole: null,
        reason: 'Effective appointment date is present and cessation is blank, but Nominee Director subrole is missing.',
      },
    })),
    { graceMs: 30 * 60 * 60 * 1000 },
  );

  return NextResponse.json({
    ok: true,
    batch, of,
    checked_people: people.length,
    people: people.map(p => p.name),
    appointment_rows: scraped.appointments.length,
    active_rows: scraped.appointments.filter(row => !row.cessation_date).length,
    ceased_rows: scraped.appointments.filter(row => row.cessation_date).length,
    missing_subrole_rows: scraped.missingSubroles.length,
    inserted_rows: inserted,
    concurrency: scraped.concurrency,
    slowest_people: scraped.durations.slice(0, 3),
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cronSchedule = req.headers.get('x-vercel-cron-schedule');
  const batchParam = url.searchParams.get('batch');
  const ofParam = url.searchParams.get('of');

  let batch: number | null = null;
  let of: number | null = null;
  if (cronSchedule && CRON_SCHEDULE_BATCH[cronSchedule]) {
    ({ batch, of } = CRON_SCHEDULE_BATCH[cronSchedule]);
  } else if (batchParam !== null || ofParam !== null) {
    batch = Number(batchParam);
    of = Number(ofParam);
    if (!Number.isInteger(batch) || !Number.isInteger(of) || batch < 1 || of < 1 || batch > of) {
      return NextResponse.json({ ok: false, error: `Invalid ?batch=${batchParam}&of=${ofParam}.` }, { status: 400 });
    }
  }

  let source: AutomationSource = 'teamwork_nd';
  if (batch !== null && of !== null) {
    const resolved = batchSource(batch, of);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: `?batch=${batch}&of=${of} has no automation source wired up yet.` }, { status: 400 });
    }
    source = resolved;
  }

  return withAutomationRun(req, source, () => syncNdAppointments(req, batch, of), 10);
}
