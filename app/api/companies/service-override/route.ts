import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// Manual per-service override on a company (see add-services-manual-override.sql).
// PATCH { companyId, service, value }:
//   value true  → force service ON  (badge always shows)
//   value false → force service OFF (badge never shows)
//   value null  → clear override, back to automatic judgement
// Stored on companies.services_manual — written ONLY here, never by any sync,
// so a human decision can never be clobbered by automation.
const OVERRIDABLE = new Set(['secretary', 'accounts', 'tax', 'xbrl']);

export async function PATCH(req: NextRequest) {
  const { companyId, service, value } = await req.json();
  if (!companyId || !service) return NextResponse.json({ error: 'companyId and service required' }, { status: 400 });
  if (!OVERRIDABLE.has(service)) return NextResponse.json({ error: `service must be one of: ${[...OVERRIDABLE].join(', ')} (ND/Address follow TeamWork)` }, { status: 400 });
  if (value !== true && value !== false && value !== null) return NextResponse.json({ error: 'value must be true, false or null' }, { status: 400 });

  const supabase = createAdminClient();
  // set_service_override merges the one key inside a single UPDATE (see
  // scripts/add-service-override-merge-function.sql) — a SELECT-then-merge-
  // then-UPDATE here would lose updates under concurrency: two staff
  // toggling two different services on the same company around the same
  // time could have the second write silently revert the first (it read
  // the object before the first write committed, then overwrote the whole
  // thing). This has no read step, so there's no window for that.
  const { data: manual, error } = await supabase.rpc('set_service_override', {
    p_company_id: companyId, p_service: service, p_value: value,
  });
  if (error) {
    const hint = /set_service_override|services_manual/.test(error.message)
      ? ' — run scripts/add-service-override-merge-function.sql (and add-services-manual-override.sql if not already run) in the Supabase SQL editor first'
      : '';
    return NextResponse.json({ error: error.message + hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true, servicesManual: manual });
}
