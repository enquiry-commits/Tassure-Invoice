import SectionCard from '@/components/SectionCard';
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

      {/* Table */}
      <SectionCard title="Companies Using Address Service" count={companies.length}>
        <div className="overflow-x-auto -mx-4 -mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600 w-8">#</th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Company Name</th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600">UEN</th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Type</th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Contact</th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600">PIC</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c, i) => (
                <tr key={c.registrationNo || i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800 max-w-64">
                    <span className="truncate block" title={c.companyName}>{c.companyName}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{c.registrationNo}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.companyType || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {c.primaryContact?.contactName || c.bestEmail || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{c.pic || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
