'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FilePlus2,
  Loader2,
  Mail,
  Paperclip,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import {
  checkHelperHealth,
  openDraftsInOutlook,
} from '@/lib/draft-helper-client';

interface InvoiceRef {
  qbCompany: 'TAB' | 'TAC' | 'TAO';
  invoiceNo: string;
  amount: number;
  qbInvoiceId?: string | null;
}

interface HistoryRow {
  id: number;
  version: number;
  company_name: string;
  contact_name: string | null;
  to_email: string | null;
  cc_email: string | null;
  subject: string;
  body: string;
  invoice_refs: InvoiceRef[];
  status: 'pending' | 'opened' | 'sent' | 'skipped';
  total_amount: number | null;
  opened_at: string | null;
  opened_by_name: string | null;
  sent_at: string | null;
  sent_by_name: string | null;
  email_campaigns: {
    type: string;
    name: string;
    fye_month: string | null;
    fye_year: number | null;
    email_senders: {
      email: string;
      display_name: string | null;
    } | null;
  };
}

interface AuthUser {
  email: string;
  name: string;
}

interface Sender {
  id: number;
  email: string;
  display_name: string | null;
  is_default: boolean;
}

const TYPE_LABEL: Record<string, string> = { ar: 'AR', soa: 'SOA', letter: 'Letter' };
const STATUS_LABEL: Record<string, string> = {
  pending: 'Prepared',
  opened: 'Opened in Outlook',
  sent: 'Confirmed Sent',
  skipped: 'Skipped',
};
const S: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13,
  background: '#fff',
  outline: 'none',
  color: '#1e3a5f',
};

function statusAccent(status: HistoryRow['status']) {
  if (status === 'sent') return '#16a34a';
  if (status === 'opened') return '#2563eb';
  if (status === 'skipped') return '#94a3b8';
  return '#c2410c';
}

function formatMoney(value: number | null | undefined) {
  return value != null ? `S$${Number(value).toLocaleString()}` : '—';
}

export default function DeliveryHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<HistoryRow | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [reopenSenderEmail, setReopenSenderEmail] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [working, setWorking] = useState<'open' | 'sent' | 'skip' | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HistoryRow | null>(null);

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (search) next.set('search', search);
    if (type) next.set('type', type);
    if (status) next.set('status', status);
    return next.toString();
  }, [search, type, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`/api/client-communications/drafts?${params}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Unable to load email activity.');
      const nextRows = (json.data ?? []) as HistoryRow[];
      setRows(nextRows);
      setSelected(current => {
        if (!current) return null;
        return nextRows.find(row => row.id === current.id) ?? null;
      });
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load email activity.');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then(response => response.ok ? response.json() : { user: null }),
      fetch('/api/client-communications/senders').then(response => response.ok ? response.json() : { data: [] }),
    ])
      .then(([authJson, senderJson]) => {
        setMe(authJson.user ?? null);
        setSenders(senderJson.data ?? []);
      })
      .catch(() => {
        setMe(null);
        setSenders([]);
      });
  }, []);

  const openDetails = (row: HistoryRow) => {
    const campaignSender = row.email_campaigns?.email_senders?.email;
    const fallbackSender = senders.find(sender => sender.is_default) ?? senders[0];
    setSelected(row);
    setReopenSenderEmail(campaignSender ?? fallbackSender?.email ?? '');
    setManualFiles([]);
    setMessage(null);
  };

  const closeDetails = () => {
    if (working) return;
    setSelected(null);
    setReopenSenderEmail('');
    setManualFiles([]);
    setMessage(null);
  };

  const updateStatus = async (
    nextStatus: 'opened' | 'sent' | 'skipped',
    currentDraft = selected,
  ) => {
    if (!currentDraft) return false;
    const response = await fetch('/api/client-communications/drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentDraft.id,
        version: currentDraft.version,
        patch: { status: nextStatus },
        sentByEmail: me?.email,
        sentByName: me?.name,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error ?? 'Unable to update this draft.');
    await load();
    return true;
  };

  const reopenInOutlook = async () => {
    if (!selected) return;
    if (!reopenSenderEmail) {
      setMessage({
        tone: 'error',
        text: 'Choose an Outlook sender account before reopening this draft.',
      });
      return;
    }

    setWorking('open');
    setMessage(null);
    try {
      const helperReady = await checkHelperHealth(1500);
      if (!helperReady) {
        throw new Error('Tassure Draft Helper is not running. Start it, then try again.');
      }
      const [result] = await openDraftsInOutlook([{
        ...selected,
        sender_email: reopenSenderEmail,
        additional_attachments: manualFiles,
      }]);
      if (!result?.ok) throw new Error(result?.error ?? 'Outlook did not open this draft.');
      try {
        await updateStatus('opened', selected);
      } catch (auditError: unknown) {
        setMessage({
          tone: 'warning',
          text: `The email opened in Outlook, but the activity record could not be updated: ${
            auditError instanceof Error ? auditError.message : 'refresh and check the latest status.'
          }`,
        });
        return;
      }
      setMessage({
        tone: result.amountCorrected ? 'warning' : 'success',
        text: result.amountCorrected
          ? `The email has been opened again in Outlook. The amount was corrected from S$${result.previousTotal?.toLocaleString()} to S$${result.newTotal?.toLocaleString()} using the latest QuickBooks total — review it there before sending.`
          : 'The email has been opened again in Outlook. Review it there before sending.',
      });
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to reopen this draft.',
      });
    } finally {
      setWorking(null);
    }
  };

  const markAsSent = async () => {
    if (!selected) return;
    setWorking('sent');
    setMessage(null);
    try {
      await updateStatus('sent', selected);
      setMessage({
        tone: 'success',
        text: 'Marked as Confirmed Sent. This records staff confirmation; the system did not send the email.',
      });
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to confirm this draft as sent.',
      });
    } finally {
      setWorking(null);
    }
  };

  const skipDraft = async () => {
    if (!selected) return;
    setWorking('skip');
    setMessage(null);
    try {
      await updateStatus('skipped', selected);
      setMessage({ tone: 'success', text: 'This draft has been marked as skipped.' });
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to skip this draft.',
      });
    } finally {
      setWorking(null);
    }
  };

  const confirmDeleteRow = async () => {
    if (!pendingDelete) return;
    try {
      const response = await fetch('/api/client-communications/drafts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? 'Unable to remove this record.');
      if (selected?.id === pendingDelete.id) setSelected(null);
      setPendingDelete(null);
      await load();
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Unable to remove this record.');
      setPendingDelete(null);
    }
  };

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, color: '#102f50', fontSize: 22, fontWeight: 800 }}>Email Activity</h1>
        <div style={{ color: '#718399', fontSize: 12, marginTop: 3 }}>
          Select any record to review the full email or reopen a prepared draft in Outlook.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search company name…"
          style={{ ...S, flex: 1, minWidth: 200 }}
        />
        <select value={type} onChange={event => setType(event.target.value)} style={S}>
          <option value="">All types</option>
          <option value="ar">AR Renewal</option>
          <option value="soa">SOA</option>
          <option value="letter">Letter</option>
        </select>
        <select value={status} onChange={event => setStatus(event.target.value)} style={S}>
          <option value="">All statuses</option>
          <option value="pending">Prepared</option>
          <option value="opened">Opened in Outlook</option>
          <option value="sent">Confirmed Sent</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      {loadError && (
        <div style={{ marginBottom: 10, padding: '9px 11px', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12 }}>
          {loadError}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div className="system-list-column-header" style={{ display: 'grid', gridTemplateColumns: '60px 1.35fr 1fr 100px 110px 130px 120px 100px', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div>Type</div>
          <div>Company Name</div>
          <div>Subject</div>
          <div style={{ textAlign: 'right' }}>Amount</div>
          <div style={{ textAlign: 'center' }}>Status</div>
          <div>Activity</div>
          <div>By</div>
          <div />
        </div>
        <div style={{ maxHeight: 'calc(100vh - 370px)', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No records match.</div>
          ) : rows.map(row => {
            const accent = statusAccent(row.status);
            return (
              <div
                key={row.id}
                className="system-list-row"
                style={{ display: 'grid', gridTemplateColumns: '60px 1.35fr 1fr 100px 110px 130px 120px 100px', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', borderLeft: `3px solid ${accent}`, fontSize: 12 }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>{TYPE_LABEL[row.email_campaigns?.type] ?? row.email_campaigns?.type}</div>
                <div className="company-name-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company_name}</div>
                <div style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.subject}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: '#1e3a5f' }}>{formatMoney(row.total_amount)}</div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, color: accent, background: '#fff', border: '1px solid #dbe3ec', borderRadius: 4, padding: '2px 7px' }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: accent }} />
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  {row.sent_at ? new Date(row.sent_at).toLocaleString() : row.opened_at ? `Opened ${new Date(row.opened_at).toLocaleString()}` : '—'}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sent_by_name ?? row.opened_by_name ?? '—'}</div>
                <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => openDetails(row)}
                    style={{ border: '1px solid #cdd9e5', background: '#fff', borderRadius: 6, padding: '5px 8px', color: '#1e3a5f', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(row)}
                    title="Remove this record"
                    style={{ border: '1px solid #fca5a5', background: '#fff', borderRadius: 6, padding: '5px 7px', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeDetails();
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.56)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-draft-detail-title"
            style={{ width: 'min(980px, 100%)', maxHeight: '92vh', overflowY: 'auto', background: '#f8fafc', borderRadius: 14, boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)' }}
          >
            <header style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', background: '#21466f', color: '#fff', borderRadius: '14px 14px 0 0' }}>
              <div>
                <h2 id="email-draft-detail-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{selected.company_name}</h2>
                <div style={{ marginTop: 5, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', color: '#dbeafe', fontSize: 11 }}>
                  <span>{TYPE_LABEL[selected.email_campaigns?.type] ?? selected.email_campaigns?.type}</span>
                  <span>•</span>
                  <span>{selected.email_campaigns?.name}</span>
                  <span style={{ padding: '2px 7px', borderRadius: 4, color: '#fff', background: 'rgba(255,255,255,0.13)', fontWeight: 800 }}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetails}
                disabled={Boolean(working)}
                aria-label="Close email details"
                style={{ marginLeft: 'auto', border: 0, borderRadius: 7, padding: 6, background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: working ? 'not-allowed' : 'pointer' }}
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: 18, display: 'grid', gap: 14 }}>
              {selected.status === 'pending' && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff7ed', color: '#9a3412', fontSize: 11.5 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  Prepared means the email content is saved, but Outlook opening has not been confirmed. Use “Open Again in Outlook” below.
                </div>
              )}

              <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'start', fontSize: 12 }}>
                  <strong style={{ color: '#64748b' }}>From</strong>
                  {selected.status !== 'sent' && selected.status !== 'skipped' ? (
                    <div>
                      <select
                        value={reopenSenderEmail}
                        onChange={event => setReopenSenderEmail(event.target.value)}
                        style={{ ...S, width: 'min(430px, 100%)' }}
                      >
                        {!reopenSenderEmail && <option value="">Choose sender…</option>}
                        {senders.map(sender => (
                          <option key={sender.id} value={sender.email}>
                            {sender.display_name ? `${sender.display_name} — ${sender.email}` : sender.email}
                            {sender.is_default ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
                      {!selected.email_campaigns?.email_senders?.email && (
                        <div style={{ marginTop: 5, color: '#b45309', fontSize: 10 }}>
                          This older campaign did not record a sender. The configured default is selected for review.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: '#1e3a5f' }}>
                      {selected.email_campaigns?.email_senders?.display_name
                        ? `${selected.email_campaigns.email_senders.display_name} <${selected.email_campaigns.email_senders.email}>`
                        : selected.email_campaigns?.email_senders?.email ?? 'No sender recorded'}
                    </div>
                  )}
                  <strong style={{ color: '#64748b' }}>To</strong>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#1e3a5f' }}>{selected.to_email || '—'}</div>
                  <strong style={{ color: '#64748b' }}>CC</strong>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#1e3a5f' }}>{selected.cc_email || '—'}</div>
                  <strong style={{ color: '#64748b' }}>User Name</strong>
                  <div style={{ color: '#1e3a5f' }}>{selected.contact_name || '—'}</div>
                  <strong style={{ color: '#64748b' }}>Subject</strong>
                  <div style={{ color: '#1e3a5f', fontWeight: 700 }}>{selected.subject}</div>
                </div>
              </section>

              <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                <div style={{ marginBottom: 8, color: '#64748b', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>Email Body</div>
                <div style={{ maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap', color: '#1e3a5f', fontSize: 12.5, lineHeight: 1.65 }}>{selected.body}</div>
              </section>

              <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, color: '#64748b', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>
                  <Paperclip size={13} /> Invoice & Attachments
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {(selected.invoice_refs ?? []).map((invoice, index) => (
                    <span key={`${invoice.qbCompany}-${invoice.invoiceNo}-${index}`} style={{ padding: '5px 8px', border: '1px solid #bfdbfe', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', fontSize: 10.5, fontWeight: 800 }}>
                      {invoice.qbCompany} {invoice.invoiceNo} · {formatMoney(invoice.amount)}
                      {(!invoice.qbInvoiceId || invoice.qbCompany === 'TAO') && ' · attach manually'}
                    </span>
                  ))}
                  {!selected.invoice_refs?.length && (
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>No system invoice is recorded for this email.</span>
                  )}
                </div>

                {selected.status !== 'sent' && selected.status !== 'skipped' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#526b85', fontSize: 11, fontWeight: 800 }}>
                      <FilePlus2 size={14} />
                      {manualFiles.length ? `${manualFiles.length} additional file(s) selected` : 'Add manual attachment before reopening'}
                      <input
                        type="file"
                        multiple
                        hidden
                        onChange={event => setManualFiles(event.target.files ? Array.from(event.target.files) : [])}
                      />
                    </label>
                    {manualFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                        {manualFiles.map(file => (
                          <span key={`${file.name}-${file.size}`} style={{ padding: '3px 6px', borderRadius: 4, background: '#f1f5f9', color: '#526b85', fontSize: 10 }}>{file.name}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 10 }}>
                      Previously selected local/manual files are not stored by the website. Select them again here if required.
                    </div>
                  </div>
                )}
              </section>

              {message && (
                <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${message.tone === 'success' ? '#bbf7d0' : message.tone === 'warning' ? '#fed7aa' : '#fecaca'}`, background: message.tone === 'success' ? '#f0fdf4' : message.tone === 'warning' ? '#fff7ed' : '#fef2f2', color: message.tone === 'success' ? '#15803d' : message.tone === 'warning' ? '#b45309' : '#b91c1c', fontSize: 11.5, fontWeight: 700 }}>
                  {message.text}
                </div>
              )}

              <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={closeDetails}
                  disabled={Boolean(working)}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 7, padding: '8px 12px', background: '#fff', color: '#526b85', fontSize: 11.5, fontWeight: 800, cursor: working ? 'not-allowed' : 'pointer' }}
                >
                  Close
                </button>

                {selected.status !== 'sent' && selected.status !== 'skipped' && (
                  <>
                    <button
                      type="button"
                      onClick={skipDraft}
                      disabled={Boolean(working)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #cbd5e1', borderRadius: 7, padding: '8px 12px', background: '#fff', color: '#64748b', fontSize: 11.5, fontWeight: 800, cursor: working ? 'wait' : 'pointer' }}
                    >
                      {working === 'skip' ? <Loader2 size={13} className="spin" /> : <SkipForward size={13} />}
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={markAsSent}
                      disabled={Boolean(working)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #86efac', borderRadius: 7, padding: '8px 12px', background: '#f0fdf4', color: '#15803d', fontSize: 11.5, fontWeight: 800, cursor: working ? 'wait' : 'pointer' }}
                    >
                      {working === 'sent' ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      Mark as Sent
                    </button>
                    <button
                      type="button"
                      onClick={reopenInOutlook}
                      disabled={Boolean(working)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 7, padding: '8px 14px', background: '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 800, cursor: working ? 'wait' : 'pointer' }}
                    >
                      {working === 'open' ? <Loader2 size={13} className="spin" /> : <Mail size={13} />}
                      Open Again in Outlook
                    </button>
                  </>
                )}
              </footer>
            </div>
          </section>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          label={`${pendingDelete.company_name} — ${pendingDelete.subject}`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDeleteRow}
        />
      )}
    </div>
  );
}
