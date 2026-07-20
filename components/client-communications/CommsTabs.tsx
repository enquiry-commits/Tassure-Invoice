'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: 'Campaign Centre',     href: '/client-communications/campaigns' },
  { label: 'Draft Review',        href: '/client-communications/drafts' },
  { label: 'Delivery History',    href: '/client-communications/history' },
  { label: 'Templates & Senders', href: '/client-communications/templates' },
];

export default function CommsTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 18 }}>
      {TABS.map(t => {
        const active = pathname === t.href;
        return (
          <Link key={t.href} href={t.href}
            style={{
              padding: '9px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none',
              color: active ? '#1d3a5c' : '#94a3b8',
              borderBottom: active ? '2px solid #1d3a5c' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
