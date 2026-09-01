'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

function base64ToBlobUrl(base64: string, mime = 'application/pdf'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

// Vincent, 2026-08-27: reformats a To/Cc/Bcc field so more than one address
// on the same line always ends up one-per-line, matching how the app
// already stores a multi-recipient field (recipientLines() in
// lib/campaign-recipients.ts joins with '\n') and how Draft Helper now
// normalizes it right before Send() (_normalize_recipients in
// draft-helper/app.py). Only reformats on blur, not every keystroke — mid-
// typing a second address would otherwise get split prematurely.
function splitToLines(raw: string): string {
  return raw.split(/[,;\n\r]+/).map(s => s.trim()).filter(Boolean).join('\n');
}

// Auto-grows like the body textarea below (no internal scroll — the
// modal's own single scrollbar covers it), and reformats to one-address-
// per-line on blur via splitToLines.
function RecipientField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { resize(); }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => { onChange(e.target.value); resize(); }}
      onBlur={() => onChange(splitToLines(value))}
      rows={1}
      style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', fontFamily: 'inherit', fontSize: 12.5, color: '#1e3a5f', padding: '8px 2px', lineHeight: 1.6, boxSizing: 'border-box' }}
    />
  );
}

function AttachmentCard({ fileName, byteSize, previewUrl, onRemove }: { fileName: string; byteSize: number | null; previewUrl: string | null; onRemove?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', minWidth: 210, maxWidth: 260, background: '#fff' }}>
      <button
        type="button"
        onClick={() => previewUrl && window.open(previewUrl, '_blank', 'noopener,noreferrer')}
        disabled={!previewUrl}
        title={previewUrl ? 'Open in a new tab to review' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', padding: 0, minWidth: 0, flex: 1, textAlign: 'left', cursor: previewUrl ? 'pointer' : 'default' }}
      >
      <FileText size={22} style={{ color: '#dc2626', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: previewUrl ? 'underline' : 'none', textDecorationColor: '#cbd5e1' }} title={fileName}>{fileName}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{byteSize == null ? ' ' : formatSize(byteSize)}</div>
      </div>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove — won't be sent" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: 2, display: 'flex', flexShrink: 0 }}>
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
  const [editedSubject, setEditedSubject] = useState(draft.subject);
  const [editedTo, setEditedTo] = useState(draft.to_email ?? '');
  const [editedCc, setEditedCc] = useState(draft.cc_email ?? '');
  const [editedBcc, setEditedBcc] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [standingSize, setStandingSize] = useState<number | null>(null);
  const [excludedSystemIndices, setExcludedSystemIndices] = useState<Set<number>>(new Set());
  const [includeStanding, setIncludeStanding] = useState(true);
  const [working, setWorking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  // Vincent, 2026-08-27: the body used to be a fixed-height textarea with
  // its own internal scrollbar, and the payment image sat below it as a
  // separate block — cramped, and scrolling the text didn't carry the image
  // along with it. Auto-growing this to fit its full content removes the
  // textarea's own scroll entirely, so the ONE scrollbar (the modal's own)
  // carries text and image together, same as scrolling a real email.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const resizeBody = () => { const el = bodyRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { resizeBody(); }, [editedBody]);

  // Resolve as soon as this opens, not when Send is clicked — same rule the
  // billing popover's own previewRow already follows.
  useEffect(() => {
    let cancelled = false;
    prepareDraftForSend(draft).then(result => {
      if (cancelled) return;
      setPrepared(result);
      setEditedBody(result.draft.body);
      setEditedSubject(result.draft.subject);
      setPreparing(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setPrepareError(e instanceof Error ? e.message : 'Unable to prepare this draft — could not resolve its attachments.');
      setPreparing(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blob URLs for "open in a new tab to review" — memoized so they're only
  // (re)created when their source actually changes, with the matching
  // revoke on cleanup so a long-open modal doesn't leak memory.
  const systemPreviewUrls = useMemo(
    () => (prepared?.systemAttachments ?? []).map(a => base64ToBlobUrl(a.base64)),
    [prepared],
  );
  useEffect(() => () => systemPreviewUrls.forEach(u => URL.revokeObjectURL(u)), [systemPreviewUrls]);

  const manualPreviewUrls = useMemo(() => manualFiles.map(f => URL.createObjectURL(f)), [manualFiles]);
  useEffect(() => () => manualPreviewUrls.forEach(u => URL.revokeObjectURL(u)), [manualPreviewUrls]);

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
        to_email: editedTo || null,
        cc_email: editedCc || null,
        subject: editedSubject,
        body: editedBody,
        bcc_email: editedBcc || null,
        additional_attachments: manualFiles,
        skip_standing_attachments: !includeStanding,
      };
      const includedSystemAttachments = prepared.systemAttachments.filter((_, i) => !excludedSystemIndices.has(i));
      const [result] = await sendDraftsInOutlook([{ ...prepared, draft: draftToSend, systemAttachments: includedSystemAttachments }]);
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
              patch: { status: 'sent', subject: editedSubject, body: editedBody },
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

  // Vincent, 2026-08-27 (Subject made editable 2026-08-31): closing without
  // sending used to lose whatever was typed — nothing persisted anywhere
  // until Send actually fired. Now, if the body, subject, To, or Cc was
  // genuinely edited, save it back to the draft row before closing, so
  // reopening it later (via Draft again, or Delivery History's existing
  // "Open Again in Outlook") shows the edit instead of the original merged
  // template. Only fires on a real change — comparing against
  // prepared.draft's own fields (what the fields were actually seeded
  // with, post amount-refresh), not the raw draft prop. Bcc is excluded on
  // purpose: it has no database column to save into at all (see its own
  // comment on DraftLike) — genuinely per-send, not persistable.
  const handleClose = async () => {
    if (working || closing) return;
    const bodyChanged = !!prepared && editedBody !== prepared.draft.body;
    const subjectChanged = !!prepared && editedSubject !== prepared.draft.subject;
    const toChanged = !!prepared && editedTo !== (prepared.draft.to_email ?? '');
    const ccChanged = !!prepared && editedCc !== (prepared.draft.cc_email ?? '');
    if (!prepared || (!bodyChanged && !subjectChanged && !toChanged && !ccChanged) || prepared.draft.id === undefined || prepared.draft.version === undefined) {
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
          patch: { body: editedBody, subject: editedSubject, to_email: editedTo || null, cc_email: editedCc || null },
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

  const attachmentEntries: { key: string; fileName: string; byteSize: number | null; previewUrl: string | null; onRemove?: () => void }[] = [
    ...(prepared?.systemAttachments ?? [])
      .map((a: PreparedAttachment, i: number) => ({ key: `sys-${i}`, fileName: a.fileName, byteSize: a.byteSize, previewUrl: systemPreviewUrls[i] ?? null, onRemove: () => setExcludedSystemIndices(prev => new Set(prev).add(i)) }))
      .filter((_, i) => !excludedSystemIndices.has(i)),
    ...manualFiles.map((f, i) => ({ key: `manual-${i}`, fileName: f.name, byteSize: f.size, previewUrl: manualPreviewUrls[i] ?? null, onRemove: () => setManualFiles(prev => prev.filter((_, idx) => idx !== i)) })),
    ...(includeStanding ? [{ key: 'standing', fileName: STANDING_ATTACHMENT_NAME, byteSize: standingSize, previewUrl: STANDING_ATTACHMENT_SRC, onRemove: () => setIncludeStanding(false) }] : []),
  ];

  // Drop files anywhere on the panel to attach them — the same list
  // "Add attachment" already appends to. A counter (not a plain boolean)
  // avoids the highlight flickering off while the pointer crosses child
  // elements: dragenter/dragleave fire per-element, not just for the panel
  // itself, so only going back to zero really means "left the panel."
  //
  // Every handler bails out first for anything that isn't a real file drag
  // (checked via dataTransfer.types, the one thing readable during drag —
  // .files itself is empty until drop). Vincent, 2026-08-27: this used to
  // call preventDefault() unconditionally, which also hijacked the body
  // textarea's own native drag-to-reposition-selected-text — a completely
  // ordinary editing gesture — since a bubbled dragover/drop still lets an
  // ancestor's preventDefault() block the original target's default action.
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDraggingOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDraggingOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) setManualFiles(prev => [...prev, ...files]);
  };

  return (
    // Vincent, 2026-08-27: Chelsea was mid-edit and the whole review screen
    // suddenly closed on her, forcing her to click Draft all over again —
    // this modal's own backdrop used to close-on-click like a normal
    // dismissable popover, but with save-on-close wired up (see handleClose)
    // that made any stray click near the edge — now easier to land given
    // the modal grew wider/taller today — silently save-and-close instead
    // of just doing nothing. A screen reviewing a real outgoing email is
    // not a casual popover: closing it should take a deliberate click on X
    // or Close, never an accidental one on the backdrop.
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ width: 'min(1500px, 95vw)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 70px rgba(15,23,42,0.28)', overflow: 'hidden', position: 'relative' }}
      >
        {isDraggingOver && (
          <div style={{
            position: 'absolute', inset: 8, zIndex: 10, border: '2px dashed #397f78', borderRadius: 8,
            background: 'rgba(57,127,120,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#397f78', pointerEvents: 'none',
          }}>
            Drop to attach
          </div>
        )}
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
              <RecipientField value={editedTo} onChange={setEditedTo} />
            </div>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>Cc</div>
              <RecipientField value={editedCc} onChange={setEditedCc} />
            </div>
            <div style={rowStyle}>
              <div style={labelBoxStyle}>Bcc</div>
              <RecipientField value={editedBcc} onChange={setEditedBcc} />
            </div>
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <div style={{ ...labelBoxStyle, background: 'transparent', border: 'none', color: '#94a3b8', fontWeight: 500 }}>Subject</div>
              <input
                type="text"
                value={editedSubject}
                onChange={e => setEditedSubject(e.target.value)}
                style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: '#1e3a5f', padding: '8px 2px', boxSizing: 'border-box' }}
              />
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
            attachmentEntries.map(a => <AttachmentCard key={a.key} fileName={a.fileName} byteSize={a.byteSize} previewUrl={a.previewUrl} onRemove={a.onRemove} />)
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
            ref={bodyRef}
            value={editedBody}
            onChange={e => { setEditedBody(e.target.value); resizeBody(); }}
            rows={1}
            style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.7, color: '#0f172a', boxSizing: 'border-box' }}
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
