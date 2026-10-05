'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CalendarDays, CalendarRange, Clock, Coins, RefreshCcw } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import {
  FEATURE_LABEL, TRIGGER_LABEL,
  type PersonUsage, type UsageEventRow, type UsageSummary, type UsageTotals, type UsageWindow,
} from '@/lib/ai/usage-report';

// Admin › AI Usage — every person's AI token usage and estimated cost
// (docs/INVARIANTS.md INV-AI-010). Vincent, 2026-10-05: "为了准确的知道每个人
// 使用了多少TOKENS，我要有一个明确的实时记录" — only he sees it, View As
// counts for the real operator, automatic calls count under the person but
// shown apart, USD. Every AI call lands in ai_usage_events seconds after it
// happens; this page re-reads it every 30 seconds while it is open.

type UsageResponse = {
  generatedAt: string;
  totalRows: number;
  firstRecordedAt: string | null;
  summary: UsageSummary;
  recent: UsageEventRow[];
  names: Record<string, string>;
};

const REFRESH_MS = 30_000;

type LoadResult = { data: UsageResponse } | { missing: string } | { error: string };

async function fetchUsage(): Promise<LoadResult> {
  try {
    const response = await fetch('/api/ai-usage', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) return { error: body.error || 'Failed to load AI usage' };
    if (body.tableMissing) return { missing: body.error };
    return { data: body as UsageResponse };
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : String(reason) };
  }
}

const usd = (v: number) => (v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 10_000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString('en-SG'));
const sgt = (iso: string, withDate = true) => new Date(iso).toLocaleString('en-SG', {
  timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: withDate ? undefined : '2-digit',
  ...(withDate ? { day: '2-digit', month: 'short' } : {}), hour12: false,
});

const WINDOW_LABEL: Record<UsageWindow, string> = { today: '今天', week: '近 7 天', month: '本月' };

function TotalsCell({ t, muted }: { t: UsageTotals; muted?: boolean }) {
  if (!t.calls) return <span style={{ color: '#cbd5e1' }}>—</span>;
  return (
    <div style={{ lineHeight: 1.35 }}>
      <div style={{ fontWeight: 800, color: muted ? '#64748b' : '#173b61', fontSize: 13 }}>{usd(t.costUsd)}{t.unpricedCalls > 0 && <span title="部分调用的模型价格未确认，未计入金额" style={{ color: '#b45309' }}> +?</span>}</div>
      <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{tokens(t.tokens)} tokens · {t.calls} 次</div>
    </div>
  );
}

export default function AiUsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [notice, setNotice] = useState<{ kind: 'missing' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((result: LoadResult) => {
    if ('data' in result) { setData(result.data); setNotice(null); }
    else if ('missing' in result) { setData(null); setNotice({ kind: 'missing', text: result.missing }); }
    else setNotice({ kind: 'error', text: result.error });
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Live: re-read every 30 seconds while the tab is visible, and at once when it comes back.
  useEffect(() => {
    let alive = true;
    const run = () => { void fetchUsage().then(result => { if (alive) apply(result); }); };
    run();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [apply]);

  const refreshNow = () => { setRefreshing(true); void fetchUsage().then(apply); };

  const nameOf = (email: string | null) => (email ? data?.names[email.toLowerCase()] ?? email : '—');
  const personLabel = (p: PersonUsage) => (p.kind === 'system' ? '系统（定时任务）' : p.kind === 'unidentified' ? '未识别的调用' : nameOf(p.email));
  const summary = data?.summary;
  const unpriced = summary?.windows.month.unpricedCalls ?? 0;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Admin › AI Usage</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <Bot size={21} color="#1e3a5f" />
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#1e293b' }}>AI 用量</h1>
            <span style={{ border: '1px solid #bae6d3', background: '#f0fdf7', color: '#08745f', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 750 }}>实时 · 每 30 秒刷新</span>
          </div>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12, maxWidth: 760 }}>
            每一次 AI 调用（助手聊天、Turnover AI 读单据、My Tasks 今日提醒、定时任务…）都会记一笔：谁、哪个功能、哪个模型、多少 token、按官网价格估算多少美元。
            用 View As 时算真正操作的人；打开页面自动产生的调用算本人，但单独列为「自动」。
          </p>
        </div>
        <button type="button" onClick={refreshNow} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '8px 12px', background: '#1e3a5f', color: '#fff', fontSize: 12, fontWeight: 750, cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.65 : 1, flexShrink: 0 }}>
          <RefreshCcw size={13} /> {refreshing ? '刷新中…' : '立即刷新'}
        </button>
      </div>

      {notice && (
        <div style={{ marginBottom: 14, border: `1px solid ${notice.kind === 'missing' ? '#fde68a' : '#fecaca'}`, background: notice.kind === 'missing' ? '#fffbeb' : '#fff7f7', color: notice.kind === 'missing' ? '#92400e' : '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 12.5 }}>
          {notice.kind === 'missing' ? <>还没有建立用量记录表。请在 Supabase SQL editor 运行 <code>scripts/add-ai-usage-events.sql</code>，之后每一次 AI 调用都会出现在这里。</> : notice.text}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 42, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>加载中…</div>
      ) : summary && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
            <MetricCard value={usd(summary.windows.today.costUsd)} label="今天" sub={`${tokens(summary.windows.today.tokens)} tokens · ${summary.windows.today.calls} 次调用`} icon={<Clock size={16} />} color="#1e3a5f" />
            <MetricCard value={usd(summary.windows.week.costUsd)} label="近 7 天" sub={`${tokens(summary.windows.week.tokens)} tokens · ${summary.windows.week.calls} 次调用`} icon={<CalendarDays size={16} />} color="#0f766e" />
            <MetricCard value={usd(summary.windows.month.costUsd)} label="本月" sub={`${tokens(summary.windows.month.tokens)} tokens · ${summary.windows.month.calls} 次调用`} icon={<CalendarRange size={16} />} color="#7c3aed" />
            <MetricCard value={data.totalRows.toLocaleString('en-SG')} label="已记录调用" sub={data.firstRecordedAt ? `从 ${sgt(data.firstRecordedAt)} 开始` : '还没有记录'} icon={<Coins size={16} />} color="#64748b" />
          </div>

          <div className="system-list-shell" style={{ marginBottom: 16 }}>
            <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="system-list-title">按人</span>
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>更新于 {sgt(data.generatedAt, false)}</span>
            </div>
            {summary.people.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>本月还没有 AI 调用记录。</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="system-list-table" style={{ width: '100%', minWidth: 640 }}>
                  <thead>
                    <tr className="list-column-header-gray">
                      <th style={{ textAlign: 'left' }}>人员</th>
                      {(['today', 'week', 'month'] as const).map(w => <th key={w} style={{ textAlign: 'left' }}>{WINDOW_LABEL[w]}</th>)}
                      <th style={{ textAlign: 'left' }}>本月其中「自动」</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.people.map(p => (
                      <tr key={p.key} className="system-list-row" style={{ background: p.kind === 'person' ? undefined : '#f8fafc' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: p.kind === 'person' ? '#1e293b' : '#64748b' }}>{personLabel(p)}</td>
                        {(['today', 'week', 'month'] as const).map(w => <td key={w} style={{ padding: '8px 10px' }}><TotalsCell t={p.windows[w]} /></td>)}
                        <td style={{ padding: '8px 10px' }}><TotalsCell t={p.autoMonth} muted /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="system-list-shell" style={{ marginBottom: 16 }}>
            <div className="system-list-title-bar px-4 py-3"><span className="system-list-title">按功能</span></div>
            {summary.features.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>本月还没有 AI 调用记录。</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="system-list-table" style={{ width: '100%', minWidth: 520 }}>
                  <thead>
                    <tr className="list-column-header-gray">
                      <th style={{ textAlign: 'left' }}>功能</th>
                      {(['today', 'week', 'month'] as const).map(w => <th key={w} style={{ textAlign: 'left' }}>{WINDOW_LABEL[w]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.features.map(f => (
                      <tr key={f.feature} className="system-list-row">
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1e293b' }}>{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                        {(['today', 'week', 'month'] as const).map(w => <td key={w} style={{ padding: '8px 10px' }}><TotalsCell t={f.windows[w]} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="system-list-shell" style={{ marginBottom: 12 }}>
            <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center' }}>
              <span className="system-list-title">最近的调用</span>
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>最新 {data.recent.length} 次</span>
            </div>
            {data.recent.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>还没有记录。下一次有人使用 AI，几秒内就会出现在这里。</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="system-list-table" style={{ width: '100%', minWidth: 860 }}>
                  <thead>
                    <tr className="list-column-header-gray">
                      <th style={{ textAlign: 'left' }}>时间</th>
                      <th style={{ textAlign: 'left' }}>人员</th>
                      <th style={{ textAlign: 'left' }}>功能</th>
                      <th style={{ textAlign: 'left' }}>模型</th>
                      <th style={{ textAlign: 'right' }}>输入</th>
                      <th style={{ textAlign: 'right' }}>写缓存</th>
                      <th style={{ textAlign: 'right' }}>读缓存</th>
                      <th style={{ textAlign: 'right' }}>输出</th>
                      <th style={{ textAlign: 'right' }}>费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map(r => (
                      <tr key={r.id} className="system-list-row">
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#64748b', fontSize: 11.5 }}>{sgt(r.created_at)}</td>
                        <td style={{ padding: '6px 10px', fontSize: 12 }}>
                          {r.actor_email ? nameOf(r.actor_email) : r.trigger === 'cron' ? '系统' : '未识别'}
                          {r.subject_email && <span style={{ color: '#94a3b8', fontSize: 10.5 }}> · 代 {nameOf(r.subject_email)}</span>}
                        </td>
                        <td style={{ padding: '6px 10px', fontSize: 12 }}>
                          {FEATURE_LABEL[r.feature] ?? r.feature}
                          <span style={{ marginLeft: 6, fontSize: 10, color: r.trigger === 'auto' ? '#b45309' : '#64748b', background: r.trigger === 'auto' ? '#fffbeb' : '#f1f5f9', borderRadius: 999, padding: '1px 6px' }}>{TRIGGER_LABEL[r.trigger] ?? r.trigger}{r.step ? ` · ${r.step}` : ''}</span>
                        </td>
                        <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{r.model ?? '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11.5 }}>{tokens(r.input_tokens)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11.5, color: '#64748b' }}>{tokens(r.cache_write_tokens)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11.5, color: '#64748b' }}>{tokens(r.cache_read_tokens)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11.5 }}>{tokens(r.output_tokens)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#173b61' }}>{r.cost_usd === null ? <span title="这个模型的价格未确认" style={{ color: '#b45309' }}>未定价</span> : usd(Number(r.cost_usd))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 11, lineHeight: 1.6 }}>
            费用按 Anthropic / OpenAI 官网标准价估算（2026-10-05 读取，写入时即固定，之后调价不改旧记录），实际以两家后台账单为准。
            Token 总数包含缓存：读缓存约为普通输入价格的 1/10，所以 token 多不一定钱多。
            因超时被中断的请求，厂商可能仍会收费，但拿不到用量，这里记不到。
            {unpriced > 0 && <span style={{ color: '#b45309' }}> 本月有 {unpriced} 次调用的模型还没有确认价格，金额未计入（标为「+?」）。</span>}
          </p>
        </>
      )}
    </div>
  );
}
