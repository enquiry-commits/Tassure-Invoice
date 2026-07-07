import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * Auto-generates ar_reminder rows for a rolling 6-month window (current
 * month + next 5), based on each company's fye_month. Due date = FYE date
 * + 7 months (Singapore's standard AR filing deadline — confirmed against
 * existing manually-entered rows, e.g. FYE 2026-04-30 -> due 2026-11-30).
 *
 * Only inserts new (entity_name, fye_month, fye_year) rows — never
 * overwrites existing rows, so manually-tracked workflow fields on
 * existing entries are untouched. Safe to call repeatedly; the window is
 * computed from "today" each time, so it naturally rolls forward.
 *
 * Triggered by a daily Vercel Cron (see vercel.json) and can also be
 * called manually.
 */

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EXCLUDED_STATUSES = ['Striking Off', 'Terminated'];
const WINDOW_MONTHS = 6;

function lastDayOfMonth(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addMonths(date: Date, n: number) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

export async function GET() {
  const supabase = createAdminClient();

  const now = new Date();
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();

  const targets = Array.from({ length: WINDOW_MONTHS }, (_, i) => {
    const idx = (currentMonthIndex + i) % 12;
    const yearOffset = Math.floor((currentMonthIndex + i) / 12);
    return { monthName: MONTH_NAMES[idx], monthIndex0: idx, year: currentYear + yearOffset };
  });

  const { data: companies, error } = await supabase
    .from('companies')
    .select('company_name, registration_no, fye_month, pic, is_active, tw_status')
    .eq('is_active', true)
    .not('tw_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary: { month: string; year: number; matched: number; inserted: number }[] = [];
  let totalInserted = 0;

  for (const target of targets) {
    const matching = (companies ?? []).filter(c => c.fye_month === target.monthName);

    const { data: existing } = await supabase
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
        pic: c.pic || '',
      }));

    if (toInsert.length) {
      const { error: insErr } = await supabase.from('ar_reminder').insert(toInsert);
      if (insErr) {
        summary.push({ month: target.monthName, year: target.year, matched: matching.length, inserted: 0 });
        continue;
      }
    }

    summary.push({ month: target.monthName, year: target.year, matched: matching.length, inserted: toInsert.length });
    totalInserted += toInsert.length;
  }

  return NextResponse.json({ ok: true, window: targets.map(t => `${t.monthName} ${t.year}`), totalInserted, summary });
}
