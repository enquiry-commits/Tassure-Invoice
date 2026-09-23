'use client';

import { useEffect, useState } from 'react';
import { Newspaper, RefreshCw, Scale, Globe2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

// "SG Latest News" — Vincent, 2026-09-23: daily ACRA/IRAS/MOM/ICA/ISCA/CSIS
// (policy) + Straits Times/Business Times/Zaobao (news) monitoring, for
// Tassure's own professionals, not clients. No client-side auth/redirect
// check here — proxy.ts already hard-blocks direct navigation to /sg-news
// for every account except canViewSgNews (same pattern as /ai-learning,
// not app/reports/page.tsx's own softer client-redirect-only pattern),
// and app/api/sg-news/route.ts enforces the same flag server-side too.

type SgNewsDigestItem = {
  source: string; category: 'policy' | 'news';
  title: string; url: string | null; publishedLabel: string | null;
  whatChanged: string; whyItMatters: string;
};
type DailyReport = {
  report_date: string; new_items_count: number;
  report: { summary: string; policyItems: SgNewsDigestItem[]; newsItems: SgNewsDigestItem[] };
  sources_checked: string[]; sources_failed: { source: string; error: string }[];
  generated_at: string;
};
type SyncState = { source: string; last_status: string; last_synced_at: string | null; last_item_count: number | null; last_error: string | null };

const COLORS = { ink: '#102a43', teal: '#397f78', blue: '#557795', gold: '#b98243', rose: '#b45f6b' };

function ItemCard({ item }: { item: SgNewsDigestItem }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.teal, background: '#edf4f3', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.03em' }}>{item.source}</span>
        {item.publishedLabel && <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.publishedLabel}</span>}
      </div>
      {item.url
        ? <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink, textDecoration: 'none' }}>{item.title}</a>
        : <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink }}>{item.title}</div>}
      <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.7, color: '#334155' }}>{item.whatChanged}</div>
      <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 7, background: '#f8fafc', fontSize: 12, lineHeight: 1.6, color: '#64748b' }}>
        <strong style={{ color: '#475569' }}>为什么重要：</strong>{item.whyItMatters}
      </div>
    </div>
  );
}

export default function SgNewsPage() {
  const [data, setData] = useState<{ today: string; report: DailyReport | null; history: { report_date: string; new_items_count: number }[]; syncState: SyncState[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const load = (date?: string | null) => {
    fetch(`/api/sg-news${date ? `?date=${date}` : ''}`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed to load SG Latest News');
      setData(body);
      setError(null);
    }).catch(e => setError(e.message));
  };
  useEffect(() => { load(selectedDate); }, [selectedDate]);

  const runNow = () => {
    setRunning(true); setRunMessage('正在检查全部9个来源，这可能需要几分钟…');
    fetch('/api/sg-news/sync').then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Run failed');
      setRunMessage(`完成：检查了 ${body.sourcesChecked} 个来源，发现 ${body.newItems} 条新内容${body.sourcesFailed ? `，${body.sourcesFailed} 个来源失败` : ''}。`);
      load(selectedDate);
    }).catch(e => setRunMessage(`失败：${e.message}`)).finally(() => setRunning(false));
  };

  if (error) return <div style={{ padding: 40, textAlign: 'center', color: COLORS.rose, fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;

  const report = data.report;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Newspaper size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.ink, letterSpacing: '-.02em' }}>SG Latest News</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8493a3' }}>ACRA / IRAS / MOM / ICA / ISCA / CSIS + Straits Times / Business Times / 联合早报 — daily digest. Development stage, visible to Vincent only.</p>
        </div>
        <button onClick={runNow} disabled={running}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: running ? '#94a3b8' : COLORS.teal, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: running ? 'default' : 'pointer' }}>
          <RefreshCw size={13} style={{ animation: running ? 'spin 1s linear infinite' : 'none' }} />
          {running ? '运行中…' : '手动运行一次'}
        </button>
      </div>

      {runMessage && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdfa', border: '1px solid #99f6e4', fontSize: 12.5, color: '#0f766e' }}>{runMessage}</div>
      )}

      {data.syncState.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.syncState.map(s => (
            <div key={s.source} title={s.last_error ?? undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#fff', color: s.last_status === 'success' ? '#166534' : '#991b1b' }}>
              {s.last_status === 'success' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
              {s.source}
            </div>
          ))}
        </div>
      )}

      {data.history.length > 1 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {data.history.map(h => (
            <button key={h.report_date} onClick={() => setSelectedDate(h.report_date)}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${(selectedDate ?? data.today) === h.report_date ? COLORS.teal : '#e2e8f0'}`,
                background: (selectedDate ?? data.today) === h.report_date ? '#edf4f3' : '#fff',
                color: (selectedDate ?? data.today) === h.report_date ? COLORS.teal : '#64748b',
              }}>
              <Clock size={11} />{h.report_date}
              <span style={{ color: '#94a3b8' }}>({h.new_items_count})</span>
            </button>
          ))}
        </div>
      )}

      {!report && (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#fff', borderRadius: 14, border: '1px solid #dfe7ec' }}>
          还没有任何报告——点击&ldquo;手动运行一次&rdquo;生成第一份，或者等下一次每日 06:30 (SGT) 的自动运行。
        </div>
      )}

      {report && (
        <>
          <section style={{ background: 'linear-gradient(135deg,#102a43,#1d3a5c)', borderRadius: 16, padding: '18px 22px', color: '#fff' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>
              {report.report_date} · {report.new_items_count} 条新内容 · 生成于 {new Date(report.generated_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>{report.report.summary}</div>
            {report.sources_failed.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,.6)' }}>
                {report.sources_failed.length} 个来源本次未能成功检查：{report.sources_failed.map(f => f.source).join(', ')}
              </div>
            )}
          </section>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Scale size={15} color={COLORS.blue} />
              <h2 style={{ fontSize: 14, fontWeight: 750, color: COLORS.ink, margin: 0 }}>政策层面变化 — ACRA / IRAS / MOM / ICA / ISCA / CSIS</h2>
            </div>
            {report.report.policyItems.length
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{report.report.policyItems.map((it, i) => <ItemCard key={i} item={it} />)}</div>
              : <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '10px 0' }}>今天政策类来源没有发现新内容。</div>}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Globe2 size={15} color={COLORS.gold} />
              <h2 style={{ fontSize: 14, fontWeight: 750, color: COLORS.ink, margin: 0 }}>新闻层面变化 — Straits Times / Business Times / 联合早报</h2>
            </div>
            {report.report.newsItems.length
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{report.report.newsItems.map((it, i) => <ItemCard key={i} item={it} />)}</div>
              : <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '10px 0' }}>今天新闻类来源没有发现新内容。</div>}
          </div>
        </>
      )}
    </div>
  );
}
