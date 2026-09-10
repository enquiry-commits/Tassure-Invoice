'use client';

// The floating AI Assistant popup, available on every page except My Tasks
// (which IS the full chat experience already). Rebuilt 2026-09-09 per
// Vincent's explicit spec:
//
// "我希望它的功能和My Tasks这边的功能一样，但是它是一个小弹窗的形式，我
// 希望这个弹窗是可以拖拽的，并且每次在弹窗内的对话都要记录成My Tasks 内
// 的Recent (chat)" — plus 7 numbered rules on exactly what counts as a new
// conversation, what survives navigation, what resets on reload, and where
// the button does/doesn't appear. Reproduced here since they drove every
// design decision below:
//
// 1. Opening the popup on ANY page conceptually starts a new conversation;
//    navigating to another page WITHOUT clicking the × keeps that same
//    conversation and its content intact.
// 2. Only manually clicking × ends the conversation — which, by then, is
//    already a real row in My Tasks' Recent (chat) (same lazy-creation-
//    on-first-message pattern app/my-tasks/page.tsx already uses, so an
//    opened-then-closed-with-nothing-sent popup never litters the list).
//    Reopening after a close is a genuinely new conversation.
// 3. The popup can be collapsed to keep chatting without blocking the
//    screen; a full reload always starts fresh (nothing here is persisted
//    to storage — nothing here is stateful longer than this component's
//    own memory, which the root layout keeps alive across client-side
//    navigation but not across a real reload).
// 4. To nudge people toward My Tasks itself, the FIRST click on the button
//    each session redirects to /my-tasks instead of opening the popup.
// 5. On every OTHER page, the button opens/collapses/closes normally.
// 6. The open panel is resizable.
// 7. Collapsed = a small icon, not a shrunk panel.
//
// Shares its cards/attachment UI with My Tasks' own chat
// (components/assistant/ChatCards.tsx) so a real QuickBooks/Late Filing/
// Post Incorporate action is never implemented twice; the send/attachment
// GLUE below is its own (not extracted into a shared hook) since the two
// surfaces' lifecycles genuinely differ — My Tasks switches between saved
// threads from a sidebar, this auto-manages one conversation tied to
// open/collapse/close.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, MessageCircle, Send, Sparkles, X, Minus, Paperclip } from 'lucide-react';
import { RichText } from '@/components/assistant/ChatRichText';
import {
  InvoiceDraftCard, LateFilingResolveCard, ArUpdateCard, InvoiceEditCard, PostIncorporateCard, ListExportCard, SoaCard,
  AttachmentChips, AttachmentThumbnails, AttachmentLightbox,
  toApiMessage, type ChatMsg, type ChatAttachment,
} from '@/components/assistant/ChatCards';

export type PageGuide = {
  label: string;
  summary: string;
  suggestions: string[];
};

// Suggested prompts are the ONLY discoverability surface this assistant has
// — nothing else tells a person what it can be asked. Rewritten 2026-09-10
// (Vincent: "怎么样让AI chat 更简单易懂人类的提问"): the originals were all
// documentation questions ("怎么开单？", "数据什么时候更新？") dating from
// when the assistant could only explain the system, so nobody could tell
// from the UI that it now answers REAL data questions across 29 tools.
//
// Two hard rules for anything added here:
// 1. A click SENDS THE TEXT VERBATIM (see the onClick below) — so every
//    suggestion must work standing alone. Never a placeholder like
//    "XX 公司的欠款": clicking it literally asks about a company called XX.
// 2. It must be a question a tool can really answer. A suggestion that
//    returns "我不知道" teaches the user the assistant is useless, which is
//    worse than showing no suggestion at all.
// Each page leads with data questions and keeps at most one how-it-works
// question, which is the reverse of the original ordering.
const DEFAULT_GUIDE: PageGuide = {
  label: '系统总览',
  summary: '可以直接问我公司资料、欠款、到期、迟报、任务，也能帮你预览开单和改动（都要你点确认才执行）。',
  suggestions: ['今天最要紧的是什么？', '现在一共欠我们多少钱？', '你能帮我做什么？'],
};

const PAGE_GUIDES: Array<{ test: (pathname: string) => boolean; guide: PageGuide }> = [
  {
    test: pathname => pathname === '/',
    guide: {
      label: 'Dashboard',
      summary: '可解释自动化健康、待处理项目、QuickBooks 状态与总览数字。',
      suggestions: ['今天最要紧的是什么？', '最近有哪些自动化失败了？', '今年开单和收入趋势怎么样？'],
    },
  },
  {
    test: pathname => pathname === '/companies',
    guide: {
      label: 'Companies',
      summary: '可查询公司、UEN / ROC、Internal CSS Status、Client 类型及现有服务。',
      suggestions: ['哪些客户是12月FYE？', '有哪些公司用我们的注册地址？', '现在客户类型的分布是怎样的？'],
    },
  },
  {
    test: pathname => pathname.startsWith('/master-list/active-clients'),
    guide: {
      label: 'Active Client',
      summary: '可说明客户资料、TeamWork 对照、服务标记、FYE 与公司详情。',
      suggestions: ['现在一共有多少家在营客户？', '哪些客户有 XBRL 服务？', 'Active Client 的来源是什么？'],
    },
  },
  {
    test: pathname => pathname === '/nominee-directors',
    guide: {
      label: 'Nominee Directors',
      summary: '可查询指定 ND 的在任公司、异常提醒及 TeamWork 同步规则。',
      suggestions: ['哪位 ND 在任公司最多？', '有哪些公司用 ND 服务？', 'ND 数据什么时候更新？'],
    },
  },
  {
    test: pathname => pathname === '/address-service',
    guide: {
      label: 'Address Service',
      summary: '可说明地址服务名单、来源与公司资料的对照方式。',
      suggestions: ['有哪些公司用我们的注册地址？', '一共有多少家用注册地址？', '地址服务怎么判断？'],
    },
  },
  {
    test: pathname => pathname === '/late-filing',
    guide: {
      label: 'Late Filing',
      summary: '可解释迟报判定、每日更新、异常状态与需要人工复核的原因。',
      suggestions: ['现在有几家迟报？最严重的是哪几家？', '谁手上压的迟报最多？', 'Late Filing 怎么判断？'],
    },
  },
  {
    test: pathname => pathname === '/billing',
    guide: {
      label: 'AR Reminder / Billing Drafts',
      summary: '可说明 AR 批次、历史发票、服务期间、开单、QB 草稿及 PDF 保存流程。',
      suggestions: ['谁欠钱最多？', '未来30天有哪些 AR 到期？', '怎么开单？'],
    },
  },
  {
    test: pathname => pathname === '/client-communications/campaigns',
    guide: {
      label: 'Email Drafts',
      summary: '可说明模板、To/CC、发票附件、Ready 状态及 Outlook Helper 操作。',
      suggestions: ['最近30天发了多少封邮件？', '为什么这行还不能 Ready？', 'To 和 CC 的规则是什么？'],
    },
  },
  {
    test: pathname => pathname === '/client-communications/history',
    guide: {
      label: 'Email Activity',
      summary: '可说明已准备邮件的查看、重开 Outlook 草稿、状态记录与删除范围。',
      suggestions: ['最近30天发了多少封邮件？', '怎么重新打开 Outlook 草稿？', '删除记录会影响 Outlook 吗？'],
    },
  },
];

export function getPageGuide(pathname: string): PageGuide {
  return PAGE_GUIDES.find(item => item.test(pathname))?.guide ?? DEFAULT_GUIDE;
}

type UiState = 'button' | 'open' | 'collapsed';

const PANEL_DEFAULT_WIDTH = 400;
const PANEL_DEFAULT_HEIGHT = 580;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 380;
const PANEL_MAX_WIDTH = 800;
const PANEL_MAX_HEIGHT = 900;

// Same caps as app/my-tasks/page.tsx's own (kept in sync — the server-side
// guard in app/api/assistant/route.ts is the one place that actually needs
// updating if these ever change): 2 files, 1.5MB raw each, worst case
// ~4.0MB base64-encoded, safely under Vercel's ~4.5MB request-body limit.
const MAX_ATTACHMENTS = 2;
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

export default function AssistantWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const guide = useMemo(() => getPageGuide(pathname), [pathname]);
  const hiddenHere = pathname === '/my-tasks';

  // Rule 4: the first click each session goes to My Tasks instead of
  // opening the popup. "Each session" — resets on a real reload since this
  // is plain component state, never persisted. Landing directly on
  // /my-tasks (not via this button) also counts as having been nudged
  // there, so later clicks from other pages open the popup normally
  // instead of redirecting a second time.
  const [hasVisitedMyTasks, setHasVisitedMyTasks] = useState(() => pathname === '/my-tasks');
  useEffect(() => { if (pathname === '/my-tasks') setHasVisitedMyTasks(true); }, [pathname]);

  const [uiState, setUiState] = useState<UiState>('button');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<ChatAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rule 1/6: draggable position, resizable size. null position = not yet
  // placed — computed near the header button on first open, then sticky
  // (kept across collapse/expand/navigate) for the rest of the session.
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [panelSize, setPanelSize] = useState({ width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT });
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatBusy, uiState]);

  // Escape collapses rather than closes — closing ends and saves the
  // conversation (rule 2), which a stray key press shouldn't trigger.
  useEffect(() => {
    if (uiState !== 'open') return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setUiState('collapsed'); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [uiState]);

  const openPanelNearButton = () => {
    if (!panelPos && typeof window !== 'undefined') {
      setPanelPos({ left: Math.max(8, window.innerWidth - panelSize.width - 18), top: 78 });
    }
    setUiState('open');
  };

  const handleHeaderButtonClick = () => {
    if (uiState === 'collapsed') { setUiState('open'); return; }
    if (uiState === 'open') { setUiState('collapsed'); return; }
    // uiState === 'button' (idle, no conversation in progress)
    if (!hasVisitedMyTasks) { router.push('/my-tasks'); return; }
    openPanelNearButton();
  };

  const handleClose = () => {
    setUiState('button');
    setConversationId(null);
    setChatMessages([]);
    setChatInput('');
    setPendingAttachments([]);
    setAttachError(null);
  };

  // ── Drag-to-move (rule 1) ────────────────────────────────────────────────
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (!panelPos) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: panelPos.left, startTop: panelPos.top };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPanelPos({
        left: Math.max(4, Math.min(window.innerWidth - 80, dragRef.current.startLeft + dx)),
        top: Math.max(4, Math.min(window.innerHeight - 60, dragRef.current.startTop + dy)),
      });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Resize (rule 6) ──────────────────────────────────────────────────────
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: panelSize.width, startH: panelSize.height };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      setPanelSize({
        width: Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, resizeRef.current.startW + dx)),
        height: Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, resizeRef.current.startH + dy)),
      });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Attachments (same rules as app/my-tasks/page.tsx) ───────────────────
  const addFiles = (files: FileList | File[]) => {
    setAttachError(null);
    const list = Array.from(files);
    if (!list.length) return;
    if (pendingAttachments.length + list.length > MAX_ATTACHMENTS) {
      setAttachError(`最多同时附带 ${MAX_ATTACHMENTS} 个文件。`);
      return;
    }
    for (const file of list) {
      const kind: ChatAttachment['kind'] | null = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'document' : null;
      if (!kind) { setAttachError(`"${file.name}" 类型暂不支持 — 目前只支持图片和 PDF。`); continue; }
      if (file.size > MAX_FILE_BYTES) { setAttachError(`"${file.name}" 超过 ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(1)}MB，暂不支持。`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.split(',')[1] ?? '';
        if (!base64) { setAttachError(`无法读取 "${file.name}"。`); return; }
        setPendingAttachments(prev => prev.length >= MAX_ATTACHMENTS ? prev : [...prev, {
          id: globalThis.crypto.randomUUID(), name: file.name, mediaType: file.type, base64, kind,
        }]);
      };
      reader.onerror = () => setAttachError(`无法读取 "${file.name}"。`);
      reader.readAsDataURL(file);
    }
  };
  const removeAttachment = (id: string) => setPendingAttachments(prev => prev.filter(a => a.id !== id));
  const handleViewAttachment = (a: ChatAttachment) => {
    if (a.kind === 'image') setViewingAttachment(a);
    else window.open(`data:${a.mediaType};base64,${a.base64}`, '_blank');
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const fileItems = Array.from(e.clipboardData.items).filter(it => it.kind === 'file');
    if (!fileItems.length) return;
    e.preventDefault();
    const files = fileItems.map(it => it.getAsFile()).filter((f): f is File => !!f);
    if (files.length) addFiles(files);
  };

  const nav = (href: string) => {
    setUiState('collapsed');
    if (href.startsWith('/')) router.push(href);
    else window.open(href, '_blank', 'noopener,noreferrer');
  };

  const sendChatMessage = async (suggestedText?: string) => {
    const text = (suggestedText ?? chatInput).trim();
    const attachments = pendingAttachments;
    if ((!text && !attachments.length) || chatBusy) return;

    // Lazy creation, same as My Tasks — nothing hits ai_conversations until
    // there's a real first message (rule 2: an opened-then-closed-empty
    // popup never becomes a Recent (chat) entry).
    let id = conversationId;
    if (!id) {
      try {
        const res = await fetch('/api/ai/conversations', { method: 'POST' });
        const json = await res.json();
        id = json.conversation?.id ?? null;
        if (id) setConversationId(id);
      } catch {
        // Fall through and still answer even if a thread couldn't be
        // created — an unsaved reply beats no reply.
      }
    }

    const next: ChatMsg[] = [...chatMessages, { role: 'user' as const, content: text, attachments: attachments.length ? attachments : undefined }];
    setChatMessages(next);
    setChatInput('');
    setPendingAttachments([]);
    setAttachError(null);
    setChatBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(toApiMessage), context: { pathname, page: guide.label }, conversationId: id }),
      });
      const json = await res.json();
      setChatMessages(current => [...current, {
        role: 'assistant',
        content: json.reply ?? json.error ?? '出错了，请重试。',
        invoicePreview: json.invoicePreview ?? undefined,
        lateFilingPreview: json.lateFilingPreview ?? undefined,
        arUpdatePreview: json.arUpdatePreview ?? undefined,
        exportOffer: json.exportOffer ?? undefined,
        soaPreview: json.soaPreview ?? undefined,
        invoiceEditPreview: json.invoiceEditPreview ?? undefined,
        postIncorporatePreview: json.postIncorporatePreview ?? undefined,
      }]);
    } catch {
      setChatMessages(current => [...current, { role: 'assistant', content: '网络错误，请重试。' }]);
    } finally {
      setChatBusy(false);
    }
  };

  if (hiddenHere) return null;

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
      />
      <button
        type="button"
        onClick={handleHeaderButtonClick}
        className="header-assistant"
        title={uiState === 'collapsed' ? '继续对话' : '打开 Tassure 系统助手'}
        aria-label={uiState === 'collapsed' ? '继续对话' : '打开 Tassure 系统助手'}
        aria-expanded={uiState === 'open'}
        style={uiState === 'collapsed' ? { position: 'relative' } : undefined}
      >
        <MessageCircle size={16} />
        {uiState !== 'collapsed' && <span>AI 助手</span>}
        {uiState === 'collapsed' && (
          <span style={{ position: 'absolute', top: 2, right: 2, width: 7, height: 7, borderRadius: '50%', background: '#0f766e', border: '1.5px solid #fff' }} />
        )}
      </button>

      {uiState === 'open' && panelPos && (
        <div
          role="dialog"
          aria-label="Tassure 系统助手"
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
          onDrop={handleDrop}
          style={{
            position: 'fixed',
            left: panelPos.left,
            top: panelPos.top,
            zIndex: 220,
            width: panelSize.width,
            maxWidth: 'calc(100vw - 20px)',
            height: panelSize.height,
            maxHeight: 'calc(100vh - 20px)',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #dbe4ee',
            boxShadow: '0 24px 60px rgba(15,35,59,.24)',
            overflow: 'hidden',
          }}
        >
          {dragActive && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,118,110,0.08)', border: '2px dashed #0f766e', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ background: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#0f766e', boxShadow: '0 4px 16px rgba(15,23,42,0.15)' }}>
                松开以添加图片或 PDF
              </div>
            </div>
          )}

          {/* Draggable header — mousedown here moves the whole panel */}
          <div
            onMouseDown={onHeaderMouseDown}
            style={{ background: '#183b61', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 9, cursor: 'grab', userSelect: 'none' }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.12)', color: '#7de3d5', flexShrink: 0 }}>
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
              onClick={e => { e.stopPropagation(); setUiState('collapsed'); }}
              onMouseDown={e => e.stopPropagation()}
              aria-label="收起"
              title="收起（对话保留）"
              style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); handleClose(); }}
              onMouseDown={e => e.stopPropagation()}
              aria-label="关闭对话"
              title="关闭（结束这次对话）"
              style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <X size={15} />
            </button>
          </div>

          {chatMessages.length === 0 ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: '#f8fafc' }}>
              <div style={{ fontSize: 12.5, color: '#334155' }}>
                <strong style={{ color: '#12233b' }}>你好，我是 Tassure 系统助手</strong>
                <div style={{ marginTop: 4 }}>{guide.summary}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {guide.suggestions.map(suggestion => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => void sendChatMessage(suggestion)}
                    style={{ textAlign: 'left', border: '1px solid #d7e1eb', borderRadius: 8, background: '#fff', color: '#31506f', padding: '8px 11px', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc' }}>
              {chatMessages.map((message, index) => (
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
                    ? <>
                        <RichText text={message.content} onNav={nav} />
                        {message.invoicePreview && (
                          <InvoiceDraftCard preview={message.invoicePreview} onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                        )}
                        {message.lateFilingPreview && (
                          <LateFilingResolveCard preview={message.lateFilingPreview} onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                        )}
                        {message.soaPreview && (
                          <SoaCard preview={message.soaPreview} />
                        )}
                        {message.exportOffer && (
                          <ListExportCard offer={message.exportOffer} />
                        )}
                        {message.arUpdatePreview && (
                          <ArUpdateCard preview={message.arUpdatePreview} onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                        )}
                        {message.invoiceEditPreview && (
                          <InvoiceEditCard preview={message.invoiceEditPreview} onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                        )}
                        {message.postIncorporatePreview && (
                          <PostIncorporateCard preview={message.postIncorporatePreview} onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                        )}
                      </>
                    : <>
                        {message.content}
                        {message.attachments?.length ? <AttachmentThumbnails attachments={message.attachments} onView={handleViewAttachment} /> : null}
                      </>}
                </div>
              ))}
              {chatBusy && (
                <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: 12, background: '#fff', border: '1px solid #e3e9f0', fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Sparkles size={13} /> 正在结合系统资料查询…
                </div>
              )}
            </div>
          )}

          <div style={{ padding: '10px 12px', borderTop: '1px solid #e8edf3', background: '#fff' }}>
            <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} onView={handleViewAttachment} />
            {attachError && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 6 }}>{attachError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="附加图片或 PDF"
                style={{ width: 36, flexShrink: 0, borderRadius: 9, border: '1px solid #dbe3ec', background: '#fff', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <Paperclip size={15} />
              </button>
              <input
                value={chatInput}
                onChange={event => setChatInput(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void sendChatMessage(); }}
                onPaste={handlePaste}
                placeholder="输入公司名、UEN / ROC 或操作问题…"
                aria-label="向系统助手提问"
                style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => void sendChatMessage()}
                disabled={chatBusy || (!chatInput.trim() && !pendingAttachments.length)}
                aria-label="发送问题"
                style={{
                  width: 40, flexShrink: 0, borderRadius: 9, border: 'none',
                  cursor: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? 'not-allowed' : 'pointer',
                  background: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? '#cbd5e1' : '#0f766e',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>

          {/* Resize handle (rule 6) */}
          <div
            onMouseDown={onResizeMouseDown}
            title="拖拽调整大小"
            style={{
              position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize',
              background: 'linear-gradient(135deg, transparent 50%, #cbd5e1 50%, #cbd5e1 60%, transparent 60%, transparent 70%, #cbd5e1 70%, #cbd5e1 80%, transparent 80%)',
            }}
          />
        </div>
      )}

      {viewingAttachment && <AttachmentLightbox attachment={viewingAttachment} onClose={() => setViewingAttachment(null)} />}
    </div>
  );
}
