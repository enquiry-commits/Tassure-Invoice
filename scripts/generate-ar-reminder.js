/**
 * Auto-generates ar_reminder rows for a rolling 6-month window (current month
 * + next 5), based on each company's fye_month (already verified against
 * TeamWork). Due date = FYE date + 7 months (Singapore's standard AR filing
 * deadline — confirmed by cross-checking existing manually-entered rows,
 * e.g. FYE 2026-04-30 -> due 2026-11-30).
 *
 * FYE date is assumed to be the last calendar day of fye_month for the target
 * year (true for 688/692, i.e. 99.4%, of companies with a known exact FYE day
 * in the TeamWork extract — the rare exceptions are treated as month-end too).
 *
 * Only INSERTS new (entity_name, fye_month, fye_year) rows that don't already
 * exist — never overwrites existing rows, so manually-tracked workflow fields
 * (prepared_date, sent_date, ar_status, etc.) on existing entries are never
 * touched. Safe to re-run any time; the window is always computed from
 * "today" so re-running later naturally rolls the window forward.
 *
 * Companies included: is_active = true AND tw_status NOT IN ('Striking Off', 'Terminated').
 *
 * Usage: node scripts/generate-ar-reminder.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EXCLUDED_STATUSES = ['Striking Off', 'Terminated'];
const WINDOW_MONTHS = 6;

function lastDayOfMonth(year, monthIndex0) {
  // monthIndex0: 0=Jan ... 11=Dec
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  // handle month-length overflow (e.g. Jan 31 + 1 month should not become Mar 3)
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

async function main() {
  const now = new Date();
  const currentMonthIndex = now.getMonth(); // 0-based, local/server time (SGT via todaySGT used elsewhere, but month granularity is safe here)
  const currentYear = now.getFullYear();

  const targets = [];
  for (let i = 0; i < WINDOW_MONTHS; i++) {
    const idx = (currentMonthIndex + i) % 12;
    const yearOffset = Math.floor((currentMonthIndex + i) / 12);
    targets.push({ monthName: MONTH_NAMES[idx], monthIndex0: idx, year: currentYear + yearOffset });
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Rolling window: ${targets.map(t => `${t.monthName} ${t.year}`).join(', ')}`);

  const { data: companies, error } = await sb
    .from('companies')
    .select('company_name, registration_no, fye_month, pic, is_active, tw_status')
    .eq('is_active', true)
    .not('tw_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`);

  if (error) { console.error(error); process.exit(1); }

  let totalInserted = 0, totalSkippedExisting = 0;

  for (const target of targets) {
    const matching = companies.filter(c => c.fye_month === target.monthName);

    const { data: existing } = await sb
      .from('ar_reminder')
      .select('entity_name')
      .eq('fye_month', target.monthName)
      .eq('fye_year', target.year);
    const existingNames = new Set((existing ?? []).map(r => r.entity_name));

    const fyeDate = lastDayOfMonth(target.year, target.monthIndex0);
    const dueDate = addMonths(fyeDate, 7);

    const toInsert = matching
      .filter(c => !existingNames.has(c.company_name))
      .map(c => ({
        entity_name: c.company_name,
        uen: c.registration_no || '',
        fye_month: target.monthName,
        fye_year: target.year,
        fye_date: toDateStr(fyeDate),
        due_date: toDateStr(dueDate),
        pic: ({ '9': 'Kah Ye Chin', '10': 'Hoe Chyi Lim', '11': 'Shi Ming Ang', '12': 'Seng Xin Hoo' })[String(c.pic || '').trim()] || c.pic || '',
      }));

    console.log(`  ${target.monthName} ${target.year}: ${matching.length} companies match FYE, ${existingNames.size} already in ar_reminder, ${toInsert.length} new to insert`);

    if (toInsert.length && !DRY_RUN) {
      const { error: insErr } = await sb.from('ar_reminder').insert(toInsert);
      if (insErr) { console.error(`    INSERT ERROR for ${target.monthName} ${target.year}:`, insErr.message); continue; }
    }

    totalInserted += toInsert.length;
    totalSkippedExisting += matching.length - toInsert.length;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Total new rows inserted: ${totalInserted}, already existed (skipped): ${totalSkippedExisting}`);
}

main();
