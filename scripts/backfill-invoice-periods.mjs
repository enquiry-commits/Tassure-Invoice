import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { parseInvoicePeriod } from '../lib/invoice-period.ts';

const apply = process.argv.includes('--apply');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

async function pageAll() {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('quickbooks_invoice_items')
      .select('id, invoice_no, qb_company, customer_name, service_type, description, period_start, period_end, fye_date, period_parse_status')
      .range(from, from + size - 1)
      .order('id', { ascending: true });
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

function nextValues(row) {
  const parsed = parseInvoicePeriod(row.description, row.service_type);
  const requiresPeriod = ['Secretary', 'Address', 'ND'].includes(row.service_type);
  const requiresFye = ['AR', 'XBRL'].includes(row.service_type);
  if (requiresPeriod) {
    // Historical rows can contain manually-reviewed values. Backfill only
    // missing fields; live reads reparse descriptions without overwriting them.
    const periodStart = row.period_start ?? parsed?.period_start ?? null;
    const periodEnd = row.period_end ?? parsed?.period_end ?? null;
    return {
      period_start: periodStart,
      period_end: periodEnd,
      period_parse_status: periodEnd ? 'parsed' : 'missing_period',
    };
  }
  if (requiresFye) {
    const fyeDate = row.fye_date ?? parsed?.fye_date ?? null;
    return {
      fye_date: fyeDate,
      period_parse_status: fyeDate ? 'parsed' : 'missing_fye',
    };
  }
  return null;
}

const rows = await pageAll();
const changes = rows
  .map(row => ({ row, values: nextValues(row) }))
  .filter(({ values }) => values !== null)
  .filter(({ row, values }) =>
    ('period_start' in values && row.period_start !== values.period_start)
    || ('period_end' in values && row.period_end !== values.period_end)
    || ('fye_date' in values && row.fye_date !== values.fye_date),
  );

const byService = changes.reduce((summary, { row }) => {
  summary[row.service_type] = (summary[row.service_type] ?? 0) + 1;
  return summary;
}, {});
const byChangeType = changes.reduce((summary, { row, values }) => {
  const periodChanged = ('period_start' in values && row.period_start !== values.period_start)
    || ('period_end' in values && row.period_end !== values.period_end);
  const fyeChanged = 'fye_date' in values && row.fye_date !== values.fye_date;
  const type = periodChanged
    ? (row.period_end ? 'period_corrected' : 'period_recovered')
    : fyeChanged
      ? (row.fye_date ? 'fye_corrected' : 'fye_recovered')
      : 'status_only';
  summary[type] = (summary[type] ?? 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  scanned: rows.length,
  changes: changes.length,
  byService,
  byChangeType,
  samples: changes.slice(0, 8).map(({ row, values }) => ({
    company: row.customer_name,
    invoice: row.invoice_no,
    service: row.service_type,
    before: `${row.period_start ?? '-'}..${row.period_end ?? '-'}`,
    after: `${values.period_start ?? row.period_start ?? '-'}..${values.period_end ?? row.period_end ?? '-'}`,
    fyeBefore: row.fye_date ?? '-',
    fyeAfter: values.fye_date ?? row.fye_date ?? '-',
  })),
}, null, 2));

if (apply) {
  let updated = 0;
  for (let offset = 0; offset < changes.length; offset += 20) {
    const batch = changes.slice(offset, offset + 20);
    const results = await Promise.all(batch.map(({ row, values }) =>
      supabase.from('quickbooks_invoice_items').update(values).eq('id', row.id),
    ));
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;
    updated += batch.length;
    if (updated % 200 === 0 || updated === changes.length) console.log(`Updated ${updated}/${changes.length}`);
  }
  console.log(`Backfill complete: ${updated} QuickBooks invoice line items updated.`);
}
