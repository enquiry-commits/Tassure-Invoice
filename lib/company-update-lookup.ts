import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { resolveCompany, normalize } from '@/lib/company-name';
import { CUSTOMER_SOURCE_OPTIONS, customerSourceLabel } from '@/lib/customer-source';

/**
 * READ-ONLY preview of a company-settings change (2026-09-10).
 *
 * Covers the three real edits the `companies` table exposes, each of which
 * had its own narrow endpoint and lived only on its own page:
 *   - service override (companies.services_manual, /api/companies/service-override)
 *   - customer source  (companies.customer_source, /api/companies/customer-source)
 *   - parent company   (companies.parent_company_id, /api/companies/parent)
 *
 * The service override is the one with real downstream weight: it is what
 * forces a service badge ON or OFF against the automatic judgement, and
 * billing reads that. Its endpoint's own comment is worth repeating —
 * services_manual is written ONLY by that endpoint, never by any sync, so a
 * human decision can never be clobbered by automation. Which also means a
 * careless chat-driven override is not something a later sync will heal.
 * Hence the preview shows all three states plainly: what the automatic
 * judgement says, what override (if any) is currently set, and what the
 * effective answer would become.
 *
 * Writes nothing. The card PATCHes the real endpoint on the user's click
 * (INV-DATA-033).
 */

export const COMPANY_SERVICE_FIELDS = ['secretary', 'accounts', 'tax', 'xbrl'] as const;
export type CompanyServiceField = typeof COMPANY_SERVICE_FIELDS[number];
// Master List fields chat may touch — deliberately TWO out of ~45, the
// same narrowing principle as AR_CHAT_EDITABLE_FIELDS. Chosen from the
// real data, not from the schema: `grade` is clean and structured (A 277 /
// B 88 / C 35), `remark` is free text nobody can corrupt. Everything else
// is excluded on purpose — the compliance dates belong to AR Reminder and
// have their own tool, directors/shareholders/secretary/status are written
// by the TeamWork sync, and `kyc_year` is already so dirty in production
// (18 rows contain a postal ADDRESS in a year field) that letting a
// sentence write into it would only add to the mess.
export const MASTER_LIST_CHAT_FIELDS = ['remark', 'grade'] as const;
export type MasterListChatField = typeof MASTER_LIST_CHAT_FIELDS[number];
export const GRADE_VALUES = ['A', 'B', 'C'] as const;

export type CompanyUpdateField = `service:${CompanyServiceField}` | `master:${MasterListChatField}` | 'customer_source' | 'parent_company';

export type CompanyUpdatePreview = {
  companyId: number;
  companyName: string;
  field: CompanyUpdateField;
  fieldLabel: string;
  // For a service field: what the automatic judgement says, independent of
  // any override. Null for the non-service fields.
  autoValue: boolean | null;
  currentDisplay: string;
  proposedDisplay: string;
  // The raw value the endpoint will receive, so the card never re-parses
  // the user's words.
  proposedValue: boolean | string | number | null;
  // Master List's PATCH is conflict-safe and REFUSES a request without the
  // previous value (HTTP 428) — the card must send back exactly what this
  // preview saw, so a value someone else changed meanwhile is rejected
  // instead of silently overwritten. Only set for master:* fields.
  rowId?: number;
  previousValue?: string | null;
  endpoint: string;
  alreadyThatValue: boolean;
  warning: string | null;
};

export type CompanyUpdateResult =
  | { found: true; preview: CompanyUpdatePreview }
  | { found: false; ambiguous: true; message: string; candidates: string[] }
  | { found: false; ambiguous?: false; message: string };

type Row = {
  id: number; company_name: string;
  has_accounts: boolean | null; has_tax: boolean | null; has_xbrl: boolean | null;
  services_manual: Record<string, boolean> | null;
  customer_source: string | null;
  parent_company_id: number | null;
};

const AUTO_COLUMN: Record<CompanyServiceField, keyof Row | null> = {
  // Secretary has no has_* column — it is the baseline CSS service, so the
  // automatic judgement is made elsewhere and only the override is stored.
  secretary: null,
  accounts: 'has_accounts',
  tax: 'has_tax',
  xbrl: 'has_xbrl',
};

const onOff = (v: boolean | null | undefined) => v === true ? 'ON' : v === false ? 'OFF' : '自动判断';

export async function previewCompanyUpdate(
  companyQuery: string,
  field: CompanyUpdateField,
  rawValue: unknown,
): Promise<CompanyUpdateResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();
  if (!trimmed) return { found: false, message: 'A company name is required.' };

  const { data: rows } = await sb.from('companies')
    .select('id, company_name, has_accounts, has_tax, has_xbrl, services_manual, customer_source, parent_company_id')
    .eq('is_active', true);
  const list = (rows ?? []) as Row[];

  const resolution = resolveCompany(trimmed, list, c => c.company_name);
  if (resolution.kind === 'ambiguous') {
    return {
      found: false, ambiguous: true,
      message: `Several companies match "${trimmed}" — ask which one before changing anything.`,
      candidates: resolution.candidates.map(c => c.company_name),
    };
  }
  if (resolution.kind === 'none') return { found: false, message: `No active company matched "${trimmed}".` };
  const company = resolution.kind === 'exact' ? resolution.value : resolution.value;

  if (field.startsWith('service:')) {
    const svc = field.slice('service:'.length) as CompanyServiceField;
    if (!COMPANY_SERVICE_FIELDS.includes(svc)) {
      return { found: false, message: `Service must be one of: ${COMPANY_SERVICE_FIELDS.join(', ')}. ND and Address follow TeamWork and cannot be overridden here.` };
    }
    if (rawValue !== true && rawValue !== false && rawValue !== null) {
      return { found: false, message: 'A service override must be true (force ON), false (force OFF) or null (clear the override and go back to automatic judgement).' };
    }
    const autoCol = AUTO_COLUMN[svc];
    const autoValue = autoCol ? ((company[autoCol] as boolean | null) ?? false) : null;
    const currentOverride = company.services_manual?.[svc];
    const effectiveNow = currentOverride ?? autoValue;

    return {
      found: true,
      preview: {
        companyId: company.id,
        companyName: company.company_name,
        field, fieldLabel: `${svc.toUpperCase()} 服务`,
        autoValue,
        // Secretary has no has_* column (autoValue null), so saying
        // "自动判断：自动判断" would be nonsense — describe it as having no
        // stored automatic flag instead.
        currentDisplay: `${onOff(effectiveNow)}（自动判断：${autoValue === null ? '无固定标记' : onOff(autoValue)}，人工覆盖：${currentOverride === undefined ? '无' : onOff(currentOverride)}）`,
        proposedDisplay: rawValue === null
          ? `清除人工覆盖，回到自动判断（${autoValue === null ? '无固定标记' : onOff(autoValue)}）`
          : `强制 ${onOff(rawValue)}（人工覆盖，同步不会改动它）`,
        proposedValue: rawValue,
        endpoint: '/api/companies/service-override',
        alreadyThatValue: currentOverride === rawValue || (rawValue === null && currentOverride === undefined),
        warning: rawValue !== null
          ? 'services_manual 只由这个接口写入，任何自动同步都不会再纠正它——设错了要人工改回来。这个开关会影响开单。'
          : null,
      },
    };
  }

  if (field.startsWith('master:')) {
    const mf = field.slice('master:'.length) as MasterListChatField;
    if (!MASTER_LIST_CHAT_FIELDS.includes(mf)) {
      return { found: false, message: `Only these Master List fields can be changed from chat: ${MASTER_LIST_CHAT_FIELDS.join(', ')}. Everything else is either owned by the TeamWork sync or belongs to AR Reminder — say so plainly instead of trying another field name.` };
    }
    const next = rawValue === null || rawValue === '' ? null : String(rawValue).trim();
    if (mf === 'grade' && next !== null && !GRADE_VALUES.includes(next.toUpperCase() as typeof GRADE_VALUES[number])) {
      return { found: false, message: `Grade must be one of: ${GRADE_VALUES.join(', ')}, or empty to clear it.` };
    }
    const value = mf === 'grade' && next ? next.toUpperCase() : next;

    // Match master_list through normalize(), NOT an exact name compare.
    // Confirmed real: companies stores "1V CAPITAL PTE. LTD." and
    // master_list stores "1V CAPITAL PTE. LTD" — one trailing dot apart —
    // so an exact/ilike match reported "no Master List row" for a company
    // that plainly has one. The two tables are joined by name everywhere
    // in this codebase and their spellings genuinely differ; normalize()
    // exists for exactly this and must not be bypassed.
    const { data: mlRows } = await sb.from('master_list')
      .select('id, company_name, list_type, remark, grade');
    const all = (mlRows ?? []) as { id: number; company_name: string; list_type: string; remark: string | null; grade: string | null }[];
    const wanted = normalize(company.company_name);
    const rows = all.filter(r => normalize(r.company_name) === wanted);
    // A company can have rows under more than one list_type; the live one
    // is what a person means, with a fallback so a former client stays
    // editable.
    const row = rows.find(r => r.list_type === 'active_client') ?? rows[0];
    if (!row) return { found: false, message: `"${company.company_name}" has no Master List row, so there is nothing to edit there.` };

    const current = (row[mf] ?? null) as string | null;
    return {
      found: true,
      preview: {
        companyId: company.id,
        companyName: company.company_name,
        field, fieldLabel: mf === 'grade' ? 'Master List 等级 (Grade)' : 'Master List 备注 (Remark)',
        autoValue: null,
        currentDisplay: current ?? '（空）',
        proposedDisplay: value ?? '（清空）',
        proposedValue: value,
        rowId: row.id,
        previousValue: current,
        endpoint: '/api/master-list',
        alreadyThatValue: current === value,
        warning: null,
      },
    };
  }

  if (field === 'customer_source') {
    const valid = new Set(CUSTOMER_SOURCE_OPTIONS.map(o => o.value));
    if (rawValue !== null && (typeof rawValue !== 'string' || !valid.has(rawValue))) {
      return { found: false, message: `Customer source must be one of: ${[...valid].join(', ')}, or null to clear it.` };
    }
    return {
      found: true,
      preview: {
        companyId: company.id, companyName: company.company_name,
        field, fieldLabel: '客户来源',
        autoValue: null,
        currentDisplay: customerSourceLabel(company.customer_source),
        proposedDisplay: customerSourceLabel(rawValue as string | null),
        proposedValue: (rawValue as string | null) ?? null,
        endpoint: '/api/companies/customer-source',
        alreadyThatValue: (company.customer_source ?? null) === ((rawValue as string | null) ?? null),
        warning: null,
      },
    };
  }

  // parent_company — the value arrives as a NAME and is resolved to a real
  // id here, so the card never sends a name the endpoint would reject.
  if (rawValue !== null && typeof rawValue !== 'string') {
    return { found: false, message: 'A parent company must be given as a company name, or null to clear it.' };
  }
  let parentId: number | null = null;
  let parentName = '（无）';
  if (rawValue) {
    const parentRes = resolveCompany(rawValue, list, c => c.company_name);
    if (parentRes.kind === 'ambiguous') {
      return {
        found: false, ambiguous: true,
        message: `Several companies match the PARENT name "${rawValue}" — ask which one.`,
        candidates: parentRes.candidates.map(c => c.company_name),
      };
    }
    if (parentRes.kind === 'none') return { found: false, message: `No active company matched the parent name "${rawValue}".` };
    const parent = parentRes.kind === 'exact' ? parentRes.value : parentRes.value;
    if (parent.id === company.id) return { found: false, message: 'A company cannot be its own parent.' };
    parentId = parent.id;
    parentName = parent.company_name;
  }
  const currentParent = company.parent_company_id
    ? (list.find(c => c.id === company.parent_company_id)?.company_name ?? `#${company.parent_company_id}`)
    : '（无）';

  return {
    found: true,
    preview: {
      companyId: company.id, companyName: company.company_name,
      field, fieldLabel: '母公司',
      autoValue: null,
      currentDisplay: currentParent,
      proposedDisplay: parentName,
      proposedValue: parentId,
      endpoint: '/api/companies/parent',
      alreadyThatValue: (company.parent_company_id ?? null) === parentId,
      warning: null,
    },
  };
}
