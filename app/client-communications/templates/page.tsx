'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';

interface Template { id: number; type: string; name: string; subject_template: string; body_template: string; is_default: boolean }
interface Sender { id: number; email: string; display_name: string | null; is_default: boolean }

const TYPE_LABEL: Record<string, string> = { ar: 'AR Renewal Reminder', soa: 'Statement of Account', letter: 'Document Reminder' };
const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, outline: 'none', width: '100%' };
const MERGE_FIELDS = ['companyName', 'contactName', 'toEmail', 'ccEmail', 'totalAmount', 'invoiceList', 'dueDate', 'fyeMonth', 'fyeYear'];

export default function TemplatesSendersPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [editing, setEditing] = useState<Record<number, Partial<Template>>>({});
  const [newSenderEmail, setNewSenderEmail] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [showNewTemplate, setShowNewTemplate] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', subject_template: '', body_template: '' });

  const load = useCallback(() => {
    fetch('/api/client-communications/templates').then(r => r.json()).then(j => setTemplates(j.data ?? []));
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => setSenders(j.data ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchTemplate = async (id: number, field: string, value: unknown) => {
    await fetch('/api/client-communications/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value }) });
    load();
  };
  const deleteTemplate = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    await fetch('/api/client-communications/templates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  };
  const createTemplate = async (type: string) => {
    if (!draft.name || !draft.subject_template || !draft.body_template) return;
    await fetch('/api/client-communications/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...draft }) });
    setDraft({ name: '', subject_template: '', body_template: '' });
    setShowNewTemplate(null);
    load();
  };

  const patchSender = async (id: number, field: string, value: unknown) => {
    await fetch('/api/client-communications/senders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value }) });
    load();
  };
  const deleteSender = async (id: number) => {
    if (!confirm('Remove this sender?')) return;
    await fetch('/api/client-communications/senders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  };
  const addSender = async () => {
    if (!newSenderEmail) return;
    await fetch('/api/client-communications/senders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: newSenderEmail, display_name: newSenderName || null }) });
    setNewSenderEmail(''); setNewSenderName('');
    load();
  };

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
        Templates use <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{'{{fieldName}}'}</code> placeholders. Available fields: {MERGE_FIELDS.map(f => `{{${f}}}`).join(', ')}
      </div>

      {(['ar', 'soa', 'letter'] as const).map(type => (
        <div key={type} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f' }}>{TYPE_LABEL[type]} templates</span>
            <button onClick={() => { setShowNewTemplate(type); setDraft({ name: '', subject_template: '', body_template: '' }); }}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: '#1d3a5c', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              <Plus size={13} />New
            </button>
          </div>

          {templates.filter(t => t.type === type).map(t => {
            const e = editing[t.id] ?? t;
            return (
              <div key={t.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input value={e.name} onChange={ev => setEditing(p => ({ ...p, [t.id]: { ...e, name: ev.target.value } }))}
                    onBlur={() => patchTemplate(t.id, 'name', e.name)}
                    style={{ ...S, fontWeight: 700, width: 260 }} />
                  <button onClick={() => patchTemplate(t.id, 'is_default', true)} title="Set as default"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: t.is_default ? '#eab308' : '#cbd5e1', fontSize: 11 }}>
                    <Star size={13} fill={t.is_default ? '#eab308' : 'none'} />{t.is_default ? 'Default' : 'Set default'}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 3 }}>Subject</div>
                <input value={e.subject_template} onChange={ev => setEditing(p => ({ ...p, [t.id]: { ...e, subject_template: ev.target.value } }))}
                  onBlur={() => patchTemplate(t.id, 'subject_template', e.subject_template)}
                  style={{ ...S, marginBottom: 8 }} />
                <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 3 }}>Body</div>
                <textarea value={e.body_template} onChange={ev => setEditing(p => ({ ...p, [t.id]: { ...e, body_template: ev.target.value } }))}
                  onBlur={() => patchTemplate(t.id, 'body_template', e.body_template)}
                  rows={6} style={{ ...S, fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
            );
          })}

          {showNewTemplate === type && (
            <div style={{ padding: '12px 16px', background: '#f8fafc' }}>
              <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Template name" style={{ ...S, marginBottom: 8 }} />
              <input value={draft.subject_template} onChange={e => setDraft(d => ({ ...d, subject_template: e.target.value }))} placeholder="Subject" style={{ ...S, marginBottom: 8 }} />
              <textarea value={draft.body_template} onChange={e => setDraft(d => ({ ...d, body_template: e.target.value }))} placeholder="Body" rows={5} style={{ ...S, fontFamily: 'inherit', resize: 'vertical', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => createTemplate(type)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setShowNewTemplate(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f' }}>Senders</span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>Display only — sending still happens from your own Outlook</span>
        </div>
        {senders.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e3a5f' }}>{s.display_name ?? '(no name)'}</span>
            <span style={{ fontSize: 11.5, color: '#64748b' }}>{s.email}</span>
            <button onClick={() => patchSender(s.id, 'is_default', true)}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: s.is_default ? '#eab308' : '#cbd5e1', fontSize: 11 }}>
              <Star size={13} fill={s.is_default ? '#eab308' : 'none'} />{s.is_default ? 'Default' : 'Set default'}
            </button>
            <button onClick={() => deleteSender(s.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px' }}>
          <input value={newSenderEmail} onChange={e => setNewSenderEmail(e.target.value)} placeholder="email@tassure.com" style={{ ...S, width: 220 }} />
          <input value={newSenderName} onChange={e => setNewSenderName(e.target.value)} placeholder="Display name (optional)" style={{ ...S, width: 220 }} />
          <button onClick={addSender} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <Plus size={13} />Add
          </button>
        </div>
      </div>
    </div>
  );
}
