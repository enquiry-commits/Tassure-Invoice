'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: '#fde68a', color: '#78350f', borderRadius: 2, padding: '0 1px' }}>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function NDPersonCard({ person, index = 0, isLast, query = '' }: { person: NDPerson; index?: number; isLast?: boolean; query?: string }) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();

  const active = person.appointments.filter(
    a => a.sub_role === 'Nominee Director' && !!a.appointment_date && !a.cessation_date
  );
  // When searching, force the card open and show only the matching companies.
  const isOpen = q ? true : open;
  const shown = q ? active.filter(a => a.company_name.toLowerCase().includes(q)) : active;

  return (
    <div className={!isLast ? 'border-b border-slate-100' : ''}>
      {/* Row — white background, navy on expand */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center px-5 py-3 text-left gap-4 transition-colors"
        style={{ backgroundColor: isOpen ? '#1e3a8a' : index % 2 === 0 ? '#ffffff' : '#f8fafc' }}
        onMouseEnter={e => {
          if (!isOpen) (e.currentTarget as HTMLElement).style.backgroundColor = '#eef2f7';
        }}
        onMouseLeave={e => {
          if (!isOpen) (e.currentTarget as HTMLElement).style.backgroundColor = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        }}
      >
        {/* Name */}
        <span
          className="text-sm font-semibold tracking-wide"
          style={{ width: '220px', flexShrink: 0, color: isOpen ? '#ffffff' : '#1e3a5f' }}
        >
          {person.name}
        </span>

        {/* Active badge */}
        <span
          className="text-xs font-semibold px-3 py-0.5 rounded-full"
          style={{
            width: '90px', textAlign: 'center', flexShrink: 0,
            backgroundColor: isOpen ? 'rgba(34,197,94,0.2)' : '#dcfce7',
            color: isOpen ? '#86efac' : '#16a34a',
          }}
        >
          {active.length} Active
        </span>

        {/* Matched count when searching */}
        {q && (
          <span
            className="text-xs font-semibold px-3 py-0.5 rounded-full"
            style={{ flexShrink: 0, backgroundColor: 'rgba(250,204,21,0.18)', color: '#fbbf24' }}
          >
            {shown.length} match{shown.length !== 1 ? 'es' : ''}
          </span>
        )}

        {/* ID */}
        <span
          className="text-xs"
          style={{ width: '70px', flexShrink: 0, color: isOpen ? 'rgba(255,255,255,0.35)' : '#cbd5e1' }}
        >
          {person.member_id ? `ID: ${person.member_id}` : ''}
        </span>

        <span className="flex-1" />

        {isOpen
          ? <ChevronUp size={15} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
          : <ChevronDown size={15} className="flex-shrink-0" style={{ color: '#94a3b8' }} />
        }
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
          {shown.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-8 gap-y-0">
              {shown.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-slate-100">
                  <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 leading-snug"><Highlight text={a.company_name} q={q} /></div>
                    <div className="text-xs text-slate-400 mt-0.5">Since {formatDate(a.appointment_date)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">No active appointments</p>
          )}
        </div>
      )}
    </div>
  );
}
