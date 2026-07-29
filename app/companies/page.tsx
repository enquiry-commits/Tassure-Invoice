'use client';

import { useState, useEffect } from 'react';
import { Building2, BriefcaseBusiness, MapPin, UserCheck, Users, UserX } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
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
      borderRadius: 999, background: '#fff', color: palette.color, border: '1px solid #dbe3ec',
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
      background: tone === 'off' ? '#f8fafc' : '#fff', color: palette.color, border: '1px solid #dbe3ec', fontSize: 10.5, fontWeight: 700,
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

  const cards: { key: CompanyCat; label: string; sub: string; color: string; Icon: typeof Building2 }[] = [
    { key: 'all',         label: 'Total Active',        sub: 'Internal CSS Status = Active', color: '#1e3a5f', Icon: Building2 },
    { key: 'css_client',  label: 'Client (CSS Client)', sub: 'TeamWork Client column · may overlap', color: '#0f766e', Icon: BriefcaseBusiness },
    { key: 'shareholder', label: 'Shareholder',         sub: 'TeamWork shareholder · may overlap', color: '#a16207', Icon: Users },
    { key: 'nd',          label: 'Active ND Companies', sub: 'active companies with nominee director', color: '#6d28d9', Icon: UserCheck },
    { key: 'address',     label: 'Address Service',     sub: 'using our registered address', color: '#0369a1', Icon: MapPin },
    { key: 'nd_ceased',   label: 'ND Ceased',           sub: 'no active ND coverage', color: '#be123c', Icon: UserX },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Companies</div>

      {/* Active roster summary — each card filters the same Active-only dataset. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 12, marginBottom: 16, width: '100%' }}>
          {cards.map(c => {
            const active = cat === c.key;
            return (
              <MetricCard
                key={c.key}
                onClick={() => setCat(c.key)}
                active={active}
                value={count(c.key)}
                label={c.label}
                sub={c.sub}
                icon={<c.Icon size={16} />}
                color={c.color}
                ariaLabel={`Filter companies by ${c.label}`}
              />
            );
          })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <input
            type="text"
            placeholder="Search company name or UEN / ROC..."
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
                  <div className="company-name-text">{c.companyName}</div>
                  <div className="company-registration-text" style={{ marginTop: 2 }}>{c.registrationNo}</div>
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
        <div className="system-list-title-bar px-4 py-3">
          <h2 className="system-list-title">Company List</h2>
        </div>

        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="system-list-column-header">
                {['No.','Company Name','Internal CSS Status','UEN / ROC','Company Type','Nominee Director','Address Service','Contact','PIC'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5"
                    style={{ position: 'sticky', top: 0, zIndex: 2, boxShadow: 'inset 0 -1px 0 #16304f' }}>
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
                <tr key={c.registrationNo || i} className="system-list-row border-b">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{startIndex + i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="company-name-text max-w-56 truncate" title={c.companyName}>
                      {c.companyName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.clientStatus} /></td>
                  <td className="px-4 py-2.5 company-registration-text">{c.registrationNo}</td>
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
