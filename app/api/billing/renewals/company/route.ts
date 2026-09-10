import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { isWithinRestriction } from '@/lib/approved-accounts';
import { computeAllCompanyBilling, type CompanyBilling } from '@/app/api/billing/renewals/route';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';

/**
 * ONE company's real CompanyBilling row (2026-09-10).
 *
 * Exists so the chat assistant can open the REAL Billing Drafts editor
 * (components/billing/ExpandedBillingRow.tsx) in a modal without pulling
 * the whole ~900-company /api/billing/renewals payload into a chat bubble.
 * The Billing page legitimately fetches all of them — it is a list; a
 * single-company modal is not.
 *
 * Resolution is deliberately the SAME two-step the Billing page and
 * lib/billing-lookup.ts already use — exact normalize() match, then fuzzy
 * findUniqueBestMatch() — so the row this hands the editor is the row the
 * page itself would have expanded. It re-runs computeAllCompanyBilling()
 * rather than trusting anything the caller supplies, for the same reason
 * the .xlsx export re-runs its query (INV-DATA-034): the request originates
 * from an LLM turn.
 *
 * Read-only. Nothing here reserves an invoice number or writes anything —
 * see INV-QB-006 on why a speculative reservation would be harmful.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  // Same gate the assistant's own invoice tools apply: a restricted
  // (AR-Reminder-only) account has no Billing Drafts access, so it must not
  // reach the draft editor through chat either.
  if (account.restrictedTo && !isWithinRestriction(account.restrictedTo, '/billing', new URLSearchParams({ tab: 'billing' }))) {
    return NextResponse.json({ error: 'Your account does not have access to Billing Drafts.' }, { status: 403 });
  }

  const name = (req.nextUrl.searchParams.get('name') ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A company name is required.' }, { status: 400 });
  const within = parseInt(req.nextUrl.searchParams.get('within') ?? '90', 10);

  try {
    const { results } = await computeAllCompanyBilling(Number.isFinite(within) ? within : 90);
    const byName = new Map<string, CompanyBilling>();
    for (const r of results) byName.set(normalize(r.companyName), r);

    const exact = byName.get(normalize(name));
    const company = exact ?? findUniqueBestMatch(name, [...byName.entries()], entry => entry[0], 70).value?.[1] ?? null;
    if (!company) return NextResponse.json({ error: `No Billing Drafts row found for "${name}".` }, { status: 404 });

    return NextResponse.json({ company });
  } catch (err) {
    console.error('[billing/renewals/company] failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
