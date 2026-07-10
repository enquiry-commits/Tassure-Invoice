'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import {
  LayoutDashboard, Building2, UserCheck, MapPin, FileText, CalendarClock,
  AlertTriangle, PanelLeftClose, PanelLeftOpen, Wallet, ChevronDown, ChevronRight,
  Archive, XCircle, Users,
} from 'lucide-react';

type Icon = typeof LayoutDashboard;
type Node = { label: string; href?: string; Icon?: Icon; id?: string; children?: Node[] };

// One tree. Level 1 nodes carry an icon; everything nested is icon-free and
// indented with connector rails (see reference design).
const tree: Node[] = [
  { label: 'Dashboard', href: '/',          Icon: LayoutDashboard },
  { label: 'Companies', href: '/companies', Icon: Building2 },
  {
    id: 'billing', label: 'Billing System', Icon: Wallet,
    children: [
      { label: 'Nominee Directors', href: '/nominee-directors' },
      { label: 'Address Service',   href: '/address-service' },
      { label: 'AR Reminder',       href: '/billing?tab=ar' },
      { label: 'Late Filing',       href: '/late-filing' },
      { label: 'Billing Drafts',    href: '/billing?tab=billing' },
    ],
  },
  {
    id: 'master-list', label: 'Master List', Icon: Archive,
    children: [
      {
        id: 'active-clients', label: 'Active Clients',
        children: [
          { label: 'Active Client', href: '/master-list/active-clients' },
          { label: 'Ad-Hoc',        href: '/master-list/ad-hoc' },
          { label: 'MAS',           href: '/master-list/mas' },
        ],
      },
    ],
  },
  {
    id: 'strike-off', label: 'Strike Off / Terminated', Icon: XCircle,
    children: [
      { label: 'Strike Off',          href: '/master-list/strike-off' },
      { label: 'Terminated Services', href: '/master-list/terminated' },
      { label: 'Change Co Name',      href: '/master-list/name-change' },
      { label: 'Inactive Old Record', href: '/master-list/inactive-old' },
    ],
  },
];

const groupIds = (nodes: Node[]): string[] =>
  nodes.flatMap(n => (n.children ? [n.id!, ...groupIds(n.children)] : []));
const firstLeaf = (n: Node): string => n.href ?? (n.children ? firstLeaf(n.children[0]) : '#');
const level1 = tree;

const RAIL = 'rgba(255,255,255,0.16)';
const PURPLE = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
const PURPLE_SHADOW = '0 2px 6px rgba(109,40,217,0.35), inset 0 1px 0 rgba(255,255,255,0.12)';

function isActive(href: string, pathname: string, tab: string) {
  if (href === '/')                    return pathname === '/';
  if (href === '/billing?tab=ar')      return pathname === '/billing' && tab === 'ar';
  if (href === '/billing?tab=billing') return pathname === '/billing' && tab !== 'ar';
  return pathname.startsWith(href);
}

// ── Level-1: leaves are big title-case rows; groups keep the uppercase
//    purple-icon section-header type from the original design. ─────────────
function Level1({ node, active, expanded, onToggle }:
  { node: Node; active: boolean; expanded?: boolean; onToggle?: () => void }) {
  const Ico = node.Icon!;

  if (onToggle) {
    // Collapsible section header (Billing System, Master List, …)
    return (
      <button onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: 'calc(100% - 16px)', padding: '9px 10px', margin: '0 8px 2px',
          borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'rgba(255,255,255,0.78)',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.78)'}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
          <Ico size={14} strokeWidth={2.25} style={{ color: '#a78bfa', flexShrink: 0 }} />
          {node.label}
        </span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
    );
  }

  // Primary leaf (Dashboard, Companies)
  return (
    <Link href={node.href!}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)',
        padding: '9px 12px', margin: '0 8px 2px', borderRadius: 9,
        color: active ? '#fff' : 'rgba(255,255,255,0.92)',
        background: active ? PURPLE : 'transparent',
        boxShadow: active ? PURPLE_SHADOW : 'none',
        fontSize: 14, fontWeight: 600, lineHeight: 1.25,
      }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = '#fff'; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.92)'; } }}>
      <Ico size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
      <span>{node.label}</span>
    </Link>
  );
}

// ── Nested rows (level ≥ 2): no icon, indented, with ├ / └ connector rails ──
function SubRow({ node, depth, last, active, expanded, onToggle }:
  { node: Node; depth: number; last: boolean; active: boolean; expanded?: boolean; onToggle?: () => void }) {
  const TICK = 12;
  const isHeader = !!onToggle;            // an expandable sub-group (e.g. Active Clients)
  const idle = isHeader ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.62)';
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: depth >= 3 ? '5px 9px' : '6px 9px',
    marginBottom: 2, borderRadius: 8, border: 'none', textAlign: 'left', cursor: 'pointer',
    color: active ? '#fff' : idle,
    background: active ? PURPLE : 'transparent',
    boxShadow: active ? PURPLE_SHADOW : 'none',
    fontSize: isHeader ? 11.5 : depth >= 3 ? 11.5 : 12.5,
    fontWeight: isHeader ? 700 : active ? 600 : 500,
    letterSpacing: isHeader ? '0.15px' : 'normal',
    lineHeight: 1.2,
  };
  const hover = (on: boolean) => (e: React.MouseEvent) => {
    if (active) return;
    (e.currentTarget as HTMLElement).style.background = on ? 'rgba(255,255,255,0.07)' : 'transparent';
    (e.currentTarget as HTMLElement).style.color = on ? '#fff' : idle;
  };
  const label = (
    <>
      <span style={{ flex: 1 }}>{node.label}</span>
      {onToggle
        ? (expanded ? <ChevronDown size={13} style={{ opacity: 0.6 }} /> : <ChevronRight size={13} style={{ opacity: 0.6 }} />)
        : active && <ChevronRight size={14} style={{ opacity: 0.85 }} />}
    </>
  );
  return (
    <div style={{ position: 'relative', paddingLeft: TICK + 8 }}>
      {/* vertical rail: full height for middle rows, half (└) for the last */}
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: last ? 'calc(50% - 0px)' : 0, width: 1.5, background: RAIL }} />
      {/* horizontal tick into the row */}
      <span style={{ position: 'absolute', left: 0, top: 'calc(50% - 1px)', width: TICK, height: 1.5, background: RAIL }} />
      {onToggle
        ? <button style={rowStyle} onClick={onToggle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{label}</button>
        : <Link href={node.href!} style={rowStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{label}</Link>}
    </div>
  );
}

// Recursive branch for everything below level 1.
function Branch({ nodes, depth, act, expanded, toggle }:
  { nodes: Node[]; depth: number; act: (h?: string) => boolean;
    expanded: Record<string, boolean>; toggle: (k: string) => void }) {
  return (
    <div style={{ marginLeft: depth === 1 ? 18 : 15, position: 'relative' }}>
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        if (n.children) {
          const open = expanded[n.id!];
          return (
            <div key={n.id}>
              <SubRow node={n} depth={depth + 1} last={last} active={false} expanded={open} onToggle={() => toggle(n.id!)} />
              {open && <Branch nodes={n.children} depth={depth + 1} act={act} expanded={expanded} toggle={toggle} />}
            </div>
          );
        }
        return <SubRow key={n.href} node={n} depth={depth + 1} last={last} active={act(n.href)} />;
      })}
    </div>
  );
}

function NavTree({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? '';
  const act = (href?: string) => (href ? isActive(href, pathname, tab) : false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groupIds(tree).map(id => [id, true])));

  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (localStorage.getItem(`sidebar-group-${key}-expanded`) === 'false') next[key] = false;
      }
      return next;
    });
  }, []);

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = !prev[key];
      localStorage.setItem(`sidebar-group-${key}-expanded`, String(next));
      return { ...prev, [key]: next };
    });

  if (collapsed) {
    return (
      <>
        {level1.map(n => {
          const Ico = n.Icon!;
          const active = n.href ? act(n.href) : false;
          return (
            <Link key={n.id ?? n.href} href={firstLeaf(n)} title={n.label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '10px 0', margin: '0 6px 2px', borderRadius: 9,
                color: active ? '#fff' : 'rgba(255,255,255,0.9)',
                background: active ? PURPLE : 'transparent', boxShadow: active ? PURPLE_SHADOW : 'none',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Ico size={18} strokeWidth={1.75} />
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <>
      {level1.map(n =>
        n.children ? (
          <div key={n.id} style={{ marginTop: n.id === 'billing' ? 8 : 4 }}>
            <Level1 node={n} active={false} expanded={expanded[n.id!]} onToggle={() => toggle(n.id!)} />
            {expanded[n.id!] && (
              <div style={{ marginBottom: 4 }}>
                <Branch nodes={n.children} depth={1} act={act} expanded={expanded} toggle={toggle} />
              </div>
            )}
          </div>
        ) : (
          <Level1 key={n.href} node={n} active={act(n.href)} />
        )
      )}
    </>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true);
  }, []);
  const toggle = () =>
    setCollapsed(v => { localStorage.setItem('sidebar-collapsed', String(!v)); return !v; });

  const width = collapsed ? 56 : 216;

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{ background: 'linear-gradient(180deg, #1e3a5f 0%, #17293f 100%)', width, overflow: 'hidden', transition: 'width 0.22s ease' }}
    >
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0 8px' }}>
            <button onClick={toggle} title="Expand sidebar"
              style={{ marginTop: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.22)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'}>
              <PanelLeftOpen size={15} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 10px 12px 14px' }}>
            <button onClick={toggle} title="Collapse sidebar"
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'}>
              <PanelLeftClose size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        <Suspense fallback={
          level1.map(n => {
            const Ico = n.Icon!;
            return (
              <div key={n.id ?? n.href} style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 12, padding: collapsed ? '10px 0' : '9px 12px', margin: collapsed ? '0 6px' : '0 8px', color: '#fff' }}>
                <Ico size={18} strokeWidth={1.75} />
                {!collapsed && <span className="font-semibold text-sm">{n.label}</span>}
              </div>
            );
          })
        }>
          <NavTree collapsed={collapsed} />
        </Suspense>
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', color: '#93c5fd', flexShrink: 0 }}>
          <div className="font-medium text-white">VS Vincent</div>
          <div>Tassure Asia</div>
        </div>
      )}
    </aside>
  );
}
