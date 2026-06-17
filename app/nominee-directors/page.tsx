import SectionCard from '@/components/SectionCard';
import path from 'path';
import fs from 'fs';

interface Appointment {
  companyName: string;
  subRole: string;
  appointmentDate: string;
  cessationDate: string;
  isActive: boolean;
}

interface NDPerson {
  ndName: string;
  memberId: string | null;
  activeCount: number;
  inactiveCount: number;
  appointments: Appointment[];
}

async function getData(): Promise<NDPerson[]> {
  const dataDir = path.join(process.cwd(), 'data');
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'nd_from_individuals.json'), 'utf8'));
}

export default async function NomineDirectorsPage() {
  const ndPersons = await getData();
  const sorted = [...ndPersons].sort((a, b) => b.activeCount - a.activeCount);

  const totalActive = ndPersons.reduce((s, p) => s + p.activeCount, 0);
  const totalCeased = ndPersons.reduce((s, p) => s + p.inactiveCount, 0);

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Nominee Directors</div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total NDs', value: ndPersons.length, color: '#1d4ed8' },
          { label: 'Active NDs', value: ndPersons.filter(p => p.activeCount > 0).length, color: '#16a34a' },
          { label: 'Total Active Appointments', value: totalActive, color: '#d97706' },
          { label: 'Historical Ceased', value: totalCeased, color: '#6b7280' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ND Grid */}
      <div className="grid grid-cols-2 gap-4">
        {sorted.map(person => (
          <SectionCard
            key={person.ndName}
            title={person.ndName}
          >
            {/* Status badges */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-semibold">
                {person.activeCount} Active
              </span>
              <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
                {person.inactiveCount} Ceased
              </span>
              {person.memberId && (
                <span className="text-xs text-slate-400 ml-auto">ID: {person.memberId}</span>
              )}
            </div>

            {/* Active appointments */}
            {person.appointments.filter(a => a.isActive).length > 0 ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {person.appointments
                  .filter(a => a.isActive)
                  .map((a, i) => (
                    <div key={i} className="flex items-start gap-2 py-1 border-b border-slate-50 last:border-0">
                      <span className="text-green-500 text-xs mt-0.5 flex-shrink-0">●</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-700 leading-tight">{a.companyName}</div>
                        <div className="text-xs text-slate-400">Since {a.appointmentDate}</div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                {person.appointments.length > 0
                  ? 'No current active appointments'
                  : 'No appointment records found'}
              </p>
            )}

            {/* Ceased count hint */}
            {person.inactiveCount > 0 && (
              <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-100">
                + {person.inactiveCount} historical ceased appointment{person.inactiveCount > 1 ? 's' : ''}
              </p>
            )}
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
