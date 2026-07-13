import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';
import { pageAll } from '@/lib/page-all';

const EDITABLE_FIELDS = new Set([
  'reminder_note', 'prepared_date', 'date_of_agm', 'agm_held_date',
  'sent_date', 'received_date', 'filling_date',
  'ar_status', 'xbrl', 'software_update', 'dpo', 'ond_ron',
  'pic', 'acc_pic', 'tax_pic', 'remarks',
  // table columns from create-ar-reminder-table.sql
  'accounts_status', 'fin_stmt_status', 'audited_fs', 'agm_documents', 'dormant',
]);

function normalize(name: string) {
  return name.toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function matchScore(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  return Math.round((common / Math.max(wa.size, wb.size)) * 70);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') ?? 'April';
  const year  = parseInt(searchParams.get('year') ?? '2026');

  const supabase = createAdminClient();

  // ── Parallel fetch: all queries at once ──────────────────────────────────
  const [
    { data: arRows, error },
    { data: companies },
    { data: activeNDs },
    { data: qbInvoices },
    qbItems,
  ] = await Promise.all([
    // Hide soft-deleted rows (status 'Excluded') from every list/consumer.
    supabase.from('ar_reminder').select('*').eq('fye_month', month).eq('fye_year', year).or('status.is.null,status.neq.Excluded').order('entity_name'),
    supabase.from('companies').select('id, company_name, has_xbrl, has_nd, has_accounts, has_tax, uses_address, has_annual_return, has_agm'),
    supabase.from('nd_appointments').select('company_name, appointment_date, nd_id').eq('sub_role', 'Nominee Director').not('appointment_date', 'is', null).is('cessation_date', null),
    supabase.from('quickbooks_invoices').select('invoice_no, txn_date, customer_name, total_amt, balance, status').gte('txn_date', `${year}-01-01`).lte('txn_date', `${year}-12-31`),
    // invoice_no+line_num ordering = deterministic page boundaries (without it,
    // rows can be duplicated/skipped between parallel page requests).
    pageAll<{ customer_name: string; service_type: string; product_service: string | null; period_start: string | null; period_end: string | null; rate: number | null; invoice_no: string; txn_date: string | null }>(() => supabase.from('quickbooks_invoice_items').select('customer_name, service_type, product_service, period_start, period_end, rate, invoice_no, txn_date').gte('txn_date', `${year - 3}-01-01`).order('invoice_no', { ascending: true }).order('line_num', { ascending: true })),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!arRows?.length) return NextResponse.json({ month, year, total: 0, companies: [] });

  // ── ND name lookup (depends on activeNDs result) ──────────────────────────
  const ndActiveSet = new Set((activeNDs ?? []).map(a => normalize(a.company_name)));
  const ndIds = [...new Set((activeNDs ?? []).map(a => a.nd_id).filter(Boolean))];
  const { data: ndPeople } = ndIds.length
    ? await supabase.from('nominee_directors').select('id, name').in('id', ndIds)
    : { data: [] as { id: number; name: string }[] };
  const ndNameById = new Map((ndPeople ?? []).map(n => [n.id, n.name]));

  const ndAppointmentMap = new Map<string, { date: string; name: string | null }>();
  for (const a of activeNDs ?? []) {
    if (a.appointment_date) {
      ndAppointmentMap.set(normalize(a.company_name), {
        date: a.appointment_date,
        name: ndNameById.get(a.nd_id) ?? null,
      });
    }
  }

  // Build service lookup: normalizedName → Set<service_type>
  const qbServiceMap = new Map<string, Set<string>>();
  // Build period lookup: normalizedName → { secretary, address, nd } latest period_end + rate
  type PeriodInfo = { periodEnd: string | null; periodStart: string | null; rate: number | null; invoiceNo: string | null; ndName?: string | null };
  const qbPeriodMap = new Map<string, { secretary: PeriodInfo; address: PeriodInfo; nd: PeriodInfo }>();

  for (const item of qbItems ?? []) {
    const n = normalize(item.customer_name);
    if (!qbServiceMap.has(n)) qbServiceMap.set(n, new Set());
    qbServiceMap.get(n)!.add(item.service_type);

    const svc = item.service_type?.toLowerCase();
    if (!['secretary','address','nd'].includes(svc)) continue;

    if (!qbPeriodMap.has(n)) {
      qbPeriodMap.set(n, {
        secretary: { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
        address:   { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
        nd:        { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
      });
    }
    const entry = qbPeriodMap.get(n)!;
    const key = svc as 'secretary' | 'address' | 'nd';

    if (item.period_end) {
      // Prefer item with a period_end; keep the latest one
      if (!entry[key].periodEnd || item.period_end > entry[key].periodEnd!) {
        entry[key] = { periodEnd: item.period_end, periodStart: item.period_start ?? null, rate: item.rate ?? null, invoiceNo: item.invoice_no ?? null };
      }
    } else if (!entry[key].rate) {
      // No period in description — still record rate so UI knows a QB record exists
      entry[key] = { periodEnd: null, periodStart: null, rate: item.rate ?? null, invoiceNo: item.invoice_no ?? null };
    }
  }

  // ── Enrich each AR record ─────────────────────────────────────────────────
  const enriched = (arRows ?? []).map(row => {
    const normName = normalize(row.entity_name);

    // Match to companies master
    const compMatch = (companies ?? []).find(c => {
      const s = matchScore(row.entity_name, c.company_name);
      return s >= 70;
    });

    // Services from QB history — try exact match first, then fuzzy
    const fuzzyQbMatch = (map: Map<string, any>) => {
      if (map.has(normName)) return map.get(normName);
      for (const [k, v] of map) {
        const wa = new Set(normName.split(' ').filter(w => w.length > 1));
        const wb = new Set(k.split(' ').filter(w => w.length > 1));
        const common = [...wa].filter(w => wb.has(w)).length;
        if (common > 0 && common / Math.max(wa.size, wb.size) >= 0.6) return v;
      }
      return null;
    };

    const qbSvcsRaw = fuzzyQbMatch(qbServiceMap);
    const qbSvcs = qbSvcsRaw instanceof Set ? qbSvcsRaw : new Set<string>(qbSvcsRaw ? [...qbSvcsRaw] : []);
    const qbPeriods = fuzzyQbMatch(qbPeriodMap) ?? { secretary: null, address: null, nd: null };

    // ── ND period fallback: use TeamWork appointment_date if QB has no ND period ──
    if (!qbPeriods.nd?.periodEnd) {
      let apptInfo: { date: string; name: string | null } | null = ndAppointmentMap.get(normName) ?? null;
      if (!apptInfo) {
        for (const [k, v] of ndAppointmentMap) {
          const wa = new Set(normName.split(' ').filter(w => w.length > 1));
          const wb = new Set(k.split(' ').filter(w => w.length > 1));
          const common = [...wa].filter(w => wb.has(w)).length;
          if (common > 0 && common / Math.max(wa.size, wb.size) >= 0.6) { apptInfo = v; break; }
        }
      }
      if (apptInfo) {
        const d      = new Date(apptInfo.date);
        const pStart = new Date(d.getFullYear(), d.getMonth(), 1);
        const pEnd   = new Date(d.getFullYear() + 1, d.getMonth(), 0);
        qbPeriods.nd = {
          periodStart: pStart.toISOString().slice(0, 10),
          periodEnd:   pEnd.toISOString().slice(0, 10),
          rate:        null,
          invoiceNo:   null,
          ndName:      apptInfo.name,
        };
      }
    }

    // Has XBRL: from QB history OR companies master
    const hasXBRL    = qbSvcs.has('XBRL')      || compMatch?.has_xbrl    === true;
    const hasNd      = ndActiveSet.has(normName) || compMatch?.has_nd      === true;
    const hasAddress = compMatch?.uses_address   === true;
    const hasAccts   = qbSvcs.has('Accounts')   || compMatch?.has_accounts === true;
    const hasTax     = qbSvcs.has('Tax')        || compMatch?.has_tax      === true;
    const hasSec     = qbSvcs.has('Secretary');

    const services = {
      ar:       true, // always true — this IS the AR reminder
      agm:      true, // AGM is always part of AR cycle in Singapore
      xbrl:     hasXBRL,
      nd:       hasNd,
      address:  hasAddress,
      accounts: hasAccts,
      tax:      hasTax,
      secretary:hasSec,
    };

    // QB invoices for this company this year
    const invoices = (qbInvoices ?? [])
      .filter(inv => matchScore(row.entity_name, inv.customer_name) >= 70)
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date));

    // Due date urgency
    const today = todaySGT();
    const daysUntilDue = row.due_date
      ? Math.ceil((new Date(row.due_date).getTime() - new Date(today).getTime()) / 86400000)
      : null;

    // Workflow completion
    const stages = {
      accountsReady: !!row.prepared_date,
      sentToClient:  !!row.sent_date,
      docsReceived:  !!row.received_date,
      agmHeld:       !!row.agm_held_date,
      arFiled:       !!row.filling_date,
    };
    const stagesDone = Object.values(stages).filter(Boolean).length;

    return {
      ...row,
      services,
      servicePeriods: qbPeriods,
      invoices,
      stages,
      stagesDone,
      daysUntilDue,
    };
  });

  return NextResponse.json({ month, year, total: enriched.length, companies: enriched });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { entity_name, fye_month, fye_year } = body;
  if (!entity_name)         return NextResponse.json({ error: 'entity_name required' }, { status: 400 });
  if (!fye_month || !fye_year) return NextResponse.json({ error: 'fye_month and fye_year required' }, { status: 400 });

  const supabase = createAdminClient();

  // If this company was previously soft-deleted for the same cycle, restore it
  // (un-exclude) rather than inserting a duplicate.
  const { data: prior } = await supabase
    .from('ar_reminder')
    .select('id')
    .ilike('entity_name', entity_name)
    .eq('fye_month', fye_month)
    .eq('fye_year', Number(fye_year))
    .eq('status', 'Excluded')
    .limit(1)
    .maybeSingle();
  if (prior) {
    const { data, error } = await supabase.from('ar_reminder').update({ status: 'Pending' }).eq('id', prior.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, restored: true, data });
  }

  const record: Record<string, unknown> = { entity_name, fye_month, fye_year: Number(fye_year) };
  for (const field of ['uen', 'due_date', 'pic', 'acc_pic', 'tax_pic', ...EDITABLE_FIELDS]) {
    if (body[field] !== undefined) record[field] = body[field] || null;
  }

  const { data, error } = await supabase.from('ar_reminder').insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  // Soft delete: mark the row 'Excluded' instead of removing it. The row stays
  // in the table, so the daily auto-generator (which only inserts entity names
  // not already present for that cycle) will NOT re-create a company the user
  // intentionally removed. Excluded rows are filtered out of every list.
  const { error } = await supabase.from('ar_reminder').update({ status: 'Excluded' }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, excluded: true });
}

export async function PATCH(req: NextRequest) {
  const { id, field, value } = await req.json();
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'Field not editable' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ar_reminder')
    .update({ [field]: value || null })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
