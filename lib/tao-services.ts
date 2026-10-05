import 'server-only';

// TAO's live QuickBooks Service/Item catalog — read AND write. Added
// 2026-10-04, Vincent relaying his boss: "现在在系统内TAO开单的服务并不齐
// 全...这个新服务能不能被记录在QB内的一个新服务记录中". Investigated live
// against QuickBooks TAO before writing any of this (not guessed):
//
//   - QuickBooks TAO's 129 real Service items are organized under exactly
//     5 top-level "Category" items (a real QBO entity Type, distinct from
//     Service) — Accounts, Disbursement, Other, Secretary, Tax. Their real
//     ids, queried directly and hardcoded below since a Category item is
//     structural/rarely-if-ever added, not something to re-query every call.
//   - Every real Service item has its OWN Income Account (IncomeAccountRef)
//     — confirmed by reading full item+account detail, e.g.
//     "Tax:Corporate Tax Services" -> Income Account "Corporate Tax
//     Services" (its own, not shared). This is TAO's established
//     convention, not invented here.
//   - Which top-level parent Income Account a category's items roll up to
//     is NOT 1:1 — confirmed by walking every real sub-item's account
//     ownership: Tax (22/22 items) and Disbursement (13/13) each roll up
//     to exactly one parent ("Tax Services", "Other Income"); Accounts
//     mostly rolls up to "Accounting Services" but 1 item uses "Reporting
//     Services"; Secretary splits across 4 different parents (Professional
//     Services, Secretary Services, Payroll Services, Nominee Services) —
//     no single default exists for it. SUGGESTED_PARENT_ACCOUNT_BY_CATEGORY
//     below reflects exactly this — a suggestion for the 3 categories with
//     a clear dominant choice, none for the 2 that don't, rather than
//     guessing a wrong single mapping for Secretary/Other.
import { qbQuery, type QbCompany } from './quickbooks';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export type TaoServiceCategory = 'Accounts' | 'Tax' | 'Disbursement' | 'Secretary' | 'Other';

// Real QuickBooks TAO Category item ids — queried live 2026-10-04
// (`SELECT * FROM Item WHERE Type = 'Category'`), not invented.
export const TAO_CATEGORY_ITEM_ID: Record<TaoServiceCategory, string> = {
  Accounts: '1010000001',
  Disbursement: '1010000002',
  Other: '1010000021',
  Secretary: '1010000011',
  Tax: '1010000022',
};

// Only the 3 categories with one dominant real parent — see this file's own
// header comment for why Secretary/Other are deliberately absent rather
// than guessing one of their several real parents.
export const SUGGESTED_PARENT_ACCOUNT_BY_CATEGORY: Partial<Record<TaoServiceCategory, string>> = {
  Tax: '239', // "Tax Services"
  Disbursement: '255', // "Other Income"
  Accounts: '203', // "Accounting Services"
};

export type TaoServiceItem = {
  id: string;
  name: string;
  fullyQualifiedName: string;
  unitPrice: number | null;
  description: string | null;
};

// 'General' = items QuickBooks keeps outside the 5 categories (Discount
// Given, Sales, Contra, Company XBRL Fees, …) — QuickBooks' own dropdown
// lists them too, so the builder does as well (Vincent, 2026-10-05: "全部，
// 和 QuickBooks 一样"; until then they were silently left out, and staff keyed
// 58 of 786 TAO invoices this year straight into QuickBooks for them).
export type TaoCatalogGroup = TaoServiceCategory | 'General';

export type TaoServiceCatalog = {
  category: TaoCatalogGroup;
  items: TaoServiceItem[];
}[];

const CATEGORY_NAMES = Object.keys(TAO_CATEGORY_ITEM_ID) as TaoServiceCategory[];

// Replaces the old hardcoded TAO_PRODUCTS list in
// components/billing/TaoInvoiceBuilder.tsx — reads QuickBooks' own catalog
// directly every call so a service added here (or directly in QuickBooks
// by an accountant) shows up immediately, with no code change needed.
export async function fetchTaoServiceCatalog(company: QbCompany = 'TAO'): Promise<TaoServiceCatalog> {
  const result = await qbQuery("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1000", company);
  // A failed read must say so — an empty list here used to look like
  // "QuickBooks has no services" and the builder offered only Custom.
  if (!result) throw new Error(`QuickBooks ${company}'s service list could not be read.`);
  const rows = result.rows as Record<string, unknown>[];
  const byCategory = new Map<TaoCatalogGroup, TaoServiceItem[]>();
  for (const row of rows) {
    const parentName = (row.ParentRef as { name?: string } | undefined)?.name;
    const category: TaoCatalogGroup = row.SubItem && CATEGORY_NAMES.includes(parentName as TaoServiceCategory)
      ? parentName as TaoServiceCategory
      : 'General';
    const list = byCategory.get(category) ?? [];
    list.push({
      id: String(row.Id),
      name: String(row.Name ?? ''),
      fullyQualifiedName: String(row.FullyQualifiedName ?? row.Name ?? ''),
      unitPrice: typeof row.UnitPrice === 'number' ? row.UnitPrice : null,
      description: typeof row.Description === 'string' && row.Description ? row.Description : null,
    });
    byCategory.set(category, list);
  }
  return ([...CATEGORY_NAMES, 'General'] as TaoCatalogGroup[])
    .filter(c => byCategory.has(c))
    .map(category => ({ category, items: (byCategory.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name)) }));
}

export type TaoIncomeAccount = { id: string; name: string; fullyQualifiedName: string };

// For the "Add New Service" picker — every real top-level (non-sub) Income
// account, so a new service's account can be nested under one that matches
// how QuickBooks is actually organized today, not an invented structure.
export async function fetchTaoTopLevelIncomeAccounts(company: QbCompany = 'TAO'): Promise<TaoIncomeAccount[]> {
  const result = await qbQuery("SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 100", company);
  const rows = (result?.rows ?? []) as Record<string, unknown>[];
  return rows
    .filter(row => !row.SubAccount)
    .map(row => ({ id: String(row.Id), name: String(row.Name ?? ''), fullyQualifiedName: String(row.FullyQualifiedName ?? row.Name ?? '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type NewTaoServiceIncomeAccount =
  | { mode: 'existing'; accountId: string }
  | { mode: 'new'; parentAccountId: string; name?: string };

export type NewTaoServiceParams = {
  category: TaoServiceCategory;
  name: string;
  unitPrice?: number | null;
  description?: string | null;
  incomeAccount: NewTaoServiceIncomeAccount;
};

// The actual write — same shape/error-handling convention as
// lib/qb-invoice-conventions.ts's createCustomer(). Two QuickBooks writes
// when incomeAccount.mode is 'new' (the account, then the item that
// references it); one when reusing an existing account. Never half-applies
// silently: if the account create succeeds but the item create fails, the
// new (now-orphaned but harmless) account id is returned in the error so
// support/Vincent can find it in QuickBooks rather than it being invisible.
export async function createTaoService(
  token: string, realmId: string, params: NewTaoServiceParams,
): Promise<{ item: TaoServiceItem } | { error: string }> {
  let incomeAccountId: string;
  if (params.incomeAccount.mode === 'existing') {
    incomeAccountId = params.incomeAccount.accountId;
  } else {
    const accountRes = await fetch(`${QB_BASE}/v3/company/${realmId}/account?minorversion=65`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Name: params.incomeAccount.name?.trim() || params.name,
        AccountType: 'Income',
        AccountSubType: 'ServiceFeeIncome',
        SubAccount: true,
        ParentRef: { value: params.incomeAccount.parentAccountId },
      }),
    });
    if (!accountRes.ok) {
      const errText = await accountRes.text();
      return { error: `QuickBooks rejected the new income account: ${errText.slice(0, 300)}` };
    }
    const accountJson = await accountRes.json();
    const account = accountJson.Account as Record<string, unknown> | undefined;
    if (!account?.Id) return { error: 'QuickBooks returned an incomplete account result.' };
    incomeAccountId = String(account.Id);
  }

  const itemRes = await fetch(`${QB_BASE}/v3/company/${realmId}/item?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Name: params.name.trim(),
      Type: 'Service',
      SubItem: true,
      ParentRef: { value: TAO_CATEGORY_ITEM_ID[params.category] },
      IncomeAccountRef: { value: incomeAccountId },
      Taxable: false,
      ...(params.unitPrice ? { UnitPrice: params.unitPrice } : {}),
      ...(params.description?.trim() ? { Description: params.description.trim() } : {}),
    }),
  });
  if (!itemRes.ok) {
    const errText = await itemRes.text();
    const accountNote = params.incomeAccount.mode === 'new'
      ? ` A new income account (id ${incomeAccountId}) was already created in QuickBooks for this — check it there before retrying.`
      : '';
    return { error: `QuickBooks rejected the new service item: ${errText.slice(0, 300)}.${accountNote}` };
  }
  const itemJson = await itemRes.json();
  const item = itemJson.Item as Record<string, unknown> | undefined;
  if (!item?.Id) return { error: 'QuickBooks returned an incomplete item result.' };
  return {
    item: {
      id: String(item.Id),
      name: String(item.Name ?? params.name),
      fullyQualifiedName: String(item.FullyQualifiedName ?? `${params.category}:${params.name}`),
      unitPrice: typeof item.UnitPrice === 'number' ? item.UnitPrice : null,
      description: typeof item.Description === 'string' && item.Description ? item.Description : null,
    },
  };
}
