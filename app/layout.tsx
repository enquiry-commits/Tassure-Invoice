import type { Metadata } from 'next';
import Image from 'next/image';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Tassure Corporate Services System',
  description: 'Tassure Asia billing automation dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Navbar — fixed height at top */}
        <header
          className="flex items-center justify-between px-8 flex-shrink-0 z-50"
          style={{
            height: '70px',
            background: 'linear-gradient(135deg, #ffffff, #f8fafc)',
            borderBottom: '1px solid rgba(30,58,95,0.08)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}
        >
          <div className="flex items-center" style={{ gap: '12px' }}>
            <Image
              src="/logo.png"
              alt="Tassure"
              height={44}
              width={44}
              className="object-contain rounded"
              priority
            />
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#1e3a5f', letterSpacing: '-0.3px' }}>
              Tassure Corporate Services System
            </span>
          </div>

          <div className="flex items-center" style={{ gap: '24px' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>
              Welcome back,{' '}
              <span style={{ fontWeight: 700, color: '#1e3a5f' }}>Vincent</span>
            </span>
            <button
              className="hover:bg-[rgba(30,58,95,0.04)] transition-colors cursor-pointer"
              style={{
                fontSize: '14px', fontWeight: 600, color: '#1e3a5f',
                padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'transparent',
              }}
            >
              Logout
            </button>
          </div>
        </header>

        {/* Below navbar: sidebar + main in a flex row, each scrolls independently */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar />
          <main style={{ flex: 1, overflowY: 'auto', background: '#f1f5f9' }}>
            <div className="p-6">{children}</div>
          </main>
        </div>

      </body>
    </html>
  );
}
