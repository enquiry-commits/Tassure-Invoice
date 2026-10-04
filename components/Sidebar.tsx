'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, ListChecks, BarChart3, ShieldCheck, Newspaper, ScanLine } from 'lucide-react';
import { NAV_TREE, filterNav, navGroupIds, type NavNode as Node, type NavIcon } from '@/lib/nav-tree';

// The tree itself lives in lib/nav-tree.ts (shared with MobileNav). This file
// only draws it: level 1 nodes carry a 3D image icon (or a lucide fallback
// for entries with no custom PNG yet); everything nested is icon-free and
// indented with curved connector rails (see reference design). What an
// account sees is the tree filtered through its department workspace
// (lib/workspaces.ts via AppShell's canOpen) — the same rule proxy.ts
// enforces, so the menu never offers a page that would bounce.
const ICONS: Record<NavIcon, typeof ListChecks> = {
  'list-checks': ListChecks, newspaper: Newspaper, 'bar-chart': BarChart3, 'scan-line': ScanLine, 'shield-check': ShieldCheck,
};

function LucideIcon({ name, size, style }: { name: NavIcon; size: number; style?: React.CSSProperties }) {
  const Icon = ICONS[name];
  return <Icon size={size} style={style} />;
}

const SIDEBAR_GROUP_IDS = navGroupIds(NAV_TREE);
const firstLeaf = (n: Node): string => n.href ?? (n.children ? firstLeaf(n.children[0]) : '#');

const RAIL = 'rgba(255,255,255,0.18)';
// Appearance Settings (lib/theme-tokens.ts) controls these two — previously
// hardcoded, now genuine CSS-var references so the sidebar/hover colors are
// actually editable. Nothing else about how/when they apply changed.
const ACTIVE_BG = 'var(--sidebar-active)';
const HOVER_BG = 'var(--sidebar-hover)';
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
    (e.currentTarget as HTMLElement).style.background = on ? HOVER_BG : 'transparent';
    (e.currentTarget as HTMLElement).style.color = on ? '#fff' : 'rgba(255,255,255,0.92)';
  };
  const inner = (
    <>
      {node.img ? <NavImg src={node.img} size={23} /> : node.icon ? <LucideIcon name={node.icon} size={20} style={{ flexShrink: 0 }} /> : null}
      <span style={{ flex: 1 }}>{node.label}</span>
      {onToggle && (expanded ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />)}
    </>
  );
  return onToggle
    ? <button style={rowStyle} onClick={onToggle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{inner}</button>
    : <Link href={node.href!} target={node.external ? '_blank' : undefined} rel={node.external ? 'noopener noreferrer' : undefined}
        style={rowStyle} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{inner}</Link>;
}

// ── Nested rows (level ≥ 2): no icon, just the pill. Connector rails are
//    drawn by the parent Branch so they stay continuous across open groups. ──
function SubRow({ node, depth, active, expanded, onToggle }:
  { node: Node; depth: number; active: boolean; expanded?: boolean; onToggle?: () => void }) {
  // Expandable sub-group headers (Active Clients, Strike Off/Terminated) use
  // the exact same type as the leaf rows at their level — only the chevron
  // marks them as expandable.
  const idle = 'rgba(255,255,255,0.62)';
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
    fontWeight: active ? 600 : 500,
    letterSpacing: 'normal',
    lineHeight: 1.2,
  };
  const hover = (on: boolean) => (e: React.MouseEvent) => {
    if (active) return;
    (e.currentTarget as HTMLElement).style.background = on ? HOVER_BG : 'transparent';
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
  return (
    <div style={{ marginLeft: depth === 1 ? 18 : 15, marginRight: depth === 1 ? 12 : 0, position: 'relative' }}>
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        const open = n.children ? expanded[n.id!] : false;
        // Draw the vertical line down to the next sibling — but NOT when this
        // row is an expanded group. Its children already separate it from the
        // next sibling, and a long line bridging that gap looks wrong. The next
        // sibling then starts with just its own curved elbow.
        const connect = !last && !open;
        return (
          <div key={n.id ?? n.href}>
            <div style={{ position: 'relative', paddingLeft: TICK + 9, marginBottom: 2 }}>
              {/* curved elbow from the rail into this row */}
              <span aria-hidden style={{
                position: 'absolute', left: 0, top: 0, width: TICK, height: '50%',
                borderLeft: `1.5px solid ${RAIL}`, borderBottom: `1.5px solid ${RAIL}`,
                borderBottomLeftRadius: 11, pointerEvents: 'none',
              }} />
              {connect && <span aria-hidden style={{
                position: 'absolute', left: 0, top: '50%', bottom: -2, width: 1.5, background: RAIL, pointerEvents: 'none',
              }} />}
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

function NavTree({ collapsed, level1 }: { collapsed: boolean; level1: Node[] }) {
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? '';
  const act = (href?: string) => (href ? isActive(href, pathname, tab) : false);

  // Collapsed by default — groups only open when a user actually clicks into
  // them (or previously chose to leave one open, remembered per-key below).
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SIDEBAR_GROUP_IDS.map(id => [id, false])));

  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const stored = localStorage.getItem(`sidebar-group-${key}-expanded`);
        if (stored === 'true') next[key] = true;
        else if (stored === 'false') next[key] = false;
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
              target={n.external ? '_blank' : undefined} rel={n.external ? 'noopener noreferrer' : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '9px 0', margin: '0 6px 2px', borderRadius: 9,
                border: `1px solid ${active ? ACTIVE_BORDER : 'transparent'}`,
                background: active ? ACTIVE_BG : 'transparent', boxShadow: active ? ACTIVE_SHADOW : 'none',
                color: '#fff',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = HOVER_BG; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {n.img ? <NavImg src={n.img} size={24} /> : n.icon ? <LucideIcon name={n.icon} size={21} /> : null}
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

// `ready` is false until /api/auth/me has answered: the menu stays empty
// rather than briefly showing pages outside the person's department.
export default function Sidebar({ ready, canOpen }: { ready: boolean; canOpen: (href: string) => boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const level1 = ready ? filterNav(NAV_TREE, canOpen) : [];

  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true);
  }, []);
  const toggle = () =>
    setCollapsed(v => { localStorage.setItem('sidebar-collapsed', String(!v)); return !v; });

  const width = collapsed ? 56 : 232;

  return (
    <aside
      className="desktop-only flex flex-col flex-shrink-0"
      style={{ background: 'var(--sidebar-bg)', width, overflow: 'hidden', transition: 'width 0.22s ease' }}
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
              {n.img ? <NavImg src={n.img} size={collapsed ? 24 : 22} /> : n.icon ? <LucideIcon name={n.icon} size={collapsed ? 21 : 20} /> : null}
              {!collapsed && <span className="font-semibold text-sm">{n.label}</span>}
            </div>
          ))
        }>
          <NavTree collapsed={collapsed} level1={level1} />
        </Suspense>
      </nav>

    </aside>
  );
}
