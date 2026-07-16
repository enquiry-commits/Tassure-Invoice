export type ApprovedAccount = {
  name: string;
  email: string;
};

export const APPROVED_ACCOUNTS: readonly ApprovedAccount[] = [
  { name: 'Vincent Seow', email: 'vincent@tassure.com' },
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com' },
  { name: 'Samuell Ng', email: 'samuell@tassure.com' },
  { name: 'Lim Hoe Chyi', email: 'hoechyi@tassure.com' },
  { name: 'Hoo Seng Xin', email: 'sengxin@tassure.com' },
  { name: 'Jenny Lai', email: 'jennylai@tassure.com' },
  { name: 'Chin Kah Ye', email: 'kahye@tassure.com' },
  { name: 'Ang Shi Ming', email: 'shiming@tassure.com' },
  { name: 'Tey Shemin', email: 'shemin@tassure.com' },
  { name: 'Tan Min Quan', email: 'minquan@tassure.com' },
  { name: 'Esther Loo', email: 'esther@tassure.com' },
] as const;

const ACCOUNT_BY_EMAIL = new Map(
  APPROVED_ACCOUNTS.map(account => [account.email.toLowerCase(), account]),
);

export function getApprovedAccount(email: string | null | undefined): ApprovedAccount | null {
  return ACCOUNT_BY_EMAIL.get(String(email ?? '').trim().toLowerCase()) ?? null;
}
