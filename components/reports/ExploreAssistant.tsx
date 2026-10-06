'use client';

import { useState } from 'react';
import { Sparkles, Send } from 'lucide-react';
import { MAX_REQUEST_CHARS, type ExplorePlan, type IntentResult } from '@/lib/reports-explore-intent';

// Plain-language helper for the Reports Explore panel (2026-10-06): the user
// types what they want, the AI proposes settings, and NOTHING changes on the
// page until they press Confirm. One box + one card, deliberately not a chat
// thread — a clarifying question is answered by tapping a choice or retyping.
// The AI never produces numbers; the counts shown come from `preview`, which
// the parent computes over the real roster.
type Props = {
  options: Record<string, string[]>;
  dimensionLabels: Record<string, string>;
  metricLabels: Record<string, string>;
  preview: (plan: ExplorePlan) => { count: number; notRecorded: number };
  onApply: (plan: ExplorePlan) => void;
};

const EXAMPLES = ['今年新客户，谁介绍的，RM是谁', 'Clients per RM', '2026年3月以后的新客户，按行业'];
const BOX: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc', padding: 14 };
const CHIP: React.CSSProperties = { display: 'inline-block', fontSize: 11.5, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 9px', color: '#334155' };

export default function ExploreAssistant({ options, dimensionLabels, metricLabels, preview, onApply }: Props) {
  const [text, setText] = useState('');
  const [baseText, setBaseText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntentResult | null>(null);
  const [applied, setApplied] = useState(false);

  async function ask(request: string) {
    const trimmed = request.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setApplied(false);
    try {
      const res = await fetch('/api/reports/explore-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, today: new Date().toISOString().slice(0, 10), options }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The helper could not answer just now.');
      setBaseText(trimmed);
      setResult(body.result as IntentResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The helper could not answer just now.');
    } finally {
      setLoading(false);
    }
  }

  function renderPlan(r: Extract<IntentResult, { type: 'plan' }>) {
    const { plan } = r;
    const p = preview(plan);
    const filterChips = Object.entries(plan.filters).map(([dim, vals]) => `${dimensionLabels[dim] ?? dim}: ${(vals ?? []).join(', ')}`);
    const since = plan.sinceFrom || plan.sinceTo ? `${plan.sinceFrom || 'any'} → ${plan.sinceTo || 'now'}` : null;
    return (
      <div style={{ ...BOX, background: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>I UNDERSTOOD</div>
        {r.restate && <div style={{ fontSize: 13.5, color: '#0f172a', marginBottom: 10, lineHeight: 1.5 }}>{r.restate}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <span style={CHIP}>Group by: <b>{dimensionLabels[plan.dimension] ?? plan.dimension}</b></span>
          <span style={CHIP}>Count: <b>{metricLabels[plan.metric] ?? plan.metric}</b></span>
          {since && <span style={CHIP}>Client Since: <b>{since}</b></span>}
          {filterChips.map(c => <span key={c} style={CHIP}>{c}</span>)}
          <span style={CHIP}>Show: <b>{plan.view === 'list' ? 'Company list' : 'Summary'}</b></span>
        </div>
        {r.assumed.length > 0 && (
          <div style={{ fontSize: 12, background: '#fffbeb', border: '1px solid #fde68a', color: '#92600a', borderRadius: 7, padding: '6px 10px', marginBottom: 8 }}>
            I assumed: {r.assumed.join(' · ')}
          </div>
        )}
        {r.ignored.length > 0 && <div style={{ fontSize: 11.5, color: '#b45f6b', marginBottom: 8 }}>Ignored: {r.ignored.join(', ')}</div>}
        <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 10 }}>
          This will show <b>{p.count}</b> {p.count === 1 ? 'company' : 'companies'}.
          {p.notRecorded > 0 && <> {p.notRecorded} with no Client Since recorded {p.notRecorded === 1 ? 'is' : 'are'} left out.</>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { onApply(plan); setApplied(true); setResult(null); }}
            style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: '#1d3a5c', border: 'none', borderRadius: 7, padding: '7px 16px', cursor: 'pointer' }}>Confirm</button>
          <button onClick={() => setResult(null)}
            style={{ fontSize: 12.5, color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '7px 14px', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={BOX}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: '#1d3a5c', marginBottom: 4 }}>
        <Sparkles size={14} />Ask in your own words
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
        Say what you want to see (中文 or English). I’ll show what I understood — nothing changes until you press Confirm.
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <textarea value={text} rows={2} maxLength={MAX_REQUEST_CHARS} placeholder="e.g. 今年1月以后的新客户，谁介绍的？"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }}
          style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '7px 9px', borderRadius: 7, border: '1px solid #e2e8f0', resize: 'none', fontFamily: 'inherit' }} />
        <button onClick={() => ask(text)} disabled={loading || !text.trim()} aria-label="Ask"
          style={{ alignSelf: 'stretch', width: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1d3a5c', color: '#fff', border: 'none', borderRadius: 7, cursor: loading || !text.trim() ? 'not-allowed' : 'pointer', opacity: loading || !text.trim() ? 0.5 : 1 }}>
          <Send size={14} />
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => { setText(ex); ask(ex); }} disabled={loading}
            style={{ ...CHIP, cursor: 'pointer', color: '#2563eb' }}>{ex}</button>
        ))}
      </div>

      {loading && <div style={{ fontSize: 12.5, color: '#64748b' }}>Thinking…</div>}
      {error && <div style={{ fontSize: 12.5, color: '#b45f6b' }}>{error} You can still use the Quick views on the left.</div>}
      {applied && !loading && !result && <div style={{ fontSize: 12.5, color: '#047857' }}>Applied — see the results below. You can adjust anything on the left.</div>}

      {result?.type === 'plan' && renderPlan(result)}
      {result?.type === 'clarify' && (
        <div style={{ ...BOX, background: '#fff' }}>
          <div style={{ fontSize: 13, color: '#0f172a', marginBottom: result.choices.length ? 10 : 0, lineHeight: 1.5 }}>{result.question}</div>
          {result.choices.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.choices.map(c => (
                <button key={c} onClick={() => ask(`${baseText} — ${c}`)} style={{ ...CHIP, cursor: 'pointer', color: '#2563eb' }}>{c}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
