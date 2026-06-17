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
        className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors"
        style={{ backgroundColor: open ? '#1e3a8a' : '#1d3a5c' }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.backgroundColor = '#1e3a8a'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.backgroundColor = '#1d3a5c'; }}
      >
        <span className="text-sm font-semibold text-white tracking-wide">{person.name}</span>

        <div className="flex items-center gap-2.5">
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(34,197,94,0.2)', color: '#86efac' }}
          >
            {active.length} Active
          </span>
          {ceased.length > 0 && (
            <span
              className="text-xs px-2.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}
            >
              {ceased.length} Ceased
            </span>
          )}
          {person.member_id && (
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              ID: {person.member_id}
            </span>
          )}
          {open
            ? <ChevronUp size={15} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
            : <ChevronDown size={15} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
          }
        </div>
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
