'use client';

/**
 * The REAL Billing Drafts row editor — moved here verbatim 2026-09-10 from
 * app/billing/page.tsx (where it was a module-level component taking only
 * `c` and `cycleFye`, so it never closed over that page's state).
 *
 * Why it moved: Vincent, on the chat assistant — "现在这些功能都锁死了在各自
 * 的功能页内，却没有互通到这个AI CHAT内...还是很像只是一个聊天chat". A chat
 * card that reimplements a simplified version of a feature is not the
 * feature; he wants the SAME editor and the SAME dialogs he uses on the
 * page. So the page keeps rendering this component exactly as before, and
 * the assistant now renders THIS component too, inside a modal — one
 * implementation of invoice drafting, reachable from both places.
 *
 * Everything below is a mechanical move (not retyped): verify with
 * `git diff` that app/billing/page.tsx's own rendered behavior is
 * unchanged. This component owns real money actions (it POSTs to
 * /api/quickbooks/create-invoice and pops its own overlap confirmation),
 * so it must never be forked into a second copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle, FileText, Plus, Check, X, Pencil, Building2, ChevronRight } from 'lucide-react';
import type { CompanyBilling } from '@/app/api/billing/renewals/route';
import { logActivity } from '@/lib/activity-client';
import { fmtDate } from '@/lib/date';
import { formatStaffName } from '@/lib/staff-directory';
import { QB_ITEM, MEDIAN_RATE, QB_CATALOG, NAME_TO_INITIALS, secretaryDescription, addressDescription, arGovtFeeDescription, xbrlDescription, periodLabel, fyeDateString } from '@/lib/invoice-templates';
import { parseInvoicePeriod, rollRecurringDescriptionForward, servicePeriodOverlapError } from '@/lib/invoice-period';
import { manualInvoiceOverrides } from '@/lib/manual-invoice-marker';
import { SVC_CONFIG } from '@/components/billing/service-config';

let parentPickCache: { id: number; company_name: string }[] | null = null;
let parentPickPromise: Promise<{ id: number; company_name: string }[]> | null = null;

function loadParentPicklist() {
  if (parentPickCache) return Promise.resolve(parentPickCache);
  if (!parentPickPromise) {
    parentPickPromise = fetch('/api/companies/parent').then(r => r.json())
      .then(j => { parentPickCache = j.companies ?? []; return parentPickCache!; })
      .catch(() => { parentPickPromise = null; return []; });
  }
  return parentPickPromise;
}

function ParentCompanyPicker({ companyId, parentCompanyId, parentCompanyName, onChange }: {
  companyId: number | null; parentCompanyId: number | null; parentCompanyName: string | null;
  onChange: (id: number | null, name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ id: number; company_name: string }[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadParentPicklist().then(setOptions);
    const onOutside = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  if (!companyId) return null; // this row never resolved a real companies.id — nothing to link yet

  const filtered = (query.trim()
    ? options.filter(o => o.company_name.toLowerCase().includes(query.trim().toLowerCase()) && o.id !== companyId)
    : options.filter(o => o.id !== companyId)).slice(0, 30);

  const save = async (id: number | null, name: string | null) => {
    const prev = { id: parentCompanyId, name: parentCompanyName };
    onChange(id, name); // optimistic
    setOpen(false); setQuery('');
    try {
      const res = await fetch('/api/companies/parent', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, parentCompanyId: id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Failed to save parent company: ${j.error ?? res.status}`);
        onChange(prev.id, prev.name);
      }
    } catch {
      alert('Failed to save parent company — check your connection.');
      onChange(prev.id, prev.name);
    }
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {parentCompanyId && !open ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
          <Building2 size={11} />Bill-To parent: <strong style={{ color: '#334155' }}>{parentCompanyName}</strong>
          <button onClick={() => setOpen(true)} style={{ border: 'none', background: 'none', color: 'var(--accent-blue)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Change</button>
          <button onClick={() => save(null, null)} style={{ border: 'none', background: 'none', color: '#94a3b8', fontSize: 10.5, cursor: 'pointer', padding: 0 }}>Clear</button>
        </span>
      ) : !open ? (
        <button onClick={() => setOpen(true)} style={{ border: '1px dashed #cbd5e1', background: 'none', color: '#94a3b8', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', borderRadius: 5, padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={10} />Set parent company
        </button>
      ) : (
        <div style={{ position: 'relative' }}>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company…"
            style={{ border: '1px solid #cbd5e1', borderRadius: 5, padding: '4px 7px', fontSize: 11.5, width: 200 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 40, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 8px 20px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', width: 260 }}>
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: '#94a3b8' }}>No match</div>}
            {filtered.map(o => (
              <div key={o.id} onClick={() => save(o.id, o.company_name)} style={{ padding: '6px 10px', fontSize: 11.5, cursor: 'pointer' }}>{o.company_name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type EditableLine = {
  service: string;
  productService: string;   // exact QB Product/Service item
  description: string;
  qty: number;
  rate: number;
  include: boolean;
  due: boolean;
  reason: string;
  previousPeriodEnd?: string | null;
  periodNeedsReview?: boolean;
  periodReviewed?: boolean;
};

type InvoiceNumberState = { TAB: string; TAC: string };
type GeneratedPdf = { company: 'TAB' | 'TAC'; invoiceNo: string; qbId: string; total: number };

export function displayInvoiceNo(invoiceNo: string | null | undefined) {
  const value = String(invoiceNo ?? '').trim();
  return value.replace(/^(?:TAB|TAC)(?=\d|[\s#:_-])[\s#:_-]*/i, '');
}

// House naming convention for saved invoice PDFs — TAB: "INV<no>-<company>-S$<amt>",
// TAC: "TAC<no>-<company>-S$<amt>" (no spaces around the dashes).
function invoicePdfFileName(company: 'TAB' | 'TAC', invoiceNo: string, companyName: string, total: number) {
  const prefix = company === 'TAB' ? 'INV' : 'TAC';
  const safeCompany = companyName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
  return `${prefix}${displayInvoiceNo(invoiceNo)}-${safeCompany}-S$${amount}.pdf`;
}

type WritablePdfFileHandle = {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
};
type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<WritablePdfFileHandle>;
};

function existingGeneratedPdfs(company: CompanyBilling, cycleFye?: string): GeneratedPdf[] {
  const seen = new Set<'TAB' | 'TAC'>();
  const pdfs: GeneratedPdf[] = [];
  for (const invoice of company.generatedInvoices ?? []) {
    if (cycleFye && invoice.fyeCycle !== cycleFye) continue;
    if (!invoice.invoiceNo || !invoice.qbId || seen.has(invoice.qbCompany)) continue;
    seen.add(invoice.qbCompany);
    pdfs.push({ company: invoice.qbCompany, invoiceNo: invoice.invoiceNo, qbId: invoice.qbId, total: invoice.totalAmt ?? 0 });
  }
  return pdfs;
}

// Textarea that grows to fit its content — the full line description is always
// visible, no inner scrollbar.
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

export type BillToDraft = {
  careOf: string;
  addrSource: 'b' | 'a' | 'custom';
  addrCustom: string;
  attn: string;
};

// Invoice Bill To: "c/o" + "Attn" (2026-09-10).
//
// Two levels, per Vincent — "又要跟着客户走，又要每单选": the fields open
// prefilled from the company's stored default, and editing them here
// changes THIS invoice only. "设为默认" is the separate, explicit act of
// writing the value back to the company so future invoices inherit it.
//
// Left empty this sends nothing at all, and QuickBooks fills Bill To from
// the customer record exactly as it always has — which is why ~99.9% of
// invoices are untouched by this feature.
function BillToFields({ company, value, onChange, parentName }: {
  company: CompanyBilling;
  value: BillToDraft;
  onChange: (next: BillToDraft) => void;
  // The parent-company Bill-To link currently set on this row, if any — the
  // two features write the same block and mean opposite things, so a user
  // typing a c/o on a company that has a parent link must be told BEFORE
  // generating, not by a note afterwards. Seen live on FUTAI RENOVATION,
  // which has BELTROAD linked.
  parentName: string | null;
}) {
  // Collapsed by default (Vincent, 2026-09-10): ~99.9% of companies have no
  // c/o, so an always-open four-field panel was noise on every row. It must
  // never HIDE a configured value though — see `summary` below, which the
  // closed header shows.
  const [open, setOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const stored: BillToDraft = {
    careOf: company.billToCareOf ?? '',
    addrSource: company.billToCareOfAddrSource ?? 'b',
    addrCustom: company.billToCareOfAddrCustom ?? '',
    attn: company.billToAttn ?? '',
  };
  const differsFromStored =
    value.careOf.trim() !== stored.careOf.trim() ||
    value.attn.trim() !== stored.attn.trim() ||
    (value.careOf.trim() ? value.addrSource !== stored.addrSource : false) ||
    (value.careOf.trim() && value.addrSource === 'custom' ? value.addrCustom.trim() !== stored.addrCustom.trim() : false);

  const saveAsDefault = async () => {
    if (!company.resolvedCompanyId) { setSavedNote("This row has no company record, so it cannot be saved as a default."); return; }
    setSavingDefault(true); setSavedNote(null);
    try {
      const writes: [string, string | null][] = [
        ['bill_to_care_of', value.careOf.trim() || null],
        ['bill_to_care_of_addr_source', value.careOf.trim() ? value.addrSource : null],
        ['bill_to_care_of_addr_custom', value.careOf.trim() && value.addrSource === 'custom' ? (value.addrCustom.trim() || null) : null],
        ['bill_to_attn', value.attn.trim() || null],
      ];
      for (const [field, v] of writes) {
        const res = await fetch('/api/companies/bill-to', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: company.resolvedCompanyId, field, value: v }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Save failed (${res.status})`);
      }
      logActivity('bill_to_default_saved', { companyName: company.companyName });
      setSavedNote("Saved as this company's default — future invoices will use it.");
    } catch (err) {
      setSavedNote(err instanceof Error ? err.message : 'Save failed — please try again.');
    } finally {
      setSavingDefault(false);
    }
  };

  // What the closed header shows. Built from the CURRENT field values, not
  // the stored default, so an unsaved per-invoice edit is still visible
  // while collapsed — collapsing must never make a configured c/o look
  // like nothing is set.
  const summary = [
    value.careOf.trim() ? `c/o ${value.careOf.trim()}` : '',
    value.attn.trim() ? `ATTN ${value.attn.trim()}` : '',
  ].filter(Boolean).join(' · ');

  const label: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 3, display: 'block' };
  const input: React.CSSProperties = { width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', color: '#334155', background: '#fff' };

  return (
    <div style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: open ? '10px 12px' : '7px 12px', marginBottom: 28, background: '#fbfcfd' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', marginBottom: open ? 8 : 0 }}
      >
        <ChevronRight size={12} color="#94a3b8" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#31506f' }}>Bill To (optional)</span>
        {summary
          ? <span style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #ccfbf1', borderRadius: 999, padding: '1px 8px' }}>{summary}</span>
          : <span style={{ fontSize: 10, color: '#94a3b8' }}>{open ? "Leave empty and QuickBooks uses the customer's own address, exactly as today" : "Not set — QuickBooks uses the customer's own address"}</span>}
      </button>

      {!open ? null : (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.1fr 1fr', gap: 10 }}>
        <div>
          <label style={label}>C/O (care of)</label>
          <input style={input} value={value.careOf} placeholder="e.g. Novix Ai Global Pte. Ltd"
            onChange={e => onChange({ ...value, careOf: e.target.value })} />
          {/* A one-click fill when this row already has a Bill-To parent —
              Vincent asked whether the c/o "is generally the parent". The
              real data says no: of the 7 clients who have ever had a c/o
              printed, NONE had a parent link, 3 of the c/o parties are not
              companies of ours at all (a law firm, overseas affiliates), and
              only 1 of 947 companies has a parent link set. So the
              placeholder stays a neutral example rather than asserting
              c/o = parent — but where a parent IS linked, offering it saves
              retyping. */}
          {parentName && !value.careOf.trim() && (
            <button type="button" onClick={() => onChange({ ...value, careOf: parentName })}
              style={{ marginTop: 5, fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #ccfbf1', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Use Bill-To parent: {parentName}
            </button>
          )}
        </div>
        <div>
          <label style={label}>Address under the C/O line</label>
          <select style={{ ...input, cursor: value.careOf.trim() ? 'pointer' : 'not-allowed', color: value.careOf.trim() ? '#334155' : '#cbd5e1' }}
            value={value.addrSource} disabled={!value.careOf.trim()}
            onChange={e => onChange({ ...value, addrSource: e.target.value as BillToDraft['addrSource'] })}>
            <option value="b">B — the c/o party's address</option>
            <option value="a">A — the client's own address</option>
            <option value="custom">Custom — type it below</option>
          </select>
        </div>
        <div>
          <label style={label}>ATTN (attention to)</label>
          <input style={input} value={value.attn} placeholder="e.g. Mr Li"
            onChange={e => onChange({ ...value, attn: e.target.value })} />
        </div>
      </div>

      {value.careOf.trim() && value.addrSource === 'custom' && (
        <div style={{ marginTop: 10 }}>
          <label style={label}>Custom address (one line each)</label>
          <textarea style={{ ...input, minHeight: 54, resize: 'vertical', fontFamily: 'inherit' }}
            value={value.addrCustom} placeholder={'12 Marina Boulevard\n#25-01 MBFC Tower 3\nSingapore 018982'}
            onChange={e => onChange({ ...value, addrCustom: e.target.value })} />
        </div>
      )}

      {parentName && value.careOf.trim() && (
        <div style={{ marginTop: 9, padding: '7px 9px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e', lineHeight: 1.6 }}>
          ⚠ This company already has a Bill-To parent (<strong>{parentName}</strong>). A c/o <strong>overrides it</strong> — the invoice will be addressed to &ldquo;{company.companyName} c/o {value.careOf.trim()}&rdquo;, not to the parent. Clear the c/o to bill the parent instead.
        </div>
      )}

      {(value.careOf.trim() || value.attn.trim()) && (
        <div style={{ marginTop: 9, padding: '7px 9px', background: '#fff', border: '1px dashed #dbe3ec', borderRadius: 6, fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', marginBottom: 3 }}>What the client will see</div>
          <div>{company.companyName}</div>
          {value.careOf.trim() && <div>c/o {value.careOf.trim()}</div>}
          <div style={{ color: '#94a3b8' }}>
            {!value.careOf.trim() || value.addrSource === 'a' ? "(the client's own address)"
              : value.addrSource === 'b' ? `(${value.careOf.trim()}'s address — falls back to the client's own if none is on file)`
              : (value.addrCustom.trim() ? value.addrCustom.trim().split('\n').map((l, i) => <div key={i}>{l}</div>) : "(no custom address typed — falls back to the client's own)")}
          </div>
          {value.attn.trim() && <div>Attn: {value.attn.trim()}</div>}
        </div>
      )}

      {differsFromStored && (
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, color: '#b45309' }}>This change applies to this invoice only.</span>
          <button type="button" onClick={() => void saveAsDefault()} disabled={savingDefault}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#31506f', cursor: savingDefault ? 'wait' : 'pointer' }}>
            {savingDefault ? 'Saving…' : 'Save as company default'}
          </button>
          <button type="button" onClick={() => onChange(stored)}
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>
            Reset to default
          </button>
        </div>
      )}
      {savedNote && <div style={{ marginTop: 6, fontSize: 10.5, color: /failed|cannot/i.test(savedNote) ? '#b91c1c' : '#15803d' }}>{savedNote}</div>}
      </>
      )}
    </div>
  );
}

export default function ExpandedBillingRow({ c, cycleFye }: { c: CompanyBilling; cycleFye?: string }) {
  const invoiceRequestKey = useRef(globalThis.crypto.randomUUID()).current;
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Vincent, 2026-09-05: "假设我今天要...开单一个...完全全新的公司...能不能
  // 把这个建成客户的功能，也放置在 TAB/TAC" — findCustomer() in
  // qb-invoice-conventions.ts only ever looks a QB Customer up, never
  // creates one; a genuinely new client fails here with "Customer not found
  // in QB {company}". Track which company(ies) hit exactly that error so the
  // banner can offer a one-click "create it" recovery instead of a dead end.
  const [missingCustomerCompanies, setMissingCustomerCompanies] = useState<Array<'TAB' | 'TAC'>>([]);
  const [creatingCustomerFor, setCreatingCustomerFor] = useState<Partial<Record<'TAB' | 'TAC', boolean>>>({});
  const [email, setEmail] = useState(c.email ?? '');
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumbers, setInvoiceNumbers] = useState<InvoiceNumberState>({ TAB: '', TAC: '' });
  const [suggestedNumbers, setSuggestedNumbers] = useState<InvoiceNumberState>({ TAB: '', TAC: '' });
  const [numberLoading, setNumberLoading] = useState(true);
  const [numberWarning, setNumberWarning] = useState('');
  const [numberRefreshKey, setNumberRefreshKey] = useState(0);
  const [generatedPdfs, setGeneratedPdfs] = useState<GeneratedPdf[]>(() => existingGeneratedPdfs(c, cycleFye));
  const [savingPdfs, setSavingPdfs] = useState(false);
  const [pdfResult, setPdfResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [parentOverride, setParentOverride] = useState<{ id: number | null; name: string | null }>({ id: c.parentCompanyId, name: c.parentCompanyName });
  // Prefilled from the company's stored Bill To default; edits here apply to
  // THIS invoice only unless explicitly saved back (see BillToFields).
  const [billToNotes, setBillToNotes] = useState<string[]>([]);
  const [billTo, setBillTo] = useState<BillToDraft>({
    careOf: c.billToCareOf ?? '',
    addrSource: c.billToCareOfAddrSource ?? 'b',
    addrCustom: c.billToCareOfAddrCustom ?? '',
    attn: c.billToAttn ?? '',
  });

  // Edit mode (Vincent, 2026-08-18): once an invoice already exists for a
  // company+cycle, this section switches to editing that real QB invoice
  // instead of generating another one — see PATCH /api/quickbooks/update-invoice.
  // Independent per QB company, since a company can have e.g. a TAB invoice
  // already generated and a separate TAC one not yet. No client-side
  // SyncToken tracking needed — the update route always re-reads the
  // invoice's current one itself right before writing.
  const [editLoading, setEditLoading] = useState<Partial<Record<'TAB' | 'TAC', boolean>>>({});
  const [editLoadError, setEditLoadError] = useState<Partial<Record<'TAB' | 'TAC', string>>>({});
  const [savingEdit, setSavingEdit] = useState<Partial<Record<'TAB' | 'TAC', boolean>>>({});
  const [editResult, setEditResult] = useState<Partial<Record<'TAB' | 'TAC', { ok: boolean; msg: string; blocked?: boolean }>>>({});

  // Build the editable draft. Each line defaults to how THIS company was last
  // invoiced for that service (same QB item + description wording + rate, from
  // history), refreshing the period/FYE; when there's no history it falls back
  // to Tassure's standard template + typical rate. AR adds the fixed S$60 ACRA
  // government-fee line. Lines that are actually due are pre-checked.
  const currentYear = new Date().getFullYear();
  const ndInitials = c.ndPic ? NAME_TO_INITIALS[c.ndPic.trim().toUpperCase()] : undefined;
  const ndProductService = ndInitials ? `${QB_ITEM.ND} - ${ndInitials}` : QB_ITEM.ND;
  const initialLines = useMemo<EditableLine[]>(() => {
    const out: EditableLine[] = [];
    const period = periodLabel(c.renewals[0]?.suggestedPeriodStart ?? null, c.renewals[0]?.suggestedPeriodEnd ?? null);
    // Prefer the FYE of the cycle actually being invoiced (from the selected
    // month/year) over a current-year guess — a January-selected cycle drafted
    // in December would otherwise stamp the wrong year on AR/XBRL lines.
    const fyeStr = cycleFye ?? fyeDateString(c.fyeMonth, currentYear);
    // "Invoiced this cycle" from the FYE markers on QB lines — validated
    // reliable, unlike the 13-month recency heuristic which misreads
    // last year's invoice as covering this cycle at boundary months.
    const billedThisCycle = cycleFye ? (c.billedCycles ?? []).includes(cycleFye) : null;

    for (const r of c.renewals) {
      if (!r.applicable) continue;
      const due = r.status === 'expired' || r.status === 'expiring_soon';
      const last = r.history?.[0];
      const pLabel = periodLabel(r.suggestedPeriodStart, r.suggestedPeriodEnd);
      const templateDesc = r.service === 'Secretary' ? secretaryDescription(pLabel)
                         : r.service === 'Address'   ? addressDescription(pLabel)
                         : `Nominee Director for one year${pLabel ? ` (${pLabel})` : ''}`;
      // ND's source of truth is TeamWork's nominee-director records, not QB.
      // A line only reaches here when r.applicable is true, i.e. TeamWork shows
      // an ACTIVE nominee appointment (validated accurate) — so trust it and
      // pre-check it. QB history is unreliable for ND only because deposits and
      // annual fees are billed on separate invoices, so the *fee* is the only
      // thing to eyeball, not whether we're still engaged. Secretary is 85%
      // identical YoY / Address 95% — likewise safe to pre-fill.
      const isND = r.service === 'ND';
      out.push({
        service: r.service,
        productService: isND ? (ndInitials ? ndProductService : last?.product_service ?? ndProductService) : last?.product_service ?? QB_ITEM[r.service] ?? '',
        description: templateDesc,
        qty: 1,
        rate: r.lastRate ?? MEDIAN_RATE[r.service] ?? 0,
        include: r.periodNeedsReview ? false : isND ? true : due,
        due,
        reason: r.periodNeedsReview ? 'Check latest QB period'
              : isND ? 'Active nominee per TeamWork · confirm annual fee (excl. deposit)'
              : r.status === 'expired' ? `Expired ${Math.abs(r.daysUntilExpiry ?? 0)}d ago`
              : r.status === 'expiring_soon' ? `Expiring in ${r.daysUntilExpiry}d`
              : r.status === 'active' ? `Active until ${r.lastPeriodEnd ? fmtDate(r.lastPeriodEnd) : '—'}`
              : 'No prior invoice',
        previousPeriodEnd: r.lastPeriodEnd,
        periodNeedsReview: r.periodNeedsReview,
        periodReviewed: false,
      });
    }

    for (const a of c.annuals) {
      if (!a.applicable) continue;
      // Cycle marker beats the recency heuristic whenever we know the cycle.
      const due = billedThisCycle !== null ? !billedThisCycle : a.status === 'pending';
      const last = a.history?.[0];
      const reason = billedThisCycle === true ? `Already invoiced this cycle [FYE ${cycleFye}]`
                   : billedThisCycle === false ? 'Not yet invoiced this cycle'
                   : a.status === 'billed' ? `Already billed ${a.lastTxnDate ? fmtDate(a.lastTxnDate) : ''}`
                   : a.status === 'pending' ? 'Not yet billed this cycle' : 'No prior invoice';
      if (a.service === 'AR') {
        // AR = fixed S$60 ACRA government filing fee (a disbursement line).
        out.push({
          service: 'AR', productService: last?.product_service ?? QB_ITEM.AR,
          description: arGovtFeeDescription(fyeStr),
          qty: 1, rate: last?.rate ?? MEDIAN_RATE.AR, include: due, due, reason,
        });
      } else { // XBRL
        // Validation: XBRL amount is 100% stable when present, but presence is
        // unpredictable YoY (added 18× / dropped 7× across 32 pairs) because it
        // depends on the year's filing requirement — always confirm it's needed.
        out.push({
          service: 'XBRL', productService: last?.product_service ?? QB_ITEM.XBRL,
          description: xbrlDescription(fyeStr),
          qty: 1, rate: a.lastAmount ?? MEDIAN_RATE.XBRL, include: due, due,
          reason: `⚠ Confirm XBRL required this FY · ${reason}`,
        });
      }
    }

    // Carry forward the extras from last year's actual invoice that the core
    // template doesn't cover — per the SOP "沿用上一年的收费项目/金额/折扣".
    // Discount is pre-checked (part of the client's deal) but flagged to
    // confirm it still applies; recurring Accounts/Tax lines are surfaced
    // unchecked for staff to confirm they recur this year.
    const priorDate = c.priorInvoiceDate ? fmtDate(c.priorInvoiceDate) : 'last year';
    for (const p of c.priorLines ?? []) {
      const ps = p.product_service ?? '';
      if (/Discount Given/i.test(ps)) {
        out.push({
          service: 'Discount', productService: ps,
          description: rollRecurringDescriptionForward(p.description || 'Discount Given'),
          qty: 1, rate: p.amount ?? 0, include: true, due: true,
          reason: `Discount from ${priorDate} — confirm it still applies`,
        });
      } else if (/Yearly Accounts Services|Compilation Services|Monthly Accounts Services/i.test(ps) && !/DO NOT USE/i.test(ps)) {
        out.push({
          service: 'Accounts', productService: ps,
          description: rollRecurringDescriptionForward(p.description || ps),
          qty: 1, rate: p.amount ?? MEDIAN_RATE.Accounts ?? 0, include: false, due: false,
          reason: `On ${priorDate} invoice — confirm if recurring`,
        });
      } else if (/Corporate Tax Services|Personal Income Tax Services|Other Tax Services/i.test(ps)) {
        out.push({
          service: 'Tax', productService: ps,
          description: rollRecurringDescriptionForward(p.description || ps),
          qty: 1, rate: p.amount ?? MEDIAN_RATE.Tax ?? 0, include: false, due: false,
          reason: `On ${priorDate} invoice — confirm if recurring`,
        });
      }
    }
    return out;
  }, [c, currentYear, cycleFye, ndInitials, ndProductService]);

  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const setLine = (i: number, patch: Partial<EditableLine>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // All Nominee Director lines invoice separately under TAC; everything else
  // (Secretary/Address/AR/XBRL/Accounts/Tax/Discount) stays under TAB, the
  // default company. Keep original array indices so setLine/remove still
  // target the right row after splitting into two rendered tables.
  const withIndex = lines.map((l, i) => ({ l, i }));
  const tabRows = withIndex.filter(x => x.l.service !== 'ND');
  const tacRows = withIndex.filter(x => x.l.service === 'ND');

  // Only offer the TAC section at all when this company actually has an ND
  // line — most companies never will.
  const hasTac = tacRows.length > 0;

  const tabInvoice = generatedPdfs.find(p => p.company === 'TAB') ?? null;
  const tacInvoice = generatedPdfs.find(p => p.company === 'TAC') ?? null;

  // Fetch each edit-mode company's live QB lines once, replacing that
  // company's slice of `lines` with what's actually on the invoice — not
  // the historical-template guess `initialLines` started from.
  const loadedEditCompanies = useRef(new Set<'TAB' | 'TAC'>()).current;
  const loadLiveLines = useCallback(async (company: 'TAB' | 'TAC', qbId: string) => {
    setEditLoading(prev => ({ ...prev, [company]: true }));
    setEditLoadError(prev => ({ ...prev, [company]: undefined }));
    try {
      const res = await fetch(`/api/quickbooks/invoice-lines?company=${company}&id=${encodeURIComponent(qbId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Unable to load this invoice from QuickBooks.');
      const liveLines: EditableLine[] = (json.lines ?? []).map((l: { service: string; productService: string; description: string; qty: number; rate: number }) => ({
        service: l.service, productService: l.productService, description: l.description,
        qty: l.qty, rate: l.rate, include: true, due: false, reason: 'Live from QuickBooks',
      }));
      setLines(prev => company === 'TAB'
        ? [...liveLines, ...prev.filter(l => l.service === 'ND')]
        : [...prev.filter(l => l.service !== 'ND'), ...liveLines]);
    } catch (error) {
      setEditLoadError(prev => ({ ...prev, [company]: error instanceof Error ? error.message : 'Unable to load this invoice.' }));
    } finally {
      setEditLoading(prev => ({ ...prev, [company]: false }));
    }
  }, []);

  useEffect(() => {
    if (tabInvoice && !loadedEditCompanies.has('TAB')) {
      loadedEditCompanies.add('TAB');
      void loadLiveLines('TAB', tabInvoice.qbId);
    }
    if (tacInvoice && !loadedEditCompanies.has('TAC')) {
      loadedEditCompanies.add('TAC');
      void loadLiveLines('TAC', tacInvoice.qbId);
    }
  }, [tabInvoice, tacInvoice, loadLiveLines, loadedEditCompanies]);

  const [tacStatus, setTacStatus] = useState<{ connected: boolean } | null>(null);
  useEffect(() => {
    if (!hasTac) return;
    fetch('/api/quickbooks/status?company=TAC').then(r => r.json()).then(setTacStatus).catch(() => setTacStatus({ connected: false }));
  }, [hasTac]);

  useEffect(() => {
    const controller = new AbortController();
    const startTimer = setTimeout(() => {
      setNumberLoading(true);
      setNumberWarning('');
    }, 0);
    fetch(`/api/quickbooks/next-invoice-numbers?txnDate=${encodeURIComponent(txnDate)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to read QuickBooks invoice numbers');
        return response.json();
      })
      .then(json => {
        const next = {
          TAB: typeof json.TAB?.number === 'string' ? json.TAB.number : '',
          TAC: typeof json.TAC?.number === 'string' ? json.TAC.number : '',
        };
        setSuggestedNumbers(next);
        setInvoiceNumbers(next);
        if (!json.TAB?.connected || (hasTac && !json.TAC?.connected)) {
          setNumberWarning('QuickBooks connection unavailable for one or more invoice numbers.');
        }
      })
      .catch(error => {
        if (error instanceof Error && error.name !== 'AbortError') setNumberWarning(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setNumberLoading(false); });
    return () => { clearTimeout(startTimer); controller.abort(); };
  }, [txnDate, hasTac, numberRefreshKey]);

  const included = lines.filter(l => l.include);
  const includedTab = included.filter(l => l.service !== 'ND');
  const includedTac = included.filter(l => l.service === 'ND');
  const total = included.reduce((s, l) => s + l.qty * l.rate, 0);
  const totalTab = includedTab.reduce((s, l) => s + l.qty * l.rate, 0);
  const totalTac = includedTac.reduce((s, l) => s + l.qty * l.rate, 0);
  const missingRate = included.some(l => !l.rate);
  // Only the side(s) still being generated need a confirmed QB number —
  // an already-existing invoice being edited keeps its real DocNumber,
  // untouched by this panel.
  const missingInvoiceNumber = (!tabInvoice && includedTab.length > 0 && !invoiceNumbers.TAB) || (!tacInvoice && includedTac.length > 0 && !invoiceNumbers.TAC);
  // Overlap issues are split out from everything else (Vincent, 2026-08-19):
  // a real period overlap is a judgment call, not always a mistake —
  // "有时候有特别情况" (sometimes there are special cases) — so it still
  // warns (both here and server-side in create-invoice/route.ts) but no
  // longer disables Generate; instead createInvoice() below pops a confirm
  // dialog the moment it's clicked. "Confirm the latest period" and
  // "incomplete period" stay hard blocks — those are real data gaps, not
  // something a human can just confirm past.
  const blockingPeriodErrors: string[] = [];
  const overlapWarnings: string[] = [];
  for (const line of included) {
    if (!['Secretary', 'Address', 'ND'].includes(line.service)) continue;
    if (line.periodNeedsReview && !line.periodReviewed) {
      blockingPeriodErrors.push(`${line.service}: confirm the latest period against QuickBooks.`);
    }
    const issue = servicePeriodOverlapError(
      line.service,
      parseInvoicePeriod(line.description, line.service),
      line.previousPeriodEnd,
    );
    if (issue?.kind === 'incomplete') blockingPeriodErrors.push(issue.message);
    else if (issue?.kind === 'overlap') overlapWarnings.push(issue.message);
  }
  const hasPeriodError = blockingPeriodErrors.length > 0;
  const hasOverlapWarning = overlapWarnings.length > 0;
  const [overlapConfirmModal, setOverlapConfirmModal] = useState<string[] | null>(null);

  // Once a company already has an invoice this cycle, it's edited via its
  // own "Save … changes" button (see renderSaveButton) instead of the
  // combined bottom Generate button below — that button only ever creates
  // NEW invoices, for whichever company(ies) don't have one yet.
  const needsGenerateTab = !tabInvoice;
  const needsGenerateTac = hasTac && !tacInvoice;
  const showGenerateButton = needsGenerateTab || needsGenerateTac;

  const createInvoice = async (overlapConfirmed = false) => {
    if (hasPeriodError) {
      setDraftResult({ ok: false, msg: blockingPeriodErrors.join(' ') });
      return;
    }
    // Pop the confirm dialog instead of blocking outright — Vincent,
    // 2026-08-19. Only reached on the FIRST click; createInvoice(true) from
    // the modal's own "Generate anyway" button skips straight past this.
    if (hasOverlapWarning && !overlapConfirmed) {
      setOverlapConfirmModal(overlapWarnings);
      return;
    }
    setDrafting(true); setDraftResult(null);
    try {
      const fyeYear = cycleFye ? +cycleFye.slice(-4) : currentYear;
      const toApiLine = (l: EditableLine) => ({
        service: l.service,
        productService: l.productService,
        description: l.description,
        rate: l.rate,
        qty: l.qty,
        periodConfirmed: l.periodReviewed === true,
      });
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: c.companyName,
          companyId: c.resolvedCompanyId ?? undefined,
          email: email || undefined,
          txnDate,
          sendEmail: false,
          pic: c.pic ?? undefined,
          // A company that already has an invoice this cycle is edited via
          // saveInvoiceEdit/renderSaveButton instead — never re-created here.
          tabLines: needsGenerateTab ? includedTab.map(toApiLine) : [],
          tacLines: needsGenerateTac ? includedTac.map(toApiLine) : [],
          fyeMonth: c.fyeMonth, fyeYear, fyeCycle: cycleFye ?? null,
          idempotencyKey: invoiceRequestKey,
          docNumbers: invoiceNumbers,
          expectedNextNumbers: suggestedNumbers,
          overlapConfirmed,
          // Only sent when something is actually filled in — an all-empty
          // billTo would make create-invoice compose a Bill To block for a
          // company that never asked for one.
          ...(billTo.careOf.trim() || billTo.attn.trim()
            ? { billTo: { careOf: billTo.careOf.trim() || null, addrSource: billTo.addrSource, addrCustom: billTo.addrCustom.trim() || null, attn: billTo.attn.trim() || null } }
            : {}),
        }),
      });
      const json = await res.json();
      // The server independently re-checks the same overlap — it may catch
      // one the client's own (possibly slightly stale) renewal data didn't.
      // Show the same confirm dialog rather than surfacing it as a plain
      // error; confirming retries with overlapConfirmed:true.
      if (res.status === 409 && json.overlapConfirmationRequired && !overlapConfirmed) {
        const warnings = [...(json.overlapWarnings?.tab ?? []), ...(json.overlapWarnings?.tac ?? [])];
        setOverlapConfirmModal(warnings.length ? warnings : ['This invoice period overlaps one already on file.']);
        return;
      }
      if (res.status === 409 && json.numberConflict) {
        const refreshed = {
          TAB: typeof json.nextNumbers?.TAB === 'string' ? json.nextNumbers.TAB : invoiceNumbers.TAB,
          TAC: typeof json.nextNumbers?.TAC === 'string' ? json.nextNumbers.TAC : invoiceNumbers.TAC,
        };
        setSuggestedNumbers(refreshed);
        setInvoiceNumbers(refreshed);
        const details = Object.entries(json.conflicts ?? {}).map(([company, message]) => `${company}: ${message}`).join(' · ');
        setNumberWarning(`Invoice number changed in QuickBooks. ${details}`);
        setDraftResult({ ok: false, msg: 'No invoice was created. Review the refreshed TAB / TAC number, then generate again.' });
        return;
      }
      const parts: string[] = [];
      if (json.tab) parts.push(`TAB #${json.tab.invoiceNo ?? '?'} · S$${(json.tab.total ?? 0).toLocaleString()}`);
      if (json.tac) parts.push(`TAC #${json.tac.invoiceNo ?? '?'} · S$${(json.tac.total ?? 0).toLocaleString()}`);
      const numberAdjustments = [
        ...(json.tab?.numberAdjusted ? [`TAB ${json.tab.expectedInvoiceNo} → ${json.tab.invoiceNo}`] : []),
        ...(json.tac?.numberAdjusted ? [`TAC ${json.tac.expectedInvoiceNo} → ${json.tac.invoiceNo}`] : []),
      ];
      const errs: string[] = [];
      if (json.errors?.tab) errs.push(`TAB: ${json.errors.tab}`);
      if (json.errors?.tac) errs.push(`TAC: ${json.errors.tac}`);
      if (json.errors?.persistence) errs.push(json.errors.persistence);
      setMissingCustomerCompanies([
        ...(/Customer not found in QB/i.test(json.errors?.tab ?? '') ? (['TAB'] as const) : []),
        ...(/Customer not found in QB/i.test(json.errors?.tac ?? '') ? (['TAC'] as const) : []),
      ]);
      if (json.success) {
        // Vincent, 2026-09-08: "现在每个用户进入系统后的点击操作路径" — a
        // key action, not just a page view: this is the moment a real
        // invoice actually gets created, not merely that someone opened
        // Billing Drafts.
        logActivity('generate_invoice', { companyName: c.companyName, tab: !!json.tab, tac: !!json.tac });
        if (json.tab?.invoiceNo || json.tac?.invoiceNo) {
          setInvoiceNumbers(current => ({
            TAB: json.tab?.invoiceNo ? String(json.tab.invoiceNo) : current.TAB,
            TAC: json.tac?.invoiceNo ? String(json.tac.invoiceNo) : current.TAC,
          }));
        }
        if (numberAdjustments.length) {
          setNumberWarning(`QuickBooks assigned the latest available number: ${numberAdjustments.join(' · ')}. No duplicate invoice number was created.`);
        }
        // How the Bill To block actually came out — a c/o party whose
        // address could not be looked up, an overflowed line, or a parent
        // link the c/o overrode. These describe what the CLIENT sees on the
        // invoice that was just created, so they must be shown, not logged.
        setBillToNotes(json.billToNotes ?? []);
        const pdfs: GeneratedPdf[] = [
          ...(json.tab?.qbId && json.tab?.invoiceNo ? [{ company: 'TAB' as const, qbId: String(json.tab.qbId), invoiceNo: String(json.tab.invoiceNo), total: json.tab.total ?? 0 }] : []),
          ...(json.tac?.qbId && json.tac?.invoiceNo ? [{ company: 'TAC' as const, qbId: String(json.tac.qbId), invoiceNo: String(json.tac.invoiceNo), total: json.tac.total ?? 0 }] : []),
        ];
        setGeneratedPdfs(pdfs);
        setPdfResult(null);
        setDraftResult({ ok: true, msg: `Created in QuickBooks — ${parts.join(' · ')}${errs.length ? `  ⚠ ${errs.join('; ')}` : ''} · review & send from QB` });
      } else {
        setDraftResult({ ok: false, msg: errs.join('; ') || json.error || 'QB create failed' });
      }
    } catch (e: unknown) {
      setDraftResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally { setDrafting(false); }
  };

  const createCustomerAndRetry = async (company: 'TAB' | 'TAC') => {
    setCreatingCustomerFor(prev => ({ ...prev, [company]: true }));
    try {
      const res = await fetch('/api/quickbooks/create-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, companyName: c.companyName }),
      });
      const json = await res.json();
      if (!res.ok) { setDraftResult({ ok: false, msg: json.error ?? `Could not create the customer in QuickBooks ${company}.` }); return; }
      setMissingCustomerCompanies(prev => prev.filter(x => x !== company));
      setDraftResult({ ok: true, msg: `Created "${json.customer.name}" in QuickBooks ${company} — generating the invoice now…` });
      await createInvoice();
    } catch (e: unknown) {
      setDraftResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setCreatingCustomerFor(prev => ({ ...prev, [company]: false }));
    }
  };

  // Saves changes to an invoice that ALREADY exists (edit mode) — a
  // completely different QB call from createInvoice above (a sparse update
  // to one existing invoice, not creating a new one), so it's its own
  // function rather than a branch inside createInvoice.
  const saveInvoiceEdit = async (company: 'TAB' | 'TAC') => {
    const invoice = company === 'TAB' ? tabInvoice : tacInvoice;
    if (!invoice) return;
    const companyLines = company === 'TAB' ? includedTab : includedTac;
    if (!companyLines.length) {
      setEditResult(prev => ({ ...prev, [company]: { ok: false, msg: 'At least one line must be included.' } }));
      return;
    }
    setSavingEdit(prev => ({ ...prev, [company]: true }));
    setEditResult(prev => ({ ...prev, [company]: undefined }));
    try {
      const toApiLine = (l: EditableLine) => ({
        service: l.service, productService: l.productService, description: l.description, rate: l.rate, qty: l.qty,
      });
      const res = await fetch('/api/quickbooks/update-invoice', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qbCompany: company, qbInvoiceId: invoice.qbId, pic: c.pic ?? undefined, lines: companyLines.map(toApiLine),
          // Same rule as generating: only sent when something is filled in,
          // so saving an edit on an ordinary invoice still touches no
          // BillAddr at all.
          ...(billTo.careOf.trim() || billTo.attn.trim()
            ? { billTo: { careOf: billTo.careOf.trim() || null, addrSource: billTo.addrSource, addrCustom: billTo.addrCustom.trim() || null, attn: billTo.attn.trim() || null } }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditResult(prev => ({
          ...prev,
          [company]: { ok: false, msg: json.error ?? 'Unable to save changes.', blocked: !!(json.alreadySent || json.staleSyncToken) },
        }));
        return;
      }
      setGeneratedPdfs(prev => prev.map(pdf => pdf.company === company ? { ...pdf, total: json.total ?? pdf.total } : pdf));
      setBillToNotes(json.billToNotes ?? []);
      setEditResult(prev => ({ ...prev, [company]: { ok: true, msg: `Saved — ${company} invoice #${displayInvoiceNo(json.invoiceNo)} updated in QuickBooks.` } }));
    } catch (error) {
      setEditResult(prev => ({ ...prev, [company]: { ok: false, msg: error instanceof Error ? error.message : 'Request failed.' } }));
    } finally {
      setSavingEdit(prev => ({ ...prev, [company]: false }));
    }
  };

  const saveInvoicePdf = async (invoice: GeneratedPdf) => {
    if (savingPdfs) return;
    setPdfResult(null);
    setSavingPdfs(true);

    const downloadBlob = (blob: Blob, fileName: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    try {
      const visibleInvoiceNo = displayInvoiceNo(invoice.invoiceNo);
      const fileName = invoicePdfFileName(invoice.company, invoice.invoiceNo, c.companyName, invoice.total);
      const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
      let fileHandle: WritablePdfFileHandle | null = null;
      let useDownloadFallback = !saveFilePicker;

      if (saveFilePicker) {
        try {
          // Open Save As directly from the button click. Waiting for the PDF
          // request first can consume Chrome's transient user activation.
          fileHandle = await saveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setPdfResult({ ok: false, msg: 'Save cancelled. No PDF was saved.' });
            return;
          }
          useDownloadFallback = true;
        }
      }

      const response = await fetch(`/api/quickbooks/invoice-pdf?company=${invoice.company}&id=${encodeURIComponent(invoice.qbId)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? `Unable to download ${invoice.company} invoice ${invoice.invoiceNo}`);
      }
      const blob = await response.blob();

      if (fileHandle && !useDownloadFallback) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadBlob(blob, fileName);
      }

      setPdfResult({
        ok: true,
        msg: fileHandle && !useDownloadFallback
          ? `${invoice.company} invoice #${visibleInvoiceNo} saved to the selected location.`
          : `${invoice.company} invoice #${visibleInvoiceNo} sent to Chrome downloads.`,
      });
    } catch (error) {
      setPdfResult({ ok: false, msg: error instanceof Error ? error.message : 'Unable to save invoice PDF.' });
    } finally {
      setSavingPdfs(false);
    }
  };

  const inputStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 5, padding: '6px 6px', fontSize: 12, outline: 'none', background: '#fff' };

  const renderInvoiceNumber = (company: keyof InvoiceNumberState) => {
    const value = invoiceNumbers[company];
    const suggested = suggestedNumbers[company];
    const manuallyChanged = !!value && !!suggested && value !== suggested;
    // TAC gets the same amber chrome as the rest of its section (badge/PIC
    // pill/table header) instead of the neutral blue-grey shared with TAB —
    // that neutral box was the one piece of "still grey" chrome left sitting
    // inside an otherwise amber-themed block.
    const isTac = company === 'TAC';
    const bg = manuallyChanged ? '#fffbeb' : isTac ? 'var(--status-warning-tint)' : '#f8fafc';
    const border = manuallyChanged ? '#fcd34d' : isTac ? '#fed7aa' : '#dbe5ee';
    const numberColor = manuallyChanged ? '#92400e' : isTac ? '#9a3412' : '#1e3a5f';
    return (
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px', borderRadius: 8, background: bg, border: `1px solid ${border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: manuallyChanged ? 'var(--status-warning)' : isTac ? '#9a3412' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.45px' }}>{manuallyChanged ? 'Manual number' : 'Estimated QB number'}</span>
          <span style={{ fontSize: 8.5, color: isTac ? '#c2703d' : '#94a3b8' }}>{numberLoading ? 'Checking live…' : 'QB confirms when created'}</span>
        </div>
        <input
          value={value}
          onChange={event => { setInvoiceNumbers(current => ({ ...current, [company]: event.target.value.trim() })); setNumberWarning(''); }}
          placeholder={numberLoading ? 'Loading…' : 'Unavailable'}
          aria-label={`${company} invoice number`}
          style={{ width: 92, border: 0, borderBottom: `1px solid ${manuallyChanged ? '#f59e0b' : isTac ? '#fdba74' : '#94a3b8'}`, outline: 'none', background: 'transparent', color: numberColor, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 800, padding: '2px 1px', textAlign: 'center' }}
        />
        <button type="button" onClick={() => setNumberRefreshKey(key => key + 1)} title="Refresh from QuickBooks" style={{ border: 0, background: 'transparent', color: isTac ? '#c2703d' : '#64748b', padding: 2, cursor: 'pointer', display: 'flex' }}>
          <RefreshCw size={12} style={{ animation: numberLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>
    );
  };

  // Shared table renderer for both the TAB and TAC sections. TAC passes
  // accent='amber' so its header strip matches the amber chrome the rest of
  // that section already uses (badge/PIC pill/provenance note/footer bar) —
  // previously this stayed flat grey regardless of company, which is what
  // read as uncoordinated sitting inside an otherwise-amber TAC block.
  const renderTable = (rows: { l: EditableLine; i: number }[], emptyMsg: string, accent?: 'amber') => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 110px 44px 90px 100px 26px', gap: 0, background: accent === 'amber' ? 'var(--status-warning-tint)' : '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: accent === 'amber' ? '#9a3412' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        <div></div><div>Service</div><div>Description</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Status</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Qty</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Rate (S$)</div>
        <div style={{ textAlign: 'right' }}>Amount</div><div></div>
      </div>
      {rows.map(({ l, i }) => {
        const cfg = SVC_CONFIG[l.service as keyof typeof SVC_CONFIG];
        const ndCode = l.service === 'ND' ? l.productService.match(/Nominee Director Fees\s*-\s*([A-Z]+)/i)?.[1]?.toUpperCase() : null;
        const svcLabel = ndCode ? `ND · ${ndCode}` : cfg?.label ?? (l.productService.includes(':') ? l.productService.split(':').slice(1).join(':') : l.service);
        return (
          <div key={`${l.productService}-${i}`} style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 110px 44px 90px 100px 26px', gap: 0, alignItems: 'start', padding: '16px 10px', borderTop: '1px solid #f1f5f9', background: l.periodNeedsReview ? '#fffaf0' : l.include ? '#fff' : '#fafbfc', opacity: l.include || l.periodNeedsReview ? 1 : 0.55 }}>
            <input type="checkbox" checked={l.include} onChange={e => setLine(i, { include: e.target.checked })} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0f766e' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={l.productService}>
              {cfg && <cfg.Icon size={13} style={{ color: cfg.color }} />}
              <span style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcLabel}</span>
            </div>
            <AutoTextarea value={l.description} onChange={v => setLine(i, { description: v })} style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4 }} />
            <div style={{ fontSize: 10, fontWeight: 600, color: l.periodNeedsReview ? 'var(--status-warning)' : l.due ? '#c2410c' : '#94a3b8', textAlign: 'center', padding: '0 5px' }}>
              <span>{l.reason}</span>
              {l.periodNeedsReview && (
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6, color: l.periodReviewed ? '#15803d' : 'var(--status-warning)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={l.periodReviewed === true} onChange={e => setLine(i, { periodReviewed: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#15803d' }} />
                  Checked in QB
                </label>
              )}
            </div>
            <input type="number" min={1} value={l.qty} onChange={e => setLine(i, { qty: Math.max(1, +e.target.value || 1) })} style={{ ...inputStyle, width: 38, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate || ''} placeholder="0" onChange={e => setLine(i, { rate: +e.target.value || 0 })}
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: l.include && !l.rate ? '#f87171' : '#cbd5e1', background: l.include && !l.rate ? 'var(--status-danger-tint)' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: l.include ? '#0f766e' : '#94a3b8', textAlign: 'right' }}>{l.include ? `S$${(l.qty * l.rate).toLocaleString()}` : '—'}</span>
            <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} title="Remove line" style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'center' }}><X size={13} /></button>
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{emptyMsg}</div>}
    </div>
  );

  // Replaces renderInvoiceNumber(company) in the section header once that
  // company already has an invoice this cycle — editing never touches
  // DocNumber, so there's nothing to estimate/confirm here anymore.
  const renderEditHeader = (company: 'TAB' | 'TAC', invoice: GeneratedPdf | null) =>
    invoice ? (
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', fontSize: 11, fontWeight: 700, color: '#4338ca' }}>
        <Pencil size={12} /> Editing invoice #{displayInvoiceNo(invoice.invoiceNo)}
      </span>
    ) : renderInvoiceNumber(company);

  // Per-company Save button + result banner, shown instead of the combined
  // bottom Generate button once that company is in edit mode.
  const renderSaveButton = (company: 'TAB' | 'TAC', invoice: GeneratedPdf) => {
    const companyLines = company === 'TAB' ? includedTab : includedTac;
    const saving = !!savingEdit[company];
    const disabled = saving || !!editLoading[company] || companyLines.length === 0 || companyLines.some(l => !l.rate);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button
          onClick={() => saveInvoiceEdit(company)}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: disabled ? '#94a3b8' : '#4338ca', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
          {saving ? 'Saving…' : `Save ${company} changes to QuickBooks`}
        </button>
        {editResult[company] && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: editResult[company]!.ok ? '#15803d' : 'var(--status-danger)' }}>
            {editResult[company]!.ok ? '✓ ' : '✕ '}{editResult[company]!.msg}
            {editResult[company]!.blocked && (
              <button onClick={() => loadLiveLines(company, invoice.qbId)} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#4338ca', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: 11.5 }}>
                Reload latest from QuickBooks
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
    <div style={{ padding: '28px 20px', background: '#fff' }}>
      <div style={{ marginBottom: 12 }}>
        <ParentCompanyPicker
          companyId={c.resolvedCompanyId}
          parentCompanyId={parentOverride.id}
          parentCompanyName={parentOverride.name}
          onChange={(id, name) => setParentOverride({ id, name })}
        />
      </div>
      <BillToFields company={c} value={billTo} onChange={setBillTo} parentName={parentOverride.name} />
      {billToNotes.length > 0 && (
        <div style={{ marginBottom: 16, padding: '9px 11px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11.5, color: '#92400e' }}>
          {billToNotes.map((n, i) => <div key={i} style={{ marginBottom: i === billToNotes.length - 1 ? 0 : 4 }}>⚠ {n}</div>)}
        </div>
      )}
      {/* Header: contact + PIC + invoice date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com"
            style={{ ...inputStyle, width: 240, color: 'var(--accent-blue)', fontWeight: 600 }} />
        </div>
        {c.contactName && <span style={{ fontSize: 11, color: '#64748b' }}>· {c.contactName}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Invoice date</span>
          <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={inputStyle} />
        </div>
        {c.pic && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>SEC / XBRL PIC: <strong style={{ color: '#334155' }}>{formatStaffName(c.pic)}</strong></span>}
      </div>

      {/* TAB — basic services (Secretary/Address/AR/XBRL/Accounts/Tax/Discount).
          Layout mirrors the TAC section: badge header first, then the
          "based on last invoice" provenance note. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent-blue)', background: 'var(--status-info-tint)', border: '1px solid #dbeafe', borderRadius: 5, padding: '2px 8px' }}>TAB</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Basic Services</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>· default QuickBooks company</span>
        {renderEditHeader('TAB', tabInvoice)}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileText size={12} />
        {tabInvoice
          ? <span>Editing the real invoice — lines below are loaded live from QuickBooks, not a template.</span>
          : c.priorInvoiceDate
          ? <span>
              Based on last invoice
              {c.priorInvoiceNo && <strong style={{ color: 'var(--accent-blue)', fontFamily: 'monospace', margin: '0 5px', background: 'var(--status-info-tint)', border: '1px solid #dbeafe', padding: '1px 7px', borderRadius: 4 }}>#{c.priorInvoiceNo}</strong>}
              {' '}dated <strong style={{ color: '#334155' }}>{fmtDate(c.priorInvoiceDate)}</strong> — items & amounts carried forward, period rolled to this cycle. Verify discount still applies.
            </span>
          : <span style={{ color: 'var(--status-warning)' }}>No prior renewal invoice found — draft built from standard template. Confirm each line.</span>}
      </div>
      <div style={{ marginBottom: 0 }}>
        {editLoading.TAB ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>Loading live invoice lines from QuickBooks…</div>
        ) : editLoadError.TAB ? (
          <div style={{ padding: 12, borderRadius: 8, border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{editLoadError.TAB}</div>
        ) : renderTable(tabRows, 'No applicable services for this company.')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: '#f8fafc' }}>
          <Plus size={13} style={{ color: '#0f766e' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add line</span>
          <select value="" onChange={e => {
              const item = QB_CATALOG.find(x => x.item === e.target.value);
              if (!item) return;
              setLines(prev => [...prev, { service: item.service, productService: item.item, description: item.label, qty: 1, rate: item.rate, include: true, due: false, reason: 'Added manually' }]);
            }}
            style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
            <option value="">Choose a QuickBooks item…</option>
            {[...new Set(QB_CATALOG.filter(x => x.category !== 'Nominee').map(x => x.category))].map(cat => (
              <optgroup key={cat} label={cat}>
                {QB_CATALOG.filter(x => x.category === cat).map(x => (
                  <option key={x.item} value={x.item}>{x.label}{x.rate ? `  ·  S$${x.rate.toLocaleString()}` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {tabInvoice && renderSaveButton('TAB', tabInvoice)}
      </div>

      {/* TAC — Nominee Director only, and only shown when this company has an
          ND line at all (most companies never will). Gap between the TAB and
          TAC sections is 3x the normal section spacing (22 -> 66), with a
          dashed divider centred in it — visually separates the two invoices. */}
      {hasTac && (
        <>
          <div style={{ height: 66, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, borderTop: '1px dashed #e2e8f0' }} />
          </div>
          <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#9a3412', background: '#ffedd5', border: '1px solid #fed7aa', borderRadius: 5, padding: '2px 8px' }}>TAC</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Nominee Director</span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>· invoiced separately under the TAC company</span>
            {c.ndPic && (
              <span style={{ fontSize: 10.5, color: '#9a3412', background: 'var(--status-warning-tint)', border: '1px solid #fed7aa', borderRadius: 999, padding: '2px 8px', marginLeft: 3 }}>
                TAC PIC: <strong>{c.ndPic}</strong>{ndInitials ? ` · ${ndInitials} in service` : ' · confirm service shorthand'}
              </span>
            )}
            {tacStatus && !tacStatus.connected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--status-danger)', background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 5, padding: '2px 8px', marginLeft: 4 }}>
                <AlertTriangle size={11} />
                QuickBooks TAC not connected
                <a href="/api/quickbooks/auth?company=TAC" style={{ color: 'var(--accent-blue)', textDecoration: 'underline', fontWeight: 700 }}>Connect TAC</a>
              </span>
            )}
            {renderEditHeader('TAC', tacInvoice)}
          </div>
          {/* Provenance for the TAC invoice — mirrors the TAB note above. The
              ND draft line's item & fee come from this exact invoice. */}
          {tacInvoice ? (
            <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={12} />
              <span>Editing the real invoice — lines below are loaded live from QuickBooks, not a template.</span>
            </div>
          ) : (() => {
            const ndPrior = c.renewals.find(r => r.service === 'ND')?.history?.[0] ?? null;
            return (
              <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={12} />
                {ndPrior?.invoice_no
                  ? <span>
                      Based on last invoice
                      <strong style={{ color: '#9a3412', fontFamily: 'monospace', margin: '0 5px', background: '#ffedd5', border: '1px solid #fed7aa', padding: '1px 7px', borderRadius: 4 }}>#{displayInvoiceNo(ndPrior.invoice_no)}</strong>
                      {ndPrior.txn_date && <> dated <strong style={{ color: '#334155' }}>{fmtDate(ndPrior.txn_date)}</strong></>}
                      {' '}— ND fee &amp; director item carried forward, period rolled to this cycle.
                    </span>
                  : <span style={{ color: 'var(--status-warning)' }}>No prior ND invoice found — confirm the director&apos;s item &amp; fee before generating.</span>}
              </div>
            );
          })()}
          <div style={{ marginBottom: 0 }}>
            {editLoading.TAC ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>Loading live invoice lines from QuickBooks…</div>
            ) : editLoadError.TAC ? (
              <div style={{ padding: 12, borderRadius: 8, border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{editLoadError.TAC}</div>
            ) : renderTable(tacRows, 'No Nominee Director line.', 'amber')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: 'var(--status-warning-tint)' }}>
              <Plus size={13} style={{ color: '#9a3412' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add ND line</span>
              <select value="" onChange={e => {
                  const item = QB_CATALOG.find(x => x.item === e.target.value);
                  if (!item) return;
                  setLines(prev => [...prev, { service: item.service, productService: item.item, description: item.label, qty: 1, rate: item.rate, include: true, due: false, reason: 'Added manually' }]);
                }}
                style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
                <option value="">Choose a Nominee item…</option>
                {QB_CATALOG.filter(x => x.category === 'Nominee').map(x => (
                  <option key={x.item} value={x.item}>{x.label}{x.rate ? `  ·  S$${x.rate.toLocaleString()}` : ''}</option>
                ))}
              </select>
            </div>
            {tacInvoice && renderSaveButton('TAC', tacInvoice)}
          </div>
          </div>
        </>
      )}

      {/* Total + generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          <span style={{ color: '#64748b' }}>{included.length} line{included.length !== 1 ? 's' : ''} · Total </span>
          <strong style={{ fontSize: 17, color: '#0f766e' }}>S${total.toLocaleString()}</strong>
          {hasTac && includedTac.length > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>(TAB S${totalTab.toLocaleString()} · TAC S${totalTac.toLocaleString()})</span>
          )}
        </div>
        {missingRate && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>⚠ Fill in the highlighted rate(s) before generating</span>}
        {missingInvoiceNumber && !numberLoading && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>Confirm the required QB invoice number</span>}
        {hasPeriodError && (
          <div style={{ flexBasis: '100%', border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: '#b91c1c', borderRadius: 7, padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>
            Period check required: {blockingPeriodErrors.slice(0, 3).join(' · ')}
          </div>
        )}
        {!hasPeriodError && hasOverlapWarning && (
          <div style={{ flexBasis: '100%', border: '1px solid #fed7aa', background: 'var(--status-warning-tint)', color: '#9a3412', borderRadius: 7, padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>
            ⚠ {overlapWarnings.slice(0, 3).join(' · ')} — you can still generate; you&apos;ll be asked to confirm.
          </div>
        )}
        {showGenerateButton && (() => {
          const pendingTabCount = needsGenerateTab ? includedTab.length : 0;
          const pendingTacCount = needsGenerateTac ? includedTac.length : 0;
          const nothingPending = pendingTabCount + pendingTacCount === 0;
          const disabled = drafting || numberLoading || nothingPending || missingRate || missingInvoiceNumber || hasPeriodError;
          return (
            <button
              onClick={() => createInvoice()}
              disabled={disabled}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: disabled ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
              {
                drafting ? 'Generating…'
                : pendingTabCount && pendingTacCount ? 'Generate 2 Invoices (TAB + TAC)'
                : pendingTacCount ? 'Generate Invoice in QB (TAC)'
                : 'Generate Invoice in QB (TAB)'
              }
            </button>
          );
        })()}
      </div>

      {numberWarning && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7, padding: '9px 11px', borderRadius: 8, background: 'var(--status-warning-tint)', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, fontWeight: 650 }}>
          <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{numberWarning}</span>
        </div>
      )}

      {draftResult && (
        <div style={{ marginTop: 20, padding: '12px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: draftResult.ok ? 'var(--status-success-tint)' : 'var(--status-danger-tint)', color: draftResult.ok ? '#15803d' : 'var(--status-danger)',
          border: `1px solid ${draftResult.ok ? '#bbf7d0' : '#fecaca'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{draftResult.ok ? '✓ ' : '✕ '}{draftResult.msg}</span>
            {missingCustomerCompanies.map(company => (
              <button key={company} onClick={() => createCustomerAndRetry(company)} disabled={creatingCustomerFor[company]}
                style={{ marginLeft: company === missingCustomerCompanies[0] ? 'auto' : 0, padding: '6px 12px', borderRadius: 7, border: 'none', background: creatingCustomerFor[company] ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: creatingCustomerFor[company] ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                {creatingCustomerFor[company] ? 'Creating…' : `Create "${c.companyName}" in QB ${company}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {generatedPdfs.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 13px', borderRadius: 9, border: '1px solid #bfdbfe', background: '#f8fbff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1e3a5f' }}>Invoice PDF ready</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {generatedPdfs.map(pdf => `#${displayInvoiceNo(pdf.invoiceNo)}`).join(' · ')} · Windows Save As, without granting access to the whole folder
            </div>
          </div>
          {generatedPdfs.map(pdf => (
            <button key={`${pdf.company}-${pdf.qbId}`} type="button" onClick={() => saveInvoicePdf(pdf)} disabled={savingPdfs} style={{ border: '1px solid #93c5fd', borderRadius: 7, background: savingPdfs ? '#dbeafe' : 'var(--status-info-tint)', color: 'var(--accent-blue)', padding: '8px 12px', fontSize: 11.5, fontWeight: 800, cursor: savingPdfs ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={13} /> {savingPdfs ? 'Preparing PDF…' : `Save ${pdf.company} PDF`}
            </button>
          ))}
        </div>
      )}

      {pdfResult && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 650, color: pdfResult.ok ? '#15803d' : 'var(--status-warning)' }}>{pdfResult.msg}</div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 24, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
    {overlapConfirmModal && (
      <div onClick={() => setOverlapConfirmModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--status-warning-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <AlertTriangle size={20} style={{ color: 'var(--status-warning)' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>This period overlaps an existing invoice</div>
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 1.5 }}>
            {overlapConfirmModal.map((msg, i) => <div key={i} style={{ marginBottom: 4 }}>{msg}</div>)}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
            If this is genuinely a special case (a correction, a split invoice, etc.), you can generate it anyway. Otherwise, cancel and check the period or the company&apos;s existing invoices first.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOverlapConfirmModal(null)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => { setOverlapConfirmModal(null); void createInvoice(true); }}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--status-warning)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Generate anyway
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
