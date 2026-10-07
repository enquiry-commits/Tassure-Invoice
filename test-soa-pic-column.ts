// SOA PIC column = QuickBooks' own PIC (the Classes on the book's unpaid
// invoices), TeamWork's PIC only when none carries a Class (docs/INVARIANTS.md
// INV-PIC-008). Vincent, 2026-10-07: "只是算QB里面的负责人" / "退回公司资料里的负责人".
//
// Run: npx tsx test-soa-pic-column.ts
import { readFileSync } from 'fs';

let fail = 0;
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fail++; };

// picShownFor lives in a server module (lib/soa-data.ts imports server-only
// helpers), so its one-line rule is pinned by source here and exercised on
// live data in the verification script.
const read = (p: string) => readFileSync(p, 'utf8');
const data = read('lib/soa-data.ts');
check('the rule: invoice Classes when there are any, else the TeamWork PIC', /return fromInvoices\.length \? \[\.\.\.fromInvoices\] : \[\.\.\.fromCompanies\];/.test(data));
check('both SOA row builders fill picShown with it', (data.match(/picShown: picShownFor\(picFromInvoices, picFromCompanies\),/g) ?? []).length === 2);
check('the owner list is unchanged (still TeamWork + Classes, for the dropdown and the default owner)', (data.match(/picOptions: \[\.\.\.new Set\(\[\.\.\.picFromCompanies, \.\.\.picFromInvoices\]\)\],/g) ?? []).length === 2);

const page = read('app/billing/soa/_components.tsx');
check('the PIC column shows picShown (book rows and the combined ALL row)', /c\.picShown\.length \? c\.picShown\.map/.test(page) && /combined\.picShown\.length \? combined\.picShown\.map/.test(page) && !/c\.picOptions\.length \? c\.picOptions\.map/.test(page));
check('the PIC filter offers and matches the people the column shows', /for \(const p of c\.picShown\) names\.add\(p\);/.test(page) && /c\.picShown\.some\(p => selectedSet\.has\(p\)\)/.test(page));
check('the ALL row merges picShown from its books', /picShown: \[\.\.\.new Set\(group\.rows\.flatMap\(row => row\.picShown\)\)\]/.test(page) && /picShown: \[\.\.\.new Set\(rows\.flatMap\(row => row\.picShown\)\)\]/.test(page));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
