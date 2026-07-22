import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize, findUniqueBestMatch } from './company-name';
import { applyCampaignRecipientRules } from './campaign-recipients';
import { getSessionCookie } from './teamwork-agm';

const REPORT_URL = 'https://apps.teamworkcss.com/tassure_asia/report_module/remainder_upcoming_event_report';
const REPORT_PAGE_URL = 'https://apps.teamworkcss.com/tassure_asia/report_module/remainder_upcoming_event_report_list';
const PAGE_SIZE = 100;

type ReportResponse = {
  data?: unknown[][];
  recordsTotal?: number;
  recordsFiltered?: number;
};

type CompanyRecipientRow = {
  id: number;
  company_name: string;
  tw_to_emails: string[] | null;
  tw_cc_emails: string[] | null;
};

function stripHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeDataTableBody(start: number): string {
  const params: Record<string, string> = {
    draw: String(Math.floor(start / PAGE_SIZE) + 1),
    start: String(start),
    length: String(PAGE_SIZE),
    'search[value]': '',
    'search[regex]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'asc',
    csrf_test_name: '',
    from_date: '',
    to_date: '',
    company_id: '',
    receiving_party: '',
    select_month: '',
    event_type: '',
    company_group: '',
  };
  for (let i = 0; i < 9; i++) {
    params[`columns[${i}][data]`] = String(i);
    params[`columns[${i}][name]`] = '';
    params[`columns[${i}][searchable]`] = 'true';
    params[`columns[${i}][orderable]`] = i < 5 ? 'true' : 'false';
    params[`columns[${i}][search][value]`] = '';
    params[`columns[${i}][search][regex]`] = 'false';
  }
  return new URLSearchParams(params).toString();
}

async function fetchReportPage(cookie: string, start: number): Promise<ReportResponse> {
  const response = await fetch(REPORT_URL, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: REPORT_PAGE_URL,
    },
    body: makeDataTableBody(start),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`TeamWork recipient report HTTP ${response.status}.`);
  try {
    const parsed = JSON.parse(text.trim()) as ReportResponse;
    if (!Array.isArray(parsed.data)) throw new Error('missing data array');
    return parsed;
  } catch (error) {
    throw new Error(`TeamWork recipient report returned invalid data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchAllReportRows(cookie: string): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  for (let start = 0; start < 10_000; start += PAGE_SIZE) {
    const page = await fetchReportPage(cookie, start);
    const batch = page.data ?? [];
    rows.push(...batch);
    const total = page.recordsFiltered ?? page.recordsTotal;
    if (!batch.length || batch.length < PAGE_SIZE || (typeof total === 'number' && rows.length >= total)) break;
  }
  if (!rows.length) throw new Error('TeamWork recipient report returned no rows; database was not changed.');
  return rows;
}

function sameEmails(a: string[] | null, b: string[]): boolean {
  return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
}

export async function syncTeamworkCampaignRecipients(supabase: SupabaseClient) {
  const reportRows = await fetchAllReportRows(await getSessionCookie());
  const directory = new Map<string, { companyName: string; emails: Set<string> }>();

  for (const row of reportRows) {
    // TeamWork DataTable columns: 1 = Entity Name, 7 = Recipients.
    const companyName = stripHtml(row[1]);
    if (!companyName) continue;
    const key = normalize(companyName);
    const entry = directory.get(key) ?? { companyName, emails: new Set<string>() };
    for (const email of String(row[7] ?? '').split(/<br\s*\/?\s*>|[,;\s]+/i)) {
      const cleaned = stripHtml(email).toLowerCase();
      if (cleaned) entry.emails.add(cleaned);
    }
    directory.set(key, entry);
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, company_name, tw_to_emails, tw_cc_emails');
  if (error) throw new Error(`Campaign recipient migration is not ready: ${error.message}`);
  const companies = (data ?? []) as CompanyRecipientRow[];
  const exactByName = new Map<string, CompanyRecipientRow | null>();
  for (const company of companies) {
    const key = normalize(company.company_name);
    exactByName.set(key, exactByName.has(key) ? null : company);
  }

  const now = new Date().toISOString();
  const updates: Array<{ company: CompanyRecipientRow; toEmails: string[]; ccEmails: string[]; changed: boolean }> = [];
  const unmatched: string[] = [];
  for (const [key, entry] of directory) {
    let company = exactByName.get(key) ?? null;
    if (!company) {
      company = findUniqueBestMatch(entry.companyName, companies, item => item.company_name, 85).value;
    }
    if (!company) {
      unmatched.push(entry.companyName);
      continue;
    }
    const { toEmails, ccEmails } = applyCampaignRecipientRules(entry.emails);
    updates.push({
      company,
      toEmails,
      ccEmails,
      changed: !sameEmails(company.tw_to_emails, toEmails) || !sameEmails(company.tw_cc_emails, ccEmails),
    });
  }

  const errors: string[] = [];
  let refreshed = 0;
  for (let i = 0; i < updates.length; i += 10) {
    const results = await Promise.all(updates.slice(i, i + 10).map(async item => {
      const { error: updateError } = await supabase.from('companies').update({
        tw_to_emails: item.toEmails,
        tw_cc_emails: item.ccEmails,
        tw_recipient_source: 'teamwork_report',
        tw_recipient_synced_at: now,
      }).eq('id', item.company.id);
      return updateError?.message ?? null;
    }));
    for (const updateError of results) {
      if (updateError) errors.push(updateError);
      else refreshed++;
    }
  }

  if (errors.length) throw new Error(`Unable to update ${errors.length} TeamWork recipient records: ${errors[0]}`);
  return {
    report_rows: reportRows.length,
    report_companies: directory.size,
    matched_companies: directory.size - unmatched.length,
    refreshed_companies: refreshed,
    changed_companies: updates.filter(item => item.changed).length,
    unchanged_companies: updates.filter(item => !item.changed).length,
    unmatched_companies: unmatched.length,
    unmatched_names: unmatched.slice(0, 20),
  };
}
