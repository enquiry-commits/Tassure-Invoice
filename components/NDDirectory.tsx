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
      <div className="system-list-toolbar mb-4 rounded-xl border border-slate-200 shadow-sm">
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
      <div className="system-list-shell">
        <div className="system-list-title-bar px-4 py-3">
          <span className="system-list-title">Nominee Director Directory</span>
          <span className="system-list-title-hint">{filtered.length} people · select a row to view active company appointments</span>
        </div>
        {filtered.length > 0 && (
          <div className="system-list-column-header hidden md:grid" style={{ gridTemplateColumns: 'minmax(240px,1.4fr) 150px 120px 32px', padding: '10px 18px', gap: 16 }}>
            <div>ND Name</div>
            <div>Active Appointments</div>
            <div>Member ID</div>
            <div />
          </div>
        )}
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
