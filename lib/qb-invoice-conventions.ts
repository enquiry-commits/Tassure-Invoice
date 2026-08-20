import type { QbCompany } from './quickbooks';
import { findUniqueBestMatch } from './company-name';
import { createAdminClient } from './supabase';

// Invoice conventions learned from Tassure's real QB invoices (verified by
// inspecting manual invoices 02610732 (TAB) and 02680230 (TAC)):
//
// 1. DocNumber — both companies run "custom transaction numbers". The billing
//    screen estimates the next value using the scheme below, and creation
//    revalidates then sends that exact number. QuickBooks treats any supplied
//    DocNumber literally while CustomTxnNumbers is enabled; AUTO_GENERATE must
//    never be sent as a placeholder. Scheme:
//    0 + YY + series digit + 4-digit sequence, where series = 1 for TAB, 8 for TAC
//    (2026 TAB → 0261xxxx, 2026 TAC → 0268xxxx).
// 2. Terms — always Net 7 (Term id 7 in both companies; resolved dynamically
//    in case the id ever differs).
// 3. Class — TAB tags every SERVICE line with the PIC's person class
//    ("Ang Shi Ming", "Chin Kah Ye", …); government-fee/disbursement lines
//    carry no class. TAC invoices carry no classes at all.

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

// Exact duplicate check used when staff manually override the suggested
// number. QuickBooks custom transaction numbers are company-specific, so this
// must run against the matching TAB/TAC realm immediately before creation.
export async function invoiceDocNumberExists(token: string, realmId: string, docNumber: string): Promise<boolean> {
  const escaped = docNumber.replace(/'/g, "\\'");
  const qr = await qbGet(token, realmId, `SELECT * FROM Invoice WHERE DocNumber = '${escaped}' MAXRESULTS 1`);
  return (qr?.Invoice?.length ?? 0) > 0;
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

// Shared between the create-invoice and update-invoice routes so the two
// can't silently diverge on how a line becomes a QB SalesItemLineDetail.
export interface DraftLineItem {
  service: string;          // 'Secretary' | 'Address' | 'ND' etc.
  description: string;      // full line description
  rate: number;
  qty?: number;
  productService?: string;  // exact QB Product/Service name, e.g. "Secretary:Corporate Secretarial Services"
  periodConfirmed?: boolean; // required when the latest QB renewal has no readable period
}

export function requiresPicClass(line: DraftLineItem): boolean {
  return line.service === 'Secretary' || line.service === 'XBRL';
}

// ── Look up QB Customer by display name ───────────────────────────────────────
export async function findCustomer(token: string, realmId: string, name: string): Promise<{ id: string; name: string; billAddr: Record<string, unknown> | null } | null> {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 5`);
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const rows: Record<string, unknown>[] = json.QueryResponse?.Customer ?? [];
  if (rows.length) return { id: rows[0].Id as string, name: rows[0].DisplayName as string, billAddr: (rows[0].BillAddr as Record<string, unknown>) ?? null };

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
    ? { id: match.value.Id as string, name: match.value.DisplayName as string, billAddr: (match.value.BillAddr as Record<string, unknown>) ?? null }
    : null;
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
  const q = encodeURIComponent('SELECT * FROM Item WHERE Type = \'Service\' MAXRESULTS 200');
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
  picClass: { value: string; name: string } | null,
) {
  return lines.map((l, i) => {
    const exact = l.productService ? itemMap.get(l.productService.toLowerCase()) : undefined;
    const item = exact ?? pickItem(l.service, itemMap);
    return {
      LineNum: i + 1,
      DetailType: 'SalesItemLineDetail',
      Amount: +(l.rate * (l.qty ?? 1)).toFixed(2),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: item.id, name: item.name },
        Qty:       l.qty ?? 1,
        UnitPrice: l.rate,
        ...(picClass && requiresPicClass(l) && !isGovFeeLine(l) ? { ClassRef: picClass } : {}),
      },
    };
  });
}
