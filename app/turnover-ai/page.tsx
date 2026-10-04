'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, FolderOpen, X, Search, UploadCloud } from 'lucide-react';
import { ClientPicker, type ClientSelection } from '@/components/turnover-ai/ClientPicker';
import { ACCEPT, MAX_FILES_PER_BATCH, INCOMING_PARAM, prepareBatch, stageFiles, type PreparedBatch } from '@/components/turnover-ai/upload-handoff';
import { UPLOAD_MAX_BYTES, megabytes, pdfTooLargeMessage } from '@/lib/turnover-ai-files';
import type { TurnoverProject } from '@/app/api/turnover-ai/projects/route';

// Turnover AI — Projects list, the feature's home page. Vincent, after
// seeing the original flat Inbox/Review Queue/Summary layout: "员工可以先
// 开一个项目，点击项目后，再导入PDF...所以就可以分别对应不同的项目". Each
// project is its own folder (one client/job), holding its own uploads,
// review queue and running total — see app/turnover-ai/project/[id]/
// page.tsx. A project's totals survive its own 3-day data purge (Vincent,
// via AskUserQuestion: "保留总数，只清原始文件/明细") — the folder itself
// is only ever removed by a staff member explicitly deleting it.
//
// Vincent, 2026-10-04: "文件夹页面要可以好像搜索公司那样，可以输入公司名字
// （文件夹名）找出对应的文件夹，防止后续过多文件夹找不到" — a client-side
// name filter, same idea as the company-name search used elsewhere in the
// app, so a folder stays findable as the project count grows.
//
// Vincent, 2026-10-05: "第一次看到这个页面的员工也不知道怎么样用...先把文件拉到
// 上传板块后，系统就跳出那个弹窗，然后直接把需要计算的文件计入在这个新开的文件夹
// 中". Files can now be dropped anywhere on this page: the New Project pop-up
// opens, and Create takes the files straight into the new project's page,
// which reads them (components/turnover-ai/upload-handoff.ts). Decided the
// same day (AskUserQuestion): a project for the same client — same name, or
// the same company picked — is offered as "add the files there instead"
// (a hint only, never merged automatically); a plain New Project also opens
// the new project right away; more than 100 files → the first 100 now.

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function FileSummary({ files }: { files: PreparedBatch }) {
  const names = files.batch.map(f => f.name);
  const total = files.batch.length + files.deferred.length;
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f0fdfa', border: '1px solid #99f6e4', fontSize: 12, color: '#134e4a', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700 }}>{plural(files.batch.length, 'file')} ready to read</div>
      <div style={{ color: '#0f766e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3} more` : ''}
      </div>
      {files.deferred.length > 0 && (
        <div style={{ marginTop: 4, color: '#b45309' }}>
          {total} files — the first {MAX_FILES_PER_BATCH} (by name) are read now; drop the other {files.deferred.length} into the project afterwards.
        </div>
      )}
      {files.tooLarge.length > 0 && (
        <div style={{ marginTop: 4, color: '#b45309' }}>
          {plural(files.tooLarge.length, 'PDF')} over {megabytes(UPLOAD_MAX_BYTES)} set aside — split {files.tooLarge.length === 1 ? 'it' : 'them'} into smaller files first: {files.tooLarge.slice(0, 2).map(f => `${f.name} (${megabytes(f.size)})`).join(', ')}{files.tooLarge.length > 2 ? '…' : ''}
        </div>
      )}
      {files.rejected.length > 0 && (
        <div style={{ marginTop: 4, color: '#64748b' }}>
          {plural(files.rejected.length, 'file')} skipped (only PDF, JPG, PNG, WEBP, HEIC can be read): {files.rejected.slice(0, 2).map(f => f.name).join(', ')}{files.rejected.length > 2 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

function NewProjectModal({ files, projects, onClose, onCreated, onUseExisting }: {
  files: PreparedBatch | null;
  projects: TurnoverProject[];
  onClose: () => void;
  onCreated: (project: TurnoverProject) => void;
  onUseExisting: (project: TurnoverProject) => void;
}) {
  const [client, setClient] = useState<ClientSelection>({ companyId: null, name: '' });
  const [gstEnabled, setGstEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same client = same name (ignoring case/spaces) or the same company picked.
  const matches = useMemo(() => projects.filter(p =>
    (client.name.trim() && sameName(p.name, client.name)) || (client.companyId !== null && p.client_company_id === client.companyId)),
  [projects, client]);

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
      // Stays "Opening…" until the project page takes over.
      onCreated({ ...json.project, documentCount: 0, unreadCount: 0, pendingCount: 0, totals: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  const disabled = !client.name.trim() || creating;
  return (
    // With files waiting, only the X cancels — a stray click on the backdrop
    // must not silently throw away a whole batch.
    <div onClick={files ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{files ? 'Which client are these files for?' : 'New Project'}</div>
          <button onClick={onClose} disabled={creating} title={files ? 'Cancel — nothing is created or read' : 'Close'} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '18px 20px', display: 'grid', gap: 14 }}>
          {files && <FileSummary files={files} />}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5 }}>Client / project name</label>
            <ClientPicker value={client} onChange={setClient} placeholder="Select an existing client, or type a new project name" />
          </div>
          {matches.length > 0 && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 700 }}>This client already has {matches.length === 1 ? 'a project' : `${matches.length} projects`}:</div>
              {matches.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name} · {plural(p.documentCount, 'file')}{p.gst_enabled ? ' · GST' : ''}
                  </span>
                  <button onClick={() => onUseExisting(p)} disabled={creating}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #f59e0b', background: '#fff', color: '#92400e', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    {files ? 'Add the files here' : 'Open it'}
                  </button>
                </div>
              ))}
              <div style={{ color: '#a16207' }}>…or create a new one below.</div>
            </div>
          )}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={gstEnabled} onChange={e => setGstEnabled(e.target.checked)} />
              This client needs GST calculated out separately
            </label>
            <div style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0 22px' }}>Set once, when the project is created — it decides whether AI reads the GST out of each receipt.</div>
          </div>
          {error && <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>}
          <button onClick={submit} disabled={disabled}
            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {creating ? 'Opening the project…' : files ? `Create & read ${plural(files.batch.length, 'file')}` : 'Create Project'}
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
          {project.unreadCount > 0 && <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {project.unreadCount} couldn&rsquo;t be read</span>}
          {project.gst_enabled && <span> · GST</span>}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {project.totals.length === 0 && <div style={{ fontSize: 12, color: '#cbd5e1' }}>No total yet</div>}
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

// Big with the three steps when there are no projects yet (what a first-time
// visitor sees); a single strip above the search once there are.
function DropZone({ big, active, onPick }: { big: boolean; active: boolean; onPick: () => void }) {
  const border = `1.5px dashed ${active ? '#0f766e' : '#cbd5e1'}`;
  const background = active ? '#f0fdfa' : '#fff';
  if (!big) {
    return (
      <div onClick={onPick} style={{ border, background, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 14 }}>
        <UploadCloud size={18} color={active ? '#0f766e' : '#94a3b8'} />
        <span style={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>Drop receipts or invoices anywhere on this page to start a project</span>
        <span style={{ fontSize: 11.5, color: '#94a3b8' }}>— or click to choose files · to add to an existing project, open it below</span>
      </div>
    );
  }
  return (
    <div onClick={onPick} style={{ border, background, borderRadius: 14, padding: '34px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', cursor: 'pointer' }}>
      <UploadCloud size={30} color={active ? '#0f766e' : '#94a3b8'} />
      <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Drop a client&rsquo;s receipts or invoices here</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>or click to choose files · PDF, JPG, PNG, WEBP, HEIC · up to {MAX_FILES_PER_BATCH} at a time</div>
      <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: '#475569', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span><b>1</b> Drop the files</span>
        <span><b>2</b> Name the client (and GST)</span>
        <span><b>3</b> AI reads them into that project&rsquo;s total — check or fix any value there</span>
      </div>
    </div>
  );
}

export default function TurnoverAiProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<TurnoverProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [dropped, setDropped] = useState<PreparedBatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch('/api/turnover-ai/projects')
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setProjects(j.projects ?? []); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects ?? [];
    return (projects ?? []).filter(p => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  const deleteProject = async (id: number) => {
    try {
      const res = await fetch(`/api/turnover-ai/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Could not delete the project.'); }
      setProjects(prev => (prev ?? []).filter(p => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const takeFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const prepared = prepareBatch(list);
    if (!prepared.batch.length) {
      const folderLike = !prepared.tooLarge.length && prepared.rejected.every(f => !f.type);
      setNotice(folderLike
        ? 'A folder can’t be dropped as a whole — open it, select the files inside (Ctrl+A) and drop those.'
        : prepared.tooLarge.length
          ? pdfTooLargeMessage(prepared.tooLarge[0].size) + (prepared.tooLarge.length > 1 ? ` (${prepared.tooLarge.length} PDFs are over the limit.)` : '')
          : `Nothing here can be read — only PDF, JPG, PNG, WEBP or HEIC files (${prepared.rejected.slice(0, 2).map(f => f.name).join(', ')}).`);
      return;
    }
    setNotice(null);
    setDropped(prepared);
    setShowCreate(true);
  };

  const openProject = (id: number) => {
    const files = dropped?.batch ?? [];
    if (files.length) {
      stageFiles(id, files);
      router.push(`/turnover-ai/project/${id}?${INCOMING_PARAM}=${files.length}`);
    } else {
      router.push(`/turnover-ai/project/${id}`);
    }
  };

  // Whole-page drop target, same counter pattern as Post Incorporate (a plain
  // dragleave flickers on every nested element). While the pop-up is open a
  // drop is swallowed rather than replacing the batch being named.
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onPageDragEnter = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current += 1; setDragActive(true); };
  const onPageDragOver = (e: React.DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
  const onPageDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onPageDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (!showCreate) takeFiles(e.dataTransfer.files);
  };

  return (
    <div onDragEnter={onPageDragEnter} onDragOver={onPageDragOver} onDragLeave={onPageDragLeave} onDrop={onPageDrop} style={{ minHeight: '70vh' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Turnover AI</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', maxWidth: 560, lineHeight: 1.6 }}>
            One project per client — drop its receipts here, name the client, and AI reads them straight into a running total; fix any value directly if it looks off. Originals and per-receipt detail are kept for 3 days; the total stays in the folder after that.
          </p>
        </div>
        <button onClick={() => { setDropped(null); setShowCreate(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          <Plus size={14} />New Project
        </button>
      </div>

      <input ref={fileInputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
        onChange={e => { takeFiles(e.target.files); e.target.value = ''; }} />

      {loadError && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>}
      {projects === null && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>}
      {projects !== null && <DropZone big={projects.length === 0} active={dragActive} onPick={() => fileInputRef.current?.click()} />}
      {notice && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, margin: '-4px 0 14px' }}>{notice}</div>}

      {projects !== null && projects.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 14, maxWidth: 360 }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input type="text" placeholder="Search project name…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px 7px 30px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      )}
      {projects !== null && projects.length > 0 && visibleProjects.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5, border: '1px dashed #e2e8f0', borderRadius: 14 }}>No project matches &ldquo;{search}&rdquo;.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {visibleProjects.map(p => <ProjectCard key={p.id} project={p} onDelete={deleteProject} />)}
      </div>

      {showCreate && (
        <NewProjectModal
          files={dropped}
          projects={projects ?? []}
          onClose={() => { setShowCreate(false); setDropped(null); }}
          onCreated={project => openProject(project.id)}
          onUseExisting={project => openProject(project.id)}
        />
      )}
    </div>
  );
}
