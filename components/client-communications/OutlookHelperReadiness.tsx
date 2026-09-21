'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, Download, Loader2, MonitorCheck, RefreshCw } from 'lucide-react';
import { getHelperHealth, isHelperOutdated, LATEST_HELPER_VERSION } from '@/lib/draft-helper-client';

export interface OutlookHelperStatus {
  available: boolean | null;
  outdated: boolean;
  version: string | null;
  classicOutlook: boolean | null;
}

interface OutlookHelperReadinessProps {
  context: 'billing' | 'soa';
  onStatusChange?: (status: OutlookHelperStatus) => void;
  style?: CSSProperties;
}

const COPY = {
  billing: {
    title: 'Outlook Helper',
    checking: 'Checking whether this computer is ready to open Billing Drafts in Classic Outlook.',
    missing: 'Required before invoice email drafts can open with their attachments. Download it once, start the Helper, then recheck.',
    ready: 'This computer is ready for Billing Drafts',
  },
  soa: {
    title: 'SOA Outlook Helper',
    checking: 'Checking whether this computer is ready to open SOA reminder drafts in Classic Outlook.',
    missing: 'Required before SOA reminder drafts can open with the Statement PDF attached. Download it once, start the Helper, then recheck.',
    ready: 'This computer is ready for SOA reminder drafts',
  },
} as const;

export default function OutlookHelperReadiness({ context, onStatusChange, style }: OutlookHelperReadinessProps) {
  const [status, setStatus] = useState<OutlookHelperStatus>({
    available: null,
    outdated: false,
    version: null,
    classicOutlook: null,
  });
  const [showOutdatedModal, setShowOutdatedModal] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const copy = COPY[context];

  const recheck = useCallback((announceOutdated = false) => {
    setStatus(current => ({ ...current, available: null }));
    getHelperHealth().then(health => {
      const next: OutlookHelperStatus = {
        available: health !== null,
        outdated: isHelperOutdated(health),
        version: health?.version ?? null,
        classicOutlook: health?.isClassicOutlook ?? null,
      };
      setStatus(next);
      onStatusChangeRef.current?.(next);
      if (announceOutdated && next.outdated) setShowOutdatedModal(true);
    });
  }, []);

  useEffect(() => { recheck(true); }, [recheck]);

  const tone = status.available === null
    ? 'checking'
    : !status.available
      ? 'missing'
      : status.outdated ? 'outdated' : 'ready';
  const description = status.available === null
    ? copy.checking
    : !status.available
      ? copy.missing
      : status.outdated
        ? `Helper ${status.version ? `v${status.version} ` : ''}is running, but a newer version is available. You may continue or update now.`
        : `${copy.ready}${status.version ? ` · Helper v${status.version}` : ''}${status.classicOutlook ? ' · Classic Outlook verified' : ''}.`;

  return (
    <>
      {showOutdatedModal && (
        <div className="outlook-helper-modal-overlay" onClick={() => setShowOutdatedModal(false)}>
          <div className="outlook-helper-modal" onClick={event => event.stopPropagation()}>
            <div className="outlook-helper-modal__icon"><AlertTriangle size={20} /></div>
            <strong>Outlook Helper update available</strong>
            <p>
              This computer is running Helper {status.version ? `v${status.version}` : ''}, but v{LATEST_HELPER_VERSION} is available.
              Download and install the update before creating drafts.
            </p>
            <div className="outlook-helper-modal__actions">
              <a href="/downloads/TassureDraftHelper.exe" download className="outlook-helper-download">
                <Download size={14} /> Download update
              </a>
              <button type="button" onClick={() => setShowOutdatedModal(false)} className="outlook-helper-recheck">
                Remind me later
              </button>
            </div>
          </div>
        </div>
      )}

      <section className={`outlook-helper-readiness outlook-helper-readiness--${tone}`} style={style}>
        <div className="outlook-helper-readiness__icon">
          {status.available === null
            ? <Loader2 size={18} className="outlook-helper-spin" />
            : status.available
              ? <MonitorCheck size={18} />
              : <Download size={18} />}
        </div>
        <div className="outlook-helper-readiness__copy">
          <div className="outlook-helper-readiness__title-row">
            <strong>{copy.title}</strong>
            <span className="outlook-helper-readiness__status">
              {status.available === null
                ? 'Checking'
                : !status.available
                  ? 'Not detected'
                  : status.outdated ? 'Update available' : 'Ready'}
            </span>
          </div>
          <div className="outlook-helper-readiness__description">{description}</div>
          {status.available === false && (
            <div className="outlook-helper-readiness__steps">
              <span><b>1</b> Download</span>
              <span><b>2</b> Open the Helper</span>
              <span><b>3</b> Recheck</span>
            </div>
          )}
        </div>
        <div className="outlook-helper-readiness__actions">
          {(status.available === false || status.outdated) && (
            <a href="/downloads/TassureDraftHelper.exe" download className="outlook-helper-download">
              <Download size={14} />
              {status.outdated ? 'Download update' : 'Download Helper'}
            </a>
          )}
          <button type="button" onClick={() => recheck()} disabled={status.available === null} className="outlook-helper-recheck">
            <RefreshCw size={13} className={status.available === null ? 'outlook-helper-spin' : ''} />
            Recheck
          </button>
        </div>
      </section>

      <style>{`
        @keyframes outlook-helper-spin{to{transform:rotate(360deg)}}
        .outlook-helper-spin{animation:outlook-helper-spin 1s linear infinite}
        .outlook-helper-readiness{display:flex;align-items:center;gap:12px;padding:13px 15px;background:#fff;border:1px solid #dfe7ef;border-radius:12px;box-shadow:0 4px 16px rgba(24,50,79,.025)}
        .outlook-helper-readiness__icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;background:#eef3f8;color:#526b85}
        .outlook-helper-readiness__copy{min-width:0;flex:1}
        .outlook-helper-readiness__title-row{display:flex;align-items:center;gap:8px;color:#18324f;font-size:12.5px}
        .outlook-helper-readiness__status{padding:2px 7px;border-radius:999px;background:#f1f5f9;color:#60758c;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em}
        .outlook-helper-readiness__description{margin-top:3px;color:#718399;font-size:11px;line-height:1.45}
        .outlook-helper-readiness__steps{display:flex;align-items:center;gap:14px;margin-top:7px;color:#526b85;font-size:10px;font-weight:700}
        .outlook-helper-readiness__steps b{display:inline-flex;width:16px;height:16px;margin-right:3px;align-items:center;justify-content:center;border-radius:50%;background:#eef3f8;color:#173b63;font-size:9px}
        .outlook-helper-readiness__actions{display:flex;align-items:center;gap:7px;flex:none}
        .outlook-helper-download,.outlook-helper-recheck{height:34px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 11px;font-size:11px;font-weight:800;text-decoration:none;cursor:pointer}
        .outlook-helper-download{border:0;background:#173b63;color:#fff}
        .outlook-helper-recheck{border:1px solid #d9e2ec;background:#fff;color:#526b85}
        .outlook-helper-recheck:disabled{cursor:wait;opacity:.65}
        .outlook-helper-readiness--ready .outlook-helper-readiness__icon,.outlook-helper-readiness--ready .outlook-helper-readiness__status{background:#eef8f2;color:#15803d}
        .outlook-helper-readiness--missing .outlook-helper-readiness__icon,.outlook-helper-readiness--outdated .outlook-helper-readiness__icon,.outlook-helper-readiness--missing .outlook-helper-readiness__status,.outlook-helper-readiness--outdated .outlook-helper-readiness__status{background:#fff8e8;color:#9a6700}
        .outlook-helper-modal-overlay{position:fixed;inset:0;background:rgba(15,26,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .outlook-helper-modal{background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(15,26,42,.25);padding:22px;max-width:380px;width:100%;text-align:center}
        .outlook-helper-modal__icon{width:42px;height:42px;border-radius:50%;background:#fff8e8;color:#9a6700;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
        .outlook-helper-modal strong{display:block;color:#18324f;font-size:14.5px;margin-bottom:8px}
        .outlook-helper-modal p{color:#5b7089;font-size:12px;line-height:1.55;margin:0 0 16px}
        .outlook-helper-modal__actions{display:flex;align-items:center;justify-content:center;gap:8px}
        @media(max-width:900px){
          .outlook-helper-readiness{align-items:flex-start;flex-wrap:wrap}
          .outlook-helper-readiness__actions{width:100%;padding-left:50px}
          .outlook-helper-readiness__steps{flex-wrap:wrap;gap:7px 12px}
        }
      `}</style>
    </>
  );
}
