'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Receipt, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, X, Download, Send, Mail, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { allStaffNames } from '@/lib/staff-directory';
import { findUniqueBestMatch, normalize } from '@/lib/company-name';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
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
function allCompanyGroupKey(companyName: string) {
  return normalize(companyName) || companyName.trim().toLowerCase();
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

function SoaOwnerSelect({ row, onChange }: { row: Row; onChange: (value: string) => void }) {
  const singlePicFallback = row.picOptions.length === 1 ? row.picOptions[0] : null;
  const displayedOwner = row.soaPic ?? row.suggestedOwner ?? singlePicFallback;
  const isConfirmed = !!row.soaPic;
  const likely = displayedOwner && !row.picOptions.includes(displayedOwner)
    ? [displayedOwner, ...row.picOptions] : row.picOptions;
  const likelySet = new Set(likely);
  const everyoneElse = allStaffNames().filter(name => !likelySet.has(name)).sort();
  const placeholders = PLACEHOLDER_OWNER_CODES.filter(item => !likelySet.has(item.code));

  return (
    <select value={displayedOwner ?? ''} onChange={event => onChange(event.target.value)}
      title={!isConfirmed && row.suggestedOwner ? 'Suggested from QuickBooks — not yet confirmed' : undefined}
      style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', fontSize: 11, background: '#fff', color: isConfirmed ? '#1e3a5f' : displayedOwner ? '#0f766e' : '#94a3b8', fontWeight: isConfirmed ? 600 : 400, cursor: 'pointer' }}>
      <option value="">Choose Main PIC…</option>
      {likely.length > 0 ? (
        <>
          <optgroup label="Associated with this company">
            {likely.map(name => <option key={name} value={name}>{ownerOptionLabel(name)}</option>)}
          </optgroup>
          <optgroup label="All staff">
            {everyoneElse.map(name => <option key={name} value={name}>{name}</option>)}
          </optgroup>
        </>
      ) : everyoneElse.map(name => <option key={name} value={name}>{name}</option>)}
      {placeholders.length > 0 && (
        <optgroup label="Other">
          {placeholders.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </optgroup>
      )}
    </select>
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

  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
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
        <button title={qbCompany === 'ALL' ? 'Draft Email — all sources' : `Draft Email — ${qbCompany}`} onClick={toggleOpen}
          style={{ border: 'none', background: 'transparent', padding: 4, cursor: 'pointer', display: 'flex', color: isOpen ? '#1d3a5c' : '#94a3b8' }}>
          <Mail size={15} />
        </button>
      ) : (
        <button onClick={toggleOpen} disabled={!company.invoiceCount}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: !company.invoiceCount ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: !company.invoiceCount ? 'default' : 'pointer' }}>
          <Send size={14} />Draft Email
        </button>
      )}
      {isOpen && (
        <div ref={popoverRef} style={{
          position: 'absolute', right: 0, zIndex: 30, background: '#fff',
          // 2026-09-17 fix: the 'button' variant sits inside SoaDetail's
          // modal, whose outer wrapper has `overflow: hidden` (for the
          // header's rounded-corner gradient) — opening downward like the
          // 'icon' variant does put most of the popover past that wrapper's
          // own bottom edge, clipping it almost entirely (real bug, seen
          // live: only a sliver of "Draft Email — 1V CAPITAL PTE. LTD."
          // was visible). The button always sits at the bottom of that
          // modal, so opening UPWARD keeps the whole popover within the
          // modal's own rendered bounds instead. The 'icon' variant (List
          // row, not inside any overflow:hidden ancestor) keeps opening
          // downward, matching Billing Drafts' own popover exactly.
          ...(variant === 'button' ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 260, padding: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#1e3a5f', marginBottom: 8 }}>
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
          {error && <div style={{ fontSize: 10.5, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onOpenChange(false)} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px' }}>Cancel</button>
            <button onClick={draft} disabled={drafting || !selectedTemplateId}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#fff', background: '#397f78', border: 'none', borderRadius: 6, cursor: drafting ? 'wait' : 'pointer', padding: '6px 12px', opacity: (drafting || !selectedTemplateId) ? 0.6 : 1 }}>
              {drafting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
              {drafting ? 'Drafting…' : 'Draft'}
            </button>
          </div>
        </div>
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
  const [picFilter, setPicFilter] = useState(''); // '' = everyone
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by rowKey()
  const [detailCompany, setDetailCompany] = useState<Row | null>(null);
  const [detailScope, setDetailScope] = useState<SoaCompanySelector | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false); // full 18-sheet workbook, not just this page's own

  // Added 2026-09-17 — the List row's own inline Mail-icon draft popover
  // (see SoaDraftPopover's own header comment). Keyed by rowKey(), same as
  // `expanded`, since a bare companyId isn't unique in "All" mode.
  const draftPickers = useSoaDraftPickers();
  const [draftPopoverFor, setDraftPopoverFor] = useState<string | null>(null);
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  const [sendModalSender, setSendModalSender] = useState<SoaSender>(null);

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
  // flexible share on Company Name alone, Owner a fixed 150px again.
  // Trailing 36px (added 2026-09-17) is the Mail-icon draft popover column —
  // matches Billing Drafts' own row layout, which also ends in a dedicated
  // icon column rather than tucking it into an existing one.
  const soaListColumns = qbCompany === 'ALL'
    ? '32px minmax(200px,1.2fr) 150px 64px 100px 100px 100px 100px 100px 110px 100px 150px 36px'
    : '32px minmax(220px,1.4fr) 150px 100px 100px 100px 100px 100px 110px 100px 150px 36px';
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
  // Also reset picFilter/search/expanded/page-affecting state when switching
  // companies — a PIC selected on TAB's book shouldn't silently carry over
  // and mis-scope TAC's list before the user notices.
  useEffect(() => {
    setSearch(''); setPicFilter(''); setExpanded(null); setDetailCompany(null); setDetailScope(null); setExpandedGroup(null);
  }, [qbCompany]);

  // Vincent, 2026-09-07: "不用再靠人工从 Google Sheet 回填" — Chelsea's real
  // rule (Class on the invoice line, Location as fallback — computed
  // server-side into `suggestedOwner`, see lib/soa-owner.ts) now supplies a
  // real default the moment QuickBooks itself carries the signal, no manual
  // pick required first. A confirmed soa_owners pick (soaPic) still wins
  // when one exists — it's a human override, not just a smarter guess.
  const effectiveOwner = (c: SoaCompanyRow): string | null => c.soaPic ?? c.suggestedOwner;

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
      const owner = effectiveOwner(c);
      if (owner) names.add(owner);
      for (const p of c.picOptions) names.add(p);
    }
    return [...names].sort();
  }, [companies]);

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
    const list = (companies ?? []).filter(c => c.totalOutstanding > 0);
    if (!picFilter) return list;
    return list.filter(c => effectiveOwner(c) === picFilter || (!effectiveOwner(c) && c.picOptions.includes(picFilter)));
  }, [companies, picFilter]);

  // KPI cards follow the PIC scope (this IS "her own dashboard" once she's
  // picked herself) but not the free-text search box, which stays a
  // find-one-company tool within whatever scope is active.
  const counts = useMemo(() => {
    const list = picScoped;
    const totalOutstanding = list.reduce((s, c) => s + c.totalOutstanding, 0);
    if (qbCompany !== 'ALL') {
      const seriouslyOverdue = list.filter(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0).length;
      return { total: list.length, totalOutstanding, seriouslyOverdue };
    }
    const groups = new Map<string, Row[]>();
    for (const row of list) {
      const key = allCompanyGroupKey(row.companyName);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const seriouslyOverdue = [...groups.values()].filter(rows => rows.some(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0)).length;
    return { total: groups.size, totalOutstanding, seriouslyOverdue };
  }, [picScoped, qbCompany]);

  const filtered = useMemo(() => {
    let list = picScoped;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => c.companyName.toLowerCase().includes(q));
    return list;
  }, [picScoped, search]);

  const allGroups: AllCompanyGroup[] = (() => {
    if (qbCompany !== 'ALL') return [];
    const groups = new Map<string, AllCompanyGroup>();
    for (const row of filtered) {
      const key = allCompanyGroupKey(row.companyName);
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else groups.set(key, { key, companyName: row.companyName, rows: [row] });
    }
    return [...groups.values()].map(group => ({
      ...group,
      rows: [...group.rows].sort((a, b) => BOOK_ORDER.indexOf(rowCompany(a)) - BOOK_ORDER.indexOf(rowCompany(b))),
    }));
  })();

  const resetKey = `${qbCompany}::${search}::${picFilter}`;
  const rowPages = usePagination(filtered, resetKey);
  const groupPages = usePagination(allGroups, resetKey);
  const activePages = qbCompany === 'ALL' ? groupPages : rowPages;
  const displayEntries: DisplayEntry[] = [];
  if (qbCompany === 'ALL') {
    groupPages.pageItems.forEach((group, i) => {
      displayEntries.push({ kind: 'group', group, listIndex: groupPages.startIndex + i });
      if (group.rows.length > 1 && expandedGroup === group.key) {
        group.rows.forEach(row => displayEntries.push({ kind: 'row', row, listIndex: groupPages.startIndex + i, child: true }));
      }
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
      (c.companyName === row.companyName && rowCompany(c) === company) ? { ...c, soaPic: value || null } : c));
    fetch('/api/billing/soa', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: row.companyName, soaPic: value || null, company }),
    }).catch(() => {});
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

  return (
    <div style={{ paddingTop: 12 }}>
      {/* Vincent, 2026-09-07: exports (green, #397f78) on the left, Refresh
          (dark navy) on the right — matches AR Reminder's own toolbar
          layout. The title+hint that used to live here moved back into the
          list's own dark title bar below (see "SOA — {scopeLabel}..." further
          down) — Vincent: "把SOA — TAB Statement of Account...放回去Company
          Name 上面的深蓝色行". */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
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
        </div>
        <button onClick={() => load()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e3a5f', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {companies !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard value={counts.total} label="Clients With a Balance" sub={picFilter ? `${picFilter}'s book` : qbCompany === 'ALL' ? 'across TAB + TAC + TAO' : `any ${qbCompany} invoice still unpaid`}
            icon={<Receipt size={16} />} color="#1d3a5c" />
          <MetricCard value={<MoneyValue amount={counts.totalOutstanding} />} label="Total Outstanding" sub={picFilter ? `${picFilter}'s book` : qbCompany === 'ALL' ? 'across TAB + TAC + TAO' : `${qbCompany} invoices only`}
            icon={<Receipt size={16} />} color="#0f766e" />
          <MetricCard value={counts.seriouslyOverdue} label="61+ Days Overdue" sub={picFilter ? `${picFilter}'s book` : 'needs a statement sent soon'}
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
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>My book:</span>
          <select value={picFilter} onChange={e => setPicFilter(e.target.value)}
            style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontWeight: picFilter ? 700 : 400, background: '#fff', color: picFilter ? '#1e3a5f' : '#334155', cursor: 'pointer', outline: 'none' }}>
            <option value="">Everyone</option>
            {picFilterOptions.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          {picFilter && (
            <button onClick={() => setPicFilter('')} title="Clear filter"
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
                ? 'Grouped by company — expand a company to review or send an individual TAB/TAC/TAO source'
                : <>Aged the same way as QuickBooks&apos; own AR Aging report</>}
            </span>
          </div>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 400 }}>
          <div style={{ minWidth: 1090 }}>
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
                ? ['', 'Company Name', 'Reminder', 'Source', ...AGING_BUCKETS.map(b => b.label), 'Total', 'PIC', 'Main PIC', '']
                : ['', 'Company Name', 'Reminder', ...AGING_BUCKETS.map(b => b.label), 'Total', 'PIC', 'Main PIC', '']
              ).map((h, i) => (
                i >= 2 ? <div key={i} style={{ padding: '0 6px', textAlign: 'center' }}>{h}</div> : <div key={i} style={{ padding: '0 6px' }}>{h}</div>
              ))}
            </div>
            {companies === null && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
            {companies !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No outstanding balances — nothing to show.</div>}
            {displayEntries.map(entry => {
              if (entry.kind === 'group') {
                const { group } = entry;
                const groupOpen = expandedGroup === group.key;
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
                  reminderProgress: earliestNext.reminderProgress,
                };
                const owners = [...new Set(group.rows.map(effectiveOwner).filter((owner): owner is string => !!owner))];
                const draftScope: SoaCompanySelector = group.rows.length > 1 ? 'ALL' : rowCompany(group.rows[0]);
                const groupDraftKey = `group:${group.key}`;
                return (
                  <div key={groupDraftKey} className="system-list-row" style={{
                    display: 'grid', gridTemplateColumns: soaListColumns, alignItems: 'center', minHeight: 68,
                    columnGap: 10, padding: '11px 14px', background: '#f8fafc', borderLeft: '3px solid #cbd5e1',
                  }}>
                    <button onClick={() => group.rows.length > 1 ? setExpandedGroup(groupOpen ? null : group.key) : openDetail(combined, draftScope)}
                      title={group.rows.length > 1 ? (groupOpen ? 'Hide source rows' : 'Show source rows') : `Open ${sources[0]} SOA detail`}
                      style={{ border: 'none', background: 'none', color: '#64748b', padding: 0, cursor: 'pointer', display: 'flex' }}>
                      {group.rows.length > 1 && groupOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <button onClick={() => openDetail(combined, draftScope)} title={group.rows.length > 1 ? 'Open combined SOA detail' : `Open ${sources[0]} SOA detail`}
                      style={{ border: 'none', background: 'none', padding: '0 6px', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
                      <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#cbd5e1', fontSize: 10 }}>{entry.listIndex + 1}</span>{group.companyName.toUpperCase()}
                      </div>
                      <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 9.5 }}>
                        {group.rows.length > 1 ? `${group.rows.length} sources · click for combined SOA` : `${sources[0]} · click for SOA`}
                      </div>
                    </button>
                    <div style={{ padding: '0 6px', textAlign: 'center' }}>
                      <SoaReminderGroupStatus items={group.rows.map(row => ({ source: rowCompany(row), progress: row.reminderProgress }))} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {sources.map(source => <span key={source} style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: '#eef2f7', color: '#1e3a5f' }}>{source}</span>)}
                    </div>
                    {AGING_BUCKETS.map(bucket => {
                      const value = combined.aging[bucket.key];
                      return <div key={bucket.key} style={{ textAlign: 'center', fontSize: 11.5, fontFamily: 'Arial, Helvetica, sans-serif', color: value < 0 ? 'var(--status-danger)' : value ? '#64748b' : '#cbd5e1' }}>{value ? fmtNum(value) : '—'}</div>;
                    })}
                    <div style={{ textAlign: 'center', fontSize: 12, fontFamily: 'Arial, Helvetica, sans-serif', color: '#1e3a5f' }}>{fmtNum(combined.totalOutstanding)}</div>
                    <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                      {combined.picOptions.length ? combined.picOptions.map(name => <div key={name}>{name}</div>) : '—'}
                    </div>
                    {group.rows.length === 1 ? (
                      <div onClick={event => event.stopPropagation()} style={{ padding: '0 4px' }}>
                        <SoaOwnerSelect row={group.rows[0]} onChange={value => updateSoaPic(group.rows[0], value)} />
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', fontSize: 10.5, color: owners.length === 1 ? '#1e3a5f' : '#64748b', lineHeight: 1.45 }}>
                        {owners.length === 1 ? ownerOptionLabel(owners[0]) : owners.length > 1 ? 'By source' : '—'}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <SoaDraftPopover
                        company={combined} qbCompany={draftScope} me={draftPickers.me}
                        senders={draftPickers.senders} senderId={draftPickers.senderId} setSenderId={draftPickers.setSenderId}
                        templates={draftPickers.templates} selectedTemplateId={draftPickers.selectedTemplateId} setSelectedTemplateId={draftPickers.setSelectedTemplateId}
                        isOpen={draftPopoverFor === groupDraftKey} onOpenChange={open => setDraftPopoverFor(open ? groupDraftKey : null)}
                        variant="icon" onDrafted={(d, sender) => { setSendModalDraft(d); setSendModalSender(sender); }}
                      />
                    </div>
                  </div>
                );
              }

              const c = entry.row;
              const isOpen = expanded === rowKey(c);
              return (
                <div key={`${entry.child ? 'child:' : ''}${rowKey(c)}`} className={`system-list-row${isOpen ? ' system-list-row--selected' : ''}`}
                  onClick={() => isOpen ? closeDetail() : openDetail(c, rowCompany(c))}
                  style={{ display: 'grid', gridTemplateColumns: soaListColumns, alignItems: 'start', minHeight: 56, columnGap: 10, padding: '11px 14px', cursor: 'pointer', background: entry.child ? '#fff' : undefined }}>
                  <div style={{ color: entry.child ? '#cbd5e1' : '#94a3b8', display: 'flex', paddingLeft: entry.child ? 5 : 0 }}>
                    {entry.child ? <span style={{ fontSize: 15 }}>↳</span> : isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                  <div style={{ padding: '0 6px' }}>
                    {/* Vincent, 2026-09-07: "公司名要统一...都大字母" — some
                        companies (matched via companies.company_name) are
                        already ALL CAPS, others (no companies match — falls
                        back to the raw QuickBooks customer_name) can be
                        mixed case, reading as inconsistent side by side.
                        .toUpperCase() only at display time — the underlying
                        c.companyName stays untouched, since it's also used
                        as an exact lookup key (detail/pdf/campaign-preview
                        fetches). */}
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {entry.child
                        ? <span style={{ color: '#64748b', fontSize: 10.5, fontWeight: 700 }}>{rowCompany(c)} source balance</span>
                        : <><span style={{ color: '#cbd5e1', fontSize: 10 }}>{entry.listIndex + 1}</span>{c.companyName.toUpperCase()}</>}
                    </div>
                  </div>
                  <div style={{ padding: '0 6px', textAlign: 'center' }}>
                    <SoaReminderStatus progress={c.reminderProgress} />
                  </div>
                  {qbCompany === 'ALL' && (
                    // Vincent, 2026-09-07: "company name 右边第2列 要放Source :
                    // TAB or TAC or TAO" — which real system this specific
                    // row's balance/Owner edit actually belongs to.
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '0.02em',
                        padding: '2px 7px', borderRadius: 5, background: '#eef2f7', color: '#1e3a5f',
                      }}>{rowCompany(c)}</span>
                    </div>
                  )}
                  {/* Vincent, 2026-09-07: "我加多颜色太多了，全部变成灰色会
                      在深蓝色就好，并且数字不需要加粗普通的 Arial" — dropped
                      the old per-severity rainbow (BUCKET_COLOR — gray/teal/
                      amber/orange/red by how overdue a bucket is) for one
                      flat gray on every non-empty cell; Total keeps navy
                      (the one deliberate "dark blue" he asked to keep) as
                      the sole accent. No more bold, and an explicit Arial
                      stack instead of the app's default UI font (Segoe UI
                      on his own machine — a different face even though the
                      two look similar). BUCKET_COLOR itself is untouched —
                      still used by the detail modal's own per-invoice
                      bucket badge below, which he hasn't asked to change. */}
                  {/* Vincent, 2026-09-15: "当一个列里面出现多过一个单逾期的
                      时候，这些欠款都应该要出现在List...我一行一个数字" — a
                      bucket cell used to show only its NET value, which goes
                      wrong two ways: (1) an unapplied CreditMemo/Payment/
                      Journal Entry/Deposit netting it negative used to be
                      hidden behind the old `> 0` gate entirely; (2) even
                      after that fix, several real line items that happen to
                      net to exactly the same total (or to $0) still collapse
                      into ONE number or a dash — e.g. ACCADIA MANAGEMENT
                      SERVICES's real 7-line 91+ bucket (1,900 / 1,500 /
                      1,200 / 1,500 / -4,600 (JE) / 1,200 / -2,700 (JE), net
                      exactly $0) showed nothing at all. Now every line item
                      in the bucket renders on its own line — one number per
                      line, oldest-due first (c.lineItems is already sorted
                      that way) — so nothing with real money behind it is
                      ever hidden by netting. Total (below) is still the one
                      place a genuine net makes sense. */}
                  {AGING_BUCKETS.map(b => {
                    const items = c.lineItems.filter(item => item.bucket === b.key);
                    return (
                      <div key={b.key} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 400, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        {items.length ? items.map((item, idx) => {
                          const isNeg = item.amount < 0;
                          const tag = isNeg ? (TXN_TYPE_TAGS[item.txnType] ?? item.txnType) : null;
                          return (
                            <div key={`${item.txnType}-${item.docNumber}-${idx}`} title={isNeg ? item.txnType : undefined} style={{ color: isNeg ? 'var(--status-danger)' : '#64748b', cursor: isNeg ? 'help' : undefined }}>
                              {fmtNum(item.amount)}{tag ? ` (${tag})` : ''}
                            </div>
                          );
                        }) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </div>
                    );
                  })}
                  <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 400, fontFamily: 'Arial, Helvetica, sans-serif', color: c.totalOutstanding < 0 ? 'var(--status-danger)' : '#1e3a5f' }}>{fmtNum(c.totalOutstanding)}</div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                    {c.picOptions.length ? c.picOptions.map(name => <div key={name}>{name}</div>) : '—'}
                  </div>
                  <div onClick={e => e.stopPropagation()} style={{ padding: '0 4px' }}>
                    <SoaOwnerSelect row={c} onChange={value => updateSoaPic(c, value)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SoaDraftPopover
                      company={c} qbCompany={rowCompany(c)} me={draftPickers.me}
                      senders={draftPickers.senders} senderId={draftPickers.senderId} setSenderId={draftPickers.setSenderId}
                      templates={draftPickers.templates} selectedTemplateId={draftPickers.selectedTemplateId} setSelectedTemplateId={draftPickers.setSelectedTemplateId}
                      isOpen={draftPopoverFor === rowKey(c)} onOpenChange={open => setDraftPopoverFor(open ? rowKey(c) : null)}
                      variant="icon"
                      onDrafted={(d, sender) => { setSendModalDraft(d); setSendModalSender(sender); }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{c.companyName.toUpperCase()}</div>
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
            skip the DocNumber lookup Billing Drafts' own callers need. */}
        {invoices !== null && invoices.map(inv => {
          const canOpenPdf = inv.type !== 'other' && !!inv.qbInvoiceId;
          return (
          <div key={`${inv.qbCompany}-${inv.invoiceNo}`}
            style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 90px 100px', gap: 0, alignItems: 'center', padding: '9px 10px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#31506f' }}>{inv.qbCompany}</div>
            <div>
              {canOpenPdf
                ? <BillingInvoiceReference company={inv.qbCompany as QbCompany} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} docType={inv.type === 'credit' ? 'credit' : 'invoice'} title={`View ${inv.rawType} PDF`} />
                : <span title={`No PDF document exists for a ${inv.rawType} in QuickBooks`} style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>#{inv.invoiceNo}</span>}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.txnDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.dueDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[inv.bucket] }}>{AGING_BUCKETS.find(b => b.key === inv.bucket)?.label}</div>
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
