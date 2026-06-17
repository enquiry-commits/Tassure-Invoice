/**
 * QuickBooks Invoice Scraper
 * Run: node scripts/scrape-qb-invoices.js
 *
 * Add to .env.local:
 *   QB_EMAIL=your@email.com
 *   QB_PASSWORD=yourpassword
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const QB_EMAIL    = process.env.QB_EMAIL;
const QB_PASSWORD = process.env.QB_PASSWORD;
const OUT_FILE    = path.join(__dirname, '../data/qb_invoices.json');

if (!QB_EMAIL || !QB_PASSWORD) {
  console.error('Missing QB_EMAIL or QB_PASSWORD in .env.local');
  process.exit(1);
}

// Captured invoice rows from API intercept
const capturedInvoices = [];

async function run() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // ── Intercept QBO API responses that contain invoice lists ──────────────
  page.on('response', async (response) => {
    const url = response.url();
    if (
      url.includes('/invoices') ||
      url.includes('Invoice') ||
      url.includes('transaction') ||
      url.includes('txn')
    ) {
      try {
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          const json = await response.json().catch(() => null);
          if (json) {
            extractInvoicesFromJson(json);
          }
        }
      } catch (_) {}
    }
  });

  // ── Step 1: Go directly to QBO (redirects to login if not logged in) ─────
  console.log('Opening QuickBooks…');
  await page.goto('https://qbo.intuit.com/app/homepage', {
    waitUntil: 'domcontentloaded',
  });

  console.log('\n👉  Log in if prompted (complete any MFA too).');
  console.log('    Waiting up to 3 minutes…\n');

  // ── Step 2: Wait until on QBO app ─────────────────────────────────────────
  await page.waitForURL(url => url.toString().includes('qbo.intuit.com/app'), { timeout: 180000 });
  console.log('✅ On QBO. URL:', page.url());

  // ── Step 3: Navigate to invoice list ─────────────────────────────────────
  console.log('Navigating to invoice list…');
  await page.goto('https://qbo.intuit.com/app/invoices', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Wait for the invoice list to render
  await page.waitForTimeout(5000);

  // ── Step 4: Scrape the visible table rows ─────────────────────────────────
  console.log('Extracting invoice rows from table…');
  let tableInvoices = await extractTableRows(page);
  console.log(`  Found ${tableInvoices.length} invoices on first page.`);

  // Paginate if there are more pages
  let page_num = 1;
  while (true) {
    const nextBtn = await page.$(
      'button[aria-label="Next page"], [data-testid="pagination-next"], button:has-text("Next")'
    );
    if (!nextBtn) break;
    const disabled = await nextBtn.getAttribute('disabled');
    if (disabled !== null) break;

    await nextBtn.click();
    await page.waitForTimeout(2000);
    const moreRows = await extractTableRows(page);
    tableInvoices = tableInvoices.concat(moreRows);
    page_num++;
    console.log(`  Page ${page_num}: ${moreRows.length} more rows (total ${tableInvoices.length})`);
    if (moreRows.length === 0) break;
  }

  // ── Step 5: Merge with any API-captured data ──────────────────────────────
  const allInvoices = mergeInvoices(tableInvoices, capturedInvoices);
  console.log(`\nTotal invoices collected: ${allInvoices.length}`);

  // ── Step 6: Save ──────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ scraped_at: new Date().toISOString(), total: allInvoices.length, invoices: allInvoices }, null, 2),
    'utf8'
  );
  console.log(`Saved to ${OUT_FILE}`);

  await browser.close();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function extractTableRows(page) {
  return page.evaluate(() => {
    const rows = [];

    // QBO renders invoice rows in a table; selectors may vary across versions
    const candidates = [
      ...document.querySelectorAll('tr[class*="row"], tr[data-cy], tbody tr'),
    ];

    for (const row of candidates) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 3) continue;

      const texts = cells.map(c => c.innerText.trim());

      // Heuristic: look for a row that has a date-ish cell and a dollar-ish cell
      const hasDate = texts.some(t => /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(t));
      const hasAmount = texts.some(t => /^\$?[\d,]+\.\d{2}$/.test(t));
      if (!hasDate && !hasAmount) continue;

      // Try to find a link for the invoice number
      const link = row.querySelector('a');
      const invoiceNo = link ? link.innerText.trim() : texts[0];

      rows.push({
        source:     'dom',
        invoiceNo,
        rawCells:   texts,
      });
    }
    return rows;
  });
}

function extractInvoicesFromJson(json) {
  // QBO API returns invoices in various shapes; try common paths
  let items = [];

  if (Array.isArray(json)) {
    items = json;
  } else if (json?.QueryResponse?.Invoice) {
    items = json.QueryResponse.Invoice;
  } else if (json?.Invoice) {
    items = Array.isArray(json.Invoice) ? json.Invoice : [json.Invoice];
  } else if (json?.data?.invoices) {
    items = json.data.invoices;
  } else if (json?.result?.rows) {
    items = json.result.rows;
  }

  for (const inv of items) {
    if (!inv || typeof inv !== 'object') continue;
    if (!inv.Id && !inv.DocNumber && !inv.TxnDate) continue;

    capturedInvoices.push({
      source:       'api',
      id:           inv.Id ?? inv.id,
      docNumber:    inv.DocNumber ?? inv.docNumber ?? inv.invoice_number,
      txnDate:      inv.TxnDate ?? inv.txnDate ?? inv.date,
      dueDate:      inv.DueDate ?? inv.dueDate ?? inv.due_date,
      customerName: inv.CustomerRef?.name ?? inv.customer_name ?? inv.CustomerName ?? '',
      totalAmt:     inv.TotalAmt ?? inv.total ?? inv.amount ?? 0,
      balance:      inv.Balance ?? inv.balance ?? 0,
      status:       inv.Balance === 0 ? 'Paid' : 'Open',
    });
  }
}

function mergeInvoices(domRows, apiRows) {
  if (apiRows.length > 0) {
    console.log(`Using ${apiRows.length} API-captured invoices (more reliable).`);
    return apiRows;
  }
  // Normalize DOM rows: [checkbox, date, invoiceNo, customerName, amount, status, actions]
  return domRows.map((r, i) => {
    const cells = r.rawCells;
    const amtRaw  = (cells[4] ?? '').replace(/[$,]/g, '').trim();
    const amount  = parseFloat(amtRaw) || 0;
    const statusRaw = (cells[5] ?? '').toLowerCase();
    let status = 'Open';
    if (statusRaw.includes('paid'))    status = 'Paid';
    if (statusRaw.includes('overdue')) status = 'Overdue';
    return {
      id:           String(i + 1),
      invoiceNo:    cells[2] ?? '',
      txnDate:      cells[1] ?? '',
      customerName: cells[3] ?? '',
      totalAmt:     amount,
      balance:      status === 'Paid' ? 0 : amount,
      status,
      statusRaw:    cells[5] ?? '',
    };
  });
}

run().catch(err => {
  console.error('Scraper error:', err);
  process.exit(1);
});
