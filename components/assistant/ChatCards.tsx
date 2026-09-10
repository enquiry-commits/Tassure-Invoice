'use client';

// Shared agentic-chat preview cards + attachment UI — extracted 2026-09-09
// from app/my-tasks/page.tsx so the new floating AssistantWidget (Vincent:
// "我希望它的功能和My Tasks这边的功能一样") can render the exact same
// cards instead of a second, divergent copy of logic that touches real
// QuickBooks invoices / Late Filing records / Post Incorporate documents.
// Every line below is a mechanical move (not retyped) — verify with
// `git diff` that app/my-tasks/page.tsx's own rendered behavior is
// unchanged after it switches to importing from here.
import { useState, useRef, useEffect } from 'react';
import { FileCheck2, X, ExternalLink, FileText, AlertTriangle, Download, Send } from 'lucide-react';
import type { InvoicePreview } from '@/lib/billing-lookup';
import type { EditableLine } from '@/lib/billing-draft';
import type { LateFilingResolvePreview } from '@/lib/late-filing-lookup';
import type { InvoiceEditPreview } from '@/lib/invoice-edit-lookup';
import type { PostIncorporatePreview } from '@/lib/docx-post-incorporate';
// type-only (lib/ar-update-lookup.ts is server-only — see INV-DOC-006)
import type { ArUpdatePreview } from '@/lib/ar-update-lookup';
// type-only for the same reason (lib/chat-export.ts is server-only)
import type { ChatExportOffer } from '@/lib/chat-export';
// type-only (lib/outstanding-lookup.ts is server-only — see INV-DOC-006)
import type { SoaPreview } from '@/lib/outstanding-lookup';
import type { DraftLike } from '@/lib/draft-helper-client';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
import { loadSoaActor, downloadSoaPdf, buildSoaDraft, type SoaActor, type SoaSender } from '@/lib/soa-actions-client';
import { billingDeepLink, lateFilingDeepLink, soaDeepLink } from '@/lib/deep-links';
import { logActivity } from '@/lib/activity-client';

// Drag-drop/paste attachments (2026-09-09) — Vincent: "我希望可以优化便
// 利功能就是可以直接拖拽图片或者文件到对话框，或者可以在聊天框复制粘贴
// 图片（作为此次对话的附带参考）". Kept in memory only (never persisted —
// see app/api/assistant/route.ts's persistExchange comment on why), so a
// reopened conversation shows the plain "[附带 N 张图片]" text note but not
// the actual thumbnail; base64 is carried in EVERY subsequent request in
// this same browser session so Claude keeps "seeing" it across follow-up
// turns for as long as messages.slice(-24) still includes that turn.
export type ChatAttachment = { id: string; name: string; mediaType: string; base64: string; kind: 'image' | 'document' };

// The one shared shape both chat surfaces (My Tasks' full page and the
// floating AssistantWidget) render messages as — `content` always stays a
// plain string here (for consistent rendering) even when attachments are
// present; toApiMessage() below turns it back into the content-block array
// /api/assistant actually expects only at request time.
export type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  invoicePreview?: InvoicePreview;
  lateFilingPreview?: LateFilingResolvePreview;
  invoiceEditPreview?: InvoiceEditPreview;
  postIncorporatePreview?: PostIncorporatePreview;
  arUpdatePreview?: ArUpdatePreview;
  exportOffer?: ChatExportOffer;
  soaPreview?: SoaPreview;
};

// Turns a local ChatMsg back into what /api/assistant expects — content
// blocks when there are attachments, a bare string otherwise — for every
// message in the history (not just the newest one), so Claude keeps
// "seeing" an earlier turn's image for as long as the server's own
// messages.slice(-24) window still includes that turn.
export function toApiMessage(m: ChatMsg): { role: 'user' | 'assistant'; content: string | unknown[] } {
  if (m.role !== 'user' || !m.attachments?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: 'text' as const, text: m.content || '（无文字说明，请查看附带的图片/文件）' },
      ...m.attachments.map(a => ({
        type: a.kind,
        source: { type: 'base64' as const, media_type: a.mediaType, data: a.base64 },
      })),
    ],
  };
}

// Rehydrates a saved ai_messages row (see scripts/add-ai-messages-preview-
// data.sql) back into whichever ChatMsg preview field it originally
// carried — shared so both chat surfaces reopen a saved conversation the
// same way. Older rows saved before that migration simply have no
// preview_data, so this falls back to plain text exactly as before.
export function storedMessageToChatMsg(m: { role: 'user' | 'assistant'; content: string; preview_data?: { type: string; data: Record<string, unknown> } | null }): ChatMsg {
  const msg: ChatMsg = { role: m.role, content: m.content };
  const p = m.preview_data;
  if (p?.type === 'invoice_draft') msg.invoicePreview = p.data as unknown as InvoicePreview;
  else if (p?.type === 'late_filing_resolve') msg.lateFilingPreview = p.data as unknown as LateFilingResolvePreview;
  else if (p?.type === 'invoice_edit') msg.invoiceEditPreview = p.data as unknown as InvoiceEditPreview;
  else if (p?.type === 'post_incorporate') msg.postIncorporatePreview = p.data as unknown as PostIncorporatePreview;
  else if (p?.type === 'ar_update') msg.arUpdatePreview = p.data as unknown as ArUpdatePreview;
  return msg;
}

const deepLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%', marginTop: 8, padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid #cbd8e6', background: '#fff',
  fontSize: 12.5, fontWeight: 700, color: '#1d3a5c', textDecoration: 'none',
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

export function InvoiceDraftCard({ preview, onGenerated }: { preview: InvoicePreview; onGenerated: (summary: string) => void }) {
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
            <ExternalLink size={13} /> Open in Billing Drafts
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

export function LateFilingResolveCard({ preview, onGenerated }: { preview: LateFilingResolvePreview; onGenerated: (summary: string) => void }) {
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
            <ExternalLink size={13} /> Open in Late Filing
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

export function InvoiceEditCard({ preview, onGenerated }: { preview: InvoiceEditPreview; onGenerated: (summary: string) => void }) {
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
            <ExternalLink size={13} /> Open in Billing Drafts
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

export function PostIncorporateCard({ preview, onGenerated }: { preview: PostIncorporatePreview; onGenerated: (summary: string) => void }) {
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

// Pending-attachment chips shown above the chat input, before sending —
// see the ChatAttachment/pendingAttachments comments in MyTasksPage.
// onView (2026-09-09, Vincent: "假设我要看回去这个附带的图片，我想要点击
// 放大查看是可以的吗？") opens the full-size lightbox for an image, or the
// real file in a new tab for a PDF — same handler AttachmentThumbnails
// uses below, so a pending attachment can be double-checked before sending
// the same way an already-sent one can be reviewed afterward.
export function AttachmentChips({ attachments, onRemove, onView }: { attachments: ChatAttachment[]; onRemove: (id: string) => void; onView: (a: ChatAttachment) => void }) {
  if (!attachments.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
      {attachments.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 4px', borderRadius: 8, border: '1px solid #dbe3ec', background: '#f8fafc' }}>
          {a.kind === 'image'
            ? <img src={`data:${a.mediaType};base64,${a.base64}`} alt={a.name} onClick={() => onView(a)} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 5, display: 'block', cursor: 'zoom-in' }} />
            : <button type="button" onClick={() => onView(a)} title="在新标签页打开" style={{ width: 32, height: 32, borderRadius: 5, background: '#eef2f7', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}><FileText size={15} color="#64748b" /></button>}
          <span style={{ fontSize: 11, color: '#475569', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <button type="button" onClick={() => onRemove(a.id)} style={{ width: 16, height: 16, borderRadius: '50%', border: 'none', background: '#e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Thumbnails on an already-sent user message bubble — same visual language
// as AttachmentChips but without the remove button. Click an image to open
// it full-size in AttachmentLightbox below; click a PDF chip to open the
// real file in a new tab (a PDF can't be "enlarged" the same way an image
// can — the browser's own PDF viewer already does that job).
export function AttachmentThumbnails({ attachments, onView }: { attachments: ChatAttachment[]; onView: (a: ChatAttachment) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {attachments.map(a => (
        a.kind === 'image'
          ? <img key={a.id} src={`data:${a.mediaType};base64,${a.base64}`} alt={a.name} onClick={() => onView(a)} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,0.35)', display: 'block', cursor: 'zoom-in' }} />
          : <button key={a.id} type="button" onClick={() => onView(a)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 6, background: 'rgba(255,255,255,0.15)', fontSize: 11, border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
              <FileText size={13} />{a.name}
            </button>
      ))}
    </div>
  );
}

// Full-size image viewer (2026-09-09) — a real, dedicated "view attachment"
// affordance rather than the thumbnail being the only way to ever see it
// again. Click-outside or the × closes it; PDFs never reach this component
// (they open in a real browser tab instead, see handleViewAttachment).
export function AttachmentLightbox({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
        <img
          src={`data:${attachment.mediaType};base64,${attachment.base64}`}
          alt={attachment.name}
          style={{ display: 'block', maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.45)' }}
        />
        <button
          onClick={onClose}
          title="关闭"
          style={{ position: 'absolute', top: -14, right: -14, width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#fff', color: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── AR Reminder update (preview → confirm → execute) ────────────────────
// The fifth confirm-gated action, added 2026-09-09 per Vincent: "可以真正
// 执行只是每次执行要提前获得用户点击同意才真正执行操作". Same three-step
// shape as the cards above: this only ever SHOWS the change; the real write
// happens after an explicit Confirm click, against the same conflict-safe
// PATCH /api/ar-reminder the AR Reminder page itself uses. `previousValue`
// is sent so a value someone else changed in the meantime is REJECTED (409)
// rather than silently overwritten — that conflict is shown to the user
// instead of being swallowed.
type ArUpdateOutcome =
  | { state: 'idle' }
  | { state: 'confirming' }
  | { state: 'submitting' }
  | { state: 'success' }
  | { state: 'conflict'; currentValue: string | null; updatedByName: string | null }
  | { state: 'error'; message: string };

export function ArUpdateCard({ preview, onGenerated }: { preview: ArUpdatePreview; onGenerated: (summary: string) => void }) {
  const [outcome, setOutcome] = useState<ArUpdateOutcome>({ state: 'idle' });
  const cycle = preview.fyeMonth && preview.fyeYear ? `FYE ${preview.fyeMonth} ${preview.fyeYear}` : '';

  const submit = async () => {
    setOutcome({ state: 'submitting' });
    try {
      const res = await fetch('/api/ar-reminder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: preview.rowId,
          field: preview.field,
          value: preview.newValue,
          previousValue: preview.currentValue,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setOutcome({ state: 'conflict', currentValue: json.currentValue ?? null, updatedByName: json.updatedByName ?? null });
        return;
      }
      if (!res.ok) {
        setOutcome({ state: 'error', message: json.error || `Request failed (${res.status})` });
        return;
      }
      logActivity('ar_update_from_chat', { companyName: preview.companyName, field: preview.field });
      setOutcome({ state: 'success' });
      onGenerated(`已更新 ${preview.companyName}${cycle ? `（${cycle}）` : ''} 的 ${preview.fieldLabel}：${preview.currentValue || '（空）'} → ${preview.newValue || '（空）'}。`);
    } catch (err) {
      setOutcome({ state: 'error', message: err instanceof Error ? err.message : '网络错误，请重试。' });
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 420 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileCheck2 size={14} color="#1d4ed8" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.companyName}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{cycle}{preview.uen ? ` · UEN ${preview.uen}` : ''}</div>
        </div>
        {preview.cycleAlreadyFiled && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#15803d', background: '#f0fdf7', border: '1px solid #bae6d3', borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>FILED</span>
        )}
      </div>

      <div style={{ padding: '10px 14px', fontSize: 11.5 }}>
        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, marginBottom: 3 }}>{preview.fieldLabel.toUpperCase()}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#64748b', textDecoration: preview.alreadyThatValue ? 'none' : 'line-through' }}>{preview.currentValue || '（空）'}</span>
          <span style={{ color: '#cbd5e1' }}>→</span>
          <span style={{ color: '#173b61', fontWeight: 700 }}>{preview.newValue || '（空）'}</span>
        </div>
        {preview.alreadyThatValue && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: '#b45309' }}>已经是这个值了，无需更改。</div>
        )}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef2f7' }}>
        {outcome.state === 'success' ? (
          <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>✓ 已更新</div>
        ) : outcome.state === 'conflict' ? (
          <div style={{ fontSize: 11, color: '#b45309' }}>
            这条记录已被{outcome.updatedByName ? ` ${outcome.updatedByName} ` : '其他人'}改成「{outcome.currentValue || '（空）'}」，没有覆盖。请重新确认后再试。
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOutcome({ state: 'confirming' })}
            disabled={preview.alreadyThatValue}
            style={{
              width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 750,
              cursor: preview.alreadyThatValue ? 'not-allowed' : 'pointer',
              background: preview.alreadyThatValue ? '#e2e8f0' : '#1d4ed8',
              color: preview.alreadyThatValue ? '#94a3b8' : '#fff',
            }}
          >
            更新 {preview.fieldLabel}
          </button>
        )}
      </div>

      {(outcome.state === 'confirming' || outcome.state === 'submitting' || outcome.state === 'error') && (
        <ArUpdateConfirmModal
          preview={preview}
          outcome={outcome}
          onCancel={() => setOutcome({ state: 'idle' })}
          onConfirm={() => void submit()}
        />
      )}
    </div>
  );
}

function ArUpdateConfirmModal({ preview, outcome, onCancel, onConfirm }: {
  preview: ArUpdatePreview;
  outcome: Extract<ArUpdateOutcome, { state: 'confirming' | 'submitting' | 'error' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const busy = outcome.state === 'submitting';
  const cycle = preview.fyeMonth && preview.fyeYear ? `FYE ${preview.fyeMonth} ${preview.fyeYear}` : '';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400, overflow: 'hidden', boxShadow: '0 20px 50px rgba(15,23,42,0.3)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} color="#b45309" />
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#173b61' }}>确认更新 AR Reminder</div>
          <button type="button" onClick={onCancel} disabled={busy} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: '#94a3b8' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '14px 18px', fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
          <div><strong style={{ color: '#173b61' }}>{preview.companyName}</strong>{cycle ? ` · ${cycle}` : ''}</div>
          <div style={{ marginTop: 8 }}>
            {preview.fieldLabel}：<span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>{preview.currentValue || '（空）'}</span>
            {' → '}
            <strong style={{ color: '#173b61' }}>{preview.newValue || '（空）'}</strong>
          </div>
          {preview.cycleAlreadyFiled && (
            <div style={{ marginTop: 8, color: '#b45309' }}>注意：这个周期已经标记为已申报。</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>确认后会真正写入系统，和在 AR Reminder 页面手动修改一样。</div>
          {outcome.state === 'error' && (
            <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 11.5 }}>{outcome.message}</div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ border: '1px solid #dbe3ec', background: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: '#475569', cursor: busy ? 'default' : 'pointer' }}>取消</button>
          <button type="button" onClick={onConfirm} disabled={busy} style={{ border: 'none', background: busy ? '#93b4f5' : '#1d4ed8', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 750, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '更新中…' : '确认更新'}
          </button>
        </div>
      </div>
    </div>
  );
}

// "把名单给我" — the download behind a list answer (2026-09-10).
//
// Vincent's own framing of the gap: chat could finally answer list
// questions, but a person cannot work from "16 家逾期" or from the first 40
// of 419 names in a chat bubble — they need the real list in Excel, which
// meant going to the page and re-applying the filter by hand, i.e. exactly
// the work chat was supposed to remove.
//
// The offer carries only the QUERY (kind + parameters), never rows: the
// click POSTs it to /api/assistant/export, which RE-RUNS the same tested
// lookup server-side and builds the sheet from that. So nothing the model
// wrote can reach the file, and the export is never truncated the way the
// chat reply is. Same discipline as the preview→confirm cards above: the
// user's own click is what produces anything.
//
// Deliberately session-only (not persisted with the conversation): an
// offer reopened days later would silently rebuild against TODAY's data
// under yesterday's headline number, which is worse than asking again.
export function ListExportCard({ offer }: { offer: ChatExportOffer }) {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const download = async () => {
    setState('working');
    try {
      const res = await fetch('/api/assistant/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offer.spec),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(json.error || `下载失败 (${res.status})`);
        setState('error');
        return;
      }
      // Filename comes from the server's Content-Disposition — the same
      // name the equivalent page export would produce, not one guessed here.
      const disposition = res.headers.get('Content-Disposition') || '';
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = named || 'export.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      logActivity('chat_list_export', { kind: offer.spec.kind, count: offer.count });
      setState('idle');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '网络错误，请重试。');
      setState('error');
    }
  };

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, background: '#fff', width: '100%', maxWidth: 420, padding: '10px 12px' }}>
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === 'working'}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, fontWeight: 750,
          background: state === 'working' ? '#f1f5f9' : '#fff', color: '#173b61',
          cursor: state === 'working' ? 'wait' : 'pointer',
        }}
      >
        <Download size={13} />
        {state === 'working' ? '正在生成…' : offer.label}
      </button>
      {state === 'error' && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: '#b91c1c' }}>{message}</div>
      )}
    </div>
  );
}

// Real SOA actions in chat (2026-09-10). Vincent, on the previous SOA
// answer: "还是非常简陋，功能不齐全" — it printed the balance as prose plus
// two markdown links telling him to go to the SOA page and press the
// buttons himself. Since he had already defined the SOA flow as "download
// the PDF, then send it to the client", handing over a link left most of
// the job undone.
//
// This card runs the SOA page's OWN actions (lib/soa-actions-client.ts,
// extracted from that page so there is one implementation, not two):
// Download SOA PDF really downloads the merged statement, and Draft Email
// really builds the campaign draft with that PDF attached and opens the
// same OutlookStyleSendModal the page opens. Sending still happens inside
// that modal, by the user — chat never sends (INV-DATA-033).
export function SoaCard({ preview }: { preview: SoaPreview }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLike | null>(null);
  const [actor, setActor] = useState<{ me: SoaActor; sender: SoaSender } | null>(null);

  useEffect(() => { void loadSoaActor().then(setActor); }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null); setDone(null);
    try { await fn(); } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  };

  const money = (n: number) => `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{ marginTop: 8, border: '1px solid #dbe3ec', borderRadius: 10, overflow: 'hidden', background: '#fff', width: '100%', maxWidth: 460 }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
        <div style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.companyName}</div>
        <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Statement of Account · 欠款合计 {money(preview.totalOutstanding)}</div>
      </div>

      {preview.lines.map(line => (
        <div key={line.qbCompany} style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#0f766e', background: '#f0fdfa', border: '1px solid #ccfbf1', borderRadius: 4, padding: '1px 5px' }}>{line.qbCompany}</span>
            <span style={{ fontSize: 12.5, fontWeight: 750, color: '#173b61' }}>{money(line.totalOutstanding)}</span>
            <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
              {line.invoiceCount} 张未付{line.oldestAgingBucketLabel ? ` · 最老 ${line.oldestAgingBucketLabel}` : ''}{line.owner ? ` · ${line.owner}` : ''}
            </span>
          </div>
          {line.unpaidInvoices.length > 0 && (
            <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 7 }}>
              {line.unpaidInvoices.slice(0, 4).map(i => `#${i.invoiceNo}`).join('、')}
              {line.unpaidInvoices.length > 4 ? ` 等 ${line.unpaidInvoices.length} 张` : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 7 }}>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run(`pdf-${line.qbCompany}`, async () => {
                await downloadSoaPdf(preview.companyName, line.qbCompany);
                logActivity('chat_soa_pdf', { companyName: preview.companyName, qbCompany: line.qbCompany });
                setDone(`${line.qbCompany} 的 SOA PDF 已下载。`);
              })}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                border: '1px solid #cbd5e1', borderRadius: 7, padding: '7px 10px', fontSize: 11, fontWeight: 700,
                background: '#fff', color: '#173b61', cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <Download size={12} />
              {busy === `pdf-${line.qbCompany}` ? '合并中…' : '下载 SOA PDF'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run(`mail-${line.qbCompany}`, async () => {
                const built = await buildSoaDraft(preview.companyName, line.qbCompany, actor?.me ?? null, actor?.sender ?? null);
                logActivity('chat_soa_draft', { companyName: preview.companyName, qbCompany: line.qbCompany });
                setDraft(built);
              })}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                border: 'none', borderRadius: 7, padding: '7px 10px', fontSize: 11, fontWeight: 700,
                background: busy ? '#94a3b8' : '#0f766e', color: '#fff', cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <Send size={12} />
              {busy === `mail-${line.qbCompany}` ? '准备中…' : '起草邮件'}
            </button>
          </div>
        </div>
      ))}

      {(error || done) && (
        <div style={{ padding: '8px 14px', fontSize: 10.5, color: error ? '#b91c1c' : '#15803d', fontWeight: 650 }}>
          {error ?? done}
        </div>
      )}

      {preview.lines.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #eef2f7' }}>
          <a href={soaDeepLink(preview.lines[0].qbCompany, preview.companyName)} style={deepLinkStyle}>
            <ExternalLink size={13} /> Open in SOA
          </a>
        </div>
      )}

      {draft && (
        <OutlookStyleSendModal
          draft={draft}
          sender={actor?.sender ?? null}
          me={actor?.me ?? null}
          onClose={() => setDraft(null)}
          onSent={() => { setDraft(null); setDone('邮件草稿已在 Outlook 中打开。'); }}
        />
      )}
    </div>
  );
}
