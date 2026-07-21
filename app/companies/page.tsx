'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { useIsMobile } from '@/lib/use-is-mobile';

interface Company {
  companyName: string;
  registrationNo: string;
  companyType: string;
  pic: string;
  usesAddressService: boolean;
  hasActiveND: boolean;
  hadND: boolean;
  activeNDs: { name: string }[];
  bestEmail: string | null;
  primaryContact: { contactName: string } | null;
  clientStatus: string | null;
  isShareholder: boolean;
}

type CompanyCat = 'all' | 'active' | 'strike_off' | 'terminated' | 'nd' | 'address' | 'nd_ceased' | 'css_client' | 'shareholder';

const isActiveStatus     = (s: string | null) => (s ?? '').toLowerCase() === 'active';
const isStrikeOffStatus  = (s: string | null) => /strik/i.test(s ?? '');
const isTerminatedStatus = (s: string | null) => /terminat/i.test(s ?? '');
function matchesCat(c: Company, cat: CompanyCat): boolean {
  switch (cat) {
    case 'active':      return isActiveStatus(c.clientStatus);
    case 'strike_off':  return isStrikeOffStatus(c.clientStatus);
    case 'terminated':  return isTerminatedStatus(c.clientStatus);
    case 'nd':          return c.hasActiveND;
    case 'address':     return c.usesAddressService;
    case 'nd_ceased':   return c.hadND && !c.hasActiveND;
    case 'css_client':  return !c.isShareholder;
    case 'shareholder': return c.isShareholder;
    default:            return true;
  }
}

function StatusBadge({ status }: { status: string | null }) {
  const normalized = (status ?? '').toLowerCase();
  const palette = normalized === 'active'
    ? { color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' }
    : /strik/.test(normalized)
      ? { color: '#dc2626', background: '#fef2f2', border: '#fecaca' }
      : /terminat/.test(normalized)
        ? { color: '#b45309', background: '#fff7ed', border: '#fed7aa' }
        : { color: '#64748b', background: '#f8fafc', border: '#e2e8f0' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '4px 9px',
      borderRadius: 999, background: palette.background, color: palette.color, border: `1px solid ${palette.border}`,
      fontSize: 10.5, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: palette.color, flexShrink: 0 }} />
      {status || 'Pending Sync'}
    </span>
  );
}

function CompanyServicePill({ label, tone = 'off' }: { label: string; tone?: 'nd' | 'address' | 'off' }) {
  const palette = tone === 'off'
    ? { color: '#94a3b8', background: '#f8fafc', border: '#e2e8f0' }
    : { color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: '4px 9px', borderRadius: 999,
      background: palette.background, color: palette.color, border: `1px solid ${palette.border}`, fontSize: 10.5, fontWeight: 700,
      lineHeight: 1, whiteSpace: 'nowrap' }} title={label}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: palette.color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
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
  const [cat, setCat]         = useState<CompanyCat>('all');
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', limit: '10000', search, filter: '' });
    const res = await fetch(`/api/companies?${params}`);
    const json: APIResponse = await res.json();
    setData(json);
    setLoading(false);
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = data?.data ?? [];
  const count = (c: CompanyCat) => rows.filter(r => matchesCat(r, c)).length;
  const filtered = rows.filter(r => matchesCat(r, cat));
  // Search is server-side (full dataset); pagination only caps rendering.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(filtered, `${search}|${cat}`);

  const cards: { key: CompanyCat; label: string; sub: string; color: string; bg: string; bd: string }[] = [
    { key: 'all',        label: 'All Companies',  sub: 'total on file',           color: '#1e3a8a', bg: '#f8fafc', bd: '#e2e8f0' },
    { key: 'css_client', label: 'CSS Client',     sub: 'real corp-sec client',    color: '#0f766e', bg: '#f0fdfa', bd: '#99f6e4' },
    { key: 'shareholder', label: 'Shareholder',   sub: 'related entity, not a client', color: '#64748b', bg: '#f8fafc', bd: '#e2e8f0' },
    { key: 'active',     label: 'Active',         sub: 'TeamWork status active',  color: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0' },
    { key: 'strike_off', label: 'Striking Off',   sub: 'in strike-off process',   color: '#dc2626', bg: '#fef2f2', bd: '#fecaca' },
    { key: 'terminated', label: 'Terminated',     sub: 'services terminated',     color: '#b45309', bg: '#fff7ed', bd: '#fed7aa' },
    { key: 'nd',         label: 'Active ND',       sub: 'has a nominee director',  color: '#7c3aed', bg: '#f5f3ff', bd: '#ddd6fe' },
    { key: 'address',    label: 'Address Service', sub: 'uses our address',        color: '#0369a1', bg: '#f0f9ff', bd: '#bae6fd' },
    { key: 'nd_ceased',  label: 'ND Ceased',       sub: 'ND left, no cover now',   color: '#be123c', bg: '#fff1f2', bd: '#fecdd3' },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Companies</div>

      {/* Stat cards — click to filter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 16, width: '100%' }}>
        {cards.map(c => {
          const active = cat === c.key;
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              style={{ textAlign: 'left', cursor: 'pointer', background: c.bg, border: `1.5px solid ${active ? c.color : c.bd}`,
                borderRadius: 10, padding: '12px 16px', width: '100%', minWidth: 0, boxShadow: active ? `0 0 0 2px ${c.color}22` : 'none' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{count(c.key)}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{c.label}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{c.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company name or UEN..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <span className="text-sm text-slate-400 ml-auto">{filtered.length} shown</span>
      </div>

      {/* Phone: view-only card list (desktop table untouched below) */}
      {isMobile ? (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
          ) : pageItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No companies found</div>
          ) : pageItems.map((c, i) => (
            <div key={c.registrationNo || i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, paddingTop: 2 }}>{startIndex + i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}>{c.companyName}</div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', marginTop: 2 }}>{c.registrationNo}</div>
                </div>
                <StatusBadge status={c.clientStatus} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 11.5, color: '#64748b' }}>
                {c.hasActiveND && c.activeNDs?.length > 0
                  ? <CompanyServicePill label={`ND · ${c.activeNDs.map(n => n.name).join(', ')}`} tone="nd" />
                  : <CompanyServicePill label="No active ND" />}
                <CompanyServicePill label={c.usesAddressService ? 'Address service' : 'No address service'} tone={c.usesAddressService ? 'address' : 'off'} />
                {(c.primaryContact?.contactName || c.bestEmail) && <span>{c.primaryContact?.contactName || c.bestEmail}</span>}
                {c.pic && <span>PIC: {c.pic}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
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
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400">No companies found</td></tr>
              ) : pageItems.map((c, i) => (
                <tr key={c.registrationNo || i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{startIndex + i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800 max-w-56 truncate" title={c.companyName}>
                      {c.companyName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.clientStatus} /></td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{c.registrationNo}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.companyType || '—'}</td>
                  <td className="px-4 py-2.5">
                    {c.hasActiveND && c.activeNDs?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {c.activeNDs?.slice(0, 2).map((nd, j) => (
                          <CompanyServicePill key={j} label={nd.name} tone="nd" />
                        ))}
                        {(c.activeNDs?.length ?? 0) > 2 && (
                          <CompanyServicePill label={`+${(c.activeNDs?.length ?? 0) - 2} more`} tone="nd" />
                        )}
                      </div>
                    ) : (
                      <CompanyServicePill label="No active ND" />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <CompanyServicePill label={c.usesAddressService ? 'Active' : 'Not used'} tone={c.usesAddressService ? 'address' : 'off'} />
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
      )}

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />
    </div>
  );
}
