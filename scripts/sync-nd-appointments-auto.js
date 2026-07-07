/**
 * Fully automated ND (Nominee Director) appointment sync — meant to run on a
 * schedule (Windows Task Scheduler). Logs into TeamWork, visits each known
 * ND's "Company Appoinments" tab (the only place TeamWork reliably shows the
 * true "Sub Role: Nominee Director" text — the REST API's nominee_dir/
 * director_role fields don't correlate with it, confirmed by direct
 * comparison), and rebuilds nd_appointments from that ground truth.
 *
 * A row counts as a valid, currently-active Nominee Director appointment
 * only if: Role === 'Nominee Director' AND Date of Cessation is empty.
 *
 * Full rebuild per run (delete + reinsert) for all NDs with a known
 * member_id — idempotent, safe to run repeatedly. NDs without a member_id
 * (e.g. ZHANG YAN) are left untouched.
 *
 * Usage: node scripts/sync-nd-appointments-auto.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = 'Vincent';
const PASSWORD = 'Pass@123';

function parseDate(s) {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function login(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('welcome')) {
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: ' Login' }).click();
    await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' });
  }
}

async function scrapeMemberAppointments(page, memberId) {
  await page.goto(`${BASE}/view_member/${memberId}/?var1=alldirector`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('tab', { name: 'Company Appoinments' }).click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select#status'));
    const visible = selects.find(s => s.offsetParent !== null);
    if (visible) { visible.value = '0'; visible.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const history = document.querySelector('#history');
    if (!history) return [];
    const out = [];
    for (const tr of history.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length === 5) {
        const cells = Array.from(tds).map(td => td.innerText.trim());
        if (cells[0] && cells[0] !== 'Company Name') {
          out.push({ company: cells[0], role: cells[1], doapp: cells[2], cessation: cells[3], companyStatus: cells[4] });
        }
      }
    }
    return out;
  });
}

async function main() {
  const { data: nds, error } = await sb.from('nominee_directors').select('id, name, member_id');
  if (error) { console.error(error); process.exit(1); }

  const withMemberId = nds.filter(n => n.member_id);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Syncing ${withMemberId.length} NDs (skipping ${nds.length - withMemberId.length} without member_id)`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', route => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    return route.continue();
  });

  await login(page);

  const results = {};
  const errors = {};

  for (const nd of withMemberId) {
    try {
      results[nd.id] = await scrapeMemberAppointments(page, nd.member_id);
      console.log(`  scraped ${nd.name}: ${results[nd.id].length} director rows`);
    } catch (e) {
      errors[nd.id] = e.message;
      console.log(`  FAILED ${nd.name}: ${e.message}`);
    }
  }

  await browser.close();

  if (Object.keys(errors).length) {
    console.log('\nErrors occurred — aborting DB rebuild to avoid partial/incorrect data:');
    console.log(errors);
    process.exit(1);
  }

  const ndIdsToRebuild = withMemberId.map(n => n.id);

  if (!DRY_RUN) {
    const { error: delErr } = await sb.from('nd_appointments').delete().in('nd_id', ndIdsToRebuild);
    if (delErr) { console.error('DELETE ERROR:', delErr.message); process.exit(1); }
  }

  const toInsert = [];
  for (const nd of withMemberId) {
    const rows = results[nd.id] ?? [];
    const valid = rows.filter(r => r.role === 'Nominee Director' && !r.cessation.trim());
    console.log(`  ${nd.name} (nd_id=${nd.id}): ${valid.length} active Nominee Director appointments`);
    for (const r of valid) {
      toInsert.push({
        nd_id: nd.id,
        company_name: r.company,
        sub_role: 'Nominee Director',
        appointment_date: parseDate(r.doapp),
        cessation_date: null,
      });
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Total to insert: ${toInsert.length}`);

  if (!DRY_RUN && toInsert.length) {
    const { error: insErr } = await sb.from('nd_appointments').insert(toInsert);
    if (insErr) { console.error('INSERT ERROR:', insErr.message); process.exit(1); }
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Sync complete at ${new Date().toISOString()}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
