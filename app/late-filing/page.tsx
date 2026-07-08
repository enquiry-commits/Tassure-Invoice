'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Plus, Pencil, Trash2, Check, X, RefreshCw, Zap } from 'lucide-react';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';

const FYE_MONTHS = ['ALL','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Derive the outstanding year from a row
function lateYear(row: LateRow): number | null {
  if (row.late_fy) return row.late_fy;
  if (row.next_agm_due_date) return new Date(row.next_agm_due_date).getFullYear();
  if (row.last_annual_return_date) return new Date(row.last_annual_return_date).getFullYear() + 1;
  return null;
}

type LateRow = {
  id: string;
  company_name: string;
  uen: string;
  financial_year_end: string;
  last_annual_return_date: string | null;
  last_agm_date: string | null;
  last_accounts_date: string | null;
  next_agm_due_date: string | null;
  remarks: string | null;
  late_fy: number;
  source: 'auto' | 'manual';
};

const REMARKS_OPTIONS = [
  '',
  'ACRA STRIKE OFF',
  'STRIKE OFF - CLIENT LODGED OBJECTION',
  'ACRA STRIKE OFF - CLIENT LODGED OBJECTION',
  'LATE FILING',
];

function fmtDate(d: string | null) {
  if (!d) return <span style={{ color: '#94a3b8' }}>NA</span>;
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RemarksBadge({ remarks }: { remarks: string | null }) {
  if (!remarks) return null;
  const isObjn   = remarks.includes('CLIENT LODGED');
  const isStrike = remarks.includes('STRIKE OFF');
  const bg     = isObjn ? '#fef3c7' : isStrike ? '#fee2e2' : '#f1f5f9';
  const col    = isObjn ? '#92400e'  : isStrike ? '#991b1b'  : '#475569';
  const border = isObjn ? '#fcd34d'  : isStrike ? '#fca5a5'  : '#cbd5e1';
  return (
    <span style={{ display:'inline-block', fontSize:11, fontWeight:700,
      padding:'2px 7px', borderRadius:4, background:bg, color:col, border:`1px solid ${border}` }}>
      {remarks}
    </span>
  );
}

function rowBg(remarks: string | null) {
  if (!remarks) return '#fff';
  if (remarks.includes('CLIENT LODGED')) return '#fffbeb';
  if (remarks.includes('STRIKE OFF'))    return '#fff5f5';
  return '#fff';
}

type EditState = { uen?: string; company_name?: string; remarks?: string | null;
  last_annual_return_date?: string | null; last_agm_date?: string | null;
  last_accounts_date?: string | null; next_agm_due_date?: string | null; };

export default function LateFilingPage() {
  const [rows, setRows]         = useState<LateRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [fye, setFye]           = useState('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [editId, setEditId]     = useState<string | 'new' | null>(null);
  const [editForm, setEditForm] = useState<EditState & { financial_year_end?: string; }>({});
  const [saving, setSaving]     = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LateRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/late-filing?fye=${fye}`);
    const j = await r.json();
    setRows(j.companies ?? []);
    setLoading(false);
  }, [fye]);

  useEffect(() => { load(); }, [load]);

  function startEdit(row: LateRow) {
    setEditId(row.id);
    setEditForm({
      uen: row.uen, company_name: row.company_name,
      remarks: row.remarks,
      last_annual_return_date: row.last_annual_return_date,
      last_agm_date: row.last_agm_date,
      last_accounts_date: row.last_accounts_date,
      next_agm_due_date: row.next_agm_due_date,
    });
  }
  function startNew() { setEditId('new'); setEditForm({ financial_year_end: '' }); }
  function cancelEdit() { setEditId(null); setEditForm({}); }

  async function save() {
    setSaving(true);
    if (editId === 'new') {
      await fetch('/api/late-filing', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
    } else {
      await fetch('/api/late-filing', { method:'PATCH',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
    }
    setSaving(false); cancelEdit(); load();
  }

  function del(row: LateRow) {
    if (row.source !== 'manual') {
      alert('Auto-detected companies cannot be deleted. Remove via TeamWork or add a manual override.');
      return;
    }
    setPendingDelete(row);
  }

  async function confirmDel() {
    const row = pendingDelete;
    if (!row) return;
    setPendingDelete(null);
    await fetch('/api/late-filing', { method:'DELETE',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({ uen: row.uen }) });
    load();
  }

  function dateInput(key: keyof EditState, label: string) {
    return (
      <div>
        <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>{label}</div>
        <input type="date" value={(editForm[key] as string) ?? ''}
          onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value || null }))}
          style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:13 }} />
      </div>
    );
  }

  // Derive filtered rows by year
  const allYears = [...new Set(rows.map(r => lateYear(r)).filter(Boolean) as number[])].sort((a,b)=>a-b);
  const displayRows = yearFilter === 'ALL'
    ? rows
    : rows.filter(r => String(lateYear(r)) === yearFilter);

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <AlertTriangle size={22} style={{ color:'#dc2626' }} />
          <h1 style={{ fontSize:20, fontWeight:800, color:'#1e3a5f', margin:0 }}>Late Filing Companies</h1>
          <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:6, padding:'2px 8px' }}>
            Auto-detected from AR records
          </span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={load}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            <RefreshCw size={14} />Refresh
          </button>
          <button onClick={startNew}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:8, border:'none', background:'#1e3a5f', color:'#fff', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            <Plus size={14} />Add Manual
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'flex', gap:12, marginBottom:16 }}>
        <div style={{ background:'#fff5f5', border:'1px solid #fca5a522', borderRadius:10, padding:'10px 18px', minWidth:130 }}>
          <div style={{ fontSize:22, fontWeight:800, color:'#dc2626' }}>{rows.length}</div>
          <div style={{ fontSize:12, color:'#64748b' }}>Total Late Filers</div>
        </div>
      </div>

      {/* Year Filter */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#94a3b8', fontWeight:600, marginRight:4 }}>Late FY:</span>
        {(['ALL', ...allYears.map(String)]).map(y => (
          <button key={y} onClick={() => setYearFilter(y)}
            style={{ padding:'4px 14px', borderRadius:6, border:'1px solid',
              fontSize:12, fontWeight:600, cursor:'pointer',
              borderColor: yearFilter===y ? '#1e3a5f' : '#e2e8f0',
              background:  yearFilter===y ? '#1e3a5f' : '#fff',
              color:       yearFilter===y ? '#fff'    : '#475569' }}>
            {y}
          </button>
        ))}
      </div>

      {/* New entry form */}
      {editId === 'new' && (
        <div style={{ background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:700, color:'#1e40af', marginBottom:10 }}>Add Manual Entry</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:8 }}>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>Company Name *</div>
              <input value={editForm.company_name??''} onChange={e=>setEditForm(f=>({...f,company_name:e.target.value}))}
                style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:13 }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>UEN</div>
              <input value={editForm.uen??''} onChange={e=>setEditForm(f=>({...f,uen:e.target.value}))}
                style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:13 }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>FYE Month</div>
              <select value={editForm.financial_year_end??''} onChange={e=>setEditForm(f=>({...f,financial_year_end:e.target.value}))}
                style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:13 }}>
                <option value="">—</option>
                {FYE_MONTHS.filter(m=>m!=='ALL').map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>Remarks</div>
              <select value={editForm.remarks??''} onChange={e=>setEditForm(f=>({...f,remarks:e.target.value||null}))}
                style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:13 }}>
                {REMARKS_OPTIONS.map(o=><option key={o} value={o}>{o||'(none)'}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 }}>
            {dateInput('last_annual_return_date','Last AR Date')}
            {dateInput('last_agm_date','Last AGM Date')}
            {dateInput('last_accounts_date','Last Accounts Date')}
            {dateInput('next_agm_due_date','Next AGM Due')}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={save} disabled={saving||!editForm.company_name}
              style={{ padding:'6px 16px', borderRadius:6, border:'none', background:'#1e3a5f', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <Check size={14} />{saving?'Saving…':'Save'}
            </button>
            <button onClick={cancelEdit}
              style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #cbd5e1', background:'#fff', color:'#475569', fontWeight:600, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <X size={14} />Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Detecting late filers…</div>
      ) : displayRows.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'#16a34a', fontWeight:600 }}>
          No late filing companies found for this year
        </div>
      ) : (
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', overflow:'auto', maxHeight:'calc(100vh - 260px)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr>
                {['No.','Company Name','UEN','FYE','Late FY','Last AR Date','Last AGM Date','Last Accounts Date','Next AGM Due','Remarks',''].map(h=>(
                  <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontWeight:700, fontSize:12, whiteSpace:'nowrap',
                    position:'sticky', top:0, zIndex:2, background:'#1e3a5f', color:'#fff',
                    ...(h==='Late FY' ? { minWidth:150 } : {}),
                    ...(h==='Next AGM Due' ? { minWidth:260 } : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, idx) =>
                editId === row.id ? (
                  /* Edit row */
                  <tr key={row.id} style={{ background:'#eff6ff' }}>
                    <td style={{ padding:'6px 12px', color:'#64748b' }}>{idx+1}</td>
                    <td style={{ padding:'4px 8px' }}>
                      <input value={editForm.company_name??''} onChange={e=>setEditForm(f=>({...f,company_name:e.target.value}))}
                        style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input value={editForm.uen??''} onChange={e=>setEditForm(f=>({...f,uen:e.target.value}))}
                        style={{ width:'100%', padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px', color:'#64748b', fontSize:12 }}>{row.financial_year_end}</td>
                    <td style={{ padding:'4px 8px', color:'#64748b', fontSize:12 }}>{row.late_fy||'—'}</td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="date" value={editForm.last_annual_return_date??''} onChange={e=>setEditForm(f=>({...f,last_annual_return_date:e.target.value||null}))}
                        style={{ padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="date" value={editForm.last_agm_date??''} onChange={e=>setEditForm(f=>({...f,last_agm_date:e.target.value||null}))}
                        style={{ padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="date" value={editForm.last_accounts_date??''} onChange={e=>setEditForm(f=>({...f,last_accounts_date:e.target.value||null}))}
                        style={{ padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="date" value={editForm.next_agm_due_date??''} onChange={e=>setEditForm(f=>({...f,next_agm_due_date:e.target.value||null}))}
                        style={{ padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <select value={editForm.remarks??''} onChange={e=>setEditForm(f=>({...f,remarks:e.target.value||null}))}
                        style={{ padding:'3px 6px', border:'1px solid #cbd5e1', borderRadius:4, fontSize:12 }}>
                        {REMARKS_OPTIONS.map(o=><option key={o} value={o}>{o||'(none)'}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:'4px 8px', whiteSpace:'nowrap' }}>
                      <button onClick={save} disabled={saving}
                        style={{ padding:'4px 10px', borderRadius:5, border:'none', background:'#16a34a', color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer', marginRight:4 }}>
                        {saving ? '…' : <Check size={12} />}
                      </button>
                      <button onClick={cancelEdit}
                        style={{ padding:'4px 10px', borderRadius:5, border:'1px solid #cbd5e1', background:'#fff', color:'#475569', fontSize:12, cursor:'pointer' }}>
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ) : (
                  /* Normal row */
                  <tr key={row.id}
                    style={{ background:rowBg(row.remarks), borderBottom:'1px solid #f1f5f9' }}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=rowBg(row.remarks)}>
                    <td style={{ padding:'10px 12px', color:'#94a3b8', fontWeight:600 }}>{idx+1}</td>
                    <td style={{ padding:'10px 12px', fontWeight:600, color:'#1e3a5f', maxWidth:260 }}>
                      {row.company_name}
                    </td>
                    <td style={{ padding:'10px 12px', color:'#475569', fontFamily:'monospace', fontSize:12 }}>{row.uen||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, background:'#eff6ff', color:'#1d4ed8', fontWeight:700, fontSize:12 }}>
                        {row.financial_year_end||'—'}
                      </span>
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      {(() => {
                        const yr = lateYear(row);
                        return yr ? (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:4, color:'#dc2626', fontWeight:700, fontSize:12 }}>
                            <AlertTriangle size={12} />FY {yr}
                          </span>
                        ) : '—';
                      })()}
                    </td>
                    <td style={{ padding:'10px 12px', color:'#475569' }}>{fmtDate(row.last_annual_return_date)}</td>
                    <td style={{ padding:'10px 12px', color:'#475569' }}>{fmtDate(row.last_agm_date)}</td>
                    <td style={{ padding:'10px 12px', color:'#475569' }}>{fmtDate(row.last_accounts_date)}</td>
                    <td style={{ padding:'10px 12px' }}>
                      {row.next_agm_due_date ? (() => {
                        const isPast = new Date(row.next_agm_due_date) < new Date();
                        return (
                          <span style={{ color:isPast?'#dc2626':'#16a34a', fontWeight:isPast?700:400 }}>
                            {fmtDate(row.next_agm_due_date)}
                            {isPast && <span style={{ marginLeft:4, fontSize:10, background:'#fee2e2', color:'#dc2626', padding:'1px 5px', borderRadius:3 }}>OVERDUE</span>}
                          </span>
                        );
                      })() : <span style={{ color:'#94a3b8' }}>NA</span>}
                    </td>
                    <td style={{ padding:'10px 12px' }}><RemarksBadge remarks={row.remarks} /></td>
                    <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                      <button onClick={()=>startEdit(row)}
                        style={{ padding:'4px 8px', borderRadius:5, border:'1px solid #cbd5e1', background:'#fff', color:'#475569', cursor:'pointer', marginRight:4 }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={()=>del(row)}
                        style={{ padding:'4px 8px', borderRadius:5, border:'1px solid #fca5a5', background:'#fff', color:row.source==='manual'?'#dc2626':'#cbd5e1', cursor:'pointer' }}
                        title={row.source==='auto'?'Auto-detected — edit remarks instead':'Remove'}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop:16, display:'flex', gap:20, fontSize:12, color:'#64748b', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:14, height:14, borderRadius:3, background:'#fee2e2', border:'1px solid #fca5a5' }} /> ACRA Strike Off
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:14, height:14, borderRadius:3, background:'#fffbeb', border:'1px solid #fcd34d' }} /> Client Lodged Objection
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ color:'#dc2626', fontWeight:700, fontSize:11 }}>OVERDUE</span> = Next AGM due date has passed
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          label={pendingDelete.company_name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDel}
        />
      )}
    </div>
  );
}
