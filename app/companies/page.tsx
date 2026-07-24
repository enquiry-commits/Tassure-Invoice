'use client';

import { useState, useEffect } from 'react';
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
  isCssClient: boolean;
  isShareholder: boolean;
}

type CompanyCat = 'all' | 'css_client' | 'shareholder' | 'nd' | 'address' | 'nd_ceased';

function matchesCat(c: Company, cat: CompanyCat): boolean {
  switch (cat) {
    case 'css_client':  return c.isCssClient;
    case 'shareholder': return c.isShareholder;
    case 'nd':          return c.hasActiveND;
    case 'address':     return c.usesAddressService;
    case 'nd_ceased':   return c.hadND && !c.hasActiveND;
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

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: '1', limit: '10000', search, filter: '' });
        const res = await fetch(`/api/companies?${params}`, { signal: controller.signal });
        const json: APIResponse = await res.json();
        setData(json);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Failed to load companies', error);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const rows = data?.data ?? [];
  const count = (c: CompanyCat) => rows.filter(r => matchesCat(r, c)).length;
  const filtered = rows.filter(r => matchesCat(r, cat));
  // Search is server-side (full dataset); pagination only caps rendering.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(filtered, `${search}|${cat}`);

  const cards: { key: CompanyCat; label: string; sub: string; color: string; bg: string; border: string }[] = [
    { key: 'all',         label: 'Total Active',        sub: 'Internal CSS Status = Active', color: '#1e3a5f', bg: '#f8fafc', border: '#cbd5e1' },
    { key: 'css_client',  label: 'Client (CSS Client)', sub: 'TeamWork Client column · may overlap', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
    { key: 'shareholder', label: 'Shareholder',         sub: 'TeamWork shareholder · may overlap', color: '#a16207', bg: '#fffbeb', border: '#fde68a' },
    { key: 'nd',          label: 'Active ND Companies', sub: 'active companies with nominee director', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
    { key: 'address',     label: 'Address Service',     sub: 'using our registered address', color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
    { key: 'nd_ceased',   label: 'ND Ceased',           sub: 'no active ND coverage', color: '#be123c', bg: '#fff1f2', border: '#fecdd3' },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Companies</div>

      {/* Active roster summary — each card filters the same Active-only dataset. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 12, marginBottom: 16, width: '100%' }}>
          {cards.map(c => {
            const active = cat === c.key;
            return (
              <button key={c.key} onClick={() => setCat(c.key)} aria-pressed={active}
                style={{ minWidth: 0, minHeight: 94, padding: '15px 18px', textAlign: 'left', cursor: 'pointer',
                  borderRadius: 11, background: c.bg, border: `${active ? 2 : 1}px solid ${active ? c.color : c.border}`,
                  boxShadow: active ? `0 0 0 2px ${c.color}12, 0 2px 5px rgba(15,23,42,.06)` : 'none' }}>
                <div style={{ color: c.color, fontSize: 24, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em' }}>{count(c.key)}</div>
                <div style={{ marginTop: 7, color: '#1e293b', fontSize: 12, fontWeight: 750 }}>{c.label}</div>
                <div style={{ overflow: 'hidden', marginTop: 3, color: '#94a3b8', fontSize: 10.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</div>
              </button>
            );
          })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <input
            type="text"
            placeholder="Search company name or UEN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="min-w-48 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
          />
          <span className="ml-auto text-xs font-medium text-slate-400">{filtered.length} companies shown</span>
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
        <div className="px-4 py-3" style={{ backgroundColor: '#1d3a5c' }}>
          <h2 className="text-white font-semibold text-sm">Company List</h2>
        </div>

        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['#','Company Name','Internal CSS Status','UEN','Type','Nominee Director','Address Svc','Contact','PIC'].map(h => (
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
