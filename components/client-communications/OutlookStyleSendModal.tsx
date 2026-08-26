'use client';

import { useEffect, useState } from 'react';
import { Send, FileText, X, Loader2, Paperclip, AlertTriangle } from 'lucide-react';
import {
  checkHelperHealth, prepareDraftForSend, sendDraftsInOutlook,
  type DraftLike, type PreparedDraft, type PreparedAttachment,
} from '@/lib/draft-helper-client';

// Every AR template's body ends with this exact line — kept in sync with
// draft-helper/app.py's own PAYMENT_MARKER constant (that's the single
// source of truth for what actually triggers the embedded image at send
// time; this is only a preview, so it must match exactly or the preview
// would lie about what's about to go out).
const PAYMENT_MARKER = 'PAYMENT METHOD';
const PAYMENT_IMAGE_SRC = '/assets/payment_options.png';
const STANDING_ATTACHMENT_NAME = 'Bank Details 2026 - Tassure Group.pdf';
const STANDING_ATTACHMENT_SRC = '/assets/Bank%20Details%202026%20-%20Tassure%20Group.pdf';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentCard({ fileName, byteSize, onRemove }: { fileName: string; byteSize: number | null; onRemove?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', minWidth: 210, maxWidth: 260, background: '#fff' }}>
      <FileText size={22} style={{ color: '#dc2626', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>{fileName}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{byteSize == null ? ' ' : formatSize(byteSize)}</div>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: 2, display: 'flex' }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'stretch', borderBottom: '1px solid #f1f5f9' };
const labelBoxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, margin: '3px 8px 3px 0', fontSize: 12, fontWeight: 600, color: '#334155' };
const valueStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '8px 2px', fontSize: 12.5, color: '#1e3a5f', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export default function OutlookStyleSendModal({
  draft, sender, me, onClose, onSent,
}: {
  draft: DraftLike;
  sender: { email: string; display_name: string | null } | null;
  me: { email: string; name: string } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [prepared, setPrepared] = useState<PreparedDraft | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [editedBody, setEditedBody] = useState(draft.body);
  const [bcc, setBcc] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [standingSize, setStandingSize] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  // Resolve as soon as this opens, not when Send is clicked — same rule the
  // billing popover's own previewRow already follows.
  useEffect(() => {
    let cancelled = false;
    prepareDraftForSend(draft).then(result => {
      if (cancelled) return;
      setPrepared(result);
      setEditedBody(result.draft.body);
      setPreparing(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setPrepareError(e instanceof Error ? e.message : 'Unable to prepare this draft — could not resolve its attachments.');
      setPreparing(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real size for the standing attachment card, not a hardcoded number that
  // could go stale if the file's ever replaced — a HEAD request is enough.
  useEffect(() => {
    let cancelled = false;
    fetch(STANDING_ATTACHMENT_SRC, { method: 'HEAD' }).then(res => {
      if (cancelled || !res.ok) return;
      const len = res.headers.get('content-length');
      if (len) setStandingSize(Number(len));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const showsPaymentImage = editedBody.toUpperCase().includes(PAYMENT_MARKER);
  const senderDisplay = sender ? (sender.display_name ? `${sender.display_name} <${sender.email}>` : sender.email) : (draft.sender_email ?? '—');

  const handleSend = async () => {
    if (!prepared) return;
    setWorking(true);
    setSendError(null);
    setNotice(null);
    try {
      const helperReady = await checkHelperHealth(1500);
      if (!helperReady) throw new Error('Tassure Draft Helper is not running. Start it, then try again.');

      const draftToSend: DraftLike = {
        ...prepared.draft,
        body: editedBody,
        bcc_email: bcc || null,
        additional_attachments: manualFiles,
      };
      const [result] = await sendDraftsInOutlook([{ ...prepared, draft: draftToSend }]);
      if (!result.ok) throw new Error(result.error ?? 'Outlook did not send this email.');

      // The email is now genuinely, actually sent. Everything from here is
      // bookkeeping — a failure below must never be reported as a send
      // failure (it wasn't one), same distinct-warning pattern
      // history/page.tsx's reopenInOutlook already establishes.
      //
      // Uses prepared.draft's id/version, not the raw draft prop's — if
      // prepareDraftForSend's own amount refresh already bumped the row's
      // version (it PATCHes independently when the total changed), the
      // prop's original version is stale and this compare-and-swap would
      // 409 against a row that, from the server's side, was never actually
      // out of date.
      if (prepared.draft.id !== undefined && prepared.draft.version !== undefined) {
        try {
          const patchRes = await fetch('/api/client-communications/drafts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: prepared.draft.id, version: prepared.draft.version,
              patch: { status: 'sent', body: editedBody },
              sentByEmail: me?.email, sentByName: me?.name,
            }),
          });
          if (!patchRes.ok) {
            const j = await patchRes.json().catch(() => ({}));
            setNotice({ tone: 'warning', text: `The email was sent, but the activity record could not be updated: ${j.error ?? 'refresh and check the latest status.'}` });
            onSent();
            return;
          }
        } catch {
          setNotice({ tone: 'warning', text: 'The email was sent, but the activity record could not be updated — refresh and check the latest status.' });
          onSent();
          return;
        }
      }
      onSent();
      onClose();
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Unable to send this email.');
    } finally {
      setWorking(false);
    }
  };

  // Vincent, 2026-08-27: closing without sending used to lose whatever was
  // typed — nothing persisted anywhere until Send actually fired. Now, if
  // the body was genuinely edited, save it back to the draft row before
  // closing, so reopening it later (via Draft again, or Delivery History's
  // existing "Open Again in Outlook") shows the edit instead of the
  // original merged template. Only fires on a real change — comparing
  // against prepared.draft.body (what the textarea was actually seeded
  // with, post amount-refresh), not the raw draft prop.
  const handleClose = async () => {
    if (working || closing) return;
    if (!prepared || editedBody === prepared.draft.body || prepared.draft.id === undefined || prepared.draft.version === undefined) {
      onClose();
      return;
    }
    setClosing(true);
    setSendError(null);
    try {
      const patchRes = await fetch('/api/client-communications/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: prepared.draft.id, version: prepared.draft.version,
          patch: { body: editedBody },
        }),
      });
      if (!patchRes.ok) {
        const j = await patchRes.json().catch(() => ({}));
        setSendError(`Could not save your edit before closing: ${j.error ?? 'unknown error'}. Click Close again to retry, or your edit will be lost.`);
        return;
      }
      onClose();
    } catch {
      setSendError('Could not save your edit before closing (network error). Click Close again to retry, or your edit will be lost.');
    } finally {
      setClosing(false);
    }
  };

  const attachmentEntries: { key: string; fileName: string; byteSize: number | null; onRemove?: () => void }[] = [
    ...(prepared?.systemAttachments ?? []).map((a: PreparedAttachment, i: number) => ({ key: `sys-${i}`, fileName: a.fileName, byteSize: a.byteSize })),
    ...manualFiles.map((f, i) => ({ key: `manual-${i}`, fileName: f.name, byteSize: f.size, onRemove: () => setManualFiles(prev => prev.filter((_, idx) => idx !== i)) })),
    { key: 'standing', fileName: STANDING_ATTACHMENT_NAME, byteSize: standingSize },
  ];

  return (
    <div onClick={(working || closing) ? undefined : handleClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(860px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 70px rgba(15,23,42,0.28)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
          <button type="button" onClick={handleClose} disabled={working || closing} title="Close" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: (working || closing) ? 'not-allowed' : 'pointer', padding: 4, display: 'flex' }}>
            {closing ? <Loader2 size={16} className="spin" /> : <X size={16} />}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: '4px 20px 8px' }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={working || preparing || !prepared || !!prepareError}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              border: '1px solid #d9e2ec', borderRadius: 8, padding: '10px 16px', background: '#fff',
              cursor: (working || preparing || !prepared) ? 'not-allowed' : 'pointer',
              opacity: (working || preparing || !prepared || !!prepareError) ? 0.55 : 1,
              alignSelf: 'flex-start', minWidth: 66,
            }}
          >
            {working ? <Loader2 size={20} style={{ color: '#173b63' }} className="spin" /> : <Send size={20} style={{ color: '#173b63' }} />}
            <span style={{ fontSize: 12, fontWeight: 700, color: '#173b63' }}>Send</span>
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>From</div>
              <div style={valueStyle}>{senderDisplay}</div>
            </div>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>To</div>
              <div style={valueStyle}>{draft.to_email || '—'}</div>
            </div>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>Cc</div>
              <div style={valueStyle}>{draft.cc_email || ''}</div>
            </div>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>Bcc</div>
              <input
                value={bcc}
                onChange={e => setBcc(e.target.value)}
                placeholder=""
                style={{ ...valueStyle, border: 'none', outline: 'none', width: '100%', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <div style={{ ...labelBoxStyle, background: 'transparent', border: 'none', color: '#94a3b8', fontWeight: 500 }}>Subject</div>
              <div style={{ ...valueStyle, whiteSpace: 'normal' }}>{draft.subject}</div>
            </div>
          </div>
        </div>

        {prepared?.amountCorrected && (
          <div style={{ margin: '0 20px 10px', padding: '8px 12px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff7ed', color: '#9a3412', fontSize: 11, fontWeight: 600 }}>
            Amount corrected from S${prepared.previousTotal?.toLocaleString()} to S${prepared.newTotal?.toLocaleString()} using the latest QuickBooks total — the body below already reflects it.
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 20px 14px' }}>
          {preparing ? (
            <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Resolving attachments…</span>
          ) : (
            attachmentEntries.map(a => <AttachmentCard key={a.key} fileName={a.fileName} byteSize={a.byteSize} onRemove={a.onRemove} />)
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#173b63', fontSize: 11.5, fontWeight: 700, border: '1px dashed #cbd5e1', borderRadius: 6, padding: '8px 12px' }}>
            <Paperclip size={14} />
            Add attachment
            <input type="file" multiple hidden onChange={e => setManualFiles(prev => [...prev, ...(e.target.files ? Array.from(e.target.files) : [])])} />
          </label>
        </div>

        {prepareError && (
          <div style={{ margin: '0 20px 14px', display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 11.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {prepareError} — Send is disabled until this resolves; close and try again.
          </div>
        )}

        <div style={{ borderTop: '1px solid #f1f5f9', padding: '16px 20px' }}>
          <textarea
            value={editedBody}
            onChange={e => setEditedBody(e.target.value)}
            rows={14}
            style={{ width: '100%', border: 'none', outline: 'none', resize: 'vertical', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.7, color: '#0f172a', boxSizing: 'border-box' }}
          />
          {showsPaymentImage && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>Payment options image (embedded automatically after the "PAYMENT METHOD" line when sent):</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={PAYMENT_IMAGE_SRC} alt="Payment options" width={529} height={265} style={{ maxWidth: '100%', height: 'auto' }} />
            </div>
          )}
        </div>

        {(sendError || notice) && (
          <div style={{
            margin: '0 20px 16px', padding: '10px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
            border: `1px solid ${sendError ? '#fecaca' : '#fed7aa'}`,
            background: sendError ? '#fef2f2' : '#fff7ed',
            color: sendError ? '#b91c1c' : '#9a3412',
          }}>
            {sendError ?? notice?.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 18px' }}>
          <button type="button" onClick={handleClose} disabled={working || closing} style={{ border: '1px solid #cbd5e1', borderRadius: 7, padding: '8px 14px', background: '#fff', color: '#526b85', fontSize: 12, fontWeight: 700, cursor: (working || closing) ? 'not-allowed' : 'pointer' }}>
            {closing ? 'Saving…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
