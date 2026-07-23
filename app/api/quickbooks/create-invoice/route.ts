import { NextRequest, NextResponse } from 'next/server';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { nextDocNumber, invoiceDocNumberExists, getNet7TermId, findPicClass, isGovFeeLine } from '@/lib/qb-invoice-conventions';
import { createAdminClient } from '@/lib/supabase';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';
import { findUniqueBestMatch } from '@/lib/company-name';
import { isValidEmail } from '@/lib/campaign-recipients';
import { isPrimaryRenewalProduct, parseInvoicePeriod, servicePeriodOverlapError } from '@/lib/invoice-period';
import { createHash } from 'node:crypto';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export interface DraftLineItem {
  service: string;          // 'Secretary' | 'Address' | 'ND' etc.
  description: string;      // full line description
  rate: number;
  qty?: number;
  productService?: string;  // exact QB Product/Service name, e.g. "Secretary:Corporate Secretarial Services"
  periodConfirmed?: boolean; // required when the latest QB renewal has no readable period
}

function requiresPicClass(line: DraftLineItem) {
  return line.service === 'Secretary' || line.service === 'XBRL';
}

interface CompanyResult {
  invoiceNo?: string;
  qbId?: string;
  total?: number;
  error?: string;
  uncertain?: boolean;
  numberAdjusted?: boolean;
  expectedInvoiceNo?: string;
  numberMode?: InvoiceNumberMode;
}

type InvoiceNumberMode = 'sequential' | 'manual';

function quickBooksRequestId(company: QbCompany, idempotencyKey: string) {
  const digest = createHash('sha256')
    .update(`${company}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `tcs-${company.toLowerCase()}-${digest}`;
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
  const match = findUniqueBestMatch(name, rows2, row => String(row.DisplayName ?? ''), 70);
  return match.value
    ? { id: match.value.Id as string, name: match.value.DisplayName as string }
    : null;
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

async function findLocation(token: string, realmId: string, locationName: string) {
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

async function validateRenewalPeriods(
  company: QbCompany,
  customerName: string,
  lines: DraftLineItem[],
) {
  const renewalLines = lines.filter(line => ['Secretary', 'Address', 'ND'].includes(line.service));
  if (!renewalLines.length) return [];

  const services = [...new Set(renewalLines.map(line => line.service))];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('quickbooks_invoice_items')
    .select('invoice_no, txn_date, service_type, product_service, description, period_start, period_end')
    .eq('qb_company', company)
    .eq('customer_name', customerName)
    .in('service_type', services);
  if (error) return [`Unable to verify prior service periods: ${error.message}`];

  const errors: string[] = [];
  for (const line of renewalLines) {
    const rows = (data ?? []).filter(row => row.service_type === line.service);
    const resolvedRows = rows.map(row => {
      const parsed = parseInvoicePeriod(row.description, line.service);
      return {
        ...row,
        parsed: {
          period_start: parsed?.period_start ?? row.period_start ?? undefined,
          period_end: parsed?.period_end ?? row.period_end ?? undefined,
        },
      };
    });
    const parsedRows = resolvedRows
      .filter(row => row.parsed?.period_end)
      .sort((a, b) => (b.parsed?.period_end ?? '').localeCompare(a.parsed?.period_end ?? ''));
    const latestParsed = parsedRows[0] ?? null;
    const latestPrimary = resolvedRows
      .filter(row => isPrimaryRenewalProduct(line.service, row.product_service))
      .sort((a, b) => (b.txn_date ?? '').localeCompare(a.txn_date ?? ''))[0] ?? null;
    const unresolvedLatest = !!latestPrimary
      && !latestPrimary.parsed?.period_end
      && (!latestParsed || (latestPrimary.txn_date ?? '') > (latestParsed.txn_date ?? ''));

    if (unresolvedLatest && !line.periodConfirmed) {
      errors.push(`${line.service}: latest QuickBooks invoice #${latestPrimary!.invoice_no} has no readable period. Confirm it manually before generating.`);
      continue;
    }

    const proposed = parseInvoicePeriod(line.description, line.service);
    const overlap = servicePeriodOverlapError(line.service, proposed, latestParsed?.parsed?.period_end);
    if (overlap) errors.push(overlap);
  }
  return errors;
}

// Create one invoice in ONE QB company for the given lines. Used twice per
// request when a draft has both TAB lines (basic services) and TAC lines
// (Nominee Director) — each is its own invoice in its own QB company.
async function createInvoiceInCompany(
  company: QbCompany, companyName: string, lines: DraftLineItem[],
  email: string | undefined, txnDate: string, sendEmail: boolean | undefined,
  pic: string | undefined, docNumber: string | undefined,
  numberMode: InvoiceNumberMode, requestId: string,
  locationName: string | undefined,
): Promise<CompanyResult> {
  const tokenRow = await getValidToken(company);
  if (!tokenRow) return { error: `QuickBooks ${company} not connected` };
  const { access_token: token, realm_id: realmId } = tokenRow;

  const customer = await findCustomer(token, realmId, companyName);
  if (!customer) return { error: `Customer not found in QB ${company}: "${companyName}"` };

  const periodErrors = await validateRenewalPeriods(company, customer.name, lines);
  if (periodErrors.length) {
    return { error: `Invoice period validation failed. ${periodErrors.join(' ')}` };
  }

  // House conventions (see lib/qb-invoice-conventions.ts): QuickBooks
  // atomically allocates the sequential DocNumber, Net 7 terms, and — TAB only — the
  // PIC's person class on Secretary and XBRL lines only. Other services do not
  // carry a PIC in QuickBooks, even when they share the same TAB invoice.
  const [itemMap, termId, picClass, location] = await Promise.all([
    getItemMap(token, realmId),
    getNet7TermId(token, realmId),
    company === 'TAB' && pic ? findPicClass(token, realmId, pic) : Promise.resolve(null),
    locationName ? findLocation(token, realmId, locationName) : Promise.resolve(null),
  ]);

  if (locationName && !location) {
    return { error: `QuickBooks ${company} Location not found: "${locationName}"` };
  }

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
  // Both TAB and TAC enable CustomTxnNumbers. In that mode QuickBooks treats
  // every supplied DocNumber literally; "AUTO_GENERATE" is not a sentinel.
  // Always send the exact validated number. A final duplicate lookup here
  // narrows the window between the earlier reservation and this QB write.
  if (!docNumber) return { error: `QuickBooks ${company} invoice number is required.` };
  if (await invoiceDocNumberExists(token, realmId, docNumber)) {
    return { error: `${docNumber} already exists in QuickBooks ${company}. Refresh the invoice number before generating.` };
  }
  payload.DocNumber = docNumber;
  if (termId)    payload.SalesTermRef = { value: termId };
  if (location)  payload.DepartmentRef = location;
  // Guard here too, not just at the source that resolves `email` — a
  // malformed address (e.g. a stray space from a TeamWork data typo) makes
  // QuickBooks reject the whole invoice create with an RFC 822 validation
  // fault instead of just going out without a billing email.
  if (isValidEmail(email)) payload.BillEmail = { Address: email };

  const createUrl = new URL(`${QB_BASE}/v3/company/${realmId}/invoice`);
  createUrl.searchParams.set('minorversion', '75');
  createUrl.searchParams.set('requestid', requestId);
  const createRes = await fetch(createUrl, {
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
  const invoiceNo = typeof inv.DocNumber === 'string' ? inv.DocNumber : undefined;
  if (!inv.Id || !invoiceNo) {
    return {
      error: `QB ${company} returned an incomplete invoice result. Reconcile request ${requestId} before retrying.`,
      uncertain: true,
    };
  }
  return {
    invoiceNo,
    qbId: inv.Id,
    total: inv.TotalAmt,
    numberAdjusted: numberMode === 'sequential' && invoiceNo !== docNumber,
    expectedInvoiceNo: docNumber,
    numberMode,
  };
}

// ── POST /api/quickbooks/create-invoice ───────────────────────────────────────
// Basic services (Secretary/Address/AR/XBRL/Accounts/Tax/Discount) invoice
// under TAB (the default company); Nominee Director always invoices
// separately under TAC. A single request can produce up to two invoices.
export async function POST(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const body = await req.json();
  const {
    companyName, email, txnDate, sendEmail, pic,
    tabLines, tacLines,
    fyeMonth, fyeYear, fyeCycle, docNumbers, expectedNextNumbers, idempotencyKey,
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
    idempotencyKey?: string;
  };

  if (!companyName || (!tabLines?.length && !tacLines?.length)) {
    return NextResponse.json({ error: 'companyName and at least one line (tabLines or tacLines) are required' }, { status: 400 });
  }
  if (!idempotencyKey || !/^[A-Za-z0-9-]{16,100}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: 'A valid invoice idempotency key is required.' }, { status: 400 });
  }
  if (txnDate && !/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) {
    return NextResponse.json({ error: 'txnDate must be YYYY-MM-DD.' }, { status: 400 });
  }
  const requestedLines = [...(tabLines ?? []), ...(tacLines ?? [])];
  if (requestedLines.some(line =>
    !line.description?.trim()
    || !Number.isFinite(Number(line.rate))
    || !Number.isFinite(Number(line.qty ?? 1))
    || Number(line.qty ?? 1) <= 0
    || Math.abs(Number(line.rate)) > 10_000_000
  )) {
    return NextResponse.json({ error: 'Every invoice line requires a description, finite rate and positive quantity.' }, { status: 400 });
  }

  const date = txnDate ?? new Date().toISOString().slice(0, 10);
  const supabase = createAdminClient();

  const activeCompanies: QbCompany[] = [
    ...(tabLines?.length ? ['TAB' as const] : []),
    ...(tacLines?.length ? ['TAC' as const] : []),
  ];
  const { data: priorReservations, error: priorReservationError } = await supabase
    .from('invoice_creation_reservations')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .in('qb_company', activeCompanies);
  if (priorReservationError) {
    return NextResponse.json({ error: priorReservationError.message }, { status: 503 });
  }
  const reservationByCompany = new Map((priorReservations ?? []).map(row => [row.qb_company as QbCompany, row]));
  if ((priorReservations ?? []).some(row => row.company_name !== companyName || (row.fye_cycle ?? null) !== (fyeCycle ?? null))) {
    return NextResponse.json({ error: 'This invoice request key belongs to a different company or cycle.' }, { status: 409 });
  }
  if ((priorReservations ?? []).some(row => row.status === 'pending' || row.status === 'uncertain')) {
    return NextResponse.json({
      success: false,
      reconciliationRequired: true,
      error: 'A prior attempt is still pending or has an unknown QuickBooks outcome. Verify it before retrying.',
    }, { status: 409 });
  }
  if (activeCompanies.every(company => reservationByCompany.get(company)?.status === 'created')) {
    const replay = (company: QbCompany) => {
      const row = reservationByCompany.get(company);
      return row ? { invoiceNo: row.doc_number, qbId: row.qb_invoice_id, total: row.total_amt } : null;
    };
    return NextResponse.json({ success: true, replayed: true, tab: replay('TAB'), tac: replay('TAC'), errors: {} });
  }

  // The modal number is an estimate. Re-read QuickBooks immediately before
  // reserving the exact number in Supabase. This serializes simultaneous
  // system users; createInvoiceInCompany performs one more live duplicate
  // lookup immediately before the QB write to catch direct QB activity.
  const companiesToCreate = activeCompanies.filter(company => reservationByCompany.get(company)?.status !== 'created');
  const resolvedNumbers: Partial<Record<QbCompany, string>> = {};
  const reservationNumbers: Partial<Record<QbCompany, string>> = {};
  const numberModes: Partial<Record<QbCompany, InvoiceNumberMode>> = {};
  const liveNumbers: Partial<Record<QbCompany, string | null>> = {};
  const numberConflicts: Partial<Record<QbCompany, string>> = {};

  await Promise.all(companiesToCreate.map(async company => {
    const token = await getValidToken(company);
    if (!token) return;
    const live = await nextDocNumber(token.access_token, token.realm_id, company, date);
    liveNumbers[company] = live;
    const expected = expectedNextNumbers?.[company]?.trim();
    const existingReservation = reservationByCompany.get(company);
    const existingNumber = String(existingReservation?.doc_number ?? '');
    const legacyAutomaticReservation = existingNumber.startsWith('AUTO-') || existingNumber === 'AUTO_GENERATE';
    const requested = legacyAutomaticReservation
      ? docNumbers?.[company]?.trim()
      : existingNumber || docNumbers?.[company]?.trim();

    if (requested && !/^[A-Za-z0-9-]{1,21}$/.test(requested)) {
      numberConflicts[company] = 'Invoice number must use 1-21 letters, numbers or hyphens';
      return;
    }
    const manuallyOverridden = !legacyAutomaticReservation
      && !!requested
      && (!expected || requested !== expected)
      && requested !== live;
    if (manuallyOverridden && await invoiceDocNumberExists(token.access_token, token.realm_id, requested)) {
      numberConflicts[company] = `${requested} already exists in QuickBooks ${company}`;
      return;
    }
    if (!manuallyOverridden && live && requested && requested !== live) {
      numberConflicts[company] = `${requested} is no longer the next QuickBooks ${company} number. The latest number is ${live}`;
      return;
    }
    const selected = manuallyOverridden ? requested : live || requested || expected;
    if (selected) {
      resolvedNumbers[company] = selected;
      numberModes[company] = manuallyOverridden ? 'manual' : 'sequential';
      reservationNumbers[company] = selected;
    }
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

  const newReservations = companiesToCreate
    .filter(company => !reservationByCompany.has(company))
    .map(company => ({
      idempotency_key: idempotencyKey,
      qb_company: company,
      company_name: companyName,
      fye_cycle: fyeCycle ?? null,
      doc_number: reservationNumbers[company],
      status: 'pending',
      requested_by_email: account.email,
      updated_at: new Date().toISOString(),
    }));
  if (newReservations.some(row => !row.doc_number)) {
    return NextResponse.json({ error: 'QuickBooks did not provide an invoice number to reserve.' }, { status: 503 });
  }
  if (newReservations.length) {
    const { error: reservationError } = await supabase.from('invoice_creation_reservations').insert(newReservations);
    if (reservationError) {
      return NextResponse.json({
        success: false,
        numberConflict: true,
        error: 'Another user reserved one of these invoice numbers first. Refresh the suggested numbers.',
      }, { status: 409 });
    }
  }
  const failedReservationCompanies = companiesToCreate.filter(company => reservationByCompany.get(company)?.status === 'failed');
  if (failedReservationCompanies.length) {
    const { error: retryReservationError } = await supabase.from('invoice_creation_reservations').update({
      status: 'pending', error: null, updated_at: new Date().toISOString(),
    }).eq('idempotency_key', idempotencyKey).in('qb_company', failedReservationCompanies);
    if (retryReservationError) {
      return NextResponse.json({
        success: false,
        numberConflict: true,
        error: 'The previous invoice number can no longer be reserved. Refresh the suggested number.',
      }, { status: 409 });
    }
  }

  const replayResult = (company: QbCompany): CompanyResult | null => {
    const row = reservationByCompany.get(company);
    return row?.status === 'created'
      ? { invoiceNo: row.doc_number, qbId: row.qb_invoice_id, total: row.total_amt }
      : null;
  };
  const safeCreate = async (company: QbCompany, lines: DraftLineItem[]): Promise<CompanyResult | null> => {
    const replayed = replayResult(company);
    if (replayed) return replayed;
    if (!lines.length) return null;
    try {
      return await createInvoiceInCompany(
        company, companyName, lines, email, date, sendEmail, pic,
        resolvedNumbers[company], numberModes[company] ?? 'sequential',
        quickBooksRequestId(company, idempotencyKey), account.qbLocations?.[company],
      );
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        uncertain: true,
      };
    }
  };

  const [tab, tac] = await Promise.all([
    safeCreate('TAB', tabLines ?? []),
    safeCreate('TAC', tacLines ?? []),
  ]);

  const reservationUpdateErrors: string[] = [];
  await Promise.all(([
    ['TAB', tab], ['TAC', tac],
  ] as Array<[QbCompany, CompanyResult | null]>).map(async ([company, result]) => {
    if (!result || replayResult(company)) return;
    const reservationUpdate: Record<string, unknown> = {
      status: result.error ? (result.uncertain ? 'uncertain' : 'failed') : 'created',
      qb_invoice_id: result.qbId ?? null,
      total_amt: result.total ?? null,
      error: result.error ?? null,
      updated_at: new Date().toISOString(),
    };
    if (!result.error && result.invoiceNo) reservationUpdate.doc_number = result.invoiceNo;
    const { error: reservationUpdateError } = await supabase.from('invoice_creation_reservations').update(reservationUpdate)
      .eq('idempotency_key', idempotencyKey).eq('qb_company', company);
    if (reservationUpdateError) {
      reservationUpdateErrors.push(`Invoice ${result.qbId ?? result.invoiceNo ?? company} exists in QuickBooks, but its reservation record could not be finalized: ${reservationUpdateError.message}`);
    }
  }));

  // Persist every successful creation — the authoritative "already invoiced
  // this cycle" record going forward, and what lets the Billing list show the
  // real invoice number per company instead of a generic "Invoiced" chip.
  const toRecord: { qb_company: QbCompany; result: CompanyResult; lines: DraftLineItem[] }[] = [];
  if (tab && !tab.error) toRecord.push({ qb_company: 'TAB', result: tab, lines: tabLines ?? [] });
  if (tac && !tac.error) toRecord.push({ qb_company: 'TAC', result: tac, lines: tacLines ?? [] });

  let persistenceWarning: string | null = reservationUpdateErrors.length
    ? reservationUpdateErrors.join(' ')
    : null;
  if (toRecord.length) {
    const { error: recordError } = await supabase.from('generated_invoices').upsert(toRecord.map(({ qb_company, result, lines }) => ({
      company_name: companyName,
      fye_month: fyeMonth ?? null,
      fye_year: fyeYear ?? null,
      fye_cycle: fyeCycle ?? null,
      qb_company,
      invoice_no: result.invoiceNo ?? null,
      qb_invoice_id: result.qbId ?? null,
      total_amt: result.total ?? null,
      services: [...new Set(lines.map(l => l.service))],
      created_by_email: account.email,
      idempotency_key: idempotencyKey,
    })), { onConflict: 'idempotency_key,qb_company' });
    if (recordError) {
      const generatedWarning = `Invoice exists in QuickBooks but local billing history needs reconciliation: ${recordError.message}`;
      persistenceWarning = persistenceWarning ? `${persistenceWarning} ${generatedWarning}` : generatedWarning;
      await supabase.from('invoice_creation_reservations').update({
        error: `Invoice created but generated_invoices persistence failed: ${recordError.message}`,
        updated_at: new Date().toISOString(),
      }).eq('idempotency_key', idempotencyKey).eq('status', 'created');
    }
  }

  const anySuccess = !!(tab && !tab.error) || !!(tac && !tac.error);
  return NextResponse.json({
    success: anySuccess,
    tab: tab && !tab.error ? {
      invoiceNo: tab.invoiceNo,
      qbId: tab.qbId,
      total: tab.total,
      numberAdjusted: tab.numberAdjusted,
      expectedInvoiceNo: tab.expectedInvoiceNo,
      numberMode: tab.numberMode,
    } : null,
    tac: tac && !tac.error ? {
      invoiceNo: tac.invoiceNo,
      qbId: tac.qbId,
      total: tac.total,
      numberAdjusted: tac.numberAdjusted,
      expectedInvoiceNo: tac.expectedInvoiceNo,
      numberMode: tac.numberMode,
    } : null,
    errors: {
      ...(tab?.error ? { tab: tab.error } : {}),
      ...(tac?.error ? { tac: tac.error } : {}),
      ...(persistenceWarning ? { persistence: persistenceWarning } : {}),
    },
  }, { status: anySuccess ? 200 : 500 });
}
