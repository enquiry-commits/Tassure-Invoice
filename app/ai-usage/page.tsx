'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CalendarDays, CalendarRange, ChevronDown, ChevronRight, Clock, Coins, RefreshCcw } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import {
  FEATURE_LABEL, TRIGGER_LABEL, groupCallsByPerson, monthLabel,
  type PersonCalls, type PersonUsage, type UsageEventRow, type UsageSummary, type UsageTotals, type UsageWindow,
} from '@/lib/ai/usage-report';

// Admin › AI Usage — every person's AI token usage and estimated cost
// (docs/INVARIANTS.md INV-AI-010). Vincent, 2026-10-05: "为了准确的知道每个人
// 使用了多少TOKENS，我要有一个明确的实时记录" — only he sees it, View As
// counts for the real operator, automatic calls count under the person but
// shown apart, USD. Every AI call lands in ai_usage_events seconds after it
// happens; this page re-reads it every 30 seconds while it is open.
//
// 2026-10-07 (Vincent): every table is 5 equal columns; the call list is read
// by MONTH ("2026 - Sep"), grouped by person — system first, then colleagues —
// and a person's calls stay folded until their row is opened. Only
// time / person / feature / model / cost are shown per call.

type UsageResponse = {
  generatedAt: string;
  totalRows: number;
  firstRecordedAt: string | null;
  summary: UsageSummary;
  month: string;
  months: string[];
  monthCalls: UsageEventRow[];
  monthCallsTruncated: boolean;
  names: Record<string, string>;
};

const REFRESH_MS = 30_000;

type LoadResult = { data: UsageResponse } | { missing: string } | { error: string };

async function fetchUsage(month: string | null): Promise<LoadResult> {
  try {
    const response = await fetch(`/api/ai-usage${month ? `?month=${month}` : ''}`, { cache: 'no-store' });
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

// Every table on this page is five equal columns.
const FIVE_COLS = (
  <colgroup>
    {[0, 1, 2, 3, 4].map(i => <col key={i} style={{ width: '20%' }} />)}
  </colgroup>
);
const TABLE_STYLE = { width: '100%', tableLayout: 'fixed', minWidth: 760 } as const;
const CELL = { padding: '8px 10px' } as const;

function TotalsCell({ t, muted }: { t: UsageTotals; muted?: boolean }) {
  if (!t.calls) return <span style={{ color: '#cbd5e1' }}>—</span>;
  return (
    <div style={{ lineHeight: 1.35 }}>
      <div style={{ fontWeight: 700, color: muted ? '#64748b' : '#173b61', fontSize: 13 }}>{usd(t.costUsd)}{t.unpricedCalls > 0 && <span title="部分调用的模型价格未确认，未计入金额" style={{ color: '#b45309' }}> +?</span>}</div>
      <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{tokens(t.tokens)} tokens · {t.calls} 次</div>
    </div>
  );
}

function Cost({ value, unpriced }: { value: number | string | null; unpriced?: number }) {
  if (value === null) return <span title="这个模型的价格未确认" style={{ color: '#b45309' }}>未定价</span>;
  return <>{usd(Number(value))}{unpriced ? <span title="部分调用的模型价格未确认，未计入金额" style={{ color: '#b45309' }}> +?</span> : null}</>;
}

export default function AiUsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [notice, setNotice] = useState<{ kind: 'missing' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState<string | null>(null); // null = the current month
  const [open, setOpen] = useState<Set<string>>(new Set()); // folded by default
  const monthRef = useRef<string | null>(null);
  monthRef.current = month;

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
    const run = () => { void fetchUsage(monthRef.current).then(result => { if (alive) apply(result); }); };
    run();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [apply]);

  const refreshNow = () => { setRefreshing(true); void fetchUsage(month).then(apply); };
  const pickMonth = (m: string) => { setMonth(m); setOpen(new Set()); setRefreshing(true); void fetchUsage(m).then(apply); };
  const toggle = (key: string) => setOpen(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const nameOf = (email: string | null) => (email ? data?.names[email.toLowerCase()] ?? email : '—');
  const personLabel = (p: Pick<PersonUsage, 'kind' | 'email'>) => (p.kind === 'system' ? '系统（定时任务、My Tasks 提醒）' : p.kind === 'unidentified' ? '未识别的调用' : nameOf(p.email));
  const summary = data?.summary;
  const unpriced = summary?.windows.month.unpricedCalls ?? 0;
  const groups: PersonCalls[] = data ? groupCallsByPerson(data.monthCalls) : [];
  const monthCost = summary?.windows.month.costUsd ?? 0;
  const monthCalls = summary?.windows.month.calls ?? 0;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Admin › AI Usage</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <Bot size={21} color="#1e3a5f" />
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: '#1e293b' }}>AI 用量</h1>
            <span style={{ border: '1px solid #bae6d3', background: '#f0fdf7', color: '#08745f', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, fontWeight: 700 }}>实时 · 每 30 秒刷新</span>
          </div>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 12, maxWidth: 760 }}>
            每一次 AI 调用（助手聊天、Turnover AI 读单据、My Tasks 今日提醒、定时任务…）都会记一笔：谁、哪个功能、哪个模型、多少 token、按官网价格估算多少美元。
            用 View As 时算真正操作的人；My Tasks 今日提醒一律算系统；聊天后的自动学习算本人，但单独列为「自动」。
          </p>
        </div>
        <button type="button" onClick={refreshNow} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '8px 12px', background: '#1e3a5f', color: '#fff', fontSize: 12, fontWeight: 700, cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.65 : 1, flexShrink: 0 }}>
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
                <table className="system-list-table" style={TABLE_STYLE}>
                  {FIVE_COLS}
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
                        <td style={{ ...CELL, fontWeight: 700, color: p.kind === 'person' ? '#1e293b' : '#64748b' }}>{personLabel(p)}</td>
                        {(['today', 'week', 'month'] as const).map(w => <td key={w} style={CELL}><TotalsCell t={p.windows[w]} /></td>)}
                        <td style={CELL}><TotalsCell t={p.autoMonth} muted /></td>
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
                <table className="system-list-table" style={TABLE_STYLE}>
                  {FIVE_COLS}
                  <thead>
                    <tr className="list-column-header-gray">
                      <th style={{ textAlign: 'left' }}>功能</th>
                      {(['today', 'week', 'month'] as const).map(w => <th key={w} style={{ textAlign: 'left' }}>{WINDOW_LABEL[w]}</th>)}
                      <th style={{ textAlign: 'left' }}>本月占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.features.map(f => {
                      const m = f.windows.month;
                      // Share of this month's spend (by calls when nothing is priced yet).
                      const share = monthCost > 0 ? (m.costUsd / monthCost) * 100 : monthCalls > 0 ? (m.calls / monthCalls) * 100 : 0;
                      return (
                        <tr key={f.feature} className="system-list-row">
                          <td style={{ ...CELL, fontWeight: 700, color: '#1e293b' }}>{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                          {(['today', 'week', 'month'] as const).map(w => <td key={w} style={CELL}><TotalsCell t={f.windows[w]} /></td>)}
                          <td style={CELL}>
                            {m.calls ? (
                              <div style={{ lineHeight: 1.35 }}>
                                <div style={{ fontWeight: 700, color: '#173b61', fontSize: 13 }}>{share >= 1 ? `${Math.round(share)}%` : share > 0 ? '<1%' : '0%'}</div>
                                <div style={{ marginTop: 3, height: 4, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.min(100, share)}%`, height: '100%', background: '#1e3a5f' }} />
                                </div>
                              </div>
                            ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="system-list-shell" style={{ marginBottom: 12 }}>
            <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="system-list-title">每月调用明细</span>
              <select value={data.month} onChange={e => pickMonth(e.target.value)} aria-label="选择月份"
                style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' }}>
                {data.months.map(m => <option key={m} value={m} style={{ color: '#1e293b' }}>{monthLabel(m)}</option>)}
              </select>
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.7)', fontSize: 11 }}>点人员那一行展开 · {data.monthCalls.length} 次</span>
              {groups.length > 0 && (
                <button type="button" onClick={() => setOpen(open.size === groups.length ? new Set() : new Set(groups.map(g => g.key)))}
                  style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>
                  {open.size === groups.length ? '全部收起' : '全部展开'}
                </button>
              )}
            </div>
            {groups.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 12.5 }}>{monthLabel(data.month)} 没有 AI 调用记录。</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="system-list-table" style={TABLE_STYLE}>
                  {FIVE_COLS}
                  <thead>
                    <tr className="list-column-header-gray">
                      <th style={{ textAlign: 'left' }}>人员</th>
                      <th style={{ textAlign: 'left' }}>时间</th>
                      <th style={{ textAlign: 'left' }}>功能</th>
                      <th style={{ textAlign: 'left' }}>模型</th>
                      <th style={{ textAlign: 'right' }}>费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(g => {
                      const isOpen = open.has(g.key);
                      return (
                        <Fragment key={g.key}>
                          <tr className="system-list-row" onClick={() => toggle(g.key)} aria-expanded={isOpen}
                            style={{ cursor: 'pointer', background: g.kind === 'person' ? '#fff' : '#f8fafc' }}>
                            <td style={{ ...CELL, fontWeight: 700, color: g.kind === 'person' ? '#1e293b' : '#64748b' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {isOpen ? <ChevronDown size={14} color="#64748b" /> : <ChevronRight size={14} color="#64748b" />}
                                {personLabel(g)}
                              </span>
                            </td>
                            <td style={{ ...CELL, fontSize: 12, color: '#475569', fontWeight: 700 }}>{monthLabel(data.month)}</td>
                            <td style={{ ...CELL, fontSize: 12, color: '#64748b' }}>{g.totals.calls} 次调用</td>
                            <td style={{ ...CELL, fontSize: 11.5, color: '#64748b' }} title={g.models.join(', ')}>
                              {g.models.length === 0 ? '—' : g.models.length === 1 ? g.models[0] : `${g.models.length} 个模型`}
                            </td>
                            <td style={{ ...CELL, textAlign: 'right', fontWeight: 700, color: '#173b61' }}><Cost value={g.totals.costUsd} unpriced={g.totals.unpricedCalls} /></td>
                          </tr>
                          {isOpen && g.calls.map(r => (
                            <tr key={r.id} className="system-list-row" style={{ background: '#fbfdff' }}>
                              <td style={{ ...CELL, padding: '6px 10px 6px 30px', color: '#cbd5e1', fontSize: 11 }}>↳</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#64748b', fontSize: 11.5 }}>{sgt(r.created_at)}</td>
                              <td style={{ padding: '6px 10px', fontSize: 12 }}>
                                {FEATURE_LABEL[r.feature] ?? r.feature}
                                <span style={{ marginLeft: 6, fontSize: 10, color: r.trigger === 'auto' ? '#b45309' : '#64748b', background: r.trigger === 'auto' ? '#fffbeb' : '#f1f5f9', borderRadius: 999, padding: '1px 6px' }}>{TRIGGER_LABEL[r.trigger] ?? r.trigger}{r.step ? ` · ${r.step}` : ''}</span>
                                {g.kind === 'system'
                                  // The system's reminders are counted under it, so say whose page each one was for.
                                  ? (r.subject_email ?? r.actor_email) && <span style={{ color: '#94a3b8', fontSize: 10.5 }}> · 给 {nameOf(r.subject_email ?? r.actor_email)}</span>
                                  : r.subject_email && <span style={{ color: '#94a3b8', fontSize: 10.5 }}> · 代 {nameOf(r.subject_email)}</span>}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.model ?? '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#173b61' }}><Cost value={r.cost_usd} /></td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {data.monthCallsTruncated && <div style={{ padding: '8px 14px', fontSize: 11, color: '#b45309' }}>这个月的调用太多，只显示最新的部分。</div>}
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
