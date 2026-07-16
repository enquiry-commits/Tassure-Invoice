import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Tassure Corporate Services System',
  description: 'Tassure Asia billing automation dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
