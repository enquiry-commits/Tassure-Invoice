// Billing Drafts' "Add line" = the book's live QuickBooks list, each item
// mapped to a draft service by ONE rule (docs/INVARIANTS.md INV-QB-034).
// Vincent, 2026-10-05: "和 QuickBooks 一样，全部列出", "不预填，和 TAO 一样".
//
// Run: npx tsx test-book-catalog.ts
import { readFileSync } from 'fs';
import { classifyCatalogItem } from './lib/qb-item-classify';

let fail = 0;
const check = (name: string, cond: boolean, got = '') => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `  (got ${got})`)); if (!cond) fail++; };
const is = (item: string, want: string | null) => { const got = classifyCatalogItem(item); check(`${item} → ${want}`, got === want, String(got)); };

console.log('--- item → service (live QuickBooks names) ---');
is('Secretary:Corporate Secretarial Services', 'Secretary');
is('Secretary:Registered Address Services', 'Address');
is('Secretary:Nominee Director Fees - WW', 'ND');
is('Nominee Director Fees - EL', 'ND');                    // TAC top-level, missing from the old list
is('Secretary:Nominee Director Fees - LXM.', 'ND');        // the dotted twin staff use
is('Secretary:Nominee Director Deposit', 'ND');
is('Secretary:Company XBRL Services', 'XBRL');
is('Disbursement:Government fee for filing Annual Return', 'AR');
is('Secretary:ACRA Fees', 'Other');                        // a fee, not secretarial work: no PIC, no "Sec" in the memo
is('Disbursement:Reimbursement Control Account', 'Other');
is('Discount Given', 'Discount');
is('Accounts:Yearly Accounts Services', 'Accounts');
is('Tax:Corporate Tax Services', 'Tax');
is('Secretary:Change of Director', 'Secretary');
is('Secretary:CPF Submission', 'Secretary');
is('Contra Account', 'Other');
is('Deferred Revenue - Corp Sec', null);                   // accounting's twin: never offered (INV-QB-029)
is('Secretary:Deferred - ND Fees - CD', null);

console.log('\n--- wiring ---');
const read = (p: string) => readFileSync(p, 'utf8');
const row = read('components/billing/ExpandedBillingRow.tsx');
check('Billing Drafts no longer uses the hardcoded QB_CATALOG', !/QB_CATALOG/.test(row));
check('both books add lines from their own live list, rate empty, book fixed', /<BookItemPicker book="TAB"/.test(row) && /<BookItemPicker book="TAC"/.test(row) && (row.match(/rate: 0, include: true, due: false, reason: 'Added manually', book: '(TAB|TAC)'/g) ?? []).length === 2);
const picker = read('components/billing/BookItemPicker.tsx');
check('a picked item brings its QuickBooks description', /description: item\.description\?\.trim\(\) \|\| item\.name/.test(picker));
check('a failed list is shown and never cached', /delete cache\[book\]; throw error;/.test(picker));
const catalog = read('lib/qb-item-catalog.ts');
check('the list is read live per book and a failed read throws', /fetchBookItemCatalog\(book/.test(catalog) && /if \(!result\) throw new Error/.test(catalog));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
