import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT, toIsoDateValue } from '@/lib/date';
import { pageAll } from '@/lib/page-all';
import { normalize, matchScore } from '@/lib/company-name';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { getRequestAccount } from '@/lib/request-account';

const EDITABLE_FIELDS = new Set([
  'reminder_note', 'prepared_date', 'date_of_agm', 'agm_held_date',
  'sent_date', 'received_date', 'filling_date',
  'ar_status', 'xbrl', 'software_update', 'dpo', 'ond_ron',
  'pic', 'acc_pic', 'tax_pic', 'remarks',
  'accounts_status', 'fin_stmt_status', 'audited_fs', 'agm_documents', 'dormant',
]);

const STRICT_DATE_FIELDS = new Set([
  'reminder_note', 'prepared_date', 'date_of_agm', 'agm_held_date',
  'sent_date', 'received_date', 'filling_date', 'software_update', 'accounts_status',
]);
const DATABASE_DATE_FIELDS = new Set([
  'prepared_date', 'date_of_agm', 'agm_held_date', 'sent_date', 'received_date', 'filling_date',
]);
const DATE_OR_STATUS_FIELDS = new Set(['xbrl']);

type QbItem = {
  customer_name: string;
  service_type: string;
  product_service: string | null;
  period_start: string | null;
  period_end: string | null;
  rate: number | null;
  invoice_no: string;
  txn_date: string | null;
};

type PeriodInfo = {
  periodEnd: string | null;
  periodStart: string | null;
  rate: number | null;
  invoiceNo: string | null;
  ndName?: string | null;
};

const QB_CACHE_TTL_MS = 5 * 60 * 1000;
const qbItemsCache = new Map<number, { expiresAt: number; promise: Promise<QbItem[]> }>();

function getQbItems(supabase: ReturnType<typeof createAdminClient>, year: number): Promise<QbItem[]> {
  const cached = qbItemsCache.get(year);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = pageAll<QbItem>(() => supabase
    .from('quickbooks_invoice_items')
    .select('customer_name, service_type, product_service, period_start, period_end, rate, invoice_no, txn_date')
    .gte('txn_date', `${year - 3}-01-01`)
    .order('invoice_no', { ascending: true })
    .order('line_num', { ascending: true }))
    .catch(error => {
      qbItemsCache.delete(year);
      throw error;
    });

  qbItemsCache.set(year, { expiresAt: Date.now() + QB_CACHE_TTL_MS, promise });
  return promise;
}

function wordMatch<T>(target: string, map: Map<string, T>): T | null {
  const exact = map.get(target);
  if (exact !== undefined) return exact;

  const targetWords = new Set(target.split(' ').filter(word => word.length > 1));
  for (const [candidate, value] of map) {
    const candidateWords = new Set(candidate.split(' ').filter(word => word.length > 1));
    const common = [...targetWords].filter(word => candidateWords.has(word)).length;
    if (common > 0 && common / Math.max(targetWords.size, candidateWords.size) >= 0.6) return value;
  }
  return null;
}

function normalizeUpdateValue(field: string, value: unknown, rejectInvalidDate: boolean): string | null {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (STRICT_DATE_FIELDS.has(field)) {
    const iso = toIsoDateValue(text);
    if (!iso && rejectInvalidDate) throw new Error('INVALID_DATE');
    // DATE columns are returned by Postgres as ISO and should be compared in
    // canonical form. Legacy date-like TEXT columns may still contain the old
    // display string, so their previous value must be compared verbatim once.
    return rejectInvalidDate || DATABASE_DATE_FIELDS.has(field) ? (iso ?? text) : text;
  }
  if (DATE_OR_STATUS_FIELDS.has(field)) return rejectInvalidDate ? (toIsoDateValue(text) ?? text) : text;
  return text;
}

async function requireAccount(req: NextRequest) {
  return getRequestAccount(req);
}

export async function GET(req: NextRequest) {
  const account = await requireAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') ?? 'April';
  const year = parseInt(searchParams.get('year') ?? '2026', 10);
  if (!Number.isInteger(year)) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

  const supabase = createAdminClient();

  // Check the requested cycle first. An empty cycle should not trigger the
  // much larger company, ND and QuickBooks history queries.
  const { data: arRows, error } = await supabase
    .from('ar_reminder')
    .select('*')
    .eq('fye_month', month)
    .eq('fye_year', year)
    .or('status.is.null,status.neq.Excluded')
    .order('entity_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!arRows?.length) return NextResponse.json({ month, year, total: 0, companies: [] });

  const [
    { data: companies, error: companiesError },
    { data: activeNDs, error: ndError },
    { data: qbInvoices, error: invoiceError },
    qbItems,
  ] = await Promise.all([
    supabase.from('companies').select('id, company_name, has_xbrl, has_nd, uses_address, has_accounts, has_tax, services_manual'),
    supabase.from('nd_appointments').select('company_name, appointment_date, nd_id').eq('sub_role', 'Nominee Director').not('appointment_date', 'is', null).is('cessation_date', null),
    supabase.from('quickbooks_invoices').select('invoice_no, txn_date, customer_name, total_amt, balance, status').gte('txn_date', `${year}-01-01`).lte('txn_date', `${year}-12-31`),
    getQbItems(supabase, year),
  ]);

  const relatedError = companiesError ?? ndError ?? invoiceError;
  if (relatedError) return NextResponse.json({ error: relatedError.message }, { status: 500 });

  const ndActiveSet = new Set((activeNDs ?? []).map(appointment => normalize(appointment.company_name)));
  const ndIds = [...new Set((activeNDs ?? []).map(appointment => appointment.nd_id).filter(Boolean))];
  const { data: ndPeople } = ndIds.length
    ? await supabase.from('nominee_directors').select('id, name').in('id', ndIds)
    : { data: [] as { id: number; name: string }[] };
  const ndNameById = new Map((ndPeople ?? []).map(person => [person.id, person.name]));

  const ndAppointmentMap = new Map<string, { date: string; name: string | null }>();
  for (const appointment of activeNDs ?? []) {
    if (appointment.appointment_date) {
      ndAppointmentMap.set(normalize(appointment.company_name), {
        date: appointment.appointment_date,
        name: ndNameById.get(appointment.nd_id) ?? null,
      });
    }
  }

  const companyMap = new Map((companies ?? []).map(company => [normalize(company.company_name), company]));
  const invoiceMap = new Map<string, NonNullable<typeof qbInvoices>>();
  for (const invoice of qbInvoices ?? []) {
    const key = normalize(invoice.customer_name);
    const bucket = invoiceMap.get(key) ?? [];
    bucket.push(invoice);
    invoiceMap.set(key, bucket);
  }
  for (const bucket of invoiceMap.values()) {
    bucket.sort((a, b) => String(b.txn_date ?? '').localeCompare(String(a.txn_date ?? '')));
  }

  const qbServiceMap = new Map<string, Set<string>>();
  const qbPeriodMap = new Map<string, { secretary: PeriodInfo; address: PeriodInfo; nd: PeriodInfo }>();
  for (const item of qbItems) {
    const name = normalize(item.customer_name);
    if (!qbServiceMap.has(name)) qbServiceMap.set(name, new Set());
    qbServiceMap.get(name)!.add(item.service_type);

    const service = item.service_type?.toLowerCase();
    if (!['secretary', 'address', 'nd'].includes(service)) continue;
    if (!qbPeriodMap.has(name)) {
      qbPeriodMap.set(name, {
        secretary: { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
        address: { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
        nd: { periodEnd: null, periodStart: null, rate: null, invoiceNo: null },
      });
    }
    const entry = qbPeriodMap.get(name)!;
    const key = service as 'secretary' | 'address' | 'nd';
    if (item.period_end) {
      if (!entry[key].periodEnd || item.period_end > entry[key].periodEnd!) {
        entry[key] = {
          periodEnd: item.period_end,
          periodStart: item.period_start ?? null,
          rate: item.rate ?? null,
          invoiceNo: item.invoice_no ?? null,
        };
      }
    } else if (!entry[key].rate) {
      entry[key] = {
        periodEnd: null,
        periodStart: null,
        rate: item.rate ?? null,
        invoiceNo: item.invoice_no ?? null,
      };
    }
  }

  const today = todaySGT();
  const enriched = arRows.map(row => {
    const normName = normalize(row.entity_name);
    const compMatch = companyMap.get(normName)
      ?? (companies ?? []).find(company => matchScore(row.entity_name, company.company_name) >= 70);

    const qbSvcsRaw = wordMatch(normName, qbServiceMap);
    const qbSvcs = qbSvcsRaw instanceof Set ? qbSvcsRaw : new Set<string>();
    const matchedPeriods = wordMatch(normName, qbPeriodMap);
    const qbPeriods: { secretary: PeriodInfo | null; address: PeriodInfo | null; nd: PeriodInfo | null } = matchedPeriods
      ? {
          secretary: { ...matchedPeriods.secretary },
          address: { ...matchedPeriods.address },
          nd: { ...matchedPeriods.nd },
        }
      : { secretary: null, address: null, nd: null };

    if (!qbPeriods.nd?.periodEnd) {
      const appointment = wordMatch(normName, ndAppointmentMap);
      if (appointment) {
        const date = new Date(`${appointment.date}T00:00:00`);
        const periodStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const periodEnd = new Date(date.getFullYear() + 1, date.getMonth(), 0);
        qbPeriods.nd = {
          periodStart: periodStart.toISOString().slice(0, 10),
          periodEnd: periodEnd.toISOString().slice(0, 10),
          rate: null,
          invoiceNo: null,
          ndName: appointment.name,
        };
      }
    }

    const servicesAuto = {
      ar: true,
      agm: true,
      xbrl: qbSvcs.has('XBRL') || compMatch?.has_xbrl === true,
      nd: ndActiveSet.has(normName) || compMatch?.has_nd === true,
      address: compMatch?.uses_address === true,
      accounts: qbSvcs.has('Accounts') || compMatch?.has_accounts === true,
      tax: qbSvcs.has('Tax') || compMatch?.has_tax === true,
      secretary: qbSvcs.has('Secretary'),
    };
    const servicesManual = (compMatch?.services_manual as Record<string, boolean> | null) ?? {};
    const services = {
      ...servicesAuto,
      ...(servicesManual.secretary !== undefined ? { secretary: servicesManual.secretary } : {}),
      ...(servicesManual.accounts !== undefined ? { accounts: servicesManual.accounts } : {}),
      ...(servicesManual.tax !== undefined ? { tax: servicesManual.tax } : {}),
      ...(servicesManual.xbrl !== undefined ? { xbrl: servicesManual.xbrl } : {}),
    };

    const stages = {
      accountsReady: !!row.prepared_date,
      sentToClient: !!row.sent_date,
      docsReceived: !!row.received_date,
      agmHeld: !!row.agm_held_date,
      arFiled: !!row.filling_date,
    };

    return {
      ...row,
      pic: resolveTeamworkPic(row.pic),
      company_id: compMatch?.id ?? null,
      services,
      servicesAuto,
      servicesManual,
      servicePeriods: qbPeriods,
      invoices: wordMatch(normName, invoiceMap) ?? [],
      stages,
      stagesDone: Object.values(stages).filter(Boolean).length,
      daysUntilDue: row.due_date
        ? Math.ceil((new Date(`${row.due_date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
        : null,
    };
  });

  return NextResponse.json(
    { month, year, total: enriched.length, companies: enriched },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(req: NextRequest) {
  const account = await requireAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const body = await req.json();
  const { entity_name, fye_month, fye_year } = body;
  if (!entity_name) return NextResponse.json({ error: 'entity_name required' }, { status: 400 });
  if (!fye_month || !fye_year) return NextResponse.json({ error: 'fye_month and fye_year required' }, { status: 400 });

  const supabase = createAdminClient();
  const actor = { updated_by_email: account.email, updated_by_name: account.name };
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
    const { data, error } = await supabase
      .from('ar_reminder')
      .update({ status: 'Pending', ...actor })
      .eq('id', prior.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, restored: true, data });
  }

  const record: Record<string, unknown> = {
    entity_name: String(entity_name).trim(),
    fye_month,
    fye_year: Number(fye_year),
    ...actor,
  };
  for (const field of ['uen', 'pic', 'acc_pic', 'tax_pic', ...EDITABLE_FIELDS]) {
    if (body[field] !== undefined) record[field] = normalizeUpdateValue(field, body[field], true);
  }
  for (const field of ['fye_date', 'due_date']) {
    if (body[field] !== undefined) {
      const value = toIsoDateValue(body[field]);
      if (body[field] && !value) return NextResponse.json({ error: `Invalid date for ${field}` }, { status: 400 });
      record[field] = value;
    }
  }

  const { data, error } = await supabase.from('ar_reminder').insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const account = await requireAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ar_reminder')
    .update({ status: 'Excluded', updated_by_email: account.email, updated_by_name: account.name })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, excluded: true });
}

export async function PATCH(req: NextRequest) {
  const account = await requireAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const body = await req.json();
  const { id, field } = body;
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'Field not editable' }, { status: 400 });
  if (!Object.prototype.hasOwnProperty.call(body, 'previousValue')) {
    return NextResponse.json({ error: 'previousValue is required for conflict-safe updates' }, { status: 428 });
  }

  let nextValue: string | null;
  let previousValue: string | null;
  try {
    nextValue = normalizeUpdateValue(field, body.value, true);
    previousValue = normalizeUpdateValue(field, body.previousValue, false);
  } catch {
    return NextResponse.json({ error: 'Invalid date. Use a date such as 03 Apr 2026.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  let updateQuery = supabase
    .from('ar_reminder')
    .update({
      [field]: nextValue,
      updated_by_email: account.email,
      updated_by_name: account.name,
    })
    .eq('id', id);
  updateQuery = previousValue === null
    ? updateQuery.is(field, null)
    : updateQuery.filter(field, 'eq', previousValue);

  const { data, error } = await updateQuery.select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    const { data: current, error: currentError } = await supabase
      .from('ar_reminder')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    return NextResponse.json({
      error: 'conflict',
      currentValue: current[field] ?? null,
      updatedByName: current.updated_by_name ?? null,
      updatedByEmail: current.updated_by_email ?? null,
      updatedAt: current.updated_at ?? null,
      version: current.version ?? null,
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    value: data[field] ?? null,
    updatedAt: data.updated_at ?? null,
    updatedByName: data.updated_by_name ?? account.name,
    version: data.version ?? null,
  });
}
