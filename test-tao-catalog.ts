// TAO builder's service list = QuickBooks' own list (docs/INVARIANTS.md
// INV-QB-032). Vincent, 2026-10-05: "TAO 为什么不完整的，没有这个Discount
// 的选项…Description 也不完善" → all items like QuickBooks, descriptions as
// QuickBooks has them, TAO skips the TAB/TAC renewal-period check.
//
// Run: npx tsx test-tao-catalog.ts
import { readFileSync } from 'fs';

let fail = 0;
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fail++; };
const read = (p: string) => readFileSync(p, 'utf8');

const services = read('lib/tao-services.ts');
check('the catalog keeps no-category items (Discount Given, Sales, Contra…) as a "General" group', /: 'General';/.test(services) && /\[\.\.\.CATEGORY_NAMES, 'General'\]/.test(services) && !/if \(!row\.SubItem\) continue;/.test(services));
check('a failed QuickBooks read throws instead of returning an empty list', /if \(!result\) throw new Error/.test(services));
check('the services route answers a failure with an error status', /status: 502/.test(read('app/api/billing/tao/services/route.ts')));

const builder = read('components/billing/TaoInvoiceBuilder.tsx');
check('"Custom / Other…" has its own category (it used to add Other:ACRA Fees)', /category: 'Custom'/.test(builder) && /\? CUSTOM_OTHER\s*\n?\s*:/.test(builder) && !/catalog\.find\(x => x\.category === 'Other'\)/.test(builder));
check('a new line starts with the item\'s own QuickBooks description', /description: opt\.description\?\.trim\(\) \|\| opt\.label/.test(builder) && /description: item\.description,/.test(builder));
check('no-category items count as "Other" (no PIC demanded, no renewal logic)', /service: group\.category === 'General' \? 'Other' : group\.category/.test(builder));
check('a failed list is never cached and is shown, with Add New Service hidden', /\.catch\(error => \{ catalogPromise = null; throw error; \}\)/.test(builder) && /!catalogError && <option value="__add_new__">/.test(builder));

const create = read('app/api/quickbooks/create-invoice/route.ts');
check('TAO skips the TAB/TAC renewal-period check; TAB/TAC keep it', /company === 'TAO'\s*\n?\s*\? \{ blocking: \[\] as string\[\], overlapWarnings: \[\] as string\[\] \}\s*\n?\s*: await validateRenewalPeriods\(/.test(create));
check('the item map reads up to 1000 services (was 200 → keyword guessing)', /Type = \\'Service\\' MAXRESULTS 1000/.test(read('lib/qb-invoice-conventions.ts')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
