import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getValidToken } from '@/lib/quickbooks';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';
import {
  fetchTaoServiceCatalog, createTaoService,
  TAO_CATEGORY_ITEM_ID, type TaoServiceCategory, type NewTaoServiceIncomeAccount,
} from '@/lib/tao-services';

// GET /api/billing/tao/services — TAO's live QuickBooks service catalog
// (replaces the old hardcoded TAO_PRODUCTS list — see lib/tao-services.ts's
// own header for why). POST creates a new one, open to any approved
// account (Vincent: "可以开放给全部人，不需要指定的人").
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

  try {
    const catalog = await fetchTaoServiceCatalog('TAO');
    return NextResponse.json({ categories: catalog });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'QuickBooks TAO service list could not be read.' }, { status: 502 });
  }
}

const VALID_CATEGORIES = new Set(Object.keys(TAO_CATEGORY_ITEM_ID));

export async function POST(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    category?: string; name?: string; unitPrice?: number | null; description?: string | null;
    incomeAccount?: NewTaoServiceIncomeAccount;
  };
  if (!body.category || !VALID_CATEGORIES.has(body.category)) {
    return NextResponse.json({ error: `category must be one of ${[...VALID_CATEGORIES].join(', ')}` }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'A service name is required.' }, { status: 400 });
  if (!body.incomeAccount || (body.incomeAccount.mode !== 'existing' && body.incomeAccount.mode !== 'new')) {
    return NextResponse.json({ error: 'incomeAccount is required (mode: "existing" or "new").' }, { status: 400 });
  }
  if (body.incomeAccount.mode === 'existing' && !body.incomeAccount.accountId) {
    return NextResponse.json({ error: 'incomeAccount.accountId is required for mode "existing".' }, { status: 400 });
  }
  if (body.incomeAccount.mode === 'new' && !body.incomeAccount.parentAccountId) {
    return NextResponse.json({ error: 'incomeAccount.parentAccountId is required for mode "new".' }, { status: 400 });
  }
  if (body.unitPrice !== undefined && body.unitPrice !== null && (!Number.isFinite(body.unitPrice) || body.unitPrice < 0)) {
    return NextResponse.json({ error: 'unitPrice must be a non-negative number.' }, { status: 400 });
  }

  const tokenRow = await getValidToken('TAO');
  if (!tokenRow) return NextResponse.json({ error: 'QuickBooks TAO not connected' }, { status: 503 });

  const result = await createTaoService(tokenRow.access_token, tokenRow.realm_id, {
    category: body.category as TaoServiceCategory,
    name,
    unitPrice: body.unitPrice ?? null,
    description: body.description ?? null,
    incomeAccount: body.incomeAccount,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ item: result.item });
}
