import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT, thisYearSGT } from '@/lib/date';

// ── helpers ───────────────────────────────────────────────────────────────────
const MONTH_IDX: Record<string, number> = {
  JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,
  JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12,
};
function fyeToDate(month: string, year: number): string {
  const m = MONTH_IDX[month.toUpperCase()] ?? 12;
  const lastDay = new Date(year, m, 0).getDate();
  return `${year}-${String(m).padStart(2,'0')}-${lastDay}`;
}
// Next AGM due = 9 months after FYE (private company rule in SG)
function nextAgmDue(fyeDate: string): string {
  const d = new Date(fyeDate);
  d.setMonth(d.getMonth() + 9);
  return d.toISOString().slice(0,10);
}

// Fields late-filing/sync also writes — a manual edit here must win from
// now on (see scripts/add-late-filing-manual-fields.sql). company_name/uen
// are excluded: they're used as this PATCH's own lookup key, not really an
// "auto vs manual value" field in the same sense.
const PROTECTED_FIELDS = ['financial_year_end', 'last_agm_date', 'last_annual_return_date', 'next_agm_due_date', 'remarks'] as const;

// Compares each protected field the client actually sent against what's
// currently stored, and only flips manual_fields for ones that genuinely
// changed — re-saving a field's existing value (because the edit form
// always round-trips the whole row) shouldn't by itself mark it manual.
function nextManualFields(
  currentManualFields: Record<string, boolean> | null | undefined,
  currentRow: Record<string, unknown> | null,
  fields: Record<string, unknown>,
): Record<string, boolean> | null {
  const next = { ...(currentManualFields ?? {}) };
  let changed = false;
  for (const key of PROTECTED_FIELDS) {
    if (!(key in fields)) continue;
    const newVal = fields[key] ?? null;
    const oldVal = currentRow ? (currentRow[key] ?? null) : null;
    if (newVal === oldVal) continue;
    changed = true;
    if (newVal !== null && newVal !== '') next[key] = true;
    else delete next[key];
  }
  return changed ? next : null;
}

// ── GET — auto-detect late filers from ar_reminder + merge manual overrides ──
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fyeFilter = searchParams.get('fye') ?? 'ALL';

  const sb  = createAdminClient();
  const today = todaySGT();
  const thisYear = thisYearSGT();

  // 1. All ar_reminder records — group by entity_name
  const { data: arRows } = await sb
    .from('ar_reminder')
    .select('entity_name, fye_month, fye_year, filling_date, agm_held_date, date_of_agm, prepared_date, due_date')
    .order('fye_year', { ascending: false });

  // 2. Companies master (for UEN + Strike Off status)
  const { data: companies } = await sb
    .from('companies')
    .select('company_name, registration_no, fye_month, is_active, tw_status');

  const uenMap = new Map<string, string>();
  // Vincent: "有一些公司已经是STRIKE OFF了的，或者TERMINATED了的，就不需要出现
  // 在这个页面了，这个页面只显示还ACTIVE 但是late filling的公司" — this route
  // re-derives "late" fresh from ar_reminder on every load and never checked
  // is_active/tw_status at all, so a company that's since been struck off
  // (its overdue AR cycle just sitting there, never filed, because it's
  // being wound up instead) kept showing up here forever. Only exclude on a
  // POSITIVE match — a company not found in `companies` at all keeps
  // showing (unmatched, not confirmed inactive).
  const inactiveNames = new Set<string>();
  for (const c of companies ?? []) {
    uenMap.set(c.company_name.toLowerCase(), c.registration_no ?? '');
    if (c.is_active === false || c.tw_status === 'Striking Off' || c.tw_status === 'Terminated') {
      inactiveNames.add(c.company_name.toLowerCase());
    }
  }

  // 3. Manual overrides from late_filing_companies table (if exists)
  const { data: manualRows } = await sb
    .from('late_filing_companies')
    .select('*');
  const manualByUen = new Map<string, typeof manualRows extends (infer T)[] | null ? T : never>();
  for (const r of manualRows ?? []) {
    if (r.uen) manualByUen.set(r.uen, r);
  }

  // 4. Group ar_reminder by entity
  type ArGroup = {
    fye_month: string;
    years: Array<{
      year: number;
      filling_date: string | null;
      agm_held_date: string | null;
      date_of_agm: string | null;
      prepared_date: string | null;
      due_date: string | null;
    }>;
  };
  const byEntity = new Map<string, ArGroup>();
  for (const row of arRows ?? []) {
    const key = row.entity_name;
    if (!byEntity.has(key)) byEntity.set(key, { fye_month: row.fye_month ?? '', years: [] });
    byEntity.get(key)!.years.push({
      year:          row.fye_year,
      filling_date:  row.filling_date,
      agm_held_date: row.agm_held_date,
      date_of_agm:   row.date_of_agm,
      prepared_date: row.prepared_date,
      due_date:      row.due_date,
    });
  }

  // 5. Detect late filers
  type LateRow = {
    id: string;              // entity_name as synthetic ID
    company_name: string;
    uen: string;
    financial_year_end: string;
    last_annual_return_date: string | null;
    last_agm_date: string | null;
    last_accounts_date: string | null;
    next_agm_due_date: string | null;
    remarks: string | null;
    late_fy: number;         // the year that is outstanding
    source: 'auto' | 'manual';
    // Only set for rows that already have a real late_filing_companies row
    // (source: 'manual') — used as an optimistic-concurrency token by
    // PATCH below. A pure 'auto' row doesn't exist there yet, so editing
    // it is a first-time insert with nothing to conflict against.
    updated_at: string | null;
    // Which fields a human has overridden, for the blue "auto-filled" dot —
    // see scripts/add-late-filing-manual-fields.sql. Only ever set on rows
    // with a real late_filing_companies row; a pure ar_reminder-derived
    // 'auto' row (no manual row at all) is never manual for any field.
    manual_fields: Record<string, boolean> | null;
  };

  const detected: LateRow[] = [];

  for (const [entityName, group] of byEntity) {
    if (inactiveNames.has(entityName.toLowerCase())) continue;
    const fyeMonth = group.fye_month?.toUpperCase() ?? '';
    const sorted   = [...group.years].sort((a,b) => b.year - a.year);

    // Find the most recent COMPLETED year
    const lastCompleted = sorted.find(y => y.filling_date);
    // Find the most recent year that is INCOMPLETE and in a past FYE
    const lateFy = sorted.find(y => {
      if (!y.year || y.year >= thisYear) return false;  // only flag past FYEs
      const fyeDate = fyeToDate(fyeMonth, y.year);
      if (fyeDate > today) return false;                // FYE not yet passed
      return !y.filling_date;                           // AR not filed
    });

    if (!lateFy) continue; // not late

    const uen = uenMap.get(entityName.toLowerCase()) ?? '';
    const manual = manualByUen.get(uen);

    // Last AR/AGM dates from last completed year
    const lastArDate  = lastCompleted?.filling_date  ?? null;
    const lastAgmDate = lastCompleted?.agm_held_date ?? lastCompleted?.date_of_agm ?? null;
    const lastAccDate = lastCompleted?.prepared_date ?? null;

    // Next AGM due for the OUTSTANDING year
    const fyeDate       = fyeToDate(fyeMonth, lateFy.year);
    const nextAgm       = nextAgmDue(fyeDate);

    detected.push({
      id:                      entityName,
      company_name:            entityName,
      uen:                     manual?.uen ?? uen,
      financial_year_end:      fyeMonth,
      last_annual_return_date: manual?.last_annual_return_date ?? lastArDate,
      last_agm_date:           manual?.last_agm_date           ?? lastAgmDate,
      last_accounts_date:      manual?.last_accounts_date      ?? lastAccDate,
      next_agm_due_date:       manual?.next_agm_due_date       ?? nextAgm,
      remarks:                 manual?.remarks                  ?? null,
      late_fy:                 lateFy.year,
      source:                  manual ? 'manual' : 'auto',
      updated_at:              manual?.updated_at ?? null,
      manual_fields:           manual?.manual_fields ?? null,
    });
  }

  // 6. Also include manually-added entries not found in ar_reminder
  for (const m of manualRows ?? []) {
    if (inactiveNames.has(m.company_name.toLowerCase())) continue;
    const alreadyIn = detected.some(d =>
      d.uen === m.uen || d.company_name.toLowerCase() === m.company_name.toLowerCase()
    );
    if (!alreadyIn) {
      detected.push({
        id:                      `manual-${m.id}`,
        company_name:            m.company_name,
        uen:                     m.uen ?? '',
        financial_year_end:      m.financial_year_end ?? '',
        last_annual_return_date: m.last_annual_return_date,
        last_agm_date:           m.last_agm_date,
        last_accounts_date:      m.last_accounts_date,
        next_agm_due_date:       m.next_agm_due_date,
        remarks:                 m.remarks,
        late_fy:                 0,
        source:                  'manual',
        updated_at:              m.updated_at ?? null,
        manual_fields:           m.manual_fields ?? null,
      });
    }
  }

  // 7. Sort by FYE month then name
  detected.sort((a,b) => {
    const ma = MONTH_IDX[a.financial_year_end] ?? 99;
    const mb = MONTH_IDX[b.financial_year_end] ?? 99;
    if (ma !== mb) return ma - mb;
    return a.company_name.localeCompare(b.company_name);
  });

  // Apply FYE filter
  const out = fyeFilter === 'ALL'
    ? detected
    : detected.filter(r => r.financial_year_end === fyeFilter.toUpperCase());

  return NextResponse.json({ companies: out, total: out.length });
}

// ── POST — add manual entry ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('late_filing_companies')
    .insert({ ...body, updated_at: new Date().toISOString() })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}

// ── PATCH — update manual override (remarks, dates, etc.) ────────────────────
export async function PATCH(req: NextRequest) {
  const { uen, company_name, previousUpdatedAt, ...fields } = await req.json();
  if (!uen && !company_name) return NextResponse.json({ error: 'uen or company_name required' }, { status: 400 });

  const sb = createAdminClient();

  const updated_at = new Date().toISOString();
  let error;
  let conflict = false;

  // previousUpdatedAt is optional (an 'auto'-source row being edited for the
  // first time has no late_filing_companies row yet, so there's nothing to
  // conflict against — see LateRow's own comment in the GET handler above).
  // When present, it's used as a row-level optimistic-concurrency token —
  // simpler than tracking every individual field's previous value, since
  // this page always saves the whole edit form as one unit, not per-cell
  // (Vincent: prevent two staff editing the same Late Filing row at once
  // from silently overwriting each other, same as AR Reminder/Master List).
  if (uen) {
    const { data: existingByUen } = await sb.from('late_filing_companies')
      .select('id, updated_at, financial_year_end, last_agm_date, last_annual_return_date, next_agm_due_date, remarks, manual_fields')
      .eq('uen', uen).maybeSingle();
    if (!existingByUen) {
      ({ error } = await sb.from('late_filing_companies').insert({ uen, company_name, ...fields, updated_at, manual_fields: nextManualFields(null, null, fields) ?? {} }));
    } else if (previousUpdatedAt && existingByUen.updated_at !== previousUpdatedAt) {
      conflict = true;
    } else {
      const manualFields = nextManualFields(existingByUen.manual_fields, existingByUen, fields);
      ({ error } = await sb.from('late_filing_companies').update({
        company_name, ...fields, updated_at, ...(manualFields ? { manual_fields: manualFields } : {}),
      }).eq('id', existingByUen.id));
    }
  } else {
    const { data: existing, error: lookupError } = await sb
      .from('late_filing_companies')
      .select('id, updated_at, financial_year_end, last_agm_date, last_annual_return_date, next_agm_due_date, remarks, manual_fields')
      .ilike('company_name', company_name)
      .limit(1)
      .maybeSingle();
    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });

    if (!existing) {
      ({ error } = await sb.from('late_filing_companies').insert({ company_name, ...fields, updated_at, manual_fields: nextManualFields(null, null, fields) ?? {} }));
    } else if (previousUpdatedAt && existing.updated_at !== previousUpdatedAt) {
      conflict = true;
    } else {
      const manualFields = nextManualFields(existing.manual_fields, existing, fields);
      ({ error } = await sb.from('late_filing_companies').update({
        company_name, ...fields, updated_at, ...(manualFields ? { manual_fields: manualFields } : {}),
      }).eq('id', existing.id));
    }
  }

  if (conflict) {
    const { data: current } = uen
      ? await sb.from('late_filing_companies').select('*').eq('uen', uen).maybeSingle()
      : await sb.from('late_filing_companies').select('*').ilike('company_name', company_name).limit(1).maybeSingle();
    return NextResponse.json({ error: 'conflict', current: current ?? null }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── DELETE — remove manual entry ─────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { uen } = await req.json();
  if (!uen) return NextResponse.json({ error: 'uen required' }, { status: 400 });
  const sb = createAdminClient();
  const { error } = await sb.from('late_filing_companies').delete().eq('uen', uen);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
