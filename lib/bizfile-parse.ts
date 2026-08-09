// Parses an ACRA Bizfile "Business Profile (Company)" PDF into structured
// Company/Officer/Shareholder data — the real, official registry extract,
// used as the primary Post Incorporate auto-fill source (richer and more
// authoritative than the TeamWork-synced snapshot: it has Company Type,
// Primary/Secondary Activity, and both Issued and Paid-Up Share Capital,
// none of which TeamWork's officials page carries).
//
// Targets the current (2025+) ACRA Bizfile layout specifically, not every
// historical variant — confirmed against a real sample ("A PLUS MANPOWER
// SERVICES PTE. LTD.", 2025-11-28).
//
// The Officer(s)/Shareholder(s) tables have no drawn grid lines (pdf-parse's
// own getTable() finds nothing), and each row's Address/Nationality wraps
// across a variable number of lines depending on length — so linearized
// text (pdf-parse's getText()) loses the row structure and a first attempt
// at parsing it with line-wrap heuristics produced genuinely wrong data
// (an address fragment ending up in the Name field). Rebuilt on pdfjs-dist's
// raw per-item (x, y) positions instead: every text run on the page keeps
// its real column (x) and row (y) position, so a record's Name/Address/ID/
// Nationality/Position/Date fields can be reconstructed by (a) using the ID
// number's Y position as that record's row-start (an ID number appears
// exactly once per person, in a fixed column, and is a reliable anchor
// shape), then (b) bucketing every item between this row-start and the next
// by which header column's X range it falls under, then (c) joining each
// bucket's items top-to-bottom. This is robust to however many lines any
// individual field wraps into, since it never depends on guessing where a
// wrap boundary is from the text alone.

type Item = { str: string; x: number; y: number };

export type ParsedOfficer = {
  name: string; address: string; idNo: string; nationality: string; position: string; dateOfAppointment: string;
};
export type ParsedShareholder = {
  name: string; address: string; idNo: string; nationality: string;
  numberOfShares: string; shareType: string; currency: string;
};
export type CapitalInfo = { amount: string; numberOfShares: string; currency: string; shareType: string };
export type ParsedCompany = {
  name: string; uen: string; incorporationDate: string; companyType: string;
  registeredAddress: string; primaryActivity: string; secondaryActivity: string;
  issuedShareCapital: CapitalInfo; paidUpCapital: CapitalInfo;
};
export type ParsedBizfile = { company: ParsedCompany; officers: ParsedOfficer[]; shareholders: ParsedShareholder[] };

// --- page 1: simple "Label\t:value" text, line-based parsing is reliable here ---

function normalizeText(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (/^ACCOUNTING AND CORPORATE REGULATORY AUTHORITY$/i.test(t)) return false;
      if (/^\(ACRA\)$/i.test(t)) return false;
      if (/^Whilst every endeavor/i.test(t)) return false;
      if (/^liability for any damage/i.test(t)) return false;
      if (/^Business Profile \(Company\) of/i.test(t)) return false;
      if (/PTE\. LTD\. \([0-9A-Z]+\)\s*Date:/i.test(t)) return false;
      if (/^Page \d+ of \d+$/i.test(t)) return false;
      if (/^Verify Document Instantly$/i.test(t)) return false;
      if (/^Check if this document is issued$/i.test(t)) return false;
      if (/^by ACRA\.$/i.test(t)) return false;
      if (/^https:\/\/www\.acratrustbar/i.test(t)) return false;
      if (/^erify\//i.test(t)) return false;
      return true;
    })
    .join('\n');
}

function labelValue(text: string, label: string): string {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\t:\\s*(.*)$`, 'm');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

// Primary/Secondary Activity can wrap onto a continuation line with no
// "Label\t:" prefix — detect this by checking whether the activity code's
// closing "(NNNNN)" is present yet; if not, the description continues onto
// the next line(s).
function labelValueActivity(lines: string[], label: string): string {
  const idx = lines.findIndex(l => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\t:`).test(l));
  if (idx === -1) return '';
  const parts = [lines[idx].replace(/^.*?\t:\s*/, '').trim()];
  let i = idx + 1;
  while (i < lines.length && !/\(\d+\)\s*$/.test(parts[parts.length - 1]) && !/\t:/.test(lines[i])) {
    parts.push(lines[i].trim());
    i++;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parseCapitalTable(text: string, heading: string): CapitalInfo {
  const idx = text.indexOf(heading);
  if (idx === -1) return { amount: '', numberOfShares: '', currency: '', shareType: '' };
  const after = text.slice(idx + heading.length).split('\n').map(l => l.trim()).filter(Boolean);
  const dataLine = after[1] || '';
  const cells = dataLine.split('\t').map(c => c.trim());
  return { amount: cells[0] || '', numberOfShares: cells[1] || '', currency: cells[2] || '', shareType: cells[3] || '' };
}

// --- page 3: Officer(s)/Shareholder(s) tables, coordinate-based ---

const ID_ANCHOR_RE = /^[A-Z0-9]{7,12}$/;
const NAME_COLUMN_MAX_X_GAP = 40; // items sharing the leftmost column, allowing for minor kerning drift

function groupItemsByColumn(items: Item[], columnStartXs: number[]): Item[][] {
  const sorted = [...columnStartXs].sort((a, b) => a - b);
  const buckets: Item[][] = sorted.map(() => []);
  for (const it of items) {
    let bucketIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (it.x >= sorted[i] - NAME_COLUMN_MAX_X_GAP) bucketIdx = i;
    }
    buckets[bucketIdx].push(it);
  }
  for (const bucket of buckets) bucket.sort((a, b) => b.y - a.y);
  return buckets;
}

function joinColumn(items: Item[]): string {
  return items.map(it => it.str.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Finds the X position of the FIRST item at or below `belowY` matching
// `label` exactly — "at or below" scopes the search to one specific
// section's header row, since a label like "Name" or "Nationality" appears
// once per table and a plain `.find()` would always grab the Officer(s)
// table's copy even when looking for the Shareholder(s) table's.
function findHeaderX(items: Item[], label: string, belowY: number, aboveY: number): number | null {
  const hit = items.find(it => it.str.trim() === label && it.y < belowY && it.y > aboveY);
  return hit ? hit.x : null;
}

// Slices the page's items down to one table's own vertical band — between
// its own section heading and the next one (or a sensible floor when it's
// the last table on the page) — so a later table's data (or the page
// footer/footnotes) can never bleed into an earlier table's last row, which
// has no "next row" to bound it otherwise.
function sectionBand(items: Item[], headingLabel: string, nextHeadingLabels: string[]): { top: number; bottom: number } | null {
  const heading = items.find(it => it.str.trim() === headingLabel);
  if (!heading) return null;
  let bottom = -Infinity;
  for (const nextLabel of nextHeadingLabels) {
    const next = items.find(it => it.str.trim().startsWith(nextLabel) && it.y < heading.y);
    if (next && next.y > bottom) bottom = next.y;
  }
  return { top: heading.y, bottom };
}

function extractOfficersFromItems(items: Item[]): ParsedOfficer[] {
  const band = sectionBand(items, 'Officer(s)', ['Shareholder(s)']);
  if (!band) return [];
  const nameX = findHeaderX(items, 'Name', band.top, band.bottom);
  const idX = findHeaderX(items, 'Identification', band.top, band.bottom);
  const natX = findHeaderX(items, 'Nationality/', band.top, band.bottom) ?? findHeaderX(items, 'Nationality', band.top, band.bottom);
  const posX = findHeaderX(items, 'Position', band.top, band.bottom);
  const dateX = findHeaderX(items, 'Date of', band.top, band.bottom);
  if (nameX == null || idX == null || natX == null || posX == null || dateX == null) return [];

  const headerY = items.find(it => it.str.trim() === 'Name' && it.y < band.top && it.y > band.bottom)!.y;
  const dataItems = items.filter(it => it.y < headerY - 5 && it.y > band.bottom && it.str.trim() && !/^\d$/.test(it.str.trim()));
  const idItems = dataItems.filter(it => it.x >= idX - NAME_COLUMN_MAX_X_GAP && it.x < natX - NAME_COLUMN_MAX_X_GAP && ID_ANCHOR_RE.test(it.str.trim()));
  const rowStartYs = [...new Set(idItems.map(it => it.y))].sort((a, b) => b - a);

  const officers: ParsedOfficer[] = [];
  for (let i = 0; i < rowStartYs.length; i++) {
    const topY = rowStartYs[i] + 2;
    const bottomY = i + 1 < rowStartYs.length ? rowStartYs[i + 1] + 2 : band.bottom;
    const rowItems = dataItems.filter(it => it.y <= topY && it.y > bottomY);
    const [nameCol, idCol, natCol, posCol, dateCol] = groupItemsByColumn(rowItems, [nameX, idX, natX, posX, dateX]);
    const nameLines = nameCol.sort((a, b) => b.y - a.y);
    officers.push({
      name: (nameLines[0]?.str || '').trim(),
      address: nameLines.slice(1).map(it => it.str.trim().replace(/,\s*$/, '')).filter(Boolean).join(', '),
      idNo: joinColumn(idCol),
      nationality: joinColumn(natCol),
      position: joinColumn(posCol),
      dateOfAppointment: joinColumn(dateCol),
    });
  }
  return officers;
}

function extractShareholdersFromItems(items: Item[]): ParsedShareholder[] {
  const band = sectionBand(items, 'Shareholder(s)', ['Includes nationality', 'Abbreviation']);
  if (!band) return [];
  const nameX = findHeaderX(items, 'Name', band.top, band.bottom);
  const idX = findHeaderX(items, 'Identification', band.top, band.bottom);
  const natX = findHeaderX(items, 'Nationality /', band.top, band.bottom) ?? findHeaderX(items, 'Nationality', band.top, band.bottom);
  const sharesX = findHeaderX(items, 'Number of', band.top, band.bottom);
  const changedHits = items.filter(it => it.str.trim() === 'Address' && it.y < band.top && it.y > band.bottom);
  const changedX = changedHits.length ? changedHits[changedHits.length - 1].x : null;
  if (nameX == null || idX == null || natX == null || sharesX == null) return [];

  const headerY = items.find(it => it.str.trim() === 'Name' && it.y < band.top && it.y > band.bottom)!.y;
  const dataItems = items.filter(it => it.y < headerY - 5 && it.y > band.bottom && it.str.trim() && !/^\d$/.test(it.str.trim()));
  const idItems = dataItems.filter(it => it.x >= idX - NAME_COLUMN_MAX_X_GAP && it.x < natX - NAME_COLUMN_MAX_X_GAP && ID_ANCHOR_RE.test(it.str.trim()));
  const rowStartYs = [...new Set(idItems.map(it => it.y))].sort((a, b) => b - a);

  const columnXs = [nameX, idX, natX, sharesX, ...(changedX != null ? [changedX] : [])];
  const shareholders: ParsedShareholder[] = [];
  for (let i = 0; i < rowStartYs.length; i++) {
    const topY = rowStartYs[i] + 2;
    const bottomY = i + 1 < rowStartYs.length ? rowStartYs[i + 1] + 2 : band.bottom;
    const rowItems = dataItems.filter(it => it.y <= topY && it.y > bottomY);
    const buckets = groupItemsByColumn(rowItems, columnXs);
    const [nameCol, idCol, natCol, sharesCol] = buckets;
    const nameLines = nameCol.sort((a, b) => b.y - a.y);
    const sharesText = joinColumn(sharesCol);
    const sharesMatch = /([\d,]+)\s*\(([A-Za-z]+)\)/.exec(sharesText);
    shareholders.push({
      name: (nameLines[0]?.str || '').trim(),
      address: nameLines.slice(1).map(it => it.str.trim().replace(/,\s*$/, '')).filter(Boolean).join(', '),
      idNo: joinColumn(idCol),
      nationality: joinColumn(natCol),
      numberOfShares: sharesMatch ? sharesMatch[1] : '',
      shareType: sharesMatch ? sharesMatch[2].toUpperCase() : '',
      currency: /SINGAPORE DOLLAR/i.test(sharesText) ? 'SGD' : (/SGD/i.test(sharesText) ? 'SGD' : ''),
    });
  }
  return shareholders;
}

export function parseBizfileText(rawText: string): { company: ParsedCompany } {
  const text = normalizeText(rawText);
  const lines = text.split('\n');
  const company: ParsedCompany = {
    name: labelValue(text, 'Name of Company'),
    uen: labelValue(text, 'UEN'),
    incorporationDate: labelValue(text, 'Incorporation Date'),
    companyType: labelValue(text, 'Company Type'),
    registeredAddress: labelValue(text, 'Registered Office Address'),
    primaryActivity: labelValueActivity(lines, 'Primary Activity').replace(/\s*\(\d+\)\s*$/, '').trim(),
    secondaryActivity: labelValueActivity(lines, 'Secondary Activity').replace(/\s*\(\d+\)\s*$/, '').trim(),
    issuedShareCapital: parseCapitalTable(text, 'Issued Share Capital'),
    paidUpCapital: parseCapitalTable(text, 'Paid-Up Capital'),
  };
  return { company };
}

export function parseBizfilePages(pageTexts: string[], pageItems: Item[][]): ParsedBizfile {
  const { company } = parseBizfileText(pageTexts.join('\n'));
  let officers: ParsedOfficer[] = [];
  let shareholders: ParsedShareholder[] = [];
  for (const items of pageItems) {
    const nonEmpty = items.filter(it => it.str.trim());
    if (nonEmpty.some(it => it.str.trim() === 'Officer(s)')) officers = extractOfficersFromItems(nonEmpty);
    if (nonEmpty.some(it => it.str.trim() === 'Shareholder(s)')) shareholders = extractShareholdersFromItems(nonEmpty);
  }
  return { company, officers, shareholders };
}

export type { Item as BizfilePageItem };

// Full pipeline: raw PDF bytes in, structured Company/Officer/Shareholder
// data out. Uses pdf-parse for the linearized per-page text (reliable for
// the simple "Label\t:value" page-1 fields) and pdfjs-dist directly for
// per-item (x, y) positions (needed for the Officer(s)/Shareholder(s)
// tables — see the module-level comment above for why).
export async function parseBizfilePdf(buffer: Buffer): Promise<ParsedBizfile> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let pageTexts: string[];
  try {
    const textResult = await parser.getText();
    pageTexts = textResult.pages.map(p => p.text);
  } finally {
    await parser.destroy();
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageItems: Item[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageItems.push(content.items.map((it) => {
      const item = it as { str: string; transform: number[] };
      return { str: item.str, x: item.transform[4], y: item.transform[5] };
    }));
  }

  return parseBizfilePages(pageTexts, pageItems);
}
