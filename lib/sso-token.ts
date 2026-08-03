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
const TOKEN_TTL_SECONDS = 60;

export function signSsoToken(email: string): string {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw new Error('SSO_SHARED_SECRET is not configured.');
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${email}:${exp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${signature}`;
}
