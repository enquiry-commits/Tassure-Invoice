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
  const [
    { data: runs, error },
    { data: companies, error: companiesError },
    parseExceptions,
    pendingReservations,
    { data: openExceptions, error: exceptionsError },
  ] = await Promise.all([
    supabase.from('automation_sync_runs')
      .select('id, source, status, started_at, finished_at, summary, error')
      .in('source', [...SOURCES])
      .order('started_at', { ascending: false })
      .limit(120),
    supabase.from('companies')
      .select('internal_id, company_name, registration_no, company_type, tw_status, is_active, best_email, pic, sec_pic'),
    supabase.from('quickbooks_invoice_items')
      .select('*', { count: 'exact', head: true })
      .in('period_parse_status', ['missing_period', 'missing_fye']),
    supabase.from('invoice_creation_reservations')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'uncertain']),
    supabase.from('automation_exceptions')
      .select('id, source, exception_type, entity_key, entity_name, details, first_seen_at, last_seen_at')
      .eq('status', 'open')
      .order('source')
      .order('exception_type')
      .order('entity_name'),
  ]);

  if (error || companiesError || exceptionsError) {
    return NextResponse.json({ error: (error ?? companiesError ?? exceptionsError)?.message }, { status: 503 });
  }

  type ExceptionDetails = Record<string, unknown>;
  const quickBooksInvoiceIds = [...new Set((openExceptions ?? []).flatMap(exception => {
    const details = (exception.details ?? {}) as ExceptionDetails;
    return Array.isArray(details.qb_invoice_ids)
      ? details.qb_invoice_ids.map(id => String(id)).filter(Boolean)
      : [];
  }))];
  const { data: exceptionInvoices, error: exceptionInvoicesError } = quickBooksInvoiceIds.length
    ? await supabase.from('quickbooks_invoices')
      .select('qb_company, qb_invoice_id, invoice_no, customer_name, txn_date, total_amt, balance, status')
      .in('qb_invoice_id', quickBooksInvoiceIds)
      .order('invoice_no')
      .order('qb_invoice_id')
    : { data: [], error: null };

  if (exceptionInvoicesError) {
    return NextResponse.json({ error: exceptionInvoicesError.message }, { status: 503 });
  }

  const companyByInternalId = new Map((companies ?? [])
    .filter(company => company.internal_id)
    .map(company => [String(company.internal_id), company]));
  const invoicesById = new Map((exceptionInvoices ?? []).map(invoice => [String(invoice.qb_invoice_id), invoice]));

  const exceptionItems = (openExceptions ?? []).map(exception => {
    const details = (exception.details ?? {}) as ExceptionDetails;
    const invoiceIds = Array.isArray(details.qb_invoice_ids)
      ? details.qb_invoice_ids.map(id => String(id)).filter(Boolean)
      : [];
    const company = companyByInternalId.get(String(exception.entity_key));
    return {
      id: exception.id,
      source: exception.source,
      type: exception.exception_type,
      key: exception.entity_key,
      name: exception.entity_name,
      details,
      firstSeenAt: exception.first_seen_at,
      lastSeenAt: exception.last_seen_at,
      company: company ? {
        internalId: company.internal_id,
        name: company.company_name,
        uen: company.registration_no,
        companyType: company.company_type,
        teamworkStatus: company.tw_status,
        active: company.is_active,
        email: company.best_email,
      } : null,
      invoices: invoiceIds.flatMap(id => {
        const invoice = invoicesById.get(id);
        return invoice ? [invoice] : [];
      }),
    };
  });

  const exceptionGroupMap = new Map<string, {
    source: string;
    type: string;
    items: Array<(typeof exceptionItems)[number]>;
  }>();
  for (const item of exceptionItems) {
    const groupKey = `${item.source}:${item.type}`;
    const group = exceptionGroupMap.get(groupKey) ?? {
      source: item.source,
      type: item.type,
      items: [] as Array<(typeof exceptionItems)[number]>,
    };
    group.items.push(item);
    exceptionGroupMap.set(groupKey, group);
  }
  const exceptionGroups = [...exceptionGroupMap.values()]
    .map(group => ({ ...group, count: group.items.length }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));

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
    openIntegrationExceptions: exceptionItems.length,
  };
  const attentionCount = jobs.filter(job => job.status === 'attention').length
    + numericPics
    + (pendingReservations.count ?? 0)
    + exceptionItems.length;

  return NextResponse.json({
    ok: attentionCount === 0,
    checkedAt: new Date().toISOString(),
    attentionCount,
    jobs,
    anomalies,
    exceptionGroups,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
