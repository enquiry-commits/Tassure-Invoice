// Run: npx tsx test-originals-export.ts — monthly originals export rules (lib/originals-export.ts, INV-QB-040).
import { buildManifestCsv, buildMissingCsv, canExportOriginals, exportFileName, isMonth, monthRange, previousMonth, uniqueName, zipName, type ExportOutcome } from './lib/originals-export';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

check('month range: a 30-day month', JSON.stringify(monthRange('2026-09')) === '{"from":"2026-09-01","to":"2026-09-30"}');
check('month range: February in a leap year / not', monthRange('2028-02').to === '2028-02-29' && monthRange('2026-02').to === '2026-02-28');
check('month range: December', monthRange('2026-12').to === '2026-12-31');
check('only YYYY-MM is a month', isMonth('2026-09') && !isMonth('2026-13') && !isMonth('2026-9') && !isMonth('2026-09-01') && !isMonth(202609));
check('a bad month is refused', (() => { try { monthRange('2026-00'); return false; } catch { return true; } })());
check('the task asks for the month BEFORE today (and crosses the year)', previousMonth('2026-10-03') === '2026-09' && previousMonth('2027-01-05') === '2026-12');
check('only Vincent and Chelsea may export', canExportOriginals('vincent@tassure.com') && canExportOriginals('Chelsea@Tassure.com ') && !canExportOriginals('kahye@tassure.com') && !canExportOriginals(null));
check('ZIP names are per book and month', zipName('TAC', '2026-09') === 'TAC-originals-2026-09.zip');

const inv = { book: 'TAB' as const, invoiceNo: '02611132', customerName: 'Mirileh Pte. Ltd.', totalAmt: 1600, status: 'Open' };
check('file name = the house name', exportFileName(inv) === 'INV02611132-Mirileh Pte. Ltd.-S$1600.pdf', exportFileName(inv));
check('a voided invoice is marked VOID in its file name', exportFileName({ ...inv, status: 'Voided' }).endsWith('-S$1600-VOID.pdf'));
const used = new Set<string>();
check('two invoices with the same file name never overwrite each other in the ZIP', uniqueName('a.pdf', used) === 'a.pdf' && uniqueName('A.pdf', used) === 'A (2).pdf' && uniqueName('a.pdf', used) === 'a (3).pdf');

const outcomes: ExportOutcome[] = [
  { ...inv, qbInvoiceId: '1', txnDate: '2026-09-30', source: 'quickbooks', reason: null, fileName: exportFileName(inv) },
  { ...inv, qbInvoiceId: '2', invoiceNo: '02610167', customerName: 'Co, "Operate"', txnDate: '2026-09-02', source: null, reason: 'no PDF attached', fileName: null },
];
const manifest = buildManifestCsv(outcomes), missing = buildMissingCsv(outcomes);
check('the manifest lists every invoice, with its source or MISSING', manifest.includes('02611132') && manifest.includes('QuickBooks PDF') && manifest.includes('MISSING — no PDF attached'));
check('CSV cells with commas / quotes are escaped', manifest.includes('"Co, ""Operate"""'));
check('MISSING.csv has only the invoices with no original', missing.includes('02610167') && !missing.includes('02611132'));
check('the CSVs open in Excel with Chinese/Unicode intact (BOM) and CRLF lines', manifest.startsWith('﻿') && manifest.includes('\r\n'));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
