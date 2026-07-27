import SectionCard from '@/components/SectionCard';
import AddressServiceTable from '@/components/AddressServiceTable';
import MetricCard from '@/components/MetricCard';
import { supabase } from '@/lib/supabase';
import { Building2, Layers3, MapPin } from 'lucide-react';

// Live view of companies.uses_address (kept current by the daily TeamWork
// sync from each company's registered office address) — this page previously
// read a static build-time JSON snapshot and could never reflect changes.
export const dynamic = 'force-dynamic';

async function getData() {
  const { data } = await supabase
    .from('companies')
    .select('company_name, registration_no, company_type, pic, best_email, primary_contact')
    .eq('uses_address', true)
    .eq('is_active', true)
    .order('company_name');
  return (data ?? []).map(c => ({
    companyName: c.company_name,
    registrationNo: c.registration_no ?? '',
    companyType: c.company_type ?? '',
    pic: c.pic ?? '',
    bestEmail: c.best_email,
    primaryContact: c.primary_contact as { contactName: string; phone: string } | null,
  }));
}

export default async function AddressServicePage() {
  const companies = await getData();

  const byType: Record<string, number> = {};
  companies.forEach(c => {
    const t = c.companyType || 'Unknown';
    byType[t] = (byType[t] || 0) + 1;
  });
  const sortedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const topType = sortedTypes[0];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Address Service</div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <MetricCard
          value={companies.length}
          label="Total Address Service Clients"
          sub="active registered-address clients"
          icon={<Building2 size={16} />}
          color="#1d4ed8"
        />
        <MetricCard
          value={sortedTypes.length}
          label="Company Types"
          sub={topType ? `Largest group: ${topType[0]} · ${topType[1]}` : 'No company type data'}
          icon={<Layers3 size={16} />}
          color="#6d28d9"
        />
        <MetricCard
          value="079903"
          label="Registered Address"
          sub="10 Anson Road · #12-08 International Plaza"
          icon={<MapPin size={16} />}
          color="#0f766e"
        />
      </div>

      {/* Table — client component so it can paginate (100 rows/page) */}
      <SectionCard title="Companies Using Address Service" count={companies.length}>
        <AddressServiceTable companies={companies} />
      </SectionCard>
    </div>
  );
}
