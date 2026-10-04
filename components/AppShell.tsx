'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';
import AssistantWidget from '@/components/AssistantWidget';
import { SessionProvider, canOpenFor, type SessionUser } from '@/components/SessionContext';
import { applyThemeTokens } from '@/lib/apply-theme';
import { logActivity } from '@/lib/activity-client';
import { WORKSPACES, VIEW_WORKSPACE_COOKIE, canSubjectOpenHref, type WorkspaceId } from '@/lib/workspaces';

const clearViewCookie = () => { document.cookie = `${VIEW_WORKSPACE_COOKIE}=; path=/; max-age=0; samesite=lax`; };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const isAuthPage = pathname === '/login' || pathname.startsWith('/auth/');

  useEffect(() => {
    if (isAuthPage) return;
    fetch('/api/auth/me').then(response => response.ok ? response.json() : null)
      .then(result => setUser(result?.user ?? null)).catch(() => setUser(null));
  }, [isAuthPage]);

  // Applies the saved appearance settings as CSS vars on every hard
  // load/refresh — this IS the "global + live" theme: the admin editor
  // live-previews the same way on every edit (before Save), everyone else
  // picks up a change on their next page load. A failed/slow fetch just
  // leaves globals.css's hardcoded defaults in place.
  useEffect(() => {
    if (isAuthPage) return;
    fetch('/api/appearance-settings').then(response => response.ok ? response.json() : null)
      .then(result => result?.tokens && applyThemeTokens(result.tokens)).catch(() => {});
  }, [isAuthPage]);

  // Vincent, 2026-09-08: "现在每个用户进入系统后的点击操作路径" — every
  // route change, for every real page, logged once here rather than
  // instrumented per-page — mounted at the app shell so this covers the
  // whole site automatically as new pages get added, not just the ones
  // someone remembered to add a tracking call to. Login/auth pages excluded
  // (not meaningful — everyone hits them once, logged out).
  useEffect(() => {
    if (isAuthPage) return;
    logActivity('page_view');
  }, [pathname, isAuthPage]);

  const canOpen = useCallback((href: string) => canOpenFor(user, href), [user]);
  const session = useMemo(() => ({ user, canOpen }), [user, canOpen]);

  // 切换部门 (Vincent, 2026-10-04: "他们可以随时切换不同的部门来查看不同的界
  // 面，具体的切换放在 Logout 按钮的这边"). Only changes the menu and title
  // shown — /api/auth/me validates the cookie, proxy.ts and every API ignore
  // it. Landing on a page the previewed department doesn't have moves to
  // that department's home, so the preview starts where its staff start.
  function switchWorkspace(id: WorkspaceId) {
    if (!user) return;
    if (id === user.workspace) clearViewCookie();
    else document.cookie = `${VIEW_WORKSPACE_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    setUser({ ...user, viewWorkspace: id });
    if (!canSubjectOpenHref(user, window.location.pathname + window.location.search, id)) router.push(WORKSPACES[id].home);
  }

  async function logout() {
    // Sidebar group expand/collapse choices live in localStorage, which
    // outlives the auth session — without clearing it here, whoever logs in
    // next (even the same person) inherits whatever was left expanded from
    // the previous session instead of the collapsed-by-default state. Same
    // for the 切换部门 preview: the next login starts in its own department.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sidebar-group-')) localStorage.removeItem(key);
    }
    clearViewCookie();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  if (isAuthPage) return children;
  const title = user ? WORKSPACES[user.viewWorkspace].title : '';
  const previewing = !!user && user.viewWorkspace !== user.workspace;
  return (
    <SessionProvider value={session}>
      <MobileNav title={title} ready={!!user} canOpen={canOpen} />
      <header className="desktop-only flex items-center justify-between px-8 flex-shrink-0 z-50" style={{ height: 70, background: 'var(--header-bg)', borderBottom: '1px solid rgba(30,58,95,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <Image src="/logo.png" alt="Tassure" height={44} width={44} className="object-contain rounded" priority />
          <span style={{ fontSize: 18, fontWeight: 800, color: '#1e3a5f', letterSpacing: '-0.3px' }}>{title}</span>
          {previewing && (
            <span title="你正在预览这个部门的界面——只改变显示的菜单和抬头，你自己的权限没有变" style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 9px' }}>预览中</span>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 20 }}>
          <div style={{ display: 'grid', justifyItems: 'end', lineHeight: 1.25 }}>
            <span style={{ fontSize: 13, fontWeight: 750, color: '#1e3a5f' }}>{user?.name ?? 'Tassure user'}</span>
            {user?.email && <span style={{ fontSize: 11, color: '#8492a8' }}>{user.email}</span>}
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            {user && user.switchableWorkspaces.length > 0 && (
              <label title="切换部门：只切换显示的菜单和抬头，不改变你的权限"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #dbe2ea', background: '#fff', color: '#1e3a5f', borderRadius: 8, padding: '0 6px 0 10px', height: 35, cursor: 'pointer' }}>
                <ArrowLeftRight size={14} />
                <select aria-label="切换部门" value={user.viewWorkspace} onChange={e => switchWorkspace(e.target.value as WorkspaceId)}
                  style={{ border: 'none', background: 'transparent', color: '#1e3a5f', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', outline: 'none', height: 33 }}>
                  {user.switchableWorkspaces.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
                </select>
              </label>
            )}
            <button onClick={logout} className="header-logout">Logout</button>
            <AssistantWidget />
          </div>
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar ready={!!user} canOpen={canOpen} />
        <main style={{ flex: 1, overflowY: 'auto', background: '#f1f5f9' }}><div className="p-6">{children}</div></main>
      </div>
    </SessionProvider>
  );
}
