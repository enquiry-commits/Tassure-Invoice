'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import {
  LayoutDashboard, Building2, UserCheck, MapPin, FileText, CalendarClock,
  AlertTriangle, PanelLeftClose, PanelLeftOpen, Wallet, ChevronDown, ChevronRight,
  Archive, XCircle, UserX, Repeat2, ArchiveX, Users, Shuffle, Landmark,
} from 'lucide-react';

type LeafItem = { href: string; label: string; Icon: typeof LayoutDashboard };
type SubGroup = { id: string; label: string; Icon: typeof LayoutDashboard; items: LeafItem[] };
type Group = { id: string; label: string; Icon: typeof LayoutDashboard; items?: LeafItem[]; subGroups?: SubGroup[] };

// Foundation of the future company-wide system — kept flat, top-level
const topItems: LeafItem[] = [
  { href: '/',          label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/companies', label: 'Companies', Icon: Building2       },
];

// Collapsible groups, in display order
const groups: Group[] = [
  {
    id: 'billing',
    label: 'Billing System',
    Icon: Wallet,
    items: [
      { href: '/nominee-directors', label: 'Nominee Directors', Icon: UserCheck     },
      { href: '/address-service',   label: 'Address Service',   Icon: MapPin        },
      { href: '/billing?tab=ar',      label: 'AR Reminder',    Icon: CalendarClock },
      { href: '/late-filing',         label: 'Late Filing',    Icon: AlertTriangle },
      { href: '/billing?tab=billing', label: 'Billing Drafts', Icon: FileText      },
    ],
  },
  {
    id: 'master-list',
    label: 'Master List',
    Icon: Archive,
    subGroups: [
      {
        id: 'active-clients',
        label: 'Active Clients',
        Icon: Users,
        items: [
          { href: '/master-list/active-clients', label: 'Active Client', Icon: Users    },
          { href: '/master-list/ad-hoc',         label: 'Ad-Hoc',        Icon: Shuffle  },
          { href: '/master-list/mas',            label: 'MAS',           Icon: Landmark },
        ],
      },
      {
        id: 'strike-off-terminated',
        label: 'Strike Off/Terminated',
        Icon: XCircle,
        items: [
          { href: '/master-list/strike-off',     label: 'Strike Off',           Icon: XCircle  },
          { href: '/master-list/terminated',     label: 'Terminated Services',  Icon: UserX    },
          { href: '/master-list/name-change',    label: 'Change Co Name',       Icon: Repeat2  },
          { href: '/master-list/inactive-old',   label: 'Inactive Old Record',  Icon: ArchiveX },
        ],
      },
    ],
  },
];

const allItems = [
  ...topItems,
  ...groups.flatMap(g => g.items ?? g.subGroups?.flatMap(sg => sg.items) ?? []),
];

function isActive(href: string, pathname: string, currentTab: string) {
  if (href === '/')                    return pathname === '/';
  if (href === '/billing?tab=ar')      return pathname === '/billing' && currentTab === 'ar';
  if (href === '/billing?tab=billing') return pathname === '/billing' && currentTab !== 'ar';
  return pathname.startsWith(href);
}

function NavLink({ href, label, Icon, collapsed, depth = 1 }: LeafItem & { collapsed: boolean; depth?: 1 | 2 | 3 }) {
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const currentTab   = searchParams.get('tab') ?? '';
  const active       = isActive(href, pathname, currentTab);
  const sub          = depth > 1;
  const fontSize     = depth === 1 ? 14 : depth === 2 ? 12.5 : 11.5;
  const iconSize     = depth === 1 ? 18 : depth === 2 ? 15 : 13;

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="flex items-center transition-all"
      style={{
        gap: collapsed ? 0 : sub ? 9 : 12,
        padding: collapsed ? '10px 0' : depth === 3 ? '5px 9px' : sub ? '6px 9px' : '9px 12px',
        margin: collapsed ? '0 6px 2px' : depth === 3 ? '0 0 1px' : sub ? '0 0 2px' : '0 8px 2px',
        borderRadius: depth === 3 ? 7 : 9,
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: active ? '#ffffff' : sub ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.92)',
        background: active
          ? 'linear-gradient(135deg, #7c3aed, #6d28d9)'
          : 'transparent',
        boxShadow: active ? '0 2px 6px rgba(109,40,217,0.35), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
      }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = '#fff'; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = sub ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.92)'; } }}
    >
      <Icon size={iconSize} strokeWidth={1.75} style={{ flexShrink: 0 }} />
      {!collapsed && <span style={{ fontSize, fontWeight: sub ? 500 : 600, lineHeight: 1.25 }}>{label}</span>}
    </Link>
  );
}

// Top-level collapsible group — rendered as an elevated card
function GroupHeader({ label, Icon, expanded, onToggle }: { label: string; Icon: typeof LayoutDashboard; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between transition-colors"
      style={{
        padding: '9px 10px',
        borderRadius: 8,
        color: 'rgba(255,255,255,0.78)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.78)'}
    >
      <span className="flex items-center" style={{ gap: 8, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
        <Icon size={14} strokeWidth={2.25} style={{ color: '#a78bfa' }} />
        {label}
      </span>
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
}

// Level-2 header nested inside a top-level group card (e.g. "Active Clients" under "Master List") — its own nested card
function SubGroupHeader({ label, Icon, expanded, onToggle }: { label: string; Icon: typeof LayoutDashboard; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between transition-colors"
      style={{
        padding: '6px 8px',
        borderRadius: 6,
        color: 'rgba(255,255,255,0.68)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.68)'}
    >
      <span className="flex items-center" style={{ gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.15px' }}>
        <Icon size={12.5} strokeWidth={2} style={{ color: '#c4b5fd' }} />
        {label}
      </span>
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  );
}

function NavLinks({ collapsed }: { collapsed: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.id] = true;
      for (const sg of g.subGroups ?? []) init[`${g.id}.${sg.id}`] = true;
    }
    return init;
  });

  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const saved = localStorage.getItem(`sidebar-group-${key}-expanded`);
        if (saved === 'false') next[key] = false;
      }
      return next;
    });
  }, []);

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = !prev[key];
      localStorage.setItem(`sidebar-group-${key}-expanded`, String(next));
      return { ...prev, [key]: next };
    });
  };

  if (collapsed) {
    return <>{allItems.map(item => <NavLink key={item.href} {...item} collapsed />)}</>;
  }

  return (
    <>
      {topItems.map(item => <NavLink key={item.href} {...item} collapsed={false} />)}
      {groups.map(g => (
        <div
          key={g.id}
          style={{
            margin: '10px 8px 0',
            padding: 6,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
          }}
        >
          <GroupHeader label={g.label} Icon={g.Icon} expanded={expanded[g.id]} onToggle={() => toggle(g.id)} />
          {expanded[g.id] && (
            <div style={{ marginTop: 3 }}>
              {g.items?.map(item => <NavLink key={item.href} {...item} collapsed={false} depth={2} />)}
              {g.subGroups?.map(sg => {
                const key = `${g.id}.${sg.id}`;
                return (
                  <div
                    key={sg.id}
                    style={{
                      marginTop: 4,
                      padding: 5,
                      borderRadius: 9,
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <SubGroupHeader label={sg.label} Icon={sg.Icon} expanded={expanded[key]} onToggle={() => toggle(key)} />
                    {expanded[key] && (
                      <div style={{ marginTop: 2 }}>
                        {sg.items.map(item => <NavLink key={item.href} {...item} collapsed={false} depth={3} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // Persist across page navigations
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);
  const toggle = () => {
    setCollapsed(v => {
      localStorage.setItem('sidebar-collapsed', String(!v));
      return !v;
    });
  };

  const width = collapsed ? 56 : 216;

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{
        background: 'linear-gradient(180deg, #1e3a5f 0%, #17293f 100%)',
        width,
        overflow: 'hidden',
        transition: 'width 0.22s ease',
      }}
    >
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {collapsed ? (
          /* Collapsed: logo + visible expand button */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0 8px' }}>
            <button
              onClick={toggle}
              title="Expand sidebar"
              style={{ marginTop: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.22)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'}
            >
              <PanelLeftOpen size={15} />
            </button>
          </div>
        ) : (
          /* Expanded: logo left, collapse button right */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 10px 12px 14px' }}>
            <button
              onClick={toggle}
              title="Collapse sidebar"
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        <Suspense fallback={
          allItems.map(({ href, label, Icon }) => (
            <div key={href} style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 12, padding: collapsed ? '10px 0' : '9px 12px', margin: collapsed ? '0 6px' : '0 8px', color: '#ffffff' }}>
              <Icon size={18} strokeWidth={1.75} />
              {!collapsed && <span className="font-medium text-sm">{label}</span>}
            </div>
          ))
        }>
          <NavLinks collapsed={collapsed} />
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
