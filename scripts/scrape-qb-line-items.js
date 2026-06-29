/**
 * QB Invoice Line Items Scraper
 *
 * Uses the same row selectors that Phase-1 already proved work.
 * Clicks each invoice link, captures the real txnId from the URL,
 * then scrapes line items via API intercept or DOM fallback.
 *
 * Usage:
 *   node scripts/scrape-qb-line-items.js              # all invoices
 *   node scripts/scrape-qb-line-items.js --resume     # skip already done
 *   node scripts/scrape-qb-line-items.js --limit=5    # test: first 5 only
 *   node scripts/scrape-qb-line-items.js --debug      # save detail HTML
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const INVOICES_FILE  = path.join(__dirname, '../data/qb_invoices.json');
const ITEMS_FILE     = path.join(__dirname, '../data/qb_invoice_items.json');
const SESSION_FILE   = path.join(__dirname, '../data/qb_session.json');

const ARGS   = process.argv.slice(2);
const RESUME = ARGS.includes('--resume');
const DEBUG  = ARGS.includes('--debug');
const LIMIT  = parseInt((ARGS.find(a => a.startsWith('--limit=')) ?? '').replace('--limit=', '') || '99999');

// ── Service classification ─────────────────────────────────────────────────────
const SERVICE_PATTERNS = [
  { type: 'AR',        kw: ['annual return', 'ar filing', 'ar fee', 'a/r filing', 'acra annual'] },
  { type: 'AGM',       kw: ['agm', 'annual general meeting'] },
  { type: 'XBRL',      kw: ['xbrl', 'ixbrl', 'tagged financial'] },
  { type: 'Address',   kw: ['registered address', 'reg address', 'virtual office', 'address service', 'registered office'] },
  { type: 'ND',        kw: ['nominee director', 'nd service', 'nd fee', 'local director', 'resident director'] },
  { type: 'Secretary', kw: ['secretarial', 'secretary', 'corp sec', 'statutory', 'board resolution', 'share allot', 'share transfer', 'change of director', 'change of officer'] },
  { type: 'Accounts',  kw: ['bookkeeping', 'accounts preparation', 'management accounts', 'unaudited', 'financial statement', 'accounting fee', 'compilation'] },
  { type: 'Tax',       kw: ['tax return', 'tax filing', 'income tax', 'iras', 'form c', 'form cs', 'gst return', 'tax computation', 'corporate tax', 'eci'] },
  { type: 'Audit',     kw: ['audit', 'statutory audit', 'auditor'] },
];

function classify(desc, product) {
  const t = `${desc || ''} ${product || ''}`.toLowerCase();
  for (const { type, kw } of SERVICE_PATTERNS) {
    if (kw.some(k => t.includes(k))) return type;
  }
  return 'Other';
}

function parseQBInvoice(inv) {
  if (!inv?.Line) return [];
  return inv.Line
    .filter(l => l.DetailType === 'SalesItemLineDetail' || l.DetailType === 'ItemBasedExpenseLineDetail')
    .map((l, i) => {
      const d = l.SalesItemLineDetail || l.ItemBasedExpenseLineDetail || {};
      return {
        lineNum:        l.LineNum || i + 1,
        description:    l.Description || '',
        productService: d.ItemRef?.name || '',
        qty:            d.Qty ?? null,
        rate:           d.UnitPrice ?? null,
        amount:         l.Amount ?? null,
      };
    });
}

function saveItems(items) {
  fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
  fs.writeFileSync(ITEMS_FILE,
    JSON.stringify({ scraped_at: new Date().toISOString(), total: items.length, items }, null, 2));
}

// ── Row extraction — mirrors Phase-1 mergeInvoices logic ─────────────────────
// QB invoice list columns: [0]checkbox [1]date [2]referenceNumber [3]customerName [4]amount [5]status [6]action
// There is NO <a> tag — rows are plain <tr class="selectable"> clicked directly.
async function getPageInvoiceNos(page) {
  return page.evaluate(() => {
    const result = [];
    const candidates = [
      ...document.querySelectorAll('tbody tr.selectable, tbody tr[tabindex], tr[class*="selectable"]'),
    ];
    for (const row of candidates) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 3) continue;
      const texts = cells.map(c => c.innerText.trim());
      const hasDate = texts.some(t => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t));
      if (!hasDate) continue;
      // Invoice number is in column index 2 (referenceNumber)
      const invoiceNo = texts[2];
      if (invoiceNo && /^\d+$/.test(invoiceNo)) result.push(invoiceNo);
    }
    return result;
  });
}

// ── DOM line item extraction from invoice detail page ─────────────────────────
// QB invoice detail uses aria-label input fields (not a table):
//   aria-label="Product or service line N"  → input value = "Category:ServiceName"
//   aria-label="Description line N"         → textarea
//   aria-label="Quantity line N"            → input value = "1"
//   aria-label="Rate line N"                → input value = "700.00"
//   aria-label="Amount line N"              → input value = "S$700.00"
async function scrapeLineItemsDom(page) {
  return page.evaluate(() => {
    const items = [];
    // Find how many lines exist by counting "Product or service line N" inputs
    const productInputs = document.querySelectorAll('input[aria-label^="Product or service line "]');
    for (const input of productInputs) {
      const labelMatch = input.getAttribute('aria-label').match(/line (\d+)$/);
      if (!labelMatch) continue;
      const n = labelMatch[1];

      const product = (input.value || '').trim();
      if (!product) continue; // skip blank trailing lines QB always adds

      const descEl = document.querySelector(`[aria-label="Description line ${n}"]`);
      const description = (descEl?.value || descEl?.innerText || '').trim();

      const qtyEl    = document.querySelector(`input[aria-label="Quantity line ${n}"]`);
      const rateEl   = document.querySelector(`input[aria-label="Rate line ${n}"]`);
      const amtEl    = document.querySelector(`input[aria-label="Amount line ${n}"]`);

      const qty    = parseFloat((qtyEl?.value  || '').replace(/[^0-9.]/g, '')) || null;
      const rate   = parseFloat((rateEl?.value || '').replace(/[^0-9.]/g, '')) || null;
      const amount = parseFloat((amtEl?.value  || '').replace(/[^0-9.]/g, '')) || null;

      if (!amount && !rate) continue; // skip empty rows

      items.push({
        lineNum:        parseInt(n, 10),
        productService: product,
        description,
        qty,
        rate,
        amount,
      });
    }
    return items;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  if (!fs.existsSync(INVOICES_FILE)) {
    console.error('qb_invoices.json not found. Run npm run scrape-qb first.');
    process.exit(1);
  }

  const { invoices: allInvoices } = JSON.parse(fs.readFileSync(INVOICES_FILE, 'utf-8'));
  console.log(`Loaded ${allInvoices.length} invoices`);

  let existingItems = [];
  if (RESUME && fs.existsSync(ITEMS_FILE)) {
    existingItems = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf-8')).items || [];
    console.log(`Resuming: ${existingItems.length} items already saved`);
  }

  const doneNos   = new Set(existingItems.map(i => i.invoiceNo).filter(Boolean));
  const toProcess = allInvoices.filter(inv => inv.invoiceNo && !doneNos.has(inv.invoiceNo)).slice(0, LIMIT);
  const byNo      = new Map(toProcess.map(inv => [inv.invoiceNo, inv]));
  console.log(`Invoices to process: ${toProcess.length}\n`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const hasSession = fs.existsSync(SESSION_FILE);
  const context  = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    ...(hasSession ? { storageState: SESSION_FILE } : {}),
  });
  const page = await context.newPage();

  // ── API intercept: capture line items from any JSON response ──────────────
  const capturedByTxn = new Map();
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const ct  = resp.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) return;
      const json = await resp.json().catch(() => null);
      if (!json) return;

      // Single invoice (QB REST)
      const inv = json?.Invoice;
      if (inv?.Id && Array.isArray(inv.Line)) {
        const lines = parseQBInvoice(inv);
        if (DEBUG) console.log(`\n  [API] Invoice ${inv.Id} — ${lines.length} lines from ${url.substring(0, 60)}`);
        if (lines.length > 0) capturedByTxn.set(String(inv.Id), lines);
      }
      // Batch/query
      const list = json?.QueryResponse?.Invoice;
      if (Array.isArray(list)) {
        for (const i of list) {
          if (i?.Id && Array.isArray(i.Line)) {
            const lines = parseQBInvoice(i);
            if (lines.length > 0) capturedByTxn.set(String(i.Id), lines);
          }
        }
      }
      // Debug: log any JSON with "Line" key from invoice-related URLs
      if (DEBUG && (url.includes('invoice') || url.includes('txn'))) {
        const str = JSON.stringify(json);
        if (str.includes('"Line"') || str.includes('"line"')) {
          console.log(`\n  [API] URL with Line data: ${url.substring(0, 100)}`);
          console.log(`  [API] Top keys: ${Object.keys(json).join(', ')}`);
        }
      }
    } catch (_) {}
  });

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('Opening QuickBooks…');
  await page.goto('https://qbo.intuit.com/app/homepage', { waitUntil: 'domcontentloaded' });
  if (!hasSession || !page.url().includes('qbo.intuit.com/app/')) {
    console.log('👉  Log in (up to 5 min)…');
    await page.waitForURL(u => u.toString().includes('qbo.intuit.com/app/'), { timeout: 300000 });
    // Save session so next run skips login
    await context.storageState({ path: SESSION_FILE });
    console.log('✅ Logged in — session saved\n');
  } else {
    console.log('✅ Session restored — skipping login\n');
  }

  const allItems = [...existingItems];
  let processed  = 0;
  let pageNum    = 1;

  // ── Navigate to invoice list ───────────────────────────────────────────────
  console.log('Navigating to invoice list…');
  await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000); // same wait Phase-1 used

  while (processed < toProcess.length) {
    // ── Get invoice numbers visible on this list page ──────────────────────
    const visibleNos = await getPageInvoiceNos(page);
    console.log(`  Page ${pageNum}: ${visibleNos.length} invoices visible`);

    if (visibleNos.length === 0) {
      // Save HTML for debugging and bail
      const html = await page.content();
      fs.writeFileSync(path.join(__dirname, '../data/debug_list_empty.html'), html);
      console.error('  No invoice rows found — saved debug HTML → data/debug_list_empty.html');
      break;
    }

    // ── Process each needed invoice on this page ───────────────────────────
    for (const invoiceNo of visibleNos) {
      if (processed >= toProcess.length) break;
      if (!byNo.has(invoiceNo)) continue;

      const meta = byNo.get(invoiceNo);
      process.stdout.write(`\r  [${processed + 1}/${toProcess.length}] ${invoiceNo} — ${(meta.customerName || '').substring(0, 30).padEnd(30)}`);

      // Click the "View/Edit" action button (aria-label contains invoice number)
      // Button exists in DOM even when row isn't hovered — no need to hover first
      const btn = page.locator(`button[aria-label*="${invoiceNo}"]`).first();
      const btnCount = await btn.count();

      if (btnCount === 0) {
        console.log(`\n  ⚠ View/Edit button not found for ${invoiceNo}`);
        continue;
      }

      // Hover + click — both wrapped so a single flaky invoice doesn't crash the run
      try {
        await btn.hover({ timeout: 5000 });
        await btn.click({ timeout: 5000 });
      } catch (_) {
        // Button not interactable (e.g. off-screen, QB lazy render) — skip and continue
        process.stdout.write(` ⚠skipped`);
        await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        continue;
      }

      // Wait for navigation to invoice detail (URL should change to include txnId)
      try {
        await page.waitForURL(u => u.toString().includes('txnId'), { timeout: 10000 });
      } catch (_) {
        if (DEBUG) console.log(`\n  [DEBUG] No navigation for ${invoiceNo}, current URL: ${page.url()}`);
        await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        continue;
      }

      // Wait for invoice detail to fully render
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => page.waitForTimeout(5000));

      const detailUrl = page.url();
      const txnId     = detailUrl.match(/txnId=(\d+)/)?.[1] || null;

      if (DEBUG) {
        console.log(`\n  [DEBUG] ${invoiceNo} → URL: ${detailUrl.substring(0, 80)}`);
        console.log(`  [DEBUG] capturedByTxn has ${capturedByTxn.size} entries, txnId=${txnId}`);
        if (txnId) console.log(`  [DEBUG] API capture for this txn: ${capturedByTxn.has(txnId) ? 'YES' : 'NO'}`);
      }

      // Try API-captured line items
      let lineItems = (txnId && capturedByTxn.get(txnId)) || [];

      // DOM fallback
      if (lineItems.length === 0) {
        lineItems = await scrapeLineItemsDom(page);
      }

      if (DEBUG) {
        console.log(`  [DEBUG] Line items found: ${lineItems.length}`);
      }

      // Save full detail HTML for first few invoices when debugging
      if (DEBUG && processed < 3) {
        const html = await page.content();
        fs.writeFileSync(
          path.join(__dirname, `../data/debug_detail_${invoiceNo}.html`),
          html  // no truncation
        );
        console.log(`  [DEBUG] Detail HTML saved (${Math.round(html.length/1024)}KB)`);
      }

      if (lineItems.length === 0) {
        // Store a "no items" placeholder so we know this invoice was visited
        allItems.push({
          invoiceNo, qbInvoiceId: txnId, customerName: meta.customerName || '',
          txnDate: meta.txnDate || '', lineNum: 0,
          description: '', productService: '', qty: null, rate: null, amount: null,
          serviceType: 'NoItems',
        });
      } else {
        lineItems.forEach((item, idx) => {
          allItems.push({
            invoiceNo,
            qbInvoiceId:    txnId,
            customerName:   meta.customerName || '',
            txnDate:        meta.txnDate || '',
            lineNum:        item.lineNum || idx + 1,
            description:    item.description || '',
            productService: item.productService || '',
            qty:            item.qty ?? null,
            rate:           item.rate ?? null,
            amount:         item.amount ?? null,
            serviceType:    classify(item.description, item.productService),
          });
        });
      }

      processed++;
      byNo.delete(invoiceNo); // prevent re-processing on same page after goBack

      if (processed % 25 === 0) {
        saveItems(allItems);
        process.stdout.write(' [saved]');
      }

      // ── Navigate back to invoice list ───────────────────────────────────
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() =>
        page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' })
      );
      await page.waitForTimeout(3000);

      // Verify we're back on the list
      if (!page.url().includes('/app/invoices')) {
        await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
      }
    }

    // ── Paginate ───────────────────────────────────────────────────────────
    const nextBtn = await page.$(
      'button[aria-label="Next page"], [data-testid="pagination-next"], button:has-text("Next")'
    );
    if (!nextBtn) break;
    const disabled = await nextBtn.getAttribute('disabled');
    if (disabled !== null) break;

    console.log('');
    await nextBtn.click();
    await page.waitForTimeout(3000);
    pageNum++;
  }

  console.log(`\n\n✅ Done: ${allItems.length} items from ${processed} invoices`);
  saveItems(allItems);

  const dist = {};
  allItems.forEach(i => { dist[i.serviceType] = (dist[i.serviceType] || 0) + 1; });
  console.log('\nService type distribution:');
  Object.entries(dist).sort((a, b) => b[1] - a[1])
    .forEach(([t, c]) => console.log(`  ${t.padEnd(12)}: ${c}`));

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
