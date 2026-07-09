// ─────────────────────────────────────────────────────────────────────────────
// Invoice templates — reverse-engineered from Tassure's real QuickBooks history
// (7,920 line items, 1,518 invoices). These make auto-drafts match how invoices
// are actually written in QB: the exact Product/Service item, the standard line
// description wording, and the typical rate.
// ─────────────────────────────────────────────────────────────────────────────

// Exact QB Product/Service item name per billable service (must match QB so the
// invoice line posts to the correct account with the right defaults).
export const QB_ITEM: Record<string, string> = {
  Secretary: 'Secretary:Corporate Secretarial Services',   // annual retainer, median S$525 (n=328)
  Address:   'Secretary:Registered Address Services',       // annual, median S$250 (n=154)
  XBRL:      'Secretary:Company XBRL Services',              // median S$800
  AR:        'Disbursement:Government fee for filing Annual Return', // fixed S$60 ACRA fee
  Accounts:  'Accounts:Yearly Accounts Services',           // median S$600
  Tax:       'Tax:Corporate Tax Services',                  // median S$500
  ND:        'Secretary:Nominee Director Fees',             // + " - <initials>" per nominee
};

// Typical rate fallback when the company has no prior invoice of that service.
export const MEDIAN_RATE: Record<string, number> = {
  Secretary: 525, Address: 250, XBRL: 800, AR: 60, Accounts: 600, Tax: 500, ND: 2500,
};

// Nominee-director initials → full name (QB items are "Nominee Director Fees - XX").
export const ND_INITIALS: Record<string, string> = {
  CD: 'Chen De', HSY: 'Han Songyang', LJW: 'Li Jianwei', LXM: 'Liu Xiaomei',
  NLK: 'Ng Lay Kian', NKH: 'Ng Keong Huat', WKX: 'Punnataro Wee Kai Xin',
  WW: 'Wang Wei', WYD: 'Wang Yidong', ZD: 'Zhang Dan', ZY: 'Zhang Yan', JT: 'Tay Yong Chiat',
};
export const NAME_TO_INITIALS: Record<string, string> = Object.fromEntries(
  Object.entries(ND_INITIALS).map(([i, n]) => [n.toUpperCase(), i]),
);

// The full standard secretarial-retainer description block, verbatim from QB.
export function secretaryDescription(periodLabel: string): string {
  const period = periodLabel ? `Perform secretarial services for one-year [from ${periodLabel}]` : 'Perform secretarial services for one-year';
  return `${period}
- Safe custody of statutory records i.e. keeping minute files and statutory registers (e.g. register of shareholders, register of directors and secretaries, register of share transfer, register of charges, background check, due diligence and etc).
- Preparing all documentation in connection with the routine Annual General Meeting ("AGM"), as required by the Singapore Companies Act 1967 (the "Act")
- Drafting of routine resolutions as may be required for company matters such as opening and closing bank account and etc [extra service fees will be incurred for transactions relate to shares and director changes and all EGMs]
- Preparing and submitting electronically to the ACRA, the prescribed Annual Return as required by the Act [not including government fee and XBRL, if required]
- Name as secretary of the Company ACRA bizfile- Important dates Notification and updates if applicable during the year`;
}

export function addressDescription(periodLabel: string): string {
  return periodLabel
    ? `Registered and mailing address services for one year (${periodLabel})`
    : 'Registered and mailing address services for one year';
}

export function arGovtFeeDescription(fyeDate: string): string {
  return `- Government fee for ACRA filing of Annual Return${fyeDate ? ` [FYE ${fyeDate}]` : ''}`;
}

export function xbrlDescription(fyeDate: string): string {
  return `XBRL for the year${fyeDate ? ` (FYE ${fyeDate})` : ''}`;
}

// "2026-04-01" → "Apr 2026"; period range → "Apr 2026 - Mar 2027".
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function monthLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function periodLabel(startIso: string | null, endIso: string | null): string {
  const a = monthLabel(startIso), b = monthLabel(endIso);
  return a && b ? `${a} - ${b}` : '';
}

// FYE month name + a reference date → "31.12.2025" style used in AR/XBRL lines.
const MONTH_NUM: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
export function fyeDateString(fyeMonth: string | null, year: number): string {
  if (!fyeMonth) return '';
  const m = MONTH_NUM[fyeMonth.trim().toLowerCase()];
  if (!m) return '';
  const lastDay = new Date(year, m, 0).getDate();
  return `${String(lastDay).padStart(2, '0')}.${String(m).padStart(2, '0')}.${year}`;
}
