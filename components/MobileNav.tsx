'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';

// Phone-only top bar + slide-in drawer (hidden entirely above 768px via the
// .mobile-only class in globals.css — the desktop header/sidebar are separate
// elements and completely unaffected).
const LINKS: { group: string; items: { label: string; href: string }[] }[] = [
  { group: '', items: [
    { label: 'Dashboard', href: '/' },
    { label: 'Companies', href: '/companies' },
  ]},
  { group: 'Master List', items: [
    { label: 'Active Client',       href: '/master-list/active-clients' },
    { label: 'Ad-Hoc',              href: '/master-list/ad-hoc' },
    { label: 'MAS',                 href: '/master-list/mas' },
    { label: 'Strike Off',          href: '/master-list/strike-off' },
    { label: 'Terminated Services', href: '/master-list/terminated' },
    { label: 'Change Co Name',      href: '/master-list/name-change' },
  ]},
  { group: 'Billing System', items: [
    { label: 'Nominee Directors', href: '/nominee-directors' },
    { label: 'Address Service',   href: '/address-service' },
    { label: 'AR Reminder',       href: '/billing?tab=ar' },
    { label: 'Late Filing',       href: '/late-filing' },
    { label: 'Billing Drafts',    href: '/billing?tab=billing' },
  ]},
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <header className="mobile-only" style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 54, padding: '0 12px',
        background: 'linear-gradient(135deg,#ffffff,#f8fafc)', borderBottom: '1px solid rgba(30,58,95,0.08)',
        flexShrink: 0, zIndex: 60,
      }}>
        <button onClick={() => setOpen(true)} aria-label="Menu"
          style={{ background: 'transparent', border: 'none', padding: 6, cursor: 'pointer', display: 'flex', color: '#1e3a5f' }}>
          <Menu size={22} />
        </button>
        <Image src="/logo.png" alt="Tassure" height={30} width={30} className="object-contain rounded" />
        <span style={{ fontSize: 14, fontWeight: 800, color: '#1e3a5f', letterSpacing: '-0.2px' }}>Tassure System</span>
      </header>

      {open && (
        <div className="mobile-only" style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          {/* backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)' }} />
          {/* drawer */}
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0, width: 264, maxWidth: '80vw',
            background: 'linear-gradient(180deg,#1e3a5f 0%,#17293f 100%)', overflowY: 'auto',
            boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <Image src="/logo.png" alt="" height={28} width={28} className="object-contain rounded" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>Tassure System</span>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <X size={16} />
              </button>
            </div>
            <nav style={{ padding: '10px 10px 24px' }}>
              {LINKS.map(({ group, items }) => (
                <div key={group || 'top'}>
                  {group && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '14px 10px 5px' }}>{group}</div>
                  )}
                  {items.map(l => {
                    // Drawer only renders after a tap (client-side), so window
                    // is safe to read for the ?tab= disambiguation.
                    const [base, query] = l.href.split('?');
                    let active = base === '/' ? pathname === '/' : pathname.startsWith(base);
                    if (active && query) {
                      const want = new URLSearchParams(query).get('tab');
                      const cur = new URLSearchParams(window.location.search).get('tab') ?? '';
                      active = want === 'ar' ? cur === 'ar' : cur !== 'ar';
                    }
                    return (
                      <Link key={l.href} href={l.href}
                        style={{
                          display: 'block', padding: '10px 12px', borderRadius: 9, marginBottom: 2,
                          fontSize: 13.5, fontWeight: active ? 700 : 500, textDecoration: 'none',
                          color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                          background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                        }}>
                        {l.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
              <div style={{ padding: '16px 10px 0', fontSize: 11, color: '#93c5fd' }}>
                <div style={{ fontWeight: 600, color: '#fff' }}>VS Vincent</div>
                <div>Tassure Asia</div>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
