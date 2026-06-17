'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/',                   label: 'Dashboard',          icon: '⊞' },
  { href: '/companies',          label: 'Companies',          icon: '🏢' },
  { href: '/nominee-directors',  label: 'Nominee Directors',  icon: '👤' },
  { href: '/address-service',    label: 'Address Service',    icon: '📍' },
  { href: '/billing',            label: 'Billing Drafts',     icon: '📄' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-52 flex flex-col z-40"
      style={{ backgroundColor: '#1d3a5c' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
          style={{ backgroundColor: '#7c3aed' }}
        >
          T
        </div>
        <div className="leading-tight">
          <div className="text-white font-bold text-sm">T Assure</div>
          <div className="text-blue-300 text-xs">Billing System</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {navItems.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg mb-0.5 text-sm transition-colors"
              style={{
                color: active ? '#ffffff' : '#93c5fd',
                backgroundColor: active ? '#2563eb' : 'transparent',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = '#2a5080';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <span className="text-base w-5 text-center">{icon}</span>
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10 text-xs text-blue-300">
        <div className="font-medium text-white">VS Vincent</div>
        <div>Tassure Asia</div>
      </div>
    </aside>
  );
}
