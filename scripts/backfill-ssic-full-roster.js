/**
 * One-off backfill: sync SSIC for every active company right now, instead
 * of waiting for the normal teamwork/sync-secretary rotation to reach them
 * naturally (~1 day). Vincent asked for this directly (2026-09-03) to
 * unblock testing the Reports SSIC analysis rebuild with real data today.
 *
 * Mirrors the extractSsic logic in lib/teamwork-company-profile.ts and the
 * non-destructive write rule in app/api/teamwork/sync-secretary/route.ts
 * (only writes when code1 OR code2 is present — never blanks a company
 * that genuinely has no SSIC on file, e.g. an offshore L.P.).
 *
 * Usage: node scripts/backfill-ssic-full-roster.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME;
const PASSWORD = process.env.TEAMWORK_PASSWORD;
const CONCURRENCY = 10; // matches the proven-safe concurrency for this exact TeamWork endpoint (lib/teamwork-company-profile.ts)

async function getSessionCookie() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('welcome')) {
      await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
      await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
      await page.getByRole('button', { name: ' Login' }).click();
      await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const c = (await ctx.cookies()).find(c => c.name === 'PHPSESSID');
    if (!c) throw new Error('No PHPSESSID after login');
    return `PHPSESSID=${c.value}`;
  } finally { await browser.close(); }
}
function fetchProfileHtml(cookie, companyId) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'apps.teamworkcss.com', path: `/tassure_asia/view_company/${companyId}/?comp`, method: 'GET', headers: { Cookie: cookie } }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}
function cleanSsicText(s) { return s.replace(/ |┬á/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractSsic(html) {
  const headingIdx = html.indexOf('>Principal Activities<');
  if (headingIdx === -1) return null;
  const after = html.slice(headingIdx);
  const tableMatch = after.match(/<table[^>]*class="tble principal_activities"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return null;
  const valueRe = /<label\s+class="item form-group[^"]*"[^>]*>([\s\S]*?)<\/label>/g;
  const values = [];
  let m;
  while ((m = valueRe.exec(tableMatch[1]))) values.push(cleanSsicText(m[1].replace(/<[^>]+>/g, '')));
  if (values.length < 6) return null;
  const norm = (s) => (s.toUpperCase() === 'NO ACTIVITY' ? '' : s);
  return { code1: norm(values[0]), code2: norm(values[1]), description1: norm(values[2]), description2: norm(values[3]), remarks1: norm(values[4]), remarks2: norm(values[5]) };
}

async function main() {
  const { data: companies, error } = await sb.from('companies')
    .select('id, company_name, internal_id')
    .eq('is_active', true)
    .not('internal_id', 'is', null);
  if (error) { console.error(error); process.exit(1); }
  console.log(`Backfilling SSIC for ${companies.length} active companies...`);

  const cookie = await getSessionCookie();
  const now = new Date().toISOString();
  let updated = 0, skippedEmpty = 0, fetchErrors = 0, writeErrors = 0;
  let next = 0;

  const worker = async () => {
    while (next < companies.length) {
      const c = companies[next++];
      let html;
      try {
        html = await fetchProfileHtml(cookie, c.internal_id);
      } catch (e) {
        fetchErrors++;
        console.log(`[${next}/${companies.length}] FETCH ERROR ${c.company_name}: ${e.message}`);
        continue;
      }
      const ssic = extractSsic(html);
      if (!ssic || (!ssic.code1 && !ssic.code2)) { skippedEmpty++; continue; }
      const { error: writeErr } = await sb.from('companies').update({
        ssic_code_1: ssic.code1 || null, ssic_description_1: ssic.description1 || null, ssic_remarks_1: ssic.remarks1 || null,
        ssic_code_2: ssic.code2 || null, ssic_description_2: ssic.description2 || null, ssic_remarks_2: ssic.remarks2 || null,
        ssic_synced_at: now,
      }).eq('id', c.id);
      if (writeErr) { writeErrors++; console.log(`[${next}/${companies.length}] WRITE ERROR ${c.company_name}: ${writeErr.message}`); continue; }
      updated++;
      if (next % 50 === 0) console.log(`[${next}/${companies.length}] progress: ${updated} updated, ${skippedEmpty} skipped (no SSIC), ${fetchErrors} fetch errors, ${writeErrors} write errors`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length) }, () => worker()));

  console.log('DONE.');
  console.log(`Total: ${companies.length}, updated: ${updated}, skipped (no SSIC found): ${skippedEmpty}, fetch errors: ${fetchErrors}, write errors: ${writeErrors}`);
}
main().catch(e => { console.error(e); process.exit(1); });
