'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Check, Eye, RefreshCcw, ShieldCheck, X } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

type CandidateStatus = 'observing' | 'ready_for_review' | 'approved' | 'rejected' | 'dismissed';
type Candidate = {
  id: number;
  account_email: string;
  pattern_kind: 'frequent_page' | 'frequent_action';
  pattern_key: string;
  proposed_memory_type: 'behaviour' | 'pattern';
  proposed_content: string;
  status: CandidateStatus;
  confidence: number;
  source_count: number;
  distinct_days: number;
  approved_content: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  promoted_memory_id: number | null;
  updated_at: string;
};
type StaffEntry = { email: string; name: string };
type Me = { email: string; name: string; admin: boolean; canViewActivityInsights: boolean };

const STATUS_LABEL: Record<CandidateStatus, string> = {
  observing: '观察中',
  ready_for_review: '待复核',
  approved: '已采纳',
  rejected: '已拒绝',
  dismissed: '已忽略',
};

const PATTERN_KIND_LABEL: Record<'frequent_page' | 'frequent_action', string> = {
  frequent_page: '常访问页面',
  frequent_action: '常做操作',
};

// Existing candidate rows were stored with English proposed_content; the
// generator now writes Chinese (lib/ai-learning/patterns.ts). Rewrite the
// known English templates at render time so old rows read Chinese too,
// falling back to the raw string for anything unrecognised.
function zhContent(text: string): string {
  let m = text.match(/^Repeatedly visits (.+?) \((\d+) separate sessions across (\d+) days in the last (\d+) days\)\.$/);
  if (m) return `经常访问 ${m[1]}（最近 ${m[4]} 天内，${m[3]} 天里共 ${m[2]} 次独立访问）。`;
  m = text.match(/^Repeatedly performs (.+?) \((\d+) recorded actions across (\d+) days in the last (\d+) days\)\.$/);
  if (m) return `经常执行 ${m[1]}（最近 ${m[4]} 天内，${m[3]} 天里共 ${m[2]} 次操作）。`;
  return text;
}
const STATUS_COLOR: Record<CandidateStatus, string> = {
  observing: '#64748b',
  ready_for_review: '#b45309',
  approved: '#15803d',
  rejected: '#b91c1c',
  dismissed: '#64748b',
};

function statusPill(status: CandidateStatus) {
  const color = STATUS_COLOR[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${color}35`, color, background: `${color}0c`, borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 750 }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function AiLearningPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [staff, setStaff] = useState<StaffEntry[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (!response.ok) throw new Error('Approved login account required');
      const body = await response.json();
      setMe(body.user);
      setSelectedEmail(body.user.email);
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const fetchCandidates = useCallback(async (email: string) => {
    const response = await fetch(`/api/ai-learning/candidates?email=${encodeURIComponent(email)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Failed to load learning candidates');
    return body as { candidates?: Candidate[]; staffDirectory?: StaffEntry[] };
  }, []);

  const load = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      const body = await fetchCandidates(selectedEmail);
      setCandidates(body.candidates ?? []);
      setStaff(body.staffDirectory ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [fetchCandidates, selectedEmail]);

  useEffect(() => {
    if (!selectedEmail) return;
    let active = true;
    void fetchCandidates(selectedEmail).then(body => {
      if (!active) return;
      setCandidates(body.candidates ?? []);
      setStaff(body.staffDirectory ?? []);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fetchCandidates, selectedEmail]);

  const analyze = async () => {
    if (!selectedEmail) return;
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai-learning/candidates?email=${encodeURIComponent(selectedEmail)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Pattern analysis failed');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAnalyzing(false);
    }
  };

  const review = async (candidate: Candidate, decision: 'approve' | 'reject' | 'dismiss' | 'reopen') => {
    setError(null);
    try {
      const response = await fetch(`/api/ai-learning/candidates/${candidate.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Review failed');
      setCandidates(current => current.map(item => item.id === candidate.id ? body.candidate : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  // "[全选高置信度项 → 一键通过] 按钮" — Vincent, 2026-09-08, on why full
  // auto-approval isn't the answer but slow one-by-one review is also the
  // wrong tradeoff. Everything reaching ready_for_review already cleared
  // confidence>=0.75 + distinct_days>=3 (see review_ai_learning_candidate's
  // own next_status logic) — approving each individually here is a
  // deliberate choice to keep this a REAL per-candidate audit trail
  // (ai_learning_feedback gets one row per candidate, actor_email is
  // Vincent's own, same as if he'd clicked each one) rather than a single
  // bulk endpoint that would blur who actually reviewed what.
  const bulkApproveReady = async () => {
    const ready = candidates.filter(candidate => candidate.status === 'ready_for_review' && mayReview(candidate));
    if (!ready.length) return;
    setBulkApproving(true);
    setError(null);
    try {
      for (const candidate of ready) {
        const response = await fetch(`/api/ai-learning/candidates/${candidate.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Review failed for candidate ${candidate.id}`);
        setCandidates(current => current.map(item => item.id === candidate.id ? body.candidate : item));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBulkApproving(false);
    }
  };

  const counts = useMemo(() => ({
    total: candidates.length,
    observing: candidates.filter(candidate => candidate.status === 'observing').length,
    ready: candidates.filter(candidate => candidate.status === 'ready_for_review').length,
    approved: candidates.filter(candidate => candidate.status === 'approved').length,
  }), [candidates]);
  const mayReview = (candidate: Candidate) => me?.admin || candidate.account_email === me?.email;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">总览 › AI 学习复核</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BrainCircuit size={21} color="#1e3a5f" />
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#1e293b' }}>AI 学习复核</h1>
            <span style={{ border: '1px solid #bae6d3', background: '#f0fdf7', color: '#08745f', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 750 }}>受控学习</span>
          </div>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12 }}>
            每天自动运行。只有置信度非常高、证据充分的观察（≥90% 置信度、在 5 个以上不同日子出现过）才会自动采纳，其余都留在这里等人工复核。业务数据永远不会被改动。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Boolean(me?.canViewActivityInsights && staff.length) && (
            <select value={selectedEmail} onChange={event => { setLoading(true); setError(null); setSelectedEmail(event.target.value); }} style={{ border: '1px solid #d8e2eb', background: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: '#334155' }}>
              {staff.map(person => <option key={person.email} value={person.email}>{person.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void analyze()} disabled={analyzing || !selectedEmail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '8px 12px', background: '#1e3a5f', color: '#fff', fontSize: 12, fontWeight: 750, cursor: analyzing ? 'wait' : 'pointer', opacity: analyzing ? 0.65 : 1 }}>
            <RefreshCcw size={13} /> {analyzing ? '分析中…' : '分析最近 30 天'}
          </button>
          {counts.ready > 0 && (
            <button type="button" onClick={() => void bulkApproveReady()} disabled={bulkApproving} title="一键采纳所有已经处于「待复核」的候选项，不用逐个打开" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #bbdfc7', borderRadius: 8, padding: '8px 12px', background: '#f3fbf6', color: '#15803d', fontSize: 12, fontWeight: 750, cursor: bulkApproving ? 'wait' : 'pointer', opacity: bulkApproving ? 0.65 : 1 }}>
              <Check size={13} /> {bulkApproving ? '采纳中…' : `采纳所有待复核（${counts.ready}）`}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <MetricCard value={counts.total} label="发现的模式" sub="只是观察，不是事实" icon={<BrainCircuit size={16} />} color="#1e3a5f" />
        <MetricCard value={counts.observing} label="仍在观察" sub="证据还不够" icon={<Eye size={16} />} color="#64748b" />
        <MetricCard value={counts.ready} label="待复核" sub="永远不会自动采纳" icon={<ShieldCheck size={16} />} color="#b45309" />
        <MetricCard value={counts.approved} label="已采纳" sub="AI 会参考" icon={<Check size={16} />} color="#15803d" />
      </div>

      {error && <div style={{ marginBottom: 12, border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 12 }}>{error}</div>}

      <div className="system-list-shell">
        <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="system-list-title">学习候选项</span>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>共 {candidates.length} 条</span>
        </div>
        {loading ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>加载中…</div>
        ) : candidates.length === 0 ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>
            目前还没有任何重复模式积累到足够的证据。
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 5 }}>行为追踪从 2026 年 9 月 8 日开始，之前的数据无法补齐。</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="system-list-table" style={{ width: '100%', minWidth: 980 }}>
              <thead><tr className="list-column-header-gray"><th>候选项</th><th>证据</th><th>置信度</th><th>状态</th><th>复核</th></tr></thead>
              <tbody>
                {candidates.map(candidate => (
                  <tr key={candidate.id} className="system-list-row">
                    <td style={{ padding: '12px 14px', maxWidth: 480 }}>
                      <div style={{ color: '#173b61', fontWeight: 750, fontSize: 12.5 }}>{zhContent(candidate.approved_content ?? candidate.proposed_content)}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10.5, marginTop: 4 }}>{PATTERN_KIND_LABEL[candidate.pattern_kind]} · {candidate.pattern_key}</div>
                    </td>
                    <td style={{ padding: '12px 14px', color: '#475569', fontSize: 11.5 }}>{candidate.source_count} 次观察<br/><span style={{ color: '#94a3b8' }}>横跨 {candidate.distinct_days} 天</span></td>
                    <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 750 }}>{Math.round(candidate.confidence * 100)}%</td>
                    <td style={{ padding: '12px 14px' }}>{statusPill(candidate.status)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {mayReview(candidate) ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {candidate.status !== 'approved' && <button type="button" onClick={() => void review(candidate, 'approve')} title="采纳这条观察" style={{ border: '1px solid #bbdfc7', background: '#f3fbf6', color: '#15803d', borderRadius: 7, padding: '5px 8px', cursor: 'pointer' }}><Check size={13}/></button>}
                          {!['rejected', 'dismissed'].includes(candidate.status) && <button type="button" onClick={() => void review(candidate, 'reject')} title="拒绝这条观察" style={{ border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 7, padding: '5px 8px', cursor: 'pointer' }}><X size={13}/></button>}
                          {['approved', 'rejected', 'dismissed'].includes(candidate.status) && <button type="button" onClick={() => void review(candidate, 'reopen')} style={{ border: '1px solid #d8e2eb', background: '#fff', color: '#475569', borderRadius: 7, padding: '5px 8px', fontSize: 10.5, cursor: 'pointer' }}>重新打开</button>}
                        </div>
                      ) : <span style={{ color: '#94a3b8', fontSize: 10.5 }}>仅可查看</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
