import StatCard from '@/components/StatCard';
import SectionCard from '@/components/SectionCard';
import { Building2, UserCheck, MapPin, AlertTriangle } from 'lucide-react';
import path from 'path';
import fs from 'fs';

interface NDPerson {
  ndName: string;
  memberId: string | null;
  activeCount: number;
  inactiveCount: number;
  appointments: {
    companyName: string;
    appointmentDate: string;
    cessationDate: string;
    isActive: boolean;
  }[];
}

interface NDCompany {
  companyName: string;
  hasActiveND: boolean;
  ndPersons: { name: string; appointmentDate: string; cessationDate: string; isActive: boolean }[];
  activeNDs: unknown[];
  inactiveNDs: { name: string; cessationDate: string }[];
}

async function getData() {
  const dataDir = path.join(process.cwd(), 'data');
  const clients: Record<string, unknown>[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'clients_merged.json'), 'utf8'));
  const ndByCompany: NDCompany[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'nd_by_company.json'), 'utf8'));
  const ndPersons: NDPerson[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'nd_from_individuals.json'), 'utf8'));
  return { clients, ndByCompany, ndPersons };
}

export default async function DashboardPage() {
  const { clients, ndByCompany, ndPersons } = await getData();

  const totalClients      = clients.length;
  const withAddress       = clients.filter(c => c.usesAddressService).length;
  const activeNDCompanies = ndByCompany.filter(c => c.hasActiveND).length;
  const ceasedOnly        = ndByCompany.filter(c => !c.hasActiveND && c.ndPersons.length > 0);

  // Top NDs by active count
  const topNDs = [...ndPersons]
    .filter(p => p.activeCount > 0)
    .sort((a, b) => b.activeCount - a.activeCount)
    .slice(0, 8);

  // Recently ceased (within 6 months from today)
  const today = new Date();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  function parseDate(s: string) {
    if (!s) return null;
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
  }

  const recentCeased: { company: string; nd: string; date: string }[] = [];
  ceasedOnly.forEach(c => {
    c.inactiveNDs.forEach(nd => {
      const d = parseDate(nd.cessationDate);
      if (d && d >= sixMonthsAgo) {
        recentCeased.push({ company: c.companyName, nd: nd.name, date: nd.cessationDate });
      }
    });
  });
  recentCeased.sort((a, b) => (parseDate(b.date)?.getTime() ?? 0) - (parseDate(a.date)?.getTime() ?? 0));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-slate-500">Dashboard</div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value={totalClients}      label="Total Clients"        color="orange" Icon={Building2}      />
        <StatCard value={activeNDCompanies} label="Active ND Companies"  color="yellow" Icon={UserCheck}      />
        <StatCard value={withAddress}       label="Address Service"      color="gray"   Icon={MapPin}         />
        <StatCard value={ceasedOnly.length} label="ND Ceased (No Cover)" color="red"    Icon={AlertTriangle}  />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* ND Person Summary */}
        <SectionCard title="Nominee Director Summary" count={ndPersons.filter(p => p.activeCount > 0).length}>
          <div className="space-y-2">
            {topNDs.map(p => (
              <div key={p.ndName} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-sm font-medium text-slate-700">{p.ndName}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    {p.activeCount} active
                  </span>
                  {p.inactiveCount > 0 && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      {p.inactiveCount} ceased
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Recently Ceased ND Alert */}
        <SectionCard title="ND Ceased — No Replacement" count={ceasedOnly.length}>
          {recentCeased.length === 0 ? (
            <p className="text-sm text-slate-400">No recent cessations in last 6 months.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {recentCeased.slice(0, 20).map((item, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-red-500 mt-0.5 flex-shrink-0">⚠</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-700 truncate">{item.company}</div>
                    <div className="text-xs text-slate-400">{item.nd} · Ceased {item.date}</div>
                  </div>
                </div>
              ))}
              {recentCeased.length > 20 && (
                <p className="text-xs text-slate-400 text-center pt-1">
                  +{recentCeased.length - 20} more companies
                </p>
              )}
            </div>
          )}
        </SectionCard>

        {/* Address Service breakdown */}
        <SectionCard title="Address Service" count={withAddress}>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Using 10 Anson Road #12-08</span>
              <span className="font-bold text-slate-800">{withAddress}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Not using address service</span>
              <span className="font-bold text-slate-800">{totalClients - withAddress}</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(withAddress / totalClients * 100)}%`, backgroundColor: '#1d4ed8' }}
              />
            </div>
            <p className="text-xs text-slate-400 text-right">
              {Math.round(withAddress / totalClients * 100)}% of clients
            </p>
          </div>
        </SectionCard>

        {/* Quick links */}
        <SectionCard title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'View All Companies',       href: '/companies',         color: '#1d4ed8' },
              { label: 'Nominee Directors Report', href: '/nominee-directors', color: '#16a34a' },
              { label: 'Address Service List',     href: '/address-service',   color: '#d97706' },
              { label: 'Generate Billing Draft',   href: '/billing',           color: '#dc2626' },
            ].map(({ label, href, color }) => (
              <a
                key={href}
                href={href}
                className="block text-center text-sm text-white font-medium py-2.5 px-3 rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: color }}
              >
                {label}
              </a>
            ))}
          </div>
        </SectionCard>

      </div>
    </div>
  );
}
