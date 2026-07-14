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
  const { data: row, error: readErr } = await supabase
    .from('companies').select('services_manual').eq('id', companyId).single();
  if (readErr) {
    const hint = /services_manual/.test(readErr.message)
      ? ' — run scripts/add-services-manual-override.sql in the Supabase SQL editor first'
      : '';
    return NextResponse.json({ error: readErr.message + hint }, { status: 500 });
  }

  const manual: Record<string, boolean> = { ...(row?.services_manual as Record<string, boolean> ?? {}) };
  if (value === null) delete manual[service];
  else manual[service] = value;

  const { error: upErr } = await supabase.from('companies').update({ services_manual: manual }).eq('id', companyId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, servicesManual: manual });
}
