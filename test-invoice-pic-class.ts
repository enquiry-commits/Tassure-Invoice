// Per-line PIC (QuickBooks Class) on invoice lines — docs/INVARIANTS.md
// INV-QB-007 (the DEFAULT) and INV-QB-026 (a person's per-line choice).
// Fixtures are real 2026-10-04 TAB classes (Id#Name from the live book).
//
// Run: npx tsx test-invoice-pic-class.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getsDefaultPicClass, picLivesInServiceItem, isStaffClassName, matchPicClass, validateLinePicClasses, requiresPicClass, isGovFeeLine,
} from './lib/invoice-pic-class';
import { buildInvoiceLineArray, type DraftLineItem } from './lib/qb-invoice-conventions';

const ROOT = process.env.PIC_GUARD_ROOT ?? process.cwd();
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

// Real TAB classes, including the 2025 initials and numeric reference classes.
const TAB_CLASSES = [
  { Id: '721457', Name: 'Jenny Lai' }, { Id: '756875', Name: 'JL' }, { Id: '756972', Name: 'ASM' },
  { Id: '757274', Name: 'HIGO HOLDINGS' }, { Id: '756906', Name: 'Pend' }, { Id: '240001365', Name: '240001365' },
  { Id: '766458', Name: 'To Be Assign' }, { Id: '1000000002', Name: 'Lim Hoe Chyi' }, { Id: '1000000004', Name: 'Ang Shi Ming' },
  { Id: '1000000006', Name: 'Chin Kah Ye' }, { Id: '1000000011', Name: 'Tey Shemin' }, { Id: '721464', Name: 'Victoria yap' },
  { Id: '999', Name: 'Old Staff', Active: false },
];

console.log('--- the DEFAULT rule (INV-QB-007) is unchanged ---');
const L = (service: string, productService = '') => ({ service, productService });
check('TAB Secretary and XBRL lines get the company PIC by default', getsDefaultPicClass('TAB', L('Secretary')) && getsDefaultPicClass('TAB', L('XBRL')));
check('… Address, AR, ND, Deferred, Accounts, Tax and discounts do not', ['Address', 'AR', 'ND', 'Deferred', 'Accounts', 'Tax', 'Discount', 'Other'].every(s => !getsDefaultPicClass('TAB', L(s))));
check('… a government-fee / disbursement line never does, whatever its service', !getsDefaultPicClass('TAB', L('Secretary', 'Disbursement:Government fee for filing Annual Return')));
check('… TAC and TAO lines never get a default PIC', !getsDefaultPicClass('TAC', L('Secretary')) && !getsDefaultPicClass('TAO', L('XBRL')));
check('requiresPicClass / isGovFeeLine keep their old meaning (re-exported for old imports)', requiresPicClass(L('XBRL')) && !requiresPicClass(L('Address')) && isGovFeeLine(L('AR')) && isGovFeeLine(L('Other', 'Government fee')));
check('a TAC Nominee Director line keeps its PIC in the ND item, never a Class', picLivesInServiceItem(L('ND')) && !picLivesInServiceItem(L('Secretary')));

console.log('\n--- which Classes the PIC dropdown offers ---');
check('staff full names are offered (incl. "Victoria yap", "To Be Assign")', ['Ang Shi Ming', 'Jenny Lai', 'Victoria yap', 'To Be Assign', 'Lim Hoe Chyi'].every(isStaffClassName));
check('2025 initials, codes, company names and numeric reference classes are not', ['JL', 'ASM', 'Pend', 'CASBIO', 'HIGO HOLDINGS', '240001365', 'I250106003029', '21VC0076J', ''].every(n => !isStaffClassName(n)));

console.log('\n--- the company PIC → Class matcher (moved verbatim from findPicClass) ---');
check('word order does not matter: "Shi Ming Ang" → Ang Shi Ming', matchPicClass(TAB_CLASSES, 'Shi Ming Ang')?.value === '1000000004');
check('"Jenny Lai" matches the full-name class, not the 2025 initials "JL"', matchPicClass(TAB_CLASSES, 'Jenny Lai')?.value === '721457');
check('a subset matches: "Shemin" → Tey Shemin', matchPicClass(TAB_CLASSES, 'Shemin')?.value === '1000000011');
check('several PICs: the first that matches wins', matchPicClass(TAB_CLASSES, 'Kah Ye Chin, Jenny Lai')?.value === '1000000006');
check('no match → null (and an inactive class never matches)', matchPicClass(TAB_CLASSES, 'Nobody Here') === null && matchPicClass(TAB_CLASSES, 'Old Staff') === null);

console.log('\n--- a person\'s per-line choice is checked against the live book ---');
{
  const ok = validateLinePicClasses([{ service: 'Address', picClassId: '721457' }, { service: 'Secretary', picClassId: null }, { service: 'AR' }], TAB_CLASSES);
  check('a valid Class on ANY service line is accepted; null and absent are left alone', ok.ok && ok.classes.size === 1 && ok.classes.get('721457')?.name === 'Jenny Lai');
  const legacy = validateLinePicClasses([{ service: 'Secretary', picClassId: '756875' }], TAB_CLASSES);
  check('a legacy 2025 Class already on a live line ("JL") is still accepted — kept, not dropped', legacy.ok && legacy.classes.get('756875')?.name === 'JL');
  const unknown = validateLinePicClasses([{ service: 'Secretary', description: 'Perform secretarial services', picClassId: '123456' }], TAB_CLASSES);
  check('an unknown Class is refused with the line named', !unknown.ok && /Perform secretarial services/.test(unknown.error));
  const inactive = validateLinePicClasses([{ service: 'Secretary', picClassId: '999' }], TAB_CLASSES);
  check('an inactive Class is refused', !inactive.ok);
  const nd = validateLinePicClasses([{ service: 'ND', picClassId: '721457' }], TAB_CLASSES);
  check('a Class on a Nominee Director line is refused (INV-QB-007)', !nd.ok && /Nominee Director/.test(nd.error));
}

console.log('\n--- what actually reaches QuickBooks (buildInvoiceLineArray) ---');
{
  const items = new Map([
    ['secretary:corporate secretarial services', { id: '10', name: 'Secretary:Corporate Secretarial Services' }],
    ['secretary:registered address services', { id: '11', name: 'Secretary:Registered Address Services' }],
    ['disbursement:government fee for filing annual return', { id: '12', name: 'Disbursement:Government fee for filing Annual Return' }],
    ['deferred revenue - corp sec', { id: '13', name: 'Deferred Revenue - Corp Sec' }],
    ['xbrl', { id: '14', name: 'XBRL' }],
  ]);
  const companyPic = { value: '721457', name: 'Jenny Lai' };
  const line = (service: string, productService: string, extra: Partial<DraftLineItem> = {}): DraftLineItem => ({ service, productService, description: service, rate: 100, qty: 1, ...extra });
  const classOf = (built: ReturnType<typeof buildInvoiceLineArray>) => built.map(b => (b.SalesItemLineDetail as { ClassRef?: { name: string } }).ClassRef?.name ?? null);

  const legacy = buildInvoiceLineArray([
    line('Secretary', 'Secretary:Corporate Secretarial Services'), line('Address', 'Secretary:Registered Address Services'),
    line('AR', 'Disbursement:Government fee for filing Annual Return'), line('Deferred', 'Deferred Revenue - Corp Sec'), line('XBRL', 'XBRL'),
  ], items, companyPic);
  check('no per-line choice → EXACTLY the old default: PIC on Secretary + XBRL only', JSON.stringify(classOf(legacy)) === JSON.stringify(['Jenny Lai', null, null, null, 'Jenny Lai']), JSON.stringify(classOf(legacy)));

  const chosen = new Map([['1000000004', { value: '1000000004', name: 'Ang Shi Ming' }], ['721457', { value: '721457', name: 'Jenny Lai' }]]);
  const picked = buildInvoiceLineArray([
    line('Secretary', 'Secretary:Corporate Secretarial Services', { picClassId: '1000000004' }),
    line('Address', 'Secretary:Registered Address Services', { picClassId: '721457' }),
    line('XBRL', 'XBRL', { picClassId: null }),
    line('Deferred', 'Deferred Revenue - Corp Sec', { picClassId: '1000000004' }),
    line('AR', 'Disbursement:Government fee for filing Annual Return'),
  ], items, companyPic, chosen);
  check('a person\'s choice wins on every line; null means none even on XBRL; an untouched line keeps the default', JSON.stringify(classOf(picked)) === JSON.stringify(['Ang Shi Ming', 'Jenny Lai', null, 'Ang Shi Ming', null]), JSON.stringify(classOf(picked)));

  let threw = false;
  try { buildInvoiceLineArray([line('Secretary', 'Secretary:Corporate Secretarial Services', { picClassId: '555' })], items, companyPic, chosen); } catch { threw = true; }
  check('an explicit PIC that was never validated throws instead of being silently dropped', threw);

  // Edit round trip: every line sent back with the Class it was loaded with.
  const live = [{ id: '721457', name: 'Jenny Lai' }, { id: '756875', name: 'JL' }, null];
  const roundTrip = buildInvoiceLineArray(live.map((c, i) => line(['Secretary', 'Deferred', 'Address'][i], '', { picClassId: c?.id ?? null })), items, companyPic,
    new Map(live.filter(Boolean).map(c => [c!.id, { value: c!.id, name: c!.name }])));
  check('editing round-trips every line\'s Class exactly (incl. a legacy "JL" and a deliberate none)', JSON.stringify(classOf(roundTrip)) === JSON.stringify(['Jenny Lai', 'JL', null]), JSON.stringify(classOf(roundTrip)));
}

console.log('\n--- source guards: the routes and the popup use the shared rules ---');
{
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  for (const route of ['app/api/quickbooks/create-invoice/route.ts', 'app/api/quickbooks/update-invoice/route.ts']) {
    const src = read(route);
    check(`${route.split('/').slice(-2, -1)[0]}: validates per-line PICs against the live book, then builds with them`,
      /validateLinePicClasses\(lines, classes\)/.test(src) && /buildInvoiceLineArray\(lines, itemMap, picClass, chosenClasses\)/.test(src) && /listActiveClasses\(token, realmId\)/.test(src));
    check(`${route.split('/').slice(-2, -1)[0]}: rejects a malformed line PIC up front`, /A line PIC must be a QuickBooks Class id\./.test(src));
  }
  const popup = read('components/billing/ExpandedBillingRow.tsx');
  check('popup: both Generate and Save send each line\'s PIC (picClassId) as shown', (popup.match(/picClassId: effectivePicId\(l, company\)/g) ?? []).length === 2);
  check('popup: edit mode loads each live line\'s Class', /picClassId: l\.picClass\?\.value \?\? null/.test(popup));
  check('popup: default PIC comes from the shared rule, not a local copy', /getsDefaultPicClass\(company, l\)/.test(popup) && !/service === 'Secretary' \|\| .*service === 'XBRL'/.test(popup));
  check('live invoice reader returns each line\'s Class', /picClass: classRef\.value \?/.test(read('lib/quickbooks-invoice-lines.ts')));
  check('Billing Drafts popup is wide enough for the PIC column (1280)', /maxWidth: 1280/.test(read('app/billing/page.tsx')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
