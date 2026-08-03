// Tassure staff directory (name -> email), provided directly by Vincent, for
// resolving a PIC value stored on a company/AR record into a real email
// address to CC on client communications, and also into a canonical display
// name (see formatStaffName) so the same person always renders identically
// across Master List / AR Reminder regardless of which abbreviation was
// typed in.
//
// Real-world PIC values are messy — checked the actual distribution in
// ar_reminder.pic/acc_pic/tax_pic before writing this:
//   - Full names in either word order ("Kah Ye Chin" vs the directory's own
//     "Chin Kah Ye" — Chinese-name staff are stored "Given Surname" here but
//     read naturally as "Surname Given").
//   - Given name only ("Shemin", "Vernice", "Hoe Chyi", "Jenny").
//   - Ad hoc initials staff type themselves ("YH", "WE", "JF", "QT", "VY",
//     "CS") — not a derivable formula (compared multiple people's initials
//     and no single consistent rule fit all of them), so these are listed
//     explicitly per person rather than computed.
//   - Occasional raw un-resolved TeamWork numeric ids ("9,11") — resolved via
//     resolveTeamworkPic before matching.
//   - Non-person values ("Client", "dormant", "Waiver", "PAC", "NA",
//     "Superadmin Tassure Asia") — deliberately left unmatched so no CC is
//     added, rather than guessing.
import { resolveTeamworkPic } from './teamwork-pic';
import { titleCase } from './text-case';

interface StaffEntry {
  name: string;
  email: string;
  aliases?: string[];
}

const STAFF_DIRECTORY: StaffEntry[] = [
  // Partners
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com' },
  { name: 'Samuell Ng', email: 'samuellng@tassure.com' },
  { name: 'Tan Yee Soon', email: 'yeesoon@tassure.com', aliases: ['Yee Soon'] },
  { name: 'Leonard Lee', email: 'leonard.lee@tassure.com' },
  { name: 'Teo Siok Fieng', email: 'siokfieng@tassure.com' },
  // Internal
  { name: 'Esther Loo', email: 'esther@tassure.com' },
  { name: 'Chelsea Ang', email: 'chelsea@tassure.com' },
  { name: 'Vincent Seow', email: 'vincent@tassure.com' },
  { name: 'Yuna Lai', email: 'yuna@tassure.com' },
  // Corporate Secretarial
  { name: 'Lim Hoe Chyi', email: 'hoechyi@tassure.com', aliases: ['Hoe Chyi'] },
  { name: 'Hoo Seng Xin', email: 'sengxin@tassure.com', aliases: ['Seng Xin'] },
  { name: 'Jenny Lai', email: 'jennylai@tassure.com', aliases: ['Jenny'] },
  { name: 'Chin Kah Ye', email: 'kahye@tassure.com', aliases: ['Kah Ye'] },
  { name: 'Ang Shi Ming', email: 'shiming@tassure.com', aliases: ['Shi Ming'] },
  // Malaysia Staff
  { name: 'Tey Shemin', email: 'shemin@tassure.com', aliases: ['Shemin'] },
  { name: 'Tan Min Quan', email: 'minquan@tassure.com', aliases: ['Min Quan'] },
  // Audit
  { name: 'Lina Chan', email: 'lina@tassure.com' },
  { name: 'Felicia Chee', email: 'felicia@tassure.com' },
  { name: 'Jane Lee', email: 'jane@tassure.com' },
  { name: 'Chua Xi Qing', email: 'xiqing@tassure.com' },
  { name: 'Yeoh Qing Ching', email: 'qingching@tassure.com' },
  { name: 'Alex Wong', email: 'alex@tassure.com' },
  { name: 'Soh Zhi Kai', email: 'zhikai@tassure.com' },
  { name: 'Alice Wong', email: 'alicewong@tassure.com' },
  { name: 'Ooi Kai Xin', email: 'kaixin.ooi@tassure.com' },
  { name: 'Jason Lee', email: 'chiasheng@tassure.com' },
  // Accounting — YH/WE/JF confirmed against the real spread of ar_reminder.acc_pic values
  { name: 'Lee Jing Fei', email: 'jingfei@tassure.com', aliases: ['JF'] },
  { name: 'Jay Tay', email: 'jaytay@tassure.com', aliases: ['Jay', 'JAY'] },
  { name: 'Tee Yu Heng', email: 'yuheng@tassure.com', aliases: ['YH'] },
  { name: 'Vernice Chai', email: 'vernice@tassure.com', aliases: ['Vernice'] },
  { name: 'Chee Wei En', email: 'weien@tassure.com', aliases: ['WE'] },
  // Tax — QT/VY/CS confirmed against the real spread of ar_reminder.tax_pic values
  { name: 'Clarence Saw', email: 'clarencesaw@tassure.com', aliases: ['CS'] },
  { name: 'Quinnie Tan', email: 'quinnietan@tassure.com', aliases: ['QT'] },
  { name: 'Victoria Yap', email: 'victoriayap@tassure.com', aliases: ['VY'] },
];

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenKey(name: string): string {
  return [...new Set(normalizeName(name).split(' ').filter(Boolean))].sort().join('|');
}

// Direct alias/full-name lookup (exact, case/space-insensitive — initials
// like "QT" must match literally, not as a token set).
const BY_EXACT_NAME = new Map<string, StaffEntry>();
// Full-name lookup where word order doesn't matter (handles "Kah Ye Chin"
// vs "Chin Kah Ye").
const BY_TOKEN_SET = new Map<string, StaffEntry>();

for (const staff of STAFF_DIRECTORY) {
  BY_EXACT_NAME.set(normalizeName(staff.name), staff);
  BY_TOKEN_SET.set(tokenKey(staff.name), staff);
  for (const alias of staff.aliases ?? []) {
    BY_EXACT_NAME.set(normalizeName(alias), staff);
  }
}

function resolveOne(raw: string): StaffEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A stray un-resolved TeamWork numeric id (e.g. "9,11" reaching this
  // function after the outer split) resolves to a real name first.
  const resolved = /^\d+$/.test(trimmed) ? resolveTeamworkPic(trimmed) : trimmed;
  if (!resolved) return null;
  return BY_EXACT_NAME.get(normalizeName(resolved)) ?? BY_TOKEN_SET.get(tokenKey(resolved)) ?? null;
}

/**
 * Resolves a stored PIC value (which may hold multiple names separated by
 * comma/slash/ampersand, e.g. "Kah Ye Chin, Shi Ming Ang" or "JAY / PAC") to
 * the staff email(s) it refers to. Unrecognised or non-person values
 * (initials that don't match, "Client", "dormant", "Waiver", ...) are
 * silently dropped — no CC is added for them, rather than guessing.
 */
export function findStaffEmails(rawValue: string | null | undefined): string[] {
  if (!rawValue) return [];
  const emails: string[] = [];
  for (const part of rawValue.split(/[,/&]/)) {
    const staff = resolveOne(part);
    if (staff && !emails.includes(staff.email)) emails.push(staff.email);
  }
  return emails;
}

/**
 * Resolves a stored PIC-style value into a display-ready name — for Master
 * List / AR Reminder columns (ND, Secretary, ACC/TAX PIC, Contact Window,
 * Add @), so an abbreviation like "JF" or "Kah Ye" always renders the same
 * way everywhere. That consistency is also what keeps a column's filter
 * dropdown from splintering into a dozen casing/abbreviation variants of the
 * same person. A segment not found in the directory (an external contact,
 * a company name, "dormant", ...) falls back to title-casing the original
 * text rather than being dropped — this is for display, not CC resolution,
 * so an unrecognised name must still show up.
 */
export function formatStaffName(rawValue: string | null | undefined): string {
  if (!rawValue) return '';
  const names = rawValue
    .split(/[,/&]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => resolveOne(part)?.name ?? titleCase(part));
  return names.join(', ');
}
