'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, CalendarClock, Clock, ListChecks, RefreshCw, Sparkles,
  Plus, Pin, Trash2, Send, MessageSquare, Activity, FileCheck2, X,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { RichText } from '@/components/assistant/ChatRichText';
import { fmtDate } from '@/lib/date';
import type { InvoicePreview } from '@/lib/billing-lookup';
import type { EditableLine } from '@/lib/billing-draft';
import type { LateFilingResolvePreview } from '@/lib/late-filing-lookup';
import type { InvoiceEditPreview } from '@/lib/invoice-edit-lookup';
import type { PostIncorporatePreview } from '@/lib/docx-post-incorporate';
import { billingDeepLink, lateFilingDeepLink } from '@/lib/deep-links';
import { logActivity } from '@/lib/activity-client';

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
// invoicePreview (2026-09-08) rides along on an assistant message when the
// preview_invoice_draft tool ran — see InvoiceDraftCard below. Only ever
// present on a fresh reply from THIS session; reopening a saved
// conversation later shows the plain text only (the card's structured
// data isn't persisted to ai_messages yet — a known, deliberate v1 gap).
// A brief 2026-09-09 experiment surfaced which engine answered (Claude vs.
// the rule-based fallback) as a visible notice — Vincent explicitly asked
// for the opposite: "很奇怪，我想要的就是回复看起来还是正常的，token 我
// 自己会去看usage". Reverted same day; the API still returns `engine`/
// `note`, this UI just no longer shows them.
type ChatMsg = { role: 'user' | 'assistant'; content: string; invoicePreview?: InvoicePreview; lateFilingPreview?: LateFilingResolvePreview; invoiceEditPreview?: InvoiceEditPreview; postIncorporatePreview?: PostIncorporatePreview };
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

// Smart deep links (2026-09-09) — Vincent, after the 3 preview+confirm
// cards below had already shipped: "当用户点击去开单的时候你应该是带用户
// 去到开单的接口，并且协助好找到对应的公司和点击好打开了那个发票编辑的
// 弹窗，不只是带到 Billing draft 的接口页面就停了...思考用户真正要的便利
// 和下一步到底可能是什么". The in-chat card+modal already lets the user
// finish the whole action without leaving the conversation — this is the
// escape hatch for when they want to do more than the compact card shows
// (add a line the pre-fill didn't cover, double-check something on the
// real page first, etc.): a link that doesn't just dump them on the
// generic tab, but actually finds the company and opens the SAME edit
// dialog a manual click would — see app/billing/page.tsx's CombinedPage/
// BillingTab (openCompany) and app/late-filing/page.tsx's
// LateFilingPageInner (openCompany) for the actual auto-open logic this
// links into. Deliberately still just a navigation, never a second write
// path — the target page's own real button is what the user clicks next.
// billingDeepLink/lateFilingDeepLink themselves live in lib/deep-links.ts,
// shared with the server side (app/api/assistant/route.ts builds the same
// kind of link for a not-found suggestion) so the URL format can't drift
// between the two.
const deepLinkStyle: React.CSSProperties = {
  display: 'block', textAlign: 'center', marginTop: 6, fontSize: 11, fontWeight: 650,
  color: '#31506f', textDecoration: 'none',
};

// ── Invoice draft preview + real confirm-and-generate (2026-09-08) ─────────
// Step 2 of Vincent's agentic-invoicing direction (step 1 shipped earlier
// today: the read-only preview_invoice_draft tool). Vincent, on the plain
// markdown-table version: "这些内容很简陋，不能直接和用户确认后弹出真正
// 的弹窗吗？...要预览实际页面预览，不是文字大纲" — a real styled card
// (not a markdown outline in the chat bubble) plus a genuine confirmation
// MODAL before anything real happens.
//
// The actual QuickBooks write goes through the EXACT SAME endpoint and
// payload shape app/billing/page.tsx itself sends to
// /api/quickbooks/create-invoice — same idempotency, same reservation
// system, same overlap/number-conflict handling. This never invents a
// parallel write path; it only assembles the same request a human would
// send from Billing Drafts, and requires an explicit click on a real
// button before sending it — the AI itself can never trigger this call,
// it only ever produces the preview data the card renders.
function draftLinesToApiLines(lines: EditableLine[]) {
  const included = lines.filter(l => l.include);
  const toApiLine = (l: EditableLine) => ({
    service: l.service, productService: l.productService, description: l.description,
    rate: l.rate, qty: l.qty, periodConfirmed: l.periodReviewed === true,
  });
  return {
    tabLines: included.filter(l => l.service !== 'ND').map(toApiLine),
    tacLines: included.filter(l => l.service === 'ND').map(toApiLine),
  };
}

type GenerateOutcome =
  | { state: 'idle' }
  | { state: 'confirming' }
  | { state: 'submitting' }
  | { state: 'overlap'; warnings: string[] }
  | { state: 'success'; tab?: { invoiceNo: string | null; total: number }; tac?: { invoiceNo: string | null; total: number } }
  | { state: 'error'; message: string };

function InvoiceDraftCard({ preview, onGenerated }: { preview: InvoicePreview; onGenerated: (summary: string) => void }) {
  const [outcome, setOutcome] = useState<GenerateOutcome>({ state: 'idle' });
  // One idempotency key per confirmation attempt (fresh each time the card
  // moves from idle -> confirming), reused across an overlap-confirm retry
  // of the SAME logical request — matches app/billing/page.tsx's own
  // per-row key, which also stays stable across its retries.
  const idempotencyKeyRef = useRef<string | null>(null);

  const included = preview.lines.filter(l => l.include);
  const { tab: totalTab, tac: totalTac } = preview.totals;
  const blocked = included.length === 0 || preview.alreadyInvoicedThisCycle;

  const submit = async (overlapConfirmed: boolean) => {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = globalThis.crypto.randomUUID();
    setOutcome({ state: 'submitting' });
    const { tabLines, tacLines } = draftLinesToApiLines(preview.lines);
    const fyeYear = preview.fyeCycle ? parseInt(preview.fyeCycle.split('.')[2] ?? '', 10) : undefined;
    try {
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: preview.companyName,
          companyId: preview.companyId ?? undefined,
          email: preview.email ?? undefined,
          pic: preview.pic ?? undefined,
          sendEmail: false,
          tabLines, tacLines,
          fyeMonth: preview.fyeMonth ?? undefined,
          fyeYear: fyeYear && Number.isFinite(fyeYear) ? fyeYear : undefined,
          fyeCycle: preview.fyeCycle || undefined,
          idempotencyKey: idempotencyKeyRef.current,
          overlapConfirmed,
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.overlapConfirmationRequired && !overlapConfirmed) {
        const warnings = [...(json.overlapWarnings?.tab ?? []), ...(json.overlapWarnings?.tac ?? [])];
        setOutcome({ state: 'overlap', warnings: warnings.length ? warnings : ['This invoice period overlaps one already on file.'] });
        return;
      }
      if (!res.ok) {
        setOutcome({ state: 'error', message: json.error || `Request failed (${res.status})` });
        return;
      }
      const summaryParts: string[] = [];
      if (json.tab) summaryParts.push(`TAB #${json.tab.invoiceNo ?? '?'} · S$${(json.tab.total ?? 0).toLocaleString()}`);
      if (json.tac) summaryParts.push(`TAC #${json.tac.invoiceNo ?? '?'} · S$${(json.tac.total ?? 0).toLocaleString()}`);
      setOutcome({ state: 'success', tab: json.tab, tac: json.tac });
      onGenerated(`已生成 ${preview.companyName} 的发票：${summaryParts.join(' · ') || '无新增品项'}`);
    } catch (err) {
      setOutcome({ state: 'error', message: err instanceof Error ? err.message : '网络错误，请重试。' });
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 460 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileCheck2 size={14} color="#1e3a5f" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.companyName}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>UEN {preview.uen ?? '—'} · FYE {preview.fyeCycle || preview.fyeMonth || '—'}</div>
        </div>
        {preview.alreadyInvoicedThisCycle && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>ALREADY INVOICED</span>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr style={{ background: '#fbfcfd' }}>
            <th style={{ textAlign: 'left', padding: '6px 14px', color: '#94a3b8', fontWeight: 700, fontSize: 10 }}>SERVICE</th>
            <th style={{ textAlign: 'right', padding: '6px 14px', color: '#94a3b8', fontWeight: 700, fontSize: 10 }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {included.length === 0 && (
            <tr><td colSpan={2} style={{ padding: '12px 14px', color: '#94a3b8', textAlign: 'center' }}>Nothing due this cycle.</td></tr>
          )}
          {included.map((line, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '7px 14px', color: '#334155' }}>
                {line.service}
                {line.reason && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{line.reason}</div>}
              </td>
              <td style={{ padding: '7px 14px', textAlign: 'right', color: '#173b61', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>S${(line.qty * line.rate).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        {included.length > 0 && (
          <tfoot>
            {totalTab > 0 && <tr style={{ borderTop: '1px solid #eef2f7' }}><td style={{ padding: '7px 14px', fontWeight: 750, color: '#173b61' }}>TAB Total</td><td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 800, color: '#173b61' }}>S${totalTab.toLocaleString()}</td></tr>}
            {totalTac > 0 && <tr><td style={{ padding: '7px 14px', fontWeight: 750, color: '#173b61' }}>TAC Total</td><td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 800, color: '#173b61' }}>S${totalTac.toLocaleString()}</td></tr>}
          </tfoot>
        )}
      </table>

      {preview.warnings.length > 0 && (
        <div style={{ padding: '8px 14px', background: '#fffbeb', borderTop: '1px solid #fde68a', fontSize: 10.5, color: '#92400e' }}>
          {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef2f7' }}>
        {outcome.state === 'success' ? (
          <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>
            ✓ Generated{outcome.tab ? ` — TAB #${outcome.tab.invoiceNo ?? '?'}` : ''}{outcome.tac ? ` — TAC #${outcome.tac.invoiceNo ?? '?'}` : ''}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOutcome({ state: 'confirming' })}
            disabled={blocked}
            title={preview.alreadyInvoicedThisCycle ? 'Already invoiced this cycle' : included.length === 0 ? 'Nothing due this cycle' : undefined}
            style={{
              width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 750,
              cursor: blocked ? 'not-allowed' : 'pointer',
              background: blocked ? '#e2e8f0' : '#0f766e',
              color: blocked ? '#94a3b8' : '#fff',
            }}
          >
            Generate Invoice
          </button>
        )}
        {outcome.state !== 'success' && (
          <a href={billingDeepLink(preview.companyName, preview.fyeMonth, preview.fyeCycle)} style={deepLinkStyle}>
            Open in Billing Drafts to review or adjust further →
          </a>
        )}
      </div>

      {(outcome.state === 'confirming' || outcome.state === 'submitting' || outcome.state === 'overlap' || outcome.state === 'error') && (
        <GenerateConfirmModal
          preview={preview}
          outcome={outcome}
          onCancel={() => setOutcome({ state: 'idle' })}
          onConfirm={() => void submit(outcome.state === 'overlap')}
        />
      )}
    </div>
  );
}

function GenerateConfirmModal({ preview, outcome, onCancel, onConfirm }: {
  preview: InvoicePreview;
  outcome: Extract<GenerateOutcome, { state: 'confirming' | 'submitting' | 'overlap' | 'error' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const included = preview.lines.filter(l => l.include);
  const submitting = outcome.state === 'submitting';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={submitting ? undefined : onCancel}>
      <div style={{ background: '#fff', borderRadius: 12, width: 420, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCheck2 size={16} color="#1e3a5f" />
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#12233b', flex: 1 }}>
            {outcome.state === 'overlap' ? 'Period overlap — confirm anyway?' : 'Confirm invoice generation'}
          </div>
          {!submitting && <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={16} /></button>}
        </div>

        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 10 }}>
            This will create a real invoice in QuickBooks for <strong>{preview.companyName}</strong> — FYE {preview.fyeCycle || preview.fyeMonth}.
          </div>

          {outcome.state === 'overlap' && (
            <div style={{ marginBottom: 10, padding: '9px 11px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11.5, color: '#92400e' }}>
              {outcome.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              <div style={{ marginTop: 4, fontWeight: 700 }}>Generate anyway?</div>
            </div>
          )}

          {outcome.state === 'error' && (
            <div style={{ marginBottom: 10, padding: '9px 11px', background: '#fff7f7', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c' }}>
              {outcome.message}
            </div>
          )}

          <div style={{ border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' }}>
            {included.map((line, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 11px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', fontSize: 11.5 }}>
                <span style={{ color: '#475569' }}>{line.service}</span>
                <span style={{ fontWeight: 700, color: '#173b61', fontVariantNumeric: 'tabular-nums' }}>S${(line.qty * line.rate).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #eef2f7' }}>
          <button onClick={onCancel} disabled={submitting} style={{ flex: 1, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={submitting} style={{ flex: 1, border: 'none', background: submitting ? '#94a3b8' : '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 750, cursor: submitting ? 'wait' : 'pointer' }}>
            {submitting ? 'Generating…' : outcome.state === 'overlap' ? 'Confirm anyway' : 'Confirm & Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Late Filing "Mark Resolved" preview + real confirm (2026-09-09) ────────
// Phase 2 of the agentic-chat direction (Vincent: "可以把上面的4项分阶段
// 进行吗？我觉得都需要" — invoicing was phase-implicit, this is next).
// Simpler shape than invoicing (a single PATCH, no idempotency/reservation
// system) but the same principle: a real card, a real popup, the AI never
// touches the write itself — only /api/late-filing's own PATCH, the exact
// same call app/late-filing/page.tsx's own resolve() makes.
type ResolveOutcome =
  | { state: 'idle' }
  | { state: 'confirming' }
  | { state: 'submitting' }
  | { state: 'success' }
  | { state: 'error'; message: string };

function LateFilingResolveCard({ preview, onGenerated }: { preview: LateFilingResolvePreview; onGenerated: (summary: string) => void }) {
  const [outcome, setOutcome] = useState<ResolveOutcome>({ state: 'idle' });

  const submit = async () => {
    setOutcome({ state: 'submitting' });
    try {
      const res = await fetch('/api/late-filing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uen: preview.uen, company_name: preview.companyName, remarks: preview.proposedRemarks }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutcome({ state: 'error', message: json.error || `Request failed (${res.status})` });
        return;
      }
      logActivity('late_filing_resolve', { companyName: preview.companyName });
      setOutcome({ state: 'success' });
      onGenerated(`已将 ${preview.companyName} 标记为 Resolved。`);
    } catch (err) {
      setOutcome({ state: 'error', message: err instanceof Error ? err.message : '网络错误，请重试。' });
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 420 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} color="#b45309" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.companyName}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>UEN {preview.uen || '—'} · FYE {preview.financialYearEnd} {preview.lateFy || ''}</div>
        </div>
        {preview.alreadyResolved && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#15803d', background: '#f0fdf7', border: '1px solid #bae6d3', borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>ALREADY RESOLVED</span>
        )}
      </div>

      <div style={{ padding: '10px 14px', fontSize: 11.5 }}>
        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, marginBottom: 3 }}>CURRENT REMARKS</div>
        <div style={{ color: '#64748b', marginBottom: 8 }}>{preview.currentRemarks || '—'}</div>
        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, marginBottom: 3 }}>WOULD BECOME</div>
        <div style={{ color: '#173b61', fontWeight: 700 }}>{preview.proposedRemarks}</div>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef2f7' }}>
        {outcome.state === 'success' ? (
          <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>✓ Marked Resolved</div>
        ) : (
          <button
            type="button"
            onClick={() => setOutcome({ state: 'confirming' })}
            disabled={preview.alreadyResolved}
            title={preview.alreadyResolved ? 'Already resolved' : undefined}
            style={{
              width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 750,
              cursor: preview.alreadyResolved ? 'not-allowed' : 'pointer',
              background: preview.alreadyResolved ? '#e2e8f0' : '#0f766e',
              color: preview.alreadyResolved ? '#94a3b8' : '#fff',
            }}
          >
            Mark Resolved
          </button>
        )}
        {outcome.state !== 'success' && (
          <a href={lateFilingDeepLink(preview.companyName)} style={deepLinkStyle}>
            Open in Late Filing to review or edit further →
          </a>
        )}
      </div>

      {(outcome.state === 'confirming' || outcome.state === 'submitting' || outcome.state === 'error') && (
        <LateFilingConfirmModal preview={preview} outcome={outcome} onCancel={() => setOutcome({ state: 'idle' })} onConfirm={() => void submit()} />
      )}
    </div>
  );
}

function LateFilingConfirmModal({ preview, outcome, onCancel, onConfirm }: {
  preview: LateFilingResolvePreview;
  outcome: Extract<ResolveOutcome, { state: 'confirming' | 'submitting' | 'error' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const submitting = outcome.state === 'submitting';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={submitting ? undefined : onCancel}>
      <div style={{ background: '#fff', borderRadius: 12, width: 400, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} color="#b45309" />
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#12233b', flex: 1 }}>Confirm mark as resolved</div>
          {!submitting && <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={16} /></button>}
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 10 }}>
            This will update the real Late Filing record for <strong>{preview.companyName}</strong>.
          </div>
          {outcome.state === 'error' && (
            <div style={{ marginBottom: 10, padding: '9px 11px', background: '#fff7f7', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c' }}>
              {outcome.message}
            </div>
          )}
          <div style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: '9px 11px', fontSize: 11.5 }}>
            <span style={{ color: '#475569' }}>Remarks →</span> <strong style={{ color: '#173b61' }}>{preview.proposedRemarks}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #eef2f7' }}>
          <button onClick={onCancel} disabled={submitting} style={{ flex: 1, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={submitting} style={{ flex: 1, border: 'none', background: submitting ? '#94a3b8' : '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 750, cursor: submitting ? 'wait' : 'pointer' }}>
            {submitting ? 'Saving…' : 'Confirm & Mark Resolved'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice edit diff preview + real confirm (2026-09-09) ──────────────────
// Phase 3 of the agentic-chat direction — the hardest of the three built so
// far, since there's no algorithmic pre-fill: the human states the change,
// preview_invoice_edit (lib/invoice-edit-lookup.ts) fetches the real
// current invoice and applies it to a copy. This card just renders that
// diff and, on confirm, calls the exact same /api/quickbooks/update-invoice
// app/billing/page.tsx's own saveInvoiceEdit() uses — same structural/
// sent/payment/void/SyncToken gates, all still enforced server-side.
type EditOutcome =
  | { state: 'idle' }
  | { state: 'confirming' }
  | { state: 'submitting' }
  | { state: 'success'; invoiceNo: string | null; total: number | null }
  | { state: 'error'; message: string };

function InvoiceEditCard({ preview, onGenerated }: { preview: InvoiceEditPreview; onGenerated: (summary: string) => void }) {
  const [outcome, setOutcome] = useState<EditOutcome>({ state: 'idle' });
  const blocked = preview.changesSummary.length === 0;

  const submit = async () => {
    setOutcome({ state: 'submitting' });
    try {
      const res = await fetch('/api/quickbooks/update-invoice', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qbCompany: preview.qbCompany,
          qbInvoiceId: preview.qbInvoiceId,
          pic: preview.pic ?? undefined,
          lines: preview.proposedLines.map(l => ({ service: l.service, productService: l.productService, description: l.description, rate: l.rate, qty: l.qty })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOutcome({ state: 'error', message: json.error || `Request failed (${res.status})` });
        return;
      }
      setOutcome({ state: 'success', invoiceNo: json.invoiceNo ?? null, total: json.total ?? null });
      onGenerated(`已更新 ${preview.companyName} 的 ${preview.qbCompany} 发票 #${json.invoiceNo ?? preview.docNumber} — 总额 S$${(json.total ?? preview.proposedTotal).toLocaleString()}。`);
    } catch (err) {
      setOutcome({ state: 'error', message: err instanceof Error ? err.message : '网络错误，请重试。' });
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 460 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileCheck2 size={14} color="#1e3a5f" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.companyName} — {preview.qbCompany} #{preview.docNumber}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Editing a real, already-generated invoice</div>
        </div>
      </div>

      <div style={{ padding: '10px 14px', fontSize: 11.5 }}>
        {preview.changesSummary.map((s, i) => (
          <div key={i} style={{ color: '#173b61', fontWeight: 700, marginBottom: 4 }}>• {s}</div>
        ))}
        {preview.unmatchedChanges.map((s, i) => (
          <div key={i} style={{ color: '#b45309', marginBottom: 4 }}>⚠ {s}</div>
        ))}
        {preview.changesSummary.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>Total</span>
            <span style={{ fontWeight: 800, color: '#173b61' }}>
              S${preview.currentTotal.toLocaleString()} {preview.currentTotal !== preview.proposedTotal && <>→ S${preview.proposedTotal.toLocaleString()}</>}
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef2f7' }}>
        {outcome.state === 'success' ? (
          <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>✓ Saved{outcome.invoiceNo ? ` — #${outcome.invoiceNo}` : ''}</div>
        ) : (
          <button
            type="button"
            onClick={() => setOutcome({ state: 'confirming' })}
            disabled={blocked}
            title={blocked ? 'No real change to save' : undefined}
            style={{
              width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 750,
              cursor: blocked ? 'not-allowed' : 'pointer',
              background: blocked ? '#e2e8f0' : '#0f766e',
              color: blocked ? '#94a3b8' : '#fff',
            }}
          >
            Save Changes
          </button>
        )}
        {outcome.state !== 'success' && (
          <a href={billingDeepLink(preview.companyName, preview.fyeMonth, preview.fyeCycle)} style={deepLinkStyle}>
            Open in Billing Drafts to review or adjust further →
          </a>
        )}
      </div>

      {(outcome.state === 'confirming' || outcome.state === 'submitting' || outcome.state === 'error') && (
        <InvoiceEditConfirmModal preview={preview} outcome={outcome} onCancel={() => setOutcome({ state: 'idle' })} onConfirm={() => void submit()} />
      )}
    </div>
  );
}

function InvoiceEditConfirmModal({ preview, outcome, onCancel, onConfirm }: {
  preview: InvoiceEditPreview;
  outcome: Extract<EditOutcome, { state: 'confirming' | 'submitting' | 'error' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const submitting = outcome.state === 'submitting';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={submitting ? undefined : onCancel}>
      <div style={{ background: '#fff', borderRadius: 12, width: 420, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCheck2 size={16} color="#1e3a5f" />
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#12233b', flex: 1 }}>Confirm invoice change</div>
          {!submitting && <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={16} /></button>}
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 10 }}>
            This will update the real, already-sent-to-QuickBooks invoice for <strong>{preview.companyName}</strong> ({preview.qbCompany} #{preview.docNumber}).
          </div>
          {outcome.state === 'error' && (
            <div style={{ marginBottom: 10, padding: '9px 11px', background: '#fff7f7', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c' }}>
              {outcome.message}
            </div>
          )}
          <div style={{ border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' }}>
            {preview.changesSummary.map((s, i) => (
              <div key={i} style={{ padding: '7px 11px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', fontSize: 11.5, color: '#173b61', fontWeight: 700 }}>{s}</div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #eef2f7' }}>
          <button onClick={onCancel} disabled={submitting} style={{ flex: 1, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={submitting} style={{ flex: 1, border: 'none', background: submitting ? '#94a3b8' : '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 750, cursor: submitting ? 'wait' : 'pointer' }}>
            {submitting ? 'Saving…' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Phase 4 of the agentic-chat direction — the guided-intake preview
// (preview_post_incorporate in app/api/assistant/route.ts) already carries
// the FULL, validated PostIncorporateInput back out as `preview.input`, so
// this card's confirm step posts it verbatim to the exact same
// /api/post-incorporate/generate the real /post-incorporate page's own
// handleSubmit() calls. Structurally different from the other 3 cards:
// that endpoint returns a binary ZIP (Content-Type: application/zip), not
// JSON, so "success" here means "the browser download actually started" —
// mirrors app/post-incorporate/page.tsx's own blob/createObjectURL flow
// exactly, not a re-invented download path.
type PostIncorporateOutcome =
  | { state: 'idle' }
  | { state: 'confirming' }
  | { state: 'submitting' }
  | { state: 'success'; filename: string }
  | { state: 'error'; message: string };

function PostIncorporateCard({ preview, onGenerated }: { preview: PostIncorporatePreview; onGenerated: (summary: string) => void }) {
  const [outcome, setOutcome] = useState<PostIncorporateOutcome>({ state: 'idle' });

  const submit = async () => {
    setOutcome({ state: 'submitting' });
    try {
      const res = await fetch('/api/post-incorporate/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview.input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        setOutcome({ state: 'error', message: body.error || `Request failed (${res.status})` });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `${preview.company || 'Post-Incorporate'}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOutcome({ state: 'success', filename });
      onGenerated(`已生成并下载 "${filename}"（${preview.company} 的 Post Incorporate 文件）。`);
    } catch (err) {
      setOutcome({ state: 'error', message: err instanceof Error ? err.message : '网络错误，请重试。' });
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 460 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileCheck2 size={14} color="#1e3a5f" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.company} — {preview.uen}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Post Incorporate document set — ready to generate</div>
        </div>
      </div>

      <div style={{ padding: '10px 14px', fontSize: 11.5, color: '#334155', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>{preview.directorsCount} director{preview.directorsCount === 1 ? '' : 's'}</div>
        <div>{preview.shareholdersCount} shareholder{preview.shareholdersCount === 1 ? '' : 's'}</div>
        <div>ND service: {preview.needNdService ? 'Yes' : 'No'}</div>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef2f7' }}>
        {outcome.state === 'success' ? (
          <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>✓ Downloaded — {outcome.filename}</div>
        ) : (
          <button
            type="button"
            onClick={() => setOutcome({ state: 'confirming' })}
            style={{ width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 750, cursor: 'pointer', background: '#0f766e', color: '#fff' }}
          >
            Generate &amp; Download
          </button>
        )}
      </div>

      {(outcome.state === 'confirming' || outcome.state === 'submitting' || outcome.state === 'error') && (
        <PostIncorporateConfirmModal preview={preview} outcome={outcome} onCancel={() => setOutcome({ state: 'idle' })} onConfirm={() => void submit()} />
      )}
    </div>
  );
}

function PostIncorporateConfirmModal({ preview, outcome, onCancel, onConfirm }: {
  preview: PostIncorporatePreview;
  outcome: Extract<PostIncorporateOutcome, { state: 'confirming' | 'submitting' | 'error' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const submitting = outcome.state === 'submitting';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={submitting ? undefined : onCancel}>
      <div style={{ background: '#fff', borderRadius: 12, width: 420, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCheck2 size={16} color="#1e3a5f" />
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#12233b', flex: 1 }}>Confirm document generation</div>
          {!submitting && <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={16} /></button>}
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 10 }}>
            This will generate the real Post Incorporate document set for <strong>{preview.company}</strong> ({preview.uen}) and download it as a .zip to this device.
          </div>
          {outcome.state === 'error' && (
            <div style={{ marginBottom: 10, padding: '9px 11px', background: '#fff7f7', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c' }}>
              {outcome.message}
            </div>
          )}
          <div style={{ border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '7px 11px', fontSize: 11.5, color: '#173b61', fontWeight: 700 }}>{preview.directorsCount} director{preview.directorsCount === 1 ? '' : 's'}</div>
            <div style={{ padding: '7px 11px', borderTop: '1px solid #f1f5f9', fontSize: 11.5, color: '#173b61', fontWeight: 700 }}>{preview.shareholdersCount} shareholder{preview.shareholdersCount === 1 ? '' : 's'}</div>
            <div style={{ padding: '7px 11px', borderTop: '1px solid #f1f5f9', fontSize: 11.5, color: '#173b61', fontWeight: 700 }}>ND service: {preview.needNdService ? 'Yes' : 'No'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #eef2f7' }}>
          <button onClick={onCancel} disabled={submitting} style={{ flex: 1, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={submitting} style={{ flex: 1, border: 'none', background: submitting ? '#94a3b8' : '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 750, cursor: submitting ? 'wait' : 'pointer' }}>
            {submitting ? 'Generating…' : 'Confirm & Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

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

    const next = [...chatMessages, { role: 'user' as const, content }];
    setChatMessages(next);
    setChatInput('');
    setChatBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // viewAs — 2026-09-08, "View As" now covers chat too (see
        // viewAsEmail's own comment above): the assistant resolves and
        // answers/saves as the TARGET account, not the real caller, for
        // the lifetime of this one request.
        body: JSON.stringify({ messages: next, context: { pathname: '/my-tasks', page: 'My Tasks' }, conversationId, viewAs: viewAsEmail || undefined }),
      });
      const json = await res.json();
      setChatMessages(current => [...current, { role: 'assistant', content: json.reply ?? json.error ?? '出错了，请重试。', invoicePreview: json.invoicePreview ?? undefined, lateFilingPreview: json.lateFilingPreview ?? undefined, invoiceEditPreview: json.invoiceEditPreview ?? undefined, postIncorporatePreview: json.postIncorporatePreview ?? undefined }]);
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
                  <picture style={{ display: 'block', width: 160, height: 96, marginBottom: 10, transform: 'translateY(-16px)' }}>
                    <source media="(prefers-reduced-motion: reduce)" srcSet="/my-tasks-robot-still.png" />
                    {/* Loops only while this empty-chat branch is mounted; first submitted message removes it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/my-tasks-robot.gif" alt="" width={160} height={96} style={{ display: 'block', objectFit: 'contain' }} />
                  </picture>
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
                          : message.content}
                      </div>
                    ))}
                    {chatBusy && (
                      <div role="status" aria-label="正在结合系统资料查询…" style={{ alignSelf: 'flex-start', padding: '4px 10px', display: 'flex', alignItems: 'center' }}>
                        <picture>
                          <source media="(prefers-reduced-motion: reduce)" srcSet="/my-tasks-thinking-still.png" />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/my-tasks-thinking.gif" alt="" width={160} height={96} style={{ display: 'block', objectFit: 'contain' }} />
                        </picture>
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
    </div>
  );
}
