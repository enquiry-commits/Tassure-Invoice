'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

const WELCOME = `**你好,我是 Tassure 系统助手** 👋
可以直接问我:
· 查公司 — "INFINITY LINKS" 或输入 UEN
· 查提名董事 — "CHEN DE 有哪些公司"
· 查 AR 批次 — "4月2026有几家AR"
· 查到期 — "30天内有什么到期"
· 查迟报 — "有几家迟报"
· 页面导航 — "打开开单草稿"
· 流程答疑 — "怎么开单"、"折扣怎么处理"`;

// Inline pieces: **bold** and [label](href) buttons.
function Inline({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          return (
            <button key={i} onClick={() => onNav(href)}
              style={{ display: 'inline-block', margin: 2, padding: '4px 11px', borderRadius: 999, border: '1px solid #99f6e4', background: '#f0fdfa', color: '#0f766e', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {label} →
            </button>
          );
        }
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i} style={{ color: '#12233b', fontWeight: 750 }}>{bold[1]}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

// Block renderer: each line becomes a styled block — headings (a line that is
// entirely bold), bullet rows (· / - prefixed), link-only rows (rendered as a
// button row), and paragraphs — with proper spacing between them.
function RichText({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const lines = text.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;

        // Row consisting only of links → button row with wrapping.
        const noLinks = line.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[·・\s]/g, '');
        const hasLink = /\[[^\]]+\]\([^)]+\)/.test(line);
        if (hasLink && (noLinks === '' || /^快捷入口[::]?$/.test(noLinks))) {
          return (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
              <Inline text={line} onNav={onNav} />
            </div>
          );
        }

        // Bullet row.
        const bullet = line.match(/^[·\-•]\s*(.*)$/);
        if (bullet) {
          return (
            <div key={i} style={{ display: 'flex', gap: 7, margin: '2.5px 0', paddingLeft: 2 }}>
              <span style={{ color: '#0f766e', flexShrink: 0, lineHeight: 1.55 }}>•</span>
              <span style={{ flex: 1 }}><Inline text={bullet[1]} onNav={onNav} /></span>
            </div>
          );
        }

        // Heading: the whole line is a single bold token.
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return (
            <div key={i} style={{ fontSize: 13, fontWeight: 750, color: '#12233b', margin: i === 0 ? '0 0 4px' : '6px 0 4px', paddingBottom: 4, borderBottom: '1px solid #eef2f6' }}>
              {line.trim().slice(2, -2)}
            </div>
          );
        }

        // Plain paragraph.
        return (
          <div key={i} style={{ margin: '2px 0' }}>
            <Inline text={line} onNav={onNav} />
          </div>
        );
      })}
    </div>
  );
}

export default function AssistantWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: WELCOME }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, open]);

  const nav = (href: string) => {
    if (href.startsWith('/')) { router.push(href); }
    else window.open(href, '_blank');
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next); setInput(''); setBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter(m => m.content !== WELCOME) }),
      });
      const json = await res.json();
      setMsgs(m => [...m, { role: 'assistant', content: json.reply ?? json.error ?? '出错了,请重试。' }]);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: '网络错误,请重试。' }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button onClick={() => setOpen(true)} title="系统助手"
          style={{
            position: 'fixed', right: 22, bottom: 22, zIndex: 200, width: 54, height: 54, borderRadius: '50%',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#1d3a5c,#0f766e)', color: '#fff',
            boxShadow: '0 6px 20px rgba(15,118,110,.35)',
          }}>
          <MessageCircle size={24} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', right: 22, bottom: 22, zIndex: 200, width: 380, maxWidth: 'calc(100vw - 44px)',
          height: 540, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
          boxShadow: '0 24px 60px rgba(15,35,59,.25)', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#0f766e)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: '#5eead4' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>Tassure 系统助手</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.7)' }}>查公司 · 查 ND · 查批次 · 页面导航 · 流程答疑</div>
            </div>
            <button onClick={() => setOpen(false)}
              style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc' }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%', padding: '10px 13px', borderRadius: 12, fontSize: 12.5, lineHeight: 1.55,
                whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal',
                background: m.role === 'user' ? '#1d3a5c' : '#fff',
                color: m.role === 'user' ? '#fff' : '#334155',
                border: m.role === 'user' ? 'none' : '1px solid #e8ecf1',
                borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
              }}>
                {m.role === 'assistant' ? <RichText text={m.content} onNav={href => { nav(href); }} /> : m.content}
              </div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: 12, background: '#fff', border: '1px solid #e8ecf1', fontSize: 12.5, color: '#94a3b8' }}>正在查询…</div>}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e8ecf1', background: '#fff' }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
              placeholder="输入公司名或问题…"
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
            <button onClick={send} disabled={busy || !input.trim()}
              style={{
                width: 40, borderRadius: 9, border: 'none', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                background: busy || !input.trim() ? '#cbd5e1' : '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
