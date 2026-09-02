'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Users, UserPlus, UserMinus, TrendingUp, PieChart, Wallet, Compass,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { Donut, VBars, HBars } from '@/components/dashboard/Charts';

// Reports — customer-profile analytics for leadership, gated on
// ApprovedAccount.canViewReports (lib/approved-accounts.ts). Guard pattern
// copied from app/admin/appearance/page.tsx — the one other page in this
// app scoped to a named handful of accounts: a client-side redirect (no
// proxy.ts change, no precedent for that here either) backed by a real
// server-side 403 on the API route itself (app/api/reports/route.ts), so
// this is a real permission boundary, not just hidden UI.
type Pt = { label: string; value: number; color?: string };
interface ReportsData {
  generatedAt: string;
  kpis: { activeClients: number; newThisYear: number; churnedThisYear: number; netGrowthThisYear: number };
  clientTypeDonut: Pt[];
  serviceMix: Pt[];
  sourceDonut: Pt[];
  flow: { years: string[]; newClientsTrend: Pt[]; churnedTrend: Pt[] };
  revenue: { years: string[]; invoiceCountTrend: Pt[]; revenueTrendThousands: Pt[] };
  picWorkload: Pt[];
  notes: { clientType: string; flow: string; source: string };
}

const COLORS = { ink: '#102a43', teal: '#397f78', blue: '#557795', gold: '#b98243', plum: '#746487', rose: '#b45f6b' };

function Card({ title, eyebrow, icon, children, note }: {
  title: string; eyebrow: string; icon: React.ReactNode; children: React.ReactNode; note?: string;
}) {
  return (
    <section style={{ background: 'rgba(255,255,255,.96)', borderRadius: 16, border: '1px solid #dfe7ec', boxShadow: '0 10px 32px rgba(28,52,73,.045)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 2 }}>{eyebrow}</div>
          <h2 style={{ fontSize: 14, fontWeight: 750, color: COLORS.ink, margin: 0, letterSpacing: '-.01em' }}>{title}</h2>
        </div>
      </div>
      {children}
      {note && <p style={{ margin: '14px 0 0', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>{note}</p>}
    </section>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(result => {
      if (!result?.user?.canViewReports) { router.replace('/'); return; }
      setAuthorized(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch('/api/reports').then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed to load Reports');
      setData(body);
    }).catch(e => setError(e.message));
  }, [authorized]);

  if (authorized === null) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#b45f6b', fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart3 size={18} />
        </span>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.ink, letterSpacing: '-.02em' }}>Reports</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8493a3' }}>Customer profile analytics — generated {data.generatedAt}. Visible to a small, named group only.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
        <MetricCard value={data.kpis.activeClients} label="Active Clients" icon={<Users size={16} />} color={COLORS.teal} />
        <MetricCard value={data.kpis.newThisYear} label="New This Year" icon={<UserPlus size={16} />} color={COLORS.blue} />
        <MetricCard value={data.kpis.churnedThisYear} label="Churned This Year" icon={<UserMinus size={16} />} color={COLORS.rose} />
        <MetricCard
          value={data.kpis.netGrowthThisYear > 0 ? `+${data.kpis.netGrowthThisYear}` : data.kpis.netGrowthThisYear}
          label="Net Growth This Year"
          icon={<TrendingUp size={16} />}
          color={data.kpis.netGrowthThisYear >= 0 ? COLORS.teal : COLORS.rose}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="Client Type" eyebrow="Composition" icon={<PieChart size={16} />} note={data.notes.clientType}>
          <Donut segments={data.clientTypeDonut} size={150} thickness={22} />
        </Card>
        <Card title="Customer Source" eyebrow="Composition" icon={<Compass size={16} />} note={data.notes.source}>
          <Donut segments={data.sourceDonut} size={150} thickness={22} />
        </Card>
      </div>

      <Card title="Service Mix" eyebrow="Active Clients" icon={<BarChart3 size={16} />}>
        <HBars data={data.serviceMix} accent={COLORS.teal} labelWidth={110} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="New Clients by Year" eyebrow="Flow" icon={<UserPlus size={16} />} note={data.notes.flow}>
          <VBars data={data.flow.newClientsTrend} color={COLORS.teal} height={170} />
        </Card>
        <Card title="Churned by Year" eyebrow="Flow" icon={<UserMinus size={16} />} note={data.notes.flow}>
          <VBars data={data.flow.churnedTrend} color={COLORS.rose} height={170} />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="Invoice Volume by Year" eyebrow="Billing" icon={<Wallet size={16} />}>
          <VBars data={data.revenue.invoiceCountTrend} color={COLORS.blue} height={170} />
        </Card>
        <Card title="Revenue by Year (S$'000)" eyebrow="Billing" icon={<Wallet size={16} />}>
          <VBars data={data.revenue.revenueTrendThousands} color={COLORS.gold} height={170} />
        </Card>
      </div>

      <Card title="Staff Workload" eyebrow="Open AR / AGM Cycles" icon={<Users size={16} />} note="Counts every open (not yet filed) cycle a person is SEC, ACC, or TAX PIC on — the same fields My Tasks reads.">
        {data.picWorkload.length
          ? <HBars data={data.picWorkload} accent={COLORS.plum} labelWidth={140} />
          : <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No open cycles.</div>}
      </Card>

      <Card title="Potential Customer Direction" eyebrow="Coming later" icon={<Compass size={16} />}>
        <div style={{ padding: '4px 0', color: '#64748b', fontSize: 12.5, lineHeight: 1.6 }}>
          No prospect/lead data exists anywhere in this system yet, so there is nothing real to show here.
          Once SSIC industry data is captured (phase 2) and Customer Source has enough real tags, this
          section can show which industries and channels are under-represented in the current client
          base — a real, data-grounded growth signal instead of a guess.
        </div>
      </Card>
    </div>
  );
}
