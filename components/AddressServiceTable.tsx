'use client';

import { usePagination, PaginationBar } from './Pagination';
import { formatStaffName } from '@/lib/staff-directory';

interface Row {
  companyName: string;
  registrationNo: string;
  companyType: string;
  pic: string;
  bestEmail: string | null;
  primaryContact: { contactName: string; phone: string } | null;
}

// Client-side paginated table for the (server-rendered) Address Service page.
export default function AddressServiceTable({ companies }: { companies: Row[] }) {
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(companies, 'static');

  return (
    <>
      <div className="system-list-scroll">
        <table className="system-list-table" style={{ minWidth: 980 }}>
          <colgroup>
            <col style={{ width: 58 }} />
            <col style={{ width: 280 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 210 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr className="list-column-header-gray border-b">
              <th>No.</th>
              <th>Company Name</th>
              <th>UEN / ROC</th>
              <th>Company Type</th>
              <th>Contact</th>
              <th>PIC</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c, i) => (
              <tr key={c.registrationNo || i} className="system-list-row border-b">
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
