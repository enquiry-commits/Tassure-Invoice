const TEAMWORK_PIC_NAMES: Record<string, string> = {
  '9': 'Kah Ye Chin',
  '10': 'Hoe Chyi Lim',
  '11': 'Shi Ming Ang',
  '12': 'Seng Xin Hoo',
  '15': 'Vincent Seow',
  '19': 'Jenny Lai',
  '20': 'Chelsea Ang',
  '40': 'Min Quan Tan',
  '41': 'Shemin Tey',
};

export function resolveTeamworkPic(value: unknown): string {
  const pic = String(value ?? '').trim();
  // Unknown numeric IDs are integration metadata, not user-facing PIC names.
  // Keep them blank until the staff mapping is verified instead of leaking a
  // number back into AR Reminder or Companies.
  return TEAMWORK_PIC_NAMES[pic] ?? (/^\d+$/.test(pic) ? '' : pic);
}
