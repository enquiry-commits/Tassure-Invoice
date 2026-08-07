import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import {
  extractParagraphs, extractBodyChildren, blockText, findSection,
  replaceAllPlaceholders, repeatSection, pairRepeatSection, keepSectionIf, chooseSection,
} from './lib/docx-xml';

const dir = path.join(__dirname, 'templates', 'post-incorporate');
function loadDocXml(filename: string): { zip: PizZip; xml: string } {
  const buf = fs.readFileSync(path.join(dir, filename));
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml')!.asText();
  return { zip, xml };
}
function fullBodyText(xml: string): string {
  return extractBodyChildren(xml).map(c => blockText(c.xml)).join('\n');
}
let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? 'OK  ' : 'FAIL') + '  ' + label);
  if (!cond) failures++;
}

console.log('=== TEST 1: self-closing <w:p/> truncation regression ===');
{
  const { xml } = loadDocXml('01 First Board Resolution - template.docx');
  const rawOpenLike = (xml.match(/<w:p(?:\s[^>]*)?\/?>/g) || []).length;
  const paras = extractParagraphs(xml);
  const selfClosingCount = (xml.match(/<w:p(?:\s[^>]*)?\/>/g) || []).length;
  check('template actually contains self-closing <w:p/> (sanity)', selfClosingCount > 0);
  check('extractParagraphs does not silently truncate (reaches near end of doc)', paras.length > 0 && paras[paras.length - 1].end > xml.length * 0.9);
  console.log(`   (raw <w:p...> tag-like count=${rawOpenLike}, self-closing=${selfClosingCount}, extracted paragraphs=${paras.length})`);
}

console.log('\n=== TEST 2: simple placeholder replacement (02 Consent to Act as Director) ===');
{
  const { xml } = loadDocXml('02 Consent to Act as Director - template.docx');
  const filled = replaceAllPlaceholders(xml, {
    director_name: 'TAN AH KOW',
    director_address: '1 RAFFLES PLACE, SINGAPORE 048616',
    company_reg_date: '01 August 2026',
    company_name: 'TEST COMPANY PTE. LTD.',
    company_UEN: '202699999X',
    company_address: '10 ANSON ROAD #12-08, SINGAPORE 079903',
    director_identification_type: 'NRIC',
    director_identification_number: 'S1234567A',
  });
  const after = fullBodyText(filled);
  check('director name appears', after.includes('TAN AH KOW'));
  check('company name appears', after.includes('TEST COMPANY PTE. LTD.'));
  check('no unresolved {{...}} left', !/\{\{[^}]+\}\}/.test(after));
}

console.log('\n=== TEST 3: directorlist repeat (01 First Board Resolution) ===');
{
  const { xml } = loadDocXml('01 First Board Resolution - template.docx');
  const result = repeatSection(xml, 'directorlist', [
    { director_name: 'ALPHA DIRECTOR' }, { director_name: 'BETA DIRECTOR' }, { director_name: 'GAMMA DIRECTOR' },
  ], {});
  const body = fullBodyText(result);
  check('ALPHA DIRECTOR appears exactly once', (body.match(/ALPHA DIRECTOR/g) || []).length === 1);
  check('BETA DIRECTOR appears exactly once', (body.match(/BETA DIRECTOR/g) || []).length === 1);
  check('GAMMA DIRECTOR appears exactly once', (body.match(/GAMMA DIRECTOR/g) || []).length === 1);
  check('no leftover markers', !/\[\[?(?:END)?SECTION:directorlist/i.test(body));
}

console.log('\n=== TEST 4: shareholderlist repeat with header-row dedup (01 First Board Resolution) ===');
{
  const { xml } = loadDocXml('01 First Board Resolution - template.docx');
  const result = repeatSection(xml, 'shareholderlist', [
    { shareholder_name: 'TAN AH KOW', Currency: 'SGD', shareholder_paidupamount: '5,000', shareholder_numofshares: '5,000' },
    { shareholder_name: 'LIM BEE HOON', Currency: 'SGD', shareholder_paidupamount: '5,000', shareholder_numofshares: '5,000' },
    { shareholder_name: 'THIRD HOLDER', Currency: 'SGD', shareholder_paidupamount: '1,000', shareholder_numofshares: '1,000' },
  ], {}, { dropHeaderRowAfterFirst: (t) => t.includes('name of subscriber') && t.includes('no. of ordinary shares') });
  const body = fullBodyText(result);
  check('TAN AH KOW appears exactly once', (body.match(/TAN AH KOW/g) || []).length === 1);
  check('LIM BEE HOON appears exactly once', (body.match(/LIM BEE HOON/g) || []).length === 1);
  check('THIRD HOLDER appears exactly once', (body.match(/THIRD HOLDER/g) || []).length === 1);
  check('header "Name of Subscriber" appears exactly once (not 3x)', (body.match(/Name of Subscriber/gi) || []).length === 1);
  check('no leftover markers', !/\[\[?(?:END)?SECTION:shareholderlist/i.test(body));
}

console.log('\n=== TEST 5: appointND conditional keep/drop (01 First Board Resolution) ===');
{
  const { xml } = loadDocXml('01 First Board Resolution - template.docx');
  const kept = replaceAllPlaceholders(keepSectionIf(xml, 'appointND', true), { ND_name: 'NOMINEE ONE' });
  const keptBody = fullBodyText(kept);
  check('kept=true: ND_name filled in via final placeholder pass', keptBody.includes('NOMINEE ONE'));
  check('kept=true: no leftover marker text', !/\[\[?(?:END)?SECTION:appointND/i.test(keptBody));

  const dropped = keepSectionIf(xml, 'appointND', false);
  const droppedBody = fullBodyText(dropped);
  check('kept=false: no leftover marker text', !/\[\[?(?:END)?SECTION:appointND/i.test(droppedBody));
  check('kept=false: "APPOINTMENT OF NOMINEE DIRECTOR" text removed', !droppedBody.includes('APPOINTMENT OF NOMINEE DIRECTOR'));
}

console.log('\n=== TEST 6: signaturedirector pair-repeat, whole-table content (01 First Board Resolution) ===');
{
  const { xml } = loadDocXml('01 First Board Resolution - template.docx');
  const section = findSection(xml, 'signaturedirector');
  check('section found', !!section);
  check('section content is exactly one w:tbl block', !!section && section.contentBlocks.length === 1 && section.contentBlocks[0].xml.startsWith('<w:tbl'));

  const names4 = ['DIRECTOR ONE', 'DIRECTOR TWO', 'DIRECTOR THREE', 'DIRECTOR FOUR'];
  const result = pairRepeatSection(xml, 'signaturedirector', names4, 'director_name_1', 'director_name_2', {});
  const body = fullBodyText(result);
  for (const n of names4) check(`${n} appears exactly once`, (body.match(new RegExp(n, 'g')) || []).length === 1);
  check('no leftover markers', !/\[\[?(?:END)?SECTION:signaturedirector/i.test(body));

  const names3 = ['SOLO ONE', 'SOLO TWO', 'SOLO THREE'];
  const result3 = pairRepeatSection(xml, 'signaturedirector', names3, 'director_name_1', 'director_name_2', {});
  const body3 = fullBodyText(result3);
  check('odd count: SOLO THREE (trailing unpaired) still appears', body3.includes('SOLO THREE'));
  check('odd count: no unresolved {{director_name_2}} leftover for the odd one', !/\{\{director_name_2\}\}/.test(body3));
}

console.log('\n=== TEST 7: havenomineedir / nothavenomineedir chooseSection (08 ROND) ===');
{
  const { xml } = loadDocXml('08 Declaration of Maintenance of ROND - template.docx');
  const withNominee = chooseSection(xml, 'havenomineedir', 'nothavenomineedir');
  const bodyWith = fullBodyText(withNominee);
  check('[has nominee] "the Company has a Nominee Director" present', bodyWith.includes('the Company has a Nominee Director'));
  check('[has nominee] "the Company has no Nominee Director" absent', !bodyWith.includes('the Company has no Nominee Director'));
  check('[has nominee] no leftover markers', !/\[\[?(?:END)?SECTION:(have|nothave)nomineedir/i.test(bodyWith));

  const without = chooseSection(xml, 'nothavenomineedir', 'havenomineedir');
  const bodyWithout = fullBodyText(without);
  check('[no nominee] "the Company has no Nominee Director" present', bodyWithout.includes('the Company has no Nominee Director'));
  check('[no nominee] "the Company has a Nominee Director" absent', !bodyWithout.includes('the Company has a Nominee Director'));
  check('[no nominee] no leftover markers', !/\[\[?(?:END)?SECTION:(have|nothave)nomineedir/i.test(bodyWithout));
}

console.log('\n=== TEST 8: nested nomineedirector > indnomdirector/corpnomdirector (08 ROND) — full realistic chain ===');
{
  const { xml } = loadDocXml('08 Declaration of Maintenance of ROND - template.docx');

  // Realistic full generation order for "has a nominee director, individual":
  // 1) resolve have/nothavenomineedir (top-of-doc declaration clause)
  // 2) resolve the INNER indnomdirector/corpnomdirector choice BEFORE the
  //    outer nomineedirector keep/drop — reversing this would let the
  //    outer keepSectionIf's marker-stripping destroy the inner markers
  //    first (both share the same generic [SECTION:...] pattern)
  // 3) keep the outer nomineedirector wrapper
  // 4) one final whole-document placeholder pass
  let indResult = chooseSection(xml, 'havenomineedir', 'nothavenomineedir');
  indResult = chooseSection(indResult, 'indnomdirector', 'corpnomdirector');
  indResult = keepSectionIf(indResult, 'nomineedirector', true);
  indResult = replaceAllPlaceholders(indResult, { nominator_ind_name: 'INDIVIDUAL NOMINEE', company_name: 'ACME PTE. LTD.' });
  const indBody = fullBodyText(indResult);
  check('[individual nominee] no leftover markers at all', !/\[\[?(?:END)?SECTION:/i.test(indBody));
  check('[individual nominee] nominator_ind_name filled in', indBody.includes('INDIVIDUAL NOMINEE'));

  // Corporate nominee director case, same ordering.
  let corpResult = chooseSection(xml, 'havenomineedir', 'nothavenomineedir');
  corpResult = chooseSection(corpResult, 'corpnomdirector', 'indnomdirector');
  corpResult = keepSectionIf(corpResult, 'nomineedirector', true);
  corpResult = replaceAllPlaceholders(corpResult, { nominator_corp_name: 'CORP NOMINEE PTE LTD', company_name: 'ACME PTE. LTD.' });
  const corpBody = fullBodyText(corpResult);
  check('[corporate nominee] no leftover markers at all', !/\[\[?(?:END)?SECTION:/i.test(corpBody));
  check('[corporate nominee] nominator_corp_name filled in', corpBody.includes('CORP NOMINEE PTE LTD'));

  // No nominee director at all: drop the whole outer section — inner
  // markers vanish along with it, no need to resolve them first.
  let noneResult = chooseSection(xml, 'nothavenomineedir', 'havenomineedir');
  noneResult = keepSectionIf(noneResult, 'nomineedirector', false);
  const noneBody = fullBodyText(noneResult);
  check('[no nominee] no leftover markers at all', !/\[\[?(?:END)?SECTION:/i.test(noneBody));
}

console.log('\n=== TEST 9: ND_AGREEMENT shareholderlist / shareholdersignature / shareholder (paragraph-based, not table) ===');
{
  const { xml } = loadDocXml('12 ND_AGREEMENT - template.docx');
  const r1 = repeatSection(xml, 'shareholderlist', [
    { shareholder_name: 'ALPHA SHAREHOLDER', shareholder_identification_number: 'S1111111A', shareholder_address: '1 ALPHA ROAD' },
    { shareholder_name: 'BETA SHAREHOLDER', shareholder_identification_number: 'S2222222B', shareholder_address: '2 BETA ROAD' },
  ], {});
  const body1 = fullBodyText(r1);
  check('ALPHA SHAREHOLDER appears once', (body1.match(/ALPHA SHAREHOLDER/g) || []).length === 1);
  check('BETA SHAREHOLDER appears once', (body1.match(/BETA SHAREHOLDER/g) || []).length === 1);
  check('no leftover shareholderlist markers', !/\[\[?(?:END)?SECTION:shareholderlist/i.test(body1));

  const r2 = replaceAllPlaceholders(keepSectionIf(xml, 'shareholder', true), { shareholder_name: 'SOLE SHAREHOLDER', shareholder_identification_number: 'S3333333C', shareholder_address: '3 GAMMA ROAD' });
  const body2 = fullBodyText(r2);
  check('single shareholder clause filled', body2.includes('SOLE SHAREHOLDER'));
  check('no leftover shareholder markers', !/\[\[?(?:END)?SECTION:shareholder\]/i.test(body2));
}

console.log('\n=== TEST 10: full real round-trip — write actual .docx, re-open with fresh PizZip, verify ===');
{
  const { zip, xml } = loadDocXml('01 First Board Resolution - template.docx');
  let result = xml;
  result = repeatSection(result, 'directorlist', [
    { director_name: 'TAN AH KOW' }, { director_name: 'LIM BEE HOON' },
  ], {});
  result = repeatSection(result, 'shareholderlist', [
    { shareholder_name: 'TAN AH KOW', Currency: 'SGD', shareholder_paidupamount: '5,000', shareholder_numofshares: '5,000' },
    { shareholder_name: 'LIM BEE HOON', Currency: 'SGD', shareholder_paidupamount: '5,000', shareholder_numofshares: '5,000' },
  ], {}, { dropHeaderRowAfterFirst: (t) => t.includes('name of subscriber') && t.includes('no. of ordinary shares') });
  result = keepSectionIf(result, 'appointND', false);
  result = pairRepeatSection(result, 'signaturedirector', ['TAN AH KOW', 'LIM BEE HOON'], 'director_name_1', 'director_name_2', {});
  result = replaceAllPlaceholders(result, {
    company_name: 'REAL TEST COMPANY PTE. LTD.',
    company_UEN: '202699999X',
    company_reg_date: '01 August 2026',
    director_desc: 'Directors',
    is_are: 'are',
    first_finperiod_enddate: '31 December 2026',
    finperiod_enddate: 'December',
    Currency: 'SGD',
    secretary_name: 'ZHANG DAN',
    company_address: '10 ANSON ROAD #12-08, SINGAPORE 079903',
  });

  zip.file('word/document.xml', result);
  const outBuf = zip.generate({ type: 'nodebuffer' });
  const outPath = path.join(__dirname, 'test-output-01-first-board-resolution.docx');
  fs.writeFileSync(outPath, outBuf);

  const reopened = new PizZip(fs.readFileSync(outPath));
  const reopenedXml = reopened.file('word/document.xml')!.asText();
  const reopenedText = fullBodyText(reopenedXml);
  check('re-opened docx contains TAN AH KOW', reopenedText.includes('TAN AH KOW'));
  check('re-opened docx contains LIM BEE HOON', reopenedText.includes('LIM BEE HOON'));
  check('re-opened docx contains REAL TEST COMPANY', reopenedText.includes('REAL TEST COMPANY'));
  check('no unresolved {{...}}', !/\{\{[^}]+\}\}/.test(reopenedText));
  check('no leftover [SECTION:...] markers', !/\[\[?(?:END)?SECTION:/i.test(reopenedText));
  fs.unlinkSync(outPath);
}

console.log('\n=== TEST 11: full real round-trip — 08 ROND with nested nominee sections, write & re-open ===');
{
  const { zip, xml } = loadDocXml('08 Declaration of Maintenance of ROND - template.docx');
  let result = chooseSection(xml, 'havenomineedir', 'nothavenomineedir');
  result = chooseSection(result, 'indnomdirector', 'corpnomdirector');
  result = keepSectionIf(result, 'nomineedirector', true);
  result = replaceAllPlaceholders(result, {
    company_name: 'ROND TEST COMPANY PTE. LTD.',
    company_UEN: '202699999X',
    nominator_ind_name: 'INDIVIDUAL NOMINEE DIRECTOR',
    nominator_ind_address: '1 TEST ROAD, SINGAPORE',
    nominator_ind_nation: 'SINGAPOREAN',
    nominator_email: 'nominee@example.com',
    nominator_contactnumber: '91234567',
    nominator_ind_identityno: 'S1234567A',
    nominator_ind_birthdate: '01 January 1980',
    nominator_ind_date: '01 August 2026',
    nominee_director_name: 'INDIVIDUAL NOMINEE DIRECTOR',
    company_reg_date: '01 August 2026',
    company_address: '10 ANSON ROAD, SINGAPORE',
    signature_name: 'ZHANG DAN',
    signature_position: 'Director',
    director_name: 'ZHANG DAN',
    director_id_type: 'NRIC',
    director_identification_number: 'S1234567A',
    Chairman: 'ZHANG DAN',
  });

  zip.file('word/document.xml', result);
  const outBuf = zip.generate({ type: 'nodebuffer' });
  const outPath = path.join(__dirname, 'test-output-08-rond.docx');
  fs.writeFileSync(outPath, outBuf);

  const reopened = new PizZip(fs.readFileSync(outPath));
  const reopenedXml = reopened.file('word/document.xml')!.asText();
  const reopenedText = fullBodyText(reopenedXml);
  check('re-opened docx contains company name', reopenedText.includes('ROND TEST COMPANY'));
  check('re-opened docx contains individual nominee name', reopenedText.includes('INDIVIDUAL NOMINEE DIRECTOR'));
  check('no unresolved {{...}}', !/\{\{[^}]+\}\}/.test(reopenedText));
  check('no leftover [SECTION:...] markers at all', !/\[\[?(?:END)?SECTION:/i.test(reopenedText));
  fs.unlinkSync(outPath);
}

console.log(`\n=== SUMMARY: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
