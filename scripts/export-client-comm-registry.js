/**
 * One-off export: a "Company Legal Name / Short Name / Registration No. /
 * Salutation / To Email / Cc Email" workbook (Vincent's screenshot format,
 * 2026-08-17), pulled from the live `companies` table since no page/table in
 * this codebase has that exact shape — closest real data:
 *   - COMPANY LEGAL NAME -> companies.company_name
 *   - SHORT NAME          -> company_name with the legal-entity suffix
 *                            (PTE. LTD. / PRIVATE LIMITED / LLP / ...) and
 *                            any trailing "(F.K.A. ...)" note stripped
 *   - REGISTRATION NO.    -> companies.registration_no
 *   - SALUTATION           -> companies.primary_contact.contactName,
 *                            title-cased (source is ALL-CAPS)
 *   - TO EMAIL / CC EMAIL  -> companies.tw_to_emails / tw_cc_emails
 *                            (TeamWork-synced arrays), "; "-joined
 * Scoped to is_active=true (current clients only), sorted by company_name.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function shortName(name) {
  return (name ?? '')
    .replace(/\s*\(F\.?K\.?A\.?[^)]*\)\s*$/i, '')
    .replace(/\s*,?\s*(PTE\.?\s*LTD\.?|PRIVATE\s+LIMITED|PUBLIC\s+LIMITED|LLP|L\.?P\.?|LTD\.?)\s*$/i, '')
    .trim();
}

function titleCase(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed || /[一-鿿]/.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function pageAll(select) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await sb.from('companies').select(select).eq('is_active', true).range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

(async () => {
  const rows = await pageAll('company_name, registration_no, primary_contact, tw_to_emails, tw_cc_emails, best_email');
  rows.sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? ''));

  const sheetRows = rows.map(r => ({
    'COMPANY LEGAL NAME': r.company_name ?? '',
    'SHORT NAME': shortName(r.company_name),
    'REGISTRATION NO.': r.registration_no ?? '',
    'SALUTATION': titleCase(r.primary_contact?.contactName ?? ''),
    'TO EMAIL': (r.tw_to_emails?.length ? r.tw_to_emails : (r.best_email ? [r.best_email] : [])).join('; '),
    'CC EMAIL': (r.tw_cc_emails ?? []).join('; '),
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Client Communications');

  const outPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'client-communications-registry.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log(`Wrote ${sheetRows.length} rows to ${outPath}`);
})();
