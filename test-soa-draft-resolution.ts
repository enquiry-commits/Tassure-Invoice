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
import { findSoaDebtorCompany, resolveDraftCompany, soaBodyInvoices, SOA_BOOKS } from './lib/soa-draft-resolution';
import { normalize, findUniqueBestMatch } from './lib/company-name';
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
  const ref = (qbCompany: 'TAB' | 'TAC' | 'TAO', invoiceNo: string, amount: number): InvoiceRef => ({ qbCompany, invoiceNo, amount, qbInvoiceId: invoiceNo });
  const mapOf = (entries: Array<[string, InvoiceRef[]]>) => new Map(entries.map(([name, refs]) => [normalize(name), refs] as [string, InvoiceRef[]]));
  const TAB_BOOK = ['TAB'] as const;
  const soonRefs = [ref('TAB', '02611000', 400), ref('TAB', '02611001', 60), ref('TAB', '02611002', 1000)];
  const soonCompany = 'SOON & GUAN MANPOWER TRAINING', soonQb = 'Soon & Guan Manpower Trading';
  const ownKey = normalize(soonCompany);

  const soonBodyKey = (m: Map<string, InvoiceRef[]>, lookup: string, key: string, books: readonly ('TAB' | 'TAC' | 'TAO')[]) =>
    soaBodyInvoices(lookup, key, m, books).map(r => r.invoiceNo).join(',');

  const m1 = mapOf([[soonQb, soonRefs], ['ALPHA PTE. LTD.', [ref('TAB', '1', 5)]]]);
  check('the company list and QuickBooks spell the name differently: the body finds the same customer the statement does',
    soonBodyKey(m1, soonCompany, ownKey, TAB_BOOK) === soonRefs.map(r => r.invoiceNo).join(','));

  const own = [ref('TAB', 'OWN-1', 10)];
  const m2 = mapOf([[soonCompany, own], [soonQb, soonRefs]]);
  check('a company whose own name already has invoices in the book is left EXACTLY as it was (a draft that worked does not change)',
    soonBodyKey(m2, soonCompany, ownKey, TAB_BOOK) === 'OWN-1');

  const m3 = mapOf([[soonQb, [ref('TAC', 'TAC-1', 50)]]]);
  check('only customers with something open in THIS book are candidates: a TAC-only look-alike adds nothing to a TAB draft', soonBodyKey(m3, soonCompany, ownKey, TAB_BOOK) === '');
  const m3b = mapOf([[soonQb, soonRefs], ['Soon & Guan Manpower Training Services', [ref('TAC', 'TAC-9', 9)]]]);
  check('… even when that TAC-only customer is the closer name (it has nothing open in TAB, so it is not who the TAB statement is about)',
    soonBodyKey(m3b, soonCompany, ownKey, TAB_BOOK) === soonRefs.map(r => r.invoiceNo).join(','));
  const m4 = mapOf([[soonQb, [ref('TAB', 'TAB-1', 5), ref('TAC', 'TAC-1', 50)]]]);
  check('… and from a look-alike that has both, only the invoices of the draft\'s own book come across', soonBodyKey(m4, soonCompany, ownKey, TAB_BOOK) === 'TAB-1');

  const m5 = mapOf([['Soon & Guan Manpower Trading', [ref('TAB', 'A-1', 5)]], ['Soon & Guan Manpower Tracing', [ref('TAB', 'B-1', 6)]]]);
  const tie = findUniqueBestMatch(soonCompany, [...m5.entries()], e => e[0], 70);
  check('precondition: two customers tie for the name', tie.ambiguous && tie.value === null);
  check('a tie picks NOTHING (never the first row) — the draft then refuses instead of guessing a client\'s invoices', soonBodyKey(m5, soonCompany, ownKey, TAB_BOOK) === '');

  const m6 = mapOf([['Beta Holdings Pte Ltd', [ref('TAB', 'B-9', 9)]], ['Soon & Guan Consulting Services', [ref('TAB', 'B-10', 10)]]]);
  check('a customer whose name is not close (below the 70 the statement itself uses) is not taken', soonBodyKey(m6, soonCompany, ownKey, TAB_BOOK) === '');

  // "All": each book is matched on its own, exactly as each book's own statement is.
  const allOwn = [ref('TAB', 'TAB-OWN', 100)];
  const m7 = mapOf([[soonCompany, allOwn], ['SOON & GUAN MANPOWER TRADING', [ref('TAO', 'TAO-1', 30), ref('TAB', 'TAB-X', 1)]]]);
  check('"All": books the company\'s own name already covers keep exactly those; a book it does not cover gets the look-alike\'s invoices of that book',
    soonBodyKey(m7, soonCompany, ownKey, SOA_BOOKS) === 'TAB-OWN,TAO-1');
  check('"All": a company that owes nowhere under its own name and has no look-alike stays empty', soaBodyInvoices('NOBODY PTE. LTD.', normalize('NOBODY PTE. LTD.'), m7, SOA_BOOKS).length === 0);

  const m8 = mapOf([[soonQb, soonRefs]]);
  const before = JSON.stringify([...m8.entries()]);
  soaBodyInvoices(soonCompany, ownKey, m8, SOA_BOOKS);
  check('the map it is given is never modified (the caller decides what to do with the result)', JSON.stringify([...m8.entries()]) === before);
  check('SOA_BOOKS is the three books', SOA_BOOKS.join(',') === 'TAB,TAC,TAO');
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
  check('exactly ONE caller opts in to every company: the preview route\'s single-company lookup (AR, letters, Campaign Centre\'s bulk list never do)',
    users.length === 1 && users[0] === 'app/api/client-communications/campaigns/preview/route.ts', users.join(', '));
  check('… and it asks for them ONLY for an SOA (`type === \'soa\'`)', /type === 'soa' \? await loadCompanies\(supabase, \{ includeInactive: true \}\) : undefined/.test(route));
  check('the bulk POST (Campaign Centre\'s auto list) still loads the live roster only', /loadCompanies\(supabase\),\s*\n\s*loadInvoicesByCompany\(supabase, type, fyeMonth, fyeYear\)/.test(route));
  check('the route resolves through resolveDraftCompany (exact-over-everyone first), not a private rule', /resolveDraftCompany\(name, findActive, everyCompany\)/.test(route));
  check('the live roster is told apart with isActiveCompany() — no second definition of "active" here', /everyCompany\.filter\(isActiveCompany\)/.test(route) && /isActiveCompany/.test(pure)
    && !/\.is_active\b|\.tw_status\b/.test(stripComments(pure) + stripComments(route)));
  check('loadCompanies without the option is exactly what it was: onlyActiveCompanies on the same columns', /const \{ data \} = await onlyActiveCompanies\(supabase\s*\n\s*\.from\('companies'\)\s*\n\s*\.select\('id, company_name, best_email, primary_contact, tw_to_emails, tw_cc_emails, tw_recipient_source, tw_recipient_synced_at, pic'\)\);/.test(resolve));
  check('with the option it is paged (the 1,000-row cap must not cut the table) and carries is_active', /pageAll<CompanyRow>/.test(resolve) && /tw_recipient_synced_at, pic, is_active'/.test(resolve));
  check('a company that is not in the list at all gets an honest message (no email address on file), not "no match"', /is not in the company list, so there is no email address on file for it/.test(route));

  check('the body fallback only runs for an SOA Draft (single book: qbCompany; "All": allBooks) — Campaign Centre\'s hand-add is untouched',
    /const draftBooks = qbCompany \? \[qbCompany\] : allBooks \? SOA_BOOKS : null;/.test(route) && /if \(type === 'soa' && draftBooks\)/.test(route));
  check('it builds the row from the patched copy of the map and never mutates the loaded one', /new Map\(invoicesByCompany\)\.set\(key, refs\)/.test(route) && /buildRow\(company\.company_name, findCompany, invoicesForBody,/.test(route));
  check('"All" is forwarded from the Draft flow only (soaReminderScope === \'ALL\')', /opts\.soaReminderScope === 'ALL'/.test(draftClient) && /qs\.set\('allBooks', '1'\)/.test(draftClient));
  check('an SOA draft whose body would list no invoice is refused before anything is created', /type === 'soa' && !json\.row\.invoiceRefs\?\.length/.test(draftClient)
    && draftClient.indexOf("!json.row.invoiceRefs?.length") < draftClient.indexOf("fetch('/api/client-communications/campaigns', {"));
  check('the pure module reaches neither the database nor a server-only module (so this test can run it)', !/supabase|server-only|process\.env|fetch\(/.test(stripComments(pure)));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
