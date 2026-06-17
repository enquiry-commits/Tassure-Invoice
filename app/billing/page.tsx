'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Info } from 'lucide-react';

interface Invoice {
  invoice_no: string;
  txn_date:   string;
  total_amt:  number;
  balance:    number;
  status:     string;
}

interface CompanyResult {
  companyId:       number;
  companyName:     string;
  services: {
    ar:      boolean;
    agm:     boolean;
    nd:      boolean;
    address: boolean;
  };
  arStatus:        string | null;
  arDueDate:       string | null;
  agmStatus:       string | null;
  agmDueDate:      string | null;
  ndAppointedDate: string | null;
  ndRenewalDate:   string | null;
  ndRenewalPast:   boolean;
  billingStatus:   'NOT_BILLED' | 'PAID' | 'INVOICED_UNPAID' | 'UNKNOWN';
  invoiceCount:    number;
  totalBilled:     number;
  invoices:        Invoice[];
}

interface Summary {
  year:           string;
  type:           string;
  total:          number;
  notBilled:      number;
  paid:           number;
  invoicedUnpaid: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INVOICE_STATUS = {
  NOT_BILLED:      { label: 'Not Billed',   bg: '#fef2f2', color: '#dc2626', dot: '#dc2626' },
  PAID:            { label: 'Paid',          bg: '#f0fdf4', color: '#16a34a', dot: '#16a34a' },
  INVOICED_UNPAID: { label: 'Invoice Sent',  bg: '#fffbeb', color: '#b45309', dot: '#f59e0b' },
  UNKNOWN:         { label: 'Unknown',       bg: '#f8fafc', color: '#64748b', dot: '#94a3b8' },
};

const FILING_STATUS_STYLE: Record<string, { color: string }> = {
  Completed: { color: '#16a34a' },
  Pending:   { color: '#b45309' },
  Dispense:  { color: '#0284c7' },
  Dissolved: { color: '#94a3b8' },
};

function FilingCell({ status, date }: { status: string | null; date: string | null }) {
  if (!status && !date) return <span className="text-slate-300">—</span>;
  const style = FILING_STATUS_STYLE[status ?? ''] ?? { color: '#64748b' };
  return (
    <div className="flex flex-col gap-0.5">
      {status && <span className="text-xs font-medium" style={{ color: style.color }}>{status}</span>}
      {date   && <span className="text-xs text-slate-400">{date}</span>}
    </div>
  );
}

function NdCell({ renewal, past }: { renewal: string | null; past: boolean }) {
  if (!renewal) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium" style={{ color: past ? '#b45309' : '#64748b' }}>
        {past ? 'Renewal Due' : 'Upcoming'}
      </span>
      <span className="text-xs text-slate-400">{renewal}</span>
    </div>
  );
}

function ServiceTags({ s }: { s: CompanyResult['services'] }) {
  const tags = [
    s.ar      && { label: 'Annual Return',      key: 'ar'  },
    s.agm     && { label: 'AGM',                key: 'agm' },
    s.nd      && { label: 'Nominee Director',   key: 'nd'  },
    s.address && { label: 'Address Service',    key: 'addr'},
  ].filter(Boolean) as { label: string; key: string }[];

  if (tags.length === 0) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(t => (
        <span key={t.key} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">
          {t.label}
        </span>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [data, setData]         = useState<{ summary: Summary; companies: CompanyResult[] } | null>(null);
  const [loading, setLoading]   = useState(false);
  const [year, setYear]         = useState(new Date().getFullYear().toString());
  const [type, setType]         = useState('all');
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc');

  async function load() {
    setLoading(true);
    const res  = await fetch(`/api/billing/compare?year=${year}&type=${type}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const ORDER = { NOT_BILLED: 0, INVOICED_UNPAID: 1, UNKNOWN: 2, PAID: 3 };

  const filtered = (data?.companies ?? [])
    .filter(c => {
      if (filter !== 'all' && c.billingStatus !== filter) return false;
      if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const byStatus = ORDER[a.billingStatus] - ORDER[b.billingStatus];
      if (byStatus !== 0) return sortDir === 'asc' ? byStatus : -byStatus;
      return a.companyName.localeCompare(b.companyName);
    });

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Billing Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Comparing Teamwork service records against QuickBooks invoices for {year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
            {['2026','2025','2024'].map(y => <option key={y}>{y}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
            <option value="all">All Services</option>
            <option value="ar">Annual Return only</option>
            <option value="agm">AGM only</option>
            <option value="nd">Nominee Director only</option>
            <option value="address">Address Service only</option>
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-sm font-medium text-white px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#1d3a5c' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards — plain and labeled */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Total Companies',       sub: 'with active services',     value: data.summary.total,          bg: '#f8fafc', color: '#1d3a5c' },
            { label: 'Not Yet Billed',         sub: 'no invoice in QuickBooks', value: data.summary.notBilled,      bg: '#fef2f2', color: '#dc2626' },
            { label: 'Invoice Sent, Unpaid',   sub: 'awaiting payment',         value: data.summary.invoicedUnpaid, bg: '#fffbeb', color: '#b45309' },
            { label: 'Paid',                   sub: 'invoice settled',          value: data.summary.paid,           bg: '#f0fdf4', color: '#16a34a' },
          ].map(({ label, sub, value, bg, color }) => (
            <div key={label} className="rounded-xl p-4 border border-slate-100 shadow-sm" style={{ backgroundColor: bg }}>
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
              <div className="text-sm font-medium mt-0.5 text-slate-700">{label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Legend toggle */}
      <button onClick={() => setShowLegend(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 mb-3">
        <Info size={13} /> {showLegend ? 'Hide' : 'Show'} column guide
      </button>

      {showLegend && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-xs text-slate-600 grid grid-cols-2 gap-x-8 gap-y-2">
          <div><strong>Services</strong> — Which Tassure services this company is subscribed to</div>
          <div><strong>Annual Return (AR)</strong> — Statutory filing with ACRA; Teamwork tracks due date &amp; filing status</div>
          <div><strong>AGM</strong> — Annual General Meeting; separate statutory event, also tracked in Teamwork</div>
          <div><strong>ND Renewal</strong> — Nominee Director service renews annually on the appointment anniversary</div>
          <div><strong>AR / AGM Status</strong> — <span style={{color:'#16a34a'}}>Completed</span> = filed, <span style={{color:'#b45309'}}>Pending</span> = not yet filed</div>
          <div><strong>Invoice Status</strong> — <span style={{color:'#dc2626'}}>Not Billed</span> = no QB invoice found · <span style={{color:'#b45309'}}>Invoice Sent</span> = sent but unpaid · <span style={{color:'#16a34a'}}>Paid</span> = settled</div>
        </div>
      )}

      {/* Filter + search */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm mb-4 px-3 py-2.5 flex items-center gap-3">
        <input type="text" placeholder="Search by company name…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-slate-400" />
        {([
          { key: 'all',             label: `All  (${data?.summary.total ?? 0})` },
          { key: 'NOT_BILLED',      label: 'Not Billed' },
          { key: 'INVOICED_UNPAID', label: 'Invoice Sent' },
          { key: 'PAID',            label: 'Paid' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors"
            style={{
              backgroundColor: filter === key ? '#1d3a5c' : '#f1f5f9',
              color:           filter === key ? '#fff'    : '#475569',
            }}>
            {label}
          </button>
        ))}
        <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded-lg border border-slate-200 whitespace-nowrap">
          Sort: {sortDir === 'asc' ? 'Not Billed first ↓' : 'Paid first ↓'}
        </button>
        <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">{filtered.length} companies</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-6 px-3 py-3"></th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Company Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">Services</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">Annual Return</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">AGM</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">ND Renewal</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">Invoice Status</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">Billed {year}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-16 text-slate-400 text-sm">Loading data…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16 text-slate-400 text-sm">No companies found.</td></tr>
              )}
              {!loading && filtered.map((company, i) => {
                const cfg    = INVOICE_STATUS[company.billingStatus];
                const isOpen = expanded === company.companyId;
                return (
                  <>
                    <tr key={company.companyId}
                      onClick={() => setExpanded(isOpen ? null : company.companyId)}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                      style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>

                      {/* Expand toggle */}
                      <td className="px-3 py-3.5 text-slate-300">
                        {company.invoices.length > 0
                          ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                          : null}
                      </td>

                      {/* Company name */}
                      <td className="px-4 py-3.5 font-medium text-slate-800 max-w-xs">
                        <span className="block truncate">{company.companyName}</span>
                      </td>

                      {/* Services */}
                      <td className="px-4 py-3.5">
                        <ServiceTags s={company.services} />
                      </td>

                      {/* Annual Return status + due date */}
                      <td className="px-4 py-3.5 text-center">
                        <FilingCell status={company.arStatus} date={company.arDueDate} />
                      </td>

                      {/* AGM status + due date */}
                      <td className="px-4 py-3.5 text-center">
                        <FilingCell status={company.agmStatus} date={company.agmDueDate} />
                      </td>

                      {/* ND renewal */}
                      <td className="px-4 py-3.5 text-center">
                        <NdCell renewal={company.ndRenewalDate} past={company.ndRenewalPast} />
                      </td>

                      {/* Invoice status — most important column */}
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
                          {cfg.label}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3.5 text-right text-slate-700 whitespace-nowrap">
                        {company.invoiceCount > 0
                          ? <span className="font-medium">${company.totalBilled.toLocaleString()} <span className="text-slate-400 font-normal text-xs">({company.invoiceCount})</span></span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>

                    {/* Expanded QB invoice detail */}
                    {isOpen && company.invoices.length > 0 && (
                      <tr key={`${company.companyId}-detail`} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td colSpan={8} className="px-12 py-3 bg-slate-50">
                          <p className="text-xs font-semibold text-slate-500 mb-2">QuickBooks Invoices — {year}</p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400">
                                <th className="text-left py-1 pr-8 font-medium">Invoice No.</th>
                                <th className="text-left py-1 pr-8 font-medium">Date</th>
                                <th className="text-right py-1 pr-8 font-medium">Amount</th>
                                <th className="text-left py-1 font-medium">Payment Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {company.invoices.map(inv => (
                                <tr key={inv.invoice_no} className="border-t border-slate-100">
                                  <td className="py-1.5 pr-8 font-mono text-slate-600">{inv.invoice_no}</td>
                                  <td className="py-1.5 pr-8 text-slate-500">{inv.txn_date}</td>
                                  <td className="py-1.5 pr-8 text-right font-medium text-slate-700">
                                    ${(inv.total_amt ?? 0).toLocaleString()}
                                  </td>
                                  <td className="py-1.5">
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                                      style={{
                                        backgroundColor: inv.status === 'Paid' ? '#f0fdf4' : inv.status === 'Overdue' ? '#fef2f2' : '#fffbeb',
                                        color: inv.status === 'Paid' ? '#16a34a' : inv.status === 'Overdue' ? '#dc2626' : '#b45309',
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
