// SOA email drafts (docs/INVARIANTS.md INV-MAIL-006). Two decisions, both in lib/soa-draft-resolution.ts:
//
//  1. WHO — an SOA chases a debt, and a debt outlives the client relationship. Vincent, 2026-10-07: "就算已经不在TW了…我们
//     还是需要发SOA 去追债". So the single-company SOA draft lookup resolves a company that is inactive / Terminated / Striking
//     Off, by EXACT name, ahead of the fuzzy match over the live roster (which could otherwise hand it to a similarly named
//     active company: a collections email to the wrong client). Nothing else loosens: AR, letters and Campaign Centre's bulk
//     list keep the active-only rule (INV-TW-024 / INV-AR-017 / INV-AR-018).
//  2. WHAT — the body lists the invoices the attached statement shows. The statement finds the QuickBooks customer with a
//     fuzzy match; the body used the company's own exact name and listed "(no invoices)" / S$0.00 when the two differ.
//
// Run: npx tsx test-soa-draft-resolution.ts
import fs from 'fs';
import path from 'path';
import { findSoaDebtorCompany, resolveDraftCompany, soaBodyInvoices, soaBodyFuzzyKeys, customerBelongsToAnotherCompany, coverOnlyRefs, coverOnlyBooks, isCoverOnlyDebt, SOA_BOOKS, type SoaRowLike } from './lib/soa-draft-resolution';
import { normalize, findUniqueBestMatch, matchScore } from './lib/company-name';
import { isActiveCompany } from './lib/company-lifecycle';
import type { CompanyRow } from './lib/client-comms-resolve';
import type { InvoiceRef } from './lib/email-merge';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (!cond && detail ? `\n       ${detail}` : ''));
  if (!cond) fail++;
};
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const company = (id: number, name: string, active: boolean): CompanyRow => ({
  id, company_name: name, best_email: `c${id}@example.com`, primary_contact: null, tw_to_emails: null, tw_cc_emails: null,
  tw_recipient_source: null, tw_recipient_synced_at: null, pic: null, is_active: active,
});

// The live-roster finder every draft lookup always used: exact normalized name, then the unique fuzzy match (≥ 70) —
// the same two steps as lib/client-comms-resolve.ts makeCompanyFinder (which cannot be imported here: it reaches server-only code).
const finderOver = (list: CompanyRow[]) => (name: string): CompanyRow | null => {
  const n = normalize(name);
  return list.find(c => normalize(c.company_name) === n) ?? findUniqueBestMatch(name, list, c => c.company_name).value;
};

const EVOP = 'EVOP (SINGAPORE) INTERNATIONAL PTE. LTD.';

console.log('--- 1. WHO: an SOA draft still finds a company that is no longer on the live roster ---');
{
  const evop = company(7, EVOP, false);
  const every = [company(1, 'ALPHA PTE. LTD.', true), evop, company(9, 'ZETA PTE. LTD.', true)];
  check('an inactive company is found by its exact name (EVOP: Active=no, blank in TeamWork)', findSoaDebtorCompany(EVOP, every) === evop);
  check('… however the name is typed (case, punctuation, "Pte Ltd" spelling)', findSoaDebtorCompany('evop (singapore) international pte ltd', every) === evop
    && findSoaDebtorCompany('EVOP SINGAPORE INTERNATIONAL', every) === evop);
  check('… and it is NOT found for a name that merely looks like it — even one a fuzzy match would accept (never a guess at the wrong client)',
    findSoaDebtorCompany('EVOP (SINGAPORE) INTERNATIONAL TRADING PTE. LTD.', every) === null && findSoaDebtorCompany('EVOP (SINGAPORE) TRADING PTE. LTD.', every) === null
    && findSoaDebtorCompany('EVOP', every) === null);
  check('a name nobody has, a blank one, and a punctuation-only one → null', findSoaDebtorCompany('NOBODY PTE. LTD.', every) === null
    && findSoaDebtorCompany('', every) === null && findSoaDebtorCompany('   ', every) === null && findSoaDebtorCompany('(.)', every) === null);
  check('the list can be empty', findSoaDebtorCompany(EVOP, []) === null);
  check('a lookup that normalizes to nothing never matches a company whose name normalizes to nothing', findSoaDebtorCompany('(.)', [company(2, 'PTE. LTD.', false)]) === null);

  const liveSecond = [company(3, 'TWIN PTE. LTD.', false), company(4, 'Twin Pte Ltd', true)];
  check('two rows with the same name: the LIVE one wins, whatever the order', findSoaDebtorCompany('TWIN PTE. LTD.', liveSecond) === liveSecond[1]
    && findSoaDebtorCompany('TWIN PTE. LTD.', [...liveSecond].reverse()) === liveSecond[1]);
  const bothDead = [company(5, 'GONE PTE. LTD.', false), company(6, 'Gone Pte Ltd', false)];
  check('two dead rows with the same name: the first (lowest id) one, deterministically', findSoaDebtorCompany('GONE PTE. LTD.', bothDead) === bothDead[0]);
  check('is_active=null (a row nobody ever set) still counts as "not live", and is still found', findSoaDebtorCompany('NULLY PTE. LTD.', [{ ...company(8, 'NULLY PTE. LTD.', false), is_active: null }])?.id === 8);
}

console.log('\n--- 2. WHO: the exact match over everyone comes BEFORE the fuzzy match over the live roster ---');
{
  const evop = company(7, EVOP, false);
  const sibling = company(8, 'EVOP (SINGAPORE) INTERNATIONAL TRADING PTE. LTD.', true);
  const every = [company(1, 'ALPHA PTE. LTD.', true), evop, sibling];
  const live = every.filter(isActiveCompany);
  const findActive = finderOver(live);
  check('precondition: the live-roster finder ALONE would hand EVOP\'s draft to the similarly named ACTIVE company (the hazard is real)', findActive(EVOP) === sibling);
  check('SOA lookup: the debtor itself is resolved, not its active look-alike', resolveDraftCompany(EVOP, findActive, every) === evop);
  check('AR / letter lookup (no `everyCompany` given): unchanged — the inactive company is NOT resolved', resolveDraftCompany(EVOP, findActive) === sibling);
  check('… and with no look-alike on the live roster an inactive company stays unresolved for AR / letters',
    resolveDraftCompany(EVOP, finderOver([company(1, 'ALPHA PTE. LTD.', true)])) === null);

  const dup = [company(3, 'TWIN PTE. LTD.', false), company(4, 'Twin Pte Ltd', true)];
  check('an active company with the same name still wins over a dead duplicate', resolveDraftCompany('TWIN PTE. LTD.', finderOver(dup.filter(isActiveCompany)), dup)?.id === 4);

  const soonTw = company(11, 'SOON & GUAN MANPOWER TRAINING', true);
  check('a live company the lookup only approximately matches is still found by the fuzzy match (unchanged behaviour)',
    resolveDraftCompany('Soon & Guan Manpower Trading', finderOver([soonTw]), [soonTw]) === soonTw);
  check('nothing anywhere → null (the route then says there is no email address on file)', resolveDraftCompany('NOBODY PTE. LTD.', findActive, every) === null);
}

console.log('\n--- 3. WHAT: the body lists what the attached statement shows ---');
{
  type Book = 'TAB' | 'TAC' | 'TAO';
  const ref = (qbCompany: Book, invoiceNo: string, amount: number, qbInvoiceId: string | null = invoiceNo): InvoiceRef => ({ qbCompany, invoiceNo, amount, qbInvoiceId });
  const mapOf = (entries: Array<[string, InvoiceRef[]]>) => new Map(entries.map(([name, refs]) => [normalize(name), refs] as [string, InvoiceRef[]]));
  const TAB_BOOK = ['TAB'] as const;
  const soonRefs = [ref('TAB', '02611000', 400), ref('TAB', '02611001', 60), ref('TAB', '02611002', 1000)];
  const soonCompany = 'SOON & GUAN MANPOWER TRAINING', soonQb = 'Soon & Guan Manpower Trading';
  const ids = (m: Map<string, InvoiceRef[]>, lookup: string, books: readonly Book[], belongs?: (k: string) => boolean) =>
    soaBodyInvoices(lookup, m, books, belongs).map(r => r.invoiceNo).join(',');

  const m1 = mapOf([[soonQb, soonRefs], ['ALPHA PTE. LTD.', [ref('TAB', '1', 5)]]]);
  check('the company list and QuickBooks spell the name differently: the body finds the same customer the statement does',
    ids(m1, soonCompany, TAB_BOOK) === soonRefs.map(r => r.invoiceNo).join(','));

  const own = [ref('TAB', 'OWN-1', 10)];
  const m2 = mapOf([[soonCompany, own], [soonQb, soonRefs]]);
  check('a name that already has invoices in the book is left EXACTLY as it was (a draft that worked does not change)', ids(m2, soonCompany, TAB_BOOK) === 'OWN-1');
  check('… down to the very same objects, in the same order', soaBodyInvoices(soonCompany, m2, TAB_BOOK).every((r, i) => r === own[i]) && soaBodyInvoices(soonCompany, m2, TAB_BOOK).length === own.length);
  const multi = [ref('TAC', 'C-1', 1), ref('TAB', 'B-1', 2), ref('TAO', 'O-1', 3)];
  check('… including a cross-book list kept in the order it had (the "All" body was never re-sorted)', ids(mapOf([[soonCompany, multi]]), soonCompany, SOA_BOOKS) === 'C-1,B-1,O-1');

  const m3 = mapOf([[soonQb, [ref('TAC', 'TAC-1', 50)]]]);
  check('only customers with something open in THIS book are candidates: a TAC-only look-alike adds nothing to a TAB draft', ids(m3, soonCompany, TAB_BOOK) === '');
  const m3b = mapOf([[soonQb, soonRefs], ['Soon & Guan Manpower Training Services', [ref('TAC', 'TAC-9', 9)]]]);
  check('… even when that TAC-only customer is the closer name (it has nothing open in TAB, so it is not who the TAB statement is about)',
    ids(m3b, soonCompany, TAB_BOOK) === soonRefs.map(r => r.invoiceNo).join(','));
  const m4 = mapOf([[soonQb, [ref('TAB', 'TAB-1', 5), ref('TAC', 'TAC-1', 50)]]]);
  check('… and from a look-alike that has both, only the invoices of the draft\'s own book come across', ids(m4, soonCompany, TAB_BOOK) === 'TAB-1');

  // The statement route's candidates are customers with an open INVOICE; a journal entry / payment / credit note alone is no candidate.
  const je = [ref('TAB', 'OPNG JE', 900, null)];
  const m4b = mapOf([['Soon & Guan Manpower Training Svc', je], [soonQb, soonRefs]]);
  const jeScore = findUniqueBestMatch(soonCompany, [...m4b.entries()], e => e[0], 70);
  check('precondition: with the journal-entry-only customer counted, it would be the closer name', matchScore(soonCompany, 'Soon & Guan Manpower Training Svc') > matchScore(soonCompany, soonQb) && jeScore.value?.[0] === normalize('Soon & Guan Manpower Training Svc'));
  check('a customer that has only a journal entry / payment / credit note in the book is not a candidate (the statement cannot be built from it)',
    ids(m4b, soonCompany, TAB_BOOK) === soonRefs.map(r => r.invoiceNo).join(','));

  const m5 = mapOf([['Soon & Guan Manpower Trading', [ref('TAB', 'A-1', 5)]], ['Soon & Guan Manpower Tracing', [ref('TAB', 'B-1', 6)]]]);
  const tie = findUniqueBestMatch(soonCompany, [...m5.entries()], e => e[0], 70);
  check('precondition: two customers tie for the name', tie.ambiguous && tie.value === null);
  check('a tie picks NOTHING (never the first row) — the draft then refuses instead of guessing a client\'s invoices', ids(m5, soonCompany, TAB_BOOK) === '');

  const m6 = mapOf([['Beta Holdings Pte Ltd', [ref('TAB', 'B-9', 9)]], ['Soon & Guan Consulting Services', [ref('TAB', 'B-10', 10)]]]);
  check('a customer whose name is not close (below the 70 the statement itself uses) is not taken', ids(m6, soonCompany, TAB_BOOK) === '');

  // The company list's spelling is not the name that was clicked: the statement is built from the CLICKED name, so is the body.
  const m6b = mapOf([['SMART INNOVA STARTECH', [ref('TAB', 'S-1', 7)]], ['Zhichuang Startech Pte. Ltd.', [ref('TAB', 'Z-1', 8)]]]);
  check('the body follows the name that was clicked (the statement does), never the company row\'s own invoices under another name', ids(m6b, 'Zhichuang Startech Pte. Ltd.', TAB_BOOK) === 'Z-1');

  // "All": each book is matched on its own, exactly as each book's own statement is.
  const allOwn = [ref('TAB', 'TAB-OWN', 100)];
  const m7 = mapOf([[soonCompany, allOwn], ['SOON & GUAN MANPOWER TRADING', [ref('TAO', 'TAO-1', 30), ref('TAB', 'TAB-X', 1)]]]);
  check('"All": books the name already covers keep exactly those; a book it does not cover gets the look-alike\'s invoices of that book', ids(m7, soonCompany, SOA_BOOKS) === 'TAB-OWN,TAO-1');
  check('"All": a company that owes nowhere under its own name and has no look-alike stays empty', soaBodyInvoices('NOBODY PTE. LTD.', m7, SOA_BOOKS).length === 0);

  const m8 = mapOf([[soonQb, soonRefs]]);
  const before = JSON.stringify([...m8.entries()]);
  soaBodyInvoices(soonCompany, m8, SOA_BOOKS);
  check('the map it is given is never modified (the caller decides what to do with the result)', JSON.stringify([...m8.entries()]) === before);
  check('SOA_BOOKS is the three books', SOA_BOOKS.join(',') === 'TAB,TAC,TAO');

  // ── the look-alike: a customer that is another company's, not ours ────────
  const yuAn = 'YU AN (SGP) HOLDING PTE. LTD.';
  const yuRows = [company(1, yuAn, true), company(2, 'YU AN BULK HOLDING PTE LTD', true), company(3, 'YU AN SHIPPING PTE. LTD.', true), company(4, 'ALPHA PTE. LTD.', true)];
  const bulk = normalize('Yu An Bulk Holding Pte Ltd');
  const yuVariant = normalize('Yu An (SGP) Holdings Pte. Ltd.');
  const mYu = mapOf([['Yu An (SGP) Holdings Pte. Ltd.', [ref('TAC', 'YU-C2', 6)]], ['Yu An Bulk Holding Pte Ltd', [ref('TAB', '02610643', 800)]]]);
  check('precondition: the statement\'s fuzzy step WOULD hand Yu An (SGP) Holding the invoice of Yu An Bulk Holding in TAB (real data, TAB #02610643 S$800)',
    ids(mYu, yuAn, ['TAB']) === '02610643' && matchScore(bulk, yuAn) >= 70);
  check('a customer that fits ANOTHER company better is that company\'s (Yu An Bulk Holding is not Yu An (SGP) Holding)', customerBelongsToAnotherCompany(bulk, yuAn, yuRows[0], yuRows));
  const belongs = (k: string) => customerBelongsToAnotherCompany(k, yuAn, yuRows[0], yuRows);
  check('so the body takes nothing from it, in "All" too — while the books where the real customer exists still fill',
    ids(mYu, yuAn, SOA_BOOKS, belongs) === 'YU-C2' && ids(mYu, yuAn, ['TAB'], belongs) === '');
  check('a spelling variant of OUR customer is not "another company\'s"', !customerBelongsToAnotherCompany(yuVariant, yuAn, yuRows[0], yuRows));
  check('… nor is Soon & Guan\'s customer (the company list has no better home for it)', !customerBelongsToAnotherCompany(normalize(soonQb), soonCompany, company(11, 'SOON & GUAN MANPOWER TRAINING PTE. LTD.', true), [company(11, 'SOON & GUAN MANPOWER TRAINING PTE. LTD.', true), ...yuRows]));
  const startech = company(21, 'SMART INNOVA STARTECH PTE. LTD. (F.K.A. ZHICHUANG STARTECH PTE. LTD.)', true);
  const zhichuang = normalize('Zhichuang Startech Pte. Ltd.');
  check('precondition: spelled the way the name was clicked, the look-alike company fits the customer better than the click does',
    matchScore(zhichuang, 'SMART INNOVA STARTECH PTE. LTD.') < matchScore(zhichuang, 'INNOSMART STARTECH PTE. LTD.'));
  check('… nor a customer reached through the company\'s old name (F.K.A.): the company\'s own alias scores 100 against it, though the name that was clicked is spelled differently',
    !customerBelongsToAnotherCompany(zhichuang, 'SMART INNOVA STARTECH PTE. LTD.', startech, [startech, company(22, 'INNOSMART STARTECH PTE. LTD.', true), ...yuRows]));
  // a tie: the customer fits our company and another one EQUALLY well (3 of 4 words each)
  const abg = company(31, 'ALPHA BETA GAMMA TRADING PTE. LTD.', true), abgTwin = company(32, 'ALPHA BETA GAMMA SERVICES PTE. LTD.', true), abgKey = normalize('Alpha Beta Gamma Holdings');
  check('precondition: the customer scores the same against both companies', matchScore(abgKey, abg.company_name) === matchScore(abgKey, abgTwin.company_name) && matchScore(abgKey, abg.company_name) >= 70);
  check('a tie with another company counts as theirs (a draft that refuses is safe; one that lists another client\'s invoice is not)',
    customerBelongsToAnotherCompany(abgKey, abg.company_name, abg, [abg, abgTwin]));
  check('… and with no other company at all it is ours', !customerBelongsToAnotherCompany(abgKey, abg.company_name, abg, [abg]));
  check('a duplicate row with the same name as ours (3 real pairs) is never "another company"', !customerBelongsToAnotherCompany(yuVariant, yuAn, yuRows[0], [...yuRows, company(9, 'Yu An (SGP) Holding Pte Ltd', false)]));
  check('a dead look-alike counts too (an inactive sibling is still another client)', customerBelongsToAnotherCompany(bulk, yuAn, yuRows[0], [yuRows[0], company(2, 'YU AN BULK HOLDING PTE LTD', false)]));
  check('the fuzzy keys the body would take are reported per book (so the route loads the company list only when needed)',
    soaBodyFuzzyKeys(yuAn, mYu, SOA_BOOKS).join(',') === `${bulk},${yuVariant}` && soaBodyFuzzyKeys(yuAn, m2, TAB_BOOK).length === 0 && soaBodyFuzzyKeys(soonCompany, m2, TAB_BOOK).length === 0);
}

console.log('\n--- 3b. WHAT, for a debt with no invoice behind it: the cover page alone, and the same items in the body ---');
{
  const item = (docNumber: string, txnType: string, amount: number) => ({ docNumber, dueDate: '2023-12-31', txnDate: '2023-12-31', txnType, amount, bucket: 'd91_plus' as const });
  const inventa: SoaRowLike = { companyName: 'INVENTA TECHNOLOGIES PTE. LTD.', totalOutstanding: 1505.5, lineItems: [item('OPNG JE', 'Journal Entry', 1505.5)] };
  const projects: SoaRowLike = { companyName: 'INVENTA PROJECTS PTE. LTD.', totalOutstanding: 1880, lineItems: [item('OPNG JE', 'Journal Entry', 2785.5), item('CN260014', 'Credit Note', -905.5)] };
  const rows = [inventa, projects];
  const refs = coverOnlyRefs(rows, 'INVENTA TECHNOLOGIES PTE. LTD.', 'TAB');
  check('INVENTA TECHNOLOGIES (an opening-balance journal entry, no invoice): the body lists the row\'s own item, S$1,505.50',
    refs.length === 1 && refs[0].invoiceNo === 'OPNG JE' && refs[0].amount === 1505.5 && refs[0].qbCompany === 'TAB' && refs[0].qbInvoiceId === null && refs[0].dueDate === '2023-12-31');
  check('… every item of the row, credit notes negative, so the body adds up to the statement\'s balance',
    coverOnlyRefs(rows, 'inventa projects pte ltd', 'TAB').reduce((t, r) => t + r.amount, 0) === 1880 && coverOnlyRefs(rows, 'INVENTA PROJECTS PTE. LTD.', 'TAO').every(r => r.qbCompany === 'TAO'));
  check('only the row of EXACTLY this name: a look-alike\'s row is never used (no fuzzy match)', coverOnlyRefs(rows, 'INVENTA TECHNOLOGIES (S) PTE. LTD.', 'TAB').length === 0 && coverOnlyRefs(rows, 'INVENTA', 'TAB').length === 0);
  check('nothing owed, or a credit: no statement of the cover alone and no items', coverOnlyRefs([{ ...inventa, totalOutstanding: 0 }], inventa.companyName, 'TAB').length === 0
    && coverOnlyRefs([{ ...inventa, totalOutstanding: -20 }], inventa.companyName, 'TAB').length === 0);
  const withInvoice: SoaRowLike = { companyName: 'LAGGING PTE. LTD.', totalOutstanding: 1100, lineItems: [item('OPNG JE', 'Journal Entry', 100), item('02611200', 'Invoice', 1000)] };
  check('a debt that CONTAINS an invoice is not a cover-only debt (its invoice document should be there; until the sync catches up it is "not found")',
    coverOnlyRefs([withInvoice], 'LAGGING PTE. LTD.', 'TAB').length === 0);
  check('a blank name and an empty list give nothing', coverOnlyRefs(rows, '', 'TAB').length === 0 && coverOnlyRefs([], inventa.companyName, 'TAB').length === 0);
  const before = JSON.stringify(rows);
  coverOnlyRefs(rows, inventa.companyName, 'TAB');
  check('the rows it is given are never modified', JSON.stringify(rows) === before);

  check('ONE rule for "its statement is the cover page alone": something owed and no invoice among the items', isCoverOnlyDebt(inventa) && isCoverOnlyDebt(projects)
    && !isCoverOnlyDebt(withInvoice) && !isCoverOnlyDebt({ ...inventa, totalOutstanding: 0 }) && !isCoverOnlyDebt({ ...inventa, totalOutstanding: -1 }));

  // Which books are worth reading the SOA row for: only where such a debt can exist (a customer with open items but no invoice, named like the lookup).
  type Book = 'TAB' | 'TAC' | 'TAO';
  const r = (qbCompany: Book, invoiceNo: string, qbInvoiceId: string | null): InvoiceRef => ({ qbCompany, invoiceNo, amount: 10, qbInvoiceId });
  const m = new Map<string, InvoiceRef[]>([
    [normalize('Inventa Technologies (S) Pte Ltd'), [r('TAB', 'OPNG JE', null), r('TAO', "Trial Balance -Dec'23", null)]],
    [normalize('Acme Trading Pte Ltd'), [r('TAB', '0261', '1')]],
    [normalize('Inventa Projects Pte Ltd'), [r('TAB', 'OPNG JE', null)]],
  ]);
  check('a book is worth reading when a customer there has open items but no invoice and is named like the lookup (INVENTA TECHNOLOGIES: TAB and TAO)',
    coverOnlyBooks('INVENTA TECHNOLOGIES PTE. LTD.', m, SOA_BOOKS).join(',') === 'TAB,TAO');
  check('an ordinary company (invoices only, or nothing at all in the book) pays nothing for the check', coverOnlyBooks('ACME TRADING PTE. LTD.', m, SOA_BOOKS).length === 0
    && coverOnlyBooks('NOBODY PTE. LTD.', m, SOA_BOOKS).length === 0 && coverOnlyBooks('', m, SOA_BOOKS).length === 0);
  check('a customer that is not named like the lookup does not make a book worth reading (INVENTA PROJECTS is not INVENTA TECHNOLOGIES)',
    coverOnlyBooks('INVENTA TECHNOLOGIES PTE. LTD.', new Map([[normalize('Inventa Projects Pte Ltd'), [r('TAB', 'OPNG JE', null)]]]), SOA_BOOKS).length === 0);
  check('only the books asked about are looked at', coverOnlyBooks('INVENTA TECHNOLOGIES PTE. LTD.', m, ['TAO']).join(',') === 'TAO');
}

console.log('\n--- 4. wiring: who may see inactive companies, and the guard that refuses an empty body ---');
{
  const route = read('app/api/client-communications/campaigns/preview/route.ts');
  const resolve = read('lib/client-comms-resolve.ts');
  const draftClient = read('lib/campaign-draft-client.ts');
  const pure = read('lib/soa-draft-resolution.ts');

  const sourceDirs = ['app', 'lib', 'components'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(rel); }
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
    }
  };
  sourceDirs.forEach(walk);
  const users = files.filter(f => /includeInactive\s*:\s*true/.test(read(f)));
  check('exactly ONE file opts in to every company: the preview route\'s single-company lookup (AR, letters, Campaign Centre\'s bulk list never do)',
    users.length === 1 && users[0] === 'app/api/client-communications/campaigns/preview/route.ts', users.join(', '));
  const opts = route.match(/includeInactive\s*:\s*true/g) ?? [];
  check('… in two places, both for an SOA: the company lookup and the look-alike check of the body',
    opts.length === 2 && /type === 'soa' \? await loadCompanies\(supabase, \{ includeInactive: true \}\) : undefined/.test(route)
    && /if \(type === 'soa' && draftBooks\) \{[\s\S]*?everyone = await loadCompanies\(supabase, \{ includeInactive: true \}\);/.test(route));
  check('the bulk POST (Campaign Centre\'s auto list) still loads the live roster only', /loadCompanies\(supabase\),\s*\n\s*loadInvoicesByCompany\(supabase, type, fyeMonth, fyeYear\)/.test(route));
  check('the route resolves through resolveDraftCompany (exact-over-everyone first), not a private rule', /resolveDraftCompany\(name, findActive, everyCompany\)/.test(route));
  check('the live roster is told apart with isActiveCompany() — no second definition of "active" here', /everyCompany\.filter\(isActiveCompany\)/.test(route) && /isActiveCompany/.test(pure)
    && !/\.is_active\b|\.tw_status\b/.test(stripComments(pure) + stripComments(route)));
  check('loadCompanies without the option is exactly what it was: onlyActiveCompanies on the same columns', /const \{ data \} = await onlyActiveCompanies\(supabase\s*\n\s*\.from\('companies'\)\s*\n\s*\.select\('id, company_name, best_email, primary_contact, tw_to_emails, tw_cc_emails, tw_recipient_source, tw_recipient_synced_at, pic'\)\);/.test(resolve));
  check('with the option it is paged (the 1,000-row cap must not cut the table) and carries is_active', /pageAll<CompanyRow>/.test(resolve) && /tw_recipient_synced_at, pic, is_active'/.test(resolve));
  check('a company that is not in the list at all gets an honest message (no email address on file), not "no match"', /is not in the company list, so there is no email address on file for it/.test(route));

  check('the body fallback only runs for an SOA Draft (single book: qbCompany; "All": allBooks) — Campaign Centre\'s hand-add is untouched',
    /const draftBooks = qbCompany \? \[qbCompany\] : allBooks \? SOA_BOOKS : null;/.test(route) && /if \(type === 'soa' && draftBooks\)/.test(route));
  check('a look-alike customer is refused through customerBelongsToAnotherCompany, and the company list is only loaded when the fuzzy step would take a customer',
    /soaBodyInvoices\(lookup, invoicesByCompany, draftBooks, belongsToOther\)/.test(route) && /if \(!everyone && soaBodyFuzzyKeys\(lookup, invoicesByCompany, draftBooks\)\.length\)/.test(route)
    && /customerBelongsToAnotherCompany\(customerKey, lookup, resolved, known\)/.test(route));
  check('a book where the name still has nothing gets the SOA row\'s own items (cover-only debts), one SOA-row read per such book, failing safe',
    /const bare = coverOnlyBooks\(lookup, invoicesByCompany, draftBooks\.filter\(book => !refs\.some\(r => r\.qbCompany === book\)\)\);/.test(route)
    && /computeSoaRows\(book, \{ customerNamePrefilter: lookup \}\)\s*\n?\s*\.then\(rows => coverOnlyRefs\(rows, lookup, book\)\)\.catch\(\(\) => \[\]\)/.test(route)
    && /refs\.push\(\.\.\.found\.flat\(\)\);/.test(route));
  check('it builds the row from the patched copy of the map and never mutates the loaded one', /new Map\(invoicesByCompany\)\.set\(key, refs\)/.test(route) && /buildRow\(company\.company_name, findCompany, invoicesForBody,/.test(route));
  check('a draft that already worked is not touched: the map is only copied when the body would differ', /if \(refs\.length !== own\.length \|\| refs\.some\(\(r, i\) => r !== own\[i\]\)\)/.test(route));
  check('"All" is forwarded from the Draft flow only (soaReminderScope === \'ALL\')', /opts\.soaReminderScope === 'ALL'/.test(draftClient) && /qs\.set\('allBooks', '1'\)/.test(draftClient));
  check('an SOA draft whose body would list no invoice is refused before anything is created', /type === 'soa' && !json\.row\.invoiceRefs\?\.length/.test(draftClient)
    && draftClient.indexOf("!json.row.invoiceRefs?.length") < draftClient.indexOf("fetch('/api/client-communications/campaigns', {"));
  check('… with a message that is true on every path (it does not claim a statement was attached)', !/statement itself is fine/.test(draftClient) && /No open invoice could be matched to/.test(draftClient));
  check('the pure module reaches neither the database nor a server-only module (so this test can run it)', !/supabase|server-only|process\.env|fetch\(/.test(stripComments(pure)));
}

console.log('\n--- 5. wiring: the statement route (/api/billing/soa/pdf) ---');
{
  const pdf = read('app/api/billing/soa/pdf/route.ts');
  check('a fuzzy customer is refused when it fits ANOTHER company at least as well — for invoices and for credit notes',
    /import \{ customerBelongsToAnotherCompany, isCoverOnlyDebt \} from '@\/lib\/soa-draft-resolution';/.test(pdf)
    && /matched = match\.value && !\(await fitsAnotherCompany\(match\.value\[0\]\)\) \? match\.value\[1\] : undefined;/.test(pdf)
    && /matchedCredits = match\.value && !\(await fitsAnotherCompany\(match\.value\[0\]\)\) \? match\.value\[1\] : undefined;/.test(pdf));
  check('… against the whole company list (any status, names only) read lazily — only a fuzzy match pays for it',
    /pageAll<\{ company_name: string \}>\(\(\) => supabase\.from\('companies'\)\.select\('company_name'\)\)/.test(pdf) && /if \(!companyNames\) companyNames =/.test(pdf)
    && !/is_active|tw_status/.test(stripComments(pdf)));
  check('an exact customer name is never second-guessed (the guard sits only on the fuzzy branches)', /let matched = byName\.get\(target\);\s*\n\s*if \(!matched\) \{/.test(pdf) && /let matchedCredits = creditByName\.get\(target\);\s*\n\s*if \(!matchedCredits\) \{/.test(pdf));
  check('no invoice and no credit note → the cover page alone, decided only after its row is found (no early 404)',
    /const coverOnly = \(!matched \|\| !matched\.length\) && \(!matchedCredits \|\| !matchedCredits\.length\);/.test(pdf)
    && !/if \(\(!matched \|\| !matched\.length\) && \(!matchedCredits \|\| !matchedCredits\.length\)\) \{\s*\n\s*return NextResponse\.json/.test(pdf));
  check('… for the row of EXACTLY this name only, never a fuzzy neighbour\'s', /if \(coverOnly\) return undefined;/.test(pdf) && pdf.indexOf('if (coverOnly) return undefined;') > pdf.indexOf('const exact = soaRows.find(')
    && pdf.indexOf('if (coverOnly) return undefined;') < pdf.indexOf('return findUniqueBestMatch(resolvedRawName, soaRows'));
  check('… and only while something is owed and no invoice is among the items (a lagging sync stays "not found") — the one rule, isCoverOnlyDebt',
    /if \(coverOnly && statementRow && !isCoverOnlyDebt\(statementRow\)\) statementRow = null;/.test(pdf) && /import \{ customerBelongsToAnotherCompany, isCoverOnlyDebt \} from '@\/lib\/soa-draft-resolution';/.test(pdf));
  check('… with no QuickBooks address block: a cover-only statement is asked for by the company-list spelling, and the customer search is fuzzy (a look-alike\'s address)',
    /coverOnly \? Promise\.resolve\(\{ companyName: null, billAddrLines: \[\] as string\[\] \}\) : resolveCustomerPrintDetails\(addrBook, resolvedRawName\)/.test(pdf));
  check('the guard is asked about the name that was clicked, in the argument order the function documents (customer, lookup, own company, every company)',
    /customerBelongsToAnotherCompany\(customerKey, companyName, \{ company_name: companyName \}, await companyNames\)/.test(pdf));
  check('… with no row (or nothing owed) it is still "No outstanding invoices found" (404), a cover that fails to draw says so (500)',
    /if \(coverOnly && !coverPageAdded\) \{/.test(pdf) && /status: 500 \}\)\s*\n\s*: NextResponse\.json\(\{ error: `No outstanding invoices found for "\$\{companyName\}"\.` \}, \{ status: 404 \}\)/.test(pdf));
  check('… and the answer says it is a cover-only statement (X-Soa-Cover-Only)', /\.\.\.\(coverOnly \? \{ 'X-Soa-Cover-Only': '1' \} : \{\}\),/.test(pdf));
  check('the mailing address of a cover-only "All" statement is read from the first book that has a row (not from "ALL")', /addrBookOverride = QB_COMPANIES\.find\(\(_, i\) => !!perBook\[i\]\);/.test(pdf) && /matchedCredits\[0\]\?\.qb_company \?\? addrBookOverride \?\? company/.test(pdf));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
