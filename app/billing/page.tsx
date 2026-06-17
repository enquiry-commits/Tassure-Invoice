'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, FileText, Building2, Users, MapPin } from 'lucide-react';

interface Invoice {
  invoice_no: string;
  txn_date:   string;
  total_amt:  number;
  balance:    number;
  status:     string;
}

interface CompanyResult {
  companyId:     number;
  companyName:   string;
  services: {
    ar:      boolean;
    agm:     boolean;
    nd:      boolean;
    address: boolean;
  };
  arStatus:      string | null;
  arDueDate:     string | null;
  agmStatus:     string | null;
  agmDueDate:    string | null;
  billingStatus: 'NOT_BILLED' | 'PAID' | 'INVOICED_UNPAID' | 'UNKNOWN';
  invoiceCount:  number;
  totalBilled:   number;
  invoices:      Invoice[];
}

interface Summary {
  year:           string;
  type:           string;
  total:          number;
  notBilled:      number;
  paid:           number;
  invoicedUnpaid: number;
}

const STATUS_CONFIG = {
  NOT_BILLED:      { label: 'Not Billed',  color: '#dc2626', bg: '#fef2f2', Icon: AlertTriangle },
  PAID:            { label: 'Paid',        color: '#16a34a', bg: '#f0fdf4', Icon: CheckCircle  },
  INVOICED_UNPAID: { label: 'Invoice Sent',color: '#d97706', bg: '#fffbeb', Icon: Clock        },
  UNKNOWN:         { label: 'Unknown',     color: '#64748b', bg: '#f8fafc', Icon: FileText     },
};

const AR_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  Completed: { bg: '#f0fdf4', color: '#16a34a' },
  Pending:   { bg: '#fffbeb', color: '#d97706' },
  Dispense:  { bg: '#f0f9ff', color: '#0284c7' },
  Dissolved: { bg: '#f8fafc', color: '#64748b' },
};

export default function BillingPage() {
  const [data, setData]         = useState<{ summary: Summary; companies: CompanyResult[] } | null>(null);
  const [loading, setLoading]   = useState(false);
  const [year, setYear]         = useState(new Date().getFullYear().toString());
  const [type, setType]         = useState('all');
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const res  = await fetch(`/api/billing/compare?year=${year}&type=${type}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = (data?.companies ?? []).filter(c => {
    if (filter !== 'all' && c.billingStatus !== filter) return false;
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Billing Comparison</h1>
          <p className="text-sm text-slate-500 mt-0.5">Annual Return · AGM · Nominee Director · Address Service vs QB Invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
          >
            {['2026','2025','2024'].map(y => <option key={y}>{y}</option>)}
          </select>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All Services</option>
            <option value="ar">Annual Return</option>
            <option value="agm">AGM</option>
            <option value="nd">Nominee Director</option>
            <option value="address">Address Service</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm font-medium text-white px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1d3a5c' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Companies',  value: data.summary.total,          color: '#1d3a5c' },
            { label: 'Not Billed',       value: data.summary.notBilled,      color: '#dc2626' },
            { label: 'Invoiced Unpaid',  value: data.summary.invoicedUnpaid, color: '#d97706' },
            { label: 'Paid',             value: data.summary.paid,           color: '#16a34a' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
              <div className="text-sm text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-4 p-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
        />
        {(['all','NOT_BILLED','INVOICED_UNPAID','PAID'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              backgroundColor: filter === s ? '#1d3a5c' : '#f1f5f9',
              color:           filter === s ? '#ffffff' : '#475569',
            }}
          >
            {s === 'all' ? `All (${data?.summary.total ?? 0})` : STATUS_CONFIG[s].label}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} shown</span>
      </div>

      {/* Company list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-slate-400 text-sm">Loading comparison data…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">No results.</div>
        )}
        {!loading && filtered.map((company, i) => {
          const cfg    = STATUS_CONFIG[company.billingStatus];
          const isOpen = expanded === company.companyId;
          return (
            <div
              key={company.companyId}
              style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none' }}
            >
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpanded(isOpen ? null : company.companyId)}
              >
                <cfg.Icon size={15} style={{ color: cfg.color, flexShrink: 0 }} />
                <span className="flex-1 text-sm font-medium text-slate-700 truncate">{company.companyName}</span>

                {/* Service badges */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {company.services.ar && (
                    <span className="flex items-center gap-0.5 text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-full">
                      <Building2 size={10} />AR
                    </span>
                  )}
                  {company.services.agm && (
                    <span className="flex items-center gap-0.5 text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full">
                      <Building2 size={10} />AGM
                    </span>
                  )}
                  {company.services.nd && (
                    <span className="flex items-center gap-0.5 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                      <Users size={10} />ND
                    </span>
                  )}
                  {company.services.address && (
                    <span className="flex items-center gap-0.5 text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full">
                      <MapPin size={10} />Addr
                    </span>
                  )}
                </div>

                {/* AR / AGM status from Teamwork */}
                {company.arStatus && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={AR_STATUS_COLOR[company.arStatus] ?? { bg: '#f8fafc', color: '#64748b' }}
                  >
                    AR: {company.arStatus}
                  </span>
                )}
                {company.agmStatus && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={AR_STATUS_COLOR[company.agmStatus] ?? { bg: '#f8fafc', color: '#64748b' }}
                  >
                    AGM: {company.agmStatus}
                  </span>
                )}

                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cfg.bg, color: cfg.color }}
                >
                  {cfg.label}
                </span>
                {company.invoiceCount > 0 && (
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {company.invoiceCount} inv · ${company.totalBilled.toLocaleString()}
                  </span>
                )}
              </div>

              {isOpen && (
                <div className="px-10 pb-4 pt-1">
                  {/* Service detail row */}
                  <div className="flex gap-4 mb-3 text-xs text-slate-500 flex-wrap">
                    {company.services.ar && (
                      <span>
                        AR Due: <strong>{company.arDueDate ?? '—'}</strong>
                        {company.arStatus ? ` · ${company.arStatus}` : ''}
                      </span>
                    )}
                    {company.services.agm && (
                      <span>
                        AGM Due: <strong>{company.agmDueDate ?? '—'}</strong>
                        {company.agmStatus ? ` · ${company.agmStatus}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Invoice table */}
                  {company.invoices.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left py-1 pr-4 font-medium">Invoice No.</th>
                          <th className="text-left py-1 pr-4 font-medium">Date</th>
                          <th className="text-right py-1 pr-4 font-medium">Amount</th>
                          <th className="text-left py-1 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {company.invoices.map(inv => (
                          <tr key={inv.invoice_no} className="border-t border-slate-50">
                            <td className="py-1.5 pr-4 font-mono text-slate-600">{inv.invoice_no}</td>
                            <td className="py-1.5 pr-4 text-slate-500">{inv.txn_date}</td>
                            <td className="py-1.5 pr-4 text-right font-medium text-slate-700">
                              ${(inv.total_amt ?? 0).toLocaleString()}
                            </td>
                            <td className="py-1.5">
                              <span
                                className="px-1.5 py-0.5 rounded text-xs font-medium"
                                style={{
                                  backgroundColor: inv.status === 'Paid' ? '#f0fdf4' : inv.status === 'Overdue' ? '#fef2f2' : '#fffbeb',
                                  color: inv.status === 'Paid' ? '#16a34a' : inv.status === 'Overdue' ? '#dc2626' : '#d97706',
                                }}
                              >
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-400">No QB invoices found for {year}.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
