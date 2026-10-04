// The Statement memo (QuickBooks PrivateNote — "Message displayed on
// statement": never printed on the invoice itself; it labels the invoice in
// QuickBooks' lists and on customer statements) every invoice this app
// generates gets, written the way staff already write it by hand. Automatic
// and never shown (Vincent, 2026-10-04: "自动就好了，也不需要特地多一个东西
// 显示这个Memo"). Client-safe on purpose.
//
// TAB/TAC renewals — read from the 500 latest invoices per book (2026-10-04):
//   Sec + AR               "Sec (Nov 2026 - Oct 2027),AR 31.7.2026"           (82)
//   Sec + address + AR     "Sec,addrs (Apr 2026 - Mar 2027),AR 31.08.2026"    (69)
//   Sec + AR + XBRL        "Sec (Oct 2026 - Sep 2027),AR,XBRL 31.12.2026"     (15)
//   XBRL only              "XBRL"                                             (40)
//   TAC Nominee Director   "ND (Aug 2026 - Jul 2027)"                         (185)
// Every invoice this app created had its memo typed in afterwards by hand
// (60/60 TAB, 20/20 TAC). Vincent, 2026-10-04: "只做 Statement memo". The
// Billing Drafts popup writes it from the lines being invoiced at Generate.
import { parseInvoicePeriod } from './invoice-period';
import { periodLabel } from './invoice-templates';

export type MemoLine = { service: string; productService?: string; description: string };

// Periodic services staff abbreviate, in the order they write them.
const PERIODIC_CODE: Record<string, string> = { Secretary: 'Sec', Address: 'addrs', ND: 'ND' };

/**
 * The service a line counts as for the memo, or null when staff never
 * mention it. A service billed in advance sits on QuickBooks' "Deferred
 * Revenue - Corp Sec / Reg Addr" item WITH its full description (real:
 * #02611068's only secretarial line) — that counts as the service; the
 * empty deferred twin and any discount do not.
 */
function memoService(l: MemoLine): string | null {
  const item = l.productService ?? '';
  if (l.service === 'Discount' || /discount/i.test(item)) return null;
  if (l.service === 'Deferred' || /^deferred/i.test(item)) {
    if (!l.description.trim()) return null;
    if (/corp\s*sec/i.test(item)) return 'Secretary';
    if (/reg\s*addr|address/i.test(item)) return 'Address';
    if (/\bND\b|nominee/i.test(item)) return 'ND';
    return null;
  }
  return l.service;
}

/** The FYE exactly as the line itself states it ("31.07.2026"), else from its parsed date. */
function fyeOf(line: MemoLine): string | null {
  const stated = line.description.match(/FYE\s*\[?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
  if (stated) return stated[1];
  const iso = parseInvoicePeriod(line.description, line.service)?.fye_date;
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function composeStatementMemo(input: readonly MemoLine[]): string {
  const lines = input.flatMap(l => { const s = memoService(l); return s ? [{ ...l, service: s }] : []; });
  const parts: string[] = [];

  // "Sec,addrs (Nov 2026 - Oct 2027)" — one period: the first periodic line that states one.
  const periodic = Object.keys(PERIODIC_CODE).filter(s => lines.some(l => l.service === s));
  if (periodic.length) {
    let period = '';
    for (const service of periodic) {
      for (const l of lines.filter(x => x.service === service)) {
        const p = parseInvoicePeriod(l.description, l.service);
        if (p?.period_start && p?.period_end) { period = periodLabel(p.period_start, p.period_end); break; }
      }
      if (period) break;
    }
    parts.push(`${periodic.map(s => PERIODIC_CODE[s]).join(',')}${period ? ` (${period})` : ''}`);
  }

  // "AR,XBRL 31.12.2026" — they share the FYE; an XBRL-only invoice is just "XBRL".
  const annual = ['AR', 'XBRL'].filter(s => lines.some(l => l.service === s));
  if (annual.length) {
    if (annual.length === 1 && annual[0] === 'XBRL' && !periodic.length) parts.push('XBRL');
    else {
      const fye = lines.filter(l => annual.includes(l.service)).map(fyeOf).find(Boolean);
      parts.push(`${annual.join(',')}${fye ? ` ${fye}` : ''}`);
    }
  }

  // Anything else (carried Accounts/Tax, one-off items) by its QuickBooks item name, like "bizfile".
  for (const l of lines) {
    if (PERIODIC_CODE[l.service] || annual.includes(l.service)) continue;
    const name = (l.productService?.split(':').pop() ?? '').trim() || l.description.split('\n')[0].trim();
    if (name && !parts.includes(name)) parts.push(name);
  }
  return parts.join(',');
}

// ── TAO (Accounts / Tax) ─────────────────────────────────────────────────
// Every TAO invoice since Jan 2026 carries a memo staff typed by hand
// (784/784), but their wording varies far more than TAB/TAC's — "Quarterly
// acc", "quarterly account & GST" and "Quarterly accounting services" for
// the same item — so the client's LAST memo can't simply be reused (right on
// 36 of 112 repeat invoices even when the items were identical, 0 of 214
// when they changed). Instead each service is written in the wording staff
// use most for it, in the order they always list them (accounts, then the
// report, then tax: 260/260 multi-service memos), with the YA exactly as the
// line states it. Checked on the 784 real memos: the same YA staff wrote on
// 425/428 (the other 3: staff typed last year's YA, or "YA2025 & 2026" for
// two lines); word-for-word the same on 362 — the rest differ only in
// staff's own wording ("Quarterly acc", "Consolidated unaudited report").
const TAO_PHRASE: ReadonlyArray<readonly [item: string, phrase: (ya: string | null) => string]> = [
  ['Yearly Accounts Services', () => 'Yearly accounting services'],
  ['Quarterly Accounts Services', () => 'Quarterly accounting services'],
  ['Monthly Accounts Services', () => 'Monthly accounting services'],
  ['Compilation Report Services', () => 'Compilation report'],
  ['Corporate Tax Services', ya => (ya ? `Tax YA ${ya}` : 'Corporate Tax Services')],
  ['Personal Tax Services', ya => (ya ? `Personal tax submission YA ${ya}` : 'Personal tax submission')],
  ['GST Submission Services', () => 'GST submission'],
  ['AIS submission', ya => (ya ? `e-submission of Employment Income Tax YA${ya}` : 'e-submission of Employment Income Tax')],
  ['Dormant Tax Return', ya => (ya ? `Dormant Tax return for YA${ya}` : 'Dormant Tax return')],
];

// Reimbursements (OPE) and discounts ride along unnamed (OPE: 4 of 106).
const TAO_UNNAMED = /^(Disbursement|Discount|Contra)\b/i;

export type TaoMemoLine = { productService?: string; description: string };

export function composeTaoStatementMemo(input: readonly TaoMemoLine[]): string {
  const leafOf = (l: TaoMemoLine) => (l.productService ?? '').split(':').pop()!.replace(/\s*\(deleted\)\s*$/i, '').trim();
  const named = input.filter(l => !TAO_UNNAMED.test((l.productService ?? '').trim()));
  const parts: string[] = [];
  // Staff's own services first, in their order — one per YA the lines state
  // (a YA-less extra line, like "Additional 25 employees", adds nothing).
  for (const [item, phrase] of TAO_PHRASE) {
    const lines = named.filter(l => leafOf(l).toLowerCase() === item.toLowerCase());
    if (!lines.length) continue;
    const yas = [...new Set(lines.flatMap(l => l.description.match(/\b(?:YA|Year of Assessment)\s*(\d{4})\b/i)?.[1] ?? []))];
    for (const text of yas.length ? yas.map(ya => phrase(ya)) : [phrase(null)]) if (!parts.includes(text)) parts.push(text);
  }
  // Anything else by its QuickBooks item name ("Certificate of Residence",
  // "IR21 submission"); a custom line with no item by its first line.
  const known = new Set(TAO_PHRASE.map(([item]) => item.toLowerCase()));
  for (const l of named) {
    if (known.has(leafOf(l).toLowerCase())) continue;
    const text = leafOf(l) || l.description.split('\n')[0].trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  // Only reimbursements on the invoice → name those, never leave it blank.
  if (!parts.length) for (const l of input) { const text = leafOf(l); if (text && !parts.includes(text)) parts.push(text); }
  return parts.join(',');
}
