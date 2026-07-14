import SectionCard from '@/components/SectionCard';
import AddressServiceTable from '@/components/AddressServiceTable';
import path from 'path';
import fs from 'fs';

interface Client {
  companyName: string;
  registrationNo: string;
  companyType: string;
  pic: string;
  usesAddressService: boolean;
  bestEmail: string | null;
  primaryContact: { contactName: string; phone: string } | null;
}

async function getData() {
  const dataDir = path.join(process.cwd(), 'data');
  const clients: Client[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'clients_merged.json'), 'utf8'));
  return clients.filter(c => c.usesAddressService);
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
