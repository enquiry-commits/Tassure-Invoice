'use client';

/**
 * The REAL TAO (ACC) invoice builder — moved here verbatim 2026-09-10 from
 * app/billing/tao/page.tsx, where it was already a module-level component
 * taking only `company` and `onGenerated`, closing over none of that page's
 * state.
 *
 * Same reasoning as components/billing/ExpandedBillingRow.tsx: the chat
 * assistant must open the SAME builder ACC uses, not a chat lookalike of
 * it (Vincent: "现在这些功能都锁死了在各自的功能页内"). TAO billing is
 * MANUAL by design — there is no periodicity model for Accounts/Tax, so
 * nothing can auto-draft it; what chat can usefully do is surface what the
 * company was billed before and then hand over this real builder.
 *
 * Everything below is a mechanical move — verify with `git diff` that the
 * TAO page's own rendered behavior is unchanged. It POSTs real invoices to
 * QuickBooks, so it must never be forked into a second copy.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, X, AlertCircle, Mail, Loader2 } from 'lucide-react';
import { isValidEmail } from '@/lib/campaign-recipients';
import { rollRecurringDescriptionForward } from '@/lib/invoice-period';
import type { TaoCompanyRow } from '@/app/api/billing/tao/route';
import type { TaoServiceHistory, TaoServiceHistoryItem } from '@/app/api/billing/tao/service-history/route';
import { taoDefaultPicName, taoLineNeedsPic, type PicClassOption } from '@/lib/invoice-pic-class';
import { composeTaoStatementMemo } from '@/lib/statement-memo';
import type { TaoServiceCatalog } from '@/lib/tao-services';

// description: the item's own QuickBooks description — a new line starts
// with it, exactly like picking the item in QuickBooks (Vincent, 2026-10-05:
// "照 QuickBooks 原文"; lines used to start with just the item's name).
type CatalogEntry = { label: string; category: string; productService: string; service: string; description: string | null };

// "Custom / Other…" is a UI-only fallback, never a real QuickBooks item —
// kept exactly as it always behaved (lib/qb-invoice-conventions.ts's
// pickItem() still applies for it). Everything else now comes LIVE from
// QuickBooks itself (see fetchTaoCatalog below) instead of a hardcoded
// list — Vincent, relaying his boss: "现在在系统内TAO开单的服务并不齐
// 全", then, once "Add New Service" was proposed: "也要可以直接实时读
// QuickBooks自己的项目清单". A hardcoded list could only ever be as
// complete as whoever last updated the code; this can't go stale, and a
// service added via "Add New Service" below shows up immediately.
// Its own category on purpose: it shared 'Other' with QuickBooks' real Other
// category once the catalog went live (2026-10-04), so choosing it added the
// first real Other item ("ACRA Fees") instead of a custom line.
const CUSTOM_OTHER: CatalogEntry = { label: 'Custom / Other…', category: 'Custom', productService: '', service: 'Accounts', description: null };

// Group heading for items QuickBooks keeps outside its 5 categories.
const GENERAL_LABEL = 'No category';

let catalogCache: CatalogEntry[] | null = null;
let catalogPromise: Promise<CatalogEntry[]> | null = null;
export function invalidateTaoCatalogCache() { catalogCache = null; catalogPromise = null; }
function fetchTaoCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (!catalogPromise) {
    catalogPromise = fetch('/api/billing/tao/services')
      .then(async r => {
        const json = await r.json().catch(() => ({})) as { categories?: TaoServiceCatalog; error?: string };
        if (!r.ok || !json.categories) throw new Error(json.error ?? 'QuickBooks service list could not be loaded.');
        return json.categories;
      })
      .then(categories => {
        const entries: CatalogEntry[] = categories.flatMap(group =>
          group.items.map(item => ({
            label: item.name,
            category: group.category === 'General' ? GENERAL_LABEL : group.category,
            productService: item.fullyQualifiedName,
            // A no-category item (discount, contra, disbursement-like
            // recharges) is not an Accounts/Tax/Secretary service: no PIC
            // required, no renewal logic.
            service: group.category === 'General' ? 'Other' : group.category,
            description: item.description,
          })));
        catalogCache = [...entries, CUSTOM_OTHER];
        return catalogCache;
      })
      // A failure is reported, never cached as "QuickBooks has no services".
      .catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

type Line = {
  key: number;
  label: string;
  productService: string;
  service: string;
  description: string;
  rate: string;
  qty: string;
  // Whether this line counts toward the total and gets submitted — same
  // include/exclude checkbox app/billing/page.tsx's renewal table uses.
  // Vincent, 2026-09-05: unlike TAB/TAC (pre-checked, since a due renewal
  // cycle is a real signal), a TAO history row starts UNCHECKED — "不主动
  // 勾选" — since there's no due-date signal to justify assuming it applies
  // again this time; ACC decides.
  include: boolean;
  // Last real invoice date this exact service was billed, shown for
  // reference only ("目的是为了让用户知道上一次开单是什么时候，这次还要
  // 不要开单") — null for a brand-new line added via "Add line".
  lastBilled: string | null;
  // The line's PIC = its QuickBooks Class, like QuickBooks' own per-line
  // Class column (INV-QB-026). undefined = nobody chose → QuickBooks' own
  // previous setting for this client is restored (taoDefaultPicName);
  // null = no PIC; a string = that Class Id.
  picClassId?: string | null;
};

let lineKeySeq = 0;
function newLine(opt: CatalogEntry): Line {
  return { key: ++lineKeySeq, label: opt.label, productService: opt.productService, service: opt.service, description: opt.description?.trim() || opt.label, rate: '', qty: '1', include: true, lastBilled: null };
}
// A history row's description gets its date/period rolled forward one cycle
// (lib/invoice-period.ts — the same function TAB/TAC's own recurring lines
// use) so e.g. "YA2026" becomes "YA2027" and "Apr 2026 to Jun 2026" becomes
// "Apr 2027 to Jun 2027" — a starting guess ACC can still edit, not an
// automatic due-date decision.
function lineFromHistory(h: TaoServiceHistoryItem, catalog: CatalogEntry[]): Line {
  const opt = h.productService ? catalog.find(x => x.productService === h.productService) : undefined;
  const custom = CUSTOM_OTHER;
  const baseDescription = h.description ?? (opt ? opt.label : (h.productService || custom.label));
  return {
    key: ++lineKeySeq,
    label: opt ? opt.label : (h.productService || custom.label),
    productService: opt ? opt.productService : (h.productService ?? ''),
    service: opt ? opt.service : (h.service || custom.service),
    description: rollRecurringDescriptionForward(baseDescription),
    rate: h.rate != null ? String(h.rate) : '',
    qty: h.qty != null ? String(h.qty) : '1',
    include: false,
    lastBilled: h.lastTxnDate,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
export function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Same local-copy situation as TaoInvoiceRef below — app/billing/page.tsx's
// own AutoTextarea (used for its Description column too) isn't exported.
// Grows to fit its content instead of a fixed-rows box with internal
// scrolling (Vincent, 2026-09-05: "description 太长不要隐藏起来要完全的展示").
function AutoTextarea({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { resize(); }, [value]);
  return (
    <textarea ref={ref} value={value} rows={1}
      onChange={e => { onChange(e.target.value); resize(); }}
      style={{ ...style, overflow: 'hidden', resize: 'none' }} />
  );
}

// TaoInvoiceRef (a local, non-clickable, differently-styled equivalent of
// app/billing/page.tsx's BillingInvoiceReference) was removed 2026-09-28 —
// Vincent: "Last TAO Invoice 的那个UI也是做成按钮的UI设计" (give it the
// same button UI as TAB/TAC Invoice). BillingInvoiceReference's own
// `company` prop was already widened to accept 'TAO' (2026-09-16) but had
// no real caller yet — app/billing/tao/page.tsx now uses it directly
// instead, which also makes this column genuinely clickable (opens the
// real QuickBooks PDF), not just visually matching. See
// displayInvoiceNo()'s own comment (components/billing/
// ExpandedBillingRow.tsx) for the one real gap this surfaced (TAO's own
// "TAO" prefix was never stripped there before).

const SERVICE_CATEGORIES = ['Accounts', 'Tax', 'Disbursement', 'Secretary', 'Other'] as const;

// "Add New Service" — Vincent: "能不能开一个新的收入科目...我觉得最好你先
// 帮我在QB调研好，尽量还原符合QB的情况", then, approving the design:
// "可以开放给全部人，不需要指定的人". Writes a REAL QuickBooks Item (and,
// when asked, a real new Income Account nested under an existing one the
// same way every other TAO service already is — see lib/tao-services.ts's
// own header for the real structure this was verified against). Open to
// any approved account — no extra permission check here beyond being
// logged in, same as the rest of this builder.
function AddServiceModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (entry: CatalogEntry) => void;
}) {
  const [category, setCategory] = useState<typeof SERVICE_CATEGORIES[number]>('Tax');
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [description, setDescription] = useState('');
  const [accountMode, setAccountMode] = useState<'existing' | 'new'>('new');
  const [existingAccountId, setExistingAccountId] = useState('');
  const [newAccountParentId, setNewAccountParentId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null);
  const [suggested, setSuggested] = useState<Partial<Record<string, string>>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A category with one dominant existing parent (Tax, Disbursement,
  // Accounts) defaults to "create a new account under it" — the common,
  // fast path. Secretary/Other have no single real default (verified live:
  // Secretary alone splits across 4 different parents) — force an explicit
  // pick instead of guessing one. Applied from the fetch callback and the
  // category <select>'s own onChange (both real events), never from an
  // effect reacting to state — avoids a setState-in-effect render cascade
  // for something that only ever needs to happen once per real change.
  const applySuggestionFor = (cat: string, suggestedMap: Partial<Record<string, string>>) => {
    const s = suggestedMap[cat];
    if (s) { setAccountMode('new'); setNewAccountParentId(s); } else { setNewAccountParentId(''); }
  };
  useEffect(() => {
    fetch('/api/billing/tao/income-accounts').then(r => r.json())
      .then(json => {
        const suggestedMap = json.suggestedByCategory ?? {};
        setAccounts(json.accounts ?? []);
        setSuggested(suggestedMap);
        applySuggestionFor(category, suggestedMap);
      })
      .catch(() => setAccounts([]));
    // Deliberately once on mount only — `category` below is read fresh via
    // closure for this one initial call; later changes go through the
    // <select>'s own onChange instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = name.trim()
    && (accountMode === 'existing' ? !!existingAccountId : !!newAccountParentId);

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/tao/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, name: name.trim(),
          unitPrice: unitPrice.trim() ? Number(unitPrice) : null,
          description: description.trim() || null,
          incomeAccount: accountMode === 'existing'
            ? { mode: 'existing', accountId: existingAccountId }
            : { mode: 'new', parentAccountId: newAccountParentId, name: newAccountName.trim() || undefined },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not create the service in QuickBooks.');
      const item = json.item as { name: string; fullyQualifiedName: string; description?: string | null };
      onCreated({ label: item.name, category, productService: item.fullyQualifiedName, service: category, description: item.description ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const fieldStyle = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, boxSizing: 'border-box' as const, width: '100%' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Add New Service</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
            {"Creates a real QuickBooks service item (visible on every future invoice, and in QuickBooks' own per-service reports)."}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Category</label>
            <select value={category} onChange={e => { const next = e.target.value as typeof category; setCategory(next); applySuggestionFor(next, suggested); }} style={{ ...fieldStyle, cursor: 'pointer' }}>
              {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Service name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Transfer Pricing Documentation" style={fieldStyle} />

            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Default rate</label>
            <input type="number" min={0} value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="Optional" style={fieldStyle} />

            <label style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional default line description" style={fieldStyle} />
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Income account</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="radio" checked={accountMode === 'new'} onChange={() => setAccountMode('new')} />
                Create a new account for this service, under:
              </label>
              <select value={newAccountParentId} onChange={e => setNewAccountParentId(e.target.value)} disabled={accountMode !== 'new'}
                style={{ ...fieldStyle, marginLeft: 20, width: 'calc(100% - 20px)', cursor: accountMode === 'new' ? 'pointer' : 'default', opacity: accountMode === 'new' ? 1 : 0.5 }}>
                <option value="">{accounts === null ? 'Loading…' : 'Choose a parent account…'}</option>
                {(accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {accountMode === 'new' && (
                <input value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="New account name (defaults to the service name)"
                  style={{ ...fieldStyle, marginLeft: 20, width: 'calc(100% - 20px)' }} />
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
                <input type="radio" checked={accountMode === 'existing'} onChange={() => setAccountMode('existing')} />
                Use an existing account:
              </label>
              <select value={existingAccountId} onChange={e => setExistingAccountId(e.target.value)} disabled={accountMode !== 'existing'}
                style={{ ...fieldStyle, marginLeft: 20, width: 'calc(100% - 20px)', cursor: accountMode === 'existing' ? 'pointer' : 'default', opacity: accountMode === 'existing' ? 1 : 0.5 }}>
                <option value="">{accounts === null ? 'Loading…' : 'Choose an account…'}</option>
                {(accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>
          )}

          <button onClick={submit} disabled={!canSubmit || creating}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', cursor: (!canSubmit || creating) ? 'not-allowed' : 'pointer', background: (!canSubmit || creating) ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            {creating ? 'Creating in QuickBooks…' : 'Create Service'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function TaoInvoiceBuilder({ company, onGenerated }: { company: TaoCompanyRow; onGenerated: () => void }) {
  const [txnDate, setTxnDate] = useState(todayIso());
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [numberConnected, setNumberConnected] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; customerMissing?: boolean } | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const requestKey = useRef(globalThis.crypto.randomUUID());

  const [historyLoading, setHistoryLoading] = useState(true);
  // QuickBooks' own TAO settings, restored from this client's history
  // (Vincent, 2026-10-04: "尽量还原QB本来有的设定"): each line's PIC. The
  // Location is added server-side from the signed-in account
  // (lib/approved-accounts.ts qbLocations.TAO); the Statement memo is
  // written from the lines at Generate (INV-QB-027).
  const [picHistory, setPicHistory] = useState<{ lastClassByProduct: Map<string, string | null>; lastClassByService: Record<string, string> }>({ lastClassByProduct: new Map(), lastClassByService: {} });
  const [picOptions, setPicOptions] = useState<{ status: 'loading' | 'ok' | 'error'; classes: PicClassOption[]; error?: string }>({ status: 'loading', classes: [] });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/quickbooks/pic-classes?company=TAO')
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? 'Unable to load QuickBooks classes');
        return json;
      })
      .then(json => { if (!cancelled) setPicOptions({ status: 'ok', classes: json.classes ?? [] }); })
      .catch(error => { if (!cancelled) setPicOptions({ status: 'error', classes: [], error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quickbooks/next-invoice-numbers?txnDate=${encodeURIComponent(txnDate)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(json => {
        setNumberConnected(json.TAO?.connected ?? null);
        const next = typeof json.TAO?.number === 'string' ? json.TAO.number : '';
        setSuggestedNumber(next);
        setDocNumber(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [txnDate]);

  // Vincent, 2026-09-05: "不管周期，是判断之前开过的所有服务，然后用户才来
  // 自己打勾自己要开的单" then "之前把previous 的变成下面那个services 的就
  // 好了...TAB/TAC会把服务勾选好...TAO的也是判断出之前的所有服务，但是不
  // 主动勾选" — one merged table, not a separate checklist above an empty
  // one: every distinct service this company has ever been billed for via
  // TAO becomes a row immediately (unlike TAB/TAC's due-cycle rows, unchecked
  // by default — there's no due-date signal here to justify assuming yes),
  // with its description's period rolled forward one cycle as a starting
  // guess and its last-billed date kept visible so ACC can judge whether it's
  // needed again.
  // Live QuickBooks catalog (see fetchTaoCatalog's own header) — fetched
  // once per mount, cached across every other expanded row on the page.
  const [catalog, setCatalog] = useState<CatalogEntry[]>([CUSTOM_OTHER]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showAddService, setShowAddService] = useState(false);
  useEffect(() => {
    fetchTaoCatalog().then(c => { setCatalog(c); setCatalogError(null); })
      .catch(e => setCatalogError(e instanceof Error ? e.message : 'QuickBooks service list could not be loaded.'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    Promise.all([
      fetch(`/api/billing/tao/service-history?companyName=${encodeURIComponent(company.companyName)}`, { signal: controller.signal }).then(res => res.json()) as Promise<Partial<TaoServiceHistory>>,
      // History rows still load when the catalog can't — the error shows by "Add line".
      fetchTaoCatalog().catch(() => null),
    ])
      .then(([json, loadedCatalog]) => {
        const items: TaoServiceHistoryItem[] = json.services ?? [];
        const liveCatalog = loadedCatalog ?? [CUSTOM_OTHER];
        if (loadedCatalog) setCatalog(loadedCatalog);
        setLines(items.map(h => lineFromHistory(h, liveCatalog)));
        setPicHistory({
          lastClassByProduct: new Map(items.map(h => [h.productService, h.picClassName ?? null])),
          lastClassByService: json.picByService ?? {},
        });
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
    return () => controller.abort();
  }, [company.companyName]);

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines(current => current.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (selectValue: string) => {
    const opt = selectValue === '__custom__'
      ? CUSTOM_OTHER
      : catalog.find(x => x.productService && x.productService === selectValue);
    if (!opt) return;
    setLines(current => [...current, newLine(opt)]);
  };
  const removeLine = (key: number) => setLines(current => current.filter(l => l.key !== key));

  // What a line's PIC is right now: the person's choice, else QuickBooks'
  // own previous setting for this client (lib/invoice-pic-class.ts
  // taoDefaultPicName), mapped to an ACTIVE Class. undefined = not known yet
  // (history or the Class list still loading / unavailable) → nothing sent,
  // so the server keeps today's classless behaviour rather than guessing.
  const picDefaultName = (l: Line) => taoDefaultPicName(l, picHistory);
  const effectivePicId = (l: Line): string | null | undefined => {
    if (l.picClassId !== undefined) return l.picClassId;
    if (picOptions.status !== 'ok' || historyLoading) return undefined;
    const name = picDefaultName(l);
    return name ? (picOptions.classes.find(o => o.name === name)?.value ?? null) : null;
  };

  const included = lines.filter(l => l.include);
  const total = included.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.qty) || 0), 0);
  const linesValid = included.length > 0 && included.every(l => l.description.trim() && Number.isFinite(Number(l.rate)) && Number(l.rate) !== 0 && Number(l.qty) > 0);

  const generate = async () => {
    if (!linesValid) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: company.companyName,
          companyId: company.companyId ?? undefined,
          email: isValidEmail(email) ? email : undefined,
          txnDate,
          sendEmail: false,
          tabLines: [],
          tacLines: [],
          taoLines: included.map(l => ({
            service: l.service,
            productService: l.productService || undefined,
            description: l.description.trim(),
            rate: Number(l.rate),
            qty: Number(l.qty),
            // The PIC shown in the PIC column (INV-QB-026); undefined is
            // dropped by JSON → no Class, as before.
            picClassId: effectivePicId(l),
          })),
          // QuickBooks' Statement memo (PrivateNote), written from the lines
          // the way staff word it — automatic and never shown (INV-QB-027;
          // Vincent, 2026-10-04: "自动就好了，也不需要特地多一个东西显示这个Memo").
          statementMemos: { TAO: composeTaoStatementMemo(included) },
          idempotencyKey: requestKey.current,
          docNumbers: { TAO: docNumber || undefined },
          expectedNextNumbers: { TAO: suggestedNumber || undefined },
        }),
      });
      const json = await res.json();
      if (json.tao) {
        setResult({ ok: true, msg: `TAO #${json.tao.invoiceNo} generated — ${fmtMoney(json.tao.total ?? total)}` });
        setTimeout(onGenerated, 900);
      } else {
        const msg: string = json.errors?.tao ?? json.error ?? 'Invoice generation failed.';
        // Vincent, 2026-09-05: "能不能把这个建成客户的功能，也放置在...TAO"
        // — a brand-new client has no QuickBooks Customer yet; offer to
        // create one right from this exact error instead of a dead end.
        setResult({ ok: false, msg, customerMissing: /Customer not found in QB/i.test(msg) });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const createCustomerAndRetry = async () => {
    setCreatingCustomer(true);
    try {
      const res = await fetch('/api/quickbooks/create-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: 'TAO', companyName: company.companyName }),
      });
      const json = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: json.error ?? 'Could not create the customer in QuickBooks.' }); return; }
      setResult({ ok: true, msg: `Created "${json.customer.name}" in QuickBooks TAO — generating the invoice now…` });
      await generate();
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreatingCustomer(false);
    }
  };

  // Same visual language as app/billing/page.tsx's ExpandedBillingRow (Vincent,
  // 2026-09-05: "之前的UI就很不错" pointing at that exact TAB/TAC builder) —
  // shared inputStyle, the same section-badge-with-number-box header row, the
  // same include-checkbox + uppercase-header table + attached "Add line"
  // footer bar, the same bottom "N lines · Total" + green Generate button +
  // draft disclaimer. Only Status is dropped (that tracks Secretary/Address/
  // ND renewal-period due-dates, which don't exist for Accounts/Tax) — a
  // "Last billed" caption takes Status's place instead, since that's the
  // reference signal that exists here. The PIC column is QuickBooks' own
  // per-line Class: the old note here that "TAO invoices never carry one"
  // was wrong — staff tag every Accounts/Tax line (2026-10-04, INV-QB-026).
  const inputStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 5, padding: '6px 6px', fontSize: 12, outline: 'none', background: '#fff' };
  const LINE_GRID = '26px 1.1fr minmax(220px, 2fr) 150px 60px 100px 100px 26px';
  const renderPicCell = (l: Line) => {
    const value = effectivePicId(l);
    const selected = value ?? '';
    // An Accounts/Tax line normally carries the PIC (100% in QuickBooks) — flag, never block.
    const missing = value === null && taoLineNeedsPic(l);
    const lastName = picDefaultName(l);
    const title = missing
      ? (lastName ? `Last QuickBooks PIC "${lastName}" is no longer an active Class — pick one` : 'Accounts / Tax lines normally carry the PIC')
      : 'PIC — the QuickBooks Class on this line';
    return (
      <select
        value={selected}
        disabled={value === undefined && (picOptions.status === 'loading' || historyLoading)}
        onChange={e => updateLine(l.key, { picClassId: e.target.value || null })}
        aria-label="PIC" title={title}
        style={{ ...inputStyle, width: '94%', fontSize: 11.5, padding: '6px 4px', color: value ? '#334155' : '#94a3b8', borderColor: missing ? '#fbbf24' : '#cbd5e1', background: missing ? '#fffbeb' : '#fff' }}>
        <option value="">{value === undefined ? (picOptions.status === 'error' ? 'PIC list unavailable' : 'Loading…') : '— No PIC'}</option>
        {picOptions.classes.map(o => <option key={o.value} value={o.value}>{o.name}</option>)}
      </select>
    );
  };
  const manuallyChanged = !!docNumber && !!suggestedNumber && docNumber !== suggestedNumber;
  const numberBg = manuallyChanged ? '#fffbeb' : '#f8fafc';
  const numberBorder = manuallyChanged ? '#fcd34d' : '#dbe5ee';
  const numberColor = manuallyChanged ? '#92400e' : '#1e3a5f';

  return (
    <div style={{ padding: '28px 20px', background: '#fff' }}>
      {/* Header: bill email + invoice date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mail size={13} style={{ color: '#64748b' }} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com (optional)"
            style={{ ...inputStyle, width: 240, color: 'var(--accent-blue)', fontWeight: 600 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Invoice date</span>
          <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Section badge + estimated QB number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#0f766e', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 5, padding: '2px 8px' }}>TAO</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Accounts / Tax Services</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>· built manually, no template</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px', borderRadius: 8, background: numberBg, border: `1px solid ${numberBorder}` }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: manuallyChanged ? 'var(--status-warning)' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.45px' }}>{manuallyChanged ? 'Manual number' : 'Estimated QB number'}</span>
            <span style={{ fontSize: 8.5, color: '#94a3b8' }}>QB confirms when created</span>
          </div>
          <input value={docNumber} onChange={e => setDocNumber(e.target.value.trim())}
            placeholder={numberConnected === false ? 'not connected' : '…'} disabled={numberConnected === false}
            style={{ width: 92, border: 0, borderBottom: `1px solid ${manuallyChanged ? '#f59e0b' : '#94a3b8'}`, outline: 'none', background: 'transparent', color: numberColor, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 800, padding: '2px 1px', textAlign: 'center' }} />
        </div>
      </div>
      {numberConnected === false && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#b45309', fontSize: 11, marginBottom: 10 }}>
          <AlertCircle size={13} />QuickBooks TAO is not connected — connect it from the Dashboard before generating.
        </div>
      )}

      {historyLoading && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>Checking billing history…</div>}

      {/* One merged table — Vincent, 2026-09-05: "为什么要分开...就好了啊,
          和TAB/TAC的那样". Rows start populated from every distinct service
          this company has ever been billed for via TAO (unchecked, greyed
          out until ticked — see lineFromHistory above), plus whatever gets
          added via "Add line". */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: LINE_GRID, gap: 0, background: '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          <div /><div>Service</div><div>Description</div>
          <div>PIC</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Qty</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Rate (S$)</div>
          <div style={{ textAlign: 'right' }}>Amount</div><div />
        </div>
        {!historyLoading && lines.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No prior TAO billing history for this company — add a line below.</div>
        )}
        {lines.map(l => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: LINE_GRID, gap: 0, alignItems: 'start', padding: '14px 10px', borderTop: '1px solid #f1f5f9', background: l.include ? '#fff' : '#fafbfc', opacity: l.include ? 1 : 0.6 }}>
            <input type="checkbox" checked={l.include} onChange={e => updateLine(l.key, { include: e.target.checked })}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0f766e', marginTop: 6 }} />
            <div style={{ paddingTop: 6 }} title={l.productService || undefined}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</div>
              {/* Last real invoice date this service was billed — reference
                  only ("目的是为了让用户知道上一次开单是什么时候，这次还要
                  不要开单"), never used to gate or auto-check anything. */}
              <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap' }}>{l.lastBilled ? `Last: ${fmtDate(l.lastBilled)}` : 'New service'}</div>
            </div>
            <AutoTextarea value={l.description} onChange={v => updateLine(l.key, { description: v })}
              style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4 }} />
            {renderPicCell(l)}
            <input type="number" min={1} value={l.qty} onChange={e => updateLine(l.key, { qty: e.target.value })}
              style={{ ...inputStyle, width: 44, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate} onChange={e => updateLine(l.key, { rate: e.target.value })}
              placeholder="0"
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: l.include && !l.rate ? '#f87171' : '#cbd5e1', background: l.include && !l.rate ? 'var(--status-danger-tint)' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: l.include ? '#0f766e' : '#94a3b8', textAlign: 'right' }}>
              {l.include && (Number(l.rate) || 0) && (Number(l.qty) || 0) ? fmtMoney((Number(l.rate) || 0) * (Number(l.qty) || 0)) : '—'}
            </span>
            <button onClick={() => removeLine(l.key)} title="Remove line"
              style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'center' }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: '#f8fafc' }}>
        <Plus size={13} style={{ color: '#0f766e' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add line</span>
        <select value="" onChange={e => { if (e.target.value === '__add_new__') setShowAddService(true); else if (e.target.value) addLine(e.target.value); }}
          style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
          <option value="">Choose a QuickBooks item…</option>
          {/* Every QuickBooks service, grouped like QuickBooks — the 5
              categories (Other included), then the no-category items. */}
          {[...new Set(catalog.filter(x => x !== CUSTOM_OTHER).map(x => x.category))].map(cat => (
            <optgroup key={cat} label={cat}>
              {catalog.filter(x => x !== CUSTOM_OTHER && x.category === cat).map(x => (
                <option key={x.productService} value={x.productService} title={x.description ?? undefined}>{x.label}</option>
              ))}
            </optgroup>
          ))}
          <option value="__custom__">{CUSTOM_OTHER.label}</option>
          {/* Not while the list failed to load — staff would re-create a
              service QuickBooks already has. */}
          {!catalogError && <option value="__add_new__">+ Add New Service…</option>}
        </select>
        {catalogError && (
          <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>
            ⚠ {catalogError} Reload the page before adding a service.
          </span>
        )}
      </div>
      {showAddService && (
        <AddServiceModal
          onClose={() => setShowAddService(false)}
          onCreated={entry => {
            invalidateTaoCatalogCache();
            setCatalog(prev => [...prev, entry]);
            setLines(current => [...current, newLine(entry)]);
            setShowAddService(false);
          }}
        />
      )}

      {/* Total + Generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          <span style={{ color: '#64748b' }}>{included.length} line{included.length !== 1 ? 's' : ''} · Total </span>
          <strong style={{ fontSize: 17, color: '#0f766e' }}>{fmtMoney(total)}</strong>
        </div>
        {!linesValid && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>⚠ Fill in every description, rate and quantity before generating</span>}
        <button
          onClick={generate}
          disabled={generating || !linesValid || numberConnected === false}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
            cursor: generating || !linesValid ? 'default' : 'pointer',
            background: generating || !linesValid || numberConnected === false ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
          {generating ? 'Generating…' : 'Generate Invoice in QB (TAO)'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 14, padding: '12px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: result.ok ? 'var(--status-success-tint)' : 'var(--status-danger-tint)', color: result.ok ? '#15803d' : 'var(--status-danger)',
          border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{result.ok ? '✓ ' : '✕ '}{result.msg}</span>
            {result.customerMissing && (
              <button onClick={createCustomerAndRetry} disabled={creatingCustomer}
                style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 7, border: 'none', background: creatingCustomer ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: creatingCustomer ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                {creatingCustomer ? 'Creating…' : `Create "${company.companyName}" in QuickBooks`}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 20, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
  );
}
