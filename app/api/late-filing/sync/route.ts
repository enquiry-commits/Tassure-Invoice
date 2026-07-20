import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseDmy, getSessionCookie, fetchAgmList } from '@/lib/teamwork-agm';
import { AutomationRun, withAutomationRun } from '@/lib/automation-sync';

/**
 * Detects late filers from TeamWork's per-company AGM/AR history.
 *
 * A company is flagged when either its current outstanding cycle is more
 * than 90 days overdue, or its historical average completion delay is more
 * than 90 days. TeamWork is read with bounded concurrency because processing
 * every company sequentially can exceed Vercel's five-minute function limit.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const OVERDUE_THRESHOLD_DAYS = 90;
const HISTORICAL_AVG_THRESHOLD_DAYS = 90;
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DEFAULT_CONCURRENCY = 12;
const MAX_CONCURRENCY = 20;

// Stop our own work before Vercel's 300-second hard limit so the run can be
// marked failed and its lock can always be released.
const WORK_DEADLINE_MS = 230_000;

type CompanyTarget = {
  company_name: string;
  internal_id: string;
  registration_no: string | null;
};

type CompanyEvaluation = {
  company: CompanyTarget;
  rows?: string[][];
  error?: string;
};

function configuredConcurrency() {
  const parsed = Number(process.env.LATE_FILING_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.trunc(parsed)));
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Late Filing evaluation was cancelled.');
}

async function evaluateCompanies(
  targets: CompanyTarget[],
  cookie: string,
  run: AutomationRun,
  signal: AbortSignal,
): Promise<CompanyEvaluation[]> {
  const results = new Array<CompanyEvaluation>(targets.length);
  const concurrency = Math.min(configuredConcurrency(), Math.max(1, targets.length));
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      const index = nextIndex++;
      if (index >= targets.length) return;
      const company = targets[index];

      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await fetchAgmList(cookie, company.internal_id, signal);
          results[index] = { company, rows: result.data ?? [] };
          lastError = null;
          break;
        } catch (error) {
          if (signal.aborted) throw abortError(signal);
          lastError = error;
          if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 250));
        }
      }

      if (lastError) {
        results[index] = {
          company,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        };
      }

      completed++;
      if (completed % 100 === 0) await run.heartbeat(6);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function syncLateFiling(run: AutomationRun) {
  const supabase = createAdminClient();
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(
      'Late Filing stopped safely before the Vercel timeout because TeamWork did not finish within 230 seconds.',
    ));
  }, WORK_DEADLINE_MS);

  try {
    const cookie = await getSessionCookie();

    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('company_name, internal_id, registration_no')
      .eq('is_active', true)
      .not('tw_status', 'in', '("Striking Off","Terminated")')
      .not('internal_id', 'is', null);
    if (companiesError) throw new Error(`Unable to load active companies: ${companiesError.message}`);

    const targets: CompanyTarget[] = (companies ?? []).map(company => ({
      company_name: company.company_name,
      internal_id: String(company.internal_id),
      registration_no: company.registration_no ?? null,
    }));
    const evaluations = await evaluateCompanies(targets, cookie, run, controller.signal);

    const { data: existingManual, error: existingError } = await supabase
      .from('late_filing_companies')
      .select('id, uen, company_name, remarks');
    if (existingError) throw new Error(`Unable to load Late Filing records: ${existingError.message}`);

    const byUen = new Map((existingManual ?? [])
      .filter(row => row.uen)
      .map(row => [row.uen as string, row]));
    const byName = new Map((existingManual ?? [])
      .map(row => [row.company_name.toLowerCase(), row]));

    const today = new Date();
    let flagged = 0;
    let inserted = 0;
    let refreshed = 0;
    let movedToReview = 0;
    let errors = 0;
    let successfullyEvaluated = 0;
    const insertedNames: string[] = [];
    const fetchErrors: Array<{ company: string; error: string }> = [];
    const evaluatedIds = new Set<number>();
    const stillFlaggedIds = new Set<number>();

    for (const evaluation of evaluations) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const c = evaluation.company;
      if (evaluation.error) {
        errors++;
        if (fetchErrors.length < 20) {
          fetchErrors.push({ company: c.company_name, error: evaluation.error });
        }
        continue;
      }
      successfullyEvaluated++;

      const rows = evaluation.rows ?? [];
      const existing = (c.registration_no ? byUen.get(c.registration_no) : null)
        ?? byName.get(c.company_name.toLowerCase());
      if (existing) evaluatedIds.add(existing.id);

      const gaps: number[] = [];
      let currentOverdueDays = 0;
      let latestFyeMonth: string | null = null;
      let lastAgmHeld: Date | null = null;
      let lastArFiled: Date | null = null;
      let earliestOutstandingDue: Date | null = null;
      let newestAgmDue: Date | null = null;

      for (const row of rows) {
        const [event, , fyeDateRaw, , dueDateRaw, heldDateRaw, filingDateRaw] = row;
        if (!['AGM', 'AR'].includes(event)) continue;
        const dueDate = parseDmy(dueDateRaw);
        if (!dueDate) continue;
        const heldDate = parseDmy(heldDateRaw);
        const filingDate = parseDmy(filingDateRaw);
        const completionDate = filingDate || heldDate;
        const fyeDate = parseDmy(fyeDateRaw);
        if (fyeDate && !latestFyeMonth) latestFyeMonth = MONTH_ABBR[fyeDate.getMonth()];

        if (event === 'AGM') {
          if (heldDate && (!lastAgmHeld || heldDate > lastAgmHeld)) lastAgmHeld = heldDate;
          if (!newestAgmDue || dueDate > newestAgmDue) newestAgmDue = dueDate;
        }
        if (event === 'AR' && filingDate && (!lastArFiled || filingDate > lastArFiled)) {
          lastArFiled = filingDate;
        }

        if (completionDate) {
          gaps.push(Math.round((completionDate.getTime() - dueDate.getTime()) / 86_400_000));
        } else {
          if (!earliestOutstandingDue || dueDate < earliestOutstandingDue) earliestOutstandingDue = dueDate;
          if (dueDate < today) {
            const overdueDays = Math.round((today.getTime() - dueDate.getTime()) / 86_400_000);
            if (overdueDays > currentOverdueDays) currentOverdueDays = overdueDays;
          }
        }
      }

      const avgGap = gaps.length
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
        : 0;
      const isLate = currentOverdueDays > OVERDUE_THRESHOLD_DAYS
        || avgGap > HISTORICAL_AVG_THRESHOLD_DAYS;
      if (!isLate) continue;
      flagged++;

      const reasons: string[] = [];
      if (currentOverdueDays > OVERDUE_THRESHOLD_DAYS) reasons.push(`Overdue ${currentOverdueDays} days`);
      if (avgGap > HISTORICAL_AVG_THRESHOLD_DAYS) {
        reasons.push(`Avg ${avgGap} days late over ${gaps.length} cycles`);
      }

      const toIso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;
      const values = {
        company_name: c.company_name,
        uen: c.registration_no,
        financial_year_end: latestFyeMonth,
        last_agm_date: toIso(lastAgmHeld),
        last_annual_return_date: toIso(lastArFiled),
        next_agm_due_date: toIso(earliestOutstandingDue) || toIso(newestAgmDue),
        remarks: `AUTO: ${reasons.join('; ')}`,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        stillFlaggedIds.add(existing.id);
        if (/^AUTO:/i.test(existing.remarks ?? '')) {
          const { error } = await supabase
            .from('late_filing_companies')
            .update(values)
            .eq('id', existing.id);
          if (error) errors++;
          else refreshed++;
        }
        continue;
      }

      const { error } = await supabase.from('late_filing_companies').insert(values);
      if (error) errors++;
      else {
        inserted++;
        insertedNames.push(c.company_name);
      }
    }

    const reviewDate = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Singapore',
    }).format(new Date());

    for (const row of existingManual ?? []) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      if (!evaluatedIds.has(row.id)
        || stillFlaggedIds.has(row.id)
        || !/^AUTO:/i.test(row.remarks ?? '')) continue;
      const { error } = await supabase.from('late_filing_companies').update({
        remarks: `Review: Auto condition cleared on ${reviewDate} — verify before resolving. Previous: ${row.remarks}`,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (error) errors++;
      else movedToReview++;
    }

    const result = {
      ok: errors === 0,
      checked: targets.length,
      evaluated: successfullyEvaluated,
      concurrency: configuredConcurrency(),
      flagged,
      inserted,
      refreshed,
      movedToReview,
      insertedNames,
      errors,
      fetchErrors,
    };
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    clearTimeout(deadline);
  }
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'late_filing', syncLateFiling);
}
