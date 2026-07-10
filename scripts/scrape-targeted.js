/**
 * Targeted scraper — finds QB invoices by COMPANY NAME for the 35 AR Reminder clients.
 *
 * Strategy:
 *   1. Paginate through QB invoice list
 *   2. Extract (customerName, QB-referenceNumber) from each visible row
 *   3. When a row's customer name matches a target company, use the QB reference number
 *      to click its action button (button[aria-label*="<refNum>"])
 *   4. Scrape line items via API intercept + DOM fallback
 *   5. goBack() to list and continue
 *
 * Usage: node scripts/scrape-targeted.js
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const SESSION_FILE = path.join(__dirname, '../data/qb_session.json');
const OUT_FILE     = path.join(__dirname, '../data/qb_targeted_items.json');

// ── 35 Target companies (authoritative list from AR Reminder) ─────────────────
const ALL_TARGET_COMPANIES = [
  'AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING PTE. LTD.',
  'AFRI S GROUP PTE. LTD.',
  'BROTH BEYOND SINGAPORE PTE. LTD.',
  'CHINASIN MARINE ENGINEERING PTE. LTD.',
  'CHRONOAI PTE. LTD.',
  'CHENG HE CONSTRUCTION PTE. LTD.',
  'DJ BEAUTY TANG PTE. LTD.',
  'ELECTRAMIN INTERNATIONAL PTE. LTD.',
  'GOOHAH SHIPPING PTE. LTD.',
  'GOLDEN LOTUS INFORMATION SERVICE PTE. LTD.',
  'HONG YANG DEVELOPMENT PTE. LTD.',
  'HAI RUI PTE. LTD.',
  'H & W SPA PTE. LTD.',
  'IHORIZON CONSULTING SINGAPORE PTE. LTD.',
  'I-LINK TECHNOLOGY PTE. LTD.',
  'INFINITY LINKS PTE. LTD.',
  'JIA JIA FU PTE. LTD.',
  'JOPHEN INVESTMENT MANAGEMENT PTE. LTD.',
  'LOYANG BESTCON TRADING & SERVICES',
  'LIE YANG CONSTRUCTION PTE. LTD.',
  'LYNKORA TECHNOLOGY PTE. LTD.',
  'MUTUAL SYNERGY TRADING PTE. LTD.',
  'MERIT BULK PTE. LTD.',
  'NAJIWAN PTE. LTD.',
  'OCEANIC APEX SHIPPING PTE. LTD.',
  'QAP LEISURE ASSET HOLDINGS PTE. LTD.',
  'RUICHI INTERNATIONAL TRADING PTE. LTD.',
  'STARTASTER TECHNOLOGY PTE. LTD.',
  'SNACKING PTE. LTD.',
  'SUPER MALL PTE. LTD.',
  'TAIHUA SHIPPING PTE. LTD.',
  'TOUCHSTONE MEDTECH PTE. LTD.',
  'TRILITHON CAPITAL PTE. LTD.',
  'YUAN SOON CONSTRUCTION PTE. LTD.',
  'BAOBABTREE (S) PTE. LTD.',
];

// Run with --missing-only to only target companies not yet in Supabase
const MISSING_ONLY = process.argv.includes('--missing-only');
const TARGET_COMPANIES = MISSING_ONLY ? [
  'CHENG HE CONSTRUCTION PTE. LTD.',
  'LOYANG BESTCON TRADING & SERVICES',
  'STARTASTER TECHNOLOGY PTE. LTD.',
  'TOUCHSTONE MEDTECH PTE. LTD.',
  'YUAN SOON CONSTRUCTION PTE. LTD.',
] : ALL_TARGET_COMPANIES;

// ── Fuzzy company name matching ───────────────────────────────────────────────
function normalize(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bsdn\.?\s*bhd\.?\b/gi, '')
    .replace(/\(s\)/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function wordOverlap(a, b) {
  const wa = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const wb = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa,...wb]).size;
  return union ? inter/union : 0;
}
function matchTarget(qbName) {
  let best = null, bestScore = 0;
  for (const t of TARGET_COMPANIES) {
    const s = wordOverlap(qbName, t);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  // Require at least 55% AND at least 1 real word overlap
  const wa = new Set(normalize(qbName).split(' ').filter(w=>w.length>2));
  const wb = new Set(normalize(best||'').split(' ').filter(w=>w.length>2));
  const inter = [...wa].filter(w=>wb.has(w)).length;
  return (bestScore >= 0.55 && inter >= 1) ? best : null;
}

// ── Service classification ────────────────────────────────────────────────────
const SERVICE_PATTERNS = [
  { type: 'Secretary', kw: ['secretarial','secretary','corp sec','corporate secretarial','statutory'] },
  { type: 'Address',   kw: ['registered address','reg address','address service','mailing address','virtual office','registered office'] },
  { type: 'ND',        kw: ['nominee director','nd service','nd fee','local director','resident director'] },
  { type: 'AR',        kw: ['annual return','ar filing','acra annual','government fee','acra fee'] },
  { type: 'AGM',       kw: ['agm','annual general meeting'] },
  { type: 'XBRL',      kw: ['xbrl','ixbrl'] },
  { type: 'Accounts',  kw: ['bookkeeping','accounts preparation','financial statement','accounting','compilation','management account'] },
  { type: 'Tax',       kw: ['tax return','tax filing','income tax','iras','form c','gst'] },
  { type: 'Deferred',  kw: ['deferred revenue','advance payment'] },
];
function classify(desc, product) {
  const t = `${desc||''} ${product||''}`.toLowerCase();
  for (const { type, kw } of SERVICE_PATTERNS) {
    if (kw.some(k => t.includes(k))) return type;
  }
  return 'Other';
}

// ── API intercept helper ──────────────────────────────────────────────────────
function parseQBInvoiceJSON(inv) {
  if (!inv?.Line) return [];
  return inv.Line
    .filter(l => l.DetailType === 'SalesItemLineDetail')
    .map((l, i) => {
      const d = l.SalesItemLineDetail || {};
      return {
        lineNum:        l.LineNum || i + 1,
        description:    l.Description || '',
        productService: d.ItemRef?.name || '',
        qty:            d.Qty ?? null,
        rate:           d.UnitPrice ?? null,
        amount:         l.Amount ?? null,
      };
    }).filter(l => l.amount || l.rate);
}

// ── DOM scrape fallback ───────────────────────────────────────────────────────
async function scrapeLineItemsDom(page) {
  return page.evaluate(() => {
    const items = [];
    const inputs = document.querySelectorAll('input[aria-label^="Product or service line "]');
    for (const input of inputs) {
      const m = input.getAttribute('aria-label').match(/line (\d+)$/);
      if (!m) continue;
      const n = m[1];
      const product = (input.value||'').trim();
      if (!product) continue;
      const descEl = document.querySelector(`[aria-label="Description line ${n}"]`);
      const desc   = (descEl?.value||descEl?.innerText||'').trim();
      const qty    = parseFloat((document.querySelector(`input[aria-label="Quantity line ${n}"]`)?.value||'').replace(/[^0-9.]/g,''))||null;
      const rate   = parseFloat((document.querySelector(`input[aria-label="Rate line ${n}"]`)?.value||'').replace(/[^0-9.]/g,''))||null;
      const amount = parseFloat((document.querySelector(`input[aria-label="Amount line ${n}"]`)?.value||'').replace(/[^0-9.]/g,''))||null;
      if (!amount && !rate) continue;
      items.push({ lineNum: parseInt(n,10), productService: product, description: desc, qty, rate, amount });
    }
    return items;
  });
}

// ── Get invoice rows from current list page ───────────────────────────────────
// Returns: [{ refNum, customerName, txnDate }]
// QB list columns vary, so we detect by content rather than fixed index.
async function getPageRows(page) {
  return page.evaluate(() => {
    const rows = [];
    const trs = document.querySelectorAll(
      'tbody tr.selectable, tbody tr[tabindex], tbody tr'
    );
    for (const tr of trs) {
      const cells = [...tr.querySelectorAll('td')].map(c => c.innerText.trim());
      if (cells.length < 3) continue;
      const hasDate = cells.some(t => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t));
      if (!hasDate) continue;

      // Find reference number: a pure 5-9 digit cell (not a date, not an amount)
      const refNum = cells.find(c => /^\d{5,9}$/.test(c));
      if (!refNum) continue;

      const refIdx = cells.indexOf(refNum);
      // Date is typically before or after the ref number
      const txnDate = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || null;
      // Customer name is typically immediately after the ref number
      const customerName = cells[refIdx + 1] || '';
      if (!customerName || customerName.length < 3) continue;
      // Skip if it looks like a status word or amount
      if (/^(open|paid|overdue|draft|void|pending|\$)/.test(customerName.toLowerCase())) continue;

      rows.push({ refNum, customerName, txnDate });
    }
    return rows;
  });
}

async function run() {
  console.log(`\nTargeted scrape: ${TARGET_COMPANIES.length} companies\n`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    ...(fs.existsSync(SESSION_FILE) ? { storageState: SESSION_FILE } : {}),
  });
  const page = await context.newPage();

  // ── API intercept ──────────────────────────────────────────────────────────
  const capturedByTxn = new Map();
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) return;
      const json = await resp.json().catch(() => null);
      if (!json) return;
      const inv = json?.Invoice;
      if (inv?.Id && Array.isArray(inv.Line)) {
        const lines = parseQBInvoiceJSON(inv);
        if (lines.length > 0) capturedByTxn.set(String(inv.Id), lines);
      }
    } catch (_) {}
  });

  // ── Login ──────────────────────────────────────────────────────────────────
  await page.goto('https://qbo.intuit.com/app/homepage', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('qbo.intuit.com/app/')) {
    console.log('👉 Log in to QuickBooks (up to 5 min)…');
    await page.waitForURL(u => u.toString().includes('qbo.intuit.com/app/'), { timeout: 300000 });
    await context.storageState({ path: SESSION_FILE });
    console.log('✅ Logged in — session saved\n');
  } else {
    console.log('✅ Session restored\n');
  }

  const results = [];
  // companyCount[target] = number of invoices scraped
  const companyCount = new Map(TARGET_COMPANIES.map(n => [n, 0]));
  const MAX_PER = 2; // get up to 2 recent invoices per company

  await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  let pageNum = 1;
  let noNewPages = 0; // pages with zero new matches → stop

  while (true) {
    const rows = await getPageRows(page);
    console.log(`\n  Page ${pageNum}: ${rows.length} invoice rows visible`);

    if (rows.length === 0) {
      console.log('  No rows — stopping');
      break;
    }

    let matchedThisPage = 0;
    // We need to be careful: after going back, the page resets to page 1.
    // So collect all matches on this page first, then process them one by one.
    const toProcess = [];
    for (const row of rows) {
      const target = matchTarget(row.customerName);
      if (!target) continue;
      if ((companyCount.get(target)||0) >= MAX_PER) continue;
      toProcess.push({ ...row, target });
    }

    // Process matches on this page
    for (const { refNum, customerName, txnDate, target } of toProcess) {
      if ((companyCount.get(target)||0) >= MAX_PER) continue;

      process.stdout.write(`  → [${refNum}] "${customerName.substring(0,35)}" → ${target.substring(0,30)} … `);

      try {
        // Use the QB reference number to find the action button
        // (same mechanism as original scraper — button[aria-label*="<refNum>"])
        const btn = page.locator(`button[aria-label*="${refNum}"]`).first();

        if (await btn.count() === 0) {
          console.log(`⚠ no button found for ref=${refNum}`);
          // Fallback: hover the row then look for a button
          const row = page.locator('tbody tr').filter({ hasText: refNum }).first();
          if (await row.count() > 0) {
            await row.hover({ timeout: 4000 });
            await page.waitForTimeout(600);
          }
          const btn2 = page.locator(`button[aria-label*="${refNum}"]`).first();
          if (await btn2.count() === 0) {
            console.log(`⚠ still not found after hover — skip`);
            continue;
          }
          await btn2.hover({ timeout: 4000 });
          await btn2.click({ timeout: 5000 });
        } else {
          await btn.hover({ timeout: 4000 });
          await btn.click({ timeout: 5000 });
        }

        await page.waitForURL(u => u.toString().includes('txnId'), { timeout: 12000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => page.waitForTimeout(5000));

        const txnId = page.url().match(/txnId=(\d+)/)?.[1] || null;

        // Try API-captured line items first, then DOM fallback
        let lineItems = (txnId && capturedByTxn.get(txnId)) || [];
        if (lineItems.length === 0) lineItems = await scrapeLineItemsDom(page);

        if (lineItems.length === 0) {
          console.log(`⚠ 0 line items (txn=${txnId})`);
        } else {
          lineItems.forEach(item => {
            results.push({
              invoiceNo:      refNum,
              qbInvoiceId:    txnId,
              customerName:   target,
              qbCustomerName: customerName,
              txnDate,
              lineNum:        item.lineNum,
              description:    item.description,
              productService: item.productService,
              qty:            item.qty,
              rate:           item.rate,
              amount:         item.amount,
              serviceType:    classify(item.description, item.productService),
            });
          });
          companyCount.set(target, (companyCount.get(target)||0) + 1);
          matchedThisPage++;
          console.log(`✓ ${lineItems.length} lines`);
        }

      } catch (err) {
        console.log(`✗ ${err.message.substring(0,60)}`);
      }

      // Go back to invoice list
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() =>
        page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' })
      );
      await page.waitForTimeout(3000);
      if (!page.url().includes('/app/invoices')) {
        await page.goto('https://qbo.intuit.com/app/invoices', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
      }

      // After goBack we're on the same paginated page — re-fetch rows to verify
      // (goBack preserves page position in QB)
    }

    // Save incrementally
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify({
      scraped_at: new Date().toISOString(), total: results.length, items: results,
    }, null, 2));

    const done = [...companyCount.values()].filter(v=>v>0).length;
    console.log(`  Matched ${done}/${TARGET_COMPANIES.length} companies, ${results.length} items total`);

    if (done >= TARGET_COMPANIES.length) { console.log('  All done!'); break; }

    if (matchedThisPage === 0) noNewPages++;
    else noNewPages = 0;
    if (noNewPages >= 8) { console.log('  8 pages with no new matches — stopping'); break; }

    // Paginate
    const nextBtn = page.locator('button[aria-label="Next page"], button:has-text("Next")').first();
    if (await nextBtn.count() === 0 || await nextBtn.isDisabled()) {
      console.log('\n  Last page reached.');
      break;
    }
    await nextBtn.click();
    await page.waitForTimeout(3000);
    pageNum++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const done = [...companyCount.values()].filter(v=>v>0).length;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ Done: ${done}/${TARGET_COMPANIES.length} companies, ${results.length} line items`);
  console.log(`📄 Saved → data/qb_targeted_items.json\n`);

  console.log('Per-company results:');
  TARGET_COMPANIES.forEach(n => {
    const cnt = companyCount.get(n)||0;
    console.log(`  ${cnt>0?'✓':'✗'} ${n.substring(0,45).padEnd(45)}: ${cnt} invoice(s)`);
  });

  const dist = {};
  results.forEach(r => { dist[r.serviceType] = (dist[r.serviceType]||0)+1; });
  console.log('\nService type distribution:');
  Object.entries(dist).sort((a,b)=>b[1]-a[1]).forEach(([t,c]) => console.log(`  ${t.padEnd(12)}: ${c}`));

  await browser.close();
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
