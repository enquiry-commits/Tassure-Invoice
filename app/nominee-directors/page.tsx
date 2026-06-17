import NDPersonCard from '@/components/NDPersonCard';
import { supabase } from '@/lib/supabase';

const today = new Date().toISOString().split('T')[0];

async function getData() {
  const [{ data: nds }, { data: appts }] = await Promise.all([
    supabase.from('nominee_directors').select('id, name, member_id').order('name'),
    supabase.from('nd_appointments').select('nd_id, company_name, sub_role, appointment_date, cessation_date'),
  ]);

  const apptsByND = new Map<number, typeof appts>();
  for (const a of appts ?? []) {
    const list = apptsByND.get(a.nd_id) ?? [];
    list.push(a);
    apptsByND.set(a.nd_id, list);
  }

  return (nds ?? []).map(nd => {
    const appointments = apptsByND.get(nd.id) ?? [];
    const activeCount = appointments.filter(a => !a.cessation_date || a.cessation_date > today).length;
    return { ...nd, appointments, activeCount, totalCount: appointments.length };
  }).sort((a, b) => b.activeCount - a.activeCount);
}

export default async function NomineDirectorsPage() {
  const persons = await getData();

  const totalActive    = persons.reduce((s, p) => s + p.activeCount, 0);
  const totalCeased    = persons.reduce((s, p) => s + (p.totalCount - p.activeCount), 0);
  const activePersons  = persons.filter(p => p.activeCount > 0).length;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Nominee Directors</div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total NDs',                 value: persons.length, color: '#1d4ed8' },
          { label: 'Active NDs',                value: activePersons,  color: '#16a34a' },
          { label: 'Total Active Appointments', value: totalActive,    color: '#d97706' },
          { label: 'Historical Ceased',         value: totalCeased,    color: '#6b7280' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* ND Cards — default collapsed, click to expand all companies */}
      <div className="grid grid-cols-2 gap-4">
        {persons.map(person => (
          <NDPersonCard key={person.name} person={person} />
        ))}
      </div>
    </div>
  );
}
