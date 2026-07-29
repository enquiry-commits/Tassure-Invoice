'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  FilePlus2,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';
import {
  getHelperHealth,
  isHelperOutdated,
  openDraftsInOutlook,
  type DraftLike,
  type DraftOpenResult,
} from '@/lib/draft-helper-client';

const FYE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TYPE_LABEL: Record<CampaignType, string> = {
  ar: 'AR Renewal',
  soa: 'Statement of Account',
  letter: 'Document Letter',
};

type CampaignType = 'ar' | 'soa' | 'letter';

interface Template {
  id: number;
  type: CampaignType;
  name: string;
  subject_template: string;
  body_template: string;
  is_default: boolean;
}

interface Sender {
  id: number;
  email: string;
  display_name: string | null;
  is_default: boolean;
}

interface InvoiceRef {
  qbCompany: 'TAB' | 'TAC' | 'TAO';
  invoiceNo: string;
  amount: number;
  qbInvoiceId?: string | null;
}

interface WorkbenchRow {
  companyName: string;
  companyId: number | null;
  toEmail: string | null;
  ccEmail: string | null;
  contactName: string;
  invoiceRefs: InvoiceRef[];
  totalAmount: number;
  included: boolean;
  reason: string | null;
  recipientSource: 'teamwork_report' | 'company_fallback' | 'missing';
  recipientSyncedAt: string | null;
  recipientReviewRequired: boolean;
}

interface CreatedDraft extends DraftLike {
  id: number;
  version: number;
}

interface CompanySearchHit {
  companyName: string;
}

interface AuthUser {
  email: string;
  name: string;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid #d9e2ec',
  borderRadius: 7,
  padding: '7px 9px',
  background: '#fff',
  color: '#18324f',
  fontSize: 12,
  outline: 'none',
};

function rowKey(row: Pick<WorkbenchRow, 'companyId' | 'companyName'>) {
  return row.companyId ? String(row.companyId) : row.companyName.trim().toLowerCase();
}

function splitRecipients(value: string | null) {
  return (value ?? '').split(/[;,\n\r]+/).map(v => v.trim()).filter(Boolean);
}

function recipientLines(value: string | null) {
  return splitRecipients(value).join('\n');
}

function hasEmail(value: string | null) {
  return splitRecipients(value).some(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

function invoiceLabel(ref: InvoiceRef) {
  return `${ref.qbCompany} #${ref.invoiceNo}`;
}

function getRowWarnings(
  row: WorkbenchRow,
  type: CampaignType,
  manualFileCount: number,
) {
  const warnings: string[] = [];
  if (!row.contactName.trim()) warnings.push('Missing User Name');
  if (!hasEmail(row.toEmail)) warnings.push('Missing valid To email');
  if (row.recipientReviewRequired) warnings.push('Recipient requires review');
  if (type !== 'letter' && row.invoiceRefs.length === 0 && manualFileCount === 0) {
    warnings.push('No invoice or manual attachment');
  }
  const unsupported = row.invoiceRefs.filter(
    ref => ref.qbCompany === 'TAO' || !ref.qbInvoiceId,
  );
  if (unsupported.length > manualFileCount) {
    warnings.push(`${unsupported.length} invoice file(s) need manual attachment`);
  }
  return warnings;
}

function templateShortName(template: Template) {
  const upper = template.name.toUpperCase();
  if (upper.includes('AR1')) return 'AR1';
  if (upper.includes('AR2')) return 'AR2';
  if (upper.includes('AR3')) return 'AR3';
  return template.name;
}

export default function EmailDraftWorkbenchPage() {
  const now = new Date();
  const [type, setType] = useState<CampaignType>('ar');
  const [fyeMonth, setFyeMonth] = useState(FYE_MONTHS[now.getMonth()]);
  const [fyeYear, setFyeYear] = useState(String(now.getFullYear()));
  const [templates, setTemplates] = useState<Template[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [senderId, setSenderId] = useState<number | null>(null);
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [letterCompanies, setLetterCompanies] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [helperAvailable, setHelperAvailable] = useState<boolean | null>(null);
  const [helperOutdated, setHelperOutdated] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [commonFiles, setCommonFiles] = useState<File[]>([]);
  const [rowFiles, setRowFiles] = useState<Record<string, File[]>>({});
  const [lastCreated, setLastCreated] = useState<CreatedDraft[]>([]);
  const [lastOpenResults, setLastOpenResults] = useState<DraftOpenResult[]>([]);
  const [addName, setAddName] = useState('');
  const [addResults, setAddResults] = useState<CompanySearchHit[]>([]);
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTemplate = templates.find(t => t.id === templateId) ?? null;
  const selectedSender = senders.find(s => s.id === senderId) ?? null;
  const typeTemplates = templates.filter(t => t.type === type);

  const recheckHelper = useCallback(() => {
    getHelperHealth().then(health => {
      setHelperAvailable(health !== null);
      setHelperOutdated(isHelperOutdated(health));
    });
  }, []);

  useEffect(() => {
    recheckHelper();
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : { user: null })
      .then(j => setMe(j.user ?? null))
      .catch(() => setMe(null));
    fetch('/api/ar-reminder/latest')
      .then(r => r.json())
      .then(({ month, year }) => {
        if (month) setFyeMonth(String(month));
        if (year) setFyeYear(String(year));
      })
      .catch(() => {});
  }, [recheckHelper]);

  useEffect(() => {
    Promise.all([
      fetch('/api/client-communications/templates').then(r => r.json()),
      fetch('/api/client-communications/senders').then(r => r.json()),
    ]).then(([templateJson, senderJson]) => {
      const loadedTemplates = (templateJson.data ?? []) as Template[];
      const loadedSenders = (senderJson.data ?? []) as Sender[];
      setTemplates(loadedTemplates);
      setSenders(loadedSenders);
      const defaultTemplate = loadedTemplates.find(t => t.type === 'ar' && t.is_default)
        ?? loadedTemplates.find(t => t.type === 'ar');
      setTemplateId(defaultTemplate?.id ?? null);
      const defaultSender = loadedSenders.find(s => s.is_default) ?? loadedSenders[0];
      setSenderId(defaultSender?.id ?? null);
    }).catch(() => setMessage({ tone: 'error', text: 'Unable to load templates or senders.' }));
  }, []);

  const chooseType = (nextType: CampaignType) => {
    const nextTemplates = templates.filter(template => template.type === nextType);
    const match = nextTemplates.find(template => template.is_default) ?? nextTemplates[0];
    setType(nextType);
    setTemplateId(match?.id ?? null);
    setRows([]);
    setRowFiles({});
    setLastCreated([]);
    setLastOpenResults([]);
    setMessage(null);
  };

  const includedRows = useMemo(() => rows.filter(row => row.included), [rows]);
  const readyCount = useMemo(() => rows.filter(row => {
    const warnings = getRowWarnings(row, type, rowFiles[rowKey(row)]?.length ?? 0);
    return warnings.length === 0;
  }).length, [rowFiles, rows, type]);
  const warningCount = rows.length - readyCount;

  const updateRow = (index: number, patch: Partial<WorkbenchRow>) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setLastCreated([]);
    setLastOpenResults([]);
  };

  const loadCompanies = async () => {
    if (!templateId) {
      setMessage({ tone: 'error', text: 'Choose a template first.' });
      return;
    }
    const companyNames = type === 'letter'
      ? letterCompanies.split('\n').map(v => v.trim()).filter(Boolean)
      : undefined;
    if (type === 'letter' && !companyNames?.length) {
      setMessage({ tone: 'error', text: 'Enter at least one company name for this letter batch.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    setLastCreated([]);
    setLastOpenResults([]);
    try {
      const response = await fetch('/api/client-communications/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          companyNames,
          onlyUnsent: true,
          fyeMonth: type === 'ar' ? fyeMonth : undefined,
          fyeYear: type === 'ar' ? Number(fyeYear) : undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Unable to load companies.');
      setRows((json.rows ?? []).map((row: WorkbenchRow) => ({
        ...row,
        toEmail: recipientLines(row.toEmail),
        ccEmail: recipientLines(row.ccEmail),
      })));
      if (!json.rows?.length) {
        setMessage({ tone: 'warning', text: 'No companies matched this selection.' });
      }
    } catch (e: unknown) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Unable to load companies.' });
    } finally {
      setLoading(false);
    }
  };

  const searchCompanies = (term: string) => {
    setAddName(term);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!term.trim()) {
      setAddResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const response = await fetch(`/api/companies?search=${encodeURIComponent(term.trim())}`);
      const json = await response.json();
      const existing = new Set(rows.map(row => row.companyName.toLowerCase()));
      setAddResults((json.data ?? [])
        .filter((company: CompanySearchHit) => !existing.has(company.companyName.toLowerCase()))
        .slice(0, 8));
    }, 300);
  };

  const addCompany = async (companyName: string) => {
    setAdding(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ lookup: companyName, type });
      if (type === 'ar') {
        params.set('fyeMonth', fyeMonth);
        params.set('fyeYear', fyeYear);
      }
      const response = await fetch(`/api/client-communications/campaigns/preview?${params}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Company not found.');
      const row = json.row as WorkbenchRow;
      setRows(current => [...current, {
        ...row,
        toEmail: recipientLines(row.toEmail),
        ccEmail: recipientLines(row.ccEmail),
      }].sort((a, b) => a.companyName.localeCompare(b.companyName)));
      setAddName('');
      setAddResults([]);
      setLastCreated([]);
    } catch (e: unknown) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Unable to add company.' });
    } finally {
      setAdding(false);
    }
  };

  const markOpened = async (draft: CreatedDraft) => {
    const response = await fetch('/api/client-communications/drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: draft.id,
        version: draft.version,
        patch: { status: 'opened' },
        sentByEmail: me?.email,
        sentByName: me?.name,
      }),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw new Error(json.error ?? 'Opened draft could not be recorded.');
    }
  };

  const openCreatedDrafts = async (drafts: CreatedDraft[]) => {
    if (!selectedSender) throw new Error('Choose a sender first.');
    const prepared = drafts.map(draft => {
      const matchingRow = rows.find(row => row.companyName === draft.company_name);
      return {
        ...draft,
        sender_email: selectedSender.email,
        additional_attachments: matchingRow ? rowFiles[rowKey(matchingRow)] ?? [] : [],
      };
    });
    const results = await openDraftsInOutlook(prepared, commonFiles);
    await Promise.all(results.map(async (result, index) => {
      if (!result.ok) return;
      try {
        await markOpened(drafts[index]);
      } catch {
        // The Outlook draft is already open; keep the per-draft result as a
        // success and report the audit warning in the batch summary instead.
      }
    }));
    return results;
  };

  const createAndOpen = async () => {
    if (!selectedTemplate || !selectedSender) {
      setMessage({ tone: 'error', text: 'Choose a template and sender first.' });
      return;
    }
    if (!includedRows.length) {
      setMessage({ tone: 'error', text: 'Select at least one company.' });
      return;
    }
    const hardInvalid = includedRows.filter(row =>
      !row.contactName.trim() || !hasEmail(row.toEmail),
    );
    if (hardInvalid.length) {
      setMessage({
        tone: 'error',
        text: `${hardInvalid.length} selected row(s) are missing User Name or a valid To email.`,
      });
      return;
    }
    if (!helperAvailable) {
      setMessage({
        tone: 'error',
        text: 'Tassure Draft Helper is not running. Download or start it, then click Recheck.',
      });
      return;
    }

    setCreating(true);
    setMessage(null);
    try {
      const batchName = type === 'ar'
        ? `${templateShortName(selectedTemplate)} - FYE ${fyeMonth} ${fyeYear}`
        : `${TYPE_LABEL[type]} - ${new Date().toISOString().slice(0, 10)}`;
      const response = await fetch('/api/client-communications/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: batchName,
          templateId,
          senderId,
          fyeMonth: type === 'ar' ? fyeMonth : undefined,
          fyeYear: type === 'ar' ? Number(fyeYear) : undefined,
          companies: includedRows.map(row => ({
            companyName: row.companyName,
            companyId: row.companyId,
            contactName: row.contactName.trim(),
            toEmail: row.toEmail,
            ccEmail: row.ccEmail,
            invoiceRefs: row.invoiceRefs,
            totalAmount: row.totalAmount,
          })),
          createdByEmail: me?.email,
          createdByName: me?.name,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Unable to prepare drafts.');
      const created = (json.drafts ?? []) as CreatedDraft[];
      setLastCreated(created);
      if (!created.length) throw new Error('No drafts were created.');
      const results = await openCreatedDrafts(created);
      setLastOpenResults(results);
      const opened = results.filter(result => result?.ok).length;
      const failed = results.length - opened;
      setMessage({
        tone: failed ? 'warning' : 'success',
        text: failed
          ? `${opened} Outlook draft(s) opened. ${failed} need attention below. Nothing was sent automatically.`
          : `${opened} Outlook draft(s) opened with attachments. Review and send them in Outlook.`,
      });
    } catch (e: unknown) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Unable to create drafts.' });
    } finally {
      setCreating(false);
    }
  };

  const retryFailed = async () => {
    const failedIndexes = lastCreated
      .map((_, index) => (!lastOpenResults[index]?.ok ? index : -1))
      .filter(index => index >= 0);
    const failedDrafts = failedIndexes.map(index => lastCreated[index]);
    if (!failedDrafts.length) return;
    setCreating(true);
    try {
      const results = await openCreatedDrafts(failedDrafts);
      const mergedResults = [...lastOpenResults];
      failedIndexes.forEach((originalIndex, retryIndex) => {
        mergedResults[originalIndex] = results[retryIndex];
      });
      setLastOpenResults(mergedResults);
      const opened = results.filter(result => result?.ok).length;
      setMessage({
        tone: opened === results.length ? 'success' : 'warning',
        text: `${opened} of ${results.length} retry draft(s) opened in Outlook.`,
      });
    } finally {
      setCreating(false);
    }
  };

  const setRowAttachmentFiles = (row: WorkbenchRow, files: FileList | null) => {
    setRowFiles(current => ({ ...current, [rowKey(row)]: files ? Array.from(files) : [] }));
    setLastCreated([]);
    setLastOpenResults([]);
  };

  const setBatchAttachmentFiles = (files: FileList | null) => {
    setCommonFiles(files ? Array.from(files) : []);
    setLastCreated([]);
    setLastOpenResults([]);
  };

  const selectAllReady = () => {
    setRows(current => current.map(row => {
      const warnings = getRowWarnings(row, type, rowFiles[rowKey(row)]?.length ?? 0);
      return { ...row, included: warnings.length === 0 };
    }));
  };

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, color: '#102f50', fontSize: 22, fontWeight: 800 }}>Email Drafts</h1>
          <div style={{ color: '#718399', fontSize: 12, marginTop: 3 }}>
            Prepare a batch here, then complete the final review and sending in Outlook.
          </div>
        </div>
        <Link href="/client-communications/templates" title="Templates & Senders"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: '#526b85', textDecoration: 'none', fontSize: 12, fontWeight: 700, padding: '7px 10px', border: '1px solid #dbe4ed', borderRadius: 7, background: '#fff' }}>
          <Settings size={14} /> Settings
        </Link>
      </div>

      <section style={{ background: '#fff', border: '1px solid #dfe7ef', borderRadius: 11, padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {(Object.keys(TYPE_LABEL) as CampaignType[]).map(value => (
            <button key={value} onClick={() => chooseType(value)}
              style={{ border: `1px solid ${type === value ? '#173b63' : '#d9e2ec'}`, borderRadius: 7, padding: '7px 13px', background: type === value ? '#173b63' : '#fff', color: type === value ? '#fff' : '#526b85', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {TYPE_LABEL[value]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) repeat(3,minmax(130px,0.8fr)) auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', color: '#718399', fontSize: 10.5, fontWeight: 700, marginBottom: 4 }}>TEMPLATE</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {typeTemplates.map(template => (
                <button key={template.id} onClick={() => setTemplateId(template.id)}
                  title={template.name}
                  style={{ border: `1px solid ${templateId === template.id ? '#15803d' : '#d9e2ec'}`, borderRadius: 6, padding: '7px 10px', background: templateId === template.id ? '#f0fdf4' : '#fff', color: templateId === template.id ? '#15803d' : '#526b85', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                  {templateShortName(template)}
                </button>
              ))}
            </div>
          </div>

          {type === 'ar' ? (
            <>
              <div>
                <label style={{ display: 'block', color: '#718399', fontSize: 10.5, fontWeight: 700, marginBottom: 4 }}>FYE MONTH</label>
                <select value={fyeMonth} onChange={e => setFyeMonth(e.target.value)} style={fieldStyle}>
                  {FYE_MONTHS.map(month => <option key={month}>{month}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', color: '#718399', fontSize: 10.5, fontWeight: 700, marginBottom: 4 }}>FYE YEAR</label>
                <select value={fyeYear} onChange={e => setFyeYear(e.target.value)} style={fieldStyle}>
                  {['2024', '2025', '2026', '2027', '2028'].map(year => <option key={year}>{year}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', color: '#718399', fontSize: 10.5, fontWeight: 700, marginBottom: 4 }}>
                {type === 'letter' ? 'COMPANY NAMES — ONE PER LINE' : 'SOURCE'}
              </label>
              {type === 'letter' ? (
                <textarea value={letterCompanies} onChange={e => setLetterCompanies(e.target.value)}
                  rows={2} placeholder={'ABC PTE. LTD.\nXYZ PTE. LTD.'}
                  style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              ) : (
                <div style={{ ...fieldStyle, background: '#f8fafc', color: '#526b85' }}>All customers with an outstanding QuickBooks balance</div>
              )}
            </div>
          )}

          <div>
            <label style={{ display: 'block', color: '#718399', fontSize: 10.5, fontWeight: 700, marginBottom: 4 }}>OUTLOOK SENDER</label>
            <select value={senderId ?? ''} onChange={e => setSenderId(Number(e.target.value))} style={fieldStyle}>
              {senders.map(sender => (
                <option key={sender.id} value={sender.id}>
                  {sender.display_name ? `${sender.display_name} — ` : ''}{sender.email}
                </option>
              ))}
            </select>
          </div>

          <button onClick={loadCompanies} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, border: 0, borderRadius: 7, padding: '0 15px', background: '#173b63', color: '#fff', fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {rows.length ? 'Reload' : 'Load Companies'}
          </button>
        </div>

        {selectedTemplate && (
          <details style={{ marginTop: 10, color: '#718399', fontSize: 11 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Template: {selectedTemplate.name}</summary>
            <div style={{ marginTop: 7, padding: 9, borderRadius: 7, background: '#f8fafc', whiteSpace: 'pre-wrap' }}>
              <strong>Subject:</strong> {selectedTemplate.subject_template}
              <br /><br />
              {selectedTemplate.body_template}
            </div>
          </details>
        )}
      </section>

      {rows.length > 0 && (
        <>
          <section style={{ background: '#fff', border: '1px solid #dfe7ef', borderRadius: 11, marginBottom: 12, overflow: 'visible' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #e6edf3', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#18324f' }}>{rows.length} companies</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#15803d', flexShrink: 0 }} />{readyCount} ready
              </span>
              {warningCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#b45309', flexShrink: 0 }} />{warningCount} need review
                </span>
              )}
              <button onClick={selectAllReady}
                style={{ border: 0, background: 'transparent', color: '#1d4ed8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Select ready rows
              </button>

              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: '#94a3b8' }} />
                <input value={addName} onChange={e => searchCompanies(e.target.value)}
                  placeholder="Add another company…"
                  style={{ ...fieldStyle, width: 230, paddingLeft: 29 }} />
                {addResults.length > 0 && (
                  <div style={{ position: 'absolute', zIndex: 30, top: 37, left: 0, right: 0, background: '#fff', border: '1px solid #d9e2ec', borderRadius: 7, boxShadow: '0 8px 20px rgba(15,23,42,.12)', overflow: 'hidden' }}>
                    {addResults.map(company => (
                      <button key={company.companyName} onClick={() => addCompany(company.companyName)}
                        disabled={adding}
                        style={{ display: 'block', width: '100%', border: 0, borderBottom: '1px solid #edf2f7', background: '#fff', textAlign: 'left', padding: '8px 10px', color: '#18324f', fontSize: 11, cursor: 'pointer' }}>
                        {company.companyName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 390px)', overflowY: 'auto' }}>
              <div style={{ minWidth: 1260 }}>
                <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'grid', gridTemplateColumns: '42px minmax(190px,1.3fr) 135px minmax(180px,1.2fr) minmax(180px,1.2fr) minmax(150px,1fr) 90px 150px 32px', gap: 8, padding: '8px 10px', background: '#f5f8fb', borderBottom: '1px solid #dfe7ef', color: '#60758c', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                  <div>Draft</div><div>Company</div><div>User Name</div><div>To</div><div>CC</div><div>Invoices / Files</div><div style={{ textAlign: 'right' }}>Amount</div><div>Status</div><div />
                </div>

                {rows.map((row, index) => {
                  const files = rowFiles[rowKey(row)] ?? [];
                  const warnings = getRowWarnings(row, type, files.length);
                  return (
                    <div key={rowKey(row)}
                      style={{ display: 'grid', gridTemplateColumns: '42px minmax(190px,1.3fr) 135px minmax(180px,1.2fr) minmax(180px,1.2fr) minmax(150px,1fr) 90px 150px 32px', gap: 8, alignItems: 'start', padding: '9px 10px', borderBottom: '1px solid #edf2f7', background: row.included ? '#fff' : '#fbfcfd' }}>
                      <div style={{ textAlign: 'center', paddingTop: 6 }}>
                        <input type="checkbox" checked={row.included} onChange={() => updateRow(index, { included: !row.included })} title="Y = create an Outlook draft; this does not send the email" />
                      </div>
                      <div>
                        <div style={{
                          color: '#1e3a5f',
                          fontSize: 14,
                          fontWeight: 700,
                          lineHeight: 1.3,
                          fontFamily: 'inherit',
                          letterSpacing: 'normal',
                        }}>
                          {row.companyName}
                        </div>
                        {(() => {
                          const src = row.recipientSource === 'teamwork_report'
                            ? { label: 'TEAMWORK REPORT', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
                            : row.recipientSource === 'company_fallback'
                            ? { label: 'FALLBACK — REVIEW', bg: '#fffbeb', color: '#b45309', border: '#fde68a' }
                            : { label: 'NO RECIPIENT SOURCE', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', borderRadius: 999, background: src.bg, color: src.color, border: `1px solid ${src.border}`, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                              <span style={{ width: 4, height: 4, borderRadius: '50%', background: src.color, flexShrink: 0 }} />{src.label}
                            </span>
                          );
                        })()}
                      </div>
                      <input value={row.contactName} onChange={e => updateRow(index, { contactName: e.target.value })}
                        placeholder="Greeting name" style={fieldStyle} />
                      <textarea value={row.toEmail ?? ''} onChange={e => updateRow(index, { toEmail: e.target.value })}
                        rows={Math.max(2, Math.min(4, splitRecipients(row.toEmail).length))}
                        placeholder={'customer@email.com\nsecond@email.com'}
                        style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.35 }} />
                      <textarea value={row.ccEmail ?? ''} onChange={e => updateRow(index, { ccEmail: e.target.value })}
                        rows={Math.max(2, Math.min(4, splitRecipients(row.ccEmail).length))}
                        placeholder={'hoechyi@tassure.com\nother@email.com'}
                        style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.35 }} />
                      <div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {row.invoiceRefs.map((ref, refIndex) => (
                            <span key={`${ref.qbCompany}-${ref.invoiceNo}-${refIndex}`}
                              title={`S$${ref.amount.toLocaleString()}${ref.qbInvoiceId ? ' — PDF available' : ' — add file manually'}`}
                              style={{ padding: '2px 5px', borderRadius: 4, background: ref.qbInvoiceId && ref.qbCompany !== 'TAO' ? '#eff6ff' : '#fff7ed', color: ref.qbInvoiceId && ref.qbCompany !== 'TAO' ? '#1d4ed8' : '#b45309', fontSize: 9.5, fontWeight: 800 }}>
                              {invoiceLabel(ref)}
                            </span>
                          ))}
                          {!row.invoiceRefs.length && <span style={{ color: '#94a3b8', fontSize: 10 }}>No system invoice</span>}
                        </div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, color: '#526b85', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                          <FilePlus2 size={12} /> {files.length ? `${files.length} manual file(s)` : 'Add files'}
                          <input type="file" multiple hidden onChange={e => setRowAttachmentFiles(row, e.target.files)} />
                        </label>
                      </div>
                      <div style={{ textAlign: 'right', paddingTop: 6, color: '#0f766e', fontSize: 11.5, fontWeight: 800 }}>
                        {row.totalAmount ? `S$${row.totalAmount.toLocaleString()}` : '—'}
                      </div>
                      <div style={{ paddingTop: 3 }}>
                        {warnings.length === 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#15803d', fontSize: 10, fontWeight: 800 }}><Check size={12} /> Ready</span>
                        ) : warnings.map(warning => (
                          <div key={warning} style={{ display: 'flex', alignItems: 'flex-start', gap: 3, color: '#b45309', fontSize: 9.5, lineHeight: 1.3, marginBottom: 3 }}>
                            <AlertTriangle size={10} style={{ marginTop: 1, flexShrink: 0 }} /> {warning}
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setRows(current => current.filter((_, i) => i !== index))}
                        title="Remove row"
                        style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: '#fff', border: '1px solid #dfe7ef', borderRadius: 11, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#526b85', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              <Paperclip size={13} />
              {commonFiles.length ? `${commonFiles.length} common attachment(s)` : 'Add common attachment to every draft'}
              <input type="file" multiple hidden onChange={e => setBatchAttachmentFiles(e.target.files)} />
            </label>
            {commonFiles.map(file => (
              <span key={`${file.name}-${file.size}`} style={{ padding: '2px 6px', borderRadius: 4, background: '#f1f5f9', color: '#526b85', fontSize: 9.5 }}>{file.name}</span>
            ))}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {helperAvailable === false ? (
                <>
                  <a href="/downloads/TassureDraftHelper.exe" download
                    style={{ color: '#b45309', fontSize: 11, fontWeight: 800 }}>Download Outlook Helper</a>
                  <button onClick={recheckHelper} style={{ border: '1px solid #d9e2ec', background: '#fff', borderRadius: 6, padding: '7px 10px', color: '#526b85', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Recheck</button>
                </>
              ) : helperAvailable && helperOutdated ? (
                <>
                  <a href="/downloads/TassureDraftHelper.exe" download
                    style={{ color: '#b45309', fontSize: 11, fontWeight: 800 }}>Update Outlook Helper (new version available)</a>
                  <button onClick={recheckHelper} style={{ border: '1px solid #d9e2ec', background: '#fff', borderRadius: 6, padding: '7px 10px', color: '#526b85', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Recheck</button>
                </>
              ) : (
                <span style={{ color: helperAvailable ? '#15803d' : '#718399', fontSize: 10.5, fontWeight: 700 }}>
                  {helperAvailable ? 'Outlook Helper ready' : 'Checking Outlook Helper…'}
                </span>
              )}
              <button onClick={createAndOpen} disabled={creating || !includedRows.length || !helperAvailable}
                style={{ display: 'flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 8, padding: '9px 16px', background: '#0f766e', color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: creating ? 'wait' : 'pointer', opacity: creating || !includedRows.length || !helperAvailable ? 0.55 : 1 }}>
                {creating ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}
                {creating ? 'Preparing & Opening…' : `Create ${includedRows.length} Outlook Draft${includedRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </section>
        </>
      )}

      {message && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, border: `1px solid ${message.tone === 'success' ? '#bbf7d0' : message.tone === 'warning' ? '#fed7aa' : '#fecaca'}`, background: message.tone === 'success' ? '#f0fdf4' : message.tone === 'warning' ? '#fff7ed' : '#fef2f2', color: message.tone === 'success' ? '#15803d' : message.tone === 'warning' ? '#b45309' : '#b91c1c', fontSize: 11.5, fontWeight: 700 }}>
          {message.text}
          {lastOpenResults.some(result => result && !result.ok) && (
            <button onClick={retryFailed} disabled={creating}
              style={{ marginLeft: 10, border: '1px solid currentColor', background: '#fff', borderRadius: 5, padding: '3px 8px', color: 'inherit', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}>
              Retry failed drafts
            </button>
          )}
        </div>
      )}

      {lastOpenResults.some(result => result && !result.ok) && (
        <div style={{ marginTop: 8, background: '#fff', border: '1px solid #fed7aa', borderRadius: 8, padding: 10 }}>
          {lastOpenResults.map((result, index) => !result?.ok ? (
            <div key={index} style={{ color: '#b45309', fontSize: 10.5, marginBottom: 3 }}>
              {lastCreated[index]?.company_name ?? `Draft ${index + 1}`}: {result?.error ?? 'Unable to open.'}
            </div>
          ) : null)}
        </div>
      )}

      {!rows.length && !loading && (
        <div style={{ padding: '38px 20px', textAlign: 'center', color: '#718399', background: '#fff', border: '1px dashed #cfdbe7', borderRadius: 11 }}>
          <Plus size={18} style={{ margin: '0 auto 8px' }} />
          <div style={{ fontSize: 12, fontWeight: 700 }}>Choose a template and load a company batch.</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>Y means “create an Outlook draft”; this page never sends email automatically.</div>
        </div>
      )}

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
