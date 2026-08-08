// Orchestrates the "Post Incorporate - Tassure" document set: given company /
// director / shareholder data, fills the 16 real production Word templates
// under templates/post-incorporate/ and returns each as an in-memory buffer.
//
// Ported from Operation_Docxs_Generator - Tassure V3.py's
// generate_post_incorporate_record() and its build_*_template_data() /
// replace_*_placeholders() helpers — specifically the is_tassure_post_incorporate
// branch, since only the 16 Tassure-variant templates were copied into this
// repo (the ~15 additional non-Tassure-only templates referenced elsewhere in
// that function were never copied and are out of scope).
//
// Business rules replicated exactly (traced from the Python source, not
// guessed):
// - director_desc/is_are singular vs plural on the First Board Resolution.
// - 08 ROND / 09 RONS: the have/no-have nominee declaration keeps BOTH
//   clauses and strikes through the inactive one (matching the template's
//   own "* Delete as appropriate" instruction) rather than removing it.
// - 08 ROND / 09 RONS: the per-nominee nomineedirector/nomineeshareholder
//   block repeats once per nominee, with the individual/corporate nominator
//   sub-paragraphs BOTH left in place per copy — the inapplicable one's
//   fields are simply blank (the original's own behavior, not a bug to fix).
// - 16 Local Director declaration: indnomdirector/corpnomdirector are
//   top-level (not nested) and are repeated only with the matching-type
//   items, so the non-matching branch disappears cleanly instead of
//   rendering blank.
// - Share Certificate {{director_name}}/{{title}} selection order: an
//   explicit non-nominee director first, then any nominee director, then
//   any other director, finally falling back to the company secretary.
// - Corporate-representative templates (13/14) sign using the SHAREHOLDER's
//   own declared corporate director names, not the company's directors.
// - Validation: every UEN shareholder needs at least one corporate director
//   name; every fully-paid-up shareholder needs a unique share certificate
//   number.

import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import {
  replaceAllPlaceholders, repeatSection, pairRepeatSection, keepSectionIf,
  findSection, extractBodyChildren, blockText, stripMarkerText, replaceTextPattern,
} from './docx-xml';

const TEMPLATE_DIR = path.join(process.cwd(), 'templates', 'post-incorporate');

const TEMPLATE_FILES = {
  readme: '00 Readme.docx',
  firstBoardResolution: '01 First Board Resolution - template.docx',
  consentDirector: '02 Consent to Act as Director - template.docx',
  secretaryAppointment: '03 Secretary Appointment Letter - template.docx',
  shareCertificate: '04 ShareCertificate - template.docx',
  engagementLetter: '05 Engagement_Letter_and_Indemnity_and_Undertaking_of_Secretarial_Services - template.docx',
  rorcAuthorisation: '06 Authorisation_letter_on_RORC_ROND_RONS_lodgment - template.docx',
  rorcDeclaration: '07 Declaration of RORC - template.docx',
  rondMaintenance: '08 Declaration of Maintenance of ROND - template.docx',
  ronsMaintenance: '09 Declaration of Maintenance of RONS - template.docx',
  s156Directorship: '10 S156_Declaration of Directorship - template.docx',
  ndAgreement: '12 ND_AGREEMENT - template.docx',
  certCorpRepresentative: '13 Cert of corp representative - template.docx',
  appointmentCompanyRepresentative: '14 Appointment of company representative - template.docx',
  localDirectorDeclarationRond: '16 Local Director declaration on Register of ND - template.docx',
  ndFitProperDeclaration: '17 ND Fit and Proper Declaration - template.docx',
} as const;

export type NominatorType = 'individual' | 'corporate entity' | '';

export type PostIncorporateDirector = {
  name: string;
  address: string;
  identificationType: string;
  identificationNumber: string;
  nationality: string;
  dateOfBirth: string;
  gender: string;
  email: string;
  phone: string;
  isNomineeDirector: boolean;
  nominatorType?: NominatorType;
  nominatorIndName?: string;
  nominatorIndAddress?: string;
  nominatorIndNationality?: string;
  nominatorIndIdentificationNumber?: string;
  nominatorIndBirthDate?: string;
  nominatorIndEmail?: string;
  nominatorIndContactNumber?: string;
  nominatorIndDateBecameNominator?: string;
  nominatorCorpName?: string;
  nominatorCorpUen?: string;
  nominatorCorpRegisteredAddress?: string;
  nominatorCorpLegalForm?: string;
  nominatorCorpRepresentative?: string;
  nominatorCorpEmail?: string;
  nominatorCorpContactNumber?: string;
  nominatorCorpDateBecameNominator?: string;
};

export type PostIncorporateShareholder = {
  name: string;
  address: string;
  identificationType: string; // NRIC / PASSPORT / FIN / UEN
  identificationNumber: string;
  numberOfShares: string;
  paidUpCapital: string;
  fullyPaidUp: boolean;
  shareCertificateNo?: string;
  corporateDirectorNames?: string[]; // required when identificationType === "UEN"
  corpRepresentative?: string;
  corpRepIdType?: string;
  corpRepIdNo?: string;
  isNomineeShareholder?: boolean;
  nominatorType?: NominatorType;
  nominatorIndName?: string;
  nominatorIndAddress?: string;
  nominatorIndNationality?: string;
  nominatorIndIdentificationNumber?: string;
  nominatorIndBirthDate?: string;
  nominatorIndEmail?: string;
  nominatorIndContactNumber?: string;
  nominatorIndDateBecameNominator?: string;
  nominatorCorpName?: string;
  nominatorCorpUen?: string;
  nominatorCorpRegisteredAddress?: string;
  nominatorCorpLegalForm?: string;
  nominatorCorpRepresentative?: string;
  nominatorCorpEmail?: string;
  nominatorCorpContactNumber?: string;
  nominatorCorpDateBecameNominator?: string;
};

export type PostIncorporateCompany = {
  name: string;
  uen: string;
  address: string;
  regDate: string; // ISO yyyy-mm-dd
  chairmanName: string; // must match one director's name
  secretaryName: string;
  secretaryCompanyName: string; // the corporate secretarial firm's own registered name
  secretaryCompanyAddress: string; // the corporate secretarial firm's own registered address
  currency: string;
  financialYearEndDayMonth: string; // e.g. "31 December"
  needNdService: boolean;
};

export type PostIncorporateInput = {
  company: PostIncorporateCompany;
  directors: PostIncorporateDirector[];
  shareholders: PostIncorporateShareholder[];
};

export type GeneratedDoc = { filename: string; buffer: Buffer };

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function intToWords(n: number): string {
  if (n === 0) return 'Zero';
  if (n < 0) return 'Minus ' + intToWords(-n);
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) { parts.push(ONES[Math.floor(x / 100)] + ' Hundred'); x %= 100; }
    if (x >= 20) { parts.push(TENS[Math.floor(x / 10)]); x %= 10; }
    if (x > 0) parts.push(ONES[x]);
    return parts.join(' ');
  };
  const parts: string[] = [];
  let scaleIndex = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      let text = under1000(chunk);
      if (SCALES[scaleIndex]) text += ' ' + SCALES[scaleIndex];
      parts.push(text);
    }
    n = Math.floor(n / 1000);
    scaleIndex += 1;
  }
  return parts.reverse().join(' ');
}

function sharesToWords(value: string): string {
  const cleaned = (value || '').replace(/,/g, '').trim();
  if (!cleaned || !/^\d+$/.test(cleaned)) return '';
  return (intToWords(parseInt(cleaned, 10)) + ' Only').toUpperCase();
}

// Previous month's last day, formatted "DD Month" — e.g. 09 March 2026 -> "28 February".
function calcSecServiceEndDate(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth(); // 0-based; "previous month" = current 0-based month
  if (month === 0) { month = 12; year -= 1; }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${String(lastDay).padStart(2, '0')} ${monthName}`;
}

function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

function safeToken(value: string): string {
  return (value || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'UNKNOWN';
}

function outputName(templateFilename: string, mode: 'strip' | { token: string }): string {
  if (mode === 'strip') return templateFilename.replace(' - template', '');
  return templateFilename.replace('template', mode.token);
}

function loadTemplate(filename: string): { zip: PizZip; xml: string } {
  const buf = fs.readFileSync(path.join(TEMPLATE_DIR, filename));
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml')!.asText();
  return { zip, xml };
}

function renderDoc(templateFilename: string, xml: string): Buffer {
  const { zip } = loadTemplate(templateFilename);
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer' });
}

// --- validation -------------------------------------------------------

export function validatePostIncorporateInput(input: PostIncorporateInput): string[] {
  const errors: string[] = [];
  const { company, directors, shareholders } = input;

  if (!company.name.trim()) errors.push('Company name is required.');
  if (!company.uen.trim()) errors.push('Company UEN is required.');
  if (!company.regDate.trim()) errors.push('Company registration date is required.');
  if (directors.every(d => !d.name.trim())) errors.push('At least one director is required.');
  if (company.chairmanName.trim() && !directors.some(d => d.name.trim().toUpperCase() === company.chairmanName.trim().toUpperCase())) {
    errors.push(`Chairman "${company.chairmanName}" does not match any director's name.`);
  }

  shareholders.forEach((s, i) => {
    const label = s.name.trim() || `Shareholder #${i + 1}`;
    if (s.identificationType.trim().toUpperCase() === 'UEN') {
      const names = (s.corporateDirectorNames || []).map(n => n.trim()).filter(Boolean);
      if (!names.length) errors.push(`${label}: at least one corporate director name is required for a UEN (corporate) shareholder.`);
    }
  });

  const certNumbers: string[] = [];
  shareholders.forEach((s, i) => {
    const label = s.name.trim() || `Shareholder #${i + 1}`;
    if (!s.fullyPaidUp) return;
    const cert = (s.shareCertificateNo || '').trim();
    if (!cert) { errors.push(`${label}: Share Certificate No. is required when fully paid-up.`); return; }
    const normalized = cert.toUpperCase();
    if (certNumbers.includes(normalized)) errors.push(`Share Certificate No. "${cert}" is used by more than one shareholder — it must be unique.`);
    certNumbers.push(normalized);
  });

  return errors;
}

// --- shared per-run data ------------------------------------------------

function baseData(input: PostIncorporateInput): Record<string, string> {
  const { company } = input;
  return {
    company_name: company.name.trim().toUpperCase(),
    company_UEN: company.uen.trim().toUpperCase(),
    company_uen: company.uen.trim().toUpperCase(),
    company_address: company.address.trim(),
    company_reg_date: formatDisplayDate(company.regDate),
    company_incorporation_date: formatDisplayDate(company.regDate),
    Chairman: company.chairmanName.trim().toUpperCase(),
    chairman: company.chairmanName.trim().toUpperCase(),
    secretary_name: company.secretaryName.trim().toUpperCase(),
    company_secretary: company.secretaryName.trim().toUpperCase(),
    secretary_company_name: company.secretaryCompanyName.trim(),
    secretary_company_address: company.secretaryCompanyAddress.trim(),
    Currency: company.currency.trim(),
    currency: company.currency.trim(),
    finperiod_enddate: company.financialYearEndDayMonth.trim(),
    first_finperiod_enddate: company.financialYearEndDayMonth.trim(),
  };
}

function chairmanDirector(input: PostIncorporateInput): PostIncorporateDirector | undefined {
  const name = input.company.chairmanName.trim().toUpperCase();
  return input.directors.find(d => d.name.trim().toUpperCase() === name);
}

function directorIdFields(d: PostIncorporateDirector | undefined, fallbackName: string): Record<string, string> {
  return {
    director_name: (d?.name || fallbackName).trim().toUpperCase(),
    director_id_type: (d?.identificationType || '').trim(),
    director_identification_number: (d?.identificationNumber || '').trim().toUpperCase(),
    director_address: (d?.address || '').trim(),
  };
}

// --- 01 First Board Resolution ------------------------------------------

function generateFirstBoardResolution(input: PostIncorporateInput): GeneratedDoc {
  const { directors, shareholders } = input;
  const namedDirectors = directors.filter(d => d.name.trim());
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.firstBoardResolution);
  const data = {
    ...baseData(input),
    director_desc: namedDirectors.length > 1 ? 'Directors' : 'Director',
    is_are: namedDirectors.length > 1 ? 'are' : 'is',
  };

  const nomineeDirector = namedDirectors.find(d => d.isNomineeDirector);

  let xml = templateXml;
  xml = keepSectionIf(xml, 'appointND', !!nomineeDirector);
  xml = repeatSection(xml, 'directorlist', namedDirectors.map(d => ({ director_name: d.name.trim().toUpperCase() })), data);
  xml = repeatSection(
    xml,
    'shareholderlist',
    shareholders.filter(s => s.name.trim()).map(s => ({
      shareholder_name: s.name.trim().toUpperCase(),
      shareholder_paidupamount: s.paidUpCapital.trim(),
      shareholder_numofshares: s.numberOfShares.trim(),
      shareholder_numofshares_inwords: sharesToWords(s.numberOfShares),
    })),
    data,
    { dropHeaderRowAfterFirst: (t) => t.includes('name of subscriber') && t.includes('no. of ordinary shares') },
  );
  xml = pairRepeatSection(xml, 'signaturedirector', namedDirectors.map(d => d.name.trim().toUpperCase()), 'director_name_1', 'director_name_2', data);
  xml = replaceAllPlaceholders(xml, { ...data, ND_name: (nomineeDirector?.name || '').trim().toUpperCase() });
  xml = stripMarkerText(xml);

  return { filename: outputName(TEMPLATE_FILES.firstBoardResolution, 'strip'), buffer: renderDoc(TEMPLATE_FILES.firstBoardResolution, xml) };
}

// --- 02 Consent to Act as Director (one per director) -------------------

function generateConsentDirector(input: PostIncorporateInput): GeneratedDoc[] {
  const data = baseData(input);
  return input.directors.filter(d => d.name.trim()).map(d => {
    const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.consentDirector);
    const merged = {
      ...data,
      director_name: d.name.trim().toUpperCase(),
      director_address: d.address.trim(),
      director_identification_type: d.identificationType.trim(),
      director_identification_number: d.identificationNumber.trim().toUpperCase(),
      director_nationality: d.nationality.trim().toUpperCase(),
      director_birthdate: d.dateOfBirth.trim(),
      director_gender: d.gender.trim(),
      director_email: d.email.trim(),
      director_phonenumber: d.phone.trim(),
    };
    const xml = stripMarkerText(replaceAllPlaceholders(templateXml, merged));
    const token = d.isNomineeDirector ? 'ND' : safeToken(d.name.trim().toUpperCase());
    return { filename: outputName(TEMPLATE_FILES.consentDirector, { token }), buffer: renderDoc(TEMPLATE_FILES.consentDirector, xml) };
  });
}

// --- 03 Secretary Appointment Letter -------------------------------------

function generateSecretaryAppointment(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.secretaryAppointment);
  const data = {
    ...baseData(input),
    appoint_secretary_name: input.company.secretaryName.trim().toUpperCase(),
    appoint_secretary_address: '',
  };
  const xml = stripMarkerText(replaceAllPlaceholders(templateXml, data));
  return { filename: outputName(TEMPLATE_FILES.secretaryAppointment, 'strip'), buffer: renderDoc(TEMPLATE_FILES.secretaryAppointment, xml) };
}

// --- 04 Share Certificate (one per fully-paid-up shareholder) -----------

function selectShareCertDirectorNameAndTitle(input: PostIncorporateInput): { directorName: string; title: string } {
  const chairman = input.company.chairmanName.trim().toUpperCase();
  const candidates = input.directors.filter(d => d.name.trim() && d.name.trim().toUpperCase() !== chairman);
  const ordinary = candidates.filter(d => !d.isNomineeDirector);
  if (ordinary.length) return { directorName: ordinary[Math.floor(Math.random() * ordinary.length)].name.trim().toUpperCase(), title: 'Director' };
  const nominee = candidates.filter(d => d.isNomineeDirector);
  if (nominee.length) return { directorName: nominee[Math.floor(Math.random() * nominee.length)].name.trim().toUpperCase(), title: 'Director' };
  if (candidates.length) return { directorName: candidates[0].name.trim().toUpperCase(), title: 'Director' };
  return { directorName: input.company.secretaryName.trim().toUpperCase(), title: 'Secretary' };
}

function generateShareCertificates(input: PostIncorporateInput): GeneratedDoc[] {
  const data = baseData(input);
  const { directorName, title } = selectShareCertDirectorNameAndTitle(input);
  return input.shareholders.filter(s => s.name.trim() && s.fullyPaidUp).map(s => {
    const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.shareCertificate);
    const merged = {
      ...data,
      shareholder_name: s.name.trim().toUpperCase(),
      shareholder_address: s.address.trim(),
      shareholder_numofshares: s.numberOfShares.trim(),
      shareholder_numofshares_inwords: sharesToWords(s.numberOfShares),
      shareholder_certNo: (s.shareCertificateNo || '').trim(),
      'shareholder_certNo.': (s.shareCertificateNo || '').trim(),
      director_name: directorName,
      title,
    };
    const xml = stripMarkerText(replaceAllPlaceholders(templateXml, merged));
    const token = safeToken((s.shareCertificateNo || '').trim() || 'ShareCertificate');
    return { filename: outputName(TEMPLATE_FILES.shareCertificate, { token }), buffer: renderDoc(TEMPLATE_FILES.shareCertificate, xml) };
  });
}

// --- 05 Engagement Letter --------------------------------------------

function generateEngagementLetter(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.engagementLetter);
  const data = { ...baseData(input), secservice_end_date: calcSecServiceEndDate(input.company.regDate) };
  const xml = stripMarkerText(replaceAllPlaceholders(templateXml, data));
  return { filename: outputName(TEMPLATE_FILES.engagementLetter, 'strip'), buffer: renderDoc(TEMPLATE_FILES.engagementLetter, xml) };
}

// --- 06 RORC/ROND/RONS Authorisation Letter ------------------------------

function generateRorcAuthorisation(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.rorcAuthorisation);
  const xml = stripMarkerText(replaceAllPlaceholders(templateXml, baseData(input)));
  return { filename: outputName(TEMPLATE_FILES.rorcAuthorisation, 'strip'), buffer: renderDoc(TEMPLATE_FILES.rorcAuthorisation, xml) };
}

// --- 07 Declaration of RORC (signed by Chairman) -------------------------

function generateRorcDeclaration(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.rorcDeclaration);
  const chairman = chairmanDirector(input);
  const data = { ...baseData(input), ...directorIdFields(chairman, input.company.chairmanName) };
  const xml = stripMarkerText(replaceAllPlaceholders(templateXml, data));
  return { filename: outputName(TEMPLATE_FILES.rorcDeclaration, 'strip'), buffer: renderDoc(TEMPLATE_FILES.rorcDeclaration, xml) };
}

// --- shared: nominee-director/-shareholder item builders -----------------

const BLANK_NOMINEE_FIELDS: Record<string, string> = {
  nominator_ind_address: '', nominator_ind_nation: '', nominator_ind_nationality: '',
  nominator_ind_identityno: '', nominator_ind_identification_number: '',
  nominator_ind_birthdate: '', nominator_ind_birth_date: '',
  nominator_ind_email: '', nominator_ind_email_address: '',
  nominator_ind_contact_number: '', nominator_ind_contact_no: '', nominator_ind_contactnumber: '',
  nominator_email: '', nominator_contactnumber: '',
  nominator_ind_date: '', nominator_ind_date_became_nominator: '',
  nominator_corp_identityno: '', nominator_corp_uen: '',
  nominator_corp_address: '', nominator_corp_registered_address: '',
  nominator_corp_form: '', nominator_corp_legal_form: '',
  nominator_corp_date: '', nominator_corp_date_became_nominator: '',
  nominator_corp_representative: '', nominator_corp_corp_representative: '',
  nominator_corp_email: '', nominator_corp_email_address: '',
  nominator_corp_contact_number: '', nominator_corp_contact_no: '', nominator_corp_contactnumber: '',
};

function nomineeDirectorItem(d: PostIncorporateDirector): Record<string, string> {
  const name = d.name.trim().toUpperCase();
  const item: Record<string, string> = { ...BLANK_NOMINEE_FIELDS, nominator_type: d.nominatorType || '', ND_name: name, nominee_director_name: name };
  if (d.nominatorType === 'individual') {
    const indName = (d.nominatorIndName || '').trim().toUpperCase();
    Object.assign(item, {
      nominator_ind_name: indName,
      nominator_ind_address: (d.nominatorIndAddress || '').trim(),
      nominator_ind_nationality: (d.nominatorIndNationality || '').trim().toUpperCase(),
      nominator_ind_nation: (d.nominatorIndNationality || '').trim().toUpperCase(),
      nominator_ind_identification_number: (d.nominatorIndIdentificationNumber || '').trim().toUpperCase(),
      nominator_ind_identityno: (d.nominatorIndIdentificationNumber || '').trim().toUpperCase(),
      nominator_ind_birth_date: (d.nominatorIndBirthDate || '').trim(),
      nominator_ind_birthdate: (d.nominatorIndBirthDate || '').trim(),
      nominator_ind_email: (d.nominatorIndEmail || '').trim(),
      nominator_ind_email_address: (d.nominatorIndEmail || '').trim(),
      nominator_ind_contact_number: (d.nominatorIndContactNumber || '').trim(),
      nominator_ind_contact_no: (d.nominatorIndContactNumber || '').trim(),
      nominator_email: (d.nominatorIndEmail || '').trim(),
      nominator_contactnumber: (d.nominatorIndContactNumber || '').trim(),
      nominator_ind_date_became_nominator: (d.nominatorIndDateBecameNominator || '').trim(),
      nominator_ind_date: (d.nominatorIndDateBecameNominator || '').trim(),
      nominator_corp_name: '',
      signature_name: indName,
      signature_position: 'Director',
    });
  } else if (d.nominatorType === 'corporate entity') {
    const corpName = (d.nominatorCorpName || '').trim().toUpperCase();
    const corpRep = (d.nominatorCorpRepresentative || '').trim().toUpperCase();
    Object.assign(item, {
      nominator_ind_name: '',
      nominator_corp_name: corpName,
      nominator_corp_uen: (d.nominatorCorpUen || '').trim().toUpperCase(),
      nominator_corp_identityno: (d.nominatorCorpUen || '').trim().toUpperCase(),
      nominator_corp_registered_address: (d.nominatorCorpRegisteredAddress || '').trim(),
      nominator_corp_address: (d.nominatorCorpRegisteredAddress || '').trim(),
      nominator_corp_legal_form: (d.nominatorCorpLegalForm || '').trim(),
      nominator_corp_form: (d.nominatorCorpLegalForm || '').trim(),
      nominator_corp_representative: corpRep,
      nominator_corp_corp_representative: corpRep,
      nominator_corp_email: (d.nominatorCorpEmail || '').trim(),
      nominator_corp_email_address: (d.nominatorCorpEmail || '').trim(),
      nominator_corp_contact_number: (d.nominatorCorpContactNumber || '').trim(),
      nominator_corp_contact_no: (d.nominatorCorpContactNumber || '').trim(),
      nominator_corp_date_became_nominator: (d.nominatorCorpDateBecameNominator || '').trim(),
      nominator_corp_date: (d.nominatorCorpDateBecameNominator || '').trim(),
      signature_name: corpName,
      signature_position: corpRep ? `Corporate Representative of the Entity: ${corpRep}` : 'Corporate Representative of the Entity:',
    });
  } else {
    Object.assign(item, { nominator_ind_name: '', nominator_corp_name: '', signature_name: name, signature_position: 'Director' });
  }
  return item;
}

// --- 08 Declaration of Maintenance of ROND -------------------------------

function keepBothStrikeInactive(xml: string, activeName: string, inactiveName: string): string {
  let result = xml;
  for (const name of [activeName, inactiveName]) {
    const section = findSection(result, name);
    if (!section) continue;
    let content = stripMarkerText(section.contentBlocks.map(b => b.xml).join(''));
    if (name === inactiveName) content = applyStrikethroughToRuns(content);
    result = result.slice(0, section.removeStart) + content + result.slice(section.removeEnd);
  }
  return result;
}

function applyStrikethroughToRuns(xml: string): string {
  const runRe = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  return xml.replace(runRe, (run) => {
    if (!/<w:t\b/.test(run)) return run;
    if (/<w:rPr>/.test(run)) return run.replace(/<\/w:rPr>/, '<w:strike w:val="1"/></w:rPr>');
    if (/<w:rPr\/>/.test(run)) return run.replace('<w:rPr/>', '<w:rPr><w:strike w:val="1"/></w:rPr>');
    return run.replace(/^(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr><w:strike w:val="1"/></w:rPr>');
  });
}

function generateRondMaintenance(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.rondMaintenance);
  const chairman = chairmanDirector(input);
  const nomineeDirectors = input.directors.filter(d => d.name.trim() && d.isNomineeDirector);
  const nomineeYes = nomineeDirectors.length > 0;

  const data: Record<string, string> = {
    ...baseData(input),
    ...directorIdFields(chairman, input.company.chairmanName),
  };

  let xml = templateXml;
  xml = keepBothStrikeInactive(xml, nomineeYes ? 'havenomineedir' : 'nothavenomineedir', nomineeYes ? 'nothavenomineedir' : 'havenomineedir');

  if (nomineeYes) {
    const items = nomineeDirectors.map(d => ({ ...data, ...nomineeDirectorItem(d) }));
    xml = repeatSection(xml, 'nomineedirector', items, data);
    xml = replaceAllPlaceholders(xml, { ...data, ND_name: nomineeDirectors[0].name.trim().toUpperCase(), nominee_director_name: nomineeDirectors[0].name.trim().toUpperCase() });
  } else {
    xml = keepSectionIf(xml, 'nomineedirector', false);
    xml = replaceAllPlaceholders(xml, {
      ...data, ...BLANK_NOMINEE_FIELDS,
      nominator_type: '', ND_name: '', nominee_director_name: 'NA',
      nominator_ind_name: 'NA', nominator_corp_name: 'NA',
      signature_name: data.Chairman, signature_position: 'Director',
    });
  }
  xml = stripMarkerText(xml);
  return { filename: outputName(TEMPLATE_FILES.rondMaintenance, 'strip'), buffer: renderDoc(TEMPLATE_FILES.rondMaintenance, xml) };
}

// --- 09 Declaration of Maintenance of RONS -------------------------------

function nomineeShareholderItem(s: PostIncorporateShareholder): Record<string, string> {
  const name = s.name.trim().toUpperCase();
  const item: Record<string, string> = { ...BLANK_NOMINEE_FIELDS, nominator_type: s.nominatorType || '', nominee_shareholder_name: name, signature_position: '' };
  if (s.nominatorType === 'individual') {
    const indName = (s.nominatorIndName || '').trim().toUpperCase();
    Object.assign(item, {
      nominator_ind_name: indName,
      nominator_corp_name: '',
      nominator_ind_address: (s.nominatorIndAddress || '').trim(),
      nominator_ind_nationality: (s.nominatorIndNationality || '').trim().toUpperCase(),
      nominator_ind_nation: (s.nominatorIndNationality || '').trim().toUpperCase(),
      nominator_ind_identification_number: (s.nominatorIndIdentificationNumber || '').trim().toUpperCase(),
      nominator_ind_identityno: (s.nominatorIndIdentificationNumber || '').trim().toUpperCase(),
      nominator_ind_birth_date: (s.nominatorIndBirthDate || '').trim(),
      nominator_ind_birthdate: (s.nominatorIndBirthDate || '').trim(),
      nominator_ind_email: (s.nominatorIndEmail || '').trim(),
      nominator_ind_email_address: (s.nominatorIndEmail || '').trim(),
      nominator_email: (s.nominatorIndEmail || '').trim(),
      nominator_ind_contact_number: (s.nominatorIndContactNumber || '').trim(),
      nominator_ind_contact_no: (s.nominatorIndContactNumber || '').trim(),
      nominator_contactnumber: (s.nominatorIndContactNumber || '').trim(),
      nominator_ind_date_became_nominator: (s.nominatorIndDateBecameNominator || '').trim(),
      nominator_ind_date: (s.nominatorIndDateBecameNominator || '').trim(),
      signature_name: indName,
    });
  } else if (s.nominatorType === 'corporate entity') {
    const corpName = (s.nominatorCorpName || '').trim().toUpperCase();
    const corpRep = (s.nominatorCorpRepresentative || '').trim().toUpperCase();
    Object.assign(item, {
      nominator_ind_name: '',
      nominator_corp_name: corpName,
      nominator_corp_uen: (s.nominatorCorpUen || '').trim().toUpperCase(),
      nominator_corp_identityno: (s.nominatorCorpUen || '').trim().toUpperCase(),
      nominator_corp_registered_address: (s.nominatorCorpRegisteredAddress || '').trim(),
      nominator_corp_address: (s.nominatorCorpRegisteredAddress || '').trim(),
      nominator_corp_legal_form: (s.nominatorCorpLegalForm || '').trim(),
      nominator_corp_form: (s.nominatorCorpLegalForm || '').trim(),
      nominator_corp_representative: corpRep,
      nominator_corp_corp_representative: corpRep,
      nominator_corp_email: (s.nominatorCorpEmail || '').trim(),
      nominator_corp_email_address: (s.nominatorCorpEmail || '').trim(),
      nominator_corp_contact_number: (s.nominatorCorpContactNumber || '').trim(),
      nominator_corp_contact_no: (s.nominatorCorpContactNumber || '').trim(),
      nominator_corp_date_became_nominator: (s.nominatorCorpDateBecameNominator || '').trim(),
      nominator_corp_date: (s.nominatorCorpDateBecameNominator || '').trim(),
      signature_name: corpName,
      signature_position: corpRep ? `Corporate Representative of the Entity: ${corpRep}` : 'Corporate Representative of the Entity:',
    });
  } else {
    Object.assign(item, { nominator_ind_name: '', nominator_corp_name: '', signature_name: name });
  }
  return item;
}

function generateRonsMaintenance(input: PostIncorporateInput): GeneratedDoc {
  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.ronsMaintenance);
  const chairman = chairmanDirector(input);
  const nomineeShareholders = input.shareholders.filter(s => s.name.trim() && s.isNomineeShareholder);
  const nomineeYes = nomineeShareholders.length > 0;
  const data: Record<string, string> = {
    ...baseData(input),
    ...directorIdFields(chairman, input.company.chairmanName),
  };
  let xml = templateXml;
  xml = keepBothStrikeInactive(xml, nomineeYes ? 'havenomineeshareholder' : 'nothavenomineeshareholder', nomineeYes ? 'nothavenomineeshareholder' : 'havenomineeshareholder');

  if (nomineeYes) {
    const items = nomineeShareholders.map(s => ({ ...data, ...nomineeShareholderItem(s) }));
    xml = repeatSection(xml, 'nomineeshareholder', items, data);
    xml = replaceAllPlaceholders(xml, { ...data, nominee_shareholder_name: nomineeShareholders[0].name.trim().toUpperCase() });
  } else {
    xml = keepSectionIf(xml, 'nomineeshareholder', false);
    xml = replaceAllPlaceholders(xml, {
      ...data, ...BLANK_NOMINEE_FIELDS,
      nominator_type: '', nominee_shareholder_name: 'NA',
      nominator_ind_name: 'NA', nominator_corp_name: 'NA',
      signature_name: data.Chairman, signature_position: 'Director',
    });
  }
  xml = stripMarkerText(xml);
  return { filename: outputName(TEMPLATE_FILES.ronsMaintenance, 'strip'), buffer: renderDoc(TEMPLATE_FILES.ronsMaintenance, xml) };
}

// --- 10 S156 Declaration of Directorship (one per director) -------------

function generateS156(input: PostIncorporateInput): GeneratedDoc[] {
  const data = baseData(input);
  return input.directors.filter(d => d.name.trim()).map(d => {
    const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.s156Directorship);
    const merged = { ...data, director_name: d.name.trim().toUpperCase(), director_address: d.address.trim() };
    const xml = stripMarkerText(replaceAllPlaceholders(templateXml, merged));
    const token = d.isNomineeDirector ? 'ND' : safeToken(d.name.trim().toUpperCase());
    return { filename: outputName(TEMPLATE_FILES.s156Directorship, { token }), buffer: renderDoc(TEMPLATE_FILES.s156Directorship, xml) };
  });
}

// --- 12 ND_AGREEMENT (only if needNdService) ------------------------------

// Cross-run-safe collapse of the template's fixed literal phrase
// "{{shareholder_corprep_name}} (Corporate Representative of
// {{shareholder_name}})" — which lives in [SECTION:shareholder] — down to
// just the shareholder's own name for an individual (non-corp) shareholder,
// who has no separate corporate representative to name. Matches the
// original tool's _replace_placeholders_in_xml_text_preserve_nodes special
// case. Must run on the template BEFORE repeatSection clones it once per
// shareholder, and must go through replaceTextPattern (not a raw
// xml.replace on the string) since the two placeholders are commonly split
// across separate <w:t> runs.
const CORP_REP_PHRASE_RE = /\{\{\s*shareholder_corprep_name\s*\}\}\s*\(\s*Corporate\s+Representative\s+of\s+\{\{\s*shareholder_name\s*\}\}\s*\)/gi;

function generateNdAgreement(input: PostIncorporateInput): GeneratedDoc | null {
  if (!input.company.needNdService) return null;
  const nomineeDirectors = input.directors.filter(d => d.name.trim() && d.isNomineeDirector);
  const nd = nomineeDirectors[0];
  if (!nd) return null;

  const chairman = chairmanDirector(input) || input.directors.find(d => d.name.trim() && !d.isNomineeDirector) || input.directors[0];
  const ndResidency = (nd.nationality || '').trim().toUpperCase() === 'SINGAPORE CITIZEN' ? 'SINGAPORE CITIZEN' : 'PERMANENT RESIDENT';

  const data: Record<string, string> = {
    ...baseData(input),
    ND_name: nd.name.trim().toUpperCase(),
    nominee_director_name: nd.name.trim().toUpperCase(),
    nominee_director_full_name: nd.name.trim().toUpperCase(),
    ND_id_type: (nd.identificationType || '').trim(),
    ND_identification_number: (nd.identificationNumber || '').trim().toUpperCase(),
    ND_address: (nd.address || '').trim(),
    ND_residency_status: ndResidency,
    director_id_type: (chairman?.identificationType || '').trim(),
    director_identification_number: (chairman?.identificationNumber || '').trim().toUpperCase(),
    director_address: (chairman?.address || '').trim(),
  };

  const shareholderItems = input.shareholders.filter(s => s.name.trim()).map(s => {
    const isCorp = s.identificationType.trim().toUpperCase() === 'UEN';
    const name = s.name.trim().toUpperCase();
    const corpRepName = (s.corpRepresentative || '').trim().toUpperCase();
    const displayName = isCorp
      ? (corpRepName ? `${corpRepName} (Corporate Representative of ${name})` : `Corporate Representative of ${name})`)
      : name;
    return {
      shareholder_name: name,
      shareholder_id_type: s.identificationType.trim(),
      shareholder_identification_type: s.identificationType.trim(),
      shareholder_identification_number: s.identificationNumber.trim().toUpperCase(),
      shareholder_identificaton_number: s.identificationNumber.trim().toUpperCase(),
      shareholder_address: s.address.trim(),
      shareholder_corprep_name: corpRepName,
      shareholder_corp_rep_name: corpRepName,
      shareholder_company_representative: corpRepName,
      shareholder_sign_type: isCorp ? "Signature of the Shareholder's representative" : 'Signature of the Shareholder',
      shareholder_sign_name: isCorp
        ? (corpRepName ? `${corpRepName} (Corporate Representative of ${name}` : `Corporate Representative of ${name}`)
        : name,
      shareholder_display_name: displayName,
    };
  });

  const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.ndAgreement);
  let xml = templateXml;
  xml = repeatSection(xml, 'shareholderlist', shareholderItems, data);
  xml = repeatSection(xml, 'shareholdersignature', shareholderItems, data);
  xml = replaceTextPattern(xml, CORP_REP_PHRASE_RE, '{{shareholder_display_name}}');
  xml = repeatSection(xml, 'shareholder', shareholderItems, data);
  xml = replaceAllPlaceholders(xml, data);
  xml = stripMarkerText(xml);
  return { filename: outputName(TEMPLATE_FILES.ndAgreement, { token: safeToken(input.company.name.trim().toUpperCase()) }), buffer: renderDoc(TEMPLATE_FILES.ndAgreement, xml) };
}

// --- 13 / 14: one pair per corporate (UEN) shareholder -------------------

function generateCorpRepresentativeDocs(input: PostIncorporateInput): GeneratedDoc[] {
  const data = baseData(input);
  const docs: GeneratedDoc[] = [];
  const corporateShareholders = input.shareholders.filter(s => s.name.trim() && s.identificationType.trim().toUpperCase() === 'UEN');

  for (const s of corporateShareholders) {
    const corpRepName = (s.corpRepresentative || '').trim().toUpperCase();
    const merged: Record<string, string> = {
      ...data,
      shareholder_name: s.name.trim().toUpperCase(),
      shareholder_id_type: s.identificationType.trim(),
      shareholder_identification_number: s.identificationNumber.trim().toUpperCase(),
      shareholder_identificaton_number: s.identificationNumber.trim().toUpperCase(),
      shareholder_address: s.address.trim(),
      shareholder_corprep_name: corpRepName,
      shareholder_corp_rep_name: corpRepName,
      shareholder_company_representative: corpRepName,
      corp_representative: corpRepName,
      corporate_representative: corpRepName,
      company_representative: corpRepName,
      shareholder_corprep_id_type: (s.corpRepIdType || '').trim(),
      shareholder_corp_rep_id_type: (s.corpRepIdType || '').trim(),
      shareholder_corprep_id_number: (s.corpRepIdNo || '').trim().toUpperCase(),
      shareholder_corp_rep_id_no: (s.corpRepIdNo || '').trim().toUpperCase(),
    };
    const directorNames = [...new Set((s.corporateDirectorNames || []).map(n => n.trim().toUpperCase()).filter(Boolean))];
    const token = safeToken(s.name.trim().toUpperCase());

    for (const key of ['certCorpRepresentative', 'appointmentCompanyRepresentative'] as const) {
      const { xml: templateXml } = loadTemplate(TEMPLATE_FILES[key]);
      let xml = pairRepeatSection(templateXml, 'signaturedirector', directorNames, 'director_name_1', 'director_name_2', merged);
      xml = replaceAllPlaceholders(xml, merged);
      xml = stripMarkerText(xml);
      docs.push({ filename: outputName(TEMPLATE_FILES[key], { token }), buffer: renderDoc(TEMPLATE_FILES[key], xml) });
    }
  }
  return docs;
}

// --- 16 / 17: only when at least one nominee director exists -------------

function generateNomineeDirectorDeclarations(input: PostIncorporateInput): GeneratedDoc[] {
  const nomineeDirectors = input.directors.filter(d => d.name.trim() && d.isNomineeDirector);
  if (!nomineeDirectors.length) return [];
  const data = { ...baseData(input) };
  const docs: GeneratedDoc[] = [];

  // 16: indnomdirector/corpnomdirector are TOP-LEVEL (not nested) in this
  // template — repeat each with only its matching-type items so the
  // non-matching branch disappears cleanly instead of rendering blank.
  {
    const items = nomineeDirectors.map(d => ({ ...data, ...nomineeDirectorItem(d) }));
    const indItems = items.filter(it => it.nominator_type === 'individual');
    const corpItems = items.filter(it => it.nominator_type === 'corporate entity');
    const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.localDirectorDeclarationRond);
    let xml = repeatSection(templateXml, 'indnomdirector', indItems, data);
    xml = repeatSection(xml, 'corpnomdirector', corpItems, data);
    xml = replaceAllPlaceholders(xml, { ...data, ND_name: nomineeDirectors[0].name.trim().toUpperCase(), nominee_director_name: nomineeDirectors[0].name.trim().toUpperCase() });
    xml = stripMarkerText(xml);
    docs.push({ filename: outputName(TEMPLATE_FILES.localDirectorDeclarationRond, 'strip'), buffer: renderDoc(TEMPLATE_FILES.localDirectorDeclarationRond, xml) });
  }

  // 17: single document using the first nominee director's own data.
  {
    const nd = nomineeDirectors[0];
    const merged = {
      ...data,
      director_name: nd.name.trim().toUpperCase(),
      director_address: nd.address.trim(),
      ...nomineeDirectorItem(nd),
      ND_name: nd.name.trim().toUpperCase(),
      ND_id_type: (nd.identificationType || '').trim(),
      ND_identification_number: (nd.identificationNumber || '').trim().toUpperCase(),
      ND_address: (nd.address || '').trim(),
    };
    const { xml: templateXml } = loadTemplate(TEMPLATE_FILES.ndFitProperDeclaration);
    const xml = stripMarkerText(replaceAllPlaceholders(templateXml, merged));
    docs.push({ filename: outputName(TEMPLATE_FILES.ndFitProperDeclaration, 'strip'), buffer: renderDoc(TEMPLATE_FILES.ndFitProperDeclaration, xml) });
  }

  return docs;
}

// --- top-level orchestration ----------------------------------------------

export function generatePostIncorporateDocuments(input: PostIncorporateInput): GeneratedDoc[] {
  const docs: GeneratedDoc[] = [];

  const readmeBuf = fs.readFileSync(path.join(TEMPLATE_DIR, TEMPLATE_FILES.readme));
  docs.push({ filename: TEMPLATE_FILES.readme, buffer: readmeBuf });

  docs.push(generateFirstBoardResolution(input));
  docs.push(...generateConsentDirector(input));
  docs.push(generateSecretaryAppointment(input));
  docs.push(...generateShareCertificates(input));
  docs.push(generateEngagementLetter(input));
  docs.push(generateRorcAuthorisation(input));
  docs.push(generateRorcDeclaration(input));
  docs.push(generateRondMaintenance(input));
  docs.push(generateRonsMaintenance(input));
  docs.push(...generateS156(input));

  const ndAgreement = generateNdAgreement(input);
  if (ndAgreement) docs.push(ndAgreement);

  docs.push(...generateCorpRepresentativeDocs(input));
  docs.push(...generateNomineeDirectorDeclarations(input));

  return docs;
}

// Re-exported for callers (e.g. the API route) that may want to sanity-check
// generated XML.
export { extractBodyChildren, blockText };
