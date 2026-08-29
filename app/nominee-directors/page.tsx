import NDDirectory from '@/components/NDDirectory';
import NDSubroleReview, { type NDSubroleReviewItem } from '@/components/NDSubroleReview';
import MetricCard from '@/components/MetricCard';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import { AlertTriangle, BriefcaseBusiness, UserCheck, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = createAdminClient();
  const [{ data: nds }, { data: appts }, { data: reviewRows }, { data: latestRuns }, { data: companies }] = await Promise.all([
    supabase.from('nominee_directors').select('id, name, member_id').order('name'),
    supabase.from('nd_appointments').select('nd_id, company_name, sub_role, appointment_date, cessation_date'),
    supabase.from('automation_exceptions')
      .select('entity_key, entity_name, details, remark')
      .eq('source', 'teamwork_nd')
      .eq('exception_type', 'missing_nominee_subrole')
      .eq('status', 'open')
      .order('last_seen_at', { ascending: false }),
    // Vincent, 2026-08-29: the daily ND scrape now runs as 4 batches
    // (teamwork_nd_1..4 — see app/api/teamwork/sync-nd/route.ts) — without
    // this, this card would silently show "Pending" forever post-deploy
    // since nothing writes source='teamwork_nd' on a daily cron anymore.
    supabase.from('automation_sync_runs')
      .select('summary')
      .in('source', ['teamwork_nd', 'teamwork_nd_1', 'teamwork_nd_2', 'teamwork_nd_3', 'teamwork_nd_4'])
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase.from('companies').select('company_name, is_active, client_type'),
  ]);

  // Vincent: ND page counts should match Active Client's "Has Nominee Dir"
  // count — an appointment TeamWork itself never marked ceased can still
  // belong to a company that's no longer an active CSS Client (struck off,
  // or its master_list nd_active flag just hasn't caught up yet due to a
  // separate name-matching gap in that sync). Checking directly against
  // companies.is_active/client_type here — the same source of truth Active
  // Client itself reads — sidesteps that fragile propagation entirely
  // rather than chasing every place it can drift. Uses the shared fuzzy
  // normalize() (handles "(F.K.A. ...)"/spacing variants) since nd_appointments
  // only stores a plain company_name string, no id to join on.
  const activeCssClientNames = new Set(
    (companies ?? []).filter(c => c.is_active === true && c.client_type === 'CSS Client').map(c => normalize(c.company_name)),
  );
  const taggedAppts = (appts ?? []).map(a => ({ ...a, is_company_active: activeCssClientNames.has(normalize(a.company_name)) }));

  const apptsByND = new Map<number, typeof taggedAppts>();
  for (const a of taggedAppts) {
    const list = apptsByND.get(a.nd_id) ?? [];
    list.push(a);
    apptsByND.set(a.nd_id, list);
  }

  const persons = (nds ?? []).map(nd => {
    const appointments = apptsByND.get(nd.id) ?? [];
    const activeCount = appointments.filter(a =>
      a.sub_role === 'Nominee Director' &&
      !!a.appointment_date &&
      !a.cessation_date &&
      a.is_company_active
    ).length;
    return { ...nd, appointments, activeCount, totalCount: appointments.length };
  }).sort((a, b) => b.activeCount - a.activeCount);

  const reviewItems = (reviewRows ?? []).flatMap(row => {
    const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? row.details as Record<string, unknown>
      : {};
    const companyName = typeof row.entity_name === 'string'
      ? row.entity_name
      : typeof details.company_name === 'string' ? details.company_name : '';
    const ndName = typeof details.nd_name === 'string' ? details.nd_name : '';
    const appointmentDate = typeof details.appointment_date === 'string' ? details.appointment_date : '';
    const rawStatus = details.appointment_status;
    const appointmentStatus: NDSubroleReviewItem['appointmentStatus'] =
      rawStatus === 'effective' || rawStatus === 'proposed' ? rawStatus : 'unknown';
    if (!companyName || !ndName || !appointmentDate) return [];
    return [{
      key: row.entity_key,
      companyName,
      ndName,
      appointmentDate,
      appointmentStatus,
      remark: typeof row.remark === 'string' ? row.remark : null,
    } satisfies NDSubroleReviewItem];
  }).sort((left, right) =>
    right.appointmentDate.localeCompare(left.appointmentDate)
    || left.ndName.localeCompare(right.ndName)
    || left.companyName.localeCompare(right.companyName)
  );

  const latestSummary = latestRuns?.[0]?.summary;
  const summary = latestSummary && typeof latestSummary === 'object' && !Array.isArray(latestSummary)
    ? latestSummary as Record<string, unknown>
    : {};

  return {
    persons,
    reviewItems,
    reviewScanCompleted: typeof summary.missing_subrole_rows === 'number',
  };
}

export default async function NomineDirectorsPage() {
  const { persons, reviewItems, reviewScanCompleted } = await getData();

  const totalActive    = persons.reduce((s, p) => s + p.activeCount, 0);
  const activePersons  = persons.filter(p => p.activeCount > 0).length;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Nominee Directors</div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-4 mb-6 xl:grid-cols-4">
        {[
          { label: 'Total NDs',                 sub: 'nominee directors on file', value: persons.length,                                          color: '#1d4ed8', Icon: Users },
          { label: 'Active NDs',                sub: 'directors with active mandates', value: activePersons,                                      color: '#16a34a', Icon: UserCheck },
          { label: 'Total Active Appointments', sub: 'active company appointments', value: totalActive,                                          color: '#d97706', Icon: BriefcaseBusiness },
          { label: 'TeamWork Review',           sub: reviewScanCompleted ? 'records requiring staff review' : 'review scan has not completed', value: reviewScanCompleted ? reviewItems.length : 'Pending', color: '#dc2626', Icon: AlertTriangle },
        ].map(({ label, sub, value, color, Icon }) => (
          <MetricCard
            key={label}
            value={value}
            label={label}
            sub={sub}
            icon={<Icon size={16} />}
            color={color}
          />
        ))}
      </div>

      <NDSubroleReview items={reviewItems} scanCompleted={reviewScanCompleted} />

      {/* ND directory with company-name search */}
      <NDDirectory persons={persons} />
    </div>
  );
}
