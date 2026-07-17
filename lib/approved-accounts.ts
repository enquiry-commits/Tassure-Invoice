export type ApprovedAccount = {
  name: string;
  email: string;
  qbLocations?: Partial<Record<'TAB' | 'TAC', string>>;
};

export const APPROVED_ACCOUNTS: readonly ApprovedAccount[] = [
  { name: 'Vincent Seow', email: 'vincent@tassure.com' },
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com' },
  { name: 'Samuell Ng', email: 'samuell@tassure.com' },
  { name: 'Lim Hoe Chyi', email: 'hoechyi@tassure.com', qbLocations: { TAB: 'Lim Hoe Chyi', TAC: 'Lim Hoe Chyi' } },
  { name: 'Hoo Seng Xin', email: 'sengxin@tassure.com', qbLocations: { TAB: 'Hoo Seng Xin', TAC: 'Seng Xin' } },
  { name: 'Jenny Lai', email: 'jennylai@tassure.com', qbLocations: { TAB: 'Jenny Lai', TAC: 'Jenny Lai' } },
  { name: 'Chin Kah Ye', email: 'kahye@tassure.com', qbLocations: { TAB: 'Chin Kah Ye', TAC: 'Kah Ye' } },
  { name: 'Ang Shi Ming', email: 'shiming@tassure.com', qbLocations: { TAB: 'Ang Shi Ming', TAC: 'Shi Ming' } },
  { name: 'Tey Shemin', email: 'shemin@tassure.com', qbLocations: { TAB: 'Tey Shemin', TAC: 'Shemin' } },
  { name: 'Tan Min Quan', email: 'minquan@tassure.com' },
  { name: 'Esther Loo', email: 'esther@tassure.com', qbLocations: { TAB: 'Esther Loo', TAC: 'Esther Loo' } },
  { name: 'Chelsea Ang', email: 'chelsea@tassure.com' },
] as const;

const ACCOUNT_BY_EMAIL = new Map(
  APPROVED_ACCOUNTS.map(account => [account.email.toLowerCase(), account]),
);

export function getApprovedAccount(email: string | null | undefined): ApprovedAccount | null {
  return ACCOUNT_BY_EMAIL.get(String(email ?? '').trim().toLowerCase()) ?? null;
}
