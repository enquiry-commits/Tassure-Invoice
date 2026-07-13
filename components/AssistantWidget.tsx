'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

const WELCOME = `你好,我是 Tassure 系统助手 👋
可以直接问我:
· "INFINITY LINKS 的资料" —— 查公司
· "CHEN DE 有哪些公司" —— 查提名董事
· "4月2026有几家AR" —— 查年报批次
· "打开开单草稿" —— 带你去页面
· "怎么开单" —— 流程问题`;

// Render **bold**, newlines, and [label](href) links (internal links navigate in-app).
function RichText({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          return (
            <button key={i} onClick={() => onNav(href)}
              style={{ display: 'inline-block', margin: '2px 2px', padding: '3px 10px', borderRadius: 999, border: '1px solid #99f6e4', background: '#f0fdfa', color: '#0f766e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {label} →
            </button>
          );
        }
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i} style={{ color: '#12233b' }}>{bold[1]}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
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
                maxWidth: '88%', padding: '9px 12px', borderRadius: 12, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
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
