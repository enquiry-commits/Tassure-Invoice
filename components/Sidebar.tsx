'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Node = { label: string; href?: string; img?: string; id?: string; children?: Node[] };

// One tree. Level 1 nodes carry a 3D image icon; everything nested is icon-free
// and indented with curved connector rails (see reference design).
const tree: Node[] = [
  { label: 'Dashboard', href: '/',          img: '/nav/dashboard.png' },
  { label: 'Companies', href: '/companies', img: '/nav/companies.png' },
  {
    id: 'master-list', label: 'Master List', img: '/nav/master-list.png',
    children: [
      {
        id: 'active-clients', label: 'Active Clients',
        children: [
          { label: 'Active Client', href: '/master-list/active-clients' },
          { label: 'Ad-Hoc',        href: '/master-list/ad-hoc' },
          { label: 'MAS',           href: '/master-list/mas' },
        ],
      },
      {
        id: 'strike-off', label: 'Strike Off / Terminated',
        children: [
          { label: 'Strike Off',          href: '/master-list/strike-off' },
          { label: 'Terminated Services', href: '/master-list/terminated' },
          { label: 'Change Co Name',      href: '/master-list/name-change' },
          { label: 'Inactive Old Record', href: '/master-list/inactive-old' },
        ],
      },
    ],
  },
  {
    id: 'billing', label: 'Billing System', img: '/nav/billing.png',
    children: [
      { label: 'Nominee Directors', href: '/nominee-directors' },
      { label: 'Address Service',   href: '/address-service' },
      { label: 'AR Reminder',       href: '/billing?tab=ar' },
      { label: 'Late Filing',       href: '/late-filing' },
      { label: 'Billing Drafts',    href: '/billing?tab=billing' },
    ],
  },
];

const groupIds = (nodes: Node[]): string[] =>
  nodes.flatMap(n => (n.children ? [n.id!, ...groupIds(n.children)] : []));
const firstLeaf = (n: Node): string => n.href ?? (n.children ? firstLeaf(n.children[0]) : '#');
const level1 = tree;

const RAIL = 'rgba(255,255,255,0.18)';
const ACTIVE_BG = 'linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.05))';
const ACTIVE_BORDER = 'rgba(255,255,255,0.15)';
const ACTIVE_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.10), 0 3px 10px rgba(0,0,0,0.22)';

function NavImg({ src, size, style }: { src: string; size: number; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size}
    style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'block', ...style }} />;
}

function isActive(href: string, pathname: string, tab: string) {
  if (href === '/')                    return pathname === '/';
  if (href === '/billing?tab=ar')      return pathname === '/billing' && tab === 'ar';
  if (href === '/billing?tab=billing') return pathname === '/billing' && tab !== 'ar';
  return pathname.startsWith(href);
}

// ── Level-1: every top item (leaves AND collapsible groups) shares the same
//    type — 14px title-case, white, 23px icon. Groups just add a chevron. ──
function Level1({ node, active, expanded, onToggle }:
  { node: Node; active: boolean; expanded?: boolean; onToggle?: () => void }) {
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 11, width: 'calc(100% - 20px)',
    padding: '8px 12px', margin: '0 10px 2px', borderRadius: 10,
    border: `1px solid ${active ? ACTIVE_BORDER : 'transparent'}`,
    color: active ? '#fff' : 'rgba(255,255,255,0.92)',
    background: active ? ACTIVE_BG : 'transparent',
    boxShadow: active ? ACTIVE_SHADOW : 'none',
    fontSize: 14, fontWeight: 600, lineHeight: 1.25, textAlign: 'left', cursor: 'pointer',
  };
  const hover = (on: boolean) => (e: React.MouseEvent) => {
    if (active) return;
    (e.currentTarget as HTMLElement).style.background = on ? 'rgba(255,255,255,0.07)' : 'transparent';
    (e.currentTarget as HTMLElement).style.color = on ? '#fff' : 'rgba(255,255,255,0.92)';
  };
  const inner = (
    <>
      <NavImg src={node.img!} size={23} />
      <span style={{ flex: 1 }}>{node.label}</span>
      {onToggle && (expanded ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />)}
    </>
  );
  return onToggle
    ? <button style={rowStyle} onClick={onToggle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{inner}</button>
    : <Link href={node.href!} style={rowStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{inner}</Link>;
}

// ── Nested rows (level ≥ 2): no icon, just the pill. Connector rails are
//    drawn by the parent Branch so they stay continuous across open groups. ──
function SubRow({ node, depth, active, expanded, onToggle }:
  { node: Node; depth: number; active: boolean; expanded?: boolean; onToggle?: () => void }) {
  const isHeader = !!onToggle;
  const idle = isHeader ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.62)';
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: depth >= 3 ? '5px 9px' : '6px 9px',
    borderRadius: 9, textAlign: 'left', cursor: 'pointer',
    border: `1px solid ${active ? ACTIVE_BORDER : 'transparent'}`,
    color: active ? '#fff' : idle,
    background: active ? ACTIVE_BG : 'transparent',
    boxShadow: active ? ACTIVE_SHADOW : 'none',
    // Level 2 (depth 2) sits a step larger than level 3 (depth 3).
    fontSize: depth >= 3 ? 11.5 : 12.5,
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
      {onToggle && (expanded ? <ChevronDown size={13} style={{ opacity: 0.6 }} /> : <ChevronRight size={13} style={{ opacity: 0.6 }} />)}
    </>
  );
  return onToggle
    ? <button style={rowStyle} onClick={onToggle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{label}</button>
    : <Link href={node.href!} style={rowStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{label}</Link>;
}

function Branch({ nodes, depth, act, expanded, toggle }:
  { nodes: Node[]; depth: number; act: (h?: string) => boolean;
    expanded: Record<string, boolean>; toggle: (k: string) => void }) {
  const TICK = 15;
  const CENTER = depth === 1 ? 13 : 12;   // vertical centre of a row, from its top
  return (
    <div style={{ marginLeft: depth === 1 ? 18 : 15, marginRight: depth === 1 ? 12 : 0, position: 'relative' }}>
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        const open = n.children ? expanded[n.id!] : false;
        return (
          <div key={n.id ?? n.href} style={{ position: 'relative', marginBottom: 2 }}>
            {/* curved elbow from the rail into this row */}
            <span aria-hidden style={{
              position: 'absolute', left: 0, top: 0, width: TICK, height: CENTER,
              borderLeft: `1.5px solid ${RAIL}`, borderBottom: `1.5px solid ${RAIL}`,
              borderBottomLeftRadius: 11, pointerEvents: 'none',
            }} />
            {/* vertical rail down to the next sibling — spans this row AND any
                expanded children, so the rail never breaks under an open group */}
            {!last && <span aria-hidden style={{
              position: 'absolute', left: 0, top: CENTER, bottom: -2, width: 1.5, background: RAIL, pointerEvents: 'none',
            }} />}
            <div style={{ paddingLeft: TICK + 9 }}>
              {n.children
                ? <SubRow node={n} depth={depth + 1} active={false} expanded={open} onToggle={() => toggle(n.id!)} />
                : <SubRow node={n} depth={depth + 1} active={act(n.href)} />}
            </div>
            {n.children && open && <Branch nodes={n.children} depth={depth + 1} act={act} expanded={expanded} toggle={toggle} />}
          </div>
        );
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
          const active = n.href ? act(n.href) : false;
          return (
            <Link key={n.id ?? n.href} href={firstLeaf(n)} title={n.label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '9px 0', margin: '0 6px 2px', borderRadius: 9,
                border: `1px solid ${active ? ACTIVE_BORDER : 'transparent'}`,
                background: active ? ACTIVE_BG : 'transparent', boxShadow: active ? ACTIVE_SHADOW : 'none',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <NavImg src={n.img!} size={24} />
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
          <div key={n.id}>
            <Level1 node={n} active={false} expanded={expanded[n.id!]} onToggle={() => toggle(n.id!)} />
            {expanded[n.id!] && (
              <div style={{ marginBottom: 6 }}>
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

  const width = collapsed ? 56 : 232;

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
              style={{ marginTop: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* mirror the collapse icon so it points outward = expand */}
              <NavImg src="/nav/collapse.png" size={24} style={{ transform: 'scaleX(-1)' }} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '10px 10px 10px 14px' }}>
            <button onClick={toggle} title="Collapse sidebar"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 6, display: 'flex', alignItems: 'center' }}>
              <NavImg src="/nav/collapse.png" size={24} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        <Suspense fallback={
          level1.map(n => (
            <div key={n.id ?? n.href} style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 11, padding: collapsed ? '9px 0' : '8px 12px', margin: collapsed ? '0 6px' : '0 8px', color: '#fff' }}>
              <NavImg src={n.img!} size={collapsed ? 24 : 22} />
              {!collapsed && <span className="font-semibold text-sm">{n.label}</span>}
            </div>
          ))
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
