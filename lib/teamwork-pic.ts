const TEAMWORK_PIC_NAMES: Record<string, string> = {
  '9': 'Kah Ye Chin',
  '10': 'Hoe Chyi Lim',
  '11': 'Shi Ming Ang',
  '12': 'Seng Xin Hoo',
};

export function resolveTeamworkPic(value: unknown): string {
  const pic = String(value ?? '').trim();
  return TEAMWORK_PIC_NAMES[pic] ?? pic;
}
