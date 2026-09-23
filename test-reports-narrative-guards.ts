// lib/reports-narrative.ts's validateNarrative() — Reports V3 Phase 1's
// deterministic guard against a bad AI analysis reaching production.
// Pins Vincent's own 4 approved test cases (A-D) plus metricRefs integrity
// checks against the real lib/metric-catalogue.ts.
//
// Run: npx tsx test-reports-narrative-guards.ts
import { validateNarrative, type ReportsNarrative, type ReportsInsight } from './lib/reports-narrative';
import type { ReportsData } from './app/api/reports/route';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
};

function baseInsight(overrides: Partial<ReportsInsight>): ReportsInsight {
  return {
    signal: 'watch', confidence: 'medium',
    titleZh: '测试', titleEn: 'Test',
    observedZh: '测试事实', observedEn: 'Test fact',
    metricRefs: [],
    driverZh: null, driverEn: null,
    notYetProvenZh: [], notYetProvenEn: [],
    nextActionZh: '测试行动', nextActionEn: 'Test action',
    ...overrides,
  };
}
function narrative(insights: ReportsInsight[]): ReportsNarrative {
  return { insights, summaryZh: '范围说明', summaryEn: 'Scope note' };
}
function dataWithComparable(comparable: boolean): ReportsData {
  return {
    revenue: { comparableYoy: { comparable, comparabilityReason: comparable ? 'ok' : 'not comparable' } },
  } as unknown as ReportsData;
}

console.log('--- Vincent\'s approved test cases (A-D) ---');

// A. warning signal + low confidence must be valid
{
  const n = narrative([baseInsight({ signal: 'warning', confidence: 'low', metricRefs: ['active_clients'] })]);
  const result = validateNarrative(n, dataWithComparable(true));
  check('A: warning + low confidence is valid on its own', result.valid);
}

// B. No evidence for causal driver must allow driver=null
{
  const n = narrative([baseInsight({ driverZh: null, driverEn: null, metricRefs: ['active_clients'] })]);
  const result = validateNarrative(n, dataWithComparable(true));
  check('B: driver=null is valid, never forced to invent one', result.valid);
}

// C. comparable=false but insight contains an unrelated percentage (e.g.
//    service penetration, not revenue_yoy) must pass
{
  const n = narrative([baseInsight({ observedZh: 'Tax 使用率 49.8%', observedEn: 'Tax usage 49.8%', metricRefs: ['service_mix'] })]);
  const result = validateNarrative(n, dataWithComparable(false));
  check('C: unrelated percentage (service_mix) is NOT rejected just because comparableYoy.comparable=false', result.valid);
}

// D. Insight cites revenue_yoy while comparable=false must fail
{
  const n = narrative([baseInsight({ metricRefs: ['revenue_yoy'] })]);
  const result = validateNarrative(n, dataWithComparable(false));
  check('D: citing revenue_yoy while comparable=false FAILS validation', !result.valid);
  check('D: failure reason names the actual problem', result.errors.some(e => /revenue_yoy/.test(e) && /comparable/i.test(e)));
}

console.log('\n--- metricRefs integrity (own additions) ---');

{
  const n = narrative([baseInsight({ metricRefs: ['revenue_yoy'] })]);
  const result = validateNarrative(n, dataWithComparable(true));
  check('revenue_yoy cited while comparable=true is valid', result.valid);
}
{
  const n = narrative([baseInsight({ metricRefs: ['this_metric_does_not_exist'] })]);
  const result = validateNarrative(n, dataWithComparable(true));
  check('citing a non-existent metricId fails validation', !result.valid);
}
{
  const n = narrative([baseInsight({ metricRefs: ['grr'] })]); // grr is status:'planned' in the real catalogue
  const result = validateNarrative(n, dataWithComparable(true));
  check('citing a PLANNED (not-yet-built) metric fails validation', !result.valid);
  check('failure reason says PLANNED', result.errors.some(e => /PLANNED/.test(e)));
}
{
  const n = narrative([baseInsight({ metricRefs: ['invoice_count_yoy'] })]);
  const result = validateNarrative(n, dataWithComparable(false));
  check('invoice_count_yoy also blocked by comparable=false (not just revenue_yoy)', !result.valid);
}
{
  // A real, valid multi-insight narrative with mixed metricRefs — must
  // still pass as a whole when every individual insight is fine.
  const n = narrative([
    baseInsight({ metricRefs: ['active_clients', 'new_clients_this_year'] }),
    baseInsight({ metricRefs: ['service_mix'], observedZh: 'Tax 49.8%' }),
  ]);
  const result = validateNarrative(n, dataWithComparable(false));
  check('a multi-insight narrative with no revenue_yoy citations passes even when comparable=false', result.valid);
}

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
