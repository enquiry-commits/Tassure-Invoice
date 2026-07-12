'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, UserCheck, MapPin, CalendarClock, AlertTriangle, RefreshCw,
  BarChart3, PieChart, TrendingUp, Users, ArrowRight,
} from 'lucide-react';
import QBConnectButton from '@/components/QBConnectButton';
import { VBars, Donut, HBars } from '@/components/dashboard/Charts';

type Pt = { label: string; value: number; color?: string };
interface Data {
  kpis: { activeClients: number; cssClients: number; activeNDAppts: number; addressClients: number; upcomingAR: number; lateFiling: number };
  statusDonut: Pt[];
  fyeMonths: Pt[];
  serviceMix: Pt[];
  upcomingAR: Pt[];
  topNDs: Pt[];
}

function Card({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8ecf1', boxShadow: '0 1px 3px rgba(16,37,66,.04), 0 8px 24px rgba(16,37,66,.04)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ color: '#0f766e', display: 'flex' }}>{icon}</span>
        <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#1e3a5f', margin: 0, letterSpacing: '-.01em' }}>{title}</h3>
        <span style={{ marginLeft: 'auto' }}>{action}</span>
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, Icon, tint, href }: { label: string; value: number | string; sub?: string; Icon: typeof Building2; tint: string; href: string }) {
  return (
    <Link href={href} style={{
      display: 'block', background: '#fff', borderRadius: 14, border: '1px solid #e8ecf1',
      boxShadow: '0 1px 3px rgba(16,37,66,.04)', padding: '16px 18px', textDecoration: 'none', transition: 'box-shadow .15s, transform .15s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(16,37,66,.10)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(16,37,66,.04)'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: `${tint}15`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={18} /></span>
        <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#12233b', lineHeight: 1, letterSpacing: '-.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>{sub}</div>}
    </Link>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/dashboard').then(r => r.json()).then(d => setData(d)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#12233b', margin: 0, letterSpacing: '-.02em' }}>Overview</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Live snapshot of your corporate-services portfolio</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={load} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#475569', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
          <QBConnectButton />
        </div>
      </div>

      {!data ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8', fontSize: 14 }}>Loading analytics…</div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label="Active Clients"       value={data.kpis.activeClients} sub={`${data.kpis.cssClients} CSS clients`} Icon={Building2}    tint="#0f766e" href="/companies" />
            <Kpi label="Nominee Appointments" value={data.kpis.activeNDAppts} sub="active mandates"                    Icon={UserCheck}    tint="#7c3aed" href="/nominee-directors" />
            <Kpi label="Address Service"      value={data.kpis.addressClients} sub="clients on our address"           Icon={MapPin}       tint="#2563eb" href="/address-service" />
            <Kpi label="Upcoming AR (6 mo)"   value={data.kpis.upcomingAR}   sub="filings due this window"           Icon={CalendarClock} tint="#d97706" href="/billing?tab=ar" />
            <Kpi label="Late-Filing Watch"    value={data.kpis.lateFiling}   sub="companies flagged"                 Icon={AlertTriangle} tint="#e11d48" href="/late-filing" />
          </div>

          {/* FYE calendar — full width */}
          <div style={{ marginBottom: 16 }}>
            <Card title="Financial Year-End Calendar" icon={<BarChart3 size={16} />}
              action={<span style={{ fontSize: 11, color: '#94a3b8' }}>active clients by FYE month</span>}>
              <VBars data={data.fyeMonths} color="#0f766e" height={180} />
            </Card>
          </div>

          {/* Two-column rows */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <Card title="Upcoming AR Filings" icon={<CalendarClock size={16} />}
              action={<Link href="/billing?tab=ar" style={{ fontSize: 11.5, color: '#0f766e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>Open AR Reminder <ArrowRight size={12} /></Link>}>
              <VBars data={data.upcomingAR} color="#d97706" height={170} />
            </Card>

            <Card title="Client Status" icon={<PieChart size={16} />}>
              <Donut segments={data.statusDonut} />
            </Card>

            <Card title="Service Mix" icon={<TrendingUp size={16} />}
              action={<span style={{ fontSize: 11, color: '#94a3b8' }}>active clients</span>}>
              <HBars data={data.serviceMix} labelWidth={110} />
            </Card>

            <Card title="Top Nominee Directors" icon={<Users size={16} />}
              action={<Link href="/nominee-directors" style={{ fontSize: 11.5, color: '#0f766e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>Directory <ArrowRight size={12} /></Link>}>
              <HBars data={data.topNDs} accent="#7c3aed" labelWidth={150} />
            </Card>
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
