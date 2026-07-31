import type { SupabaseClient } from '@supabase/supabase-js';
import https from 'https';
import { normalize, findUniqueBestMatch } from './company-name';
import { getSessionCookie } from './teamwork-agm';

// TeamWork's "Company Contact Person" report (Report_module/comp_contact_default_report)
// — one row per contact person, not per company, and covers every company on
// file (1400+ rows) regardless of whether it has an upcoming AR/AGM event.
// This fills the gap the "upcoming events" recipient report
// (lib/teamwork-recipients.ts) structurally can't: a company only appears
// there if it has a scheduled reminder, so ~19% of active companies had NO
// email source at all (confirmed 2026-07-31: 174 of 922). Used only as a
// FILL-IN for companies missing every existing email source (tw_to_emails,
// best_email, primary_contact) — never overwrites a value another sync
// already populated.
const REPORT_URL = 'https://apps.teamworkcss.com/tassure_asia/report_module/comp_contact_default_report';
const PAGE_SIZE = 100;

type ContactReportRow = {
  companyName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
};

type CompanyRow = {
  id: number;
  company_name: string;
  tw_to_emails: string[] | null;
  best_email: string | null;
  primary_contact: { contactName?: string; email?: string; phone?: string } | null;
};

function dedupeEmails(rows: ContactReportRow[]): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const row of rows) {
    if (!row.email || seen.has(row.email)) continue;
    seen.add(row.email);
    emails.push(row.email);
  }
  return emails;
}

function stripHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Column 1 is "COMPANY NAME<br/>UEN" — split off just the name.
function companyNameOf(cell: unknown): string {
  return stripHtml(String(cell ?? '').split(/<br\s*\/?\s*>/i)[0]);
}

function fetchReportPage(cookie: string, start: number): Promise<{ data: unknown[][]; recordsTotal?: number; recordsFiltered?: number }> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = {
      draw: String(Math.floor(start / PAGE_SIZE) + 1),
      start: String(start),
      length: String(PAGE_SIZE),
      'search[value]': '',
      'search[regex]': 'false',
      'order[0][column]': '0',
      'order[0][dir]': 'asc',
      csrf_test_name: '',
      member_id: '',
      company_id: '',
      from_date: '',
      to_date: '',
      from_date1: '',
      to_date1: '',
      status: '',
      cmp_desg: '',
      pic: '',
      company_group: '',
      cp_status: '',
    };
    for (let i = 0; i < 12; i++) {
      params[`columns[${i}][data]`] = String(i);
      params[`columns[${i}][name]`] = '';
      params[`columns[${i}][searchable]`] = 'true';
      params[`columns[${i}][orderable]`] = 'true';
      params[`columns[${i}][search][value]`] = '';
      params[`columns[${i}][search][regex]`] = 'false';
    }
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'apps.teamworkcss.com',
      path: '/tassure_asia/report_module/comp_contact_default_report',
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`TeamWork contact report HTTP ${res.statusCode ?? 'unknown'}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (!Array.isArray(parsed.data)) throw new Error('missing data array');
          resolve(parsed);
        } catch (error) {
          reject(new Error(`TeamWork contact report returned invalid data: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('TeamWork contact report request timed out after 30 seconds.')));
    req.write(body);
    req.end();
  });
}

async function fetchAllContactRows(cookie: string): Promise<ContactReportRow[]> {
  const rows: ContactReportRow[] = [];
  for (let start = 0; start < 5_000; start += PAGE_SIZE) {
    const page = await fetchReportPage(cookie, start);
    const batch = page.data ?? [];
    for (const row of batch) {
      const companyName = companyNameOf(row[1]);
      if (!companyName) continue;
      const email = stripHtml(row[5]).toLowerCase() || stripHtml(row[8]).toLowerCase() || null;
      rows.push({
        companyName,
        contactName: stripHtml(row[2]),
        email: email || null,
        phone: stripHtml(row[6]) || null,
      });
    }
    const total = page.recordsFiltered ?? page.recordsTotal;
    if (!batch.length || batch.length < PAGE_SIZE || (typeof total === 'number' && rows.length >= total)) break;
  }
  if (!rows.length) throw new Error('TeamWork contact report returned no rows; database was not changed.');
  return rows;
}

export async function syncTeamworkContactPersons(supabase: SupabaseClient) {
  const rows = await fetchAllContactRows(await getSessionCookie());

  // Every contact row with an email, grouped per company — a company can
  // legitimately have more than one contact person (e.g. two directors),
  // and every one of them should land in the To field, not just the first.
  const byCompany = new Map<string, ContactReportRow[]>();
  for (const row of rows) {
    if (!row.email) continue;
    const key = normalize(row.companyName);
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(row);
  }
  const companyNamesForFuzzyMatch = [...byCompany.keys()].map(key => ({ key, companyName: byCompany.get(key)![0].companyName }));

  const { data, error } = await supabase
    .from('companies')
    .select('id, company_name, tw_to_emails, best_email, primary_contact');
  if (error) throw new Error(`Contact-person fill-in is not ready: ${error.message}`);
  const companies = (data ?? []) as CompanyRow[];

  // tw_to_emails is what recipient resolution actually sends to (see
  // pickContact() in client-comms-resolve.ts) — a company can have a
  // best_email/primary_contact on file yet still have an empty
  // tw_to_emails (e.g. the upcoming-events report found only a staff CC
  // for it), which silently drops that email at send time. Any company
  // with an empty tw_to_emails is a real gap, whether or not a fallback
  // field happens to be populated — never overrides a non-empty
  // tw_to_emails another sync already populated.
  const gaps = companies.filter(c => !(Array.isArray(c.tw_to_emails) && c.tw_to_emails.length));

  const now = new Date().toISOString();
  let filled = 0;
  const errors: string[] = [];
  const updates: { id: number; contactName: string; email: string; phone: string | null; allEmails: string[] }[] = [];

  for (const gap of gaps) {
    const key = normalize(gap.company_name);
    let matchRows = byCompany.get(key);
    if (!matchRows) {
      const fuzzy = findUniqueBestMatch(gap.company_name, companyNamesForFuzzyMatch, item => item.companyName, 90);
      matchRows = fuzzy.value ? byCompany.get(fuzzy.value.key) : undefined;
    }
    const allEmails = matchRows ? dedupeEmails(matchRows) : [];
    if (!allEmails.length) continue;
    const first = matchRows![0];
    updates.push({ id: gap.id, contactName: first.contactName, email: first.email!, phone: first.phone, allEmails });
  }

  for (let i = 0; i < updates.length; i += 10) {
    const results = await Promise.all(updates.slice(i, i + 10).map(async u => {
      const { error: updateError } = await supabase.from('companies').update({
        primary_contact: { contactName: u.contactName, email: u.email, phone: u.phone },
        best_email: u.email,
        tw_to_emails: u.allEmails,
        tw_recipient_source: 'contact_person_report',
        tw_recipient_synced_at: now,
        synced_at: now,
      }).eq('id', u.id);
      return updateError?.message ?? null;
    }));
    for (const updateError of results) {
      if (updateError) errors.push(updateError);
      else filled++;
    }
  }

  if (errors.length) throw new Error(`Unable to update ${errors.length} contact-person fill-in records: ${errors[0]}`);
  return {
    report_rows: rows.length,
    report_companies: byCompany.size,
    companies_with_no_email_source: gaps.length,
    filled,
  };
}
