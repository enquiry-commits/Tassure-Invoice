'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, MessageCircle, Send, Sparkles, X } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

type PageGuide = {
  label: string;
  summary: string;
  suggestions: string[];
};

const DEFAULT_GUIDE: PageGuide = {
  label: '系统总览',
  summary: '我会结合你目前所在的页面，协助查询资料、解释状态、指引操作。',
  suggestions: ['今天有哪些自动化需要处理？', '30天内有什么到期？', '系统各页面有什么用途？'],
};

const PAGE_GUIDES: Array<{ test: (pathname: string) => boolean; guide: PageGuide }> = [
  {
    test: pathname => pathname === '/',
    guide: {
      label: 'Dashboard',
      summary: '可解释自动化健康、待处理项目、QuickBooks 状态与总览数字。',
      suggestions: ['自动化健康怎么看？', '今天有哪些项目需要处理？', 'QuickBooks 多久更新一次？'],
    },
  },
  {
    test: pathname => pathname === '/companies',
    guide: {
      label: 'Companies',
      summary: '可查询公司、UEN / ROC、Internal CSS Status、Client 类型及现有服务。',
      suggestions: ['CSS Client 和 Shareholder 怎么判断？', 'Active ND Companies 是什么？', '输入公司名或 UEN / ROC 查询'],
    },
  },
  {
    test: pathname => pathname.startsWith('/master-list/active-clients'),
    guide: {
      label: 'Active Client',
      summary: '可说明客户资料、TeamWork 对照、服务标记、FYE 与公司详情。',
      suggestions: ['Active Client 的来源是什么？', '服务格子怎么判断？', 'FYE mismatch 是什么？'],
    },
  },
  {
    test: pathname => pathname === '/nominee-directors',
    guide: {
      label: 'Nominee Directors',
      summary: '可查询指定 ND 的在任公司、异常提醒及 TeamWork 同步规则。',
      suggestions: ['ND 数据什么时候更新？', '为什么 ND 数量会不同？', '输入 ND 名字查询在任公司'],
    },
  },
  {
    test: pathname => pathname === '/address-service',
    guide: {
      label: 'Address Service',
      summary: '可说明地址服务名单、来源与公司资料的对照方式。',
      suggestions: ['地址服务怎么判断？', '数据什么时候更新？', '如何查某家公司？'],
    },
  },
  {
    test: pathname => pathname === '/late-filing',
    guide: {
      label: 'Late Filing',
      summary: '可解释迟报判定、每日更新、异常状态与需要人工复核的原因。',
      suggestions: ['Late Filing 怎么判断？', '什么时候自动更新？', '目前有几家迟报？'],
    },
  },
  {
    test: pathname => pathname === '/billing',
    guide: {
      label: 'AR Reminder / Billing Drafts',
      summary: '可说明 AR 批次、历史发票、服务期间、开单、QB 草稿及 PDF 保存流程。',
      suggestions: ['怎么开单？', '服务期间怎么更新？', '开单后为什么不会自动发送？'],
    },
  },
  {
    test: pathname => pathname === '/client-communications/campaigns',
    guide: {
      label: 'Email Drafts',
      summary: '可说明模板、To/CC、发票附件、Ready 状态及 Outlook Helper 操作。',
      suggestions: ['为什么这行还不能 Ready？', 'Outlook Helper 怎么使用？', 'To 和 CC 的规则是什么？'],
    },
  },
  {
    test: pathname => pathname === '/client-communications/history',
    guide: {
      label: 'Email Activity',
      summary: '可说明已准备邮件的查看、重开 Outlook 草稿、状态记录与删除范围。',
      suggestions: ['Prepared 后去哪里查看？', '怎么重新打开 Outlook 草稿？', '删除记录会影响 Outlook 吗？'],
    },
  },
];

function getPageGuide(pathname: string): PageGuide {
  return PAGE_GUIDES.find(item => item.test(pathname))?.guide ?? DEFAULT_GUIDE;
}

function welcomeMessage(guide: PageGuide) {
  return `**你好，我是 Tassure 系统助手**
当前页面：**${guide.label}**
${guide.summary}

你也可以直接输入公司名、UEN / ROC、ND 名字，或询问 AR、开单、迟报及 Email Drafts 流程。`;
}

// Inline pieces: **bold** and [label](href) buttons.
function Inline({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          return (
            <button
              key={index}
              onClick={() => onNav(href)}
              style={{
                display: 'inline-block',
                margin: 2,
                padding: '4px 11px',
                borderRadius: 999,
                border: '1px solid #99f6e4',
                background: '#f0fdfa',
                color: '#0f766e',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label} →
            </button>
          );
        }
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={index} style={{ color: '#12233b', fontWeight: 750 }}>{bold[1]}</strong>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function RichText({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const lines = text.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={index} style={{ height: 8 }} />;

        const noLinks = line.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[·・\s]/g, '');
        const hasLink = /\[[^\]]+\]\([^)]+\)/.test(line);
        if (hasLink && (noLinks === '' || /^快捷入口[::]?$/.test(noLinks))) {
          return (
            <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
              <Inline text={line} onNav={onNav} />
            </div>
          );
        }

        const bullet = line.match(/^[·\-•]\s*(.*)$/);
        if (bullet) {
          return (
            <div key={index} style={{ display: 'flex', gap: 7, margin: '2.5px 0', paddingLeft: 2 }}>
              <span style={{ color: '#0f766e', flexShrink: 0, lineHeight: 1.55 }}>•</span>
              <span style={{ flex: 1 }}><Inline text={bullet[1]} onNav={onNav} /></span>
            </div>
          );
        }

        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return (
            <div
              key={index}
              style={{
                fontSize: 13,
                fontWeight: 750,
                color: '#12233b',
                margin: index === 0 ? '0 0 4px' : '6px 0 4px',
                paddingBottom: 4,
                borderBottom: '1px solid #eef2f6',
              }}
            >
              {line.trim().slice(2, -2)}
            </div>
          );
        }

        return (
          <div key={index} style={{ margin: '2px 0' }}>
            <Inline text={line} onNav={onNav} />
          </div>
        );
      })}
    </div>
  );
}

export default function AssistantWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const guide = useMemo(() => getPageGuide(pathname), [pathname]);
  const welcome = useMemo(() => welcomeMessage(guide), [guide]);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: welcome }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const nav = (href: string) => {
    setOpen(false);
    if (href.startsWith('/')) router.push(href);
    else window.open(href, '_blank', 'noopener,noreferrer');
  };

  const send = async (suggestedText?: string) => {
    const text = (suggestedText ?? input).trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(1),
          context: { pathname, page: guide.label },
        }),
      });
      const json = await response.json();
      setMsgs(current => [...current, {
        role: 'assistant',
        content: json.reply ?? json.error ?? '出错了，请重试。',
      }]);
    } catch {
      setMsgs(current => [...current, { role: 'assistant', content: '网络错误，请重试。' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          if (!open && msgs.length === 1) setMsgs([{ role: 'assistant', content: welcome }]);
          setOpen(value => !value);
        }}
        className="header-assistant"
        title="打开 Tassure 系统助手"
        aria-label="打开 Tassure 系统助手"
        aria-expanded={open}
      >
        <MessageCircle size={16} />
        <span>AI 助手</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Tassure 系统助手"
          style={{
            position: 'fixed',
            right: 18,
            top: 78,
            zIndex: 220,
            width: 410,
            maxWidth: 'calc(100vw - 36px)',
            height: 610,
            maxHeight: 'calc(100vh - 94px)',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #dbe4ee',
            boxShadow: '0 24px 60px rgba(15,35,59,.24)',
            overflow: 'hidden',
          }}
        >
          <div style={{ background: '#183b61', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(255,255,255,.12)',
              color: '#7de3d5',
            }}>
              <Bot size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>Tassure 系统助手</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                正在协助：{guide.label}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭系统助手"
              style={{
                background: 'rgba(255,255,255,.12)',
                border: 'none',
                color: '#fff',
                borderRadius: 8,
                width: 30,
                height: 30,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              background: '#f8fafc',
            }}
          >
            {msgs.map((message, index) => (
              <div
                key={index}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '91%',
                  padding: '10px 13px',
                  borderRadius: 12,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal',
                  background: message.role === 'user' ? '#1d3a5c' : '#fff',
                  color: message.role === 'user' ? '#fff' : '#334155',
                  border: message.role === 'user' ? 'none' : '1px solid #e3e9f0',
                  borderBottomRightRadius: message.role === 'user' ? 4 : 12,
                  borderBottomLeftRadius: message.role === 'user' ? 12 : 4,
                }}
              >
                {message.role === 'assistant'
                  ? <RichText text={message.content} onNav={nav} />
                  : message.content}
              </div>
            ))}
            {busy && (
              <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: 12, background: '#fff', border: '1px solid #e3e9f0', fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={13} /> 正在结合系统资料查询…
              </div>
            )}
          </div>

          <div style={{ padding: '10px 12px 7px', borderTop: '1px solid #e8edf3', background: '#fff' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#718096', marginBottom: 6, letterSpacing: '.2px' }}>
              当前页面快捷提问
            </div>
            <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 3 }}>
              {guide.suggestions.map(suggestion => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  disabled={busy}
                  style={{
                    flexShrink: 0,
                    border: '1px solid #d7e1eb',
                    borderRadius: 999,
                    background: '#fff',
                    color: '#31506f',
                    padding: '5px 9px',
                    fontSize: 10.5,
                    fontWeight: 650,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '8px 12px 12px', background: '#fff' }}>
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void send();
              }}
              placeholder="输入公司名、UEN / ROC 或操作问题…"
              aria-label="向系统助手提问"
              style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              aria-label="发送问题"
              style={{
                width: 40,
                borderRadius: 9,
                border: 'none',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                background: busy || !input.trim() ? '#cbd5e1' : '#0f766e',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
