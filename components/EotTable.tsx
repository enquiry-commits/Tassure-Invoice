'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, Building2, Clock, CalendarClock, RefreshCw } from 'lucide-react';
import {
  EditField, SelectField, AutoFillDot,
  REPORT_READY_OPTIONS, XBRL_OPTIONS, DPO_OPTIONS, ROND_OPTIONS,
  SEC_PIC_OPTIONS, ACC_PIC_OPTIONS, TAX_PIC_OPTIONS,
} from '@/app/billing/page';
import MetricCard from '@/components/MetricCard';
import { fmtDate } from '@/lib/date';
import { formatStaffName } from '@/lib/staff-directory';
import { useIsMobile } from '@/lib/use-is-mobile';

// EOT (Extension of Time) — a filtered view of ar_reminder, not a separate
// list (see app/api/ar-reminder/eot/route.ts's own docstring for why).
// Reminder/Report Ready/To Client/Signed/XBRL/DPO/ROND RONS/SEC-ACC-TAX
// PIC/Remarks reuse AR Reminder's own EditField/SelectField components
// unchanged — same PATCH endpoint, same manual-flag/auto-fill-dot
// conventions, so an edit made here is the exact same edit AR Reminder
// itself would show, not a second copy that could drift. Visual chrome
// (system-list-shell/title-bar/list-column-header-gray/system-list-row)
// matches every other data-grid page (AR Reminder, Billing Drafts,
// Address Service, ND, Master List) — see app/globals.css.
type EotRow = {
  id: number; entity_name: string; uen: string | null; fye_month: string; fye_year: number;
  reminder_note: string | null; reminder_note_manual: boolean;
  prepared_date: string | null;
  sent_date: string | null; received_date: string | null;
  ar_original_due_date: string | null; ar_revised_due_date: string | null;
  agm_original_due_date: string | null; agm_revised_due_date: string | null;
  xbrl: string | null; dpo: string | null; ond_ron: string | null;
  pic: string | null;
  acc_pic: string | null; acc_pic_manual: boolean;
  tax_pic: string | null; tax_pic_manual: boolean;
  remarks: string | null;
  internal_code: string | null;
};

const NO_W = 36;
const NAME_W = 230;
const UEN_W = 110;

const COLUMNS: { label: string; w: number }[] = [
  { label: 'Code', w: 80 },
  { label: 'Reminder', w: 120 },
  { label: 'Report Ready', w: 130 },
  { label: 'AR Original Due', w: 130 },
  { label: 'AR Revised Due', w: 130 },
  { label: 'To Client', w: 110 },
  { label: 'Signed', w: 110 },
  { label: 'AGM Original Due', w: 140 },
  { label: 'AGM Revised Due', w: 140 },
  { label: 'XBRL', w: 100 },
  { label: 'DPO', w: 100 },
  { label: 'ROND RONS', w: 110 },
  { label: 'SEC PIC', w: 130 },
  { label: 'ACC PIC', w: 130 },
  { label: 'TAX PIC', w: 130 },
  { label: 'Remarks', w: 220 },
];

function ReadOnlyDate({ value }: { value: string | null }) {
  return <span style={{ color: value ? '#1e293b' : '#cbd5e1', fontSize: 11.5 }}>{value ? fmtDate(value) : '—'}</span>;
}

const TD_BASE: React.CSSProperties = {
  padding: '3px 6px', verticalAlign: 'top',
  borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
  wordBreak: 'break-word', overflowWrap: 'break-word',
};

type EotCategory = 'ALL' | 'ar' | 'agm' | 'both';

export default function EotTable() {
  const [rows, setRows] = useState<EotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<EotCategory>('ALL');
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ar-reminder/eot');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load EOT list');
      setRows(json.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Same shape as AR Reminder's own handleSave (app/billing/page.tsx) —
  // flips the matching _manual flag locally so AutoFillDot updates
  // immediately, without waiting for a refetch, matching the server's own
  // PATCH behaviour exactly.
  const handleSave = useCallback((id: number, field: string, value: string) => {
    const extra = (field === 'reminder_note' || field === 'acc_pic' || field === 'tax_pic')
      ? { [`${field}_manual`]: !!value } : {};
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value || null, ...extra } : r));
  }, []);

  // Mirrored horizontal scrollbar — same drag-to-scroll bar every other
  // wide table in the app has (MasterListTable.tsx, ARTableView in
  // app/billing/page.tsx), fixed to the bottom of the viewport instead of
  // the native browser scrollbar at the bottom of the (possibly tall)
  // table itself, which would need scrolling the page down first to reach.
  const outerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const sbRef    = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragRef  = useRef({ startX: 0, startScroll: 0 });
  const metaRef  = useRef({ tw: 0, sbW: 0 });

  const updateSb = useCallback(() => {
    const el = outerRef.current, thumb = thumbRef.current, sb = sbRef.current;
    if (!el || !thumb || !sb) return;
    const rect = el.getBoundingClientRect();
    sb.style.left = `${rect.left}px`;
    sb.style.width = `${rect.width}px`;
    if (el.scrollWidth <= el.clientWidth) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    const tw = Math.max(rect.width * (el.clientWidth / el.scrollWidth), 40);
    metaRef.current = { tw, sbW: rect.width };
    const maxScroll = el.scrollWidth - el.clientWidth;
    const tl = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (rect.width - tw) : 0;
    thumb.style.width = `${tw}px`;
    thumb.style.left = `${tl}px`;
  }, []);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateSb, { passive: true });
    window.addEventListener('resize', updateSb, { passive: true });
    const ro = new ResizeObserver(updateSb);
    ro.observe(el);
    updateSb();
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !el) return;
      const { tw, sbW } = metaRef.current;
      const dx = e.clientX - dragRef.current.startX;
      const scrollable = el.scrollWidth - el.clientWidth;
      const thumbRange = sbW - tw;
      if (thumbRange <= 0) return;
      el.scrollLeft = Math.max(0, Math.min(dragRef.current.startScroll + dx * (scrollable / thumbRange), scrollable));
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('scroll', updateSb);
      window.removeEventListener('resize', updateSb);
      ro.disconnect();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [updateSb]);

  useEffect(() => { updateSb(); }, [rows, updateSb]);

  // Risk/category breakdown, same "click a card to filter" pattern Late
  // Filing's own metric cards use (app/late-filing/page.tsx).
  const hasAr = (r: EotRow) => !!(r.ar_original_due_date || r.ar_revised_due_date);
  const hasAgm = (r: EotRow) => !!(r.agm_original_due_date || r.agm_revised_due_date);
  const catOf = (r: EotRow): EotCategory => hasAr(r) && hasAgm(r) ? 'both' : hasAr(r) ? 'ar' : 'agm';
  const cats = {
    ar: rows.filter(r => catOf(r) === 'ar').length,
    agm: rows.filter(r => catOf(r) === 'agm').length,
    both: rows.filter(r => catOf(r) === 'both').length,
  };
  const displayRows = catFilter === 'ALL' ? rows : rows.filter(r => catOf(r) === catFilter);

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Calendar size={22} style={{ color: '#b45309' }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1e3a5f', margin: 0 }}>EOT</h1>
          <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px' }}>
            Auto-detected from TeamWork records
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            <RefreshCw size={14} />Refresh
          </button>
        </div>
      </div>

      {/* Stats — total + AR/AGM/Both breakdown (click a card to filter) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
        {([
          { key: 'ALL',  label: 'Total EOT Companies', sub: 'with an active extension',   count: rows.length, color: '#b45309', Icon: Building2 },
          { key: 'ar',   label: 'AR Extended',         sub: 'AR due date only',            count: cats.ar,     color: '#2563eb', Icon: Clock },
          { key: 'agm',  label: 'AGM Extended',         sub: 'AGM due date only',           count: cats.agm,    color: '#7c3aed', Icon: Calendar },
          { key: 'both', label: 'AR & AGM Extended',    sub: 'both due dates extended',     count: cats.both,   color: '#0f766e', Icon: CalendarClock },
        ] as const).map(c => (
          <MetricCard
            key={c.key}
            onClick={() => setCatFilter(c.key as EotCategory)}
            active={catFilter === c.key}
            value={c.count}
            label={c.label}
            sub={c.sub}
            icon={<c.Icon size={16} />}
            color={c.color}
            ariaLabel={`Filter EOT records by ${c.label}`}
          />
        ))}
      </div>

      <div className="system-list-shell">
        <div ref={outerRef} style={{ overflowX: isMobile ? 'auto' : 'hidden', maxHeight: 'calc(100vh - 400px)', minHeight: 300, overflowY: 'auto' }}>
          <table className="system-list-table" style={{ width: 'max-content' }}>
            <thead>
              <tr className="list-column-header-gray">
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, minWidth: NO_W, width: NO_W, textAlign: 'center' }}>No.</th>
                <th style={{ position: 'sticky', top: 0, left: NO_W, zIndex: 3, minWidth: NAME_W, width: NAME_W, boxShadow: '3px 0 8px -2px rgba(0,0,0,0.1)' }}>Company Name</th>
                <th style={{ position: 'sticky', top: 0, left: NO_W + NAME_W, zIndex: 3, minWidth: UEN_W, width: UEN_W, boxShadow: '3px 0 8px -2px rgba(0,0,0,0.1)' }}>UEN</th>
                {COLUMNS.map(c => (
                  <th key={c.label} style={{ position: 'sticky', top: 0, zIndex: 2, minWidth: c.w, width: c.w }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLUMNS.length + 3} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={COLUMNS.length + 3} style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>{error}</td></tr>
              ) : !displayRows.length ? (
                <tr><td colSpan={COLUMNS.length + 3} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No companies currently have an active extension.</td></tr>
              ) : displayRows.map((r, i) => (
                <tr key={r.id} className="system-list-row">
                  <td style={{ ...TD_BASE, position: 'sticky', left: 0, zIndex: 1, background: '#fff', textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ ...TD_BASE, position: 'sticky', left: NO_W, zIndex: 1, background: '#fff' }}>
                    <span className="company-name-text">{r.entity_name}</span>
                    <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 1 }}>{r.fye_month} {r.fye_year}</div>
                  </td>
                  <td style={{ ...TD_BASE, position: 'sticky', left: NO_W + NAME_W, zIndex: 1, background: '#fff', boxShadow: '3px 0 8px -2px rgba(0,0,0,0.1)' }}>
                    <span className="company-registration-text">{r.uen || '—'}</span>
                  </td>
                  <td style={TD_BASE}>{r.internal_code || '—'}</td>
                  <td style={TD_BASE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <AutoFillDot show={!!r.reminder_note && !r.reminder_note_manual} />
                      <EditField id={r.id} field="reminder_note" value={r.reminder_note} onSave={handleSave} placeholder="—" isDate />
                    </div>
                  </td>
                  <td style={TD_BASE}><SelectField id={r.id} field="prepared_date" value={r.prepared_date} onSave={handleSave} options={REPORT_READY_OPTIONS} plainDates /></td>
                  <td style={TD_BASE}><ReadOnlyDate value={r.ar_original_due_date} /></td>
                  <td style={TD_BASE}><ReadOnlyDate value={r.ar_revised_due_date} /></td>
                  <td style={TD_BASE}><EditField id={r.id} field="sent_date" value={r.sent_date} onSave={handleSave} placeholder="—" isDate /></td>
                  <td style={TD_BASE}><EditField id={r.id} field="received_date" value={r.received_date} onSave={handleSave} placeholder="—" isDate /></td>
                  <td style={TD_BASE}><ReadOnlyDate value={r.agm_original_due_date} /></td>
                  <td style={TD_BASE}><ReadOnlyDate value={r.agm_revised_due_date} /></td>
                  <td style={TD_BASE}><SelectField id={r.id} field="xbrl" value={r.xbrl} onSave={handleSave} options={XBRL_OPTIONS} /></td>
                  <td style={TD_BASE}><SelectField id={r.id} field="dpo" value={r.dpo} onSave={handleSave} options={DPO_OPTIONS} /></td>
                  <td style={TD_BASE}><SelectField id={r.id} field="ond_ron" value={r.ond_ron} onSave={handleSave} options={ROND_OPTIONS} /></td>
                  <td style={TD_BASE}><SelectField id={r.id} field="pic" value={r.pic} onSave={handleSave} options={SEC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay /></td>
                  <td style={TD_BASE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <AutoFillDot show={!!r.acc_pic && !r.acc_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                      <SelectField id={r.id} field="acc_pic" value={r.acc_pic} onSave={handleSave} options={ACC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                    </div>
                  </td>
                  <td style={TD_BASE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <AutoFillDot show={!!r.tax_pic && !r.tax_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                      <SelectField id={r.id} field="tax_pic" value={r.tax_pic} onSave={handleSave} options={TAX_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                    </div>
                  </td>
                  <td style={TD_BASE}><EditField id={r.id} field="remarks" value={r.remarks} onSave={handleSave} placeholder="Add remarks…" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mirrored scrollbar — desktop only, same pattern as MasterListTable/ARTableView */}
      {!isMobile && <div
        ref={sbRef}
        style={{ position: 'fixed', bottom: 0, display: 'none', height: 23, zIndex: 50, cursor: 'pointer' }}
        onClick={e => {
          const el = outerRef.current;
          if (!el) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          el.scrollLeft = ((e.clientX - rect.left) / metaRef.current.sbW) * (el.scrollWidth - el.clientWidth);
        }}
      >
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: '#e1e7ef' }} />
        <div
          ref={thumbRef}
          style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 15, background: '#94a3b8', borderRadius: 8, userSelect: 'none', cursor: 'grab' }}
          onMouseDown={e => {
            dragging.current = true;
            dragRef.current = { startX: e.clientX, startScroll: outerRef.current?.scrollLeft ?? 0 };
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
        />
      </div>}
    </div>
  );
}
