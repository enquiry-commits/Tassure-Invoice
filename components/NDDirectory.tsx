'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import NDPersonCard from './NDPersonCard';

interface Appointment {
  company_name: string;
  sub_role: string | null;
  appointment_date: string | null;
  cessation_date: string | null;
}

interface NDPerson {
  name: string;
  member_id: string | null;
  activeCount: number;
  totalCount: number;
  appointments: Appointment[];
}

export default function NDDirectory({ persons }: { persons: NDPerson[] }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // A person matches when they hold an active nominee appointment at a company
  // whose name contains the query.
  const filtered = query
    ? persons.filter(p => p.appointments.some(a =>
        a.sub_role === 'Nominee Director' && !a.cessation_date && a.appointment_date &&
        a.company_name.toLowerCase().includes(query)))
    : persons;

  return (
    <div>
      {/* Search */}
      <div className="mb-4 flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-slate-200">
        <Search size={16} className="text-slate-400 flex-shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search company name…"
          className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
        />
        {q && (
          <button onClick={() => setQ('')} title="Clear" className="flex-shrink-0 text-slate-400 hover:text-slate-600">
            <X size={15} />
          </button>
        )}
        {query && (
          <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
            {filtered.length} ND{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* List */}
      <div className="rounded-xl overflow-hidden shadow-sm">
        {filtered.length === 0 ? (
          <div className="bg-white px-5 py-10 text-center text-sm text-slate-400">
            No nominee director holds an active appointment for “{q}”.
          </div>
        ) : (
          filtered.map((person, i) => (
            <NDPersonCard
              key={person.name}
              person={person}
              index={i}
              isLast={i === filtered.length - 1}
              query={query}
            />
          ))
        )}
      </div>
    </div>
  );
}
