import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun } from '@/lib/automation-sync';
import { scrapeTeamworkNdAppointments, type TeamworkNdPerson } from '@/lib/teamwork-nd';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

async function syncNdAppointments() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nominee_directors')
    .select('id, name, member_id')
    .not('member_id', 'is', null)
    .order('id');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const people = (data ?? []) as TeamworkNdPerson[];
  const scraped = await scrapeTeamworkNdAppointments(people);
  if (scraped.errors.length) {
    return NextResponse.json({
      ok: false,
      checked_people: people.length,
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

  return NextResponse.json({
    ok: true,
    checked_people: people.length,
    appointment_rows: scraped.appointments.length,
    active_rows: scraped.appointments.filter(row => !row.cessation_date).length,
    ceased_rows: scraped.appointments.filter(row => row.cessation_date).length,
    inserted_rows: inserted,
    concurrency: scraped.concurrency,
    slowest_people: scraped.durations.slice(0, 3),
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'teamwork_nd', syncNdAppointments, 10);
}
