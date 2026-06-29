/**
 * Parse service period dates from QB invoice item descriptions.
 * Adds period_start, period_end, fye_date to quickbooks_invoice_items.
 *
 * Usage:
 *   node scripts/parse-qb-periods.js            → update Supabase
 *   node scripts/parse-qb-periods.js --dry-run  → preview only, no writes
 *   node scripts/parse-qb-periods.js --test     → run regex tests and exit
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');
const TEST    = process.argv.includes('--test');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ── Month lookup ──────────────────────────────────────────────────────────────
const MONTH_MAP = {
  jan: 1,  feb: 2,  mar: 3,  apr: 4,  may: 5,  jun: 6,
  jul: 7,  aug: 8,  sep: 9,  oct: 10, nov: 11, dec: 12,
};
function monthNum(s) {
  return MONTH_MAP[s.toLowerCase().slice(0, 3)] || null;
}
function lastDay(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-based, this trick works
}
function toISO(year, month, day) {
  const d = day ?? lastDay(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Core regex parser ─────────────────────────────────────────────────────────
const M = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

// All patterns compiled once
const PATTERNS = [
  // A: [from? DD? MMM YYYY - DD? MMM YYYY] or (...)
  //    [from Apr 2026 - Mar 2027], (Apr 2026 - Mar 2027), [from 15 May 2026 - 14 May 2027]
  {
    name: 'range_two_years',
    re: new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[-–]\\s*(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
    parse: m => {
      const [, sm, sy, em, ey] = m;
      const mn1 = monthNum(sm), mn2 = monthNum(em);
      if (!mn1 || !mn2) return null;
      return { start: toISO(+sy, mn1, 1), end: toISO(+ey, mn2, lastDay(+ey, mn2)) };
    },
  },
  // B: [from? MMM YYYY to MMM YYYY] — "to" as separator
  //    [from Oct 2026 to Sep 2027]
  {
    name: 'range_to_separator',
    re: new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s+to\\s+(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
    parse: m => {
      const [, sm, sy, em, ey] = m;
      const mn1 = monthNum(sm), mn2 = monthNum(em);
      if (!mn1 || !mn2) return null;
      return { start: toISO(+sy, mn1, 1), end: toISO(+ey, mn2, lastDay(+ey, mn2)) };
    },
  },
  // C: [from? MMM - MMM YYYY] or (MMM - MMM YYYY) — single year, e.g. Jan - Dec 2026
  //    [from Jan - Dec 2026], ( Jan - Dec 2026), (Jan - Dec 2026)
  {
    name: 'range_single_year',
    re: new RegExp(`[\\[(]\\s*(?:from\\s+)?${M}\\s*-\\s*${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
    parse: m => {
      const [, sm, em, yr] = m;
      const mn1 = monthNum(sm), mn2 = monthNum(em);
      const y = +yr;
      if (!mn1 || !mn2) return null;
      // if start month > end month, wrap around (e.g. Oct - Sep: start is prev year)
      const sy = mn1 > mn2 ? y - 1 : y;
      return { start: toISO(sy, mn1, 1), end: toISO(y, mn2, lastDay(y, mn2)) };
    },
  },
  // D: [from? MMM YYYY MMM YYYY] or (MMM YYYY MMM YYYY) — no dash separator
  //    [from May 2026 Apr 2027], (May 2026 Apr 2027)
  {
    name: 'range_no_separator',
    re: new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s+(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
    parse: m => {
      const [, sm, sy, em, ey] = m;
      const mn1 = monthNum(sm), mn2 = monthNum(em);
      if (!mn1 || !mn2) return null;
      return { start: toISO(+sy, mn1, 1), end: toISO(+ey, mn2, lastDay(+ey, mn2)) };
    },
  },
];

// FYE date patterns (for AR government fee line items)
const FYE_PATTERNS = [
  // [FYE 31.03.2026], [FYE31.12.2025], [FYE  28.02.2026]
  {
    name: 'fye_dmy_dot',
    re: /[[【](?:FYE\s*|YE\s*)(\d{1,2})[.\s](\d{1,2})[.\s](\d{4})[\]】]/i,
    parse: m => ({ fye: toISO(+m[3], +m[2], +m[1]) }),
  },
  // [YE 31 Mar 2026], [FYE 31 Mar 2026]
  {
    name: 'fye_dmonthname',
    re: new RegExp(`[\\[\\u3010](?:FYE\\s*|YE\\s*)(\\d{1,2})\\s+${M}\\s+(\\d{4})[\\]\\u3011]`, 'i'),
    parse: m => {
      const mn = monthNum(m[2]);
      if (!mn) return null;
      return { fye: toISO(+m[3], mn, +m[1]) };
    },
  },
  // Fallback: no bracket but text like "FYE 31.03.2026" anywhere
  {
    name: 'fye_inline',
    re: /FYE\s*(\d{1,2})[.\s](\d{1,2})[.\s](\d{4})/i,
    parse: m => ({ fye: toISO(+m[3], +m[2], +m[1]) }),
  },
];

function parseDescription(raw) {
  if (!raw) return null;

  // Normalise: collapse whitespace, convert Chinese brackets
  const desc = raw
    .replace(/[【［]/g, '[').replace(/[】］]/g, ']')
    .replace(/\s+/g, ' ');

  // Try period patterns
  for (const { re, parse } of PATTERNS) {
    const m = re.exec(desc);
    if (m) {
      const result = parse(m);
      if (result) return result;
    }
  }

  // Try FYE patterns
  for (const { re, parse } of FYE_PATTERNS) {
    const m = re.exec(desc);
    if (m) {
      const result = parse(m);
      if (result) return result;
    }
  }

  return null;
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function runTests() {
  const cases = [
    // Secretary
    { d: 'Perform secretarial services for one-year [from Apr 2026 - Mar 2027]',     expect: { start: '2026-04-01', end: '2027-03-31' } },
    { d: 'Perform secretarial services for one-year [from Apr 2026- Mar 2027]',       expect: { start: '2026-04-01', end: '2027-03-31' } },
    { d: 'Perform secretarial services for one-year [from Apr 2026 - Mar  2027]',     expect: { start: '2026-04-01', end: '2027-03-31' } },
    { d: 'Perform secretarial services for one-year [from  Oct 2026 to Sep 2027 ]',   expect: { start: '2026-10-01', end: '2027-09-30' } },
    { d: 'Perform secretarial services for one-year [from 15 May 2026 - 14 May 2027]',expect: { start: '2026-05-01', end: '2027-05-31' } },
    { d: 'Perform secretarial services for one-year [from  Jan - Dec 2026]',           expect: { start: '2026-01-01', end: '2026-12-31' } },
    { d: 'Perform secretarial services for one-year [from Jun 2026- May 2027]',        expect: { start: '2026-06-01', end: '2027-05-31' } },
    { d: 'Being Secretarial Services one year [April 2025 - March 2026]',              expect: { start: '2025-04-01', end: '2026-03-31' } },
    // Address
    { d: 'Registered and mailing address services for one year (Apr 2026 - Mar 2027)',expect: { start: '2026-04-01', end: '2027-03-31' } },
    { d: 'Registered and mailing address services for one year (May 2026 Apr 2027)',  expect: { start: '2026-05-01', end: '2027-04-30' } },
    { d: 'Perform secretarial services for one-year [from May 2026 Apr 2027]',         expect: { start: '2026-05-01', end: '2027-04-30' } },
    { d: 'Registered and mailing address services for one year ( Jan - Dec 2026)',     expect: { start: '2026-01-01', end: '2026-12-31' } },
    { d: 'Registered and mailing address services for one year (15 May 2026 - 14 May 2027)', expect: { start: '2026-05-01', end: '2027-05-31' } },
    { d: 'Registered and mailing Address service one year [Mar 2026 - Feb 2027]',      expect: { start: '2026-03-01', end: '2027-02-28' } },
    // ND
    { d: 'Nominee director for one year ( Sep 2025 - Aug 2026)',                       expect: { start: '2025-09-01', end: '2026-08-31' } },
    // FYE
    { d: '- Government fee for ACRA filing of Annual Return [FYE 31.03.2026]',         expect: { fye: '2026-03-31' } },
    { d: '- Government fee for ACRA filing of Annual Return [FYE31.12.2025]',          expect: { fye: '2025-12-31' } },
    { d: '- Government fee for ACRA filing of Annual Return [FYE 31.3.2026]',          expect: { fye: '2026-03-31' } },
    { d: '- Government fee of filing Annual Return [YE 31 Mar 2026]',                  expect: { fye: '2026-03-31' } },
    { d: '- Government fee for ACRA filing of Annual Return [31.01.2026]',             expect: null },
    { d: 'Conversion of statutory financial statements to XBRL format [FYE31.3.2026】',expect: { fye: '2026-03-31' } },
  ];

  let pass = 0, fail = 0;
  for (const { d, expect } of cases) {
    const result = parseDescription(d);
    const ok = JSON.stringify(result) === JSON.stringify(expect);
    if (ok) { pass++; process.stdout.write('.'); }
    else {
      fail++;
      console.log(`\n  FAIL: ${d.slice(0, 60)}`);
      console.log(`    Expected: ${JSON.stringify(expect)}`);
      console.log(`    Got:      ${JSON.stringify(result)}`);
    }
  }
  console.log(`\n\nTests: ${pass} pass, ${fail} fail out of ${cases.length}`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Parsing QB invoice item descriptions for service periods…\n`);

  const { data: items, error } = await sb
    .from('quickbooks_invoice_items')
    .select('id, description, service_type')
    .not('description', 'is', null);

  if (error) { console.error('Load error:', error.message); process.exit(1); }
  console.log(`Loaded ${items.length} items with descriptions\n`);

  const toUpdate = [];
  const noMatch  = [];

  for (const item of items) {
    const parsed = parseDescription(item.description);
    if (!parsed) { noMatch.push(item); continue; }

    const update = { id: item.id };
    if (parsed.start) update.period_start = parsed.start;
    if (parsed.end)   update.period_end   = parsed.end;
    if (parsed.fye)   update.fye_date     = parsed.fye;
    toUpdate.push(update);
  }

  console.log(`Parsed:    ${toUpdate.length} items  (period or FYE extracted)`);
  console.log(`No match:  ${noMatch.length} items  (one-off services, incorporation, etc.)\n`);

  // Show distribution
  const withPeriod = toUpdate.filter(u => u.period_start).length;
  const withFye    = toUpdate.filter(u => u.fye_date).length;
  console.log(`  → period_start/end: ${withPeriod} items`);
  console.log(`  → fye_date only:    ${withFye} items\n`);

  // Preview sample
  console.log('Sample extracted periods:');
  toUpdate.filter(u => u.period_start).slice(0, 5).forEach(u =>
    console.log(`  id=${u.id}  ${u.period_start} → ${u.period_end}`)
  );
  toUpdate.filter(u => u.fye_date).slice(0, 3).forEach(u =>
    console.log(`  id=${u.id}  FYE=${u.fye_date}`)
  );

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No writes. Run without --dry-run to apply.');
    return;
  }

  // Apply updates in batches
  let done = 0;
  const BATCH = 100;
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const batch = toUpdate.slice(i, i + BATCH);
    for (const { id, ...fields } of batch) {
      const { error: e } = await sb.from('quickbooks_invoice_items').update(fields).eq('id', id);
      if (e) console.error(`  ✗ id=${id}: ${e.message}`);
      else done++;
    }
    process.stdout.write(`\r  Updated ${done}/${toUpdate.length}…`);
  }
  console.log(`\n\n✅ Done — ${done} items updated with period/FYE dates`);
}

if (TEST) {
  runTests();
} else {
  run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}
