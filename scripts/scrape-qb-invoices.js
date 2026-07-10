/**
 * QuickBooks Invoice Scraper
 *
 * Phase 1 (default): scrapes invoice list → data/qb_invoices.json
 * Phase 2 (--line-items): opens each invoice, captures line items → data/qb_invoice_items.json
 *
 * Usage:
 *   node scripts/scrape-qb-invoices.js                        # Phase 1 only
 *   node scripts/scrape-qb-invoices.js --line-items           # Phase 1 + Phase 2
 *   node scripts/scrape-qb-invoices.js --line-items --resume  # Phase 2 only, skip already done
 *   node scripts/scrape-qb-invoices.js --line-items --start=200 --limit=100
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const OUT_FILE      = path.join(__dirname, '../data/qb_invoices.json');
const ITEMS_FILE    = path.join(__dirname, '../data/qb_invoice_items.json');
const SESSION_FILE  = path.join(__dirname, '../data/qb_session.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const ARGS          = process.argv.slice(2);
const DO_LINE_ITEMS = ARGS.includes('--line-items');
const DO_RESUME     = ARGS.includes('--resume');
const START_IDX     = parseInt((ARGS.find(a => a.startsWith('--start=')) ?? '').replace('--start=', '') || '0');
const LIMIT         = parseInt((ARGS.find(a => a.startsWith('--limit=')) ?? '').replace('--limit=', '') || '99999');

// Captured invoice rows from API intercept (Phase 1)
const capturedInvoices = [];

async function run() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const hasSession = fs.existsSync(SESSION_FILE);
  const context = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...(hasSession ? { storageState: SESSION_FILE } : {}),
  });

  const page = await context.newPage();

  // ── Intercept QBO API responses (Phase 1: invoice list) ───────────────────
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
          if (json) extractInvoicesFromJson(json);
        }
      } catch (_) {}
    }
  });

  // ── Step 1: Navigate to QBO ────────────────────────────────────────────────
  console.log('Opening QuickBooks…');
  await page.goto('https://qbo.intuit.com/app/homepage', { waitUntil: 'domcontentloaded' });

  if (!hasSession || !page.url().includes('qbo.intuit.com/app/')) {
    console.log('\n👉  Log in if prompted (complete any MFA too).');
    console.log('    Waiting up to 5 minutes…\n');
    await page.waitForURL(url => url.toString().includes('qbo.intuit.com/app/'), { timeout: 300000 });
    await context.storageState({ path: SESSION_FILE });
    console.log('✅ Logged in — session saved. URL:', page.url());
  } else {
    console.log('✅ Session restored — skipping login. URL:', page.url());
  }

  // ── Step 2: Navigate to invoice list ──────────────────────────────────────
  console.log('Navigating to invoice list…');
  await page.goto('https://qbo.intuit.com/app/invoices', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  // ── Step 3: Scrape the visible table rows (with pagination) ───────────────
  console.log('Extracting invoice rows…');
  let tableInvoices = await extractTableRows(page);
  console.log(`  Page 1: ${tableInvoices.length} invoices`);

  let pageNum = 1;
  while (true) {
    const nextBtn = await page.$(
      'button[aria-label="Next page"], [data-testid="pagination-next"], button:has-text("Next")'
    );
    if (!nextBtn) break;
    const disabled = await nextBtn.getAttribute('disabled');
    if (disabled !== null) break;

    await nextBtn.click();
    await page.waitForTimeout(2000);
    const more = await extractTableRows(page);
    tableInvoices = tableInvoices.concat(more);
    pageNum++;
    console.log(`  Page ${pageNum}: ${more.length} more (total ${tableInvoices.length})`);
    if (more.length === 0) break;
  }

  // ── Step 4: Merge DOM + API data ───────────────────────────────────────────
  const allInvoices = mergeInvoices(tableInvoices, capturedInvoices);
  console.log(`\nTotal invoices: ${allInvoices.length}`);

  // ── Step 5: Save invoice list ──────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ scraped_at: new Date().toISOString(), total: allInvoices.length, invoices: allInvoices }, null, 2),
    'utf8'
  );
  console.log(`✅ Invoice list saved → ${OUT_FILE}`);

  // ── Step 6 (optional): Scrape line items ───────────────────────────────────
  if (DO_LINE_ITEMS) {
    await runPhase2(page, allInvoices);
  }

  await browser.close();
}

// ── Phase 2: Line Items ───────────────────────────────────────────────────────

async function runPhase2(page, invoices) {
  console.log('\n══════════════════════════════════════════');
  console.log('Phase 2: Scraping invoice line items');
  console.log('══════════════════════════════════════════');

  // Load existing progress (for --resume)
  let existingItems = [];
  if (DO_RESUME && fs.existsSync(ITEMS_FILE)) {
    try {
      existingItems = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf-8')).items || [];
      console.log(`Resuming: ${existingItems.length} items already saved`);
    } catch (_) {}
  }

  const doneIds = new Set(existingItems.map(i => i.qbInvoiceId).filter(Boolean));
  const candidates = invoices.filter(inv => inv.id);

  // Apply start/limit/resume filters
  const toProcess = candidates
    .filter(inv => !doneIds.has(String(inv.id)))
    .slice(START_IDX, START_IDX + LIMIT);

  console.log(`Invoices to process: ${toProcess.length} (skipping ${doneIds.size} already done)`);

  if (toProcess.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const allItems = [...existingItems];

  // Per-page API capture for individual invoice detail calls
  const capturedLineItems = new Map(); // txnId → parsed items[]

  page.on('response', async (response) => {
    try {
      const url = response.url();
      const ct  = response.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) return;

      const json = await response.json().catch(() => null);
      if (!json) return;

      // QB REST API: single invoice response
      const inv = json?.Invoice;
      if (inv?.Id && Array.isArray(inv.Line)) {
        const lines = parseLineItems(inv);
        if (lines.length > 0) capturedLineItems.set(String(inv.Id), lines);
      }

      // QB REST API: query response containing multiple invoices
      if (Array.isArray(json?.QueryResponse?.Invoice)) {
        for (const inv of json.QueryResponse.Invoice) {
          if (inv?.Id && Array.isArray(inv.Line)) {
            const lines = parseLineItems(inv);
            if (lines.length > 0) capturedLineItems.set(String(inv.Id), lines);
          }
        }
      }
    } catch (_) {}
  });

  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const inv    = toProcess[i];
    const txnId  = String(inv.id);
    const label  = (inv.customerName || inv.docNumber || txnId).substring(0, 35);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const eta    = i > 0 ? Math.floor((elapsed / i) * (toProcess.length - i)) : '?';

    process.stdout.write(`\r  [${i + 1}/${toProcess.length}] ${label.padEnd(35)} | elapsed ${elapsed}s | ETA ~${eta}s   `);

    capturedLineItems.delete(txnId);

    // Navigate to invoice detail
    const detailUrl = inv.detailUrl
      ? (inv.detailUrl.startsWith('http') ? inv.detailUrl : `https://qbo.intuit.com${inv.detailUrl}`)
      : `https://qbo.intuit.com/app/invoice?txnId=${txnId}`;

    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Try API-intercepted line items first
    let lineItems = capturedLineItems.get(txnId) || [];

    // Fallback: DOM scraping
    if (lineItems.length === 0) {
      lineItems = await scrapeLineItemsDom(page, inv);
    }

    // Map to output rows
    const invoiceNo = inv.invoiceNo || inv.docNumber || '';
    lineItems.forEach((item, idx) => {
      allItems.push({
        invoiceNo,
        qbInvoiceId: txnId,
        customerName: inv.customerName || '',
        txnDate:      inv.txnDate || '',
        lineNum:      item.lineNum || (idx + 1),
        description:  item.description || '',
        productService: item.productService || '',
        qty:          item.qty ?? null,
        rate:         item.rate ?? null,
        amount:       item.amount ?? null,
        serviceType:  classifyService(item),
      });
    });

    // Save progress every 25 invoices
    if ((i + 1) % 25 === 0 || i === toProcess.length - 1) {
      saveItems(allItems);
    }
  }

  console.log(`\n\n✅ Phase 2 complete: ${allItems.length} line items`);
  saveItems(allItems);
}

function saveItems(items) {
  fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
  fs.writeFileSync(
    ITEMS_FILE,
    JSON.stringify({ scraped_at: new Date().toISOString(), total: items.length, items }, null, 2),
    'utf8'
  );
}

// ── DOM fallback for line items ────────────────────────────────────────────────

async function scrapeLineItemsDom(page, inv) {
  return page.evaluate(() => {
    const rows = [];

    // QBO uses various selectors across versions — try all
    const selectors = [
      'table tbody tr[class*="line"], table tbody tr[data-automation*="line"]',
      '[data-automation="pn-detail-table"] tbody tr',
      '.intuit-table tbody tr',
      'tr[class*="Line"], tr[class*="row-item"]',
    ];

    let candidates = [];
    for (const sel of selectors) {
      candidates = [...document.querySelectorAll(sel)];
      if (candidates.length > 0) break;
    }

    for (const row of candidates) {
      const cells = [...row.querySelectorAll('td, [class*="cell"]')];
      if (cells.length < 2) continue;
      const texts = cells.map(c => c.innerText?.trim() || '');
      const hasAmount = texts.some(t => /^\$?[\d,]+\.\d{2}$/.test(t));
      if (!hasAmount) continue;

      rows.push({
        lineNum:        null,
        description:    texts[1] || texts[0] || '',
        productService: texts[0] || '',
        qty:            parseFloat((texts[2] || '').replace(/[^0-9.]/g, '')) || null,
        rate:           parseFloat((texts[3] || '').replace(/[^0-9.]/g, '')) || null,
        amount:         parseFloat((texts[texts.length - 1] || '').replace(/[^0-9.]/g, '')) || null,
      });
    }

    return rows;
  });
}

// ── Line item parsing from QB REST API JSON ───────────────────────────────────

function parseLineItems(inv) {
  return (inv.Line || [])
    .filter(l => l.DetailType === 'SalesItemLineDetail' || l.DetailType === 'ItemBasedExpenseLineDetail')
    .map((l, idx) => {
      const detail = l.SalesItemLineDetail || l.ItemBasedExpenseLineDetail || {};
      return {
        lineNum:        l.LineNum || idx + 1,
        description:    l.Description || '',
        productService: detail.ItemRef?.name || '',
        qty:            detail.Qty ?? null,
        rate:           detail.UnitPrice ?? null,
        amount:         l.Amount ?? null,
      };
    });
}

// ── Service type classification ────────────────────────────────────────────────

const SERVICE_PATTERNS = [
  { type: 'AR',        keywords: ['annual return', 'ar filing', 'ar fee', 'a/r filing', 'acra annual'] },
  { type: 'AGM',       keywords: ['agm', 'annual general meeting', 'a.g.m'] },
  { type: 'XBRL',      keywords: ['xbrl', 'ixbrl', 'tagged financial', 'xbrl filing'] },
  { type: 'Secretary', keywords: ['secretarial', 'secretary', 'corp sec', 'corporate sec', 'statutory', 'board resolution', 'share allot', 'share transfer', 'change of director', 'change of officer', 'change of address', 'nominee service'] },
  { type: 'ND',        keywords: ['nominee director', 'nd service', 'nd fee', 'local director', 'resident director', 'nd retainer'] },
  { type: 'Address',   keywords: ['registered address', 'reg address', 'virtual office', 'address service', 'office address', 'registered office'] },
  { type: 'Accounts',  keywords: ['bookkeeping', 'accounts preparation', 'account preparation', 'management accounts', 'unaudited accounts', 'financial statement', 'accounting fee', 'accounts fee', 'compilation'] },
  { type: 'Tax',       keywords: ['tax return', 'tax filing', 'income tax', 'iras', 'form c', 'form cs', 'gst return', 'gst filing', 'tax computation', 'corporate tax', 'eci'] },
  { type: 'Audit',     keywords: ['audit', 'statutory audit', 'auditor', 'audited financial'] },
];

function classifyService(item) {
  const text = `${item.description || ''} ${item.productService || ''}`.toLowerCase();
  for (const { type, keywords } of SERVICE_PATTERNS) {
    if (keywords.some(k => text.includes(k))) return type;
  }
  return 'Other';
}

// ── Phase 1 helpers ────────────────────────────────────────────────────────────

async function extractTableRows(page) {
  return page.evaluate(() => {
    const rows = [];
    const candidates = [
      ...document.querySelectorAll('tr[class*="row"], tr[data-cy], tbody tr'),
    ];

    for (const row of candidates) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 3) continue;

      const texts = cells.map(c => c.innerText.trim());
      const hasDate   = texts.some(t => /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(t));
      const hasAmount = texts.some(t => /^\$?[\d,]+\.\d{2}$/.test(t));
      if (!hasDate && !hasAmount) continue;

      const link = row.querySelector('a');
      rows.push({
        source:    'dom',
        invoiceNo: link ? link.innerText.trim() : texts[0],
        detailUrl: link ? link.getAttribute('href') : null,
        rawCells:  texts,
      });
    }
    return rows;
  });
}

function extractInvoicesFromJson(json) {
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
    console.log(`Using ${apiRows.length} API-captured invoices.`);
    return apiRows;
  }
  // Build map from invoice number (DOM) → detailUrl for Phase 2
  const urlMap = new Map();
  domRows.forEach(r => { if (r.invoiceNo && r.detailUrl) urlMap.set(r.invoiceNo, r.detailUrl); });

  return domRows.map((r, i) => {
    const cells    = r.rawCells;
    const amtRaw   = (cells[4] ?? '').replace(/[$,]/g, '').trim();
    const amount   = parseFloat(amtRaw) || 0;
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
      detailUrl:    r.detailUrl || null,
    };
  });
}

run().catch(err => {
  console.error('Scraper error:', err);
  process.exit(1);
});
