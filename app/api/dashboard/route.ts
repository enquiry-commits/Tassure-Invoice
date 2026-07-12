import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

type Row = Record<string, unknown>;
async function pageAll(makeQuery: () => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  for (;;) {
    const { data } = await (makeQuery() as unknown as { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null }> }).range(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

export async function GET() {
  const sb = createAdminClient();

  const [companies, arRows, ndAppts, nds, lfRows] = await Promise.all([
    pageAll(() => sb.from('companies').select('fye_month, tw_status, client_type, is_active, uses_address, has_nd, has_xbrl, has_accounts, has_tax')) as Promise<Array<{ fye_month: string | null; tw_status: string | null; client_type: string | null; is_active: boolean | null; uses_address: boolean | null; has_nd: boolean | null; has_xbrl: boolean | null; has_accounts: boolean | null; has_tax: boolean | null }>>,
    pageAll(() => sb.from('ar_reminder').select('fye_month, fye_year, status').or('status.is.null,status.neq.Excluded')) as Promise<Array<{ fye_month: string | null; fye_year: number | null; status: string | null }>>,
    pageAll(() => sb.from('nd_appointments').select('nd_id, cessation_date, appointment_date, sub_role')) as Promise<Array<{ nd_id: number; cessation_date: string | null; appointment_date: string | null; sub_role: string | null }>>,
    pageAll(() => sb.from('nominee_directors').select('id, name')) as Promise<Array<{ id: number; name: string }>>,
    sb.from('late_filing_companies').select('*', { count: 'exact', head: true }),
  ]);

  const active = companies.filter(c => c.is_active);

  // ── Client status (all companies) ────────────────────────────────────────
  const statusCount: Record<string, number> = {};
  for (const c of companies) {
    const s = c.tw_status && ['Active', 'Striking Off', 'Terminated'].includes(c.tw_status) ? c.tw_status : 'Untracked';
    statusCount[s] = (statusCount[s] ?? 0) + 1;
  }

  // ── FYE month distribution (active, Jan → Dec) ───────────────────────────
  const fyeMonths = MONTHS.map((m, i) => ({
    label: SHORT[i],
    value: active.filter(c => c.fye_month === m).length,
  }));

  // ── Service mix (active) ─────────────────────────────────────────────────
  const serviceMix = [
    { label: 'Reg. Address', value: active.filter(c => c.uses_address).length, color: '#0f766e' },
    { label: 'Nominee Dir.', value: active.filter(c => c.has_nd).length,        color: '#7c3aed' },
    { label: 'XBRL',         value: active.filter(c => c.has_xbrl).length,      color: '#c026d3' },
    { label: 'Tax',          value: active.filter(c => c.has_tax).length,       color: '#0891b2' },
    { label: 'Accounts',     value: active.filter(c => c.has_accounts).length,  color: '#2563eb' },
  ].sort((a, b) => b.value - a.value);

  // ── Upcoming AR filings — rolling 6 months from this month ───────────────
  const now = new Date();
  const upcomingAR = Array.from({ length: 6 }, (_, i) => {
    const idx = (now.getMonth() + i) % 12;
    const year = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    const value = arRows.filter(r => r.fye_month === MONTHS[idx] && r.fye_year === year).length;
    return { label: `${SHORT[idx]} ${String(year).slice(2)}`, value };
  });

  // ── Top nominee directors by active appointments ─────────────────────────
  const nameById = new Map(nds.map(n => [n.id, n.name]));
  const activeByNd: Record<number, number> = {};
  let activeNDAppts = 0;
  for (const a of ndAppts) {
    if (a.sub_role === 'Nominee Director' && a.appointment_date && !a.cessation_date) {
      activeByNd[a.nd_id] = (activeByNd[a.nd_id] ?? 0) + 1;
      activeNDAppts++;
    }
  }
  const topNDs = Object.entries(activeByNd)
    .map(([id, value]) => ({ label: nameById.get(Number(id)) ?? `ND ${id}`, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const upcomingTotal = upcomingAR.reduce((s, m) => s + m.value, 0);

  return NextResponse.json({
    kpis: {
      activeClients: active.length,
      cssClients: active.filter(c => c.client_type === 'CSS Client').length,
      activeNDAppts,
      addressClients: active.filter(c => c.uses_address).length,
      upcomingAR: upcomingTotal,
      lateFiling: lfRows.count ?? 0,
    },
    statusDonut: [
      { label: 'Active',       value: statusCount['Active'] ?? 0,        color: '#16a34a' },
      { label: 'Striking Off', value: statusCount['Striking Off'] ?? 0,  color: '#f59e0b' },
      { label: 'Terminated',   value: statusCount['Terminated'] ?? 0,    color: '#dc2626' },
      { label: 'Untracked',    value: statusCount['Untracked'] ?? 0,     color: '#cbd5e1' },
    ].filter(s => s.value > 0),
    fyeMonths,
    serviceMix,
    upcomingAR,
    topNDs,
  });
}
