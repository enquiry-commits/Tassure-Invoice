'use client';

import { useState, useEffect, useCallback } from 'react';

interface Company {
  companyName: string;
  registrationNo: string;
  companyType: string;
  pic: string;
  usesAddressService: boolean;
  hasActiveND: boolean;
  activeNDs: { name: string }[];
  bestEmail: string | null;
  primaryContact: { contactName: string } | null;
  clientStatus: string | null;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
        待同步
      </span>
    );
  }
  const isActive = status.toLowerCase() === 'active';
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: isActive ? '#dcfce7' : '#fef3c7',
        color:            isActive ? '#15803d' : '#92400e',
      }}
    >
      {isActive ? '🟢 ' : '⚪ '}{status}
    </span>
  );
}

interface APIResponse {
  total: number;
  page: number;
  limit: number;
  data: Company[];
}

export default function CompaniesPage() {
  const [data, setData]       = useState<APIResponse | null>(null);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page:   '1',
      limit:  '10000',
      search: search,
      filter: filter,
    });
    const res = await fetch(`/api/companies?${params}`);
    const json: APIResponse = await res.json();
    setData(json);
    setLoading(false);
  }, [search, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filterButtons = [
    { label: 'All',                  value: '' },
    { label: 'Active ND',            value: 'nd' },
    { label: 'Address Service',      value: 'address' },
    { label: 'ND Ceased (No Cover)', value: 'nd-ceased' },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Companies</div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company name or UEN..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <div className="flex gap-2 flex-wrap">
          {filterButtons.map(btn => (
            <button
              key={btn.value}
              onClick={() => setFilter(btn.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: filter === btn.value ? '#1e3a8a' : '#f1f5f9',
                color: filter === btn.value ? '#ffffff' : '#475569',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-sm text-slate-400 ml-auto">
            {data.total} companies
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3" style={{ backgroundColor: '#1e3a8a' }}>
          <h2 className="text-white font-semibold text-sm">Company List</h2>
        </div>

        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['#','Company Name','Status','UEN','Type','Nominee Director','Address Svc','Contact','PIC'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-slate-600"
                    style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', boxShadow: 'inset 0 -1px 0 #f1f5f9' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400">Loading...</td></tr>
              ) : data?.data.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400">No companies found</td></tr>
              ) : data?.data.map((c, i) => (
                <tr key={c.registrationNo || i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800 max-w-56 truncate" title={c.companyName}>
                      {c.companyName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.clientStatus} /></td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{c.registrationNo}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.companyType || '—'}</td>
                  <td className="px-4 py-2.5">
                    {c.hasActiveND ? (
                      <div>
                        {c.activeNDs?.slice(0, 2).map((nd, j) => (
                          <span key={j} className="block text-xs text-green-700 font-medium">{nd.name}</span>
                        ))}
                        {(c.activeNDs?.length ?? 0) > 2 && (
                          <span className="text-xs text-slate-400">+{(c.activeNDs?.length ?? 0) - 2} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.usesAddressService ? (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Yes</span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {c.primaryContact?.contactName || c.bestEmail || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{c.pic || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
