'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  EditField, SelectField, AutoFillDot,
  REPORT_READY_OPTIONS, XBRL_OPTIONS, DPO_OPTIONS, ROND_OPTIONS,
  SEC_PIC_OPTIONS, ACC_PIC_OPTIONS, TAX_PIC_OPTIONS,
} from '@/app/billing/page';
import { fmtDate } from '@/lib/date';
import { formatStaffName } from '@/lib/staff-directory';

// EOT (Extension of Time) — a filtered view of ar_reminder, not a separate
// list (see app/api/ar-reminder/eot/route.ts's own docstring for why).
// Reminder/Report Ready/To Client/Signed/XBRL/DPO/ROND RONS/SEC-ACC-TAX
// PIC/Remarks reuse AR Reminder's own EditField/SelectField components
// unchanged — same PATCH endpoint, same manual-flag/auto-fill-dot
// conventions, so an edit made here is the exact same edit AR Reminder
// itself would show, not a second copy that could drift.
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

const TH_STYLE: React.CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#64748b',
  textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #e2e8f0', background: '#f8fafc',
};
const TD_STYLE: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12.5, borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle',
};

function ReadOnlyDate({ value }: { value: string | null }) {
  return <span style={{ color: value ? '#1e293b' : '#cbd5e1', fontSize: 12.5 }}>{fmtDate(value)}</span>;
}

export default function EotTable() {
  const [rows, setRows] = useState<EotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: 0 }}>EOT</h1>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} compan{rows.length === 1 ? 'y' : 'ies'} with an active extension</span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={TH_STYLE}>No.</th>
              <th style={TH_STYLE}>Company Name</th>
              <th style={TH_STYLE}>UEN</th>
              <th style={TH_STYLE}>Code</th>
              <th style={TH_STYLE}>Reminder</th>
              <th style={TH_STYLE}>Report Ready</th>
              <th style={TH_STYLE}>AR Original Due</th>
              <th style={TH_STYLE}>AR Revised Due</th>
              <th style={TH_STYLE}>To Client</th>
              <th style={TH_STYLE}>Signed</th>
              <th style={TH_STYLE}>AGM Original Due</th>
              <th style={TH_STYLE}>AGM Revised Due</th>
              <th style={TH_STYLE}>XBRL</th>
              <th style={TH_STYLE}>DPO</th>
              <th style={TH_STYLE}>ROND RONS</th>
              <th style={TH_STYLE}>SEC PIC</th>
              <th style={TH_STYLE}>ACC PIC</th>
              <th style={TH_STYLE}>TAX PIC</th>
              <th style={TH_STYLE}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td style={{ ...TD_STYLE, color: '#94a3b8' }}>{i + 1}</td>
                <td style={{ ...TD_STYLE, fontWeight: 600, color: '#1e293b' }}>
                  {r.entity_name}
                  <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{r.fye_month} {r.fye_year}</div>
                </td>
                <td style={TD_STYLE}>{r.uen || '—'}</td>
                <td style={TD_STYLE}>{r.internal_code || '—'}</td>
                <td style={TD_STYLE}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.reminder_note && !r.reminder_note_manual} />
                    <EditField id={r.id} field="reminder_note" value={r.reminder_note} onSave={handleSave} placeholder="—" isDate />
                  </div>
                </td>
                <td style={TD_STYLE}><SelectField id={r.id} field="prepared_date" value={r.prepared_date} onSave={handleSave} options={REPORT_READY_OPTIONS} plainDates /></td>
                <td style={TD_STYLE}><ReadOnlyDate value={r.ar_original_due_date} /></td>
                <td style={TD_STYLE}><ReadOnlyDate value={r.ar_revised_due_date} /></td>
                <td style={TD_STYLE}><EditField id={r.id} field="sent_date" value={r.sent_date} onSave={handleSave} placeholder="—" isDate /></td>
                <td style={TD_STYLE}><EditField id={r.id} field="received_date" value={r.received_date} onSave={handleSave} placeholder="—" isDate /></td>
                <td style={TD_STYLE}><ReadOnlyDate value={r.agm_original_due_date} /></td>
                <td style={TD_STYLE}><ReadOnlyDate value={r.agm_revised_due_date} /></td>
                <td style={TD_STYLE}><SelectField id={r.id} field="xbrl" value={r.xbrl} onSave={handleSave} options={XBRL_OPTIONS} /></td>
                <td style={TD_STYLE}><SelectField id={r.id} field="dpo" value={r.dpo} onSave={handleSave} options={DPO_OPTIONS} /></td>
                <td style={TD_STYLE}><SelectField id={r.id} field="ond_ron" value={r.ond_ron} onSave={handleSave} options={ROND_OPTIONS} /></td>
                <td style={TD_STYLE}><SelectField id={r.id} field="pic" value={r.pic} onSave={handleSave} options={SEC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay /></td>
                <td style={TD_STYLE}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.acc_pic && !r.acc_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                    <SelectField id={r.id} field="acc_pic" value={r.acc_pic} onSave={handleSave} options={ACC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                  </div>
                </td>
                <td style={TD_STYLE}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.tax_pic && !r.tax_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                    <SelectField id={r.id} field="tax_pic" value={r.tax_pic} onSave={handleSave} options={TAX_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                  </div>
                </td>
                <td style={TD_STYLE}><EditField id={r.id} field="remarks" value={r.remarks} onSave={handleSave} placeholder="Add remarks…" /></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={19} style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No companies currently have an active extension.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
