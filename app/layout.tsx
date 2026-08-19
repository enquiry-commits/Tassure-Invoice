import type { Metadata } from 'next';
import { Inter, Lato, Poppins, Source_Sans_3, Work_Sans } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';

// Self-hosted by next/font/google (no runtime request to Google) — every
// option in lib/theme-tokens.ts's FONT_OPTIONS is preloaded here as its own
// CSS var so Appearance Settings can switch between them at runtime by just
// changing which var --font-family points at (lib/apply-theme.ts).
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' });
const lato = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-lato' });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-poppins' });
const sourceSans = Source_Sans_3({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-source-sans' });
const workSans = Work_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-work-sans' });

export const metadata: Metadata = {
  title: 'Tassure Corporate Services System',
  description: 'Tassure Asia billing automation dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lato.variable} ${poppins.variable} ${sourceSans.variable} ${workSans.variable}`}>
      <body style={{ margin: 0, overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
