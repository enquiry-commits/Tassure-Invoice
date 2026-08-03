import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { signSsoToken } from '@/lib/sso-token';

// Not under /api/ on purpose — proxy.ts sends an unauthenticated hit on a
// non-API path to /login (nice redirect), where an /api/ path would get a
// bare 401 JSON response instead. This route is only ever reached by
// clicking the Sidebar link in a real browser, never fetched programmatically.
const PROPOSAL_GENERATOR_URL = 'https://tassure-proposal-generator.vercel.app';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.redirect(new URL('/login', req.url));

  const token = signSsoToken(account.email);
  return NextResponse.redirect(`${PROPOSAL_GENERATOR_URL}/api/sso?token=${encodeURIComponent(token)}`);
}
