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
  // ACRA's own "ND" superscript next to a director's name on the Bizfile
  // extract — a real, authoritative signal in its own right (the official
  // registry filing), not something to defer entirely to Tassure's separate
  // nd_appointments roster. Both are checked; either one marks a director as
  // nominee (Vincent: "ZHANG LIN那边都有标记他是ND了...是否为名义董事那边是YES").
  isNomineeDirector: boolean;
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
  const firstValue = lines[idx].replace(/^.*?\t:\s*/, '').trim();
  // Secondary Activity is routinely blank on a real Bizfile. Without this
  // guard an empty first value still enters the continuation loop below
  // (empty string doesn't match the "(NNNNN)" end pattern either), so it
  // keeps swallowing whatever unrelated lines come next looking for a
  // continuation that was never there.
  if (!firstValue) return '';
  const parts = [firstValue];
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

// A row's own boundary used to be "its ID anchor's Y + 2" — a fixed 2pt
// buffer meant to catch the row's own Name/ID/Nationality items, which sit
// at very nearly the same Y as the ID anchor itself. Measured against a
// real sample (1V Capital): a superscript annotation next to a name (ACRA's
// "ND" nominee-director marker) sits ~4.5pt above its own row's baseline —
// enough to cross the old +2 threshold and get misattributed to the
// PREVIOUS row instead, appended onto that person's address. Widening the
// buffer to 8pt covers that with margin while staying well clear of a
// genuine wrapped address line in the row ABOVE (measured ~12-15pt of line
// spacing in the same sample) — the two failure modes need buffers on
// opposite sides of that gap, and 8 sits between them. This same buffer
// also turns out to correctly exclude row 0's own multi-line column headers
// ("Name"/"Address", "Identification"/"Number", "Date of"/"Appointment" —
// every header wraps onto 2-3 stacked lines, tightly spaced, ending well
// more than 8pt above the first real row) without needing any special case
// for row 0 at all.
const ROW_BOUNDARY_EPSILON = 8;
function rowBoundaryTop(rowStartYs: number[], i: number): number {
  return rowStartYs[i] + ROW_BOUNDARY_EPSILON;
}
function rowBoundaryBottom(rowStartYs: number[], i: number, sectionBottom: number): number {
  return i + 1 < rowStartYs.length ? rowStartYs[i + 1] + ROW_BOUNDARY_EPSILON : sectionBottom;
}

// ACRA marks a nominee director with a bare "ND" superscript next to their
// name, plus a one-off "ND – Nominee Director" legend line after the table
// explaining it. The legend line is pure document-level noise (not tied to
// any one person) and always gets dropped. The bare "ND" marker itself is
// real signal though — the official registry's own nominee-director flag —
// so it's deliberately NOT filtered out here; extractOfficersFromItems
// captures it per-row instead (into ParsedOfficer.isNomineeDirector) rather
// than discarding it, since this system's Tassure-internal nd_appointments
// roster and ACRA's own filing can each know something the other doesn't.
function isNomineeDirectorLegend(str: string): boolean {
  return /^ND\s*[–-]\s*Nominee Director$/i.test(str.trim());
}
// Shareholders have no equivalent concept — ACRA doesn't mark a "nominee
// shareholder" with this notation — so both the marker and its legend are
// just noise there.
function isNomineeDirectorAnnotation(str: string): boolean {
  const s = str.trim();
  return s === 'ND' || isNomineeDirectorLegend(s);
}

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

// Boilerplate that appears at the bottom of every Bizfile page — mirrors
// normalizeText's line filters above, but matched against individual
// pdfjs-dist items (not joined lines), since the coordinate-based table
// extraction below never goes through normalizeText at all.
const FOOTER_ITEM_PATTERNS = [
  /^Page \d+ of \d+$/,
  /^Verify Document Instantly$/,
  /^Check if this document is issued$/,
  /^by ACRA\.$/,
  /^https:\/\/www\.acratrustbar/i,
  /^erify\//i,
];

// Y position of the topmost footer line on this page, if any — used as a
// floor so a table with no following section heading on the same page
// doesn't extend into the footer.
function footerTopY(items: Item[]): number | null {
  let top: number | null = null;
  for (const it of items) {
    const s = it.str.trim();
    if (s && FOOTER_ITEM_PATTERNS.some(re => re.test(s)) && (top == null || it.y > top)) top = it.y;
  }
  return top;
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
    // The footnote text this often anchors to ("Includes nationality and
    // citizenship", "Includes place of incorporation...") has its own
    // reference-number superscript ("²"/"³") floating ~4.5pt above it, same
    // offset as every other superscript on this page — without the same
    // buffer used for row boundaries, that stray digit sits just inside the
    // table's own band and gets read as trailing data on the LAST row
    // (confirmed in production: a real address ending in ", 2").
    if (next && next.y + ROW_BOUNDARY_EPSILON > bottom) bottom = next.y + ROW_BOUNDARY_EPSILON;
  }
  // No next section heading found on THIS page — either genuinely the last
  // table in the document, or this table's last few rows continue onto the
  // next PDF page. Either way, nothing bounds the row-extraction below from
  // running straight through the page footer (page number, the "Verify
  // Document Instantly" QR blurb, the verify URL) and gluing it onto the
  // last row's address/nationality — confirmed happening in production.
  if (bottom === -Infinity) {
    const footerY = footerTopY(items);
    if (footerY != null && footerY < heading.y) bottom = footerY;
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
  // Used to also drop any bare single digit here, meant to catch the
  // superscript footnote-reference numbers ACRA attaches to some column
  // headers (e.g. "Number of Shares³") — but that same filter also drops a
  // genuine single-digit share count ("1" share), which is a completely
  // ordinary real value, not a footnote marker (confirmed wrong in
  // production: a real 1-share holding came back with numberOfShares empty).
  // No longer needed: those footnote markers sit right at/above the header's
  // own Y, well above rowBoundaryTop's cutoff for row 0, so the row-boundary
  // check below already excludes them without also having to blacklist every
  // bare digit a real row might legitimately contain.
  const dataItems = items.filter(it => it.y < headerY - 5 && it.y > band.bottom && it.str.trim() && !isNomineeDirectorLegend(it.str));
  const idItems = dataItems.filter(it => it.x >= idX - NAME_COLUMN_MAX_X_GAP && it.x < natX - NAME_COLUMN_MAX_X_GAP && ID_ANCHOR_RE.test(it.str.trim()));
  const rowStartYs = [...new Set(idItems.map(it => it.y))].sort((a, b) => b - a);

  const officers: ParsedOfficer[] = [];
  for (let i = 0; i < rowStartYs.length; i++) {
    const topY = rowBoundaryTop(rowStartYs, i);
    const bottomY = rowBoundaryBottom(rowStartYs, i, band.bottom);
    const rowItems = dataItems.filter(it => it.y <= topY && it.y > bottomY);
    const [nameCol, idCol, natCol, posCol, dateCol] = groupItemsByColumn(rowItems, [nameX, idX, natX, posX, dateX]);
    // The bare "ND" marker (kept in dataItems above, unlike the legend line)
    // rides along in this same column as the name/address it annotates —
    // pull it out as a real signal instead of letting it become a stray
    // token in the name or address text.
    const isNomineeMarked = nameCol.some(it => it.str.trim() === 'ND');
    const nameLines = nameCol.filter(it => it.str.trim() !== 'ND').sort((a, b) => b.y - a.y);
    officers.push({
      name: (nameLines[0]?.str || '').trim(),
      address: nameLines.slice(1).map(it => it.str.trim().replace(/,\s*$/, '')).filter(Boolean).join(', '),
      idNo: joinColumn(idCol),
      nationality: joinColumn(natCol),
      position: joinColumn(posCol),
      dateOfAppointment: joinColumn(dateCol),
      isNomineeDirector: isNomineeMarked,
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
  if (nameX == null || idX == null || natX == null || sharesX == null) return [];

  const headerY = items.find(it => it.str.trim() === 'Name' && it.y < band.top && it.y > band.bottom)!.y;
  // "Address" (the first word of the wrapped "Address Changed" column header)
  // appears TWICE in this table: once on the header's own first line (same Y
  // as "Name"/"Number of", the real "Address Changed" column this needs) and
  // again as the Name column's own sub-header two lines further down ("Name"
  // / "Address" stacked, like every other column here). Scoping to headerY's
  // own Y disambiguates them — a plain first/last match picked whichever
  // happened to come first in the PDF's content-stream order, which isn't
  // guaranteed to be the header line and in production picked the wrong one
  // (confirmed: real "Number of Shares" data came back corrupted with the
  // neighboring "Address Changed" column's date glued on, because nothing
  // bounded the shares column's right edge without this).
  const changedHit = items.find(it => it.str.trim() === 'Address' && Math.abs(it.y - headerY) < 2);
  const changedX = changedHit ? changedHit.x : null;
  const dataItems = items.filter(it => it.y < headerY - 5 && it.y > band.bottom && it.str.trim() && !isNomineeDirectorAnnotation(it.str));
  const idItems = dataItems.filter(it => it.x >= idX - NAME_COLUMN_MAX_X_GAP && it.x < natX - NAME_COLUMN_MAX_X_GAP && ID_ANCHOR_RE.test(it.str.trim()));
  const rowStartYs = [...new Set(idItems.map(it => it.y))].sort((a, b) => b - a);

  const columnXs = [nameX, idX, natX, sharesX, ...(changedX != null ? [changedX] : [])];
  const shareholders: ParsedShareholder[] = [];
  for (let i = 0; i < rowStartYs.length; i++) {
    const topY = rowBoundaryTop(rowStartYs, i);
    const bottomY = rowBoundaryBottom(rowStartYs, i, band.bottom);
    const rowItems = dataItems.filter(it => it.y <= topY && it.y > bottomY);
    const buckets = groupItemsByColumn(rowItems, columnXs);
    const [nameCol, idCol, natCol, sharesCol] = buckets;
    const nameLines = nameCol.sort((a, b) => b.y - a.y);
    const sharesText = joinColumn(sharesCol);
    const sharesMatch = /([\d,]+)\s*\(([A-Za-z]+)\)/.exec(sharesText);
    // Whatever text follows "N (TYPE)" in this column is the currency's own
    // full name as printed on the Bizfile ("SINGAPORE DOLLAR", "CHINA YUAN
    // RENMINBI", ...) — previously hardcoded to only ever recognize
    // Singapore Dollar, so any other currency silently came back as an
    // empty string (confirmed wrong: a real CNY-denominated shareholding
    // showed blank here, and the frontend's own hardcoded "SINGAPORE
    // DOLLAR" label papered over it regardless of what the Bizfile said).
    const currency = sharesMatch
      ? sharesText.slice(sharesMatch.index + sharesMatch[0].length).replace(/\s+/g, ' ').trim()
      : '';
    shareholders.push({
      name: (nameLines[0]?.str || '').trim(),
      address: nameLines.slice(1).map(it => it.str.trim().replace(/,\s*$/, '')).filter(Boolean).join(', '),
      idNo: joinColumn(idCol),
      nationality: joinColumn(natCol),
      numberOfShares: sharesMatch ? sharesMatch[1] : '',
      shareType: sharesMatch ? sharesMatch[2].toUpperCase() : '',
      currency,
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
  // pdfjs-dist's legacy/Node build references the browser-only `DOMMatrix`
  // global at module-evaluation time (`const SCALE_MATRIX = new DOMMatrix()`
  // — runs unconditionally just from importing the module, before any of
  // our own code executes), and normally gets it from the optional
  // `@napi-rs/canvas` native addon. Confirmed via real production logs
  // (not guessed) that addon fails to load in the deployed bundle
  // ("Cannot find module '@napi-rs/canvas'"), which crashed every request
  // with "ReferenceError: DOMMatrix is not defined" — even though we only
  // ever call getTextContent(), never page.render(), so no actual canvas
  // drawing is needed. Every other DOMMatrix method pdfjs-dist calls
  // (preMultiplySelf, invertSelf, multiplySelf, etc.) lives exclusively in
  // the CanvasGraphics rendering path (confirmed by reading the bundled
  // source), which getTextContent() never reaches — so a real canvas/
  // native binary isn't needed, just something satisfying `new DOMMatrix()`
  // so the module can finish loading. Must run before pdf-parse is
  // imported too, since it uses pdfjs-dist internally for its own
  // getText() and would hit the same crash first otherwise.
  if (!('DOMMatrix' in globalThis)) {
    const { default: DOMMatrixPolyfill } = await import('dommatrix');
    (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }

  // pdfjs-dist (used both by pdf-parse internally and directly below)
  // normally spawns its worker by dynamically importing "./pdf.worker.mjs"
  // relative to its own bundled chunk — a path that only exists in
  // pdfjs-dist's own package layout, not in Next.js's bundled serverless
  // output, so that import fails there even though it resolves fine outside
  // a bundler ("Setting up fake worker failed", confirmed against the
  // actual dev server, not just guessed — this broke pdf-parse's own
  // getText() too, not only the direct pdfjs-dist usage below). pdf-parse
  // ships a `pdf-parse/worker` helper exactly for this (getPath()), but
  // that module's own top-level imports pull in @napi-rs/canvas (for an
  // unrelated screenshot feature this file never uses) — a native binary
  // addon whose Turbopack-bundled loading fails the same way. The worker
  // file itself sits right next to pdf-parse's own resolved entry point
  // (dist/pdf-parse/cjs/pdf.worker.mjs, confirmed on disk), so resolve that
  // directly instead of importing the canvas-coupled helper module.
  const path = await import('path');
  const { pathToFileURL } = await import('url');
  const { createRequire } = await import('module');
  const requireFromHere = createRequire(process.cwd() + '/package.json');
  const pdfParseEntry = requireFromHere.resolve('pdf-parse');
  const workerAbsPath = path.default.resolve(path.default.dirname(pdfParseEntry), 'pdf.worker.mjs');
  // pdfjs-dist's Node ESM loader requires a proper file:// URL for absolute
  // paths — a bare "C:\..." string isn't a valid URL scheme on Windows.
  const workerSrc = pathToFileURL(workerAbsPath).href;

  const { PDFParse } = await import('pdf-parse');
  PDFParse.setWorker(workerSrc);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let pageTexts: string[];
  try {
    const textResult = await parser.getText();
    pageTexts = textResult.pages.map(p => p.text);
  } finally {
    await parser.destroy();
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
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
