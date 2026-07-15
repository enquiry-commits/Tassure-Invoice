'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, UserCheck, MapPin, CalendarClock, AlertTriangle, RefreshCw,
  BarChart3, Users, ArrowRight, ShieldCheck, Layers3, Activity, Clock3,
  BriefcaseBusiness, Sparkles,
} from 'lucide-react';
import QBConnectButton from '@/components/QBConnectButton';
import { Donut, VBars, HBars } from '@/components/dashboard/Charts';

type Pt = { label: string; value: number; color?: string };
interface Data {
  kpis: { activeClients: number; cssClients: number; activeNDAppts: number; addressClients: number; upcomingAR: number; lateFiling: number };
  statusDonut: Pt[];
  fyeMonths: Pt[];
  serviceMix: Pt[];
  upcomingAR: Pt[];
  topNDs: Pt[];
}

const DASHBOARD_COLORS = {
  ink: '#102a43',
  navy: '#234e70',
  teal: '#397f78',
  blue: '#557795',
  gold: '#b98243',
  plum: '#746487',
  rose: '#b45f6b',
  muted: '#a8b5c2',
};

function Card({ title, eyebrow, icon, children, action, style }: {
  title: string; eyebrow?: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{ background: 'rgba(255,255,255,.96)', borderRadius: 16, border: '1px solid #dfe7ec', boxShadow: '0 10px 32px rgba(28,52,73,.045)', padding: '20px 22px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#edf4f3', color: DASHBOARD_COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        <div>
          {eyebrow && <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 2 }}>{eyebrow}</div>}
          <h2 style={{ fontSize: 14, fontWeight: 750, color: DASHBOARD_COLORS.ink, margin: 0, letterSpacing: '-.01em' }}>{title}</h2>
        </div>
        <span style={{ marginLeft: 'auto' }}>{action}</span>
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, Icon, tint, href }: {
  label: string; value: number | string; sub: string; Icon: typeof Building2; tint: string; href: string;
}) {
  return (
    <Link href={href} className="dashboard-kpi" style={{ display: 'block', background: 'rgba(255,255,255,.96)', borderRadius: 14, border: '1px solid #dfe7ec', boxShadow: '0 6px 22px rgba(28,52,73,.035)', padding: '16px 17px', textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: `${tint}12`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} /></span>
        <ArrowRight size={13} style={{ color: '#cbd5e1' }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: DASHBOARD_COLORS.ink, lineHeight: 1, letterSpacing: '-.035em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#475569', fontWeight: 700, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
    </Link>
  );
}

function ActionItem({ title, description, value, href, color, background, Icon }: {
  title: string; description: string; value: number | string; href: string; color: string; background: string; Icon: typeof AlertTriangle;
}) {
  return (
    <Link href={href} className="dashboard-action" style={{ display: 'grid', gridTemplateColumns: '38px 1fr auto', alignItems: 'center', gap: 12, padding: '13px 0', textDecoration: 'none', borderBottom: '1px solid #eef2f6' }}>
      <span style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color, background }}><Icon size={17} /></span>
      <span>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750, color: DASHBOARD_COLORS.ink }}>{title}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{description}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 19, color, letterSpacing: '-.02em' }}>{value}</strong>
        <ArrowRight size={13} style={{ color: '#cbd5e1' }} />
      </span>
    </Link>
  );
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} style={{ fontSize: 11.5, color: DASHBOARD_COLORS.teal, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>{children}<ArrowRight size={12} /></Link>;
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/dashboard').then(r => r.json()).then(setData).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: 1760, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Activity size={12} style={{ color: DASHBOARD_COLORS.teal }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: DASHBOARD_COLORS.teal, textTransform: 'uppercase', letterSpacing: '.9px' }}>Live operations</span>
          </div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: DASHBOARD_COLORS.ink, margin: 0, letterSpacing: '-.03em' }}>Portfolio Overview</h1>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0' }}>Corporate-services performance, obligations and operational priorities.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650, color: '#475569', background: '#fff', border: '1px solid #dfe6ee', borderRadius: 9, padding: '7px 11px', cursor: 'pointer' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
          <QBConnectButton />
        </div>
      </header>

      {!data ? (
        <div style={{ textAlign: 'center', padding: 90, color: '#94a3b8', fontSize: 13 }}>Loading portfolio intelligence…</div>
      ) : (
        <>
          <section className="dashboard-hero" style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, background: 'linear-gradient(118deg,#17344b 0%,#244f61 68%,#326f6b 100%)', padding: '22px 26px', marginBottom: 15, color: '#fff', boxShadow: '0 16px 38px rgba(24,52,72,.16)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ position: 'absolute', width: 250, height: 250, borderRadius: '50%', right: -65, top: -135, border: '45px solid rgba(255,255,255,.045)' }} />
            <div className="dashboard-hero-grid" style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.35fr repeat(3,.55fr)', alignItems: 'center', gap: 18 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, color: '#c8ded5', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 8 }}><Sparkles size={12} /> Portfolio command centre</div>
                <div style={{ fontSize: 19, fontWeight: 750, letterSpacing: '-.02em', lineHeight: 1.25 }}>Your operational picture, in one place.</div>
                <div style={{ fontSize: 11.5, color: '#c6d8e8', marginTop: 6, maxWidth: 520 }}>Prioritise upcoming annual returns, resolve late-filing risks and monitor service coverage before billing.</div>
              </div>
              {[
                { label: 'Active portfolio', value: data.kpis.activeClients, note: `${data.kpis.cssClients} CSS clients` },
                { label: 'Next 6 months', value: data.kpis.upcomingAR, note: 'AR obligations' },
                { label: 'Needs attention', value: data.kpis.lateFiling, note: 'late-filing flags' },
              ].map(item => (
                <div key={item.label} style={{ paddingLeft: 18, borderLeft: '1px solid rgba(255,255,255,.16)' }}>
                  <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.03em' }}>{item.value}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', marginTop: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 9.5, color: '#a9c1d5', marginTop: 2 }}>{item.note}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="dashboard-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(150px,1fr))', gap: 12, marginBottom: 15 }}>
            <Kpi label="Active Clients" value={data.kpis.activeClients} sub={`${data.kpis.cssClients} CSS clients`} Icon={Building2} tint={DASHBOARD_COLORS.teal} href="/master-list/active-clients" />
            <Kpi label="Nominee Appointments" value={data.kpis.activeNDAppts} sub="active mandates" Icon={UserCheck} tint={DASHBOARD_COLORS.plum} href="/nominee-directors" />
            <Kpi label="Address Service" value={data.kpis.addressClients} sub="registered-address clients" Icon={MapPin} tint={DASHBOARD_COLORS.blue} href="/address-service" />
            <Kpi label="Upcoming AR" value={data.kpis.upcomingAR} sub="rolling six-month window" Icon={CalendarClock} tint={DASHBOARD_COLORS.gold} href="/billing?tab=ar" />
            <Kpi label="Late-Filing Watch" value={data.kpis.lateFiling} sub="companies currently flagged" Icon={AlertTriangle} tint={DASHBOARD_COLORS.rose} href="/late-filing" />
          </div>

          <div className="dashboard-grid-primary" style={{ display: 'grid', gridTemplateColumns: '1.45fr .75fr', gap: 15, marginBottom: 15 }}>
            <Card title="Upcoming Annual Return Workload" eyebrow="Six-month outlook" icon={<CalendarClock size={16} />} action={<TextLink href="/billing?tab=ar">Open AR Reminder</TextLink>}>
              <VBars data={data.upcomingAR} color={DASHBOARD_COLORS.blue} height={156} />
            </Card>
            <Card title="Action Centre" eyebrow="Priority queue" icon={<ShieldCheck size={16} />} action={<span style={{ fontSize: 10, color: '#94a3b8' }}>Live counts</span>}>
              <ActionItem title="Late-filing review" description="Investigate and resolve flagged entities" value={data.kpis.lateFiling} href="/late-filing" color={DASHBOARD_COLORS.rose} background="#fbf1f2" Icon={AlertTriangle} />
              <ActionItem title="AR preparation window" description="Review the next six months of filings" value={data.kpis.upcomingAR} href="/billing?tab=ar" color={DASHBOARD_COLORS.gold} background="#fbf5ec" Icon={Clock3} />
              <ActionItem title="Billing drafts" description="Review services before creating invoices" value="Open" href="/billing?tab=billing" color={DASHBOARD_COLORS.blue} background="#eef3f7" Icon={BriefcaseBusiness} />
            </Card>
          </div>

          <div className="dashboard-grid-secondary" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
            <Card title="Client Portfolio Status" eyebrow="Entity lifecycle" icon={<Layers3 size={16} />} action={<TextLink href="/companies">View companies</TextLink>}>
              <Donut segments={data.statusDonut.map((segment, index) => ({ ...segment, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.gold, DASHBOARD_COLORS.rose, DASHBOARD_COLORS.muted][index] }))} size={154} thickness={22} />
            </Card>
            <Card title="Service Coverage" eyebrow="Active-client mix" icon={<BriefcaseBusiness size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>number of clients</span>}>
              <HBars data={data.serviceMix.map((service, index) => ({ ...service, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.plum, DASHBOARD_COLORS.blue, DASHBOARD_COLORS.gold, '#688b8a'][index] }))} accent={DASHBOARD_COLORS.teal} labelWidth={105} />
            </Card>
          </div>

          <div style={{ marginBottom: 15 }}>
            <Card title="Financial Year-End Calendar" eyebrow="Annual distribution" icon={<BarChart3 size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>active clients by FYE month</span>}>
              <VBars data={data.fyeMonths} color={DASHBOARD_COLORS.teal} height={165} />
            </Card>
          </div>

          <Card title="Nominee Director Portfolio" eyebrow="Active appointment load" icon={<Users size={16} />} action={<TextLink href="/nominee-directors">Open directory</TextLink>}>
            {data.topNDs.length > 0 ? <HBars data={data.topNDs} accent={DASHBOARD_COLORS.plum} labelWidth={170} /> : <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No active nominee appointments.</div>}
          </Card>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .dashboard-kpi, .dashboard-action { transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
        .dashboard-kpi:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(16,37,66,.09) !important; }
        .dashboard-action:last-child { border-bottom: 0 !important; }
        .dashboard-action:hover { background: #fbfdff; }
        @media (max-width: 1180px) {
          .dashboard-kpis { grid-template-columns: repeat(3,minmax(160px,1fr)) !important; }
          .dashboard-hero-grid { grid-template-columns: 1fr repeat(3,.45fr) !important; }
        }
        @media (max-width: 860px) {
          .dashboard-grid-primary, .dashboard-grid-secondary { grid-template-columns: 1fr !important; }
          .dashboard-kpis { grid-template-columns: repeat(2,minmax(150px,1fr)) !important; }
          .dashboard-hero-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 560px) {
          .dashboard-kpis, .dashboard-hero-grid { grid-template-columns: 1fr !important; }
          .dashboard-hero { padding: 20px !important; }
          .dashboard-hero-grid > div { border-left: 0 !important; padding-left: 0 !important; }
        }
      `}</style>
    </div>
  );
}
