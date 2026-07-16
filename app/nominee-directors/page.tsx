import NDDirectory from '@/components/NDDirectory';
import NDSubroleReview, { type NDSubroleReviewItem } from '@/components/NDSubroleReview';
import { createAdminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = createAdminClient();
  const [{ data: nds }, { data: appts }, { data: reviewRows }, { data: latestRuns }] = await Promise.all([
    supabase.from('nominee_directors').select('id, name, member_id').order('name'),
    supabase.from('nd_appointments').select('nd_id, company_name, sub_role, appointment_date, cessation_date'),
    supabase.from('automation_exceptions')
      .select('entity_key, entity_name, details')
      .eq('source', 'teamwork_nd')
      .eq('exception_type', 'missing_nominee_subrole')
      .eq('status', 'open')
      .order('last_seen_at', { ascending: false }),
    supabase.from('automation_sync_runs')
      .select('summary')
      .eq('source', 'teamwork_nd')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1),
  ]);

  const apptsByND = new Map<number, typeof appts>();
  for (const a of appts ?? []) {
    const list = apptsByND.get(a.nd_id) ?? [];
    list.push(a);
    apptsByND.set(a.nd_id, list);
  }

  const persons = (nds ?? []).map(nd => {
    const appointments = apptsByND.get(nd.id) ?? [];
    const activeCount = appointments.filter(a =>
      a.sub_role === 'Nominee Director' &&
      !!a.appointment_date &&
      !a.cessation_date
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
          { label: 'Total NDs',                 value: persons.length, color: '#1d4ed8' },
          { label: 'Active NDs',                value: activePersons,  color: '#16a34a' },
          { label: 'Total Active Appointments', value: totalActive,    color: '#d97706' },
          { label: 'TeamWork Review',            value: reviewScanCompleted ? reviewItems.length : 'Pending', color: '#dc2626' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <NDSubroleReview items={reviewItems} scanCompleted={reviewScanCompleted} />

      {/* ND directory with company-name search */}
      <NDDirectory persons={persons} />
    </div>
  );
}
