import { createHmac } from 'crypto';

// Short-lived signed handoff token so a user already logged into this app
// doesn't have to go through Google OAuth again on a linked internal tool
// (e.g. Proposal Generator) that lives on a different Vercel domain and
// therefore can't share a session cookie with this one. Payload is
// deliberately minimal (just who + when this was issued) — the receiving
// app must still re-verify the email against its own approved-accounts
// list rather than trusting this blindly, same "never trust, always
// re-check" posture CRON_SECRET/webhook signatures already use elsewhere
// in this codebase.
const TOKEN_TTL_SECONDS = 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signSsoToken(email: string): string {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw new Error('SSO_SHARED_SECRET is not configured.');
  const payload = base64url(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const signature = base64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${signature}`;
}
