'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyUenButton({ uen }: { uen: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(uen).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      title="Copy UEN"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none', background: 'transparent', cursor: 'pointer', color: copied ? '#15803d' : '#94a3b8', padding: 2 }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
