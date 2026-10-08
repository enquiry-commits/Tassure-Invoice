'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Receipt, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, X, Download, Send, Mail, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet, Users } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { allStaffNames, staffByTeam } from '@/lib/staff-directory';
import { findUniqueBestMatch, normalize } from '@/lib/company-name';
import { responsiblePeople, isBadDebt } from '@/lib/soa-main-pic';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
import OutlookHelperReadiness from '@/components/client-communications/OutlookHelperReadiness';
import SoaGroupModal from '@/components/billing/SoaGroupModal';
import type { DraftLike } from '@/lib/draft-helper-client';
import { loadSoaActor, downloadSoaPdf, buildSoaDraft, type SoaActor, type SoaSender, type SoaCompanySelector } from '@/lib/soa-actions-client';
import { BillingInvoiceReference } from '@/components/billing/BillingInvoiceReference';
import { SoaDownloadPopover, BOOK_ORDER } from '@/components/billing/SoaDownloadPopover';
import { SoaReminderGroupStatus, SoaReminderStatus } from '@/components/billing/SoaReminderStatus';
import type { QbCompany } from '@/lib/quickbooks';
import type { SoaCompanyRow } from '@/app/api/billing/soa/route';
import type { SoaInvoiceDetail } from '@/app/api/billing/soa/detail/route';

// A row in "All" mode carries which system it's actually from (see
// app/api/billing/soa/all/route.ts) — absent in single-company mode, where
// every row is implicitly the page's own qbCompany prop.
type Row = SoaCompanyRow & { qbCompany?: QbCompany };
type AllCompanyGroup = { key: string; companyName: string; rows: Row[] };
type DisplayEntry =
  | { kind: 'group'; group: AllCompanyGroup; listIndex: number }
  | { kind: 'row'; row: Row; listIndex: number; child: boolean };
import { AGING_BUCKETS, TXN_TYPE_TAGS, type AgingBucket } from '@/lib/soa';

function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Vincent, 2026-09-07: "这些的所有数字前面都不需要 S$" — the list's own aging
// columns (Current/1-30/.../91+/Total) drop the currency prefix; every
// other money figure on this page (the detail modal's header summary and
// its own invoice-breakdown table) keeps fmtMoney() since he pointed at
// the list specifically, not those.
function fmtNum(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// A net balance below zero = the client has paid us MORE than it was billed, so WE owe THEM (Vincent,
// 2026-10-07: "如果客户多付款了，我们也需要知道"). Shown as a red negative; never a collections target.
const isOverpaid = (net: number) => net < 0;
function WeOweBadge({ amount }: { amount: number }) {
  return (
    <span title={`This client has paid S$${fmtNum(-amount)} more than it was billed — we owe it money`}
      style={{ display: 'inline-block', padding: '3px 7px', borderRadius: 6, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      We owe client
    </span>
  );
}
function allCompanyGroupKey(companyName: string) {
  return normalize(companyName) || companyName.trim().toLowerCase();
}

// A single legal company can exist as more than one QuickBooks customer in
// the same book (for example, an old and a current TAB customer record). Once
// both records resolve to the same master company, the All view must still
// present that book as ONE source. Otherwise the UI says "3 sources" and
// renders TAB / TAB / TAO even though there are only two actual books. Keep
// every balance and transaction, but collapse same-book rows into one source
// row before the company group is rendered.
function mergeSameSourceRows(rows: Row[]): Row {
  if (rows.length === 1) return rows[0];
  const mostAdvancedReminder = [...rows].sort((a, b) =>
    (b.reminderProgress.completedStage ?? 0) - (a.reminderProgress.completedStage ?? 0)
      || (b.reminderProgress.completedAt ?? '').localeCompare(a.reminderProgress.completedAt ?? ''))[0];
  const classOwners = [...new Set(rows.map(row => row.classOwner).filter((owner): owner is string => !!owner))];
  const suggestedOwners = [...new Set(rows.map(row => row.suggestedOwner).filter((owner): owner is string => !!owner))];

  return {
    ...rows[0],
    picOptions: [...new Set(rows.flatMap(row => row.picOptions))],
    picShown: [...new Set(rows.flatMap(row => row.picShown))],
    // TAC ND (INV-PIC-010): only when every merged row is ND; they follow the union of TAB's people.
    ndFollowsTab: rows.every(row => row.ndFollowsTab),
    tabPeople: [...new Set(rows.flatMap(row => row.tabPeople))],
    // Bad Debt is the only stored mark still read (INV-PIC-011).
    soaPic: rows.some(isBadDebt) ? 'BD' : null,
    soaPicSource: rows.some(isBadDebt) ? 'person' : null,
    classOwner: classOwners.length === 1 ? classOwners[0] : null,
    suggestedOwner: suggestedOwners.length === 1 ? suggestedOwners[0] : null,
    invoiceCount: rows.reduce((sum, row) => sum + row.invoiceCount, 0),
    totalOutstanding: rows.reduce((sum, row) => sum + row.totalOutstanding, 0),
    aging: {
      current: rows.reduce((sum, row) => sum + row.aging.current, 0),
      d1_30: rows.reduce((sum, row) => sum + row.aging.d1_30, 0),
      d31_60: rows.reduce((sum, row) => sum + row.aging.d31_60, 0),
      d61_90: rows.reduce((sum, row) => sum + row.aging.d61_90, 0),
      d91_plus: rows.reduce((sum, row) => sum + row.aging.d91_plus, 0),
    },
    unpaidInvoices: rows.flatMap(row => row.unpaidInvoices).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    lineItems: rows.flatMap(row => row.lineItems).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    reminderProgress: mostAdvancedReminder.reminderProgress,
    remarks: rows.find(row => row.remarks)?.remarks ?? null,
  };
}
// The metric card's 28px/-0.035em letter-spacing (app/globals.css's
// .metric-card-value) squeezes "S$" straight into the digits with no visual
// separation at that size and weight. A dedicated span with its own spacing
// breaks that up, same "small currency tag beside a big number" convention
// most finance dashboards use (Vincent, 2026-09-06: "货币单位和数字...看起来
// 像堆在一起"). Table-cell-sized money elsewhere on this page keeps plain
// fmtMoney() — only the large metric-card figure needed this.
function MoneyValue({ amount }: { amount: number }) {
  return (
    <span style={{ letterSpacing: 'normal' }}>
      <span style={{ fontSize: '0.55em', fontWeight: 700, marginRight: 5, color: '#64748b', verticalAlign: '2px' }}>S$</span>
      {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Non-person Owner values, always selectable for any company — not real
// staff, so never in lib/staff-directory.ts. "BD" = "Bad Debt" (Vincent,
// 2026-09-17, correcting an earlier wrong assumption in this file that it
// meant "放着先"/hold off for now — it's a real collections designation:
// this balance is written off as uncollectible, not merely unassigned).
// `label` is shown in the dropdown; the stored/matched value stays the bare
// code so existing `soaPic: 'BD'` data keeps working unchanged.
const PLACEHOLDER_OWNER_CODES: { code: string; label: string }[] = [
  { code: 'BD', label: 'Bad Debt' },
];
const PLACEHOLDER_LABEL_BY_CODE = new Map(PLACEHOLDER_OWNER_CODES.map(p => [p.code, p.label]));
// Display label for a dropdown/select value that might be a placeholder code
// (falls back to the value itself for a real staff name) — used wherever a
// placeholder can appear OUTSIDE its own "Other" optgroup, e.g. already
// selected as this row's current value under "Associated with this company".
const ownerOptionLabel = (value: string) => PLACEHOLDER_LABEL_BY_CODE.get(value) ?? value;

// Remarks are free text; the small arrow on the right also offers "Bad Debt" (Vincent, 2026-10-07: "Bad Debt 放在
// Remarks 的下拉选项…如果要选择 Bad Debt 就点击下拉选择"). Bad Debt is the only mark left on a row (INV-PIC-011 — there
// is no Main PIC any more). `badDebtLabel` is null when not marked, else the text of the red tag ("Bad Debt", or
// "Bad Debt (TAB)" when only some sources of the company are). The dropdown is a native <select> laid invisibly over
// the arrow, so its list opens reliably outside the scrolling table.
function SoaRemarksInput({ value, onSave, badDebtLabel, onBadDebtChange }: {
  value: string | null; onSave: (value: string) => Promise<void>;
  badDebtLabel?: string | null; onBadDebtChange?: (bad: boolean) => void;
}) {
  const [val, setVal] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 32)}px`;
  }, []);

  useEffect(() => {
    if (document.activeElement !== textareaRef.current) {
      setVal(value ?? '');
    }
  }, [value]);

  useEffect(() => {
    resizeTextarea();
  }, [val, resizeTextarea]);

  const save = async () => {
    const next = val.trim();
    if (next === (value ?? '').trim()) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      console.error('Failed to save SOA remark:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {badDebtLabel && (
        <div style={{ display: 'inline-block', marginBottom: 3, padding: '1px 7px', borderRadius: 5, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 10, fontWeight: 700 }}>
          {badDebtLabel}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={val}
          rows={1}
          disabled={saving}
          onChange={e => {
            setVal(e.target.value);
            resizeTextarea();
          }}
          onBlur={() => void save()}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setVal(value ?? '');
              e.currentTarget.blur();
            }
          }}
          placeholder="Add remarks…"
          aria-label="SOA remarks"
          className="soa-remarks-input"
          style={onBadDebtChange ? { paddingRight: 26 } : undefined}
        />
        {onBadDebtChange && (
          <>
            <ChevronDown size={13} aria-hidden style={{ position: 'absolute', right: 8, top: 10, color: '#94a3b8', pointerEvents: 'none' }} />
            <select
              aria-label="Mark this balance"
              title="Mark as Bad Debt"
              value={badDebtLabel ? 'BD' : ''}
              onChange={e => onBadDebtChange(e.target.value === 'BD')}
              style={{ position: 'absolute', right: 0, top: 0, width: 26, height: 32, opacity: 0, cursor: 'pointer' }}>
              <option value="">Remarks only</option>
              <option value="BD">Bad Debt</option>
            </select>
          </>
        )}
      </div>
    </div>
  );
}

const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: '#64748b', d1_30: '#0f766e', d31_60: '#ca8a04', d61_90: '#ea580c', d91_plus: 'var(--status-danger)',
};

// Vincent, 2026-09-07: first asked for a distinct color per system on the
// "All" view's Source badge ("这边稍微用不同的颜色区分 TAB/TAC/TAO"), tried
// blue/violet/green — then, after seeing the whole row together: "我加多颜
// 色太多了，全部变成灰色会在深蓝色就好" (too much color now — make it all
// gray, with dark blue [for what matters] is enough). Reverted to a single
// flat gray-bg/navy-text style for every system (inlined at the render
// site below, no per-company lookup needed any more) — same simplification
// applied to the aging-bucket numbers right next to it in the same row
// (see the color/weight/font on AGING_BUCKETS.map below).

// Vincent, 2026-09-07: "把 SOA 放成一个单独的2级标题,然后把 TAB/TAC/TAO分成3
// 个不同的3级标题,数据分开" — this used to be one page pooling TAB+TAC+TAO
// together per customer. Now a single company-scoped view, rendered by 3
// thin page.tsx files (tab/, tac/, tao/) each passing their own qbCompany —
// every fetch below is scoped to that ONE QuickBooks system, so a TAB
// statement never shows a TAC or TAO balance and vice versa.
//
// Vincent, 2026-09-07, added an "All" 4th page above these 3: "在 Outstanding
// -TAB的上面加多一个3级标题（All）,这个All, 就是把 TAB/TAC/TAO的所有总和放
// 进去...举例：TAB/TAO 都有 1V CAPITAL PTE. LTD.，所有就要在ALL 出现2行" —
// qbCompany 'ALL' fetches every row from all 3 systems, UN-deduplicated (a
// company on 2 systems is 2 real rows, each tagged which). "当然在 ALL这边
// 改OWNER，TAO/TAB也会有变化" — an Owner edit here PATCHes the exact same
// soa_owners row (customer name + THAT row's own qbCompany) the individual
// pages read, so it's genuinely the same data, not a copy that needs
// syncing — see rowCompany()/updateSoaPic() below.
// Added 2026-09-17 — Vincent: "SOA的 Drafts Email 和 List 那边的小信封的UI设
// 计都能还原和 Billing Drafts 那边一样，并且点击 SOA Drafts了过后也可以选择
// 发送人和需要的模板". Reuses Billing Drafts' EXACT inline Mail-icon +
// anchored-popover pattern (app/billing/page.tsx's own draftPopoverFor/
// senders/emailTemplates state) rather than a second, differently-styled
// implementation — one shared component used from BOTH the List row's
// inline icon (variant='icon') and the detail modal's own button
// (variant='button', replacing its old one-click-send teal button), so
// there is exactly one popover implementation to keep in sync, not two.
//
// Sending itself is unchanged — this only adds the CHOICE step Billing
// Drafts already had; buildSoaDraft() (lib/soa-actions-client.ts) still
// does the actual PDF-merge + campaign creation, and the parent still owns
// showing OutlookStyleSendModal (same reasoning as Billing Drafts keeping
// that ONE instance at the page's top level, not one per row).

function SoaDraftPopover({
  company, qbCompany, me,
  senders, senderId, setSenderId, templates, selectedTemplateId, setSelectedTemplateId,
  isOpen, onOpenChange, variant, onDrafted,
}: {
  company: Row; qbCompany: SoaCompanySelector; me: SoaActor;
  senders: { id: number; email: string; display_name: string | null; is_default: boolean }[];
  senderId: number | null; setSenderId: (id: number) => void;
  templates: { id: number; name: string; is_default: boolean }[];
  selectedTemplateId: number | null; setSelectedTemplateId: (id: number) => void;
  isOpen: boolean; onOpenChange: (open: boolean) => void;
  variant: 'icon' | 'button';
  onDrafted: (draft: DraftLike, sender: SoaSender) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // 2026-09-23, third attempt at this same bug: opening upward (first
  // attempt) and then raising this popover's own z-index (second attempt)
  // both still got clipped — Vincent, twice more, on rows at different
  // scroll positions: "还是被线挡到" / "被信封挡到". Root cause neither fix
  // touched: this popover was `position: absolute` inside the row, and the
  // row's own card ancestor (`.system-list-shell` in globals.css) has
  // `overflow: hidden` for its rounded corners — CSS clips content past an
  // `overflow: hidden` ancestor's edge regardless of z-index; z-index only
  // orders siblings that are ALREADY visible, it cannot rescue something
  // the ancestor is already cutting off. Same root cause for the 'button'
  // variant inside SoaDetail's modal. Fixed properly this time via a
  // React portal straight to `document.body` — `position: fixed`, sized
  // from the trigger's own getBoundingClientRect(), so this popover is no
  // longer a descendant of ANY overflow:hidden/scrolling ancestor at all.
  //
  // Always opens DOWNWARD — Vincent, immediately after: "为什么Outstanding
  // 的弹窗是往上的，Billing的信封弹窗往下，我要的是全部都是往下的" (why does
  // this one open upward while Billing's own envelope popover opens
  // downward — every one of them should open downward). Billing Drafts'
  // own equivalent popover (app/billing/page.tsx) already opens downward;
  // this matches it rather than picking a direction per available space.
  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  };

  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    // Portaled content no longer moves with the row's own scroll container,
    // so close it on any scroll (this list's, a parent's, or the window's —
    // `capture: true` catches all of them since scroll doesn't bubble)
    // rather than let it drift away from the trigger that opened it.
    const onScroll = () => onOpenChange(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, onOpenChange]);

  const selectedSender = senders.find(s => s.id === senderId) ?? null;

  // The default is company-specific, not one global picker state: once a
  // verified 1st Reminder is sent this row opens on 2nd, then 3rd after the
  // verified 2nd. A manual History-page "Mark as Sent" never changes the
  // server's reminderProgress, so it cannot move this selection forward.
  const toggleOpen = () => {
    if (!isOpen) {
      const wanted = templates.find(t => t.name === company.reminderProgress.nextTemplateName);
      if (wanted && wanted.id !== selectedTemplateId) setSelectedTemplateId(wanted.id);
      updatePosition();
    }
    onOpenChange(!isOpen);
  };

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const d = await buildSoaDraft(company.companyName, qbCompany, me, selectedSender, selectedTemplateId ?? undefined);
      onOpenChange(false);
      onDrafted(d, selectedSender);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
      {variant === 'icon' ? (
        <button ref={triggerRef} title={qbCompany === 'ALL' ? 'Draft Email — all sources' : `Draft Email — ${qbCompany}`} onClick={toggleOpen}
          style={{ border: 'none', background: 'transparent', padding: 4, cursor: 'pointer', display: 'flex', color: isOpen ? '#1d3a5c' : '#94a3b8' }}>
          <Mail size={15} />
        </button>
      ) : (
        <button ref={triggerRef} onClick={toggleOpen} disabled={!company.invoiceCount}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: !company.invoiceCount ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: !company.invoiceCount ? 'default' : 'pointer' }}>
          <Send size={14} />Draft Email
        </button>
      )}
      {isOpen && pos && createPortal(
        <div ref={popoverRef} onClick={e => e.stopPropagation()} style={{
          position: 'fixed', zIndex: 9999, background: '#fff', ...pos,
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 260, padding: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a5f', marginBottom: 8 }}>
            Draft Email — {company.companyName}
            {qbCompany === 'ALL' && <span style={{ color: '#0f766e', fontWeight: 700 }}> (all available sources combined)</span>}
          </div>
          <select value={senderId ?? ''} onChange={e => setSenderId(Number(e.target.value))}
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}>
            {senders.length === 0 && <option value="">No senders found</option>}
            {senders.map(s => <option key={s.id} value={s.id}>{s.display_name ?? s.email}</option>)}
          </select>
          <select value={selectedTemplateId ?? ''} onChange={e => setSelectedTemplateId(Number(e.target.value))}
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}>
            {templates.length === 0 && <option value="">No SOA templates found</option>}
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {error && <div style={{ fontSize: 10, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onOpenChange(false)} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px' }}>Cancel</button>
            <button onClick={draft} disabled={drafting || !selectedTemplateId}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#fff', background: '#397f78', border: 'none', borderRadius: 6, cursor: drafting ? 'wait' : 'pointer', padding: '6px 12px', opacity: (drafting || !selectedTemplateId) ? 0.6 : 1 }}>
              {drafting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
              {drafting ? 'Drafting…' : 'Draft'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Shared by SoaBillingViewInner (List row popovers) and SoaDetail (its own
// Draft Email button popover) — one fetch of each, not two independently
// re-implemented state sets. type=soa (not Billing Drafts' type=ar) is the
// one real difference from that page's own equivalent hook.
function useSoaDraftPickers() {
  const [me, setMe] = useState<SoaActor>(null);
  const [senders, setSenders] = useState<{ id: number; email: string; display_name: string | null; is_default: boolean }[]>([]);
  const [senderId, setSenderId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<{ id: number; name: string; is_default: boolean }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  useEffect(() => {
    void loadSoaActor().then(({ me: m }) => setMe(m));
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setSenders(list);
      setSenderId(prev => prev ?? list.find((s: { is_default: boolean }) => s.is_default)?.id ?? list[0]?.id ?? null);
    }).catch(() => {});
    fetch('/api/client-communications/templates?type=soa').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setTemplates(list);
      setSelectedTemplateId(prev => prev ?? list.find((t: { is_default: boolean }) => t.is_default)?.id ?? list[0]?.id ?? null);
    }).catch(() => {});
  }, []);

  return { me, senders, senderId, setSenderId, templates, selectedTemplateId, setSelectedTemplateId };
}

// "My book" — multi-select, grouped by department (Vincent, 2026-10-04:
// "这个默认是All, 但是我要变成可以多选的, 方便Leader查看部门的人员欠款多少,
// 所以这边的显示可以按部门区分, 然后分别Leader按照部门选择最近的员工"). A
// department's checkbox header selects/clears every one of its listed
// members in one click — the "leader picks her whole department at once"
// half of the request — while each name underneath still toggles alone.
// `options`/`groups` both come from SoaBillingViewInner's own picFilterOptions/
// picFilterGroups (already scoped to names that actually appear in this
// book's live PIC data); this component only renders and toggles selection.
function PicMultiSelect({ options, groups, selected, onChange }: {
  options: string[];
  groups: { team: string; names: string[]; ungrouped?: boolean }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  // Vincent, 2026-10-04: "这个UI设计, 导致被遮盖了, 无法下滑和看完整" — the
  // list was `position: absolute` inside the filter card, so an
  // overflow:hidden ancestor clipped its bottom and the inner scrollbar was
  // unreachable. Same fix as SoaDraftPopover above: portal to document.body,
  // `position: fixed` from the trigger's rect, right-aligned to the trigger
  // (it sits near the page's right edge), and maxHeight capped to the space
  // actually left in the viewport so the inner scroll always works.
  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - rect.right), maxHeight: Math.max(160, window.innerHeight - top - 16) });
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Follow the trigger on page scroll; ignore the list's own inner scroll.
    const onScroll = (e: Event) => { if (!popoverRef.current?.contains(e.target as Node)) updatePosition(); };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const hasBadDebt = options.includes('BD');
  const toggleName = (name: string) =>
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]);
  const toggleGroup = (names: string[]) => {
    const allIn = names.every(n => selected.includes(n));
    onChange(allIn ? selected.filter(n => !names.includes(n)) : [...new Set([...selected, ...names])]);
  };

  const label = selected.length === 0 ? 'Everyone'
    : selected.length <= 2 ? selected.map(n => n === 'BD' ? 'Bad Debt' : n).join(' & ')
    : `${selected.length} selected`;

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button ref={triggerRef} onClick={() => { if (!open) updatePosition(); setOpen(v => !v); }} type="button"
        style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: selected.length ? 700 : 400, background: '#fff', color: selected.length ? '#1e3a5f' : '#334155', cursor: 'pointer' }}>
        {label}<ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>
      {open && pos && createPortal(
        <div ref={popoverRef} style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', width: 260, maxHeight: Math.min(480, pos.maxHeight), overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {groups.length === 0 && !hasBadDebt && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: '#94a3b8' }}>No PIC data yet</div>
          )}
          {groups.map(g => {
            if (g.ungrouped) return (
              <div key={g.team} style={{ borderBottom: '1px solid #f1f5f9', padding: '2px 0' }}>
                {g.names.map(name => (
                  <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleName(name)} />
                    {name}
                  </label>
                ))}
              </div>
            );
            const allIn = g.names.every(n => selected.includes(n));
            return (
              <div key={g.team} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <div onClick={() => toggleGroup(g.names)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#f8fafc', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  <input type="checkbox" checked={allIn} onChange={() => toggleGroup(g.names)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                  {g.team}
                </div>
                {g.names.map(name => (
                  <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px 6px 26px', fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleName(name)} />
                    {name}
                  </label>
                ))}
              </div>
            );
          })}
          {hasBadDebt && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--status-danger)', fontWeight: 600 }}>
              <input type="checkbox" checked={selected.includes('BD')} onChange={() => toggleName('BD')} />
              Bad Debt
            </label>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function SoaBillingViewInner({ qbCompany }: { qbCompany: QbCompany | 'ALL' }) {
  // Deep link from the chat assistant (soaDeepLink(), lib/deep-links.ts) —
  // same openCompany convention and auto-open pattern already used by
  // /billing and /late-filing (Vincent: "当用户点击去开单的时候你应该是带
  // 用户去到开单的接口，并且协助好找到对应的公司和点击好打开了那个发票
  // 编辑的弹窗，不只是带到...接口页面就停了" — the same principle applies
  // here: landing on the general SOA book and stopping isn't enough, the
  // specific company's own detail (with its real Download PDF/Draft Email
  // buttons) should already be open).
  const searchParams = useSearchParams();
  const openCompany = searchParams.get('openCompany');
  const [companies, setCompanies] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [overpaidOnly, setOverpaidOnly] = useState(false); // the Overpaid card: show only clients we owe money
  // Vincent, 2026-10-04, on the single-select "My book" picker: "这个默认是
  // All, 但是我要变成可以多选的, 方便Leader查看部门的人员欠款多少, 所以这边
  // 的显示可以按部门区分, 然后分别Leader按照部门选择最近的员工" — multi-
  // select, grouped by department, so a team leader can pick her whole
  // department at once rather than one person at a time. [] = everyone.
  const [picFilters, setPicFilters] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by rowKey()
  const [detailCompany, setDetailCompany] = useState<Row | null>(null);
  const [detailScope, setDetailScope] = useState<SoaCompanySelector | null>(null);
  // Multi-source companies are open by default. Store only explicit user
  // collapses so every newly loaded group naturally starts expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false); // full 18-sheet workbook, not just this page's own

  // Added 2026-09-17 — the List row's own inline Mail-icon draft popover
  // (see SoaDraftPopover's own header comment). Keyed by rowKey(), same as
  // `expanded`, since a bare companyId isn't unique in "All" mode.
  const draftPickers = useSoaDraftPickers();
  const [draftPopoverFor, setDraftPopoverFor] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false); // the Group SOA email picker
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  const [sendModalSender, setSendModalSender] = useState<SoaSender>(null);

  // Added 2026-09-23 — Vincent: "我希望是连接这 SOA PDF的链接...置入到
  // Source 的列内，点击 TAB就会和点击（Download SOA PDF）的功能一样，并且
  // 当是Total 的那行有显示两个公司，比如 TAB/TAO, 那么当我点击那行的
  // source 就会是下载两个PDF" — each Source badge (TAB/TAC/TAO) on the
  // "All" page becomes its own one-click download for THAT book specifically
  // (not the combined "All" PDF) — a group row showing 2 badges means 2
  // independent click targets, one PDF each, not one click producing both.
  // Reuses downloadSoaPdf() (lib/soa-actions-client.ts) — the same function
  // SoaDetail's own Download button and Company 360's SoaAllDownloadButton
  // already call — no new download mechanism. Keyed by `${rowKey}:${book}`
  // (not just `book`) so two different rows' TAB badges don't share loading
  // state.
  const [downloadingBadges, setDownloadingBadges] = useState<Set<string>>(() => new Set());
  const [badgeDownloadErrors, setBadgeDownloadErrors] = useState<Record<string, string>>({});
  const downloadSourceBadge = async (key: string, companyName: string, book: QbCompany) => {
    setDownloadingBadges(prev => new Set(prev).add(key));
    setBadgeDownloadErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    try {
      await downloadSoaPdf(companyName, book);
    } catch (err) {
      setBadgeDownloadErrors(prev => ({ ...prev, [key]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDownloadingBadges(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  // A row's real qbCompany — its own tag in "All" mode, otherwise this
  // page's fixed one. The `as QbCompany` is safe by construction, never a
  // guess: computeAllSoaRows() (app/api/billing/soa/all/route.ts) always
  // tags every row it returns, so c.qbCompany is only ever undefined when
  // qbCompany itself is a real QbCompany (single-page mode), never 'ALL'.
  const rowCompany = (c: Row): QbCompany => (c.qbCompany ?? qbCompany) as QbCompany;
  // Company name alone isn't a unique row key in "All" mode (the same
  // company can genuinely appear twice, once per system) — every row
  // identity (React key, the expanded-detail lookup) goes through this.
  const rowKey = (c: Row) => `${rowCompany(c)}:${c.companyName}`;
  const openDetail = (c: Row, scope: SoaCompanySelector) => {
    setDetailCompany(c);
    setDetailScope(scope);
    setExpanded(rowKey(c));
  };
  const closeDetail = () => {
    setExpanded(null);
    setDetailCompany(null);
    setDetailScope(null);
  };

  // Same "only try once, once real data has loaded" guard app/late-filing/
  // page.tsx's own openCompany auto-open already uses — companies starts
  // null while loading, and a plain effect keyed on [openCompany, companies]
  // would otherwise keep re-matching (and re-opening after a manual close)
  // every time companies re-fetches on the 30s silent poll above.
  const triedAutoOpen = useRef(false);
  useEffect(() => {
    if (!openCompany || triedAutoOpen.current || !companies?.length) return;
    triedAutoOpen.current = true;
    const match = findUniqueBestMatch(openCompany, companies, c => c.companyName, 70).value;
    if (match) openDetail(match, qbCompany === 'ALL' ? 'ALL' : rowCompany(match));
  }, [openCompany, companies]);

  // Vincent, 2026-09-07: after capping Company Name's width, then
  // reverting that (see git history), he asked "比例是多少?" / "列宽比例"
  // (what's the ratio) — read at the time as an implicit request to fix
  // the still-visible gap, so it got redistributed across Company Name +
  // Owner. Correction: "我没有叫你改啊，我只是问而已，上一版的比例好" (I
  // wasn't asking you to change it, I was just asking — the previous
  // ratio was fine). Reverted that redistribution — back to a single
  // Remarks is a dedicated column before Mail, matching Billing Drafts.
  // Multi-source companies edit the company-level note on the parent summary row,
  // while expanded child rows leave this column clean and blank.
  const soaListColumns = qbCompany === 'ALL'
    ? '32px minmax(210px,1.25fr) 140px 110px 95px 95px 95px 95px 95px 105px 150px 160px 36px'
    : '32px minmax(230px,1.4fr) 140px 95px 95px 95px 95px 95px 105px 150px 160px 36px';
  // Display-only stand-in for qbCompany wherever the literal 'ALL' would
  // otherwise leak into user-facing copy (e.g. "any ALL invoice" reads as
  // a typo, not a scope).
  const scopeLabel = qbCompany === 'ALL' ? 'All' : qbCompany;

  // `silent`: skip the null-out-then-"Loading…" flash — used by the
  // background auto-refresh below, where re-fetching shouldn't visibly
  // reset the table (or collapse an open detail row) every 30s. The
  // manual Refresh button and the initial/company-switch load stay
  // non-silent, since a visible reset there IS the expected feedback.
  const load = (opts?: { silent?: boolean }) => {
    setLoadError(null);
    if (!opts?.silent) setCompanies(null);
    const url = qbCompany === 'ALL' ? '/api/billing/soa/all' : `/api/billing/soa?company=${qbCompany}`;
    fetch(url)
      .then(res => res.json())
      .then(json => {
        if (json.error) { setLoadError(json.error); return; }
        setCompanies(json.companies ?? []);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  };
  // Re-load (not just on mount) when the company changes — the 3 sidebar
  // entries render this same component with a different qbCompany, and
  // Next.js reuses the component instance across sibling routes rather than
  // remounting it, so a plain useEffect(load, []) would keep showing the
  // PREVIOUS company's data after clicking from one tab to another.
  //
  // Vincent, 2026-09-07: "当QUICKBOOK那边更新了...这边的欠款数字会不会更新？
  // 而且最好是实时更新" — the underlying data already updates within
  // seconds of a real QuickBooks change (a live webhook, confirmed against
  // real production events, upserts quickbooks_invoices.balance the moment
  // Intuit notifies us — see app/api/quickbooks/webhook/route.ts). What
  // this page itself lacked was ever re-checking that data on its own — it
  // only fetched once per visit. A 30s silent poll closes that last gap
  // without the disruptive full-page "Loading…" reset a naive re-run of
  // this same effect would cause.
  useEffect(() => {
    load();
    const interval = setInterval(() => load({ silent: true }), 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbCompany]);
  // Also reset picFilters/search/expanded/page-affecting state when switching
  // companies — PICs selected on TAB's book shouldn't silently carry over
  // and mis-scope TAC's list before the user notices.
  useEffect(() => {
    setSearch(''); setOverpaidOnly(false); setPicFilters([]); setExpanded(null); setDetailCompany(null); setDetailScope(null); setCollapsedGroups(new Set());
  }, [qbCompany]);

  // Vincent, 2026-09-07: "不用再靠人工从 Google Sheet 回填" — Chelsea's real
  // rule (Class on the invoice line, Location as fallback — computed
  // server-side into `suggestedOwner`, see lib/soa-owner.ts) now supplies a
  // real default the moment QuickBooks itself carries the signal, no manual
  // pick required first. A confirmed soa_owners pick (soaPic) still wins
  // when one exists — it's a human override, not just a smarter guess.
  const peopleOf = (c: SoaCompanyRow): string[] => responsiblePeople(c); // shared rule, INV-PIC-011

  // Vincent, 2026-09-06: "我选择某个PIC,她就能看到和自己相关的所有欠款公司" —
  // a person's own book is everything where she's the confirmed Owner, the
  // system's own suggested owner, OR she's still listed on the raw PIC field
  // with no owner (confirmed or suggested) at all yet (so she can find and
  // claim her own unassigned companies too). Only offer names that actually
  // show up somewhere in this data — not the full staff directory, most of
  // whom never touch collections.
  const picFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of companies ?? []) {
      for (const p of peopleOf(c)) names.add(p);
      for (const p of c.picShown) names.add(p);
    }
    // Vincent, 2026-09-23: "BD" (Bad Debt — a write-off marker, not a real
    // staff member) needs to sit apart from the alphabetized staff list,
    // always last, rather than wherever "BD" happens to sort to among real
    // names (it landed between Ang Shi Ming and Chee Wei En). The option's
    // own label/color are handled where it renders below — this only
    // controls ordering.
    const hasBadDebt = names.delete('BD');
    const sorted = [...names].sort();
    return hasBadDebt ? [...sorted, 'BD'] : sorted;
  }, [companies]);
  // Groups picFilterOptions by department (lib/staff-directory.ts's `team`,
  // the same field "各部门人员有谁" already reads) so a leader can select her
  // whole department in one click instead of hunting for each name
  // individually. staffByTeam() gives the org's own team order; only names
  // that actually appear in picFilterOptions (i.e. currently show up
  // somewhere in this book's live PIC data) are listed — unchanged from the
  // flat list's own scoping, just regrouped. 'BD' (Bad Debt) is never a real
  // department member, so it's excluded here and rendered as its own pinned
  // row at the bottom of the picker instead.
  //
  // Vincent, 2026-10-04, right after: "Chelsea 和Esther不需要归类部门, 然后
  // corporate 部门不需要分Malaysia的额外显示" — Management members are listed
  // as standalone names (no department header, `ungrouped`), and every
  // "<Team> (Malaysia)" sub-team folds into its parent team here. Picker-only
  // regrouping: staff-directory's own `team` values are left untouched.
  const picFilterGroups = useMemo(() => {
    const optionSet = new Set(picFilterOptions);
    const used = new Set<string>();
    const byTeam = new Map<string, string[]>();
    for (const { team, members } of staffByTeam()) {
      const names = members.map(m => m.name).filter(n => optionSet.has(n));
      if (!names.length) continue;
      const key = team.replace(/\s*\(Malaysia\)$/, '');
      byTeam.set(key, [...(byTeam.get(key) ?? []), ...names]);
      names.forEach(n => used.add(n));
    }
    const groups: { team: string; names: string[]; ungrouped?: boolean }[] =
      [...byTeam].map(([team, names]) => ({ team, names, ungrouped: team === 'Management' }));
    const other = picFilterOptions.filter(n => n !== 'BD' && !used.has(n));
    if (other.length) groups.push({ team: 'Other', names: other });
    return groups;
  }, [picFilterOptions]);
  // Same "BD" -> "Bad Debt" expansion as the picker's own option label,
  // reused everywhere picFilters' raw value would otherwise leak through as
  // the bare "BD" (the KPI cards' "{label}'s book" subtitles below).
  // Multiple selections show the names when there are few, else a count —
  // "3 people's book" reads better in a KPI subtitle than a long name list.
  const picFilterLabel = (() => {
    if (picFilters.length === 0) return '';
    const display = picFilters.map(f => f === 'BD' ? 'Bad Debt' : f);
    return display.length <= 2 ? display.join(' & ') : `${display.length} people`;
  })();

  const picScoped = useMemo(() => {
    // Vincent, 2026-09-16: "这些Total =0的就不需要显示在List了，因为证明了
    // 这家公司目前没有Outstanding，但是这些记录好像会记录，只是不显示罢
    // 了，避免员工混乱" — then extended the same day: "Total = 负数 也不需
    // 要显示出在List 但是要记录，如果有更新不是负数了，下次也能再根据计算
    // 显示出来" — a company whose net is $0 (nothing left to chase) or
    // negative (we owe THEM, not a collections target either) has no place
    // on an operational "who to chase" list. Recomputed fresh from
    // computeSoaRows()'s live result every render (never a stored/cached
    // decision), so a company automatically reappears the moment its real
    // net crosses back above $0 — exactly the "下次也能再根据计算显示出来"
    // behavior asked for, with no extra code needed for it. Filtered here
    // (before KPIs, search, and pagination all read from this same list)
    // so "Clients With a Balance" and the row count never disagree with
    // what's actually shown. Display-only, on top of computeSoaRows()'s
    // complete result — the underlying sync/detail-modal/Company 360 data
    // (and the Excel export's own matching filter) is untouched.
    //
    // Vincent, 2026-09-28, pointing at a real garbage row: a QuickBooks
    // customer literally named "0" (TAB, $4,522) — a manually-entered
    // opening-balance Journal Entry with no real invoice ever billed to it,
    // so computeSuggestedOwner() has no Class/Location signal to work with
    // and nobody has (or realistically could) confirm a Main PIC either —
    // "先把没有PIC的先Hide 起来，不是去掉，而是先不显示，后续可以还是要开放
    // 回去的" (hide rows with no PIC for now — not delete, just don't show;
    // it should still be possible to bring them back later). Same reversible
    // shape as the totalOutstanding filter just above, computed fresh every
    // render off the exact fields the PIC/Main PIC columns already show
    // (never a stored flag) — the moment a company gets a real Class-tagged
    // invoice or someone confirms a Main PIC, it reappears with no extra code
    // needed. Only hides when BOTH columns would show nothing at all
    // (`picOptions.length === 0`, so no suggested candidate either) — a
    // company with unconfirmed-but-suggested PIC candidates still shows,
    // since that's a real, legitimate collections target, just not
    // rubber-stamped yet. Verified against real data before shipping: hides
    // 13 of 399 currently-listed companies across TAB/TAO (0 on TAC) —
    // mostly tiny same-shape Journal-Entry-only balances (as low as $5.50),
    // but 2 are real, non-trivial invoice-based amounts with simply no Class
    // tag (TASSURE ASIA OUTSOURCEZ PTE LTD $16,377.25, WOLVEZ CAPITAL PTE.
    // LTD. $4,450) — see PROJECT_STATUS.md's 2026-09-28 entry for the full
    // list; those may need a Main PIC assigned rather than staying hidden.
    const hasAnyPic = (c: Row) => c.picOptions.length > 0 || peopleOf(c).length > 0;
    // 2026-10-07, Vincent: a NEGATIVE net now shows (red) so overpayments are visible; Total = 0 stays hidden as
    // decided on 2026-09-16. Still recomputed live every render.
    const list = (companies ?? []).filter(c => c.totalOutstanding !== 0 && hasAnyPic(c));
    if (!picFilters.length) return list;
    const selectedSet = new Set(picFilters);
    // EVERYONE the PIC column lists is responsible — picking any one of them shows the company (INV-PIC-011).
    const ownsRow = (c: Row) => {
      const people = peopleOf(c);
      return (people.length ? people : c.picShown).some(p => selectedSet.has(p));
    };
    // Vincent, 2026-09-23, on the "All" view specifically: "当一家公司有好
    // 几个Source, 大家都有责任一起去追这个公司其他Source的欠款" — filtering
    // "My book" to one person must keep that company's WHOLE combined card
    // (every source), not narrow it down to just the one source row she
    // happens to own. Confirmed live: SANEX EASTERN TRADE (TAB/TAC/TAO, 3
    // different owners) collapsed to a single bare TAO row once filtered to
    // its TAO owner — the other 2 sources, which that same person shares
    // responsibility for chasing, silently disappeared. Every OTHER qbCompany
    // tab (TAB/TAC/TAO alone) has no multi-source grouping to begin with —
    // one row already IS one whole company there — so this only changes
    // behavior on 'ALL'; every other tab keeps the original per-row filter.
    if (qbCompany !== 'ALL') return list.filter(ownsRow);
    const matchingKeys = new Set(list.filter(ownsRow).map(c => allCompanyGroupKey(c.companyName)));
    return list.filter(c => matchingKeys.has(allCompanyGroupKey(c.companyName)));
  }, [companies, picFilters, qbCompany]);

  // KPI cards follow the PIC scope (this IS "her own dashboard" once she's
  // picked herself) but not the free-text search box, which stays a
  // find-one-company tool within whatever scope is active.
  const counts = useMemo(() => {
    const list = picScoped;
    // Total Outstanding is the NET: what clients owe minus what they overpaid (Vincent, 2026-10-07).
    const totalOutstanding = list.reduce((s, c) => s + c.totalOutstanding, 0);
    // The aging table's own CURRENT column, summed.
    const current = list.reduce((s, c) => s + c.aging.current, 0);
    if (qbCompany !== 'ALL') {
      const seriouslyOverdue = list.filter(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0).length;
      const owing = list.filter(c => c.totalOutstanding > 0);
      const over = list.filter(c => isOverpaid(c.totalOutstanding));
      return { total: owing.length, totalOutstanding, current, seriouslyOverdue, overpaidCount: over.length, overpaidAmount: over.reduce((s, c) => s - c.totalOutstanding, 0) };
    }
    const groups = new Map<string, Row[]>();
    for (const row of list) {
      const key = allCompanyGroupKey(row.companyName);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const seriouslyOverdue = [...groups.values()].filter(rows => rows.some(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0)).length;
    const nets = [...groups.values()].map(rows => rows.reduce((s, c) => s + c.totalOutstanding, 0));
    return {
      total: nets.filter(n => n > 0).length, totalOutstanding, current, seriouslyOverdue,
      overpaidCount: nets.filter(isOverpaid).length, overpaidAmount: nets.filter(isOverpaid).reduce((s, n) => s - n, 0),
    };
  }, [picScoped, qbCompany]);

  const filtered = useMemo(() => {
    let list = picScoped;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => c.companyName.toLowerCase().includes(q));
    if (overpaidOnly) {
      if (qbCompany === 'ALL') {
        // in All a client is one card across its books — judged by its combined net
        const net = new Map<string, number>();
        for (const c of list) { const k = allCompanyGroupKey(c.companyName); net.set(k, (net.get(k) ?? 0) + c.totalOutstanding); }
        list = list.filter(c => isOverpaid(net.get(allCompanyGroupKey(c.companyName)) ?? 0));
      } else list = list.filter(c => isOverpaid(c.totalOutstanding));
    }
    return list;
  }, [picScoped, search, overpaidOnly, qbCompany]);

  const allGroups: AllCompanyGroup[] = (() => {
    if (qbCompany !== 'ALL') return [];
    const groups = new Map<string, AllCompanyGroup>();
    for (const row of filtered) {
      const key = allCompanyGroupKey(row.companyName);
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else groups.set(key, { key, companyName: row.companyName, rows: [row] });
    }
    return [...groups.values()].map(group => {
      const rowsBySource = new Map<QbCompany, Row[]>();
      for (const row of group.rows) {
        const source = rowCompany(row);
        rowsBySource.set(source, [...(rowsBySource.get(source) ?? []), row]);
      }
      return {
        ...group,
        rows: [...rowsBySource.entries()]
          .sort(([a], [b]) => BOOK_ORDER.indexOf(a) - BOOK_ORDER.indexOf(b))
          .map(([, rows]) => mergeSameSourceRows(rows)),
      };
    });
  })();

  const resetKey = `${qbCompany}::${search}::${picFilters.join(',')}`;
  const rowPages = usePagination(filtered, resetKey);
  const groupPages = usePagination(allGroups, resetKey);
  const activePages = qbCompany === 'ALL' ? groupPages : rowPages;
  const displayEntries: DisplayEntry[] = [];
  if (qbCompany === 'ALL') {
    groupPages.pageItems.forEach((group, i) => {
      displayEntries.push({ kind: 'group', group, listIndex: groupPages.startIndex + i });
    });
  } else {
    rowPages.pageItems.forEach((row, i) => displayEntries.push({ kind: 'row', row, listIndex: rowPages.startIndex + i, child: false }));
  }

  // Vincent, 2026-09-06: "PIC有几个人的情况，所以实际上就要在右边多一列可以
  // 让CHELSEA 下拉选择谁才是这个outstanding的主要负责人" — companies.pic can
  // legitimately list co-assigned people; this is a SEPARATE, manually-set
  // assignment (soa_owners, keyed by customer name + qb_company, not
  // companies.id — see that table's own migration comments). Originally
  // shared globally across TAB/TAC/TAO on the theory that it's "the same
  // real person regardless of which system billed them" — Vincent,
  // 2026-09-07, comparing against his real 3-tab Google Sheet: that
  // assumption was wrong for 13 of 81 real companies that owe on 2+
  // systems, which genuinely have a DIFFERENT confirmed person per tab
  // (e.g. "Meishan Silk Road Trading": TAB tab says Chin Kah Ye, TAO tab
  // says a different person). A pick made here is scoped to THIS page's
  // own qbCompany only. Optimistic update, matching the click-to-edit
  // pattern used elsewhere in this app.
  // Vincent, 2026-09-07, on the new "All" combined view: "当然在 ALL这边改
  // OWNER，TAO/TAB也会有变化" — takes the whole row (not just a name) so it
  // can PATCH the exact real qbCompany that row is from (rowCompany(c)),
  // never the page's own qbCompany (which is the literal 'ALL' here and
  // isn't a real system to scope a soa_owners write to). Matches the
  // optimistic update on BOTH companyName AND rowCompany so editing one
  // system's row never visually bleeds onto a same-named row from another
  // system sitting right next to it in the combined list.
  const updateSoaPic = (row: Row, value: string) => {
    const company = rowCompany(row);
    setCompanies(current => (current ?? []).map(c =>
      // A pick made here is a person's (INV-PIC-009) — without the source the
      // dropdown snapped back to the system's choice until the next reload.
      (c.companyName === row.companyName && rowCompany(c) === company) ? { ...c, soaPic: value || null, soaPicSource: value ? 'person' as const : null } : c));
    fetch('/api/billing/soa', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: row.companyName, soaPic: value || null, company }),
    }).catch(() => {});
  };

  const updateSoaRemarks = async (companyName: string, value: string) => {
    const response = await fetch('/api/billing/soa', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, remarks: value || null }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error ?? 'Unable to save remark.');
    const key = allCompanyGroupKey(companyName);
    setCompanies(current => (current ?? []).map(row =>
      allCompanyGroupKey(row.companyName) === key ? { ...row, remarks: value || null } : row));
  };

  // Vincent, 2026-09-07: "我要可以导出EXCEL，要和GOOGLE SHEET的格式一样" —
  // same blob-download pattern SoaDetail's own downloadPdf() already uses.
  const downloadBlobFrom = async (url: string, fileName: string, onError: (msg: string) => void) => {
    const res = await fetch(url);
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to export.'); }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  };
  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadBlobFrom(`/api/billing/soa/export?company=${qbCompany}`, `${qbCompany} A-R Ageing - ${new Date().toISOString().slice(0, 10)}.xlsx`, setLoadError);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };
  // Vincent, 2026-09-07: "另外要生成一个完整版的EXCEL（和GOOGLE SHEET 那边
  // 的一样的），要有 TAB/TAC/TAO/每个人员的/internal的" — the full 18-sheet
  // workbook (see app/api/billing/soa/export-all/route.ts), offered from
  // every one of the 3 pages since there's no single shared "SOA home" page
  // to put a combined-export-only button on.
  const exportAllExcel = async () => {
    setExportingAll(true);
    try {
      await downloadBlobFrom('/api/billing/soa/export-all', `SOA - Full Workbook - ${new Date().toISOString().slice(0, 10)}.xlsx`, setLoadError);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingAll(false);
    }
  };

  const renderSourceRow = (
    c: Row,
    opts: { child: boolean; lastChild?: boolean; listIndex: number },
  ) => {
    const isOpen = expanded === rowKey(c);
    return (
      <div key={`${opts.child ? 'child:' : ''}${rowKey(c)}`}
        className={`system-list-row${isOpen ? ' system-list-row--selected' : ''}${opts.child ? ' system-list-row--soa-group-child' : ''}${opts.lastChild ? ' system-list-row--soa-group-last-child' : ''}`}
        onClick={() => isOpen ? closeDetail() : openDetail(c, rowCompany(c))}
        style={{ display: 'grid', gridTemplateColumns: soaListColumns, alignItems: 'start', minHeight: 56, columnGap: 10, padding: '11px 14px', cursor: 'pointer' }}>
        <div style={{ color: opts.child ? '#cbd5e1' : '#94a3b8', display: 'flex', paddingLeft: opts.child ? 5 : 0 }}>
          {opts.child ? <span style={{ fontSize: 16 }}>↳</span> : isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <div style={{ padding: '0 6px' }}>
          <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {opts.child
              ? <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>{rowCompany(c)} source balance</span>
              : <><span style={{ color: '#cbd5e1', fontSize: 10 }}>{opts.listIndex + 1}</span>{c.companyName.toUpperCase()}</>}
          </div>
        </div>
        <div style={{ padding: '0 6px', textAlign: 'center' }}>
          {/* Only the company's own (grey) row shows the Reminder; an expanded source row stays blank (Vincent, 2026-10-07). */}
          {opts.child ? null : isOverpaid(c.totalOutstanding) ? <WeOweBadge amount={c.totalOutstanding} /> : <SoaReminderStatus progress={c.reminderProgress} />}
        </div>
        {/* Clickable Source badge downloads that book's own SOA PDF — see
            downloadSourceBadge's own comment above for the full request. */}
        {qbCompany === 'ALL' && (() => {
          const badgeKey = `${rowKey(c)}:${rowCompany(c)}`;
          const isDownloading = downloadingBadges.has(badgeKey);
          const badgeError = badgeDownloadErrors[badgeKey];
          return (
            <div style={{ textAlign: 'center' }}>
              <button title={badgeError ?? `Download ${rowCompany(c)} SOA PDF`}
                onClick={event => { event.stopPropagation(); if (!(isOverpaid(c.totalOutstanding) && !opts.child)) void downloadSourceBadge(badgeKey, c.companyName, rowCompany(c)); }}
                disabled={isDownloading || (isOverpaid(c.totalOutstanding) && !opts.child)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                  padding: '2px 7px', borderRadius: 5, border: 'none', cursor: isDownloading ? 'default' : 'pointer',
                  background: badgeError ? 'var(--status-danger-tint)' : '#eef2f7', color: badgeError ? 'var(--status-danger)' : '#1e3a5f',
                }}>
                {isDownloading ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : rowCompany(c)}
              </button>
            </div>
          );
        })()}
        {AGING_BUCKETS.map(bucket => {
          const items = c.lineItems.filter(item => item.bucket === bucket.key);
          return (
            <div key={bucket.key} style={{ textAlign: 'center', fontSize: 11, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
              {items.length ? items.map((item, index) => {
                const isNegative = item.amount < 0;
                const tag = isNegative ? (TXN_TYPE_TAGS[item.txnType] ?? item.txnType) : null;
                return (
                  <div key={`${item.txnType}-${item.docNumber}-${index}`} title={isNegative ? item.txnType : undefined}
                    style={{ color: isNegative ? 'var(--status-danger)' : '#64748b', cursor: isNegative ? 'help' : undefined }}>
                    {fmtNum(item.amount)}{tag ? ` (${tag})` : ''}
                  </div>
                );
              }) : <span style={{ color: '#cbd5e1' }}>—</span>}
            </div>
          );
        })}
        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 400, fontVariantNumeric: 'tabular-nums', color: c.totalOutstanding < 0 ? 'var(--status-danger)' : '#1e3a5f' }}>{fmtNum(c.totalOutstanding)}</div>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          {/* QuickBooks' own PIC (invoice Classes), else TeamWork's — INV-PIC-008 */}
          {c.picShown.length ? c.picShown.map(name => <div key={name}>{name}</div>) : '—'}
        </div>
        {opts.child ? (
          <div style={{ padding: '0 6px' }} />
        ) : (
          <div style={{ padding: '0 6px' }} onClick={event => event.stopPropagation()}>
            <SoaRemarksInput value={c.remarks} onSave={value => updateSoaRemarks(c.companyName, value)}
              badDebtLabel={isBadDebt(c) ? 'Bad Debt' : null}
              onBadDebtChange={bad => updateSoaPic(c, bad ? 'BD' : '')} />
          </div>
        )}
        {/* Sticky to the scroll container's right edge — same fix and
            reasoning as the group row's own Mail-icon cell above. Applied
            unconditionally (this cell renders for both child and non-child
            rows via renderSourceRow) so the column band stays visually
            consistent as the row scrolls horizontally, even on a child row
            where the popover itself is intentionally omitted below.
            Flat zIndex 1, always below the sticky header's own 2 — the
            conditional 1-while-closed/3-while-open version this briefly
            was is gone now that the popover itself no longer lives inside
            this cell at all (it portals to document.body — see
            SoaDraftPopover's own comment), so this cell never needs to
            out-rank anything again. Vincent, on the leftover 3: "为什么我
            不是说了一级表头和2级表头要放成最高层级吗" (the title bar and
            column header both need to stay the topmost layer) — that 3 was
            dead weight from the old fix, not something still doing any
            work, so removed rather than left "just in case". */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'sticky', right: 0, zIndex: 1, backgroundColor: 'inherit' }}>
          {/* Vincent, 2026-09-23: only the combined/Total row needs its own
              Draft Email icon — a per-source child row (TAB source balance,
              TAO source balance, etc.) drafting separately would split one
              client's reminder into multiple emails, which is never the
              intent (see buildSoaDraft's own combined-total behavior). */}
          {!opts.child && !isOverpaid(c.totalOutstanding) && (
            <SoaDraftPopover
              company={c} qbCompany={rowCompany(c)} me={draftPickers.me}
              senders={draftPickers.senders} senderId={draftPickers.senderId} setSenderId={draftPickers.setSenderId}
              templates={draftPickers.templates} selectedTemplateId={draftPickers.selectedTemplateId} setSelectedTemplateId={draftPickers.setSelectedTemplateId}
              isOpen={draftPopoverFor === rowKey(c)} onOpenChange={open => setDraftPopoverFor(open ? rowKey(c) : null)}
              variant="icon"
              onDrafted={(draft, sender) => { setSendModalDraft(draft); setSendModalSender(sender); }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ paddingTop: 12 }}>
      {/* Vincent, 2026-09-07: exports (green, #397f78) on the left, Refresh
          (dark navy) on the right — matches AR Reminder's own toolbar
          layout. The title+hint that used to live here moved back into the
          list's own dark title bar below (see "SOA — {scopeLabel}..." further
          down) — Vincent: "把SOA — TAB Statement of Account...放回去Company
          Name 上面的深蓝色行". */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: qbCompany === 'ALL' ? 10 : 26 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Vincent, 2026-09-07: "All" has no single real sheet of its own
              to export (it's a combined view over TAB/TAC/TAO, not a 4th
              real system) — only the full workbook makes sense here. */}
          {qbCompany !== 'ALL' && (
            <button onClick={exportExcel} disabled={exporting} title={`Just this ${qbCompany} sheet`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#397f78', color: '#fff', fontSize: 13, cursor: exporting ? 'default' : 'pointer', fontWeight: 600 }}>
              {exporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileSpreadsheet size={14} />}
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          )}
          <button onClick={exportAllExcel} disabled={exportingAll} title="Full workbook — TAB/TAC/TAO + every staff sheet + Internal"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#397f78', color: '#fff', fontSize: 13, cursor: exportingAll ? 'default' : 'pointer', fontWeight: 600 }}>
            {exportingAll ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileSpreadsheet size={14} />}
            {exportingAll ? 'Exporting…' : 'Export Full Workbook'}
          </button>
          {/* Group (Chelsea, 2026-10-07): several companies of one group, one email with all their SOA + invoices. */}
          <button onClick={() => setGroupOpen(true)} title="One email for several companies of the same group — all their SOA and invoices together"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e3a5f', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            <Users size={14} />Group
          </button>
        </div>
        <button onClick={() => load()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e3a5f', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {qbCompany === 'ALL' && (
        <OutlookHelperReadiness context="soa" style={{ marginBottom: 26 }} />
      )}

      {companies !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginBottom: 16 }}>
          <MetricCard value={counts.total} label="Clients With a Balance" sub={picFilters.length ? `${picFilterLabel}'s book` : qbCompany === 'ALL' ? 'across TAB + TAC + TAO' : `any ${qbCompany} invoice still unpaid`}
            icon={<Receipt size={16} />} color="#1d3a5c" active={!overpaidOnly} onClick={() => setOverpaidOnly(false)} ariaLabel="Show all clients with a balance" />
          <MetricCard value={<MoneyValue amount={counts.totalOutstanding} />} label="Total Outstanding" sub="owed minus overpaid (net)"
            icon={<Receipt size={16} />} color="#0f766e" />
          <MetricCard value={<MoneyValue amount={counts.current} />} label="Current" sub="not yet due (the Current column)"
            icon={<Receipt size={16} />} color="#1d3a5c" />
          <MetricCard value={<span style={{ color: counts.overpaidCount ? 'var(--status-danger)' : undefined }}><MoneyValue amount={-counts.overpaidAmount} /></span>}
            label="Overpaid — we owe clients" sub={overpaidOnly ? 'showing only these · click to show all' : `${counts.overpaidCount} client${counts.overpaidCount === 1 ? '' : 's'} · click to list them`}
            icon={<AlertTriangle size={16} />} color="var(--status-danger)" active={overpaidOnly} onClick={() => setOverpaidOnly(v => !v)} ariaLabel="Show only clients who overpaid" />
          <MetricCard value={counts.seriouslyOverdue} label="61+ Days Overdue" sub={picFilters.length ? `${picFilterLabel}'s book` : 'needs a statement sent soon'}
            icon={<AlertTriangle size={16} />} color="var(--status-danger)" />
        </div>
      )}

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search company name…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
          <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>PIC:</span>
          <PicMultiSelect options={picFilterOptions} groups={picFilterGroups} selected={picFilters} onChange={setPicFilters} />
          {picFilters.length > 0 && (
            <button onClick={() => setPicFilters([])} title="Clear filter"
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer', padding: '4px 2px' }}>
              <X size={12} />Clear
            </button>
          )}
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{activePages.total} companies</span>
        </div>
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px' }}>
          <div>
            <span className="system-list-title">SOA — {scopeLabel} Statement of Account</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>
              {qbCompany === 'ALL'
                ? 'Grouped by company — multi-source balances are expanded by default'
                : <>Aged the same way as QuickBooks&apos; own AR Aging report</>}
            </span>
          </div>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 400 }}>
          <div style={{ minWidth: qbCompany === 'ALL' ? 1460 : 1340 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: soaListColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {/* Vincent, 2026-09-15: "Owner...换成类似于Main PIC会不会比较
                  好" — "Owner" read oddly next to the "PIC" column right
                  beside it (PIC = every name associated with this company
                  per its own QuickBooks Class/Location data; this column =
                  the ONE person actually assigned to chase it). "Main PIC"
                  names that relationship directly instead of introducing an
                  unrelated-sounding term. Internal field/variable names
                  (soaPic, suggestedOwner, effectiveOwner, soa_owners table)
                  are unchanged — this is a display-label rename only. */}
              {(qbCompany === 'ALL'
                ? ['', 'Company Name', 'Reminder', 'Source', ...AGING_BUCKETS.map(b => b.label), 'Total', 'PIC', 'Remarks', '']
                : ['', 'Company Name', 'Reminder', ...AGING_BUCKETS.map(b => b.label), 'Total', 'PIC', 'Remarks', '']
              ).map((h, i, all) => {
                const isCenter = h !== '' && h !== 'Company Name' && h !== 'Remarks';
                // Last column (the Mail-icon header slot, always blank) is
                // sticky-right to match the body cells below it — no
                // explicit background needed, .list-column-header-gray > *
                // already sets one on every header cell.
                const isLast = i === all.length - 1;
                return <div key={i} style={{ padding: '0 6px', textAlign: isCenter ? 'center' : 'left', ...(isLast ? { position: 'sticky' as const, right: 0, zIndex: 1 } : {}) }}>{h}</div>;
              })}
            </div>
            {companies === null && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
            {companies !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No outstanding balances — nothing to show.</div>}
            {displayEntries.map(entry => {
              if (entry.kind === 'group') {
                const { group } = entry;
                const groupOpen = group.rows.length > 1 && !collapsedGroups.has(group.key);
                const sources = group.rows.map(row => rowCompany(row));
                const earliestNext = [...group.rows].sort((a, b) => a.reminderProgress.nextStage - b.reminderProgress.nextStage)[0];
                const combined: Row = {
                  ...group.rows[0],
                  companyName: group.companyName,
                  invoiceCount: group.rows.reduce((sum, row) => sum + row.invoiceCount, 0),
                  totalOutstanding: group.rows.reduce((sum, row) => sum + row.totalOutstanding, 0),
                  aging: {
                    current: group.rows.reduce((sum, row) => sum + row.aging.current, 0),
                    d1_30: group.rows.reduce((sum, row) => sum + row.aging.d1_30, 0),
                    d31_60: group.rows.reduce((sum, row) => sum + row.aging.d31_60, 0),
                    d61_90: group.rows.reduce((sum, row) => sum + row.aging.d61_90, 0),
                    d91_plus: group.rows.reduce((sum, row) => sum + row.aging.d91_plus, 0),
                  },
                  lineItems: group.rows.flatMap(row => row.lineItems),
                  picOptions: [...new Set(group.rows.flatMap(row => row.picOptions))],
                  picShown: [...new Set(group.rows.flatMap(row => row.picShown))],
                  reminderProgress: earliestNext.reminderProgress,
                };
                const draftScope: SoaCompanySelector = group.rows.length > 1 ? 'ALL' : rowCompany(group.rows[0]);
                // Why a book's pill is red — the single-row badge always showed
                // it on hover; the grouped one only turned red (2026-10-05).
                const groupBadgeErrors = sources.flatMap(source => {
                  const message = badgeDownloadErrors[`${group.key}:${source}`];
                  return message ? [`${source}: ${message}`] : [];
                });
                const groupDraftKey = `group:${group.key}`;
                const toggleGroup = () => setCollapsedGroups(current => {
                  const next = new Set(current);
                  if (groupOpen) next.add(group.key);
                  else next.delete(group.key);
                  return next;
                });
                return (
                  <div key={groupDraftKey} className={`soa-company-group${groupOpen ? ' soa-company-group--open' : ''}`}>
                    <div className={`system-list-row${groupOpen ? ' system-list-row--soa-group-open' : ''}`} style={{
                      display: 'grid', gridTemplateColumns: soaListColumns, alignItems: 'center', minHeight: 68,
                      columnGap: 10, padding: '11px 14px',
                      borderLeft: `3px solid ${groupOpen ? '#526b85' : '#cbd5e1'}`,
                    }}>
                      <button onClick={() => group.rows.length > 1 ? toggleGroup() : openDetail(combined, draftScope)}
                        className="soa-group-toggle"
                        title={group.rows.length > 1 ? (groupOpen ? 'Hide source rows' : 'Show source rows') : `Open ${sources[0]} SOA detail`}
                        style={{ border: 'none', background: 'none', color: '#64748b', padding: 0, cursor: 'pointer', display: 'flex' }}>
                        {groupOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <div style={{ padding: '0 6px', minWidth: 0 }}>
                        <button onClick={() => openDetail(combined, draftScope)} title={group.rows.length > 1 ? 'Open combined SOA detail' : `Open ${sources[0]} SOA detail`}
                          style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, width: '100%' }}>
                          <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#cbd5e1', fontSize: 10 }}>{entry.listIndex + 1}</span>{group.companyName.toUpperCase()}
                          </div>
                          <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 9 }}>
                            {group.rows.length > 1 ? `${group.rows.length} sources · combined SOA` : `${sources[0]} · click for SOA`}
                          </div>
                        </button>
                      </div>
                      <div style={{ padding: '0 6px', textAlign: 'center' }}>
                        {isOverpaid(combined.totalOutstanding)
                          ? <WeOweBadge amount={combined.totalOutstanding} />
                          : <SoaReminderGroupStatus items={group.rows.map(row => ({ source: rowCompany(row), progress: row.reminderProgress }))} />}
                      </div>
                      {/* ONE click target for the whole badge group, not one
                          button per badge — Vincent, 2026-09-23, after seeing
                          the first version: "这个我看到，还是被当成两个来单
                          独按，我希望是可以变成一个区块，不管我按左按右，只
                          要在这个范围点击就是自动两个PDF一起下载" (still
                          being treated as two separate presses — wants one
                          block where clicking anywhere, left or right,
                          downloads all the books' PDFs together). A single
                          click now fires downloadSourceBadge() once per
                          source in this group (2 separate PDF files, not the
                          existing combined-into-one-PDF 'ALL' option — he
                          asked for "两个PDF一起下载", two PDFs, not one merged
                          one). Each pill still shows its OWN per-book
                          loading/error state (so if TAB succeeds and TAO
                          fails, only the TAO pill turns red) — only the click
                          target and disabled state are now shared. */}
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {/* Real border + a white fill (not the badge blue
                            #dfe7f0 the pills used to have) — 2026-09-23,
                            Vincent: "由于按钮的颜色和行的颜色一样样，所以看
                            不出按钮的轮廓" (the button's color matched the
                            row's own background, so its outline was
                            invisible) once the group row is open, whose
                            background is that exact #dfe7f0. White + a
                            visible border reads as one bounded chip against
                            either row background (open #dfe7f0 or default
                            white), not just against one of them. Individual
                            pill backgrounds removed — per-book state now
                            shows as text color only (red on error), so 2
                            sources reads as one "TAB TAO" chip, not 2
                            differently-colored ones. */}
                        <button
                          title={groupBadgeErrors.length ? `Download failed — ${groupBadgeErrors.join(' | ')}` : sources.length > 1 ? `Download ${sources.join(' + ')} SOA PDFs` : `Download ${sources[0]} SOA PDF`}
                          onClick={event => {
                            event.stopPropagation();
                            if (isOverpaid(combined.totalOutstanding)) return;
                            for (const source of sources) void downloadSourceBadge(`${group.key}:${source}`, group.companyName, source);
                          }}
                          disabled={isOverpaid(combined.totalOutstanding) || sources.some(source => downloadingBadges.has(`${group.key}:${source}`))}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', whiteSpace: 'nowrap',
                            border: '1px solid #b8c7d6', borderRadius: 6, background: '#fff', padding: '3px 8px', cursor: 'pointer',
                          }}>
                          {sources.map(source => {
                            const key = `${group.key}:${source}`;
                            const isDownloading = downloadingBadges.has(key);
                            const badgeError = badgeDownloadErrors[key];
                            return (
                              <span key={source} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', fontSize: 9, fontWeight: 700,
                                color: badgeError ? 'var(--status-danger)' : '#1e3a5f',
                              }}>
                                {isDownloading ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : source}
                              </span>
                            );
                          })}
                        </button>
                      </div>
                      {AGING_BUCKETS.map(bucket => {
                        const value = combined.aging[bucket.key];
                        return <div key={bucket.key} style={{ textAlign: 'center', fontSize: 11, fontVariantNumeric: 'tabular-nums', color: value < 0 ? 'var(--status-danger)' : value ? '#64748b' : '#cbd5e1' }}>{value ? fmtNum(value) : '—'}</div>;
                      })}
                      <div style={{ textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: isOverpaid(combined.totalOutstanding) ? 'var(--status-danger)' : '#1e3a5f' }}>{fmtNum(combined.totalOutstanding)}</div>
                      <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                        {combined.picShown.length ? combined.picShown.map(name => <div key={name}>{name}</div>) : '—'}
                      </div>
                      <div style={{ padding: '0 6px' }} onClick={event => event.stopPropagation()}>
                        {(() => {
                          // The Remarks box is the company's (shared across its books), so the Bad Debt choice applies to
                          // every book of the company; the tag names the books when only some are marked.
                          const marked = group.rows.filter(isBadDebt);
                          const label = !marked.length ? null : marked.length === group.rows.length ? 'Bad Debt' : `Bad Debt (${marked.map(rowCompany).join(' + ')})`;
                          return <SoaRemarksInput value={group.rows[0].remarks} onSave={value => updateSoaRemarks(group.companyName, value)}
                            badDebtLabel={label} onBadDebtChange={bad => group.rows.forEach(r => updateSoaPic(r, bad ? 'BD' : ''))} />;
                        })()}
                      </div>
                      {/* Sticky to the scroll container's right edge — 2026-09-23,
                          Vincent: this is the LAST column of a wide fixed-width
                          grid (soaListColumns), so on a narrower viewport (e.g.
                          the sidebar expanded, eating into content width) it sat
                          past the visible edge, forcing a horizontal scroll (or
                          browser zoom-out, his workaround) just to reach the
                          Draft Email icon. backgroundColor: 'inherit' picks up
                          whatever this row's own background currently is
                          (default/hover/soa-group-open, all set via CSS classes
                          with !important) so the pinned cell never shows a
                          mismatched patch as other columns scroll underneath it.
                          Flat zIndex 1, always below the sticky header's own
                          2 — this briefly rose to 3 while a popover was open
                          (a `position: sticky` cell creates its own stacking
                          context, so at the time the popover living inside
                          it, zIndex 30 on its own, could never out-rank a
                          SIBLING stacking context with a higher zIndex no
                          matter how high its own number was — the sticky
                          header cut across it, confirmed live: "这个肯定是要
                          在最上层的不能被卡片的线条挡到", then the idle icon
                          itself started poking above the header too: "信封的
                          层级也是不能比表头更上层"). Both symptoms are gone
                          now that the popover no longer lives inside this
                          cell at all — it portals to document.body instead
                          (see SoaDraftPopover's own comment) — so the 3 was
                          dead weight kept "just in case"; Vincent caught it:
                          "为什么我不是说了一级表头和2级表头要放成最高层级
                          吗". Removed — this cell never needs to out-rank
                          the header again. */}
                      <div style={{ display: 'flex', justifyContent: 'center', position: 'sticky', right: 0, zIndex: 1, backgroundColor: 'inherit' }}>
                        {!isOverpaid(combined.totalOutstanding) && <SoaDraftPopover
                          company={combined} qbCompany={draftScope} me={draftPickers.me}
                          senders={draftPickers.senders} senderId={draftPickers.senderId} setSenderId={draftPickers.setSenderId}
                          templates={draftPickers.templates} selectedTemplateId={draftPickers.selectedTemplateId} setSelectedTemplateId={draftPickers.setSelectedTemplateId}
                          isOpen={draftPopoverFor === groupDraftKey} onOpenChange={open => setDraftPopoverFor(open ? groupDraftKey : null)}
                          variant="icon" onDrafted={(draft, sender) => { setSendModalDraft(draft); setSendModalSender(sender); }}
                        />}
                      </div>
                    </div>

                    {groupOpen && group.rows.map((row, index) => renderSourceRow(row, {
                      child: true,
                      lastChild: index === group.rows.length - 1,
                      listIndex: entry.listIndex,
                    }))}
                  </div>
                );
              }

              return renderSourceRow(entry.row, { child: false, listIndex: entry.listIndex });
            })}
          </div>
        </div>
      </div>

      {groupOpen && (
        <SoaGroupModal
          me={draftPickers.me}
          sender={draftPickers.senders.find(sd => sd.id === draftPickers.senderId) ?? null}
          onClose={() => setGroupOpen(false)}
          onDrafted={draft => { setSendModalDraft(draft); setSendModalSender(draftPickers.senders.find(sd => sd.id === draftPickers.senderId) ?? null); }}
        />
      )}

      {sendModalDraft && (
        <OutlookStyleSendModal
          draft={sendModalDraft}
          sender={sendModalSender}
          me={draftPickers.me}
          onClose={() => setSendModalDraft(null)}
          onSent={() => { setSendModalDraft(null); load(); }}
        />
      )}

      <PaginationBar page={activePages.page} totalPages={activePages.totalPages} total={activePages.total}
        startIndex={activePages.startIndex} pageCount={activePages.pageItems.length} onPage={activePages.setPage} />

      {expanded !== null && (() => {
        const c = detailCompany ?? (companies ?? []).find(x => rowKey(x) === expanded);
        if (!c) return null;
        const activeDetailScope = detailScope ?? (qbCompany === 'ALL' ? 'ALL' : rowCompany(c));
        return (
          <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 780, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: '4px solid #ea580c', padding: '16px 20px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{c.companyName.toUpperCase()}</div>
                  <button onClick={closeDetail} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#fff' }}>{activeDetailScope} · {c.invoiceCount} unpaid invoice{c.invoiceCount !== 1 ? 's' : ''} · {fmtMoney(c.totalOutstanding)} total</span>
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>Review &amp; generate Statement of Account</span>
                </div>
              </div>
              {/* qbCompany==='ALL' (this page's own combined mode, added
                  2026-09-17 — Vincent: "当我在All 那边点 Draft 是要一起附带
                  上 TAB/TAO/TAC的") now flows straight into SoaDetail, which
                  combines across all 3 books consistently — the invoice
                  LIST, the merged PDF, and the Draft Email body/total all
                  show TAB+TAC+TAO together, not just the Draft action alone. */}
              <SoaDetail company={c} qbCompany={activeDetailScope} onSent={() => { load(); closeDetail(); }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// useSearchParams (added 2026-09-09 for the openCompany deep link above)
// requires a Suspense boundary around it in the app router — same pattern
// app/late-filing/page.tsx and app/billing/page.tsx already use. Wrapped
// here, once, rather than in each of the 4 pages (tab/tac/tao/all) that
// render this component.
export default function SoaBillingView(props: { qbCompany: QbCompany | 'ALL' }) {
  return (
    <Suspense>
      <SoaBillingViewInner {...props} />
    </Suspense>
  );
}

function SoaDetail({ company, qbCompany, onSent }: { company: SoaCompanyRow; qbCompany: SoaCompanySelector; onSent: () => void }) {
  const [invoices, setInvoices] = useState<SoaInvoiceDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  const [sendModalSender, setSendModalSender] = useState<SoaSender>(null);
  // Vincent, 2026-09-17: "Drafts Email...都能还原和 Billing Drafts 那边一
  // 样" — same sender+template picker popover as the List row's own Mail
  // icon (SoaDraftPopover), not the old one-click-send button.
  const draftPickers = useSoaDraftPickers();
  const [draftPopoverOpen, setDraftPopoverOpen] = useState(false);
  const [downloadPopoverOpen, setDownloadPopoverOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/billing/soa/detail?companyName=${encodeURIComponent(company.companyName)}&company=${qbCompany}`)
      .then(res => res.json())
      .then(json => { if (json.error) setLoadError(json.error); else setInvoices(json.invoices ?? []); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [company.companyName, qbCompany]);

  // 'ALL' mode only — which books SoaDownloadPopover below offers. Derived
  // from `invoices` (the same list the table renders, so it's already
  // exactly "books with a real balance" — no separate fetch needed), not
  // from the raw appearance order in that list.
  const booksWithBalance = useMemo(
    () => BOOK_ORDER.filter(b => (invoices ?? []).some(inv => inv.qbCompany === b)),
    [invoices],
  );

  const downloadPdf = async (book: SoaCompanySelector) => {
    setDownloading(true); setResult(null);
    try {
      await downloadSoaPdf(company.companyName, book);
      setResult({
        ok: true,
        msg: book === qbCompany ? `Combined PDF (${company.invoiceCount} invoices) downloaded.` : `${book} PDF downloaded.`,
      });
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ padding: '20px 20px 24px' }}>
      {loadError && <div style={{ padding: 12, borderRadius: 8, background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 90px 100px', gap: 0, background: '#f1f5f9', padding: '10px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          <div>Company</div><div>Invoice</div>
          <div style={{ textAlign: 'center' }}>Txn Date</div>
          <div style={{ textAlign: 'center' }}>Due Date</div>
          <div style={{ textAlign: 'center' }}>Bucket</div>
          <div style={{ textAlign: 'right' }}>Balance</div>
        </div>
        {invoices === null && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
        {/* Vincent, 2026-09-15: "这些单都要是可以点开查看PDF的" — every row
            with a real QuickBooks document (Invoice or Credit Note; both
            have an official /pdf endpoint, see
            app/api/quickbooks/invoice-pdf/route.ts's new docType param)
            opens that document's own PDF in a new tab. Payment/Journal
            Entry/Deposit rows (type 'other') genuinely have no such
            document in QuickBooks — same reasoning as the merged PDF's
            "Other Adjustments" summary page below not trying to fake one —
            so those stay plain, non-clickable text with a title explaining
            why, not a dead/broken link.
            2026-09-16: the clickable chip itself is BillingInvoiceReference
            (shared with Billing Drafts, not a second copy — Vincent: "SOA
            里面的可点击式INVOICE 号码UI格式能不能设计成和 Billing Drafts的
            那个INVOICE 格式那样灰色的"), passed the real internal `id` this
            page already has from the AgedReceivableDetail report so it can
            skip the DocNumber lookup Billing Drafts' own callers need.
            2026-10-07: view="client" — an invoice opens as the CLIENT
            receives it (each service once; the original when attached), the
            same copy the merged statement uses, not QuickBooks' own split
            one (INV-QB-029). Credit notes still open QuickBooks' own PDF. */}
        {invoices !== null && invoices.map(inv => {
          const canOpenPdf = inv.type !== 'other' && !!inv.qbInvoiceId;
          return (
          <div key={`${inv.qbCompany}-${inv.invoiceNo}`}
            style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 90px 100px', gap: 0, alignItems: 'center', padding: '9px 10px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#31506f' }}>{inv.qbCompany}</div>
            <div>
              {canOpenPdf
                ? <BillingInvoiceReference company={inv.qbCompany as QbCompany} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} docType={inv.type === 'credit' ? 'credit' : 'invoice'} view="client"
                    title={inv.type === 'credit' ? `View ${inv.rawType} PDF` : `View ${inv.rawType} PDF — as the client receives it`} />
                : <span title={`No PDF document exists for a ${inv.rawType} in QuickBooks`} style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>#{inv.invoiceNo}</span>}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.txnDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.dueDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: BUCKET_COLOR[inv.bucket] }}>{AGING_BUCKETS.find(b => b.key === inv.bucket)?.label}</div>
            {/* Vincent, 2026-09-15: sign-based (not inv.type === 'credit')
                so any negative row — an unapplied CreditMemo, or (since the
                AgedReceivableDetail report sync, docs/INVARIANTS.md
                INV-QB-017) a Payment/Journal Entry/Deposit/anything else
                QuickBooks itself counts against this balance — reads red
                with a tag automatically, no per-type UI change needed the
                next time a new txn_type shows up in real data. */}
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: inv.balance < 0 ? 'var(--status-danger)' : '#0f766e' }}>
              {fmtMoney(inv.balance)}{inv.balance < 0 ? ` (${TXN_TYPE_TAGS[inv.rawType] ?? inv.rawType})` : ''}
            </div>
          </div>
          );
        })}
      </div>

      {result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
          background: result.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`, color: result.ok ? '#166534' : '#991b1b' }}>
          {result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{result.msg}
        </div>
      )}

      {isOverpaid(company.totalOutstanding) && (
        <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 8, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 12, fontWeight: 700 }}>
          We owe this client S${fmtNum(-company.totalOutstanding)} (it paid more than it was billed) — no collection statement or reminder is offered.
        </div>
      )}
      <div style={{ display: isOverpaid(company.totalOutstanding) ? 'none' : 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {/* 'ALL' mode: a choice (each book with a real balance, plus the
            merged PDF as its own explicit last option) rather than one
            button that always merges — see SoaDownloadPopover's own
            comment. Single-book pages are untouched: same plain button,
            calling the same downloadPdf, just now parametrized. */}
        {qbCompany === 'ALL'
          ? <SoaDownloadPopover books={booksWithBalance} downloading={downloading} openUpward
              isOpen={downloadPopoverOpen} onOpenChange={setDownloadPopoverOpen} onDownload={downloadPdf} />
          : <button onClick={() => downloadPdf(qbCompany)} disabled={downloading || !invoices?.length}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 700, cursor: downloading ? 'default' : 'pointer' }}>
              {downloading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
              {downloading ? 'Merging…' : 'Download SOA PDF'}
            </button>}
        <SoaDraftPopover
          company={company} qbCompany={qbCompany} me={draftPickers.me}
          senders={draftPickers.senders} senderId={draftPickers.senderId} setSenderId={draftPickers.setSenderId}
          templates={draftPickers.templates} selectedTemplateId={draftPickers.selectedTemplateId} setSelectedTemplateId={draftPickers.setSelectedTemplateId}
          isOpen={draftPopoverOpen} onOpenChange={setDraftPopoverOpen}
          variant="button"
          onDrafted={(d, sender) => { setSendModalDraft(d); setSendModalSender(sender); }}
        />
      </div>

      {sendModalDraft && (
        <OutlookStyleSendModal
          draft={sendModalDraft}
          sender={sendModalSender}
          me={draftPickers.me}
          onClose={() => setSendModalDraft(null)}
          onSent={() => { setSendModalDraft(null); onSent(); }}
        />
      )}
    </div>
  );
}
