// The Statement memo (QuickBooks PrivateNote) a TAB/TAC renewal invoice gets,
// written the way staff already write it by hand. Read from the 500 latest
// invoices per book (2026-10-04):
//   Sec + AR               "Sec (Nov 2026 - Oct 2027),AR 31.7.2026"           (82)
//   Sec + address + AR     "Sec,addrs (Apr 2026 - Mar 2027),AR 31.08.2026"    (69)
//   Sec + AR + XBRL        "Sec (Oct 2026 - Sep 2027),AR,XBRL 31.12.2026"     (15)
//   XBRL only              "XBRL"                                             (40)
//   TAC Nominee Director   "ND (Aug 2026 - Jul 2027)"                         (185)
// Every invoice this app created had its memo typed in afterwards by hand
// (60/60 TAB, 20/20 TAC). Vincent, 2026-10-04: "只做 Statement memo". The
// Billing Drafts popup composes it live from the lines being invoiced, and
// the person can still edit it. Client-safe on purpose.
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
