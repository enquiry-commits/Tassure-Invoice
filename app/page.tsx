'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, UserCheck, MapPin, CalendarClock, AlertTriangle, RefreshCw,
  BarChart3, Users, ArrowRight, ShieldCheck, Layers3, Activity, Clock3,
  BriefcaseBusiness, Sparkles, FileSpreadsheet, Download,
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

function SectionLabel({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div style={{ margin: '30px 0 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontSize: 9.5, fontWeight: 800, color: DASHBOARD_COLORS.teal, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>{eyebrow}</div>
        <h2 style={{ margin: 0, color: DASHBOARD_COLORS.ink, fontSize: 18, fontWeight: 800, letterSpacing: '-.025em' }}>{title}</h2>
      </div>
      <p style={{ margin: 0, color: '#8493a3', fontSize: 11.5, maxWidth: 460, textAlign: 'right', lineHeight: 1.5 }}>{description}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/dashboard').then(r => r.json()).then(setData).finally(() => setLoading(false));
  };
  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, []);

  const exportCompanyData = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch('/api/export/company-data');
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'Tassure-Company-Data.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <button
              onClick={exportCompanyData}
              disabled={exporting}
              title="Download the latest Active Clients and AR Reminder data in one Excel workbook"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 750, color: '#fff', background: exporting ? '#769a95' : DASHBOARD_COLORS.teal, border: '1px solid rgba(21,94,89,.2)', borderRadius: 9, padding: '8px 12px', cursor: exporting ? 'wait' : 'pointer', boxShadow: '0 5px 14px rgba(57,127,120,.14)' }}
            >
              <FileSpreadsheet size={15} />
              {exporting ? 'Preparing Excel…' : 'Export Company Data'}
              <Download size={13} />
            </button>
            {exportError && <span style={{ fontSize: 9.5, color: '#b91c1c' }}>{exportError}</span>}
          </div>
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
          <div className="dashboard-command-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(330px,.65fr)', gap: 22, alignItems: 'stretch' }}>
            <section className="dashboard-hero" style={{ position: 'relative', overflow: 'hidden', minHeight: 290, borderRadius: 20, background: 'linear-gradient(118deg,#17344b 0%,#244f61 68%,#326f6b 100%)', padding: '30px 32px', color: '#fff', boxShadow: '0 18px 44px rgba(24,52,72,.17)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'stretch' }}>
              <div style={{ position: 'absolute', width: 330, height: 330, borderRadius: '50%', right: -80, top: -180, border: '58px solid rgba(255,255,255,.04)' }} />
              <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', right: 100, bottom: -125, border: '28px solid rgba(255,255,255,.035)' }} />
              <div className="dashboard-hero-grid" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, color: '#c8ded5', textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 12 }}><Sparkles size={12} /> Portfolio command centre</div>
                  <div style={{ fontSize: 27, fontWeight: 760, letterSpacing: '-.035em', lineHeight: 1.18, maxWidth: 600 }}>Your operational picture,<br />beautifully focused.</div>
                  <div style={{ fontSize: 12, color: '#c6d8e8', marginTop: 10, maxWidth: 570, lineHeight: 1.6 }}>Prioritise upcoming annual returns, resolve filing risks and understand service coverage before billing begins.</div>
                </div>
                <div className="dashboard-hero-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 28, paddingTop: 22, borderTop: '1px solid rgba(255,255,255,.15)' }}>
                  {[
                    { label: 'Active portfolio', value: data.kpis.activeClients, note: `${data.kpis.cssClients} CSS clients` },
                    { label: 'Next 6 months', value: data.kpis.upcomingAR, note: 'AR obligations' },
                    { label: 'Needs attention', value: data.kpis.lateFiling, note: 'late-filing flags' },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.04em' }}>{item.value}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', marginTop: 3 }}>{item.label}</div>
                      <div style={{ fontSize: 9.5, color: '#a9c1d5', marginTop: 3 }}>{item.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <Card title="Action Centre" eyebrow="Priority queue" icon={<ShieldCheck size={16} />} action={<span style={{ fontSize: 10, color: '#94a3b8' }}>Live counts</span>} style={{ padding: '24px 24px' }}>
              <ActionItem title="Late-filing review" description="Investigate and resolve flagged entities" value={data.kpis.lateFiling} href="/late-filing" color={DASHBOARD_COLORS.rose} background="#fbf1f2" Icon={AlertTriangle} />
              <ActionItem title="AR preparation window" description="Review the next six months of filings" value={data.kpis.upcomingAR} href="/billing?tab=ar" color={DASHBOARD_COLORS.gold} background="#fbf5ec" Icon={Clock3} />
              <ActionItem title="Billing drafts" description="Review services before creating invoices" value="Open" href="/billing?tab=billing" color={DASHBOARD_COLORS.blue} background="#eef3f7" Icon={BriefcaseBusiness} />
            </Card>
          </div>

          <SectionLabel eyebrow="Portfolio pulse" title="Key operating metrics" description="Five live indicators covering clients, managed services and statutory obligations." />
          <div className="dashboard-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(150px,1fr))', gap: 16 }}>
            <Kpi label="Active Clients" value={data.kpis.activeClients} sub={`${data.kpis.cssClients} CSS clients`} Icon={Building2} tint={DASHBOARD_COLORS.teal} href="/master-list/active-clients" />
            <Kpi label="Nominee Appointments" value={data.kpis.activeNDAppts} sub="active mandates" Icon={UserCheck} tint={DASHBOARD_COLORS.plum} href="/nominee-directors" />
            <Kpi label="Address Service" value={data.kpis.addressClients} sub="registered-address clients" Icon={MapPin} tint={DASHBOARD_COLORS.blue} href="/address-service" />
            <Kpi label="Upcoming AR" value={data.kpis.upcomingAR} sub="rolling six-month window" Icon={CalendarClock} tint={DASHBOARD_COLORS.gold} href="/billing?tab=ar" />
            <Kpi label="Late-Filing Watch" value={data.kpis.lateFiling} sub="companies currently flagged" Icon={AlertTriangle} tint={DASHBOARD_COLORS.rose} href="/late-filing" />
          </div>

          <SectionLabel eyebrow="Planning" title="Workload and portfolio health" description="See what is coming next and how the active entity portfolio is distributed." />
          <div className="dashboard-grid-primary" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(360px,.65fr)', gap: 22 }}>
            <Card title="Upcoming Annual Return Workload" eyebrow="Six-month outlook" icon={<CalendarClock size={16} />} action={<TextLink href="/billing?tab=ar">Open AR Reminder</TextLink>}>
              <VBars data={data.upcomingAR} color={DASHBOARD_COLORS.blue} height={190} />
            </Card>
            <Card title="Client Portfolio Status" eyebrow="Entity lifecycle" icon={<Layers3 size={16} />} action={<TextLink href="/companies">View companies</TextLink>}>
              <Donut segments={data.statusDonut.map((segment, index) => ({ ...segment, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.gold, DASHBOARD_COLORS.rose, DASHBOARD_COLORS.muted][index] }))} size={154} thickness={22} />
            </Card>
          </div>

          <SectionLabel eyebrow="Annual rhythm" title="Financial year-end landscape" description="The full portfolio calendar, with enough space to expose seasonal workload peaks." />
          <Card title="Financial Year-End Calendar" eyebrow="Annual distribution" icon={<BarChart3 size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>active clients by FYE month</span>} style={{ padding: '24px 28px' }}>
            <VBars data={data.fyeMonths} color={DASHBOARD_COLORS.teal} height={220} />
          </Card>

          <SectionLabel eyebrow="Coverage" title="Managed service portfolios" description="Compare service adoption with nominee-director appointment concentration." />
          <div className="dashboard-grid-secondary" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px,.7fr) minmax(0,1.3fr)', gap: 22 }}>
            <Card title="Service Coverage" eyebrow="Active-client mix" icon={<BriefcaseBusiness size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>number of clients</span>}>
              <HBars data={data.serviceMix.map((service, index) => ({ ...service, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.plum, DASHBOARD_COLORS.blue, DASHBOARD_COLORS.gold, '#688b8a'][index] }))} accent={DASHBOARD_COLORS.teal} labelWidth={105} />
            </Card>
            <Card title="Nominee Director Portfolio" eyebrow="Active appointment load" icon={<Users size={16} />} action={<TextLink href="/nominee-directors">Open directory</TextLink>}>
              {data.topNDs.length > 0 ? <HBars data={data.topNDs} accent={DASHBOARD_COLORS.plum} labelWidth={170} /> : <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No active nominee appointments.</div>}
            </Card>
          </div>
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
          .dashboard-command-grid { grid-template-columns: minmax(0,1.2fr) minmax(300px,.8fr) !important; }
        }
        @media (max-width: 980px) {
          .dashboard-command-grid, .dashboard-grid-primary, .dashboard-grid-secondary { grid-template-columns: 1fr !important; }
          .dashboard-kpis { grid-template-columns: repeat(2,minmax(150px,1fr)) !important; }
        }
        @media (max-width: 560px) {
          .dashboard-kpis, .dashboard-hero-metrics { grid-template-columns: 1fr !important; }
          .dashboard-hero { padding: 20px !important; }
        }
      `}</style>
    </div>
  );
}
