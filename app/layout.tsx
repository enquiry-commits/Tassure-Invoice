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

        {/* Navbar — full width, above everything */}
        <header
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8"
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
              height={44}
              width={44}
              className="object-contain rounded"
              priority
            />
            <span
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: '#1e3a5f',
                letterSpacing: '-0.3px',
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
              className="hover:bg-[rgba(30,58,95,0.04)] transition-colors cursor-pointer"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#1e3a5f',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: 'transparent',
              }}
            >
              Logout
            </button>
          </div>
        </header>

        {/* Sidebar starts below navbar */}
        <Sidebar />

        {/* Main content offset: left for sidebar, top for navbar */}
        <main className="ml-52 bg-slate-100" style={{ paddingTop: '70px', minHeight: '100vh' }}>
          <div className="p-6">{children}</div>
        </main>

      </body>
    </html>
  );
}
