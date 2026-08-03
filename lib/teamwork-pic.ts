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

function resolveOnePic(pic: string): string {
  // Unknown numeric IDs are integration metadata, not user-facing PIC names.
  // Keep them blank until the staff mapping is verified instead of leaking a
  // number back into AR Reminder or Companies.
  return TEAMWORK_PIC_NAMES[pic] ?? (/^\d+$/.test(pic) ? '' : pic);
}

// TeamWork's person_in_charge can hold more than one id for a company (e.g.
// "9,11" for two co-assigned staff) — resolve each id separately and rejoin,
// rather than the single-id lookup silently failing on the combined string
// and leaking the raw ids straight through to Companies/Address Service/AR
// Reminder.
export function resolveTeamworkPic(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return resolveOnePic(raw);
  return raw.split(',').map(part => resolveOnePic(part.trim())).filter(Boolean).join(', ');
}
