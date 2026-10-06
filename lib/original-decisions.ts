// Vincent's decisions about the 24 open split invoices that had no original the proof accepts (2026-10-07,
// INV-QB-037), kept as DATA so each one can be read, tested and expire on its own. Two registers:
//
// 1. CONFIRMED_ORIGINALS — "外观差别，只要是外观差别的，可以用原装的发票，就用原装的，不需要重新画":
//    four invoices whose original (the file from the company file server, attached to the invoice in
//    QuickBooks) differs from what the system redraws only in how the lines are broken down — the same
//    number, date, customer and total, but accounting regrouped the lines afterwards (900 -> 585 + 315, one
//    1,000 line -> 500 + 500). The proof (lib/original-copy.ts) refuses such a file because its amounts are not a
//    folding of the invoice's lines; Vincent's decision makes the system use it anyway, for THESE files only
//    (named by sha256) and only while the invoice still is the version he looked at.
// 2. REDRAW_DECISIONS — "不用管是说可以沿用的意思吗？如果可以沿用就沿用，并且把不用管的记录处理掉" and "不会发SOA
//    的当成先不管": the system's redraw is what goes out and is right (or no SOA is sent), so these invoices
//    leave the Invoice Originals to-do list. NOTHING about the PDF changes for them — they were already redrawn.
//
// Rules: (1) an entry is added only on Vincent's explicit word, never inferred; (2) every entry is tied to the
// version of the invoice he decided about (number, date, customer, total) — when accounting changes any of them
// the entry lapses and the invoice is judged again (the list shows it, the proof decides); (3) a confirmed file
// is tied to its sha256, so a different file never rides on it; (4) nothing here ever touches QuickBooks.
//
// The only invoice left on the list is Co-Operate Associates TAB #02610167 (Vincent: "只留下唯一要处理的").

import { sameInvoiceVersion, type ConfirmedOriginal, type InvoiceFacts } from './original-copy';

type Book = 'TAB' | 'TAC';
const DECIDED_BY = 'Vincent';
const DECIDED_ON = '2026-10-07';

// ── 1. use the original ────────────────────────────────────────────────────

const WHY_USE_ORIGINAL = 'same invoice number, date, customer and total as the client received; accounting only regrouped the lines afterwards — only the appearance differs, so the original is used and not redrawn';

type ConfirmedEntry = ConfirmedOriginal & { book: Book; invoiceId: string };
const confirm = (e: Omit<ConfirmedEntry, 'decidedBy' | 'decidedOn' | 'why'>): ConfirmedEntry => ({ ...e, decidedBy: DECIDED_BY, decidedOn: DECIDED_ON, why: WHY_USE_ORIGINAL });

export const CONFIRMED_ORIGINALS: readonly ConfirmedEntry[] = [
  // 900 there, 585 + 315 in QuickBooks now (the 315 line has no description)
  confirm({ book: 'TAB', invoiceId: '12688', invoiceNo: 'TAB 02610547', date: '30/04/2026', total: 1800, customer: 'EVOP (Singapore) International Pte. Ltd.', sha256: '4ef767c46d90033c0eaf4fd2265fe8d0bcb6e298283950e1e1f0bf5c7dbb0d13', fileName: 'INV02610547-EVOP (Singapore) International Pte. Ltd-S$1800.pdf' }),
  // 900 there, 585 + 315 now
  confirm({ book: 'TAB', invoiceId: '23128', invoiceNo: 'TAB 02610907', date: '03/08/2026', total: 2100, customer: 'NOVA GOLDEN ALPHA PTE. LTD.', sha256: '93d76e7e2c99c10525a74204330db18a0793537b55d5675791db5f9a5956712f', fileName: 'INV02610907-NOVA GOLDEN ALPHA PTE. LTD.-S$2100.pdf' }),
  // one 1,000 line there, 500 + 500 now
  confirm({ book: 'TAB', invoiceId: '24778', invoiceNo: 'TAB 02611000', date: '27/08/2026', total: 1460, customer: 'Soon & Guan Manpower Trading Pte Ltd', sha256: '061d190587eee46867fdb8520991f6f7f960a065cbd4cd651aeed8fa9d03395a', fileName: 'INV02611000-SOON & GUAN MANPOWER TRAINING PTE. LTD.-S$1460.pdf' }),
  // a picture (no text) — 600 there, 285 + 315 now; compared by eye 2026-10-07: number, date, customer, 600 / 500 / -100 = 1,000
  confirm({ book: 'TAB', invoiceId: '18267', invoiceNo: 'TAB 02610788', date: '30/06/2026', total: 1000, customer: 'Minyotech Pte. Ltd.', sha256: '6911c83e051a13a1c653f2525692a3d4679cf92b1f953bc3bea16b9d28a140fa', fileName: 'INV02610788-Minyotech Pte. Ltd-S$1000.pdf' }),
];

// The entries that cover this invoice (empty for every invoice but the four above).
export function confirmedOriginalsFor(book: string, invoiceId: string): ConfirmedOriginal[] {
  return CONFIRMED_ORIGINALS.filter(c => c.book === book && c.invoiceId === invoiceId);
}

// ── 2. the redraw is right / nothing to send ───────────────────────────────

export const REDRAW_REASONS = {
  'identical-to-original': "the original on the file server is a picture; compared line by line, the system's redraw shows exactly what the client received",
  'changed-after-sending': 'the invoice was changed after it was sent — the SOA must show the current invoice, which is what the redraw shows',
  'not-sent': "the customer's net balance is 0, so no SOA is sent for it; left as it is for now",
} as const;
export type RedrawReason = keyof typeof REDRAW_REASONS;

export type RedrawDecision = {
  book: Book; invoiceId: string; invoiceNo: string; date: string; total: number; customer: string;
  why: RedrawReason; decidedBy: string; decidedOn: string;
};
const decide = (e: Omit<RedrawDecision, 'decidedBy' | 'decidedOn'>): RedrawDecision => ({ ...e, decidedBy: DECIDED_BY, decidedOn: DECIDED_ON });

export const REDRAW_DECISIONS: readonly RedrawDecision[] = [
  // changed after sending (totals: 1,120 -> 1,070 / 1,120 -> 1,220 / 660 -> 435; dates by 1-2 days)
  decide({ book: 'TAB', invoiceId: '25898', invoiceNo: 'TAB 02611099', date: '29/09/2026', total: 1070, customer: 'Advance CF Technology Pte. Ltd.', why: 'changed-after-sending' }),
  decide({ book: 'TAB', invoiceId: '25844', invoiceNo: 'TAB 02611080', date: '24/09/2026', total: 1220, customer: 'Kinplus Trading Pte. Ltd.', why: 'changed-after-sending' }),
  decide({ book: 'TAB', invoiceId: '21256', invoiceNo: 'TAB 02610888', date: '23/07/2026', total: 435, customer: 'Ling Long E-Commerce Pte. Ltd.', why: 'changed-after-sending' }),
  decide({ book: 'TAB', invoiceId: '16391', invoiceNo: 'TAB 02610747', date: '18/06/2026', total: 760, customer: 'Hai Rui Pte. Ltd.', why: 'changed-after-sending' }),
  decide({ book: 'TAB', invoiceId: '13105', invoiceNo: 'TAB 02610580', date: '07/05/2026', total: 1120, customer: 'Singapore Hua Jin Investment Pte Ltd', why: 'changed-after-sending' }),
  decide({ book: 'TAB', invoiceId: '11661', invoiceNo: 'TAB 02610402', date: '01/04/2026', total: 660, customer: 'Neostra Investment Pte. Ltd.', why: 'changed-after-sending' }),
  // the original is a picture that matches the redraw line for line (rendered and compared 2026-10-07)
  decide({ book: 'TAB', invoiceId: '18268', invoiceNo: 'TAB 02610789', date: '30/06/2026', total: 560, customer: 'Minyotech Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAB', invoiceId: '16259', invoiceNo: 'TAB 02610691', date: '11/06/2026', total: 560, customer: 'Kindle Beacon Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAB', invoiceId: '16254', invoiceNo: 'TAB 02610687', date: '11/06/2026', total: 1260, customer: 'International LCM Pte Ltd', why: 'identical-to-original' }),
  decide({ book: 'TAB', invoiceId: '16249', invoiceNo: 'TAB 02610682', date: '11/06/2026', total: 660, customer: 'Goldhill Memorial Centre Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAB', invoiceId: '16247', invoiceNo: 'TAB 02610680', date: '11/06/2026', total: 860, customer: 'British Sports Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '3359', invoiceNo: 'TAC 02680210', date: '19/06/2026', total: 4000, customer: 'Najiwan Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '3339', invoiceNo: 'TAC 02680200', date: '16/06/2026', total: 3000, customer: 'Warm Sea Wind Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '3337', invoiceNo: 'TAC 02680198', date: '16/06/2026', total: 3000, customer: 'Sunterra Trading Pte. Ltd.', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '2682', invoiceNo: 'TAC 02680153', date: '07/05/2026', total: 3000, customer: 'Singapore Hua Jin Investment Pte Ltd', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '2597', invoiceNo: 'TAC 02680133', date: '28/04/2026', total: 4000, customer: 'Yu An Bulk Holding Pte Ltd', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '2473', invoiceNo: 'TAC 02680124', date: '24/04/2026', total: 6000, customer: 'DEMIRER KABEL PTE. LTD.', why: 'identical-to-original' }),
  decide({ book: 'TAC', invoiceId: '1714', invoiceNo: 'TAC 02680044', date: '27/02/2026', total: 4000, customer: 'Aries Honor Shipping Pte Ltd', why: 'identical-to-original' }),
  // the customer nets to 0, no SOA is sent; and its deferred Reg Addr line has no service line to fold into
  decide({ book: 'TAB', invoiceId: '6358', invoiceNo: 'TAB 02511395', date: '19/12/2025', total: 1420, customer: 'Sanli Group Pte Ltd', why: 'not-sent' }),
];

// The decision that covers this invoice AS IT IS NOW, or null (never decided, or accounting changed the invoice since).
export function redrawDecisionFor(book: string, invoiceId: string, facts: Pick<InvoiceFacts, 'invoiceNo' | 'date' | 'total' | 'customer'>): RedrawDecision | null {
  const d = REDRAW_DECISIONS.find(x => x.book === book && x.invoiceId === invoiceId);
  return d && sameInvoiceVersion(d, facts) ? d : null;
}
