import type { Metadata } from 'next';
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
          {/* Top header bar */}
          <header
            className="sticky top-0 z-30 flex items-center justify-between px-6 py-3 shadow-sm"
            style={{ backgroundColor: '#1d3a5c' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-white/60 text-sm">☰</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-white/70 text-sm">🔔</span>
              <span className="text-white/70 text-sm">🎧</span>
              <span className="text-white/70 text-sm">🖨</span>
              <div
                className="text-white text-sm px-3 py-1 rounded font-medium"
                style={{ backgroundColor: '#2563eb' }}
              >
                VS Vincent▾
              </div>
            </div>
          </header>

          <div className="p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
