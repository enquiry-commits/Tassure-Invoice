import type { QbCompany } from './quickbooks';
import { findUniqueBestMatch } from './company-name';
import { createAdminClient } from './supabase';
import { requiresPicClass, isGovFeeLine, matchPicClass, type PicClassOption } from './invoice-pic-class';

// Moved to lib/invoice-pic-class.ts (client-safe, shared with the Billing
// Drafts popup's PIC column); re-exported so existing imports keep working.
export { requiresPicClass, isGovFeeLine };

// Invoice conventions learned from Tassure's real QB invoices (verified by
// inspecting manual invoices 02610732 (TAB) and 02680230 (TAC)):
//
// 1. DocNumber — all three companies run "custom transaction numbers". The
//    billing screen estimates the next value using the scheme below, and
//    creation revalidates then sends that exact number. QuickBooks treats any
//    supplied DocNumber literally while CustomTxnNumbers is enabled;
//    AUTO_GENERATE must never be sent as a placeholder. Scheme:
//    0 + YY + series digit + 4-digit sequence, where series = 1 for TAB, 8 for
//    TAC, 6 for TAO (2026 TAB → 0261xxxx, 2026 TAC → 0268xxxx, 2026 TAO →
//    0266xxxx). TAO's digit was not invented — ACC's own team has already been
//    hand-issuing TAO invoices with series digit 6 directly in QuickBooks
//    (e.g. 02660650, TAO02560838) since before this app generated any TAO
//    invoices; matching it avoids the app's suggested number colliding with
//    their existing numbering habit (2026-09-05).
// 2. Terms — always Net 7 (Term id 7 in both companies; resolved dynamically
//    in case the id ever differs).
// 3. Class — all three books track Class PER LINE, and staff use it as each
//    service's PIC: a full staff name since 2026-01-01 ("Ang Shi Ming",
//    "Chin Kah Ye", …; 2025 used initials such as "ASM"/"CKY"). Government-
//    fee/disbursement lines carry none, and TAC's Nominee Director lines carry
//    their PIC in the ND item name instead (0 of 257 in 2026) — re-checked
//    2026-10-04; the old note here that "TAC invoices carry no classes at all"
//    was wrong for staff-typed TAC Secretary lines (96% carry one). DEFAULT
//    when this app generates: TAB Secretary/XBRL lines get the company PIC's
//    class, nothing else does (INV-QB-007). A person can override any line's
//    PIC in the Billing Drafts popup's PIC column (`picClassId`, INV-QB-026);
//    lib/invoice-pic-class.ts holds both rules.

// create-invoice/route.ts's own copy of findCustomer/getItemMap/findLocation
// (now merged in below) respected QB_ENVIRONMENT=sandbox; this file's
// pre-existing QB_BASE didn't. Matching lib/quickbooks.ts's own sandbox
// switch here so moving those functions in doesn't quietly drop sandbox
// support for any of them.
const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

async function qbGet(token: string, realmId: string, query: string) {
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return (await res.json()).QueryResponse ?? null;
}

// Estimated next DocNumber in the company's yearly series. This is for display
// and manual-override validation only; QuickBooks confirms the actual number
// during its atomic invoice-create operation.
const DOC_NUMBER_SERIES: Record<QbCompany, string> = { TAB: '1', TAC: '8', TAO: '6' };

export async function nextDocNumber(token: string, realmId: string, company: QbCompany, txnDate: string): Promise<string | null> {
  const series = DOC_NUMBER_SERIES[company];
  if (!series) throw new Error(`No DocNumber series digit defined for QB company "${company}"`);
  const yy = String(new Date(txnDate).getFullYear()).slice(-2);
  const prefix = `0${yy}${series}`;
  const qr = await qbGet(token, realmId, `SELECT * FROM Invoice WHERE DocNumber LIKE '${prefix}%' ORDER BY DocNumber DESC MAXRESULTS 1`);
  const latest: string | undefined = qr?.Invoice?.[0]?.DocNumber;
  if (!latest) return `${prefix}0001`; // first invoice of the year in this series
  const seq = parseInt(latest.slice(prefix.length), 10);
  if (isNaN(seq)) return null;
  return `${prefix}${String(seq + 1).padStart(latest.length - prefix.length, '0')}`;
}

// Estimate ("Quotation") DocNumbers use a SEPARATE, simpler series from
// invoices — confirmed live 2026-09-28 by reading each book's actual recent
// Estimates: "PI" + 2-digit year + 4-digit sequence (e.g. PI260090), with NO
// per-book series digit. TAB and TAO are independently at PI260090/PI260067
// right now — that is not a collision: each QB company file (book) is a
// wholly separate realm with its own DocNumber uniqueness constraint, so two
// books' Estimate sequences can overlap numerically with no consequence, the
// same way each book already has its own independent Invoice sequence.
export async function nextEstimateDocNumber(token: string, realmId: string, txnDate: string): Promise<string | null> {
  const yy = String(new Date(txnDate).getFullYear()).slice(-2);
  const prefix = `PI${yy}`;
  const qr = await qbGet(token, realmId, `SELECT * FROM Estimate WHERE DocNumber LIKE '${prefix}%' ORDER BY DocNumber DESC MAXRESULTS 1`);
  const latest: string | undefined = qr?.Estimate?.[0]?.DocNumber;
  if (!latest) return `${prefix}0001`; // first quotation of the year in this book
  const seq = parseInt(latest.slice(prefix.length), 10);
  if (isNaN(seq)) return null;
  return `${prefix}${String(seq + 1).padStart(latest.length - prefix.length, '0')}`;
}

// Same duplicate-check shape as invoiceDocNumberCount below, against
// Estimate instead of Invoice — the final check immediately before create.
export async function estimateDocNumberExists(token: string, realmId: string, docNumber: string): Promise<boolean> {
  const escaped = docNumber.replace(/'/g, "\\'");
  const qr = await qbGet(token, realmId, `SELECT * FROM Estimate WHERE DocNumber = '${escaped}' MAXRESULTS 1`);
  return (qr?.Estimate?.length ?? 0) > 0;
}

// How many QuickBooks invoices carry this exact DocNumber — null when
// QuickBooks didn't answer. QuickBooks custom transaction numbers are
// company-specific, so this runs against the matching TAB/TAC realm.
export async function invoiceDocNumberCount(token: string, realmId: string, docNumber: string): Promise<number | null> {
  const escaped = docNumber.replace(/'/g, "\\'");
  try {
    const qr = await qbGet(token, realmId, `SELECT Id FROM Invoice WHERE DocNumber = '${escaped}' MAXRESULTS 10`);
    return qr ? (qr.Invoice?.length ?? 0) : null;
  } catch {
    return null;
  }
}

// The duplicate check run immediately before an invoice create (and when
// staff override the suggested number). It fails CLOSED: 'unknown' — a
// QuickBooks error or no answer — must stop the create, never count as
// "unused". The old boolean check read a failed lookup as "no duplicate",
// one way TAB #02611111 ended up on two clients' invoices on 2026-10-01
// (docs/INVARIANTS.md INV-QB-030).
export async function invoiceDocNumberStatus(token: string, realmId: string, docNumber: string): Promise<'unused' | 'exists' | 'unknown'> {
  const count = await invoiceDocNumberCount(token, realmId, docNumber);
  return count === null ? 'unknown' : count > 0 ? 'exists' : 'unused';
}

// Net 7 term id (id 7 in both companies today; resolved defensively).
export async function getNet7TermId(token: string, realmId: string): Promise<string | null> {
  const qr = await qbGet(token, realmId, 'SELECT * FROM Term MAXRESULTS 100');
  const terms: { Id: string; Name?: string; DueDays?: number }[] = qr?.Term ?? [];
  const hit = terms.find(t => /net\s*7\b/i.test(t.Name ?? '')) ?? terms.find(t => t.DueDays === 7);
  return hit?.Id ?? null;
}

// Every ACTIVE Class in one book, paged in Id order. TAB holds 3,208 (2026-10-04)
// — mostly one-off numeric reference classes from 2025 — so its staff classes
// sit beyond the first 1,000-row page. Cached per realm for 10 minutes: the
// popup's PIC dropdown and every invoice write with a per-line PIC both need
// it. THROWS when QuickBooks can't be read — a caller that must not block
// (findPicClass's default) catches; a caller checking a person's explicit
// choice must not guess.
export type QbClassRow = { Id: string; Name: string; Active?: boolean };
const CLASS_CACHE_MS = 10 * 60_000;
const classCache = new Map<string, { at: number; classes: QbClassRow[] }>();

export async function listActiveClasses(token: string, realmId: string): Promise<QbClassRow[]> {
  const cached = classCache.get(realmId);
  if (cached && Date.now() - cached.at < CLASS_CACHE_MS) return cached.classes;
  const all: QbClassRow[] = [];
  for (let start = 1; ; start += 1000) {
    const qr = await qbGet(token, realmId, `SELECT * FROM Class ORDERBY Id STARTPOSITION ${start} MAXRESULTS 1000`);
    if (!qr) throw new Error('QuickBooks Class list could not be read.');
    const page: QbClassRow[] = qr.Class ?? [];
    all.push(...page);
    if (page.length < 1000) break;
    if (start > 50_000) throw new Error('QuickBooks Class list is unexpectedly large.');
  }
  const active = all
    .filter(c => c.Active !== false)
    .map(c => ({ Id: String(c.Id), Name: String(c.Name ?? ''), Active: c.Active }));
  classCache.set(realmId, { at: Date.now(), classes: active });
  return active;
}

// The company PIC's person class — the DEFAULT for TAB Secretary/XBRL lines
// (INV-QB-007). Matching rule lives in lib/invoice-pic-class.ts's
// matchPicClass(), shared with the popup. Degrades to "no class" when the
// list can't be read, exactly as before — a default must never block an
// invoice.
export async function findPicClass(token: string, realmId: string, pic: string): Promise<PicClassOption | null> {
  let classes: QbClassRow[];
  try { classes = await listActiveClasses(token, realmId); } catch { return null; }
  return matchPicClass(classes, pic);
}

// Shared between the create-invoice and update-invoice routes so the two
// can't silently diverge on how a line becomes a QB SalesItemLineDetail.
export interface DraftLineItem {
  service: string;          // 'Secretary' | 'Address' | 'ND' etc.
  description: string;      // full line description
  rate: number;
  qty?: number;
  productService?: string;  // exact QB Product/Service name, e.g. "Secretary:Corporate Secretarial Services"
  periodConfirmed?: boolean; // required when the latest QB renewal has no readable period
  // The line's PIC as a QuickBooks Class Id, picked per line in the Billing
  // Drafts popup's PIC column (Vincent, 2026-10-04: "要和QB那样，要有一列是
  // 可以选择每个服务的PIC的"). Absent → the default rule (company PIC on TAB
  // Secretary/XBRL lines, INV-QB-007); null → deliberately no PIC; a string →
  // that Class, validated against the book's live classes first.
  picClassId?: string | null;
}

// ── Look up QB Customer by display name ───────────────────────────────────────
// `companyName` (QuickBooks' own separate Customer.CompanyName field, not
// always equal to DisplayName even though it usually is for this business)
// added 2026-09-17 for the Statement cover page — see lib/statement-pdf.ts's
// own comment on why the reference PDF prints the customer's name twice.
export async function findCustomer(token: string, realmId: string, name: string): Promise<{ id: string; name: string; companyName: string | null; billAddr: Record<string, unknown> | null } | null> {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 5`);
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const rows: Record<string, unknown>[] = json.QueryResponse?.Customer ?? [];
  if (rows.length) return { id: rows[0].Id as string, name: rows[0].DisplayName as string, companyName: (rows[0].CompanyName as string) || null, billAddr: (rows[0].BillAddr as Record<string, unknown>) ?? null };

  // Fuzzy fallback: partial word match
  const words = name.toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const q2 = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName LIKE '%${words[0]}%' MAXRESULTS 20`);
  const res2 = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q2}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res2.ok) return null;
  const json2 = await res2.json();
  const rows2: Record<string, unknown>[] = json2.QueryResponse?.Customer ?? [];
  const match = findUniqueBestMatch(name, rows2, row => String(row.DisplayName ?? ''), 70);
  return match.value
    ? { id: match.value.Id as string, name: match.value.DisplayName as string, companyName: (match.value.CompanyName as string) || null, billAddr: (match.value.BillAddr as Record<string, unknown>) ?? null }
    : null;
}

// Vincent, 2026-09-05: a genuinely new company has no QuickBooks Customer
// yet — findCustomer() above only ever looks one up, it never creates one,
// and until now nothing in this codebase did. This is the minimal create
// (DisplayName only, per Vincent's own call — everything else gets filled
// in directly in QuickBooks later): staff-triggered, one company at a time,
// never automatic. QuickBooks itself rejects an exact-DisplayName collision
// ("Duplicate Name Exists Error"), which doubles as a safety net against
// accidentally creating a second record for a company that already exists
// under the same name.
export async function createCustomer(token: string, realmId: string, displayName: string): Promise<{ id: string; name: string } | { error: string }> {
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/customer?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ DisplayName: displayName }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { error: `QuickBooks rejected the new customer: ${errText.slice(0, 300)}` };
  }
  const json = await res.json();
  const customer = json.Customer as Record<string, unknown> | undefined;
  if (!customer?.Id) return { error: 'QuickBooks returned an incomplete customer result.' };
  return { id: String(customer.Id), name: String(customer.DisplayName ?? displayName) };
}

// ── Parent-company Bill-To override ────────────────────────────────────────
// Vincent: a subsidiary's invoice should record against the SUBSIDIARY's own
// QB customer (CustomerRef, unchanged) but show the PARENT's name+address on
// the "Bill To" block the client actually sees. companies.parent_company_id
// is the persistent staff-set link (app/api/companies/parent/route.ts).
// Shared by create-invoice (new invoices) and update-invoice (editing an
// already-created draft) so a parent link set AFTER an invoice already
// exists still takes effect the next time that invoice is saved — re-derived
// fresh from Supabase + QuickBooks every call, never trusted from the client.
export type ParentBillAddrResult =
  | { kind: 'none' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; billAddr: Record<string, unknown> };

export async function resolveParentBillAddr(
  token: string, realmId: string, company: QbCompany,
  companyId: number | null, companyName: string,
): Promise<ParentBillAddrResult> {
  const supabase = createAdminClient();
  let parentCompanyId: number | null = null;
  if (companyId) {
    const { data } = await supabase.from('companies').select('parent_company_id').eq('id', companyId).maybeSingle();
    parentCompanyId = data?.parent_company_id ?? null;
  }
  // Fallback for an AR row that never resolved a real companies.id — exact
  // name match, same string already trusted for the QB customer lookup above.
  if (!parentCompanyId) {
    const { data } = await supabase.from('companies').select('parent_company_id').eq('company_name', companyName).maybeSingle();
    parentCompanyId = data?.parent_company_id ?? null;
  }
  if (!parentCompanyId) return { kind: 'none' }; // no parent linked — normal invoice, unchanged

  const { data: parentRow } = await supabase.from('companies').select('company_name').eq('id', parentCompanyId).maybeSingle();
  if (!parentRow?.company_name) {
    return { kind: 'error', error: `Parent company link is broken for "${companyName}" — the linked parent record no longer exists. Fix the parent link before generating this invoice.` };
  }
  const parent = await findCustomer(token, realmId, parentRow.company_name);
  if (!parent) {
    return { kind: 'error', error: `Cannot generate invoice: parent company "${parentRow.company_name}" (linked to "${companyName}") was not found in QuickBooks ${company}. Set up its QuickBooks customer record first, or check the parent company link.` };
  }
  // PhysicalAddress.Id identifies that address as it exists under the
  // PARENT's own customer record — carrying it onto a different entity (this
  // invoice, under a different CustomerRef) risks QBO rejecting it or
  // misreading it as a reference rather than inline address data.
  const { Id: _unused, ...billAddrFields } = parent.billAddr ?? {};
  // A customer's BillAddr can come back as a bare {Id} with no Line1/City/etc
  // — confirmed for real on Beltroad, whose invoices use FreeFormAddress:true
  // and expose no address text via the API at all. Vincent confirmed this
  // is genuinely correct, not missing data: Beltroad's own real invoices
  // have never carried a street address either, just the company name under
  // "BILL TO:". So this is not an error case — fall back to a name-only
  // BillAddr (still overrides the printed Bill-To name away from the
  // subsidiary) rather than blocking generation.
  if (!billAddrFields.Line1) {
    return { kind: 'ok', billAddr: { Line1: parent.name } };
  }
  return { kind: 'ok', billAddr: billAddrFields };
}

// ── Look up QB Items to get ItemRef for each service ─────────────────────────
export async function getItemMap(token: string, realmId: string): Promise<Map<string, { id: string; name: string }>> {
  // 1000, not 200: past 200 items an invoice line quietly fell back to a
  // keyword guess (pickItem) — TAO has 129 and "Add New Service" keeps adding.
  const q = encodeURIComponent('SELECT * FROM Item WHERE Type = \'Service\' MAXRESULTS 1000');
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const map = new Map<string, { id: string; name: string }>();
  if (!res.ok) return map;
  const json = await res.json();
  for (const item of json.QueryResponse?.Item ?? []) {
    const name = item.Name as string;
    const fullyQualifiedName = (item.FullyQualifiedName as string | undefined) ?? name;
    const ref = { id: item.Id as string, name: fullyQualifiedName };
    map.set(name.toLowerCase(), ref);
    map.set(fullyQualifiedName.toLowerCase(), ref);
  }
  return map;
}

export async function findLocation(token: string, realmId: string, locationName: string) {
  const q = encodeURIComponent('SELECT * FROM Department MAXRESULTS 1000');
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const target = locationName.trim().toLowerCase();
  const match = (json.QueryResponse?.Department ?? []).find((department: Record<string, unknown>) => {
    if (department.Active === false) return false;
    const name = String(department.FullyQualifiedName ?? department.Name ?? '').trim().toLowerCase();
    return name === target;
  });
  return match ? {
    value: String(match.Id),
    name: String(match.FullyQualifiedName ?? match.Name),
  } : null;
}

export function pickItem(service: string, itemMap: Map<string, { id: string; name: string }>) {
  const keywords: Record<string, string[]> = {
    Secretary: ['secretarial', 'corporate sec', 'secretary'],
    Address:   ['address', 'virtual office', 'registered office'],
    ND:        ['nominee', 'director'],
    AR:        ['annual return', 'government fee'],
    XBRL:      ['xbrl', 'ixbrl'],
    Accounts:  ['account', 'bookkeeping', 'compilation'],
    Tax:       ['tax', 'iras'],
    Audit:     ['audit'],
  };
  const kws = keywords[service] ?? [service.toLowerCase()];
  for (const [key, val] of itemMap) {
    if (kws.some(k => key.includes(k))) return val;
  }
  // Generic fallback — first service item
  return itemMap.size ? [...itemMap.values()][0] : { id: '1', name: 'Services' };
}

// The Line-array shape shared by create-invoice and update-invoice — every
// line the same way, so a service invoiced via one path looks identical to
// one invoiced via the other.
export function buildInvoiceLineArray(
  lines: DraftLineItem[],
  itemMap: Map<string, { id: string; name: string }>,
  picClass: PicClassOption | null,
  // Per-line PICs already checked by validateLinePicClasses() against THIS
  // book's live classes (lib/invoice-pic-class.ts).
  chosenClasses: ReadonlyMap<string, PicClassOption> = new Map(),
) {
  return lines.map((l, i) => {
    const exact = l.productService ? itemMap.get(l.productService.toLowerCase()) : undefined;
    const item = exact ?? pickItem(l.service, itemMap);
    const classRef = lineClassRef(l, picClass, chosenClasses);
    return {
      LineNum: i + 1,
      DetailType: 'SalesItemLineDetail',
      Amount: +(l.rate * (l.qty ?? 1)).toFixed(2),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: item.id, name: item.name },
        Qty:       l.qty ?? 1,
        UnitPrice: l.rate,
        ...(classRef ? { ClassRef: { value: classRef.value, name: classRef.name } } : {}),
      },
    };
  });
}

// A person's explicit per-line PIC wins (null = deliberately none). With no
// choice the default rule applies, unchanged (INV-QB-007): the company PIC on
// Secretary/XBRL lines, never a government fee. An explicit PIC that was not
// validated is a programming error — throw rather than silently drop it.
function lineClassRef(l: DraftLineItem, picClass: PicClassOption | null, chosen: ReadonlyMap<string, PicClassOption>): PicClassOption | null {
  if (l.picClassId !== undefined) {
    if (l.picClassId === null) return null;
    const hit = chosen.get(String(l.picClassId));
    if (!hit) throw new Error(`Invoice line PIC (QuickBooks Class ${l.picClassId}) was not validated against this book's classes.`);
    return hit;
  }
  return picClass && requiresPicClass(l) && !isGovFeeLine(l) ? picClass : null;
}

// ── Bill-To "c/o" + "Attn" ──────────────────────────────────────────────────
// Vincent/Cindy, 2026-09-10. QuickBooks has always supported this — it is
// just free text in the invoice's Bill To block — but this system never
// wrote BillAddr for an ordinary invoice, so staff generated the invoice
// here and then retyped the c/o inside QuickBooks every cycle (confirmed on
// Kelun Health TAB #02610648 and 吉木锌国际贸易（上海）).
//
// Target shape, taken verbatim from a real invoice staff typed themselves
// (TAC #02680288):
//   Line1: AI Node Global Pte. Ltd.        <- the client's own name
//   Line2: C/O Novix Ai Global Pte. Ltd    <- the care-of party
//   Line3: 33 Ubi Avenue 3, #07-31, ...    <- an address
//   (Attn goes LAST, per TAO #02660639: "... | 409051 | Attn: Mr Li")
//
// BE CAREFUL HERE. QuickBooks REPLACES BillAddr wholesale; it never merges.
// The moment this returns anything, we own every line the client sees on a
// real invoice — so this degrades rather than guesses at each step, and
// returns 'none' unless a c/o or an Attn is genuinely configured, leaving
// the ~99.9% of invoices with neither byte-identical to today.
export type CareOfSettings = {
  careOf: string | null;
  addrSource: 'b' | 'a' | 'custom' | null; // null is treated as 'b'
  addrCustom: string | null;
  attn: string | null;
};

export type CareOfBillAddrResult =
  | { kind: 'none' }
  | { kind: 'ok'; billAddr: Record<string, unknown>; notes: string[] };

// QuickBooks stores these two ways in the real data: a customer record keeps
// a structured {Line1, City, PostalCode}, while an invoice keeps flat
// {Line1..Line5}. Flatten to printable lines in the order QuickBooks itself
// prints them.
export function addrToLines(addr: Record<string, unknown> | null | undefined): string[] {
  if (!addr) return [];
  const keys = ['Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'CountrySubDivisionCode', 'PostalCode', 'Country'];
  return keys
    .map(k => (typeof addr[k] === 'string' ? (addr[k] as string).trim() : ''))
    .filter(Boolean);
}

export async function resolveCareOfBillAddr(
  token: string, realmId: string,
  settings: CareOfSettings,
  clientName: string,
  clientBillAddr: Record<string, unknown> | null,
): Promise<CareOfBillAddrResult> {
  const careOf = settings.careOf?.trim() || null;
  const attn = settings.attn?.trim() || null;
  if (!careOf && !attn) return { kind: 'none' };

  const notes: string[] = [];
  const source = settings.addrSource ?? 'b';
  let addressLines: string[] = [];

  if (!careOf) {
    // Attn only — never move the address; just annotate the client's own.
    addressLines = addrToLines(clientBillAddr);
  } else if (source === 'custom') {
    addressLines = (settings.addrCustom ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!addressLines.length) {
      addressLines = addrToLines(clientBillAddr);
      notes.push(`The custom c/o address for "${clientName}" is empty, so the client's own address was printed instead.`);
    }
  } else if (source === 'a') {
    addressLines = addrToLines(clientBillAddr);
  } else {
    // 'b' — the care-of party's own address, looked up in this QuickBooks
    // book. It is often NOT one of our customers (a law firm, an overseas
    // entity), which is a normal miss, not an error: fall back to the
    // client's own address and SAY SO rather than printing a c/o with no
    // address under it.
    const b = await findCustomer(token, realmId, careOf);
    addressLines = addrToLines(b?.billAddr);
    if (!addressLines.length) {
      addressLines = addrToLines(clientBillAddr);
      notes.push(
        b
          ? `"${careOf}" exists in QuickBooks but has no address on file, so ${clientName}'s own address was printed under the c/o line.`
          : `"${careOf}" is not a QuickBooks customer in this book, so its address could not be looked up — ${clientName}'s own address was printed under the c/o line. Set the address to Custom if it should show the c/o party's address.`,
      );
    }
  }

  const lines = [
    clientName,
    ...(careOf ? [`c/o ${careOf}`] : []),
    ...addressLines,
    ...(attn ? [`Attn: ${attn}`] : []),
  ];

  // QuickBooks only prints Line1..Line5. Fold any overflow into the last
  // line rather than silently dropping it — losing the postal code or the
  // Attn off the end of a real invoice is the worst outcome here.
  const billAddr: Record<string, unknown> = {};
  const capped = lines.length <= 5 ? lines : [...lines.slice(0, 4), lines.slice(4).join(', ')];
  capped.forEach((l, i) => { billAddr[`Line${i + 1}`] = l; });
  if (lines.length > 5) notes.push(`The Bill To block for "${clientName}" needed ${lines.length} lines; QuickBooks prints 5, so the last ${lines.length - 4} were combined into one line.`);

  return { kind: 'ok', billAddr, notes };
}

// Reads the stored per-company defaults. Returns all-null (→ 'none' from
// resolveCareOfBillAddr) for a company that has none, which is almost all of
// them. Kept separate from the composition so the draft UI can prefill the
// same values and pass an EDITED copy per invoice.
export async function loadCareOfSettings(companyId: number | null, companyName: string): Promise<CareOfSettings> {
  const supabase = createAdminClient();
  const cols = 'bill_to_care_of, bill_to_care_of_addr_source, bill_to_care_of_addr_custom, bill_to_attn';
  let row: Record<string, unknown> | null = null;
  if (companyId) {
    const { data } = await supabase.from('companies').select(cols).eq('id', companyId).maybeSingle();
    row = data ?? null;
  }
  if (!row) {
    const { data } = await supabase.from('companies').select(cols).eq('company_name', companyName).maybeSingle();
    row = data ?? null;
  }
  return {
    careOf: (row?.bill_to_care_of as string | null) ?? null,
    addrSource: (row?.bill_to_care_of_addr_source as 'b' | 'a' | 'custom' | null) ?? null,
    addrCustom: (row?.bill_to_care_of_addr_custom as string | null) ?? null,
    attn: (row?.bill_to_attn as string | null) ?? null,
  };
}
