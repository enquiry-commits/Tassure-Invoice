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

function CompanyBadge({ label, status, onConnect }: { label: string; status: QBStatus | null; onConnect: () => void }) {
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
      const configurationError = ['invalid_client', 'missing_client_credentials'].includes(status.authError.code);
      return (
        <button onClick={onConnect} title={status.authError.message}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#dc2626' }}>
          <AlertTriangle size={12} />
          {label} {configurationError ? 'OAuth setup error' : 'connection error'}
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

  useEffect(() => {
    fetch('/api/quickbooks/status?company=TAB').then(r => r.json()).then(setTab).catch(() => setTab({ connected: false }));
    fetch('/api/quickbooks/status?company=TAC').then(r => r.json()).then(setTac).catch(() => setTac({ connected: false }));
  }, []);

  return (
    <div className="flex items-center gap-4">
      <CompanyBadge label="TAB" status={tab} onConnect={() => { window.location.href = '/api/quickbooks/auth?company=TAB'; }} />
      <CompanyBadge label="TAC" status={tac} onConnect={() => { window.location.href = '/api/quickbooks/auth?company=TAC'; }} />
    </div>
  );
}
