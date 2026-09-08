'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, CalendarClock, Clock, ListChecks, RefreshCw, Sparkles,
  Plus, Pin, Trash2, Send, Bot, MessageSquare,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { RichText } from '@/components/assistant/ChatRichText';
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
type MyTasksResponse = {
  scope: 'full' | 'ar-only';
  scopeNote: string;
  // Vincent, 2026-09-08: "每天打开My Tasks 的时候 AI助手会提醒今天可能会
  // 需要完成的任务" — a short daily-priority sentence (lib/my-tasks-brief.ts),
  // generated server-side from the exact same computed task lists below.
  // null only if generation itself failed outright — the banner just
  // doesn't render then, never blocks the rest of the page.
  brief: string | null;
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
type ChatMsg = { role: 'user' | 'assistant'; content: string };
type ActiveView = 'chat' | 'tasks';

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

export default function MyTasksPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<MyTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>('ALL');
  // "View as" — debug/demo tool for accounts with canViewAsOthers
  // (Vincent: "希望可以从这边看到不同权限的人看到的内容是什么...方便我优化调整").
  // Empty string = viewing your own real tasks. Deliberately NOT persisted
  // anywhere (no localStorage, resets on reload) — this is a one-off
  // inspection tool, not a real account switch, and only ever affects the
  // Tasks view's own data — chat is always the real logged-in user's own
  // conversations, never "viewed as" someone else (that would be reading
  // another person's private chat history, a real privacy line this
  // feature doesn't cross).
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
  const chatListRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/conversations');
      if (!res.ok) return;
      const json = await res.json();
      setConversations(json.conversations ?? []);
    } catch {
      // Conversation history is a convenience layer on top of a working
      // chat, not a hard dependency — a failed load here just means an
      // empty sidebar, never a broken page.
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

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
      setChatMessages((json.messages ?? []).map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: m.content })));
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
    const content = (suggestedText ?? chatInput).trim();
    if (!content || chatBusy) return;

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const res = await fetch('/api/ai/conversations', { method: 'POST' });
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

    const next = [...chatMessages, { role: 'user' as const, content }];
    setChatMessages(next);
    setChatInput('');
    setChatBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, context: { pathname: '/my-tasks', page: 'My Tasks' }, conversationId }),
      });
      const json = await res.json();
      setChatMessages(current => [...current, { role: 'assistant', content: json.reply ?? json.error ?? '出错了，请重试。' }]);
      loadConversations(); // pick up the auto-derived title / updated_at reorder
    } catch {
      setChatMessages(current => [...current, { role: 'assistant', content: '网络错误，请重试。' }]);
    } finally {
      setChatBusy(false);
    }
  };

  const pinnedConversations = conversations.filter(c => c.pinned);
  const recentConversations = conversations.filter(c => !c.pinned);

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
            title="Admin-only: preview what the Tasks view looks like for another staff member (chat is unaffected — it's always your own)"
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

      {activeView === 'tasks' && data?.viewingAs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
          <AlertTriangle size={14} />
          Viewing as {data.viewingAs.name} ({data.viewingAs.email}) — this is a preview for tuning My Tasks, not your own tasks.
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
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
                  <Bot size={28} color="#94a3b8" style={{ marginBottom: 10 }} />
                  <div style={{ fontSize: 15, fontWeight: 750, color: '#12233b', marginBottom: 6 }}>My Tasks</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 20 }}>Ready when you are.</div>
                  <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 560 }}>
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChatMessage(); }}
                      placeholder="问问今天要优先做什么，或任何系统问题…"
                      autoFocus
                      style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '11px 14px', fontSize: 13, outline: 'none' }}
                    />
                    <button
                      onClick={() => void sendChatMessage()}
                      disabled={chatBusy || !chatInput.trim()}
                      style={{ width: 40, borderRadius: 9, border: 'none', cursor: chatBusy || !chatInput.trim() ? 'not-allowed' : 'pointer', background: chatBusy || !chatInput.trim() ? '#cbd5e1' : '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 14, maxWidth: 560 }}>
                    {['What should I prioritize today?', 'Any overdue AR?', 'How does this work?'].map(s => (
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
                          ? <RichText text={message.content} onNav={href => { if (href.startsWith('/')) window.location.href = href; else window.open(href, '_blank', 'noopener,noreferrer'); }} />
                          : message.content}
                      </div>
                    ))}
                    {chatBusy && (
                      <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: 12, background: '#fff', border: '1px solid #e3e9f0', fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Sparkles size={13} /> 正在结合系统资料查询…
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #e8edf3', background: '#fff' }}>
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChatMessage(); }}
                      placeholder="问问今天要优先做什么，或任何系统问题…"
                      style={{ flex: 1, border: '1px solid #dbe3ec', borderRadius: 9, padding: '9px 12px', fontSize: 13, outline: 'none' }}
                    />
                    <button
                      onClick={() => void sendChatMessage()}
                      disabled={chatBusy || !chatInput.trim()}
                      style={{ width: 40, borderRadius: 9, border: 'none', cursor: chatBusy || !chatInput.trim() ? 'not-allowed' : 'pointer', background: chatBusy || !chatInput.trim() ? '#cbd5e1' : '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </>
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
                      {data?.viewingAs ? `Nothing outstanding for ${data.viewingAs.name}.` : "Nothing outstanding — you're all caught up."}
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
    </div>
  );
}
