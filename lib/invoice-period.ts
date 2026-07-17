const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_PATTERN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

export type ParsedInvoicePeriod = {
  period_start?: string;
  period_end?: string;
  fye_date?: string;
};

export type RenewalFeeProduct = {
  service: 'Secretary' | 'Address' | 'ND';
  role: 'primary' | 'deferred';
};

/**
 * Map each QuickBooks renewal item to the service that owns its value.
 * Deferred revenue must stay paired with its own visible primary item:
 * Corp Sec -> Corporate Secretarial Services, Reg Addr -> Address Services.
 */
export function classifyRenewalFeeProduct(productService: string | null | undefined): RenewalFeeProduct | null {
  const product = productService ?? '';
  if (/Deferred(?: Revenue)?\s*-\s*Corp Sec/i.test(product)) {
    return { service: 'Secretary', role: 'deferred' };
  }
  if (/Deferred(?: Revenue)?\s*-\s*Reg Addr/i.test(product)) {
    return { service: 'Address', role: 'deferred' };
  }
  if (/Deferred(?: Revenue)?\s*-\s*ND(?: Fees)?\b/i.test(product)) {
    return { service: 'ND', role: 'deferred' };
  }
  if (/Co(?:r)?porate Secretarial Services|Secretary Fees - Offshore/i.test(product)) {
    return { service: 'Secretary', role: 'primary' };
  }
  if (/Registered Address Services/i.test(product)) {
    return { service: 'Address', role: 'primary' };
  }
  if (/Nominee Director Fees/i.test(product)) {
    return { service: 'ND', role: 'primary' };
  }
  return null;
}

export function isPrimaryRenewalProduct(service: string, productService: string | null | undefined) {
  const product = classifyRenewalFeeProduct(productService);
  return product?.role === 'primary' && product.service === service;
}

export function compareRenewalPeriodProductLines(
  service: string,
  a: { period_end: string | null; product_service: string | null },
  b: { period_end: string | null; product_service: string | null },
) {
  const periodOrder = (b.period_end ?? '').localeCompare(a.period_end ?? '');
  if (periodOrder) return periodOrder;
  return Number(isPrimaryRenewalProduct(service, b.product_service))
    - Number(isPrimaryRenewalProduct(service, a.product_service));
}

export type RenewalFeeLine = {
  customer_key: string;
  qb_company?: string | null;
  invoice_no: string;
  txn_date: string | null;
  product_service: string | null;
  description: string | null;
  amount: number | null;
  generated_invoice?: boolean;
};

export type AnnualRenewalFee = {
  invoice_no: string;
  txn_date: string | null;
  fee: number;
  product_service: string;
};

/**
 * Build the latest verified annual fee for each company and service.
 * Deferred amounts are added only to the matching visible primary item in the
 * same invoice. A primary-only line must still prove that the invoice is an
 * annual renewal through a readable period, an Annual Return fee, or our own
 * generated-invoice record. This prevents one-off work such as Share Allotment
 * from replacing the annual renewal fee while retaining older generic QB
 * descriptions such as "Sale; Company".
 */
export function buildAnnualRenewalFeeMap(lines: RenewalFeeLine[]) {
  type Group = {
    sourceInvoiceKey: string;
    customerKey: string;
    service: RenewalFeeProduct['service'];
    invoiceNo: string;
    txnDate: string | null;
    sum: number;
    primaryProduct: string | null;
    hasDeferred: boolean;
    hasReadablePeriod: boolean;
    hasAnnualInvoiceSignal: boolean;
  };

  const invoiceKey = (line: RenewalFeeLine) =>
    `${line.customer_key}|${line.qb_company ?? ''}|${line.invoice_no}`;
  const annualInvoiceSignals = new Set<string>();
  for (const line of lines) {
    const product = line.product_service ?? '';
    const hasAnnualReturnFee = /Government fee for filing Annual Return/i.test(product)
      || (/Secretary:ACRA Fees/i.test(product) && Math.abs(Number(line.amount ?? 0)) >= 50);
    if (line.generated_invoice || hasAnnualReturnFee) annualInvoiceSignals.add(invoiceKey(line));
  }

  const invoiceGroups = new Map<string, Group>();
  for (const line of lines) {
    const part = classifyRenewalFeeProduct(line.product_service);
    if (!part) continue;
    const sourceInvoiceKey = invoiceKey(line);
    const key = `${sourceInvoiceKey}|${part.service}`;
    if (!invoiceGroups.has(key)) {
      invoiceGroups.set(key, {
        sourceInvoiceKey,
        customerKey: line.customer_key,
        service: part.service,
        invoiceNo: line.invoice_no,
        txnDate: line.txn_date,
        sum: 0,
        primaryProduct: null,
        hasDeferred: false,
        hasReadablePeriod: false,
        hasAnnualInvoiceSignal: annualInvoiceSignals.has(sourceInvoiceKey),
      });
    }

    const group = invoiceGroups.get(key)!;
    group.sum += Number(line.amount ?? 0) || 0;
    group.hasReadablePeriod ||= !!parseInvoicePeriod(line.description, part.service)?.period_end;
    if (part.role === 'primary') group.primaryProduct = line.product_service;
    else group.hasDeferred = true;
  }

  const groups = [...invoiceGroups.values()];
  const isStrongAnnual = (group: Group) => group.hasDeferred
    || group.hasReadablePeriod
    || group.hasAnnualInvoiceSignal;
  const strongByCompanyService = new Map<string, Group[]>();
  for (const group of groups) {
    if (!group.primaryProduct || !isStrongAnnual(group)) continue;
    const key = `${group.customerKey}|${group.service}`;
    if (!strongByCompanyService.has(key)) strongByCompanyService.set(key, []);
    strongByCompanyService.get(key)!.push(group);
  }

  // A small number of legacy QB renewals have only a generic "Sale" text and
  // no ACRA line. Accept those only when at least two services recur together
  // in the same invoice about one year after verified annual fees, with
  // comparable amounts. Requiring two independently matching services keeps a
  // standalone one-off Secretary item from being mistaken for a renewal.
  const recurringMatchesByInvoice = new Map<string, Set<Group>>();
  for (const group of groups) {
    if (!group.primaryProduct || isStrongAnnual(group) || !group.txnDate) continue;
    const priorGroups = strongByCompanyService.get(`${group.customerKey}|${group.service}`) ?? [];
    const currentDate = group.txnDate;
    const currentTime = Date.parse(currentDate);
    const hasPriorAnnual = priorGroups.some(prior => {
      if (!prior.txnDate || prior.txnDate >= currentDate) return false;
      const days = (currentTime - Date.parse(prior.txnDate)) / 86_400_000;
      const priorAmount = Math.abs(prior.sum);
      const ratio = priorAmount ? Math.abs(group.sum) / priorAmount : 0;
      return days >= 270 && days <= 460 && ratio >= 0.5 && ratio <= 2;
    });
    if (!hasPriorAnnual) continue;
    if (!recurringMatchesByInvoice.has(group.sourceInvoiceKey)) {
      recurringMatchesByInvoice.set(group.sourceInvoiceKey, new Set());
    }
    recurringMatchesByInvoice.get(group.sourceInvoiceKey)!.add(group);
  }
  const recurringAnnualGroups = new Set<Group>();
  for (const matches of recurringMatchesByInvoice.values()) {
    if (matches.size >= 2) for (const group of matches) recurringAnnualGroups.add(group);
  }

  const result = new Map<string, Map<RenewalFeeProduct['service'], AnnualRenewalFee>>();
  for (const group of groups) {
    if (!group.primaryProduct || (!isStrongAnnual(group) && !recurringAnnualGroups.has(group))) continue;
    if (!result.has(group.customerKey)) result.set(group.customerKey, new Map());
    const companyFees = result.get(group.customerKey)!;
    const current = companyFees.get(group.service);
    const groupOrder = `${group.txnDate ?? ''}|${group.invoiceNo}`;
    const currentOrder = current ? `${current.txn_date ?? ''}|${current.invoice_no}` : '';
    if (!current || groupOrder > currentOrder) {
      companyFees.set(group.service, {
        invoice_no: group.invoiceNo,
        txn_date: group.txnDate,
        fee: Math.round(group.sum * 100) / 100,
        product_service: group.primaryProduct,
      });
    }
  }

  return result;
}

function monthNumber(value: string) {
  return MONTH_MAP[value.toLowerCase().slice(0, 3)] ?? null;
}

function fullYear(value: string) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function isoDate(year: number, month: number, day?: number) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200
    || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const resolvedDay = day ?? lastDay;
  if (!Number.isInteger(resolvedDay) || resolvedDay < 1 || resolvedDay > lastDay) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`;
}

function normalizeDescription(raw: string) {
  return raw
    .replace(/[\u3010\uff3b]/g, '[')
    .replace(/[\u3011\uff3d]/g, ']')
    .replace(/[\uff08]/g, '(')
    .replace(/[\uff09]/g, ')')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the real period formats found in TAB/TAC QuickBooks descriptions.
 * The historical data contains inconsistent spaces, apostrophe years,
 * full-width brackets and both bracketed and unbracketed ranges.
 */
export function parseInvoicePeriod(raw: string | null | undefined, service?: string): ParsedInvoicePeriod | null {
  if (!raw) return null;
  const description = normalizeDescription(raw);
  const result: ParsedInvoicePeriod = {};

  type Candidate = { index: number; period_start: string; period_end: string };
  const candidates: Candidate[] = [];
  const fullRangePattern = new RegExp(
    `(?:from\\s+)?(?:\\d{1,2}\\s+)?${MONTH_PATTERN}\\s*'?\\s*(\\d{2,4})\\s*(?:-|to)\\s*(?:\\d{1,2}\\s+)?${MONTH_PATTERN}\\s*'?\\s*(\\d{2,4})`,
    'gi',
  );
  for (const match of description.matchAll(fullRangePattern)) {
    const startMonth = monthNumber(match[1]);
    const endMonth = monthNumber(match[3]);
    if (!startMonth || !endMonth) continue;
    const periodStart = isoDate(fullYear(match[2]), startMonth, 1);
    const periodEnd = isoDate(fullYear(match[4]), endMonth);
    if (!periodStart || !periodEnd) continue;
    candidates.push({
      index: match.index,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  // Formats such as "Jan-Dec 2026" and "July - Dec2026" only state the
  // end year. Derive the start year from the month ordering.
  const endYearOnlyPattern = new RegExp(
    `(?:from\\s+)?${MONTH_PATTERN}\\s*(?:-|to)\\s*${MONTH_PATTERN}\\s*'?\\s*(\\d{2,4})`,
    'gi',
  );
  for (const match of description.matchAll(endYearOnlyPattern)) {
    const startMonth = monthNumber(match[1]);
    const endMonth = monthNumber(match[2]);
    const endYear = fullYear(match[3]);
    if (!startMonth || !endMonth) continue;
    const startYear = startMonth > endMonth ? endYear - 1 : endYear;
    const periodStart = isoDate(startYear, startMonth, 1);
    const periodEnd = isoDate(endYear, endMonth);
    if (!periodStart || !periodEnd) continue;
    candidates.push({
      index: match.index,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  if (candidates.length) {
    const serviceKeywords: Record<string, string[]> = {
      Secretary: ['secretarial', 'secretary', 'sec serv', 'sec,', 'sec '],
      Address: ['registered address', 'reg addr', 'address', 'addr'],
      ND: ['nominee director', 'nd serv', 'nd,', 'nd '],
    };
    const keywords = service ? serviceKeywords[service] ?? [] : [];
    const selected = candidates
      .map(candidate => {
        const prefix = description.slice(Math.max(0, candidate.index - 70), candidate.index).toLowerCase();
        const proximity = Math.max(-1, ...keywords.map(keyword => prefix.lastIndexOf(keyword)));
        return { candidate, proximity };
      })
      .sort((a, b) => b.proximity - a.proximity || a.candidate.index - b.candidate.index)[0].candidate;
    result.period_start = selected.period_start;
    result.period_end = selected.period_end;
  }

  if (!result.period_end) {
    const numericRange = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*(?:-|to)\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i.exec(description);
    if (numericRange) {
      const periodStart = isoDate(Number(numericRange[3]), Number(numericRange[2]), Number(numericRange[1]));
      const periodEnd = isoDate(Number(numericRange[6]), Number(numericRange[5]), Number(numericRange[4]));
      if (periodStart && periodEnd) {
        result.period_start = periodStart;
        result.period_end = periodEnd;
      }
    }
  }

  const numericFye = /(?:FYE|YE)\s*[:\-]?\s*(\d{1,2})[.\s/-](\d{1,2})[.\s/-](\d{4})/i.exec(description);
  if (numericFye) {
    const fyeDate = isoDate(Number(numericFye[3]), Number(numericFye[2]), Number(numericFye[1]));
    if (fyeDate) result.fye_date = fyeDate;
  } else {
    const namedFye = new RegExp(
      `(?:FYE|YE)\\s*[:\\-]?\\s*(\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})`,
      'i',
    ).exec(description);
    const month = namedFye ? monthNumber(namedFye[2]) : null;
    if (namedFye && month) {
      const fyeDate = isoDate(Number(namedFye[3]), month, Number(namedFye[1]));
      if (fyeDate) result.fye_date = fyeDate;
    }
  }

  return Object.keys(result).length ? result : null;
}

export function nextServicePeriod(periodEnd: string) {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  const nextEnd = new Date(Date.UTC(end.getUTCFullYear() + 1, end.getUTCMonth() + 1, 0));
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: nextEnd.toISOString().slice(0, 10),
  };
}

function incrementYear(value: string) {
  const year = fullYear(value) + 1;
  return value.length === 2 ? String(year).slice(-2) : String(year);
}

/**
 * Roll recurring Accounts, Tax and Discount descriptions forward by one year
 * without changing unrelated numbers such as fees or company identifiers.
 */
export function rollRecurringDescriptionForward(raw: string) {
  let description = raw;
  const fullRange = new RegExp(
    `(${MONTH_PATTERN}\\s*'?\\s*)(\\d{2,4})(\\s*(?:-|to)\\s*${MONTH_PATTERN}\\s*'?\\s*)(\\d{2,4})`,
    'gi',
  );
  description = description.replace(fullRange, (_match, startPrefix: string, _startMonth: string, startYear: string, separator: string, _endMonth: string, endYear: string) =>
    `${startPrefix}${incrementYear(startYear)}${separator}${incrementYear(endYear)}`,
  );

  const endYearOnly = new RegExp(`(${MONTH_PATTERN}\\s*(?:-|to)\\s*${MONTH_PATTERN}\\s*'?\\s*)(\\d{2,4})`, 'gi');
  description = description.replace(endYearOnly, (_match, prefix: string, _startMonth: string, _endMonth: string, year: string) =>
    `${prefix}${incrementYear(year)}`,
  );

  description = description.replace(/(\b(?:FYE|YE|YA)\s*[:\-]?\s*)(\d{4})\b/gi, (_match, prefix: string, year: string) =>
    `${prefix}${Number(year) + 1}`,
  );
  description = description.replace(/(\b(?:FYE|YE|YA)\s*[:\-]?\s*\d{1,2}[./-]\d{1,2}[./-])(\d{4})\b/gi, (_match, prefix: string, year: string) =>
    `${prefix}${Number(year) + 1}`,
  );
  description = description.replace(/(\b(?:financial\s+year\s+ended|year\s+ended|year\s+ending|for\s+the\s+year\s+ended)\s+\d{1,2}\s+[A-Za-z]+\s+)(\d{4})\b/gi, (_match, prefix: string, year: string) =>
    `${prefix}${Number(year) + 1}`,
  );

  return description;
}

export function servicePeriodOverlapError(
  service: string,
  proposed: ParsedInvoicePeriod | null,
  latestPeriodEnd: string | null | undefined,
) {
  if (!proposed?.period_start || !proposed.period_end) {
    return `${service}: enter a complete service period before generating the invoice.`;
  }
  if (!latestPeriodEnd) return null;
  if (proposed.period_start <= latestPeriodEnd) {
    return `${service}: the proposed period ${proposed.period_start} to ${proposed.period_end} overlaps the latest invoiced period ending ${latestPeriodEnd}.`;
  }
  return null;
}
