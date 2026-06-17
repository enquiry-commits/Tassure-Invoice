import type { Metadata } from 'next';
import Image from 'next/image';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Tassure Billing System',
  description: 'Tassure Asia billing automation dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <Sidebar />
        <main className="ml-52 min-h-screen bg-slate-100">

          {/* Navbar */}
          <header
            className="sticky top-0 z-30 flex items-center justify-between px-8"
            style={{
              height: '70px',
              background: 'linear-gradient(135deg, #ffffff, #f8fafc)',
              borderBottom: '1px solid rgba(30,58,95,0.08)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            }}
          >
            {/* Left: Logo + Brand name */}
            <div className="flex items-center" style={{ gap: '12px' }}>
              <Image
                src="/logo.png"
                alt="Tassure"
                height={45}
                width={120}
                className="object-contain object-left"
                priority
              />
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  color: '#1e3a5f',
                }}
              >
                Billing System
              </span>
            </div>

            {/* Right: Welcome + Logout */}
            <div className="flex items-center" style={{ gap: '24px' }}>
              <span style={{ fontSize: '14px', color: '#64748b' }}>
                Welcome back,{' '}
                <span style={{ fontWeight: 700, color: '#1e3a5f' }}>Vincent</span>
              </span>
              <button
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#1e3a5f',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(30,58,95,0.04)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                Logout
              </button>
            </div>
          </header>

          <div className="p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
