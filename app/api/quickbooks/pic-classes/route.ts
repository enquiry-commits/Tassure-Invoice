import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { listActiveClasses } from '@/lib/qb-invoice-conventions';
import { isStaffClassName, matchPicClass } from '@/lib/invoice-pic-class';

// GET /api/quickbooks/pic-classes?company=TAB&pic=<company PIC>
// The options for the Billing Drafts popup's per-line PIC column (Vincent,
// 2026-10-04: "要和QB那样，要有一列是可以选择每个服务的PIC的"): this book's
// active staff Classes, plus which one the company PIC resolves to — the
// default for TAB Secretary/XBRL lines, by the SAME matcher the create route
// uses (lib/invoice-pic-class.ts), so the popup's default is what the server
// would have applied anyway. Read-only.
export async function GET(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const company = req.nextUrl.searchParams.get('company');
  const pic = req.nextUrl.searchParams.get('pic')?.trim() ?? '';
  if (company !== 'TAB' && company !== 'TAC' && company !== 'TAO') {
    return NextResponse.json({ error: 'company must be TAB, TAC or TAO.' }, { status: 400 });
  }

  const tokenRow = await getValidToken(company as QbCompany);
  if (!tokenRow) return NextResponse.json({ error: `QuickBooks ${company} not connected` }, { status: 503 });

  let classes;
  try {
    classes = await listActiveClasses(tokenRow.access_token, tokenRow.realm_id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  const options = classes
    .filter(c => isStaffClassName(c.Name))
    .map(c => ({ value: c.Id, name: c.Name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    company,
    classes: options,
    picDefault: pic ? matchPicClass(classes, pic) : null,
  });
}
