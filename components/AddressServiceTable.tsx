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
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 w-8">#</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Company Name</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">UEN</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Type</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Contact</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">PIC</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c, i) => (
              <tr key={c.registrationNo || i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-2.5 text-slate-400 text-xs">{startIndex + i + 1}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800 max-w-64">
                  <span className="truncate block" title={c.companyName}>{c.companyName}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{c.registrationNo}</td>
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
