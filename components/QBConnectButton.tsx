'use client';

import { CheckCircle, Link } from 'lucide-react';

interface Props {
  connected: boolean;
  lastConnected?: string | null;
}

export default function QBConnectButton({ connected, lastConnected }: Props) {
  const handleConnect = () => {
    window.location.href = '/api/quickbooks/auth';
  };

  if (connected) {
    const when = lastConnected
      ? new Date(lastConnected).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;
    return (
      <div className="flex items-center gap-2">
        <CheckCircle size={15} className="text-green-500" />
        <span className="text-xs text-slate-500">
          QuickBooks connected{when ? ` · ${when}` : ''}
        </span>
        <button
          onClick={handleConnect}
          className="text-xs text-blue-500 hover:underline ml-1"
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
      style={{ backgroundColor: '#2CA01C' }}
    >
      <Link size={13} />
      Connect QuickBooks
    </button>
  );
}
