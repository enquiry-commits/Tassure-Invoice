'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Link, Loader, AlertTriangle } from 'lucide-react';
import { fmtDate } from '@/lib/date';

interface QBStatus {
  connected: boolean;
  lastConnected?: string | null;
  refreshExpired?: boolean;
  refreshExpiresInDays?: number | null;
  authError?: { code: string; message: string; lastSeenAt?: string | null } | null;
}

const CONFIGURATION_ERRORS = new Set(['invalid_client', 'missing_client_credentials']);
const REAUTHORISATION_ERRORS = new Set(['invalid_grant', 'refresh_token_expired']);

function CompanyBadge({
  label,
  status,
  verifying,
  onConnect,
  onVerify,
}: {
  label: string;
  status: QBStatus | null;
  verifying: boolean;
  onConnect: () => void;
  onVerify: () => void;
}) {
  if (!status) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader size={13} className="animate-spin" />
        {label}…
      </div>
    );
  }

  if (status.connected) {
    const when = status.lastConnected ? fmtDate(status.lastConnected) : null;
    const days = status.refreshExpiresInDays;
    if (status.authError) {
      const configurationError = CONFIGURATION_ERRORS.has(status.authError.code);
      const reauthorisationRequired = REAUTHORISATION_ERRORS.has(status.authError.code);
      return (
        <button onClick={reauthorisationRequired ? onConnect : onVerify} title={status.authError.message}
          disabled={verifying}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#dc2626', opacity: verifying ? 0.75 : 1 }}>
          {verifying ? <Loader size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
          {verifying
            ? `${label} checking existing connection`
            : `${label} ${reauthorisationRequired ? 'reconnect required' : configurationError ? 'OAuth setup error — retry' : 'connection error — retry'}`}
        </button>
      );
    }
    if (status.refreshExpired || (typeof days === 'number' && days <= 0)) {
      return (
        <button onClick={onConnect}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#dc2626' }}>
          <AlertTriangle size={12} />
          {label} expired — reconnect
        </button>
      );
    }
    if (typeof days === 'number' && days <= 30) {
      return (
        <button onClick={onConnect}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
          <AlertTriangle size={12} />
          {label} expires {days}d
        </button>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle size={13} className="text-green-500" />
        <span className="text-xs text-slate-500">{label}{when ? ` · ${when}` : ''}</span>
        <button onClick={onConnect} className="text-xs text-blue-500 hover:underline">Reconnect</button>
      </div>
    );
  }

  return (
    <button onClick={onConnect}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity"
      style={{ backgroundColor: '#2CA01C' }}>
      <Link size={12} />
      Connect {label}
    </button>
  );
}

// TAB (default company — all basic services) and TAC (Nominee Director
// invoicing only) are two separate QuickBooks companies. Both connections
// are shown so staff can see at a glance whether either needs attention.
export default function QBConnectButton() {
  const [tab, setTab] = useState<QBStatus | null>(null);
  const [tac, setTac] = useState<QBStatus | null>(null);
  const [verifying, setVerifying] = useState<'TAB' | 'TAC' | null>(null);

  const loadStatus = async (company: 'TAB' | 'TAC', verify = false) => {
    const response = await fetch(`/api/quickbooks/status?company=${company}${verify ? '&verify=true' : ''}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Unable to load ${company} QuickBooks status.`);
    return response.json() as Promise<QBStatus>;
  };

  const verifyExistingConnection = async (company: 'TAB' | 'TAC') => {
    setVerifying(company);
    try {
      const status = await loadStatus(company, true);
      if (company === 'TAB') setTab(status);
      else setTac(status);
    } catch {
      const failed: QBStatus = {
        connected: true,
        authError: { code: 'status_check_failed', message: 'QuickBooks connection verification could not be completed.' },
      };
      if (company === 'TAB') setTab(failed);
      else setTac(failed);
    } finally {
      setVerifying(null);
    }
  };

  useEffect(() => {
    void Promise.all([
      loadStatus('TAB'),
      loadStatus('TAC'),
    ]).then(([tabStatus, tacStatus]) => {
      setTab(tabStatus);
      setTac(tacStatus);

      // Configuration fixes should recover silently. Genuine invalid_grant or
      // expired-token failures remain user-driven because they require the
      // QuickBooks admin to consent again.
      if (tabStatus.authError && !REAUTHORISATION_ERRORS.has(tabStatus.authError.code)) {
        void verifyExistingConnection('TAB');
      }
      if (tacStatus.authError && !REAUTHORISATION_ERRORS.has(tacStatus.authError.code)) {
        void verifyExistingConnection('TAC');
      }
    }).catch(() => {
      setTab({ connected: false });
      setTac({ connected: false });
    });
    // Status is checked once when the dashboard mounts. Manual retries are
    // handled by the badge button and do not create a polling refresh loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-4">
      <CompanyBadge
        label="TAB"
        status={tab}
        verifying={verifying === 'TAB'}
        onConnect={() => { window.location.href = '/api/quickbooks/auth?company=TAB'; }}
        onVerify={() => { void verifyExistingConnection('TAB'); }}
      />
      <CompanyBadge
        label="TAC"
        status={tac}
        verifying={verifying === 'TAC'}
        onConnect={() => { window.location.href = '/api/quickbooks/auth?company=TAC'; }}
        onVerify={() => { void verifyExistingConnection('TAC'); }}
      />
    </div>
  );
}
