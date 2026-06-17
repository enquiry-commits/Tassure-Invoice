'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, FileText, ChevronDown, ChevronRight } from 'lucide-react';

interface Invoice {
  invoice_no: string;
  txn_date:   string;
  total_amt:  number;
  balance:    number;
  status:     string;
}

interface CompanyResult {
  companyId:    number;
  companyName:  string;
  services: {
    ar:      boolean;
    agm:     boolean;
    nd:      boolean;
    address: boolean;
  };
  arStatus:    string | null;
  arDueDate:   string | null;
  agmStatus:   string | null;
  agmDueDate:  string | null;
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

const BILLING_CFG = {
  NOT_BILLED:      { label: 'Not Billed',   color: '#dc2626', bg: '#fef2f2', Icon: AlertTriangle },
  PAID:            { label: 'Paid',          color: '#16a34a', bg: '#f0fdf4', Icon: CheckCircle  },
  INVOICED_UNPAID: { label: 'Invoice Sent',  color: '#d97706', bg: '#fffbeb', Icon: Clock        },
  UNKNOWN:         { label: 'Unknown',       color: '#64748b', bg: '#f8fafc', Icon: FileText     },
};

const EVENT_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Completed: { bg: '#f0fdf4', color: '#16a34a' },
  Pending:   { bg: '#fffbeb', color: '#d97706' },
  Dispense:  { bg: '#f0f9ff', color: '#0284c7' },
  Dissolved: { bg: '#f1f5f9', color: '#64748b' },
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-300 text-xs">—</span>;
  const s = EVENT_STATUS_STYLE[status] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function ServiceDot({ active, label, color }: { active: boolean; label: string; color: string }) {
  if (!active) return <span className="text-slate-200 text-xs font-medium w-8 text-center inline-block">—</span>;
  return (
    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: color + '18', color }}>
      {label}
    </span>
  );
}

export default function BillingPage() {
  const [data, setData]         = useState<{ summary: Summary; companies: CompanyResult[] } | null>(null);
  const [loading, setLoading]   = useState(false);
  const [year, setYear]         = useState(new Date().getFullYear().toString());
  const [type, setType]         = useState('all');
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sortCol, setSortCol]   = useState<'name' | 'billing' | 'amount'>('name');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc');

  async function load() {
    setLoading(true);
    const res  = await fetch(`/api/billing/compare?year=${year}&type=${type}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const filtered = (data?.companies ?? [])
    .filter(c => {
      if (filter !== 'all' && c.billingStatus !== filter) return false;
      if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'name')    cmp = a.companyName.localeCompare(b.companyName);
      if (sortCol === 'billing') cmp = a.billingStatus.localeCompare(b.billingStatus);
      if (sortCol === 'amount')  cmp = a.totalBilled - b.totalBilled;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const SortIcon = ({ col }: { col: typeof sortCol }) =>
    sortCol === col
      ? <span className="ml-0.5 text-slate-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
      : <span className="ml-0.5 text-slate-200">↕</span>;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Billing Comparison</h1>
          <p className="text-sm text-slate-500 mt-0.5">AR · AGM · ND · Address Service — cross-checked against QB invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            {['2026','2025','2024'].map(y => <option key={y}>{y}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <option value="all">All Services</option>
            <option value="ar">Annual Return</option>
            <option value="agm">AGM</option>
            <option value="nd">Nominee Director</option>
            <option value="address">Address Service</option>
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-sm font-medium text-white px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#1d3a5c' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Total',          value: data.summary.total,          color: '#1d3a5c' },
            { label: 'Not Billed',     value: data.summary.notBilled,      color: '#dc2626' },
            { label: 'Invoice Sent',   value: data.summary.invoicedUnpaid, color: '#d97706' },
            { label: 'Paid',           value: data.summary.paid,           color: '#16a34a' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter + search bar */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm mb-4 px-3 py-2.5 flex items-center gap-3">
        <input type="text" placeholder="Search company…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400" />
        {(['all','NOT_BILLED','INVOICED_UNPAID','PAID'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            style={{ backgroundColor: filter === s ? '#1d3a5c' : '#f1f5f9', color: filter === s ? '#fff' : '#475569' }}>
            {s === 'all' ? `All (${data?.summary.total ?? 0})` : BILLING_CFG[s].label}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">{filtered.length} companies</span>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-6"></th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 cursor-pointer select-none"
                  onClick={() => toggleSort('name')}>
                  Company <SortIcon col="name" />
                </th>
                {/* Service columns */}
                <th className="text-center px-3 py-3 font-semibold text-purple-600 whitespace-nowrap">AR</th>
                <th className="text-center px-3 py-3 font-semibold text-orange-500 whitespace-nowrap">AGM</th>
                <th className="text-center px-3 py-3 font-semibold text-blue-600 whitespace-nowrap">ND</th>
                <th className="text-center px-3 py-3 font-semibold text-green-600 whitespace-nowrap">Address</th>
                {/* Teamwork status */}
                <th className="text-center px-3 py-3 font-semibold text-slate-500 whitespace-nowrap">AR Status</th>
                <th className="text-center px-3 py-3 font-semibold text-slate-500 whitespace-nowrap">AGM Status</th>
                {/* QB billing */}
                <th className="text-center px-3 py-3 font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort('billing')}>
                  QB Status <SortIcon col="billing" />
                </th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort('amount')}>
                  Billed {year} <SortIcon col="amount" />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">No results.</td></tr>
              )}
              {!loading && filtered.map((company, i) => {
                const cfg    = BILLING_CFG[company.billingStatus];
                const isOpen = expanded === company.companyId;
                return (
                  <>
                    <tr
                      key={company.companyId}
                      onClick={() => setExpanded(isOpen ? null : company.companyId)}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                      style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}
                    >
                      {/* Expand toggle */}
                      <td className="px-4 py-3 text-slate-300">
                        {company.invoices.length > 0
                          ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                          : null}
                      </td>

                      {/* Company name */}
                      <td className="px-4 py-3 font-medium text-slate-700 max-w-xs">
                        <span className="truncate block">{company.companyName}</span>
                      </td>

                      {/* Services */}
                      <td className="px-3 py-3 text-center">
                        <ServiceDot active={company.services.ar}      label="AR"   color="#9333ea" />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ServiceDot active={company.services.agm}     label="AGM"  color="#f97316" />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ServiceDot active={company.services.nd}      label="ND"   color="#2563eb" />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ServiceDot active={company.services.address} label="Addr" color="#16a34a" />
                      </td>

                      {/* Teamwork statuses + due dates */}
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <StatusPill status={company.arStatus} />
                          {company.arDueDate && (
                            <span className="text-xs text-slate-400">{company.arDueDate}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <StatusPill status={company.agmStatus} />
                          {company.agmDueDate && (
                            <span className="text-xs text-slate-400">{company.agmDueDate}</span>
                          )}
                        </div>
                      </td>

                      {/* QB billing status */}
                      <td className="px-3 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                          <cfg.Icon size={11} />
                          {cfg.label}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right text-slate-700 font-medium whitespace-nowrap">
                        {company.invoiceCount > 0
                          ? <>${company.totalBilled.toLocaleString()} <span className="text-slate-400 font-normal text-xs">({company.invoiceCount})</span></>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>

                    {/* Expanded invoice sub-table */}
                    {isOpen && company.invoices.length > 0 && (
                      <tr key={`${company.companyId}-expanded`} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td colSpan={10} className="px-12 py-3 bg-slate-50">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400">
                                <th className="text-left py-1 pr-6 font-medium">Invoice No.</th>
                                <th className="text-left py-1 pr-6 font-medium">Date</th>
                                <th className="text-right py-1 pr-6 font-medium">Amount</th>
                                <th className="text-left py-1 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {company.invoices.map(inv => (
                                <tr key={inv.invoice_no} className="border-t border-slate-100">
                                  <td className="py-1.5 pr-6 font-mono text-slate-600">{inv.invoice_no}</td>
                                  <td className="py-1.5 pr-6 text-slate-500">{inv.txn_date}</td>
                                  <td className="py-1.5 pr-6 text-right font-medium text-slate-700">
                                    ${(inv.total_amt ?? 0).toLocaleString()}
                                  </td>
                                  <td className="py-1.5">
                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                                      style={{
                                        backgroundColor: inv.status === 'Paid' ? '#f0fdf4' : inv.status === 'Overdue' ? '#fef2f2' : '#fffbeb',
                                        color: inv.status === 'Paid' ? '#16a34a' : inv.status === 'Overdue' ? '#dc2626' : '#d97706',
                                      }}>
                                      {inv.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
