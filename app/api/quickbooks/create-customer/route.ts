import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { createCustomer, findCustomer } from '@/lib/qb-invoice-conventions';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';

const VALID_COMPANIES = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

// POST /api/quickbooks/create-customer — a genuinely new client has no
// QuickBooks Customer record yet, and findCustomer() (used everywhere
// invoices get created) only ever looks one up, never creates one. Staff-
// triggered, one company at a time, minimal (DisplayName only — Vincent's
// call, everything else gets filled in directly in QuickBooks later).
export async function POST(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { company, companyName } = await req.json().catch(() => ({})) as { company?: string; companyName?: string };
  if (!company || !VALID_COMPANIES.has(company as QbCompany)) {
    return NextResponse.json({ error: 'company must be TAB, TAC or TAO' }, { status: 400 });
  }
  const name = companyName?.trim();
  if (!name) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });

  const tokenRow = await getValidToken(company as QbCompany);
  if (!tokenRow) return NextResponse.json({ error: `QuickBooks ${company} not connected` }, { status: 503 });
  const { access_token: token, realm_id: realmId } = tokenRow;

  // One more live check immediately before creating — narrows the window
  // against a customer created moments ago (by this or another request)
  // that a stale page state hasn't picked up yet.
  const existing = await findCustomer(token, realmId, name);
  if (existing) return NextResponse.json({ error: `"${name}" already exists in QuickBooks ${company} (customer #${existing.id}) — refresh and use the existing customer.` }, { status: 409 });

  const result = await createCustomer(token, realmId, name);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ customer: result });
}
