/**
 * Read-only diagnostic: explain the 785 (TW Total Client) vs 783 (Total
 * Records) vs 5 (Missing from Active Client) discrepancy on the Active
 * Client master-list page. Does NOT write anything.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function pageAll(table, select) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await sb.from(table).select(select).range(start, start + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

(async () => {
  const companies = await pageAll('companies', 'id, company_name, registration_no, client_type, is_active');
  const masterList = await pageAll('master_list', 'company_name, roc_no, list_type');

  const cssActive = companies.filter(c => c.client_type === 'CSS Client' && c.is_active === true);
  const cssAll = companies.filter(c => c.client_type === 'CSS Client');
  const activeClientRows = masterList.filter(r => r.list_type === 'active_client');

  console.log('TW Total Client (CSS Client + is_active=true):', cssActive.length);
  console.log('CSS Client regardless of is_active:', cssAll.length);
  console.log('master_list rows with list_type=active_client (Total Records):', activeClientRows.length);
  console.log('Total master_list rows (all list_types):', masterList.length);

  const knownUensAll = new Set(masterList.map(r => (r.roc_no ? String(r.roc_no).trim().toUpperCase() : null)).filter(Boolean));
  const activeClientUens = new Set(activeClientRows.map(r => (r.roc_no ? String(r.roc_no).trim().toUpperCase() : null)).filter(Boolean));

  // Current "Missing from Active Client" logic (post-fix): CSS Client + is_active=true, UEN not anywhere in master_list
  const missing = cssActive.filter(c => {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    return !uen || !knownUensAll.has(uen);
  });
  console.log('\n=== Missing from Active Client (current logic: CSS Client any status, UEN not ANYWHERE in master_list) ===');
  console.log('Count:', missing.length);
  missing.forEach(c => console.log(` - ${c.company_name} | UEN: ${c.registration_no || '(none)'} | is_active: ${c.is_active}`));

  // Naive "785 vs 783" style check: active CSS clients whose UEN isn't in the active_client list specifically
  const notInActiveClientList = cssActive.filter(c => {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    return !uen || !activeClientUens.has(uen);
  });
  console.log('\n=== Active CSS Clients whose UEN is NOT in the active_client list specifically (naive 785-vs-783 check) ===');
  console.log('Count:', notInActiveClientList.length);
  notInActiveClientList.forEach(c => console.log(` - ${c.company_name} | UEN: ${c.registration_no || '(none)'} | is_active: ${c.is_active}`));

  // Of the 5 "missing", how many are actually inactive (so wouldn't count toward the 785 total at all)?
  const missingButInactive = missing.filter(c => c.is_active !== true);
  console.log('\nOf the "missing" 5, inactive (not counted in the 785 TW Total Client figure):', missingButInactive.length);

  // Of the "notInActiveClientList" set, how many ARE found elsewhere in master_list (different list_type)?
  const foundElsewhere = notInActiveClientList.filter(c => {
    const uen = c.registration_no ? String(c.registration_no).trim().toUpperCase() : null;
    return uen && knownUensAll.has(uen);
  });
  console.log('Of the naive-check set, found elsewhere in master_list under a different list_type:', foundElsewhere.length);
  foundElsewhere.forEach(c => {
    const uen = String(c.registration_no).trim().toUpperCase();
    const match = masterList.find(r => r.roc_no && String(r.roc_no).trim().toUpperCase() === uen);
    console.log(`   - ${c.company_name} | UEN: ${c.registration_no} | found under list_type: ${match?.list_type}`);
  });

  // Reconcile the "TW CSS Clients" card (783): of the 783 active_client rows,
  // how many map to a CSS Client company that's specifically ACTIVE (vs any status)?
  const cssActiveUenSet = new Set(cssActive.map(c => (c.registration_no ? String(c.registration_no).trim().toUpperCase() : null)).filter(Boolean));
  const cssAnyUenSet = new Set(cssAll.map(c => (c.registration_no ? String(c.registration_no).trim().toUpperCase() : null)).filter(Boolean));
  const rowsMatchedCssAny = activeClientRows.filter(r => r.roc_no && cssAnyUenSet.has(String(r.roc_no).trim().toUpperCase()));
  const rowsMatchedCssActive = activeClientRows.filter(r => r.roc_no && cssActiveUenSet.has(String(r.roc_no).trim().toUpperCase()));
  console.log('\n=== Reconciling "TW CSS Clients" card ===');
  console.log('active_client rows matched to a CSS Client company (any status) — this is the 783 card:', rowsMatchedCssAny.length);
  console.log('active_client rows matched to a CSS Client company that is specifically is_active=true:', rowsMatchedCssActive.length);
  const rowsMatchedInactiveCss = rowsMatchedCssAny.filter(r => !cssActiveUenSet.has(String(r.roc_no).trim().toUpperCase()));
  console.log('active_client rows matched to a CSS Client company that is is_active=FALSE:', rowsMatchedInactiveCss.length);
  rowsMatchedInactiveCss.forEach(r => console.log(`   - ${r.company_name} | UEN: ${r.roc_no}`));
})();
