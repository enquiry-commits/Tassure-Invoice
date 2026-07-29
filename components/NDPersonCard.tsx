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

export default function NDPersonCard({ person, query = '' }: { person: NDPerson; index?: number; isLast?: boolean; query?: string }) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();

  const active = person.appointments.filter(
    a => a.sub_role === 'Nominee Director' && !!a.appointment_date && !a.cessation_date
  );
  // When searching, force the card open and show only the matching companies.
  const isOpen = q ? true : open;
  const shown = q ? active.filter(a => a.company_name.toLowerCase().includes(q)) : active;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={`nd-directory-row system-list-row ${isOpen ? 'system-list-row--selected' : ''} w-full text-left`}
        style={{ alignItems: 'center', minHeight: 58, padding: '11px 18px', border: 0, cursor: 'pointer' }}
      >
        <span className="company-name-text">
          {person.name}
        </span>

        <span
          className="text-xs font-semibold"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, color: active.length ? '#15803d' : '#94a3b8',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: active.length ? '#16a34a' : '#cbd5e1' }} />
          {active.length} active
        </span>

        <span className="company-registration-text">{person.member_id || '—'}</span>

        {isOpen
          ? <ChevronUp size={15} className="flex-shrink-0" style={{ color: '#526b85' }} />
          : <ChevronDown size={15} className="flex-shrink-0" style={{ color: '#94a3b8' }} />
        }
      </button>

      {isOpen && (
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200">
          {q && <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{shown.length} matching appointments</div>}
          {shown.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-slate-100">
                  <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" />
                  <div className="min-w-0">
                    <div className="company-name-text"><Highlight text={a.company_name} q={q} /></div>
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
