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

const today = new Date().toISOString().split('T')[0];

export default function NDPersonCard({ person, isLast }: { person: NDPerson; isLast?: boolean }) {
  const [open, setOpen] = useState(false);

  const active = person.appointments.filter(
    a => !a.cessation_date || a.cessation_date > today
  );
  const ceased = person.appointments.filter(
    a => a.cessation_date && a.cessation_date <= today
  );

  return (
    <div className={!isLast ? 'border-b border-slate-100' : ''}>
      {/* Row header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center px-5 py-3 text-left transition-colors gap-4"
        style={{ backgroundColor: open ? '#1e3a8a' : '#1d3a5c' }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.backgroundColor = '#1e3a8a'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.backgroundColor = '#1d3a5c'; }}
      >
        {/* Name — fixed width */}
        <span className="text-sm font-semibold text-white tracking-wide" style={{ width: '220px', flexShrink: 0 }}>
          {person.name}
        </span>

        {/* Active badge */}
        <span
          className="text-xs font-semibold px-3 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(34,197,94,0.2)', color: '#86efac', width: '90px', textAlign: 'center', flexShrink: 0 }}
        >
          {active.length} Active
        </span>

        {/* Ceased badge */}
        <span
          className="text-xs px-3 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', width: '90px', textAlign: 'center', flexShrink: 0 }}
        >
          {ceased.length > 0 ? `${ceased.length} Ceased` : '—'}
        </span>

        {/* ID */}
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)', width: '70px', flexShrink: 0 }}>
          {person.member_id ? `ID: ${person.member_id}` : ''}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Chevron */}
        {open
          ? <ChevronUp size={15} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
          : <ChevronDown size={15} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
        }
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-5 py-4 bg-white">
          {active.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-8 gap-y-0">
              {active.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-slate-50">
                  <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 leading-snug">{a.company_name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Since {formatDate(a.appointment_date)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">No active appointments</p>
          )}

          {ceased.length > 0 && (
            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-100">
              + {ceased.length} historical ceased appointment{ceased.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
