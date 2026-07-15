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
  CD: 'Chen De', DLQ: 'Dai Liqing', HSY: 'Han Songyang', LJW: 'Li Jianwei', LXM: 'Liu Xiaomei',
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

// ─────────────────────────────────────────────────────────────────────────────
// Full billable catalog — every real client-facing QB Product/Service item seen
// in history (99 distinct items curated down to the ~50 that are actual client
// charges; excludes Deferred Revenue / Discount / Contra / inter-company /
// staff-expense / rental / "DO NOT USE" accounting artifacts). Used to let staff
// add any line to a draft, matching how real invoices vary. Rate = typical
// (median) so it pre-fills sensibly; staff can always edit.
// ─────────────────────────────────────────────────────────────────────────────
export type CatalogItem = { item: string; label: string; category: string; rate: number; service: string };

export const QB_CATALOG: CatalogItem[] = [
  // ── Corporate secretarial (recurring + ad-hoc) ──
  { item: 'Secretary:Corporate Secretarial Services', label: 'Corporate Secretarial Services (annual)', category: 'Secretarial', rate: 466.67, service: 'Secretary' },
  { item: 'Secretary:Registered Address Services',     label: 'Registered Address Services (annual)',    category: 'Secretarial', rate: 250,    service: 'Address' },
  { item: 'Secretary:Company XBRL Services',           label: 'Company XBRL Services',                   category: 'Secretarial', rate: 800,    service: 'XBRL' },
  { item: 'Secretary:Other Professional Services',     label: 'Other Professional Services',             category: 'Secretarial', rate: 100,    service: 'Secretary' },
  { item: 'Secretary:Company Incorporate Services',    label: 'Company Incorporation Services',          category: 'Secretarial', rate: 585,    service: 'Secretary' },
  { item: 'Secretary:Secretary Fees - Offshore Co.',   label: 'Secretary Fees – Offshore Co.',           category: 'Secretarial', rate: 525,    service: 'Secretary' },
  { item: 'Secretary:Strike Off Services',             label: 'Strike Off Services',                     category: 'Secretarial', rate: 500,    service: 'Secretary' },
  { item: 'Secretary:Bank Acc Opening Support',        label: 'Bank Account Opening Support',            category: 'Secretarial', rate: 1000,   service: 'Secretary' },
  { item: 'Secretary:CPF Submission Services',         label: 'CPF Submission Services',                 category: 'Secretarial', rate: 350,    service: 'Secretary' },
  { item: 'Secretary:Payroll Package Services',        label: 'Payroll Package Services',                category: 'Secretarial', rate: 300,    service: 'Secretary' },
  { item: 'Secretary:Pass Application Services',       label: 'Pass Application Services (EP/work pass)', category: 'Secretarial', rate: 200,    service: 'Secretary' },
  // ── Share / director / company changes ──
  { item: 'Secretary:Shares Transfer',                 label: 'Shares Transfer',                         category: 'Changes', rate: 300, service: 'Secretary' },
  { item: 'Secretary:Shares Allotment',                label: 'Shares Allotment',                        category: 'Changes', rate: 200, service: 'Secretary' },
  { item: 'Secretary:Change of Director',              label: 'Change of Director',                      category: 'Changes', rate: 100, service: 'Secretary' },
  { item: 'Secretary:Appointment of directors',        label: 'Appointment of Directors',                category: 'Changes', rate: 50,  service: 'Secretary' },
  { item: 'Secretary:Resignation of directors',        label: 'Resignation of Directors',                category: 'Changes', rate: 50,  service: 'Secretary' },
  { item: 'Secretary:Change of Company Name',          label: 'Change of Company Name',                  category: 'Changes', rate: 200, service: 'Secretary' },
  { item: 'Secretary:Interim Dividend Services',       label: 'Interim Dividend Services',               category: 'Changes', rate: 100, service: 'Secretary' },
  // ── Nominee director (per nominee) + related ──
  { item: 'Secretary:Nominee Director Fees - NLK', label: 'Nominee Director Fees – Ng Lay Kian',   category: 'Nominee', rate: 3000, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - WW',  label: 'Nominee Director Fees – Wang Wei',       category: 'Nominee', rate: 2750, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - ZY',  label: 'Nominee Director Fees – Zhang Yan',      category: 'Nominee', rate: 2250, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - ZD',  label: 'Nominee Director Fees – Zhang Dan',      category: 'Nominee', rate: 3000, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - CD',  label: 'Nominee Director Fees – Chen De',        category: 'Nominee', rate: 2000, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - DLQ', label: 'Nominee Director Fees – Dai Liqing',     category: 'Nominee', rate: 1333.33, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - LXM', label: 'Nominee Director Fees – Liu Xiaomei',    category: 'Nominee', rate: 2666.7, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - NKH', label: 'Nominee Director Fees – Ng Keong Huat',  category: 'Nominee', rate: 2500, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - HSY', label: 'Nominee Director Fees – Han Songyang',   category: 'Nominee', rate: 3000, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - WYD', label: 'Nominee Director Fees – Wang Yidong',    category: 'Nominee', rate: 1500, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - WKX', label: 'Nominee Director Fees – Wee Kai Xin',    category: 'Nominee', rate: 4666.67, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - JT',  label: 'Nominee Director Fees – Tay Yong Chiat', category: 'Nominee', rate: 2250, service: 'ND' },
  { item: 'Secretary:Nominee Director Fees - LJW', label: 'Nominee Director Fees – Li Jianwei',     category: 'Nominee', rate: 1500, service: 'ND' },
  { item: 'Secretary:Nominee Director Deposit',    label: 'Nominee Director Deposit',                category: 'Nominee', rate: 3000, service: 'ND' },
  { item: 'Secretary:Nominee Shareholder Fees',    label: 'Nominee Shareholder Fees',                category: 'Nominee', rate: 2500, service: 'Secretary' },
  // ── Small statutory items ──
  { item: 'Secretary:CTC',                        label: 'Certified True Copy (CTC)',                category: 'Statutory', rate: 50,  service: 'Secretary' },
  { item: 'Secretary:RORC Services',              label: 'RORC Services (register of controllers)',  category: 'Statutory', rate: 50,  service: 'Secretary' },
  { item: 'Secretary:Common Seal & Company Stamp', label: 'Common Seal & Company Stamp',             category: 'Statutory', rate: 40,  service: 'Secretary' },
  { item: 'Secretary:Corppass registration',      label: 'Corppass Registration',                    category: 'Statutory', rate: 50,  service: 'Secretary' },
  { item: 'Secretary:Admin Fee',                  label: 'Admin Fee',                                category: 'Statutory', rate: 200, service: 'Secretary' },
  { item: 'Secretary:LOC application',            label: 'LOC Application',                          category: 'Statutory', rate: 200, service: 'Secretary' },
  { item: 'Secretary:Legalisation Services',      label: 'Legalisation Services',                    category: 'Statutory', rate: 550, service: 'Secretary' },
  { item: 'Secretary:Documents translation',      label: 'Documents Translation',                    category: 'Statutory', rate: 250, service: 'Secretary' },
  { item: 'Secretary:Named Secretary/Agent Fees', label: 'Named Secretary / Agent Fees',             category: 'Statutory', rate: 200, service: 'Secretary' },
  { item: 'Secretary:Named Auditor',              label: 'Named Auditor',                            category: 'Statutory', rate: 1000, service: 'Secretary' },
  // ── Accounts & tax ──
  { item: 'Accounts:Yearly Accounts Services',    label: 'Yearly Accounts Services',                 category: 'Accounts & Tax', rate: 600, service: 'Accounts' },
  { item: 'Accounts:Compilation Services',        label: 'Compilation Services',                     category: 'Accounts & Tax', rate: 550, service: 'Accounts' },
  { item: 'Accounts:Monthly Accounts Services',   label: 'Monthly Accounts Services',                category: 'Accounts & Tax', rate: 300, service: 'Accounts' },
  { item: 'Tax:Corporate Tax Services',           label: 'Corporate Tax Services',                   category: 'Accounts & Tax', rate: 500, service: 'Tax' },
  { item: 'Tax:Application for waiver of income tax', label: 'Application for Waiver of Income Tax',  category: 'Accounts & Tax', rate: 500, service: 'Tax' },
  { item: 'Tax:Other Tax Services',               label: 'Other Tax Services',                       category: 'Accounts & Tax', rate: 300, service: 'Tax' },
  { item: 'Tax:Personal Income Tax Services',     label: 'Personal Income Tax Services',             category: 'Accounts & Tax', rate: 620, service: 'Tax' },
  // ── Disbursements (government fees & reimbursements) ──
  { item: 'Disbursement:Government fee for filing Annual Return', label: 'ACRA Govt Fee – Annual Return', category: 'Disbursements', rate: 60,  service: 'AR' },
  { item: 'Disbursement:Bizfile',                 label: 'Bizfile',                                  category: 'Disbursements', rate: 5.5, service: 'Other' },
  { item: 'Disbursement:Government Fee (Other)',   label: 'Government Fee (Other)',                  category: 'Disbursements', rate: 400, service: 'Other' },
  { item: 'Disbursement:Extension of time for AGM & AR', label: 'Extension of Time (AGM & AR)',       category: 'Disbursements', rate: 400, service: 'Other' },
  { item: 'Disbursement:Late lodgement penalty',   label: 'Late Lodgement Penalty',                  category: 'Disbursements', rate: 1200, service: 'Other' },
  { item: 'Disbursement:Composition amount',       label: 'Composition Amount',                      category: 'Disbursements', rate: 600, service: 'Other' },
  { item: 'Disbursement:Purchase of Certificate of Incorporation', label: 'Certificate of Incorporation', category: 'Disbursements', rate: 50, service: 'Other' },
  { item: 'Disbursement:Purchase of Certificate of Good Standing', label: 'Certificate of Good Standing', category: 'Disbursements', rate: 11, service: 'Other' },
  { item: 'Disbursement:Other Receivables - Stamp Duty', label: 'Stamp Duty',                        category: 'Disbursements', rate: 0,   service: 'Other' },
  { item: 'Disbursement:Reimbursement - OPE',     label: 'Reimbursement – OPE',                      category: 'Disbursements', rate: 50,  service: 'Other' },
  { item: 'Disbursement:Couriers & Postage',      label: 'Couriers & Postage',                       category: 'Disbursements', rate: 12.5, service: 'Other' },
];

// FYE month name + a reference date → "31.12.2025" style used in AR/XBRL lines.
const MONTH_NUM: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
export function fyeDateString(fyeMonth: string | null, year: number): string {
  if (!fyeMonth) return '';
  const m = MONTH_NUM[fyeMonth.trim().toLowerCase()];
  if (!m) return '';
  const lastDay = new Date(year, m, 0).getDate();
  return `${String(lastDay).padStart(2, '0')}.${String(m).padStart(2, '0')}.${year}`;
}
