import { NextRequest, NextResponse } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { nextDocNumber, invoiceDocNumberExists, getNet7TermId, findPicClass, isGovFeeLine } from '@/lib/qb-invoice-conventions';
import { createAdminClient } from '@/lib/supabase';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export interface DraftLineItem {
  service: string;          // 'Secretary' | 'Address' | 'ND' etc.
  description: string;      // full line description
  rate: number;
  qty?: number;
  productService?: string;  // exact QB Product/Service name, e.g. "Secretary:Corporate Secretarial Services"
}

function requiresPicClass(line: DraftLineItem) {
  return line.service === 'Secretary' || line.service === 'XBRL';
}

interface CompanyResult {
  invoiceNo?: string;
  qbId?: string;
  total?: number;
  error?: string;
}

// ── Look up QB Customer by display name ───────────────────────────────────────
async function findCustomer(token: string, realmId: string, name: string) {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 5`);
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const rows: Record<string, unknown>[] = json.QueryResponse?.Customer ?? [];
  if (rows.length) return { id: rows[0].Id as string, name: rows[0].DisplayName as string };

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
  const normTarget = name.toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim();
  const match = rows2.find(r => {
    const dn = (r.DisplayName as string ?? '').toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim();
    return dn.includes(normTarget) || normTarget.includes(dn);
  });
  return match ? { id: match.Id as string, name: match.DisplayName as string } : null;
}

// ── Look up QB Items to get ItemRef for each service ─────────────────────────
async function getItemMap(token: string, realmId: string): Promise<Map<string, { id: string; name: string }>> {
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

function pickItem(service: string, itemMap: Map<string, { id: string; name: string }>) {
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

// Create one invoice in ONE QB company for the given lines. Used twice per
// request when a draft has both TAB lines (basic services) and TAC lines
// (Nominee Director) — each is its own invoice in its own QB company.
async function createInvoiceInCompany(
  company: QbCompany, companyName: string, lines: DraftLineItem[],
  email: string | undefined, txnDate: string, sendEmail: boolean | undefined,
  pic: string | undefined, docNumber: string | undefined,
): Promise<CompanyResult> {
  const tokenRow = await getValidToken(company);
  if (!tokenRow) return { error: `QuickBooks ${company} not connected` };
  const { access_token: token, realm_id: realmId } = tokenRow;

  const customer = await findCustomer(token, realmId, companyName);
  if (!customer) return { error: `Customer not found in QB ${company}: "${companyName}"` };

  // House conventions (see lib/qb-invoice-conventions.ts): sequential
  // DocNumber per company/year series (custom transaction numbers are ON, so
  // an unnumbered create stays blank), Net 7 terms, and — TAB only — the
  // PIC's person class on Secretary and XBRL lines only. Other services do not
  // carry a PIC in QuickBooks, even when they share the same TAB invoice.
  const [itemMap, termId, picClass] = await Promise.all([
    getItemMap(token, realmId),
    getNet7TermId(token, realmId),
    company === 'TAB' && pic ? findPicClass(token, realmId, pic) : Promise.resolve(null),
  ]);

  const invoiceLines = lines.map((l, i) => {
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

  const payload: Record<string, unknown> = {
    Line:        invoiceLines,
    CustomerRef: { value: customer.id, name: customer.name },
    TxnDate:     txnDate,
    PrintStatus: 'NeedToPrint',
    // Default: create as a draft for review in QB — do NOT queue for sending.
    EmailStatus: sendEmail && email ? 'NeedToSend' : 'NotSet',
  };
  if (docNumber) payload.DocNumber = docNumber;
  if (termId)    payload.SalesTermRef = { value: termId };
  if (email) payload.BillEmail = { Address: email };

  const createRes = await fetch(`${QB_BASE}/v3/company/${realmId}/invoice?minorversion=65`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    return { error: `QB ${company} create failed: ${errText.slice(0, 300)}` };
  }

  const created = await createRes.json();
  const inv = created.Invoice ?? {};
  return { invoiceNo: inv.DocNumber, qbId: inv.Id, total: inv.TotalAmt };
}

// ── POST /api/quickbooks/create-invoice ───────────────────────────────────────
// Basic services (Secretary/Address/AR/XBRL/Accounts/Tax/Discount) invoice
// under TAB (the default company); Nominee Director always invoices
// separately under TAC. A single request can produce up to two invoices.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    companyName, email, txnDate, sendEmail, pic,
    tabLines, tacLines,
    fyeMonth, fyeYear, fyeCycle, docNumbers, expectedNextNumbers,
  } = body as {
    companyName: string;
    email?: string;
    txnDate?: string;
    sendEmail?: boolean;
    pic?: string;          // person-in-charge — Class on TAB Secretary/XBRL lines only
    tabLines: DraftLineItem[];
    tacLines: DraftLineItem[];
    fyeMonth?: string;
    fyeYear?: number;
    fyeCycle?: string; // "dd.mm.yyyy"
    docNumbers?: Partial<Record<QbCompany, string>>;
    expectedNextNumbers?: Partial<Record<QbCompany, string>>;
  };

  if (!companyName || (!tabLines?.length && !tacLines?.length)) {
    return NextResponse.json({ error: 'companyName and at least one line (tabLines or tacLines) are required' }, { status: 400 });
  }

  const date = txnDate ?? new Date().toISOString().slice(0, 10);
  const supabase = createAdminClient();

  // Preflight every invoice before creating either one. The modal sends the
  // next number it originally saw; if QB has advanced since then, abort the
  // whole request so a TAB invoice cannot be created before a TAC conflict is
  // discovered (or vice versa). Manual overrides are allowed only when unused.
  const activeCompanies: QbCompany[] = [
    ...(tabLines?.length ? ['TAB' as const] : []),
    ...(tacLines?.length ? ['TAC' as const] : []),
  ];
  const resolvedNumbers: Partial<Record<QbCompany, string>> = {};
  const liveNumbers: Partial<Record<QbCompany, string | null>> = {};
  const numberConflicts: Partial<Record<QbCompany, string>> = {};

  await Promise.all(activeCompanies.map(async company => {
    const token = await getValidToken(company);
    if (!token) return;
    const live = await nextDocNumber(token.access_token, token.realm_id, company, date);
    liveNumbers[company] = live;
    const expected = expectedNextNumbers?.[company]?.trim();
    const requested = docNumbers?.[company]?.trim();

    if (expected && live && expected !== live) {
      numberConflicts[company] = `QuickBooks advanced from ${expected} to ${live}`;
      return;
    }
    if (requested && !/^[A-Za-z0-9-]{1,21}$/.test(requested)) {
      numberConflicts[company] = 'Invoice number must use 1-21 letters, numbers or hyphens';
      return;
    }
    if (requested && await invoiceDocNumberExists(token.access_token, token.realm_id, requested)) {
      numberConflicts[company] = `${requested} already exists in QuickBooks ${company}`;
      return;
    }
    const selected = requested || live;
    if (selected) resolvedNumbers[company] = selected;
  }));

  if (Object.keys(numberConflicts).length) {
    return NextResponse.json({
      success: false,
      numberConflict: true,
      error: 'Invoice numbers changed or are already in use. Review the refreshed numbers before generating.',
      conflicts: numberConflicts,
      nextNumbers: liveNumbers,
    }, { status: 409 });
  }

  const [tab, tac] = await Promise.all([
    tabLines?.length ? createInvoiceInCompany('TAB', companyName, tabLines, email, date, sendEmail, pic, resolvedNumbers.TAB) : Promise.resolve(null),
    tacLines?.length ? createInvoiceInCompany('TAC', companyName, tacLines, email, date, sendEmail, pic, resolvedNumbers.TAC) : Promise.resolve(null),
  ]);

  // Persist every successful creation — the authoritative "already invoiced
  // this cycle" record going forward, and what lets the Billing list show the
  // real invoice number per company instead of a generic "Invoiced" chip.
  const toRecord: { qb_company: QbCompany; result: CompanyResult; lines: DraftLineItem[] }[] = [];
  if (tab && !tab.error) toRecord.push({ qb_company: 'TAB', result: tab, lines: tabLines ?? [] });
  if (tac && !tac.error) toRecord.push({ qb_company: 'TAC', result: tac, lines: tacLines ?? [] });

  if (toRecord.length) {
    await supabase.from('generated_invoices').insert(toRecord.map(({ qb_company, result, lines }) => ({
      company_name: companyName,
      fye_month: fyeMonth ?? null,
      fye_year: fyeYear ?? null,
      fye_cycle: fyeCycle ?? null,
      qb_company,
      invoice_no: result.invoiceNo ?? null,
      qb_invoice_id: result.qbId ?? null,
      total_amt: result.total ?? null,
      services: [...new Set(lines.map(l => l.service))],
    })));
  }

  const anySuccess = !!(tab && !tab.error) || !!(tac && !tac.error);
  return NextResponse.json({
    success: anySuccess,
    tab: tab && !tab.error ? { invoiceNo: tab.invoiceNo, qbId: tab.qbId, total: tab.total } : null,
    tac: tac && !tac.error ? { invoiceNo: tac.invoiceNo, qbId: tac.qbId, total: tac.total } : null,
    errors: {
      ...(tab?.error ? { tab: tab.error } : {}),
      ...(tac?.error ? { tac: tac.error } : {}),
    },
  }, { status: anySuccess ? 200 : 500 });
}
