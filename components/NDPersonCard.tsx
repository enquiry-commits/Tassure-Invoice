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

export default function NDPersonCard({ person }: { person: NDPerson }) {
  const [open, setOpen] = useState(false);

  const active = person.appointments.filter(
    a => !a.cessation_date || a.cessation_date > today
  );
  const ceased = person.appointments.filter(
    a => a.cessation_date && a.cessation_date <= today
  );

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        style={{ backgroundColor: '#1e3a8a' }}
      >
        <span className="text-sm font-bold text-white tracking-wide">{person.name}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-white/20 text-white px-2.5 py-0.5 rounded-full font-medium">
            {active.length} Active
          </span>
          {ceased.length > 0 && (
            <span className="text-xs text-white/60 px-2 py-0.5 rounded-full border border-white/20">
              {ceased.length} Ceased
            </span>
          )}
          {person.member_id && (
            <span className="text-xs text-white/40 hidden sm:inline">ID: {person.member_id}</span>
          )}
          {open
            ? <ChevronUp size={16} className="text-white/70 flex-shrink-0" />
            : <ChevronDown size={16} className="text-white/70 flex-shrink-0" />
          }
        </div>
      </button>

      {/* Body — visible only when open, no max-height / scroll */}
      {open && (
        <div className="px-5 py-4">
          {active.length > 0 ? (
            <div className="space-y-1">
              {active.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                  <span className="text-green-500 text-xs mt-0.5 flex-shrink-0">●</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-700 leading-snug">{a.company_name}</div>
                    <div className="text-xs text-slate-400">Since {formatDate(a.appointment_date)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">No active appointments</p>
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
