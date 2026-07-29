'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Search, UserRoundCheck } from 'lucide-react';
import { fmtDate } from '@/lib/date';

export type NDSubroleReviewItem = {
  key: string;
  companyName: string;
  ndName: string;
  appointmentDate: string;
  appointmentStatus: 'effective' | 'proposed' | 'unknown';
};

const PAGE_SIZE = 50;

export default function NDSubroleReview({
  items,
  scanCompleted,
}: {
  items: NDSubroleReviewItem[];
  scanCompleted: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedNd, setSelectedNd] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const people = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.ndName, (counts.get(item.ndName) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  }, [items]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(item => {
      if (selectedNd !== 'all' && item.ndName !== selectedNd) return false;
      if (!normalizedQuery) return true;
      return item.companyName.toLowerCase().includes(normalizedQuery)
        || item.ndName.toLowerCase().includes(normalizedQuery);
    });
  }, [items, query, selectedNd]);

  if (!scanCompleted) {
    return (
      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">TeamWork subrole review is awaiting its first scan</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              The next ND sync will check only the configured ND people and list rows with an Effective appointment date, a blank cessation field, and a blank Nominee Director subrole.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><UserRoundCheck size={18} /></div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">TeamWork subrole review is clear</h2>
            <p className="mt-0.5 text-xs text-slate-600">No configured ND has an active appointment with a missing Nominee Director subrole.</p>
          </div>
        </div>
      </section>
    );
  }

  const visible = filtered.slice(0, limit);

  return (
    <section className="system-list-shell mb-6">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-4 bg-white px-5 py-4 text-left"
      >
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-700">
          <AlertTriangle size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">TeamWork subrole review</h2>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
              {items.length} to confirm
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
              {people.length} ND people
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            All three conditions are required: the Nominee Director subrole is blank, an Effective appointment date exists, and the cessation field is blank. Confirm the appointment and repair it in TeamWork before treating it as an active ND record.
          </p>
        </div>
        {open ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-white px-5 py-3">
            <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search size={15} className="text-slate-400" />
              <input
                value={query}
                onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
                placeholder="Search company or ND person"
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <select
              value={selectedNd}
              onChange={event => { setSelectedNd(event.target.value); setLimit(PAGE_SIZE); }}
              className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">All ND people ({items.length})</option>
              {people.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
            </select>
            <span className="text-xs font-semibold text-slate-400">{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="system-list-table w-full min-w-[900px] table-fixed">
              <thead>
                <tr className="system-list-column-header">
                  <th className="w-[42%] px-5 py-2.5 text-left">Company Name</th>
                  <th className="w-[22%] px-4 py-2.5 text-left">Suspected ND</th>
                  <th className="w-[15%] px-4 py-2.5 text-center">Appointment</th>
                  <th className="w-[11%] px-4 py-2.5 text-center">TW status</th>
                  <th className="w-[10%] px-4 py-2.5 text-center">Subrole</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <tr key={item.key} className="system-list-row">
                    <td className="company-name-text">{item.companyName}</td>
                    <td className="text-xs font-medium text-slate-700">{item.ndName}</td>
                    <td className="text-center text-xs text-slate-600">{fmtDate(item.appointmentDate)}</td>
                    <td className="text-center">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold ${
                        item.appointmentStatus === 'effective'
                          ? 'text-emerald-700'
                          : item.appointmentStatus === 'proposed'
                            ? 'text-blue-700'
                            : 'text-slate-500'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          item.appointmentStatus === 'effective' ? 'bg-emerald-600' : item.appointmentStatus === 'proposed' ? 'bg-blue-600' : 'bg-slate-400'
                        }`} />
                        {item.appointmentStatus}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-rose-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />Missing
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-xs text-slate-400">No review records match this filter.</div>
          )}

          {visible.length < filtered.length && (
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-center">
              <button
                type="button"
                onClick={() => setLimit(current => current + PAGE_SIZE)}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-800"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
