const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const INTERNAL_DOMAINS = new Set(['tassure.com', 'tasure.com']);
const EXCLUDED_INTERNAL_EMAILS = new Set(['cindyzhang@tassure.com']);
const ALWAYS_CC_EMAIL = 'hoechyi@tassure.com';
const KAHYE_EMAIL = 'kahye@tassure.com';
const SENGXIN_EMAIL = 'sengxin@tassure.com';

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const candidates = decodeHtml(raw).split(/[\s,;]+/);
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const candidate of candidates) {
    const email = candidate.trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function isTassureEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return INTERNAL_DOMAINS.has(domain);
}

/**
 * Campaign Centre's one canonical recipient policy, shared by AR, SOA and
 * Document Reminder campaigns.
 *
 * - customer/external addresses -> To
 * - Tassure addresses -> CC
 * - cindyzhang@tassure.com is excluded
 * - hoechyi@tassure.com is always CC'd
 * - when kahye@tassure.com is present, sengxin@tassure.com is excluded
 */
export function applyCampaignRecipientRules(rawEmails: Iterable<string>) {
  const emails = parseEmailList([...rawEmails].join('\n'));
  const toEmails = emails.filter(email => !isTassureEmail(email));
  const ccSet = new Set(
    emails.filter(email => isTassureEmail(email) && !EXCLUDED_INTERNAL_EMAILS.has(email)),
  );

  ccSet.add(ALWAYS_CC_EMAIL);
  if (ccSet.has(KAHYE_EMAIL)) ccSet.delete(SENGXIN_EMAIL);

  return {
    toEmails: [...toEmails].sort(),
    ccEmails: [...ccSet].sort(),
  };
}

export function recipientLines(emails: readonly string[] | null | undefined): string | null {
  return emails?.length ? emails.join('\n') : null;
}

export function normalizeRecipientLines(raw: string | null | undefined): string {
  return parseEmailList(raw).join('\n');
}
