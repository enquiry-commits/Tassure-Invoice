import SectionCard from '@/components/SectionCard';
import AddressServiceTable from '@/components/AddressServiceTable';
import { supabase } from '@/lib/supabase';

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

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Address Service</div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-3xl font-bold text-blue-700">{companies.length}</div>
          <div className="text-sm text-slate-500 mt-1">Total Address Service Clients</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-600 mb-2">By Company Type</div>
          {Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, count]) => (
            <div key={type} className="flex justify-between text-xs text-slate-500 py-0.5">
              <span>{type}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-600 mb-1">Registered Address</div>
          <div className="text-xs text-slate-500 leading-relaxed">
            10 Anson Road<br />
            #12-08 International Plaza<br />
            Singapore 079903
          </div>
        </div>
      </div>

      {/* Table — client component so it can paginate (100 rows/page) */}
      <SectionCard title="Companies Using Address Service" count={companies.length}>
        <AddressServiceTable companies={companies} />
      </SectionCard>
    </div>
  );
}
