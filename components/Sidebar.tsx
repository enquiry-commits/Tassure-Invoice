'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  UserCheck,
  MapPin,
  FileText,
} from 'lucide-react';

const navItems = [
  { href: '/',                  label: 'Dashboard',         Icon: LayoutDashboard },
  { href: '/companies',         label: 'Companies',         Icon: Building2       },
  { href: '/nominee-directors', label: 'Nominee Directors', Icon: UserCheck       },
  { href: '/address-service',   label: 'Address Service',   Icon: MapPin          },
  { href: '/billing',           label: 'Billing Drafts',    Icon: FileText        },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{ backgroundColor: '#1d3a5c', width: '208px', overflowY: 'auto' }}
    >
      <nav className="flex-1 py-3 overflow-y-auto">
        {navItems.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg mb-0.5 text-sm transition-colors"
              style={{
                color: '#ffffff',
                backgroundColor: active ? '#2563eb' : 'transparent',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = '#2a5080';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <Icon size={16} strokeWidth={1.75} />
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-white/10 text-xs text-blue-300">
        <div className="font-medium text-white">VS Vincent</div>
        <div>Tassure Asia</div>
      </div>
    </aside>
  );
}
