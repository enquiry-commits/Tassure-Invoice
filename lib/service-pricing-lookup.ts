import 'server-only';

import { createAdminClient } from './supabase';

// Added 2026-09-11 — Vincent: "现在接到去助手上" (now wire it into the
// assistant), following on from loading the standard service catalog +
// pricing into service_pricing / company_service_terms (scripts/add-
// service-pricing.sql). This is STANDARD / LIST price reference data —
// what Tassure's own proposal quotes as of 11 Sep 2026 — never a real
// client's actual invoiced amount (that stays QuickBooks/generated_
// invoices; real agreements, discounts and packages can differ, as the
// source proposal's own "Goodwill Discount" line shows). The tool's own
// `note` field carries this caveat so the model repeats it rather than
// presenting a quote as if it were a real client's bill.

export type ServicePricingRow = {
  section: string;
  itemCode: string | null;
  serviceNameEn: string;
  serviceNameCn: string | null;
  descriptionEn: string | null;
  descriptionCn: string | null;
  priceDisplay: string;
  priceSgdMin: number | null;
  priceSgdMax: number | null;
  priceUnit: string | null;
  quoteRequired: boolean;
  isFoc: boolean;
  remarksEn: string | null;
  remarksCn: string | null;
  isTotal: boolean;
  sourceDocument: string;
  sourceUpdatedOn: string;
};

export type ServiceTermRow = {
  topic: string;
  contentEn: string;
  contentCn: string | null;
  sourceDocument: string;
  sourceUpdatedOn: string;
};

export type ServicePricingResult = {
  sections: string[]; // every distinct section name, in display order — lets the model see the shape before drilling in
  rows: ServicePricingRow[];
  terms: ServiceTermRow[];
  totalRows: number;
};

function mapRow(r: Record<string, unknown>): ServicePricingRow {
  return {
    section: String(r.section ?? ''),
    itemCode: (r.item_code as string | null) ?? null,
    serviceNameEn: String(r.service_name_en ?? ''),
    serviceNameCn: (r.service_name_cn as string | null) ?? null,
    descriptionEn: (r.description_en as string | null) ?? null,
    descriptionCn: (r.description_cn as string | null) ?? null,
    priceDisplay: String(r.price_display ?? ''),
    priceSgdMin: r.price_sgd_min == null ? null : Number(r.price_sgd_min),
    priceSgdMax: r.price_sgd_max == null ? null : Number(r.price_sgd_max),
    priceUnit: (r.price_unit as string | null) ?? null,
    quoteRequired: r.quote_required === true,
    isFoc: r.is_foc === true,
    remarksEn: (r.remarks_en as string | null) ?? null,
    remarksCn: (r.remarks_cn as string | null) ?? null,
    isTotal: r.is_total === true,
    sourceDocument: String(r.source_document ?? ''),
    sourceUpdatedOn: String(r.source_updated_on ?? ''),
  };
}

// Strips spaces/hyphens and lowercases before comparing, so a natural
// one-word search like "trademark" still matches data spelled "Trade Mark"
// (the source proposal's own spelling) — a plain ILIKE substring match
// missed this real case (confirmed: "trademark" against "Trade Mark
// Application" returned nothing until this normalization was added).
function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, '');
}

// `section` and `search` are both optional and may be combined; omitting
// both returns the full 64-row catalog (grouped by section, in the source
// document's own order) — the whole thing is small enough that "give me
// everything" is a perfectly reasonable default, not just a fallback.
// `search` matches against service name or description in either
// language. Filtering happens in memory, not via a DB ILIKE, specifically
// for the normalization above — the whole table is 64 rows, so fetching it
// in full costs nothing.
export async function getServicePricing(opts?: { section?: string; search?: string }): Promise<ServicePricingResult> {
  const supabase = createAdminClient();

  let query = supabase
    .from('service_pricing')
    .select('section, item_code, service_name_en, service_name_cn, description_en, description_cn, price_display, price_sgd_min, price_sgd_max, price_unit, quote_required, is_foc, remarks_en, remarks_cn, is_total, source_document, source_updated_on, display_order')
    .order('display_order', { ascending: true });

  if (opts?.section) query = query.ilike('section', `%${opts.section}%`);

  const [{ data: priceRows }, { data: termRows }] = await Promise.all([
    query,
    supabase.from('company_service_terms').select('topic, content_en, content_cn, source_document, source_updated_on').order('display_order', { ascending: true }),
  ]);

  let rows = (priceRows ?? []).map(mapRow);
  if (opts?.search?.trim()) {
    const needle = normalizeForSearch(opts.search);
    rows = rows.filter(r => [r.serviceNameEn, r.serviceNameCn, r.descriptionEn, r.descriptionCn]
      .some(field => field && normalizeForSearch(field).includes(needle)));
  }
  const sections = [...new Set(rows.map(r => r.section))];
  const terms = (termRows ?? []).map(r => ({
    topic: String(r.topic ?? ''),
    contentEn: String(r.content_en ?? ''),
    contentCn: (r.content_cn as string | null) ?? null,
    sourceDocument: String(r.source_document ?? ''),
    sourceUpdatedOn: String(r.source_updated_on ?? ''),
  }));

  return { sections, rows, terms, totalRows: rows.length };
}
