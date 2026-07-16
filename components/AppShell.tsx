'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';
import AssistantWidget from '@/components/AssistantWidget';

type SessionUser = { email?: string; name: string };

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

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  if (isAuthPage) return children;
  return (
    <>
      <MobileNav />
      <header className="desktop-only flex items-center justify-between px-8 flex-shrink-0 z-50" style={{ height: 70, background: 'linear-gradient(135deg, #ffffff, #f8fafc)', borderBottom: '1px solid rgba(30,58,95,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <Image src="/logo.png" alt="Tassure" height={44} width={44} className="object-contain rounded" priority />
          <span style={{ fontSize: 18, fontWeight: 800, color: '#1e3a5f', letterSpacing: '-0.3px' }}>Tassure Corporate Services System</span>
        </div>
        <div className="flex items-center" style={{ gap: 20 }}>
          <div style={{ display: 'grid', justifyItems: 'end', lineHeight: 1.25 }}>
            <span style={{ fontSize: 13, fontWeight: 750, color: '#1e3a5f' }}>{user?.name ?? 'Tassure user'}</span>
            {user?.email && <span style={{ fontSize: 11, color: '#8492a8' }}>{user.email}</span>}
          </div>
          <button onClick={logout} className="header-logout">Logout</button>
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto', background: '#f1f5f9' }}><div className="p-6">{children}</div></main>
      </div>
      <AssistantWidget />
    </>
  );
}
