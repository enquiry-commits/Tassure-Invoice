/**
 * Read-only diagnostic: how complete is the Active Client Last AR/AGM/Accts
 * Date + Next AGM Due automation? Breaks down NA (literal string) vs truly
 * blank (null) vs populated, and cross-checks against whether the row is
 * even matched to a TeamWork company at all (in_teamwork) and whether any
 * of these fields are flagged manual (which pauses automation on that field).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function pageAll(table, select, filter) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    let q = sb.from(table).select(select).range(start, start + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

(async () => {
  const rows = await pageAll(
    'master_list',
    'id, company_name, roc_no, last_agm_date, last_ar_date, last_accounts_date, next_agm_due_date, manual_fields',
    q => q.eq('list_type', 'active_client'),
  );
  const companies = await pageAll('companies', 'registration_no, client_type, is_active, internal_id');
  const twUenSet = new Set(companies.map(c => (c.registration_no ? String(c.registration_no).trim().toUpperCase() : null)).filter(Boolean));

  console.log('Total active_client rows:', rows.length);

  const FIELDS = ['last_agm_date', 'last_ar_date', 'last_accounts_date', 'next_agm_due_date'];
  for (const f of FIELDS) {
    const naCount = rows.filter(r => r[f] === 'NA' || r[f] === 'N/A' || r[f] === 'na').length;
    const blankCount = rows.filter(r => r[f] === null || r[f] === '').length;
    const populated = rows.length - naCount - blankCount;
    const manualCount = rows.filter(r => r.manual_fields && r.manual_fields[f]).length;
    console.log(`\n${f}: populated=${populated} | NA-literal=${naCount} | blank/null=${blankCount} | manual-flagged=${manualCount}`);
  }

  // Rows matched to TeamWork at all vs not
  const notInTeamwork = rows.filter(r => {
    const uen = r.roc_no ? String(r.roc_no).trim().toUpperCase() : null;
    return !uen || !twUenSet.has(uen);
  });
  console.log('\nActive Client rows NOT matched to any TeamWork company (no automation source at all):', notInTeamwork.length);
  notInTeamwork.slice(0, 20).forEach(r => console.log(`   - ${r.company_name} | UEN: ${r.roc_no ?? '(none)'}`));
  if (notInTeamwork.length > 20) console.log(`   ... and ${notInTeamwork.length - 20} more`);

  // Of rows that ARE matched to TeamWork, how many still have ALL FOUR fields blank/NA?
  const matchedButAllEmpty = rows.filter(r => {
    const uen = r.roc_no ? String(r.roc_no).trim().toUpperCase() : null;
    const matched = uen && twUenSet.has(uen);
    if (!matched) return false;
    return FIELDS.every(f => r[f] === null || r[f] === '' || r[f] === 'NA' || r[f] === 'N/A');
  });
  console.log('\nMatched to TeamWork, but ALL FOUR date fields still empty/NA:', matchedButAllEmpty.length);
  matchedButAllEmpty.slice(0, 20).forEach(r => console.log(`   - ${r.company_name} | UEN: ${r.roc_no}`));
  if (matchedButAllEmpty.length > 20) console.log(`   ... and ${matchedButAllEmpty.length - 20} more`);
})();
