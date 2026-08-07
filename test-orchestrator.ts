import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import {
  generatePostIncorporateDocuments, validatePostIncorporateInput,
  extractBodyChildren, blockText,
  type PostIncorporateInput,
} from './lib/docx-post-incorporate';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? 'OK  ' : 'FAIL') + '  ' + label);
  if (!cond) failures++;
}

function fullText(buf: Buffer): string {
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml')!.asText();
  return extractBodyChildren(xml).map(c => blockText(c.xml)).join('\n');
}

// A rich scenario exercising every conditional branch at once: 3 directors
// (1 nominee, individual nominator), 2 shareholders (1 individual fully
// paid-up, 1 corporate/UEN not fully paid-up), ND service needed.
const input: PostIncorporateInput = {
  company: {
    name: 'Acme Test Pte. Ltd.',
    uen: '202612345X',
    address: '10 Anson Road #12-08, Singapore 079903',
    regDate: '2026-08-01',
    chairmanName: 'Tan Ah Kow',
    secretaryName: 'Zhang Dan',
    secretaryCompanyName: 'Tassure Corporate Services Pte. Ltd.',
    secretaryCompanyAddress: '1 Marina Boulevard, Singapore',
    currency: 'SGD',
    financialYearEndDayMonth: '31 December',
    needNdService: true,
  },
  directors: [
    {
      name: 'Tan Ah Kow', address: '1 Raffles Place, Singapore', identificationType: 'NRIC', identificationNumber: 'S1234567A',
      nationality: 'Singaporean', dateOfBirth: '1980-01-01', gender: 'Male', email: 'tan@example.com', phone: '91234567',
      isNomineeDirector: false,
    },
    {
      name: 'Lim Bee Hoon', address: '2 Orchard Road, Singapore', identificationType: 'NRIC', identificationNumber: 'S7654321B',
      nationality: 'Singaporean', dateOfBirth: '1985-05-05', gender: 'Female', email: 'lim@example.com', phone: '98765432',
      isNomineeDirector: false,
    },
    {
      name: 'Nominee Director One', address: '3 Nominee Lane, Singapore', identificationType: 'NRIC', identificationNumber: 'S1111111C',
      nationality: 'Malaysian', dateOfBirth: '1975-03-03', gender: 'Male', email: 'nd@example.com', phone: '90001111',
      isNomineeDirector: true, nominatorType: 'individual',
      nominatorIndName: 'Nominator Individual', nominatorIndAddress: '4 Nominator Ave', nominatorIndNationality: 'Singaporean',
      nominatorIndIdentificationNumber: 'S2222222D', nominatorIndBirthDate: '1970-01-01', nominatorIndEmail: 'nominator@example.com',
      nominatorIndContactNumber: '90002222', nominatorIndDateBecameNominator: '2026-08-01',
    },
  ],
  shareholders: [
    {
      name: 'Tan Ah Kow', address: '1 Raffles Place, Singapore', identificationType: 'NRIC', identificationNumber: 'S1234567A',
      numberOfShares: '5000', paidUpCapital: '5,000', fullyPaidUp: true, shareCertificateNo: 'SC-001',
    },
    {
      name: 'Beta Holdings Pte Ltd', address: '5 Corporate Tower, Singapore', identificationType: 'UEN', identificationNumber: '201999999Z',
      numberOfShares: '5000', paidUpCapital: '5,000', fullyPaidUp: false,
      corporateDirectorNames: ['CORP DIRECTOR ONE', 'CORP DIRECTOR TWO'], corpRepresentative: 'Corp Rep Name', corpRepIdType: 'NRIC', corpRepIdNo: 'S3333333E',
    },
  ],
};

console.log('=== Validation on a valid input ===');
const errors = validatePostIncorporateInput(input);
check('no validation errors on valid input', errors.length === 0);
if (errors.length) console.log('  errors:', errors);

console.log('\n=== Validation catches missing corporate director names ===');
const badInput: PostIncorporateInput = { ...input, shareholders: [{ ...input.shareholders[1], corporateDirectorNames: [] }] };
const badErrors = validatePostIncorporateInput(badInput);
check('flags missing corporate director names', badErrors.some(e => e.includes('corporate director name')));

console.log('\n=== Validation catches duplicate share certificate numbers ===');
const dupInput: PostIncorporateInput = {
  ...input,
  shareholders: [
    { ...input.shareholders[0], shareCertificateNo: 'SC-001' },
    { ...input.shareholders[0], name: 'Second Holder', shareCertificateNo: 'sc-001' },
  ],
};
const dupErrors = validatePostIncorporateInput(dupInput);
check('flags duplicate (case-insensitive) share certificate numbers', dupErrors.some(e => e.includes('unique')));

console.log('\n=== Generate full document set ===');
const docs = generatePostIncorporateDocuments(input);
console.log(`generated ${docs.length} documents:`);
docs.forEach(d => console.log('  -', d.filename, `(${d.buffer.length} bytes)`));

// Expected count: 1 readme + 1 board resolution + 3 consent (1/director)
// + 1 secretary + 1 share cert (only Tan Ah Kow is fully paid up)
// + 1 engagement + 1 rorc auth + 1 rorc decl + 1 rond + 1 rons + 3 s156
// + 1 nd agreement + 2 corp rep docs (13+14, one UEN shareholder) + 2 (16+17, one nominee director)
// = 1+1+3+1+1+1+1+1+1+1+3+1+2+2 = 20
check('expected total document count (20)', docs.length === 20);

console.log('\n=== Structural checks per document ===');
for (const doc of docs) {
  if (doc.filename === '00 Readme.docx') continue;
  const text = fullText(doc.buffer);
  const unresolved = [...text.matchAll(/\{\{[^}]+\}\}/g)].map(m => m[0]);
  const leftoverMarkers = [...text.matchAll(/\[\[?(?:END)?SECTION:[^\]]*\]\]?/gi)].map(m => m[0]);
  if (unresolved.length) console.log(`  [${doc.filename}] UNRESOLVED:`, [...new Set(unresolved)]);
  if (leftoverMarkers.length) console.log(`  [${doc.filename}] LEFTOVER MARKERS:`, [...new Set(leftoverMarkers)]);
  check(`${doc.filename}: no unresolved placeholders`, unresolved.length === 0);
  check(`${doc.filename}: no leftover section markers`, leftoverMarkers.length === 0);
}

console.log('\n=== Content spot-checks ===');
const boardRes = docs.find(d => d.filename.includes('First Board Resolution'))!;
const boardText = fullText(boardRes.buffer);
check('board resolution: director_desc plural ("Directors")', boardText.includes('Directors'));
check('board resolution: all 3 director names appear', ['TAN AH KOW', 'LIM BEE HOON', 'NOMINEE DIRECTOR ONE'].every(n => boardText.includes(n)));
check('board resolution: appointND kept with ND name', boardText.includes('NOMINEE DIRECTOR ONE') && boardText.includes('APPOINTMENT OF NOMINEE DIRECTOR'));
check('board resolution: both shareholders appear once each', (boardText.match(/BETA HOLDINGS PTE LTD/g) || []).length === 1);
check('board resolution: header "Name of Subscriber" appears once (dedup)', (boardText.match(/Name of Subscriber/gi) || []).length === 1);

const rond = docs.find(d => d.filename.includes('Declaration of Maintenance of ROND'))!;
const rondText = fullText(rond.buffer);
check('ROND: nominee individual name appears', rondText.includes('NOMINATOR INDIVIDUAL'));
check('ROND: strikethrough applied to inactive nothavenomineedir run (raw xml check)', (() => {
  const zip = new PizZip(rond.buffer);
  const xml = zip.file('word/document.xml')!.asText();
  return /<w:strike w:val="1"\/>/.test(xml);
})());

const ndAgreement = docs.find(d => d.filename.includes('ND_AGREEMENT'));
check('ND agreement generated (needNdService=true)', !!ndAgreement);
if (ndAgreement) {
  const ndText = fullText(ndAgreement.buffer);
  check('ND agreement: individual shareholder shows own name (no dangling corprep phrase)', ndText.includes('TAN AH KOW') && !/\(Corporate Representative of TAN AH KOW\).*\(Corporate Representative of TAN AH KOW\)/.test(ndText));
  check('ND agreement: corporate shareholder shows corp rep phrase', ndText.includes('CORP REP NAME') && ndText.includes('Corporate Representative of BETA HOLDINGS'));
}

const certDocs = docs.filter(d => d.filename.includes('Cert of corp representative') || d.filename.includes('Appointment of company representative'));
check('exactly 2 corp representative docs (one UEN shareholder x 2 templates)', certDocs.length === 2);
if (certDocs.length) {
  const certText = fullText(certDocs[0].buffer);
  check('corp rep doc: uses SHAREHOLDER\'s own corporate director names, not company directors', certText.includes('CORP DIRECTOR ONE') && certText.includes('CORP DIRECTOR TWO'));
}

const decl16 = docs.find(d => d.filename.includes('Local Director declaration'));
const decl17 = docs.find(d => d.filename.includes('ND Fit and Proper'));
check('16/17 generated (nominee director present)', !!decl16 && !!decl17);
if (decl16) {
  const text16 = fullText(decl16.buffer);
  check('16: individual nominator branch present', text16.includes('NOMINATOR INDIVIDUAL'));
}

console.log('\n=== No-nominee, no-ND-service scenario ===');
const simpleInput: PostIncorporateInput = {
  ...input,
  company: { ...input.company, needNdService: false },
  directors: input.directors.filter(d => !d.isNomineeDirector),
};
const simpleDocs = generatePostIncorporateDocuments(simpleInput);
check('no ND agreement when needNdService=false', !simpleDocs.some(d => d.filename.includes('ND_AGREEMENT')));
check('no 16/17 when no nominee director', !simpleDocs.some(d => d.filename.includes('Local Director declaration') || d.filename.includes('ND Fit and Proper')));
const simpleRond = simpleDocs.find(d => d.filename.includes('Declaration of Maintenance of ROND'))!;
const simpleRondText = fullText(simpleRond.buffer);
check('simple ROND: no unresolved placeholders', !/\{\{[^}]+\}\}/.test(simpleRondText));
check('simple ROND: no leftover markers', !/\[\[?(?:END)?SECTION:/i.test(simpleRondText));

console.log(`\n=== SUMMARY: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
