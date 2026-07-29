'use client';

import { usePagination, PaginationBar } from './Pagination';

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
      <div className="overflow-x-auto -mx-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="system-list-column-header border-b">
              <th className="text-left px-4 py-2.5 w-8">No.</th>
              <th className="text-left px-4 py-2.5">Company Name</th>
              <th className="text-left px-4 py-2.5">UEN / ROC</th>
              <th className="text-left px-4 py-2.5">Company Type</th>
              <th className="text-left px-4 py-2.5">Contact</th>
              <th className="text-left px-4 py-2.5">PIC</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c, i) => (
              <tr key={c.registrationNo || i} className="system-list-row border-b">
                <td className="px-4 py-2.5 text-slate-400 text-xs">{startIndex + i + 1}</td>
                <td className="px-4 py-2.5 max-w-64">
                  <span className="company-name-text truncate block" title={c.companyName}>{c.companyName}</span>
                </td>
                <td className="px-4 py-2.5 company-registration-text">{c.registrationNo}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{c.companyType || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {c.primaryContact?.contactName || c.bestEmail || '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{c.pic || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />
    </>
  );
}
