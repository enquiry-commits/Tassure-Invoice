'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, FolderOpen, X } from 'lucide-react';
import { ClientPicker, type ClientSelection } from '@/components/turnover-ai/ClientPicker';
import type { TurnoverProject } from '@/app/api/turnover-ai/projects/route';

// Turnover AI — Projects list, the feature's home page. Vincent, after
// seeing the original flat Inbox/Review Queue/Summary layout: "员工可以先
// 开一个项目，点击项目后，再导入PDF...所以就可以分别对应不同的项目". Each
// project is its own folder (one client/job), holding its own uploads,
// review queue and running total — see app/turnover-ai/project/[id]/
// page.tsx. A project's totals survive its own 3-day data purge (Vincent,
// via AskUserQuestion: "保留总数，只清原始文件/明细") — the folder itself
// is only ever removed by a staff member explicitly deleting it.

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: TurnoverProject) => void }) {
  const [client, setClient] = useState<ClientSelection>({ companyId: null, name: '' });
  const [gstEnabled, setGstEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!client.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/turnover-ai/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: client.name.trim(), clientCompanyId: client.companyId, gstEnabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not create the project.');
      onCreated({ ...json.project, documentCount: 0, pendingCount: 0, totals: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>New Project</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '18px 20px', display: 'grid', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5 }}>Client / project name</label>
            <ClientPicker value={client} onChange={setClient} placeholder="Select an existing client, or type a new project name" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={gstEnabled} onChange={e => setGstEnabled(e.target.checked)} />
            This client needs GST calculated out separately
          </label>
          {error && <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>}
          <button onClick={submit} disabled={!client.name.trim() || creating}
            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', cursor: (!client.name.trim() || creating) ? 'not-allowed' : 'pointer', background: (!client.name.trim() || creating) ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {creating ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: TurnoverProject; onDelete: (id: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ position: 'relative', border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Link href={`/turnover-ai/project/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderOpen size={16} color="#0f766e" />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {project.documentCount} file{project.documentCount === 1 ? '' : 's'}
          {project.pendingCount > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {project.pendingCount} pending</span>}
          {project.gst_enabled && <span> · GST</span>}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {project.totals.length === 0 && <div style={{ fontSize: 12, color: '#cbd5e1' }}>No confirmed total yet</div>}
          {project.totals.map(t => (
            <div key={t.currency} style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{money(t.total, t.currency)}</div>
          ))}
        </div>
      </Link>
      {confirming ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={() => onDelete(project.id)} style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: 'none', background: 'var(--status-danger)', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Delete for good</button>
          <button onClick={() => setConfirming(false)} style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11.5, cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} title="Delete project"
          style={{ position: 'absolute', top: 14, right: 14, border: 'none', background: 'none', color: '#cbd5e1', cursor: 'pointer', display: 'flex' }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export default function TurnoverAiProjectsPage() {
  const [projects, setProjects] = useState<TurnoverProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    fetch('/api/turnover-ai/projects')
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setProjects(j.projects ?? []); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const deleteProject = async (id: number) => {
    try {
      const res = await fetch(`/api/turnover-ai/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Could not delete the project.'); }
      setProjects(prev => (prev ?? []).filter(p => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Turnover AI</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', maxWidth: 560, lineHeight: 1.6 }}>
            One project per client — upload receipts into it, AI reads them, confirm on the Review Queue. Originals and per-receipt detail are kept for 3 days; the confirmed total stays in the folder after that.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          <Plus size={14} />New Project
        </button>
      </div>

      {loadError && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>}
      {projects === null && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>}
      {projects !== null && projects.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5, border: '1px dashed #e2e8f0', borderRadius: 14 }}>No projects yet — create one to start uploading receipts.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {(projects ?? []).map(p => <ProjectCard key={p.id} project={p} onDelete={deleteProject} />)}
      </div>

      {showCreate && (
        <NewProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={project => { setProjects(prev => [project, ...(prev ?? [])]); setShowCreate(false); }}
        />
      )}
    </div>
  );
}
