// Per-line PIC (QuickBooks Class) on invoice lines — docs/INVARIANTS.md
// INV-QB-007 (the DEFAULT) and INV-QB-026 (a person's per-line choice).
// Fixtures are real 2026-10-04 TAB classes (Id#Name from the live book).
//
// Run: npx tsx test-invoice-pic-class.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getsDefaultPicClass, picLivesInServiceItem, isStaffClassName, matchPicClass, validateLinePicClasses, requiresPicClass, isGovFeeLine,
  taoLineNeedsPic, taoDefaultPicName,
} from './lib/invoice-pic-class';
import { APPROVED_ACCOUNTS, canAccountOpen } from './lib/approved-accounts';
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

console.log('\n--- TAO: QuickBooks\' own settings restored ("尽量还原QB本来有的设定") ---');
{
  // Real shape: the 60 latest hand-made TAO invoices — Accounts/Tax lines 100% carry a Class, disbursements 0%.
  check('Accounts / Tax lines carry a PIC in QuickBooks; disbursement / OPE lines do not', taoLineNeedsPic({ service: 'Accounts' }) && taoLineNeedsPic({ service: 'Tax' }) && !taoLineNeedsPic({ service: 'Disbursement' }) && !taoLineNeedsPic({ service: 'Other' }));
  const history = {
    lastClassByProduct: new Map<string, string | null>([
      ['Accounts:Yearly Accounts Services', 'Tee Yu Heng'], ['Tax:Corporate Tax Services', 'Quinnie Tan'],
      ['Disbursement:Reimbursement - OPE', null], ['Accounts:Monthly Accounts Services', null],
    ]),
    lastClassByService: { Accounts: 'Tee Yu Heng', Tax: 'Quinnie Tan' } as Record<string, string>,
  };
  check('a service billed before restores the PIC its last line had', taoDefaultPicName({ service: 'Accounts', productService: 'Accounts:Yearly Accounts Services' }, history) === 'Tee Yu Heng'
    && taoDefaultPicName({ service: 'Tax', productService: 'Tax:Corporate Tax Services' }, history) === 'Quinnie Tan');
  check('a new Tax item takes the client\'s current Tax PIC; a new Accounts item its Accounts PIC', taoDefaultPicName({ service: 'Tax', productService: 'Tax:GST Submission Services' }, history) === 'Quinnie Tan'
    && taoDefaultPicName({ service: 'Accounts', productService: 'Accounts:Account Review' }, history) === 'Tee Yu Heng');
  check('an Accounts line whose last line had no Class still gets the client\'s Accounts PIC', taoDefaultPicName({ service: 'Accounts', productService: 'Accounts:Monthly Accounts Services' }, history) === 'Tee Yu Heng');
  check('disbursement / OPE lines start with no PIC, as in QuickBooks', taoDefaultPicName({ service: 'Disbursement', productService: 'Disbursement:Reimbursement - OPE' }, history) === null);
  check('a client with no TAO history starts with no PIC (nothing to restore)', taoDefaultPicName({ service: 'Tax', productService: 'Tax:Corporate Tax Services' }, { lastClassByProduct: new Map(), lastClassByService: {} }) === null);

  // Location: TAO's 17 Locations (live, 2026-10-04) are staff full names — each account whose name is one carries it.
  const TAO_LOCATIONS = new Set(['Ang Shi Ming', 'Chee Wei En', 'Chelsea Ang', 'Chin Kah Ye', 'Clarence Saw', 'Esther Loo', 'Hoo Seng Xin', 'Jay Tay', 'Jenny Lai', 'Lee Jing Fei', 'Lim Hoe Chyi', 'Quinnie Tan', 'Tan Yee Soon', 'Tee Yu Heng', 'Tey Shemin', 'Vernice Chai', 'Victoria Yap']);
  const withTao = APPROVED_ACCOUNTS.filter(a => a.qbLocations?.TAO);
  check('every account whose name is a TAO Location has it as its TAO Location (17)', withTao.length === 17 && withTao.every(a => a.qbLocations!.TAO === a.name && TAO_LOCATIONS.has(a.name))
    && APPROVED_ACCOUNTS.filter(a => TAO_LOCATIONS.has(a.name)).every(a => a.qbLocations?.TAO === a.name), withTao.map(a => a.name).join(', '));
  check('… and adding it changed no TAC Location and no permission', (APPROVED_ACCOUNTS.find(a => a.name === 'Hoo Seng Xin')?.qbLocations?.TAC === 'Seng Xin')
    && APPROVED_ACCOUNTS.filter(a => a.workspace === 'account' || a.workspace === 'tax').length === 8 && !!APPROVED_ACCOUNTS.find(a => a.name === 'Vincent Seow')?.admin && !APPROVED_ACCOUNTS.find(a => a.name === 'Vincent Seow')?.qbLocations?.TAO);

  // Every book's REAL active Locations (read from QuickBooks 2026-10-04 —
  // re-read and update these lists if one is added, renamed or deactivated).
  // Vincent, the same evening: "这个要全部开放啊 为什么只设TAO" — the
  // department split let TCS ACCOUNT/TAX bill in TAB/TAC, but their TAB
  // Locations (which already existed) were left unmapped.
  const LIVE_LOCATIONS: Record<'TAB' | 'TAC' | 'TAO', Set<string>> = {
    TAB: new Set(['Ang Shi Ming', 'Chee Wei En', 'Chelsea Ang', 'Chin Kah Ye', 'Clarence Saw', 'Esther Loo', 'Hoo Seng Xin', 'Jay Tay', 'Jenny Lai', 'Lee Jing Fei', 'Lim Hoe Chyi', 'Quinnie Tan', 'Tan Yee Soon', 'Tee Yu Heng', 'Tey Shemin', 'Vernice Chai', 'Victoria Yap']),
    TAC: new Set(['Chelsea Ang', 'Esther Loo', 'Jenny Lai', 'Kah Ye', 'Lim Hoe Chyi', 'Seng Xin', 'Shemin', 'Shi Ming']),
    TAO: TAO_LOCATIONS,
  };
  const withTab = APPROVED_ACCOUNTS.filter(a => a.qbLocations?.TAB);
  check('every account whose name is a TAB Location has it as its TAB Location (17)', withTab.length === 17
    && APPROVED_ACCOUNTS.filter(a => LIVE_LOCATIONS.TAB.has(a.name)).every(a => a.qbLocations?.TAB === a.name), withTab.map(a => a.name).join(', '));
  const notInBook = APPROVED_ACCOUNTS.flatMap(a => (['TAB', 'TAC', 'TAO'] as const).filter(book => a.qbLocations?.[book] && !LIVE_LOCATIONS[book].has(a.qbLocations[book]!)).map(book => `${a.name} ${book}="${a.qbLocations![book]}"`));
  check('every configured Location exists in that book (a missing one makes create-invoice refuse the invoice)', notInBook.length === 0, notInBook.join(', '));
  // The miss behind Vincent's question, as a rule: anyone who can generate
  // invoices in a book carries that book's Location whenever QuickBooks has
  // one in their name. (TAB/TAC are generated from Billing Drafts, TAO from
  // TAO Billing.)
  const billingPage: Record<'TAB' | 'TAC' | 'TAO', [string, URLSearchParams]> = {
    TAB: ['/billing', new URLSearchParams({ tab: 'billing' })], TAC: ['/billing', new URLSearchParams({ tab: 'billing' })], TAO: ['/billing/tao', new URLSearchParams()],
  };
  const unmapped = APPROVED_ACCOUNTS.flatMap(a => (['TAB', 'TAC', 'TAO'] as const)
    .filter(book => canAccountOpen(a, ...billingPage[book]) && LIVE_LOCATIONS[book].has(a.name) && a.qbLocations?.[book] !== a.name)
    .map(book => `${a.name} ${book}`));
  check('everyone who can bill in a book carries their Location there when QuickBooks has one in their name', unmapped.length === 0, unmapped.join(', '));
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

  const tao = read('components/billing/TaoInvoiceBuilder.tsx');
  check('TAO builder sends each line\'s PIC and the Statement memo', /picClassId: effectivePicId\(l\)/.test(tao) && /statementMemos: \{ TAO: composeTaoStatementMemo\(included\) \}/.test(tao));
  check('TAO builder restores the PIC with the shared rule, not a local copy', /taoDefaultPicName\(l, picHistory\)/.test(tao) && /taoLineNeedsPic\(l\)/.test(tao));
  const hist = read('app/api/billing/tao/service-history/route.ts');
  check('TAO history returns each service\'s last PIC and the PIC per service', /picClassName: item\.class_name/.test(hist) && /picByService\[item\.service_type\] = item\.class_name/.test(hist));
  const create = read('app/api/quickbooks/create-invoice/route.ts');
  check('create-invoice writes the Statement memo as PrivateNote, only when given, max 4,000 chars', /\{ PrivateNote: statementMemo\.trim\(\) \}/.test(create) && /m\.length > 4000/.test(create) && /statementMemos\?\.\[company\]/.test(create));
  check('TAO popup is wide enough for the PIC column (1100)', /maxWidth: 1100/.test(read('app/billing/tao/page.tsx')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
