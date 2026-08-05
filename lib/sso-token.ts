import { createHmac } from 'crypto';

// Short-lived signed handoff token so a user already logged into this app
// doesn't have to go through Google OAuth again on a linked internal tool
// (e.g. Proposal Generator) that lives on a different Vercel domain and
// therefore can't share a session cookie with this one. The receiving app
// must still re-verify the email against its own approved-accounts list
// rather than trusting this blindly, same "never trust, always re-check"
// posture CRON_SECRET/webhook signatures already use elsewhere in this
// codebase.
//
// Format is `email:exp:signature` (plain colon-joined fields, hex HMAC) to
// match what tassure-proposal-generator's /api/sso already parses — not a
// base64url/JSON scheme of this app's own invention.
//
// 180s, not the original 60s: while this handoff was being debugged
// cross-repo, a real click-through (redirect chain + serverless cold
// starts + a human reading a screenshot in between) sometimes outlasted
// 60s, surfacing as an "expired" failure indistinguishable from whatever
// the actual bug of the moment was. A generous TTL costs nothing here —
// the token is single-purpose (just an email + expiry, HMAC-signed) and
// the receiving app is expected to re-verify the email against its own
// approved-accounts list regardless of how fresh the token is.
const TOKEN_TTL_SECONDS = 180;

export function signSsoToken(email: string): string {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw new Error('SSO_SHARED_SECRET is not configured.');
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${email}:${exp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${signature}`;
}
