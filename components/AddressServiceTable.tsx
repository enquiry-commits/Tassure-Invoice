'use client';

import { useMemo, useState } from 'react';
import { usePagination, PaginationBar } from './Pagination';
import { formatStaffName } from '@/lib/staff-directory';
import { ADDRESS_SERVICE_LOCATIONS, addressLocationLabel } from '@/lib/address-service';

interface Row {
  companyName: string;
  registrationNo: string;
  companyType: string;
  pic: string;
  bestEmail: string | null;
  primaryContact: { contactName: string; phone: string } | null;
  addressLocation: string | null;
}

// Client-side paginated table for the (server-rendered) Address Service page.
// Vincent's boss, 2026-09-07: 5 real address-service locations, not just
// one — added a Location column + filter so ACC/whoever can see (and find)
// which clients are at which of ours.
export default function AddressServiceTable({ companies }: { companies: Row[] }) {
  const [locationFilter, setLocationFilter] = useState(''); // '' = all locations
  const filtered = useMemo(
    () => (locationFilter ? companies.filter(c => c.addressLocation === locationFilter) : companies),
    [companies, locationFilter],
  );
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(filtered, locationFilter);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--list-border)' }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Location:</span>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontWeight: locationFilter ? 700 : 400, background: '#fff', color: locationFilter ? '#1e3a5f' : '#334155', cursor: 'pointer', outline: 'none' }}>
          <option value="">All locations</option>
          {ADDRESS_SERVICE_LOCATIONS.map(loc => <option key={loc.key} value={loc.key}>{loc.label}</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{total} companies</span>
      </div>
      <div className="system-list-scroll">
        <table className="system-list-table" style={{ minWidth: 1180 }}>
          <colgroup>
            <col style={{ width: 58 }} />
            <col style={{ width: 260 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 190 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 250 }} />
          </colgroup>
          <thead>
            <tr className="list-column-header-gray border-b">
              <th>No.</th>
              <th>Company Name</th>
              <th>UEN / ROC</th>
              <th>Company Type</th>
              <th>Contact</th>
              <th>PIC</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c, i) => (
              // registrationNo alone isn't guaranteed unique — a genuine
              // TeamWork-side duplicate (two internal_id's, same UEN; see
              // GOLDEN BRIDGE MARTEC, 2026-08-27) produces two rows sharing
              // it, and a duplicate React key is exactly what made the
              // company look like it was "jumping around" between renders
              // (React can't stably tell the two <tr>s apart). Position is
              // always unique within a page.
              <tr key={`${c.registrationNo || 'row'}-${startIndex + i}`} className="system-list-row border-b">
                <td className="system-list-number">{startIndex + i + 1}</td>
                <td>
                  <span className="company-name-text truncate block" title={c.companyName}>{c.companyName}</span>
                </td>
                <td className="company-registration-text">{c.registrationNo}</td>
                <td className="text-slate-500 text-xs">{c.companyType || '—'}</td>
                <td className="text-xs text-slate-500">
                  {c.primaryContact?.contactName || c.bestEmail || '—'}
                </td>
                <td className="text-xs text-slate-500">{c.pic ? formatStaffName(c.pic) : '—'}</td>
                <td className="text-xs text-slate-500" title={addressLocationLabel(c.addressLocation) ?? undefined}>
                  {addressLocationLabel(c.addressLocation) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ borderTop: '1px solid var(--list-border)', padding: '6px 14px' }}>
        <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />
      </div>
    </>
  );
}
