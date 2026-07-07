/**
 * Applies the low-risk subset of the TeamWork vs Supabase diff:
 *   - tw_status: always overwrite with TeamWork value (authoritative)
 *   - fye_month: always overwrite with TeamWork value (authoritative)
 *   - registration_no: only overwrite when current is null/empty, or when
 *     the only difference is whitespace (never overwrite a non-blank value
 *     with a blank TW value, and never overwrite one non-blank value with
 *     a different non-blank value — that needs human review).
 *
 * Does NOT touch QB-derived fields or best_email/internal_id.
 * Reads data/teamwork-api/diff-report.json produced by diff-teamwork-vs-supabase.js.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const DRY_RUN = process.argv.includes('--dry-run');

function normWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const diffPath = path.join(__dirname, '..', 'data', 'teamwork-api', 'diff-report.json');
  const diffs = JSON.parse(fs.readFileSync(diffPath, 'utf-8'));

  let updated = 0;

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Applying tw_status fixes (${diffs.tw_status.length})...`);
  for (const d of diffs.tw_status) {
    console.log(`  #${d.id} ${d.company_name}: "${d.current}" -> "${d.tw}"`);
    if (!DRY_RUN) {
      const { error } = await sb.from('companies').update({ tw_status: d.tw }).eq('id', d.id);
      if (error) { console.error('    ERROR:', error.message); continue; }
    }
    updated++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Applying fye_month fixes (${diffs.fye_month.length})...`);
  for (const d of diffs.fye_month) {
    console.log(`  #${d.id} ${d.company_name}: "${d.current}" -> "${d.tw}"`);
    if (!DRY_RUN) {
      const { error } = await sb.from('companies').update({ fye_month: d.tw }).eq('id', d.id);
      if (error) { console.error('    ERROR:', error.message); continue; }
    }
    updated++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Applying safe registration_no fixes...`);
  let regSkipped = 0;
  for (const d of diffs.registration_no) {
    const currentBlank = !d.current || normWhitespace(d.current) === '';
    const twBlank = !d.tw || normWhitespace(d.tw) === '';
    const sameIgnoringWhitespace = normWhitespace(d.current) === normWhitespace(d.tw);

    if (twBlank) {
      regSkipped++;
      continue; // never overwrite with a blank TW value
    }
    if (!currentBlank && !sameIgnoringWhitespace) {
      regSkipped++;
      continue; // both non-blank and genuinely different -> needs human review
    }
    // Either current was blank (fill in from TW), or only whitespace differs (normalize)
    const newVal = normWhitespace(d.tw);
    console.log(`  #${d.id} ${d.company_name}: "${d.current}" -> "${newVal}"`);
    if (!DRY_RUN) {
      const { error } = await sb.from('companies').update({ registration_no: newVal }).eq('id', d.id);
      if (error) { console.error('    ERROR:', error.message); continue; }
    }
    updated++;
  }
  console.log(`  (skipped ${regSkipped} registration_no diffs needing human review)`);

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Total rows updated: ${updated}`);
  console.log('\nNOT touched (needs manual review): best_email (' + diffs.best_email.length + '), no_tw_match (' + diffs.no_tw_match.length + ')');
}

main();
