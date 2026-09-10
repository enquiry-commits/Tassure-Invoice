'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, CalendarClock, Clock, ListChecks, RefreshCw, Sparkles,
  Plus, Pin, Trash2, Send, MessageSquare, Activity, Paperclip,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { RichText } from '@/components/assistant/ChatRichText';
import {
  InvoiceDraftCard, LateFilingResolveCard, ArUpdateCard, InvoiceEditCard, PostIncorporateCard, ListExportCard, SoaCard, EmailDraftCard, CompanyUpdateCard, TaoBillingCard,
  AttachmentChips, AttachmentThumbnails, AttachmentLightbox,
  toApiMessage, storedMessageToChatMsg,
  type ChatAttachment, type ChatMsg,
} from '@/components/assistant/ChatCards';
import { fmtDate } from '@/lib/date';

type SessionUser = { email: string; name: string; restrictedTo?: string | null; admin?: boolean };

type ArTask = {
  id: number; entityName: string; uen: string | null; fyeMonth: string; fyeYear: number;
  dueDate: string | null; daysUntilDue: number; pic: string | null; accPic: string | null; taxPic: string | null;
  matchedAs: string[]; remarks: string | null;
};
type LateFilingTask = {
  id: number; companyName: string; uen: string | null; nextAgmDueDate: string | null;
  remarks: string | null; pic: string | null; accPic: string | null; taxPic: string | null; matchedAs: string[];
};
// Vincent, 2026-09-08, on the View-As-Chelsea screen showing 0 tasks
// despite her using the system daily: "没有真正了解到...我们的员工在做什
// 么" — a real audit-trail timeline (lib/recent-activity.ts), separate
// from the AR/Late-Filing-only lens above. See that file's own comment
// for the full reasoning and what real data check prompted it.
type RecentActivityItem = {
  at: string;
  kind: 'invoice' | 'ar_edit' | 'campaign' | 'master_list_edit' | 'email_sent' | 'post_incorporate' | 'trademark_edit' | 'soa_owner';
  label: string;
  detail: string;
};
type MyTasksResponse = {
  scope: 'full' | 'ar-only';
  scopeNote: string;
  // Vincent, 2026-09-08: "每天打开My Tasks 的时候 AI助手会提醒今天可能会
  // 需要完成的任务" — a short daily-priority sentence (lib/my-tasks-brief.ts),
  // generated server-side from the exact same computed task lists below.
  // null only if generation itself failed outright — the banner just
  // doesn't render then, never blocks the rest of the page.
  brief: string | null;
  recentActivity: RecentActivityItem[];
  // 2026-09-08 — see lib/my-tasks-data.ts's own comment: distinguishes
  // "genuinely 0 outstanding right now" from "this account has never once
  // been PIC on anything" (true for management/owner accounts, who aren't
  // caseworkers) — the empty state below reads differently for each.
  everAssigned: boolean;
  arReminder: { overdue: ArTask[]; staleOverdue: ArTask[]; dueSoon: ArTask[] };
  lateFiling: { needsAttention: LateFilingTask[] } | null;
  counts: { arOverdue: number; arStaleOverdue: number; arDueSoon: number; lateFiling: number; total: number };
  viewingAs: { email: string; name: string } | null;
  // Only ever present when the REAL logged-in account has
  // canViewAsOthers — see app/api/my-tasks/route.ts's own comment. Absent
  // (not just empty) for everyone else, so its mere presence is what
  // gates the picker below.
  viewableAccounts?: { email: string; name: string; restrictedTo: string | null }[];
};

// Vincent, 2026-09-08, on the FIRST version of this banner (before the
// chat rebuild below): "更智能的分析和判断用户要做什么...每天打开My
// Tasks 的时候 AI助手会提醒今天可能会需要完成的任务" — deliberately the
// FIRST thing rendered on the Tasks view, before the metric cards, so it
// reads as "here's today's priority" rather than a footnote.
function DailyBriefBanner({ brief }: { brief: string | null }) {
  if (!brief) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', marginBottom: 16 }}>
      <Sparkles size={16} color="#1d4ed8" style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 3 }}>Today's Priority</div>
        <div style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.5 }}>{brief}</div>
      </div>
    </div>
  );
}

type Category = 'ALL' | 'overdue' | 'dueSoon' | 'lateFiling';

function MatchedAsBadges({ fields }: { fields: string[] }) {
  const labels: Record<string, string> = { pic: 'SEC', acc_pic: 'ACC', tax_pic: 'TAX' };
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {fields.map(f => (
        <span key={f} style={{ fontSize: 9, fontWeight: 700, color: '#1e3a5f', background: '#eef2f7', border: '1px solid #dbe3ec', borderRadius: 999, padding: '1px 6px' }}>{labels[f] ?? f}</span>
      ))}
    </span>
  );
}

function ArTaskTable({ rows, title, tone }: { rows: ArTask[]; title: string; tone: 'danger' | 'warning' }) {
  if (!rows.length) return null;
  return (
    <div className="system-list-shell" style={{ marginBottom: 16 }}>
      <div className="system-list-title-bar px-4 py-3">
        <h2 className="system-list-title">{title} <span style={{ opacity: 0.7, fontWeight: 500 }}>({rows.length})</span></h2>
      </div>
      <table className="system-list-table" style={{ width: '100%' }}>
        <thead><tr className="list-column-header-gray"><th>Company</th><th>FYE</th><th>Due Date</th><th>Days</th><th>Assigned as</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="system-list-row">
              <td style={{ padding: '6px 10px' }}><span className="company-name-text">{r.entityName}</span></td>
              <td style={{ padding: '6px 10px' }}>{r.fyeMonth} {r.fyeYear}</td>
              <td style={{ padding: '6px 10px' }}>{fmtDate(r.dueDate)}</td>
              <td style={{ padding: '6px 10px', fontWeight: 700, color: tone === 'danger' ? '#dc2626' : '#b45309' }}>
                {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)}d overdue` : r.daysUntilDue === 0 ? 'Due today' : `${r.daysUntilDue}d left`}
              </td>
              <td style={{ padding: '6px 10px' }}><MatchedAsBadges fields={r.matchedAs} /></td>
              <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.remarks ?? ''}>{r.remarks || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LateFilingTable({ rows }: { rows: LateFilingTask[] }) {
  if (!rows.length) return null;
  return (
    <div className="system-list-shell" style={{ marginBottom: 16 }}>
      <div className="system-list-title-bar px-4 py-3">
        <h2 className="system-list-title">Late Filing <span style={{ opacity: 0.7, fontWeight: 500 }}>({rows.length})</span></h2>
      </div>
      <table className="system-list-table" style={{ width: '100%' }}>
        <thead><tr className="list-column-header-gray"><th>Company</th><th>Next AGM Due</th><th>Assigned as</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="system-list-row">
              <td style={{ padding: '6px 10px' }}><span className="company-name-text">{r.companyName}</span></td>
              <td style={{ padding: '6px 10px' }}>{r.nextAgmDueDate ? fmtDate(r.nextAgmDueDate) : '—'}</td>
              <td style={{ padding: '6px 10px' }}><MatchedAsBadges fields={r.matchedAs} /></td>
              <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.remarks ?? ''}>{r.remarks || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Chat (new, 2026-09-08) ──────────────────────────────────────────────────
// Vincent, after seeing the static-table version: "My Tasks 不要这样的，
// 看起来好像有用，实际没有用处，只是摆设" (looks useful but is actually
// useless, mere decoration) — then: "My Tasks 这个页面是好像AI聊天这样的
// 界面，好像 Chatgpt/ Claude 这样的，可以New Chat, 记录Chats and tasks,
// 可以 Pin/ Pinned". Chat is now the PRIMARY view; the task tables above
// stay reachable from the sidebar's own "Tasks" entry (his own answer when
// asked whether to keep or drop them: "共存—聊天主体，任务列表另外一个区
// 域/标签页").
type Conversation = { id: number; title: string; pinned: boolean; created_at: string; updated_at: string };
// ChatMsg/ChatAttachment moved to components/assistant/ChatCards.tsx
// 2026-09-09 (shared with the new floating AssistantWidget — Vincent:
// "我希望它的功能和My Tasks这边的功能一样"). A brief same-day experiment
// surfaced which engine answered (Claude vs. the rule-based fallback) as a
// visible notice — Vincent explicitly asked for the opposite: "很奇怪，我
// 想要的就是回复看起来还是正常的，token 我自己会去看usage". Reverted same
// day; the API still returns `engine`/`note`, this UI just no longer shows
// them.
type ActiveView = 'chat' | 'tasks' | 'activity';

// Local to this page only — deliberately not added to lib/date.ts's shared
// exports, since this is the one place in the app showing a full
// date+time (every other date display in this system is date-only).
function formatActivityAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ACTIVITY_KIND_COLOR: Record<RecentActivityItem['kind'], string> = {
  invoice: '#0f766e',
  ar_edit: '#1e3a5f',
  campaign: '#7c3aed',
  master_list_edit: '#b45309',
  email_sent: '#0369a1',
  post_incorporate: '#65a30d',
  trademark_edit: '#be185d',
  soa_owner: '#475569',
};

function RecentActivityPanel({ items, subjectName }: { items: RecentActivityItem[]; subjectName: string }) {
  if (!items.length) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
        No recorded activity for {subjectName} yet — this reflects real actions (invoices generated, AR edits, campaigns, Master List changes, sent emails, ...), not just today's usage.
      </div>
    );
  }
  return (
    <div className="system-list-shell">
      <div className="system-list-title-bar px-4 py-3">
        <h2 className="system-list-title">Recent Activity <span style={{ opacity: 0.7, fontWeight: 500 }}>({items.length})</span></h2>
      </div>
      <div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 16px', borderBottom: i < items.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', width: 108, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatActivityAt(item.at)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: ACTIVITY_KIND_COLOR[item.kind], width: 168, flexShrink: 0 }}>{item.label}</span>
            <span style={{ fontSize: 12.5, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// InvoiceDraftCard/LateFilingResolveCard/InvoiceEditCard/PostIncorporateCard
// (+ their confirm modals, deepLinkStyle, draftLinesToApiLines) moved to
// components/assistant/ChatCards.tsx 2026-09-09 — shared with the new
// floating AssistantWidget (Vincent: "我希望它的功能和My Tasks这边的功能
// 一样"), so a real QuickBooks/Late Filing/Post Incorporate action is never
// implemented twice.

function ConversationRow({ conversation, active, onOpen, onTogglePin, onDelete }: {
  conversation: Conversation; active: boolean;
  onOpen: () => void; onTogglePin: () => void; onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
        background: active ? '#eef2f7' : hover ? '#f8fafc' : 'transparent',
      }}
    >
      <MessageSquare size={13} color={active ? '#1e3a5f' : '#94a3b8'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: active ? '#1e3a5f' : '#334155', fontWeight: active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {conversation.title}
      </span>
      {(hover || conversation.pinned) && (
        <button
          onClick={e => { e.stopPropagation(); onTogglePin(); }}
          title={conversation.pinned ? 'Unpin' : 'Pin'}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: conversation.pinned ? '#b45309' : '#94a3b8', flexShrink: 0 }}
        >
          {conversation.pinned ? <Pin size={12} fill="currentColor" /> : <Pin size={12} />}
        </button>
      )}
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#94a3b8', flexShrink: 0 }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// AttachmentChips/AttachmentThumbnails/AttachmentLightbox moved to
// components/assistant/ChatCards.tsx 2026-09-09 (shared with the new
// floating AssistantWidget).

export default function MyTasksPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<MyTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>('ALL');
  // "View as" — for accounts with canViewAsOthers (Vincent: "希望可以从这
  // 边看到不同权限的人看到的内容是什么...方便我优化调整"). Empty string =
  // acting as yourself. Deliberately NOT persisted anywhere (no
  // localStorage, resets on reload).
  //
  // 2026-09-08, extended from Tasks-only to full identity substitution
  // across BOTH Tasks and chat — Vincent: "不只是还原，而且我作为最大的
  // ADMIN 甚至是要可以带入到那个员工的身份，去开一个NEW CHAT 在她的记录...
  // 通过View as". While this is set, every chat action (list/read/create/
  // send/pin/delete) operates on the TARGET's real ai_conversations rows,
  // not a copy or a preview — a new chat started here becomes part of
  // their actual history. Every affected API route re-checks
  // canViewAsOthers itself (lib/approved-accounts.ts's
  // resolveViewAsAccount / the relaxed ownership checks in the ai/
  // conversations routes) — this client-side value is never trusted alone.
  const [viewAsEmail, setViewAsEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasksUrl = viewAsEmail ? `/api/my-tasks?viewAs=${encodeURIComponent(viewAsEmail)}` : '/api/my-tasks';
      const [meRes, tasksRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(tasksUrl),
      ]);
      const meJson = meRes.ok ? await meRes.json() : { user: null };
      setUser(meJson.user ?? null);
      if (!tasksRes.ok) {
        const j = await tasksRes.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to load My Tasks');
      }
      setData(await tasksRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [viewAsEmail]);

  useEffect(() => { load(); }, [load]);

  // ── Chat state ─────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLoadingThread, setChatLoadingThread] = useState(false);

  // Pending attachments for the NEXT message — cleared once sent (they move
  // into that message's own `attachments` field, see sendChatMessage).
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Conservative caps — Vercel's own Serverless Function request-body limit
  // is a hard ~4.5MB. Worst case here (2 files x 1.5MB raw = 3MB) inflates
  // to ~4MB once base64-encoded (x4/3), leaving real headroom for the rest
  // of the conversation history and JSON overhead in the same request —
  // matches the server-side guard in app/api/assistant/route.ts (kept in
  // sync there: raise one, raise the other).
  const MAX_ATTACHMENTS = 2;
  const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

  const addFiles = useCallback((files: FileList | File[]) => {
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
  }, [pendingAttachments.length]);

  const removeAttachment = (id: string) => setPendingAttachments(prev => prev.filter(a => a.id !== id));

  // "假设我要看回去这个附带的图片，我想要点击放大查看是可以的吗？" — an
  // image opens in the lightbox below; a PDF opens in a real new tab (its
  // data: URL is already in memory, no extra fetch needed) since a browser
  // already renders a PDF viewer for that on its own.
  const [viewingAttachment, setViewingAttachment] = useState<ChatAttachment | null>(null);
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
    if (!fileItems.length) return; // let normal text paste proceed untouched
    e.preventDefault();
    const files = fileItems.map(it => it.getAsFile()).filter((f): f is File => !!f);
    if (files.length) addFiles(files);
  };
  const chatListRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const url = viewAsEmail ? `/api/ai/conversations?viewAs=${encodeURIComponent(viewAsEmail)}` : '/api/ai/conversations';
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      setConversations(json.conversations ?? []);
    } catch {
      // Conversation history is a convenience layer on top of a working
      // chat, not a hard dependency — a failed load here just means an
      // empty sidebar, never a broken page.
    }
  }, [viewAsEmail]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Switching identity mid-session must never keep showing whatever thread
  // was open under the PREVIOUS identity — clear it so the next action
  // (open something from the new sidebar list, or send a first message)
  // starts from a clean slate rather than risking a message landing in the
  // wrong person's thread.
  useEffect(() => {
    setActiveConversationId(null);
    setChatMessages([]);
  }, [viewAsEmail]);

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatBusy]);

  // "New Chat" — Vincent: "可以New Chat". Lazy, same as ChatGPT's own
  // behaviour: this just clears the composer to a blank slate; nothing is
  // saved to ai_conversations until the first real message is actually
  // sent (sendChatMessage below) — avoids littering the sidebar with
  // empty threads from every click.
  const startNewChat = () => {
    setActiveConversationId(null);
    setChatMessages([]);
    setActiveView('chat');
  };

  const openConversation = async (id: number) => {
    setActiveConversationId(id);
    setActiveView('chat');
    setChatLoadingThread(true);
    setChatMessages([]);
    try {
      const res = await fetch(`/api/ai/conversations/${id}/messages`);
      const json = await res.json();
      // storedMessageToChatMsg (components/assistant/ChatCards.tsx, shared
      // with the floating AssistantWidget) reconstitutes whichever preview
      // card this reply originally carried (2026-09-09 — Vincent: "我发现
      // 每次只能看到一次，当我切换了页面或者点击了接口，这个预览和深链的
      // 记录就不见了"). Older rows saved before scripts/add-ai-messages-
      // preview-data.sql simply have no preview_data — falls back to plain
      // text exactly as before.
      setChatMessages((json.messages ?? []).map(storedMessageToChatMsg));
    } catch {
      setChatMessages([{ role: 'assistant', content: '无法加载这段对话的历史记录，请重试。' }]);
    } finally {
      setChatLoadingThread(false);
    }
  };

  const togglePin = async (conversation: Conversation) => {
    const pinned = !conversation.pinned;
    setConversations(prev => prev.map(c => (c.id === conversation.id ? { ...c, pinned } : c))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || +new Date(b.updated_at) - +new Date(a.updated_at)));
    await fetch(`/api/ai/conversations/${conversation.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned }),
    }).catch(() => {});
  };

  const deleteConversationRow = async (conversation: Conversation) => {
    setConversations(prev => prev.filter(c => c.id !== conversation.id));
    if (activeConversationId === conversation.id) startNewChat();
    await fetch(`/api/ai/conversations/${conversation.id}`, { method: 'DELETE' }).catch(() => {});
  };

  const sendChatMessage = async (suggestedText?: string) => {
    const text = (suggestedText ?? chatInput).trim();
    const attachments = pendingAttachments;
    if ((!text && !attachments.length) || chatBusy) return;

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const createUrl = viewAsEmail ? `/api/ai/conversations?viewAs=${encodeURIComponent(viewAsEmail)}` : '/api/ai/conversations';
        const res = await fetch(createUrl, { method: 'POST' });
        const json = await res.json();
        conversationId = json.conversation?.id ?? null;
        if (conversationId) {
          setActiveConversationId(conversationId);
          setConversations(prev => [json.conversation, ...prev]);
        }
      } catch {
        // Fall through and still answer the question even if a thread
        // couldn't be created — an unsaved reply beats no reply.
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
        // viewAs — 2026-09-08, "View As" now covers chat too (see
        // viewAsEmail's own comment above): the assistant resolves and
        // answers/saves as the TARGET account, not the real caller, for
        // the lifetime of this one request.
        body: JSON.stringify({ messages: next.map(toApiMessage), context: { pathname: '/my-tasks', page: 'My Tasks' }, conversationId, viewAs: viewAsEmail || undefined }),
      });
      const json = await res.json();
      setChatMessages(current => [...current, { role: 'assistant', content: json.reply ?? json.error ?? '出错了，请重试。', invoicePreview: json.invoicePreview ?? undefined, lateFilingPreview: json.lateFilingPreview ?? undefined, invoiceEditPreview: json.invoiceEditPreview ?? undefined, postIncorporatePreview: json.postIncorporatePreview ?? undefined, arUpdatePreview: json.arUpdatePreview ?? undefined, exportOffer: json.exportOffer ?? undefined, soaPreview: json.soaPreview ?? undefined, emailDraftPreview: json.emailDraftPreview ?? undefined, companyUpdatePreview: json.companyUpdatePreview ?? undefined, taoPreview: json.taoPreview ?? undefined }]);
      loadConversations(); // pick up the auto-derived title / updated_at reorder
    } catch {
      setChatMessages(current => [...current, { role: 'assistant', content: '网络错误，请重试。' }]);
    } finally {
      setChatBusy(false);
    }
  };

  const pinnedConversations = conversations.filter(c => c.pinned);
  const recentConversations = conversations.filter(c => !c.pinned);

  // Resolved locally from the picker's own list (available as soon as the
  // Tasks fetch resolves once, regardless of which tab is active) rather
  // than from data.viewingAs, which only reflects the Tasks-view fetch —
  // this banner now needs to show identically on the chat tab too.
  const viewingAsAccount = viewAsEmail ? data?.viewableAccounts?.find(a => a.email === viewAsEmail) ?? null : null;

  const counts = data?.counts;
  const arRows = data?.arReminder;
  const lateRows = data?.lateFiling?.needsAttention ?? [];

  const showOverdue = cat === 'ALL' || cat === 'overdue';
  const showDueSoon = cat === 'ALL' || cat === 'dueSoon';
  const showLate = cat === 'ALL' || cat === 'lateFiling';

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › My Tasks</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <ListChecks size={20} color="#1e3a5f" />
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: 0 }}>My Tasks</h1>
        {user && <span style={{ fontSize: 12, color: '#94a3b8' }}>{user.name}</span>}
        {data?.viewableAccounts && (
          <select
            value={viewAsEmail}
            onChange={e => setViewAsEmail(e.target.value)}
            title="Management-only: act as another staff member across both Tasks and chat — new chats and messages you send are saved to THEIR account, not yours"
            style={{ marginLeft: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, color: '#475569', background: '#fff' }}
          >
            <option value="">View as: Me ({user?.name})</option>
            {data.viewableAccounts.filter(a => a.email !== user?.email).map(a => (
              <option key={a.email} value={a.email}>
                View as: {a.name}{a.restrictedTo ? ' (AR Reminder only)' : ''}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => { load(); loadConversations(); }} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {viewingAsAccount && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
          <AlertTriangle size={14} />
          {activeView === 'tasks' && `Viewing as ${viewingAsAccount.name} (${viewingAsAccount.email}) — this is their task queue, not yours.`}
          {activeView === 'activity' && `Viewing as ${viewingAsAccount.name} (${viewingAsAccount.email}) — this is their real activity history.`}
          {activeView === 'chat' && `Acting as ${viewingAsAccount.name} (${viewingAsAccount.email}) — chats and messages here are saved to their account, not yours.`}
        </div>
      )}

      {/* Vincent, 2026-09-08: first "上下尺寸稍微短一点...可以减少15%的高
          度" (reduced 100vh-170px by 15% -> 85vh-145px, minHeight 408) —
          then, after a follow-up "下方长度加7%" got misread as widening the
          input row instead: "看起来还是一样也，我说的是上下高度" (I meant
          the vertical height). Scaled the CURRENT 85vh-145px calc up 7%
          (85*1.07=90.95vh, 145*1.07=155.15->155px), same "scale both terms
          proportionally" approach as the original reduction — net effect
          vs. the very first version is ~0.85*1.07=91% (a ~9% reduction
          overall, not the full 15%). minHeight 408*1.07=436.56->437. */}
      <div style={{ display: 'flex', gap: 16, height: 'calc(90.95vh - 155px)', minHeight: 437 }}>
        {/* Sidebar — Vincent: "可以New Chat, 记录Chats and tasks, 可以
            Pin/ Pinned", modelled on the ChatGPT/Claude sidebar screenshots
            he shared: New Chat button, then Pinned / Recent sections. */}
        <aside style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>
            <button
              onClick={startNewChat}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#1e3a5f', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              <Plus size={14} />New Chat
            </button>
          </div>
          <button
            onClick={() => setActiveView('tasks')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: 'none', borderBottom: '1px solid #f1f5f9',
              background: activeView === 'tasks' ? '#eef2f7' : '#fff', color: activeView === 'tasks' ? '#1e3a5f' : '#334155',
              fontSize: 12.5, fontWeight: activeView === 'tasks' ? 700 : 600, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <ListChecks size={14} />
            Tasks
            {!!counts?.total && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: '#fff', background: counts.total > 0 ? '#dc2626' : '#94a3b8', borderRadius: 999, padding: '1px 6px' }}>{counts.total}</span>
            )}
          </button>
          <button
            onClick={() => setActiveView('activity')}
            title="Real activity — invoices generated, AR edits, campaigns, Master List changes, sent emails and more (not just AR/Late Filing)"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: 'none', borderBottom: '1px solid #f1f5f9',
              background: activeView === 'activity' ? '#eef2f7' : '#fff', color: activeView === 'activity' ? '#1e3a5f' : '#334155',
              fontSize: 12.5, fontWeight: activeView === 'activity' ? 700 : 600, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Activity size={14} />
            Activity
          </button>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
            {pinnedConversations.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 8px' }}>Pinned</div>
                {pinnedConversations.map(c => (
                  <ConversationRow key={c.id} conversation={c} active={activeView === 'chat' && activeConversationId === c.id}
                    onOpen={() => openConversation(c.id)} onTogglePin={() => togglePin(c)} onDelete={() => deleteConversationRow(c)} />
                ))}
              </>
            )}
            {recentConversations.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 8px', marginTop: pinnedConversations.length ? 6 : 0 }}>Recent</div>
                {recentConversations.map(c => (
                  <ConversationRow key={c.id} conversation={c} active={activeView === 'chat' && activeConversationId === c.id}
                    onOpen={() => openConversation(c.id)} onTogglePin={() => togglePin(c)} onDelete={() => deleteConversationRow(c)} />
                ))}
              </>
            )}
            {!conversations.length && (
              <div style={{ padding: '10px 8px', fontSize: 11, color: '#b7c1cd' }}>No saved chats yet — start one above.</div>
            )}
          </div>
        </aside>

        {/* Main panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {activeView === 'chat' ? (
            <div
              style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
              onDrop={handleDrop}
            >
              {dragActive && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,118,110,0.08)', border: '2px dashed #0f766e', borderRadius: 10, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ background: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#0f766e', boxShadow: '0 4px 16px rgba(15,23,42,0.15)' }}>
                    松开以添加图片或 PDF
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />
              {!chatMessages.length && !chatLoadingThread ? (
                // Vincent, from a real ChatGPT screenshot: "在还没有开始问
                // 问题前，输入框是在中间的" (before asking anything, the
                // input box sits in the middle) — matches ChatGPT's own
                // empty state exactly: headline, then a centered input,
                // then suggestions below it. Only once a real conversation
                // exists does the input move down to a bottom-pinned bar
                // (the branch below), with messages filling the space above.
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fff' }}>
                  {/* Vincent, from a screenshot of his own copy-editing pass
                      (comparing against a real ChatGPT "准备好了，随时开始"
                      empty state): "这个内容...可以简单一点，放成英文的
                      （准备好了，随时开始）就可以了...这个不需要：可以按你
                      自己的登录账号..." — dropped the descriptive Chinese
                      paragraph entirely, title/subtitle down to just "My
                      Tasks" / "Ready when you are.", and shortened the 3
                      suggestion buttons — his own preferred, more
                      ChatGPT-like of the two versions he compared
                      ("如果你希望整体更像 ChatGPT 的 AI 助手界面...第二版
                      会更简洁、自然，也没有那么强的'系统说明感'"). No longer
                      pulls from AssistantWidget's shared getPageGuide() —
                      that guide's fuller Chinese explanatory copy is still
                      right for the floating widget (matches every other
                      page's guide there), just not for this page's own new,
                      deliberately minimal empty state. */}
                  <picture style={{ display: 'block', width: 160, height: 96, marginBottom: 10, transform: 'translateY(-16px)' }}>
                    <source media="(prefers-reduced-motion: reduce)" srcSet="/my-tasks-robot-still.png" />
                    {/* Loops only while this empty-chat branch is mounted; first submitted message removes it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/my-tasks-robot.gif" alt="" width={160} height={96} style={{ display: 'block', objectFit: 'contain' }} />
                  </picture>
                  <div style={{ fontSize: 15, fontWeight: 750, color: '#12233b', marginBottom: 6 }}>My Tasks</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 20 }}>Ready when you are.</div>
                  <div style={{ width: '100%', maxWidth: 560 }}>
                    <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} onView={handleViewAttachment} />
                    {attachError && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 6 }}>{attachError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="附加图片或 PDF"
                        style={{ width: 40, flexShrink: 0, borderRadius: 9, border: '1px solid #dbe3ec', background: '#fff', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      >
                        <Paperclip size={16} />
                      </button>
                      <input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChatMessage(); }}
                        onPaste={handlePaste}
                        placeholder="问问今天要优先做什么，或任何系统问题…（可拖拽/粘贴图片、PDF）"
                        autoFocus
                        style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '11px 14px', fontSize: 13, outline: 'none' }}
                      />
                      <button
                        onClick={() => void sendChatMessage()}
                        disabled={chatBusy || (!chatInput.trim() && !pendingAttachments.length)}
                        style={{ width: 40, flexShrink: 0, borderRadius: 9, border: 'none', cursor: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? 'not-allowed' : 'pointer', background: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? '#cbd5e1' : '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Send size={15} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 14, maxWidth: 560 }}>
                    {/* Discoverability, rewritten 2026-09-10 — see the same-day
                        rationale on PAGE_GUIDES in components/AssistantWidget.tsx
                        (clicks send verbatim; every one must really be answerable).
                        'What should I prioritize today?' is kept because it IS this
                        page's own subject, but it routes to my_tasks_summary, which
                        legitimately returns nothing for an owner/management account
                        who was never a caseworker — so the firm-wide version sits
                        next to it rather than leaving that headline a dead end. */}
                    {['What should I prioritize today?', "What needs the firm's attention today?", "Which of my clients haven't paid?", 'What can you help me with?'].map(s => (
                      <button key={s} onClick={() => void sendChatMessage(s)} disabled={chatBusy}
                        style={{ border: '1px solid #d7e1eb', borderRadius: 999, background: '#fff', color: '#31506f', padding: '6px 12px', fontSize: 12, fontWeight: 650, cursor: chatBusy ? 'wait' : 'pointer' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div ref={chatListRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc' }}>
                    {chatLoadingThread && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12.5, padding: 20 }}>Loading…</div>}
                    {chatMessages.map((message, index) => (
                      <div
                        key={index}
                        style={{
                          alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                          maxWidth: '72%',
                          padding: '10px 13px',
                          borderRadius: 12,
                          fontSize: 13,
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
                              <RichText text={message.content} onNav={href => { if (href.startsWith('/')) window.location.href = href; else window.open(href, '_blank', 'noopener,noreferrer'); }} />
                              {message.invoicePreview && (
                                <InvoiceDraftCard
                                  preview={message.invoicePreview}
                                  onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])}
                                />
                              )}
                              {message.lateFilingPreview && (
                                <LateFilingResolveCard
                                  preview={message.lateFilingPreview}
                                  onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])}
                                />
                              )}
                              {message.taoPreview && (
                                <TaoBillingCard preview={message.taoPreview} />
                              )}
                              {message.companyUpdatePreview && (
                                <CompanyUpdateCard preview={message.companyUpdatePreview} onDone={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])} />
                              )}
                              {message.emailDraftPreview && (
                                <EmailDraftCard preview={message.emailDraftPreview} />
                              )}
                              {message.soaPreview && (
                                <SoaCard preview={message.soaPreview} />
                              )}
                              {message.exportOffer && (
                                <ListExportCard offer={message.exportOffer} />
                              )}
                              {message.arUpdatePreview && (
                                <ArUpdateCard
                                  preview={message.arUpdatePreview}
                                  onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])}
                                />
                              )}
                              {message.invoiceEditPreview && (
                                <InvoiceEditCard
                                  preview={message.invoiceEditPreview}
                                  onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])}
                                />
                              )}
                              {message.postIncorporatePreview && (
                                <PostIncorporateCard
                                  preview={message.postIncorporatePreview}
                                  onGenerated={summary => setChatMessages(current => [...current, { role: 'assistant', content: summary }])}
                                />
                              )}
                            </>
                          : <>
                              {message.content}
                              {message.attachments?.length ? <AttachmentThumbnails attachments={message.attachments} onView={handleViewAttachment} /> : null}
                            </>}
                      </div>
                    ))}
                    {chatBusy && (
                      <div role="status" aria-label="正在结合系统资料查询…" style={{ alignSelf: 'flex-start', padding: '4px 10px', display: 'flex', alignItems: 'center' }}>
                        <picture>
                          <source media="(prefers-reduced-motion: reduce)" srcSet="/my-tasks-thinking-still.png" />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/my-tasks-thinking.gif" alt="" width={240} height={144} style={{ display: 'block', objectFit: 'contain', maxWidth: '100%', height: 'auto' }} />
                        </picture>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: '1px solid #e8edf3', background: '#fff' }}>
                    <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} onView={handleViewAttachment} />
                    {attachError && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 6 }}>{attachError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="附加图片或 PDF"
                      style={{ width: 40, flexShrink: 0, borderRadius: 9, border: '1px solid #dbe3ec', background: '#fff', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <Paperclip size={16} />
                    </button>
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChatMessage(); }}
                      onPaste={handlePaste}
                      placeholder="问问今天要优先做什么，或任何系统问题…（可拖拽/粘贴图片、PDF）"
                      style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }}
                    />
                    <button
                      onClick={() => void sendChatMessage()}
                      disabled={chatBusy || (!chatInput.trim() && !pendingAttachments.length)}
                      style={{ width: 40, flexShrink: 0, borderRadius: 9, border: 'none', cursor: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? 'not-allowed' : 'pointer', background: chatBusy || (!chatInput.trim() && !pendingAttachments.length) ? '#cbd5e1' : '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Send size={15} />
                    </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : activeView === 'activity' ? (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading && !data ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
              ) : error ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>{error}</div>
              ) : (
                <RecentActivityPanel items={data?.recentActivity ?? []} subjectName={viewingAsAccount?.name ?? 'you'} />
              )}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {data && <DailyBriefBanner brief={data.brief} />}
              {data && <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 20 }}>{data.scopeNote}</div>}

              {loading && !data ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
              ) : error ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>{error}</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
                    <MetricCard onClick={() => setCat('ALL')} active={cat === 'ALL'} value={counts?.total ?? 0} label="All Tasks" sub="across AR & Late Filing" icon={<ListChecks size={16} />} color="#1e3a5f" ariaLabel="Show all tasks" />
                    <MetricCard onClick={() => setCat('overdue')} active={cat === 'overdue'} value={(counts?.arOverdue ?? 0) + (counts?.arStaleOverdue ?? 0)} label="AR Overdue" sub="past due, not filed" icon={<AlertTriangle size={16} />} color="#dc2626" ariaLabel="Filter by AR overdue" />
                    <MetricCard onClick={() => setCat('dueSoon')} active={cat === 'dueSoon'} value={counts?.arDueSoon ?? 0} label="AR Due Soon" sub="due within 14 days" icon={<Clock size={16} />} color="#b45309" ariaLabel="Filter by AR due soon" />
                    {data?.scope === 'full' && (
                      <MetricCard onClick={() => setCat('lateFiling')} active={cat === 'lateFiling'} value={counts?.lateFiling ?? 0} label="Late Filing" sub="flagged, mine to chase" icon={<CalendarClock size={16} />} color="#7c3aed" ariaLabel="Filter by Late Filing" />
                    )}
                  </div>

                  {counts?.total === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                      {!data?.everAssigned ? (
                        // 2026-09-08 — Vincent, on his own account: "还是很
                        // 像摆设，不知道是不是没有数据支撑" — confirmed: his
                        // account has never been PIC on a single AR
                        // Reminder/Late Filing row, ever. "You're all caught
                        // up" would falsely imply work existed and got
                        // done — this is a genuinely different, honest
                        // message for an account that was never a
                        // caseworker in the first place.
                        <>
                          <div>{data?.viewingAs ? `${data.viewingAs.name} isn't` : "Your account isn't"} assigned as PIC on any AR Reminder or Late Filing item — that's expected for a management/non-caseworker account, not a sign anything is broken.</div>
                          {!data?.viewingAs && (
                            <div style={{ marginTop: 8, fontSize: 12.5 }}>
                              {!!data?.viewableAccounts?.length && 'Use "View as" above to check a specific team member, or '}
                              see the <button onClick={() => setActiveView('activity')} style={{ border: 'none', background: 'none', color: '#0f766e', fontWeight: 700, cursor: 'pointer', padding: 0, font: 'inherit' }}>Activity</button> tab for what's actually happening across the system.
                            </div>
                          )}
                        </>
                      ) : (
                        data?.viewingAs ? `Nothing outstanding for ${data.viewingAs.name}.` : "Nothing outstanding — you're all caught up."
                      )}
                    </div>
                  ) : (
                    <>
                      {showOverdue && arRows && (arRows.overdue.length > 0 || arRows.staleOverdue.length > 0) && (
                        <>
                          <ArTaskTable rows={arRows.overdue} title="AR Overdue" tone="danger" />
                          <ArTaskTable rows={arRows.staleOverdue} title="AR Overdue (prior FYE year)" tone="danger" />
                        </>
                      )}
                      {showDueSoon && arRows && <ArTaskTable rows={arRows.dueSoon} title="AR Due Soon" tone="warning" />}
                      {showLate && data?.scope === 'full' && <LateFilingTable rows={lateRows} />}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {viewingAttachment && <AttachmentLightbox attachment={viewingAttachment} onClose={() => setViewingAttachment(null)} />}
    </div>
  );
}
