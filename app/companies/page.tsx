'use client';

import { useState, useEffect } from 'react';
import { Building2, CheckCircle2, MapPin, UserRoundCheck, UserRoundX, type LucideIcon } from 'lucide-react';
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
}

type CompanyCat = 'all' | 'nd' | 'address' | 'nd_ceased';

function matchesCat(c: Company, cat: CompanyCat): boolean {
  switch (cat) {
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

  const cards: { key: CompanyCat; label: string; sub: string; color: string; soft: string; icon: LucideIcon }[] = [
    { key: 'all',       label: 'Active Companies', sub: 'complete active roster', color: '#15803d', soft: '#f0fdf4', icon: Building2 },
    { key: 'nd',        label: 'Active ND',        sub: 'nominee director on file', color: '#6d28d9', soft: '#f5f3ff', icon: UserRoundCheck },
    { key: 'address',   label: 'Address Service',  sub: 'using our registered address', color: '#0369a1', soft: '#f0f9ff', icon: MapPin },
    { key: 'nd_ceased', label: 'ND Ceased',        sub: 'no active ND coverage', color: '#be123c', soft: '#fff1f2', icon: UserRoundX },
  ];

  return (
    <div>
      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Dashboard / Companies</div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Company Directory</h1>
            <p className="mt-1 text-xs text-slate-500">A single operational view of companies currently managed by the corporate services team.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={15} />
            Internal CSS Status · Active only
          </div>
        </div>

        {/* One connected metric strip — every item is also a table filter. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
          {cards.map((c, index) => {
            const active = cat === c.key;
            const Icon = c.icon;
            return (
              <button key={c.key} onClick={() => setCat(c.key)} aria-pressed={active}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 13, minWidth: 0, padding: '15px 18px',
                  textAlign: 'left', cursor: 'pointer', background: active ? c.soft : '#fff', border: 0,
                  borderRight: index < cards.length - 1 ? '1px solid #f1f5f9' : 0,
                  boxShadow: active ? `inset 0 -3px 0 ${c.color}` : 'none' }}>
                <span style={{ display: 'inline-flex', width: 38, height: 38, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 11, color: c.color, background: c.soft, border: `1px solid ${c.color}20` }}>
                  <Icon size={19} strokeWidth={2} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ color: '#0f172a', fontSize: 22, lineHeight: 1, letterSpacing: '-0.03em' }}>{count(c.key)}</strong>
                    <span style={{ color: '#334155', fontSize: 12, fontWeight: 750 }}>{c.label}</span>
                  </span>
                  <span style={{ display: 'block', overflow: 'hidden', marginTop: 5, color: '#94a3b8', fontSize: 10.5,
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          <input
            type="text"
            placeholder="Search company name or UEN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="min-w-48 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
          />
          <span className="ml-auto text-xs font-medium text-slate-400">{filtered.length} companies shown</span>
        </div>
      </section>

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
