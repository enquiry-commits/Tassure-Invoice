import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { fetchTaoTopLevelIncomeAccounts, SUGGESTED_PARENT_ACCOUNT_BY_CATEGORY } from '@/lib/tao-services';

// GET /api/billing/tao/income-accounts — every real top-level TAO Income
// account, for the "Add New Service" modal's account picker (reuse an
// existing one, or nest a new one under one of these — see
// lib/tao-services.ts's own header for why there is no single blanket
// default parent).
export async function GET(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  if (!getApprovedAccount(authData.user?.email)) {
    return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  }

  const accounts = await fetchTaoTopLevelIncomeAccounts('TAO');
  return NextResponse.json({ accounts, suggestedByCategory: SUGGESTED_PARENT_ACCOUNT_BY_CATEGORY });
}
