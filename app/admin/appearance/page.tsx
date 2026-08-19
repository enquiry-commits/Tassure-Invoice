'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Palette, Save, RotateCcw, Check } from 'lucide-react';
import { THEME_TOKENS, FONT_OPTIONS } from '@/lib/theme-tokens';
import { applyThemeTokens } from '@/lib/apply-theme';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const GROUP_ORDER = ['品牌与结构', '文字', '背景与边框', '列表与表格', '状态颜色', '字体'];

export default function AppearanceSettingsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [savedTokens, setSavedTokens] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(result => {
      if (!result?.user?.admin) { router.replace('/'); return; }
      setAuthorized(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch('/api/appearance-settings').then(r => r.ok ? r.json() : null).then(result => {
      if (result?.tokens) { setTokens(result.tokens); setSavedTokens(result.tokens); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [authorized]);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, typeof THEME_TOKENS>();
    for (const def of THEME_TOKENS) {
      if (!byGroup.has(def.group)) byGroup.set(def.group, []);
      byGroup.get(def.group)!.push(def);
    }
    return GROUP_ORDER.map(g => [g, byGroup.get(g) ?? []] as const).filter(([, defs]) => defs.length);
  }, []);

  const dirtyCount = Object.keys(tokens).filter(k => tokens[k] !== savedTokens[k]).length;

  function handleChange(key: string, value: string) {
    setTokens(prev => ({ ...prev, [key]: value }));
    applyThemeTokens({ [key]: value });
    setMessage(null);
  }

  function handleReset() {
    setTokens(savedTokens);
    applyThemeTokens(savedTokens);
    setMessage(null);
  }

  async function handleSave() {
    const dirty: Record<string, string> = {};
    for (const [k, v] of Object.entries(tokens)) if (v !== savedTokens[k]) dirty[k] = v;
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/appearance-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: dirty }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ text: json.error || 'Save failed', ok: false }); return; }
      setSavedTokens(tokens);
      setMessage({ text: 'Saved — everyone sees this on their next page load.', ok: true });
    } catch {
      setMessage({ text: 'Save failed — check your connection.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (authorized === null || loading) {
    return <div style={{ padding: 40, color: '#94a3b8', fontSize: 13 }}>加载中…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: '#1d3a5c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Palette size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e3a5f' }}>Appearance Settings</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>颜色和字体保存后，会对所有登录用户全局生效。</div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 14 }}>
        每项下面都标了实际生效范围：<span style={{ color: '#16a34a', fontWeight: 600 }}>✓ 绿色</span> = 已接入真实页面，改了马上能看到效果；<span style={{ color: '#c2410c', fontWeight: 600 }}>○ 橙色</span> = 暂未接入任何页面，改了不会有变化（预留给后续迁移）。
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {grouped.map(([group, defs]) => (
          <div key={group} className="system-list-shell">
            <div className="system-list-title-bar" style={{ padding: '8px 16px' }}>
              <span className="system-list-title">{group}</span>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {defs.map(def => {
                const value = tokens[def.key] ?? def.default;
                if (def.type === 'font') {
                  return (
                    <label key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{def.label}</span>
                      <span style={{ fontSize: 10.5, color: def.live ? '#16a34a' : '#c2410c', lineHeight: 1.4 }}>
                        {def.live ? '✓ ' : '○ '}{def.scope}
                      </span>
                      <select
                        value={value}
                        onChange={e => handleChange(def.key, e.target.value)}
                        style={{ height: 34, borderRadius: 7, border: '1px solid #cbd5e1', padding: '0 8px', fontSize: 12.5, color: '#1e293b', background: '#fff' }}
                      >
                        {FONT_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </label>
                  );
                }
                const swatchValue = HEX_RE.test(value) ? value : def.default;
                return (
                  <label key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{def.label}</span>
                    <span style={{ fontSize: 10.5, color: def.live ? '#16a34a' : '#c2410c', lineHeight: 1.4 }}>
                      {def.live ? '✓ ' : '○ '}{def.scope}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={swatchValue}
                        onChange={e => handleChange(def.key, e.target.value)}
                        style={{ width: 34, height: 34, padding: 0, border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={e => handleChange(def.key, e.target.value)}
                        spellCheck={false}
                        style={{ flex: 1, minWidth: 0, height: 34, borderRadius: 7, border: '1px solid #cbd5e1', padding: '0 8px', fontSize: 12.5, fontFamily: 'ui-monospace, monospace', color: '#1e293b' }}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ position: 'sticky', bottom: 0, marginTop: 18, padding: '12px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 -4px 14px rgba(30,58,95,.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving || !dirtyCount}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#fff', background: dirtyCount ? '#1d3a5c' : '#94a3b8', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: dirtyCount ? 'pointer' : 'default' }}
        >
          <Save size={14} />{saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'No changes'}
        </button>
        <button
          onClick={handleReset}
          disabled={!dirtyCount}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: '#475569', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '9px 14px', cursor: dirtyCount ? 'pointer' : 'default', opacity: dirtyCount ? 1 : .5 }}
        >
          <RotateCcw size={13} />Discard changes
        </button>
        {message && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: message.ok ? '#16a34a' : '#dc2626' }}>
            {message.ok && <Check size={14} />}{message.text}
          </span>
        )}
      </div>
    </div>
  );
}
