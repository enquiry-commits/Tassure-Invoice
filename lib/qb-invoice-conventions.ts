import type { QbCompany } from './quickbooks';

// Invoice conventions learned from Tassure's real QB invoices (verified by
// inspecting manual invoices 02610732 (TAB) and 02680230 (TAC)):
//
// 1. DocNumber — both companies run "custom transaction numbers", so the API
//    MUST supply one or the invoice is created blank. Scheme: 0 + YY + series
//    digit + 4-digit sequence, where series = 1 for TAB, 8 for TAC
//    (2026 TAB → 0261xxxx, 2026 TAC → 0268xxxx).
// 2. Terms — always Net 7 (Term id 7 in both companies; resolved dynamically
//    in case the id ever differs).
// 3. Class — TAB tags every SERVICE line with the PIC's person class
//    ("Ang Shi Ming", "Chin Kah Ye", …); government-fee/disbursement lines
//    carry no class. TAC invoices carry no classes at all.

const QB_BASE = 'https://quickbooks.api.intuit.com';

async function qbGet(token: string, realmId: string, query: string) {
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return (await res.json()).QueryResponse ?? null;
}

// Next DocNumber in the company's yearly series. Falls back to null (invoice
// still created, just unnumbered like before) if the lookup fails.
export async function nextDocNumber(token: string, realmId: string, company: QbCompany, txnDate: string): Promise<string | null> {
  const yy = String(new Date(txnDate).getFullYear()).slice(-2);
  const prefix = `0${yy}${company === 'TAB' ? '1' : '8'}`;
  const qr = await qbGet(token, realmId, `SELECT * FROM Invoice WHERE DocNumber LIKE '${prefix}%' ORDER BY DocNumber DESC MAXRESULTS 1`);
  const latest: string | undefined = qr?.Invoice?.[0]?.DocNumber;
  if (!latest) return `${prefix}0001`; // first invoice of the year in this series
  const seq = parseInt(latest.slice(prefix.length), 10);
  if (isNaN(seq)) return null;
  return `${prefix}${String(seq + 1).padStart(latest.length - prefix.length, '0')}`;
}

// Net 7 term id (id 7 in both companies today; resolved defensively).
export async function getNet7TermId(token: string, realmId: string): Promise<string | null> {
  const qr = await qbGet(token, realmId, 'SELECT * FROM Term MAXRESULTS 100');
  const terms: { Id: string; Name?: string; DueDays?: number }[] = qr?.Term ?? [];
  const hit = terms.find(t => /net\s*7\b/i.test(t.Name ?? '')) ?? terms.find(t => t.DueDays === 7);
  return hit?.Id ?? null;
}

// Match the company's PIC ("Shi Ming Ang", possibly "A, B" with several
// names) to a QB person class ("Ang Shi Ming") — word-order-insensitive:
// exact token-set match first, then subset ("Shemin" ⊂ "Tey Shemin").
export async function findPicClass(token: string, realmId: string, pic: string): Promise<{ value: string; name: string } | null> {
  const all: { Id: string; Name: string; Active?: boolean }[] = [];
  for (let start = 1; start <= 4001; start += 1000) {
    const qr = await qbGet(token, realmId, `SELECT * FROM Class STARTPOSITION ${start} MAXRESULTS 1000`);
    const page = qr?.Class ?? [];
    all.push(...page);
    if (page.length < 1000) break;
  }
  const tokens = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean).sort();
  const personClasses = all.filter(c => c.Active !== false && /^[A-Za-z .'-]+$/.test(c.Name));

  for (const cand of pic.split(/[,/&]| and /i).map(s => s.trim()).filter(Boolean)) {
    const t = tokens(cand);
    if (!t.length) continue;
    const exact = personClasses.find(c => tokens(c.Name).join(' ') === t.join(' '));
    if (exact) return { value: exact.Id, name: exact.Name };
    const subset = personClasses.find(c => { const ct = new Set(tokens(c.Name)); return t.every(x => ct.has(x)); });
    if (subset) return { value: subset.Id, name: subset.Name };
  }
  return null;
}

// Government-fee / disbursement lines carry no PIC class on manual invoices.
export function isGovFeeLine(l: { service: string; productService?: string }): boolean {
  return l.service === 'AR' || /disbursement|government/i.test(l.productService ?? '');
}
