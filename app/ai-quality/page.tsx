'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, RefreshCcw, ShieldAlert, X } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

type QualityIssue = { category: string; description: string };
type QualityReviewRow = {
  id: number;
  created_at: string;
  account_email: string;
  user_question: string;
  assistant_reply: string;
  tools_used: string[];
  verdict: 'pass' | 'flag';
  issues: QualityIssue[];
  judge_model: string;
  human_verdict: 'confirmed_issue' | 'false_positive' | null;
  human_note: string | null;
};
type Me = { email: string; name: string; admin: boolean };

const ISSUE_LABEL: Record<string, string> = {
  capability_denial: '虚假否认能力',
  unfounded_specificity: '无据妄断',
  language_or_relevance: '答非所问/语言',
  incomplete_or_confusing: '不完整/令人困惑',
  other: '其他',
};

export default function AiQualityPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [reviews, setReviews] = useState<QualityReviewRow[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (!response.ok) throw new Error('Approved login account required');
      const body = await response.json();
      setMe(body.user);
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const load = useCallback(async (open: boolean) => {
    try {
      const response = await fetch(`/api/ai-quality/reviews${open ? '' : '?all=1'}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to load quality reviews');
      setReviews(body.reviews ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); void load(onlyOpen); }, [load, onlyOpen]);

  // Manual trigger — same reasoning as AI Learning's own "分析最近 30 天"
  // button: the daily cron (vercel.json, 23:00 UTC) keeps this running
  // unattended, but a manual button lets Vincent see a real result right
  // now instead of waiting for tonight's run.
  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/ai-quality/review');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Quality review run failed');
      if (body.skippedNoKey) throw new Error('ANTHROPIC_API_KEY 未配置，无法运行抽查。');
      await load(onlyOpen);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  const humanReview = async (row: QualityReviewRow, verdict: 'confirmed_issue' | 'false_positive') => {
    setError(null);
    try {
      const response = await fetch(`/api/ai-quality/reviews/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Review failed');
      setReviews(current => onlyOpen ? current.filter(item => item.id !== row.id) : current.map(item => item.id === row.id ? body.review : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const counts = useMemo(() => ({
    total: reviews.length,
    flaggedOpen: reviews.filter(r => r.verdict === 'flag' && !r.human_verdict).length,
    confirmed: reviews.filter(r => r.human_verdict === 'confirmed_issue').length,
    falsePositive: reviews.filter(r => r.human_verdict === 'false_positive').length,
  }), [reviews]);

  if (!me) return null;
  if (!me.admin) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>System administrator access required.</div>;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">总览 › AI 回复质量抽查</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ShieldAlert size={21} color="#1e3a5f" />
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#1e293b' }}>AI 回复质量抽查</h1>
            <span style={{ border: '1px solid #bae6d3', background: '#f0fdf7', color: '#08745f', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 750 }}>自动抽查</span>
          </div>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12, maxWidth: 720 }}>
            每天随机抽查最近的真实 My Tasks/助手回复，由 Claude 按固定标准判断是否有虚假否认能力、无据妄断等行为问题。
            <strong>诚实说明</strong>：这里没有真实工具返回的数据，判断不了金额/日期这类事实是否正确，只能抓行为异常——不是全面的事实核查。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', border: '1px solid #d8e2eb', background: '#fff', borderRadius: 8, padding: '7px 10px' }}>
            <input type="checkbox" checked={onlyOpen} onChange={event => setOnlyOpen(event.target.checked)} />
            只看待处理
          </label>
          <button type="button" onClick={() => void runNow()} disabled={running} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '8px 12px', background: '#1e3a5f', color: '#fff', fontSize: 12, fontWeight: 750, cursor: running ? 'wait' : 'pointer', opacity: running ? 0.65 : 1 }}>
            <RefreshCcw size={13} /> {running ? '抽查中…' : '立即抽查'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <MetricCard value={counts.total} label={onlyOpen ? '待处理条目' : '已加载条目'} sub="不是全部历史" icon={<ShieldAlert size={16} />} color="#1e3a5f" />
        <MetricCard value={counts.flaggedOpen} label="被标记，未处理" sub="需要人工看一眼" icon={<AlertTriangle size={16} />} color="#b45309" />
        <MetricCard value={counts.confirmed} label="人工确认属实" sub="真实问题" icon={<X size={16} />} color="#b91c1c" />
        <MetricCard value={counts.falsePositive} label="人工判定误报" sub="AI判断本身错了" icon={<Check size={16} />} color="#64748b" />
      </div>

      {error && <div style={{ marginBottom: 12, border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 12 }}>{error}</div>}

      <div className="system-list-shell">
        <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="system-list-title">抽查记录</span>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>共 {reviews.length} 条</span>
        </div>
        {loading ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>加载中…</div>
        ) : reviews.length === 0 ? (
          <div style={{ padding: 42, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>
            {onlyOpen ? '目前没有待处理的问题——干净。' : '还没有任何抽查记录。'}
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 5 }}>每天 23:00 UTC 自动运行一次，也可以点上方"立即抽查"。</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {reviews.map(row => (
              <div key={row.id} style={{ padding: '14px 16px', borderTop: '1px solid #eef2f7' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{row.account_email} · {new Date(row.created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</span>
                  {row.tools_used.length > 0 ? (
                    <span style={{ fontSize: 10, color: '#0f766e', background: '#f0fdfa', border: '1px solid #ccfbf1', borderRadius: 999, padding: '1px 7px' }}>用了 {row.tools_used.length} 个工具</span>
                  ) : (
                    <span style={{ fontSize: 10, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 7px' }}>本轮没调用任何工具</span>
                  )}
                  {row.human_verdict === 'confirmed_issue' && <span style={{ fontSize: 10, fontWeight: 800, color: '#b91c1c', background: '#fff7f7', border: '1px solid #fecaca', borderRadius: 999, padding: '1px 7px' }}>已确认为真实问题</span>}
                  {row.human_verdict === 'false_positive' && <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 7px' }}>已判定为误报</span>}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}><strong style={{ color: '#173b61' }}>问：</strong>{row.user_question.slice(0, 300)}</div>
                <div style={{ fontSize: 12, color: '#334155', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: '8px 10px', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{row.assistant_reply.slice(0, 800)}</div>
                {row.issues.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {row.issues.map((issue, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 8px', marginBottom: 4 }}>
                        <strong>{ISSUE_LABEL[issue.category] ?? issue.category}</strong> — {issue.description}
                      </div>
                    ))}
                  </div>
                )}
                {!row.human_verdict && (
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button type="button" onClick={() => void humanReview(row, 'confirmed_issue')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #fecaca', background: '#fff7f7', color: '#b91c1c', borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      <X size={12} /> 确实有问题
                    </button>
                    <button type="button" onClick={() => void humanReview(row, 'false_positive')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      <Check size={12} /> AI判断错了/无所谓
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
