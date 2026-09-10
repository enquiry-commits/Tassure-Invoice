// Renders the REAL ARDetailModal (its ~1225-line closure) against a REAL
// ar_reminder row, shaped exactly as /api/ar-reminder returns it. The build
// only proves types resolve; this proves the component executes — the one
// thing that cannot be click-tested here (production login is Google OAuth).
import { config } from 'dotenv';
config({ path: '.env.local' });
import { renderToStaticMarkup } from 'react-dom/server';
import { createAdminClient } from './lib/supabase';
import { resolveTeamworkPic } from './lib/teamwork-pic';

(async () => {
  const mod = await import('./app/billing/page');
  console.log('ARDetailModal exported:', typeof mod.ARDetailModal === 'function');
  console.log('recomputeArRecord exported:', typeof mod.recomputeArRecord === 'function');

  const sb = createAdminClient();
  const { data } = await sb.from('ar_reminder').select('*')
    .not('prepared_date', 'is', null).limit(1);
  const row = (data ?? [])[0] as Record<string, unknown>;
  if (!row) { console.log('no ar_reminder row to test with'); process.exit(1); }

  const stages = {
    accountsReady: !!row.prepared_date, sentToClient: !!row.sent_date,
    docsReceived: !!row.received_date, agmHeld: !!row.agm_held_date, arFiled: !!row.filling_date,
  };
  const record = {
    ...row,
    pic: resolveTeamworkPic(row.pic as string | null),
    company_id: null,
    services: { ar: true, agm: true, xbrl: false, nd: false, address: true, accounts: false, tax: false, secretary: true },
    servicesAuto: {}, servicesManual: {}, servicePeriods: {},
    invoices: [], tab_invoice_no: null, tac_invoice_no: null,
    stages, stagesDone: Object.values(stages).filter(Boolean).length, daysUntilDue: 30,
  } as unknown as Parameters<typeof mod.ARDetailModal>[0]['r'];

  console.log(`\nreal row: ${row.entity_name} (id ${row.id}, FYE ${row.fye_month} ${row.fye_year})`);
  const html = renderToStaticMarkup(
    <mod.ARDetailModal r={record} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />,
  );
  const checks: [string, boolean][] = [
    ['renders without throwing', html.length > 500],
    ['shows the real company name', html.includes(String(row.entity_name))],
    ['renders the workflow stages', /Report Ready|Sent|AGM|Filed|prepared/i.test(html)],
  ];
  let fail = 0;
  for (const [name, ok] of checks) { console.log((ok ? 'OK   ' : 'FAIL ') + name); if (!ok) fail++; }

  // recomputeArRecord must actually recompute the derived flags
  const edited = mod.recomputeArRecord({ ...record, filling_date: '2026-09-10' } as typeof record);
  const ok = (edited as unknown as { stages: { arFiled: boolean } }).stages.arFiled === true;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'recomputeArRecord flips arFiled after setting filling_date');
  if (!ok) fail++;

  console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
