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
  observing: 'Observing',
  ready_for_review: 'Ready for review',
  approved: 'Approved',
  rejected: 'Rejected',
  dismissed: 'Dismissed',
};
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

  const counts = useMemo(() => ({
    total: candidates.length,
    observing: candidates.filter(candidate => candidate.status === 'observing').length,
    ready: candidates.filter(candidate => candidate.status === 'ready_for_review').length,
    approved: candidates.filter(candidate => candidate.status === 'approved').length,
  }), [candidates]);
  const mayReview = (candidate: Candidate) => me?.admin || candidate.account_email === me?.email;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › AI Learning Review</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BrainCircuit size={21} color="#1e3a5f" />
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#1e293b' }}>AI Learning Review</h1>
            <span style={{ border: '1px solid #bae6d3', background: '#f0fdf7', color: '#08745f', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 750 }}>CONTROLLED LEARNING</span>
          </div>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12 }}>
            Unreviewed observations remain inactive. Only an explicit approval promotes one into this user&apos;s AI memory; business data is never changed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Boolean(me?.canViewActivityInsights && staff.length) && (
            <select value={selectedEmail} onChange={event => { setLoading(true); setError(null); setSelectedEmail(event.target.value); }} style={{ border: '1px solid #d8e2eb', background: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: '#334155' }}>
              {staff.map(person => <option key={person.email} value={person.email}>{person.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void analyze()} disabled={analyzing || !selectedEmail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '8px 12px', background: '#1e3a5f', color: '#fff', fontSize: 12, fontWeight: 750, cursor: analyzing ? 'wait' : 'pointer', opacity: analyzing ? 0.65 : 1 }}>
            <RefreshCcw size={13} /> {analyzing ? 'Analyzing…' : 'Analyze last 30 days'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <MetricCard value={counts.total} label="Detected Patterns" sub="observations, not facts" icon={<BrainCircuit size={16} />} color="#1e3a5f" />
        <MetricCard value={counts.observing} label="Still Observing" sub="not enough evidence yet" icon={<Eye size={16} />} color="#64748b" />
        <MetricCard value={counts.ready} label="Ready for Review" sub="never approved automatically" icon={<ShieldCheck size={16} />} color="#b45309" />
        <MetricCard value={counts.approved} label="Approved" sub="available to AI context" icon={<Check size={16} />} color="#15803d" />
      </div>

      {error && <div style={{ marginBottom: 12, border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 12 }}>{error}</div>}

      <div className="system-list-shell">
        <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="system-list-title">Learning Candidates</span>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>{candidates.length} records</span>
        </div>
        {loading ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>
        ) : candidates.length === 0 ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>
            No repeated pattern has enough real evidence yet.
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 5 }}>Activity tracking began on 08 Sep 2026 and cannot be backfilled.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="system-list-table" style={{ width: '100%', minWidth: 980 }}>
              <thead><tr className="list-column-header-gray"><th>Candidate</th><th>Evidence</th><th>Confidence</th><th>Status</th><th>Review</th></tr></thead>
              <tbody>
                {candidates.map(candidate => (
                  <tr key={candidate.id} className="system-list-row">
                    <td style={{ padding: '12px 14px', maxWidth: 480 }}>
                      <div style={{ color: '#173b61', fontWeight: 750, fontSize: 12.5 }}>{candidate.approved_content ?? candidate.proposed_content}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10.5, marginTop: 4 }}>{candidate.pattern_kind} · {candidate.pattern_key}</div>
                    </td>
                    <td style={{ padding: '12px 14px', color: '#475569', fontSize: 11.5 }}>{candidate.source_count} observations<br/><span style={{ color: '#94a3b8' }}>across {candidate.distinct_days} days</span></td>
                    <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 750 }}>{Math.round(candidate.confidence * 100)}%</td>
                    <td style={{ padding: '12px 14px' }}>{statusPill(candidate.status)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {mayReview(candidate) ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {candidate.status !== 'approved' && <button type="button" onClick={() => void review(candidate, 'approve')} title="Approve observation" style={{ border: '1px solid #bbdfc7', background: '#f3fbf6', color: '#15803d', borderRadius: 7, padding: '5px 8px', cursor: 'pointer' }}><Check size={13}/></button>}
                          {!['rejected', 'dismissed'].includes(candidate.status) && <button type="button" onClick={() => void review(candidate, 'reject')} title="Reject observation" style={{ border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 7, padding: '5px 8px', cursor: 'pointer' }}><X size={13}/></button>}
                          {['approved', 'rejected', 'dismissed'].includes(candidate.status) && <button type="button" onClick={() => void review(candidate, 'reopen')} style={{ border: '1px solid #d8e2eb', background: '#fff', color: '#475569', borderRadius: 7, padding: '5px 8px', fontSize: 10.5, cursor: 'pointer' }}>Reopen</button>}
                        </div>
                      ) : <span style={{ color: '#94a3b8', fontSize: 10.5 }}>View only</span>}
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
