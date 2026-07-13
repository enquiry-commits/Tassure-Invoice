'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Link, Loader, AlertTriangle } from 'lucide-react';
import { fmtDate } from '@/lib/date';

interface QBStatus {
  connected: boolean;
  lastConnected?: string | null;
  refreshExpired?: boolean;
  refreshExpiresInDays?: number | null;
}

export default function QBConnectButton() {
  const [status, setStatus] = useState<QBStatus | null>(null);

  useEffect(() => {
    fetch('/api/quickbooks/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  const handleConnect = () => {
    window.location.href = '/api/quickbooks/auth';
  };

  if (!status) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader size={13} className="animate-spin" />
        Checking QuickBooks…
      </div>
    );
  }

  if (status.connected) {
    const when = status.lastConnected ? fmtDate(status.lastConnected) : null;
    const days = status.refreshExpiresInDays;
    // Refresh token already dead, or dying within 30 days: warn loudly —
    // when it lapses, invoice generation fails until re-authorised.
    if (status.refreshExpired || (typeof days === 'number' && days <= 0)) {
      return (
        <button onClick={handleConnect}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#dc2626' }}>
          <AlertTriangle size={13} />
          QuickBooks authorisation expired — reconnect now
        </button>
      );
    }
    if (typeof days === 'number' && days <= 30) {
      return (
        <button onClick={handleConnect}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
          <AlertTriangle size={13} />
          QuickBooks authorisation expires in {days}d — click to renew
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <CheckCircle size={14} className="text-green-500" />
        <span className="text-xs text-slate-500">
          QuickBooks connected{when ? ` · ${when}` : ''}
        </span>
        <button onClick={handleConnect} className="text-xs text-blue-500 hover:underline ml-1">
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity"
      style={{ backgroundColor: '#2CA01C' }}
    >
      <Link size={13} />
      Connect QuickBooks
    </button>
  );
}
