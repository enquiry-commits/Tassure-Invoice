import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const SOURCES = [
  'teamwork_nd',
  'teamwork_companies',
  'ar_generate',
  'quickbooks',
  'ar_workflow',
  'late_filing',
] as const;

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();
  const [{ data: runs, error }, { data: companies }, parseExceptions, pendingReservations, integrationExceptions] = await Promise.all([
    supabase.from('automation_sync_runs')
      .select('id, source, status, started_at, finished_at, summary, error')
      .in('source', [...SOURCES])
      .order('started_at', { ascending: false })
      .limit(120),
    supabase.from('companies').select('pic, sec_pic'),
    supabase.from('quickbooks_invoice_items')
      .select('*', { count: 'exact', head: true })
      .in('period_parse_status', ['missing_period', 'missing_fye']),
    supabase.from('invoice_creation_reservations')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'uncertain']),
    supabase.from('automation_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open'),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const now = Date.now();
  const jobs = SOURCES.map(source => {
    const sourceRuns = (runs ?? []).filter(run => run.source === source);
    const latest = sourceRuns[0] ?? null;
    const lastSuccess = sourceRuns.find(run => run.status === 'success') ?? null;
    const successAgeHours = lastSuccess
      ? Math.round(((now - new Date(lastSuccess.finished_at ?? lastSuccess.started_at).getTime()) / 3_600_000) * 10) / 10
      : null;
    const stale = successAgeHours == null || successAgeHours > 30;
    const unhealthy = latest?.status === 'failed' || stale;
    return {
      source,
      status: unhealthy ? 'attention' : latest?.status ?? 'never',
      latestStatus: latest?.status ?? 'never',
      lastStartedAt: latest?.started_at ?? null,
      lastSuccessAt: lastSuccess?.finished_at ?? null,
      successAgeHours,
      error: latest?.status === 'failed' ? latest.error : null,
      summary: latest?.summary ?? {},
    };
  });

  const numericPics = (companies ?? []).filter(company => /^\d+$/.test(String(company.sec_pic ?? company.pic ?? '').trim())).length;
  const anomalies = {
    numericPics,
    qbPeriodParseExceptions: parseExceptions.count ?? 0,
    invoiceRequestsNeedingReconciliation: pendingReservations.count ?? 0,
    openIntegrationExceptions: integrationExceptions.count ?? 0,
  };
  const attentionCount = jobs.filter(job => job.status === 'attention').length
    + numericPics
    + (pendingReservations.count ?? 0)
    + (integrationExceptions.count ?? 0);

  return NextResponse.json({
    ok: attentionCount === 0,
    checkedAt: new Date().toISOString(),
    attentionCount,
    jobs,
    anomalies,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
