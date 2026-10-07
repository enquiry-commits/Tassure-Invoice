'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV_TREE, filterNav, navLeaves, type NavNode } from '@/lib/nav-tree';

// Phone-only top bar + slide-in drawer (hidden entirely above 768px via the
// .mobile-only class in globals.css — the desktop header/sidebar are separate
// elements and completely unaffected). Draws the SAME tree as the desktop
// Sidebar (lib/nav-tree.ts), filtered by the same department rule — it used
// to keep its own hand-written link list that showed every page to everyone
// and had drifted from the desktop menu. Each level-1 group becomes a
// section; a leaf nested one level deeper is prefixed with its sub-group
// ("Outstanding · TAB").
type Section = { group: string; items: { label: string; href: string; external?: boolean }[] };

function sectionsFor(level1: NavNode[]): Section[] {
  const sections: Section[] = [];
  for (const node of level1) {
    if (node.children) {
      sections.push({
        group: node.label,
        items: navLeaves(node.children).map(({ node: leaf, trail }) => ({
          label: trail.length ? `${trail[trail.length - 1]} · ${leaf.label}` : leaf.label,
          href: leaf.href!, external: leaf.external,
        })),
      });
    } else {
      const item = { label: node.label, href: node.href!, external: node.external };
      const last = sections[sections.length - 1];
      if (last && !last.group) last.items.push(item);
      else sections.push({ group: '', items: [item] });
    }
  }
  return sections;
}

export default function MobileNav({ title, ready, canOpen }: { title: string; ready: boolean; canOpen: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  const sections = ready ? sectionsFor(filterNav(NAV_TREE, canOpen)) : [];

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
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', letterSpacing: '-0.2px' }}>{title}</span>
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
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>{title}</span>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <X size={16} />
              </button>
            </div>
            <nav style={{ padding: '10px 10px 24px' }}>
              {sections.map(({ group, items }, i) => (
                <div key={group || `top-${i}`}>
                  {group && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '14px 10px 5px' }}>{group}</div>
                  )}
                  {/* top-level items after a group (e.g. Turnover AI after Billing System) must not read as part of it */}
                  {!group && i > 0 && <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '10px 10px 8px' }} />}
                  {items.map(l => {
                    // Drawer only renders after a tap (client-side), so window
                    // is safe to read for the ?tab= disambiguation.
                    const [base, query] = l.href.split('?');
                    let active = base === '/' || query ? pathname === base : pathname.startsWith(base);
                    if (active && query) {
                      const want = new URLSearchParams(query).get('tab');
                      const cur = new URLSearchParams(window.location.search).get('tab') ?? '';
                      active = want === 'ar' ? cur === 'ar' : cur !== 'ar';
                    }
                    return (
                      <Link key={l.href} href={l.href}
                        target={l.external ? '_blank' : undefined} rel={l.external ? 'noopener noreferrer' : undefined}
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
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
