// Scrape TeamWork CSS "Records > Individuals" module — full data extraction.
// Login once, reuse storage state, N concurrent pages under ONE browser context.
// Each individual is written to its own JSON file (data/teamwork-scrape/individuals/{id}.json)
// and its ID appended to completed.json only after all 4 steps succeed (resumable).
//
// Usage: node scripts/scrape-teamwork-individuals.js [--limit=20] [--concurrency=3]

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME;
const PASSWORD = process.env.TEAMWORK_PASSWORD;

const DATA_DIR = path.join(__dirname, '..', 'data', 'teamwork-scrape');
const INDIVIDUALS_DIR = path.join(DATA_DIR, 'individuals');
const STORAGE_STATE_PATH = path.join(DATA_DIR, 'auth-state.json');
const COMPLETED_PATH = path.join(DATA_DIR, 'completed.json');
const FAILED_PATH = path.join(DATA_DIR, 'failed.json');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const CONCURRENCY = args.concurrency ? parseInt(args.concurrency, 10) : 3;

for (const d of [DATA_DIR, INDIVIDUALS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// Simple append-only, crash-safe writers (small files, fine to read-modify-write).
function appendCompleted(id) {
  const set = new Set(loadJSON(COMPLETED_PATH, []));
  set.add(id);
  fs.writeFileSync(COMPLETED_PATH, JSON.stringify([...set]));
}
function appendFailed(id, error) {
  const arr = loadJSON(FAILED_PATH, []);
  arr.push({ id, error: String(error).slice(0, 500), at: new Date().toISOString() });
  fs.writeFileSync(FAILED_PATH, JSON.stringify(arr, null, 2));
}

// ── In-browser DOM parsing helpers (run via page.evaluate) ──────────────────
const PARSE_VIEW_INDIVIDUAL = () => {
  function textOf(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }

  // Only look inside the active "View Individual" tabpanel to avoid picking up
  // stale content from other tabs that may already be in the DOM.
  const root = document.querySelector('.tab-content') || document.body;

  const profile = {};
  const contact = {};
  const consentNotice = {};
  const ids = []; // supports ID 1, ID 2, ...
  let currentIdBlock = null;
  const appointmentHistory = {}; // { "DIRECTOR HISTORY": { columns: [...], rows: [[...]] }, ... }

  // Walk every table that is NOT a DataTable (those are handled separately: Log tab)
  const tables = Array.from(root.querySelectorAll('table'));
  let section = null; // 'profile' | 'contact' | 'consent' | roleHistoryName
  let historyColumns = null;
  let historyCompany = null;

  for (const table of tables) {
    if (table.classList.contains('dataTable')) continue; // Log tab table, skip here

    for (const tr of table.querySelectorAll('tr')) {
      const cells = Array.from(tr.children);
      if (cells.length === 0) continue;

      const strongCells = cells.filter(c => c.querySelector('strong'));

      // Section header: exactly 1 cell, contains <strong>, no other siblings
      if (cells.length === 1 && strongCells.length === 1) {
        const label = textOf(cells[0]);
        if (/INDIVIDUAL PROFILE/i.test(label)) { section = 'profile'; historyColumns = null; }
        else if (/INDIVIDUAL CONTACT DETAILS/i.test(label)) { section = 'contact'; historyColumns = null; }
        else if (/CONSENT NOTICE/i.test(label)) { section = 'consent'; historyColumns = null; }
        else if (/HISTORY$/i.test(label)) {
          section = 'history';
          appointmentHistory[label] = appointmentHistory[label] || [];
          historyColumns = null;
          historyCompany = null;
        } else if (/^[A-Z0-9 .,&()\-]+$/.test(label) && label.length > 2) {
          // Looks like a company name heading inside a role-history sub-table
          historyCompany = label;
        }
        continue;
      }

      // ID N: marker row, e.g. "ID 1:"
      if (cells.length === 1 && /^ID \d+:$/i.test(textOf(cells[0]) ?? '')) {
        currentIdBlock = { label: textOf(cells[0]) };
        ids.push(currentIdBlock);
        continue;
      }

      // Column header row for a history grid: 2+ cells, ALL contain <strong>
      if (section === 'history' && cells.length >= 2 && strongCells.length === cells.length) {
        historyColumns = cells.map(textOf);
        continue;
      }

      // Key/value row: exactly 2 cells, first has <strong>
      if (cells.length === 2 && strongCells.length === 1 && strongCells[0] === cells[0]) {
        const key = textOf(cells[0]);
        const val = textOf(cells[1]);
        if (section === 'profile') {
          if (currentIdBlock) currentIdBlock[key] = val;
          else profile[key] = val;
        } else if (section === 'contact') contact[key] = val;
        else if (section === 'consent') consentNotice[key] = val;
        continue;
      }

      // Data row inside a history grid: matches historyColumns width, no strong cells
      if (section === 'history' && historyColumns && cells.length === historyColumns.length && strongCells.length === 0) {
        const rowObj = {};
        historyColumns.forEach((col, i) => { rowObj[col] = textOf(cells[i]); });
        if (historyCompany) rowObj['_company_name'] = historyCompany;
        const lastHistKey = Object.keys(appointmentHistory).pop();
        if (lastHistKey) appointmentHistory[lastHistKey].push(rowObj);
        continue;
      }
    }
  }

  return { profile, contact, consentNotice, ids, appointmentHistory };
};

const PARSE_COMPANY_APPOINTMENTS = () => {
  function textOf(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }
  const root = document.querySelector('.tab-content') || document.body;
  const results = [];
  const tables = Array.from(root.querySelectorAll('table'));
  let currentCompany = null;
  let columns = null;

  for (const table of tables) {
    if (table.classList.contains('dataTable')) continue;
    for (const tr of table.querySelectorAll('tr')) {
      const cells = Array.from(tr.children);
      if (cells.length === 0) continue;
      const strongCells = cells.filter(c => c.querySelector('strong'));

      if (cells.length === 1 && strongCells.length === 1) {
        const label = textOf(cells[0]);
        if (/^Role Sub role|^Role$/i.test(label)) continue;
        currentCompany = label;
        columns = null;
        continue;
      }
      if (cells.length >= 2 && strongCells.length === cells.length) {
        columns = cells.map(textOf);
        continue;
      }
      if (columns && cells.length === columns.length && strongCells.length === 0 && currentCompany) {
        const rowObj = { company_name: currentCompany };
        columns.forEach((col, i) => { rowObj[col] = textOf(cells[i]); });
        results.push(rowObj);
      }
    }
  }
  return results;
};

const PARSE_LOG_TAB = () => {
  function textOf(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }
  const table = document.querySelector('table.dataTable');
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  return rows
    .filter(r => !/No data available/i.test(r.textContent))
    .map(r => Array.from(r.children).map(textOf));
};

// ── Scraper ───────────────────────────────────────────────────────────────
async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('welcome')) {
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: ' Login' }).click();
    await page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 });
  }
  await context.storageState({ path: STORAGE_STATE_PATH });
  await page.close();
  console.log('✅ Logged in, storage state saved.');
}

async function getAllMemberIds(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/member`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#datatable');
  // Force DataTables to show all rows (client-side length change + redraw)
  await page.evaluate(() => {
    if (window.jQuery && jQuery.fn.dataTable && jQuery('#datatable').length) {
      jQuery('#datatable').DataTable().page.len(-1).draw();
    }
  });
  await page.waitForTimeout(1500); // let redraw + any AJAX settle
  await page.waitForLoadState('networkidle').catch(() => {});

  const ids = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/view_member/"]'));
    const out = new Set();
    for (const a of links) {
      const m = a.href.match(/\/view_member\/(\d+)\//);
      if (m) out.add(Number(m[1]));
    }
    return [...out];
  });
  await page.close();
  return ids.sort((a, b) => a - b);
}

async function scrapeOne(context, id) {
  const page = await context.newPage();
  try {
    // Block non-essential resource types for speed
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    // Step 1: load View Individual (default tab)
    await page.goto(`${BASE}/view_member/${id}/?var1=alldirector`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.tab-content', { timeout: 15000 }).catch(() => {});

    // Step 2: extract Profile + Contact + Consent + Appointment History panel
    const viewData = await page.evaluate(PARSE_VIEW_INDIVIDUAL);

    // Step 3: switch to Company Appoinments tab, extract
    const companyTab = page.getByRole('tab', { name: 'Company Appoinments' });
    await companyTab.click({ timeout: 10000 });
    await page.waitForTimeout(600);
    const companyAppointments = await page.evaluate(PARSE_COMPANY_APPOINTMENTS);

    // Step 4: switch to Log tab, wait for its AJAX response, extract
    const logTab = page.getByRole('tab', { name: 'Log', exact: true });
    const logRespPromise = page.waitForResponse(r => r.url().includes('ajax_member_log_list'), { timeout: 8000 }).catch(() => null);
    await logTab.click({ timeout: 10000 });
    await logRespPromise;
    await page.waitForTimeout(400);
    const log = await page.evaluate(PARSE_LOG_TAB);

    const record = {
      id,
      scraped_at: new Date().toISOString(),
      individual_name: viewData.profile['Individual Name'] ?? null,
      ...viewData,
      companyAppointments,
      log,
    };

    fs.writeFileSync(path.join(INDIVIDUALS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
    appendCompleted(id);
    return { id, ok: true };
  } catch (e) {
    appendFailed(id, e && e.stack ? e.stack : e);
    return { id, ok: false, error: String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!USERNAME || !PASSWORD) throw new Error('TEAMWORK_USERNAME and TEAMWORK_PASSWORD are required.');
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true });

  let context;
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
    // Verify session still valid
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const stillLoggedIn = !page.url().includes('welcome');
    await page.close();
    if (!stillLoggedIn) {
      console.log('⚠️  Saved session expired, logging in again...');
      await login(context);
    } else {
      console.log('✅ Reused saved session.');
    }
  } else {
    context = await browser.newContext();
    await login(context);
  }

  console.log('Fetching full individuals list...');
  let allIds = await getAllMemberIds(context);
  console.log(`Found ${allIds.length} individuals total.`);

  const completed = new Set(loadJSON(COMPLETED_PATH, []));
  let todo = allIds.filter(id => !completed.has(id));
  if (LIMIT !== Infinity) todo = todo.slice(0, LIMIT);
  console.log(`${completed.size} already completed, ${todo.length} to process this run (concurrency=${CONCURRENCY}).`);

  let done = 0, ok = 0, fail = 0;
  const queue = [...todo];

  async function worker(workerIdx) {
    while (queue.length) {
      const id = queue.shift();
      if (id === undefined) break;
      const res = await scrapeOne(context, id);
      done++;
      if (res.ok) ok++; else fail++;
      console.log(`[w${workerIdx}] ${done}/${todo.length} id=${id} ${res.ok ? 'OK' : 'FAIL: ' + res.error}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  await browser.close();
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Run complete ===`);
  console.log(`Processed: ${done}  OK: ${ok}  Failed: ${fail}`);
  console.log(`Elapsed: ${elapsedSec}s  (${(done / (elapsedSec / 60)).toFixed(1)} records/min)`);
  console.log(`Success rate: ${((ok / done) * 100 || 0).toFixed(1)}%`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
