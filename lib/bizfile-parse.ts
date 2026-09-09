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

// The Capital table's Amount/Number of Shares/Currency/Share Type row can
// span more than one physical PDF line — the Currency name alone can be long
// enough to wrap ("UNITED STATES OF AMERICA DOLLAR", vs. the shorter
// "SINGAPORE DOLLAR" this was originally written against). The old code only
// ever read ONE line after the heading (`after[1]`) and split it by tab
// assuming exactly 4 cells, so a wrapped currency silently truncated
// mid-word and Share Type — which wrapped onto the next line along with it —
// came back empty.
//
// Fixed by reading forward across multiple lines as one continuous stream of
// whitespace-separated tokens rather than trusting a single line's tab
// boundaries — but a first version of this fix (reading up to 5 lines,
// stopping only at the next "Label\t:value" field or known section heading)
// was ALSO wrong: confirmed against the real Bizfile PDF (LAKEFILL VENTURES,
// 2026-09-09) that ACRA prints an explanatory footnote sentence directly
// below the table's own last row ("Number of Shares includes number of
// Treasury Shares" / "Company has the following Ordinary Shares held as
// Treasury Shares") — neither a `Label\t:` field nor a known heading, so
// that first version happily swallowed it as more cell data too (real
// symptom: Currency came back as "UNITED STATES OF AMERICA DOLLAR ORDINARY
// Number of Shares includes number of Treasury", Share Type as "Shares").
// Real cell values (however many lines the Currency name wraps across) are
// always ALL-CAPS ("UNITED STATES OF", "AMERICA DOLLAR", "ORDINARY" each on
// their own line in the real sample); the footnote sentence that follows
// always has lowercase connector words ("includes", "of", "the",
// "following"). That's the actual stop signal — checked from the second data
// line onward (the first is always numbers/tabs, never lowercase letters,
// so nothing has been collected yet for the length check to gate on).
//
// The first 2 tokens collected are Amount and Number of Shares (plain
// numbers, never wrap), the LAST token is the Share Type (a single word on
// every real sample seen so far — "ORDINARY"), and everything in between is
// the Currency name. A Share Type with its own multi-word qualifier (e.g.
// ACRA's "PREFERENCE (REDEEMABLE)") is a known remaining gap this doesn't
// handle — no worse than before, just not yet fixed; flag it if a real
// sample of one ever turns up.
const CAPITAL_TABLE_STOP_RE = /\t:|^(Issued Share Capital|Paid-Up Capital|Registered Office Address|Officer\(s\)|Shareholder\(s\))$/;

function parseCapitalTable(text: string, heading: string): CapitalInfo {
  const idx = text.indexOf(heading);
  if (idx === -1) return { amount: '', numberOfShares: '', currency: '', shareType: '' };
  const after = text.slice(idx + heading.length).split('\n').map(l => l.trim()).filter(Boolean);
  // after[0] is the column-header line ("Amount" / "Number of Shares" /
  // "Currency" / "Type"); real data starts at after[1].
  const dataLines: string[] = [];
  for (let i = 1; i < after.length && dataLines.length < 5; i++) {
    const line = after[i];
    if (CAPITAL_TABLE_STOP_RE.test(line)) break;
    if (dataLines.length > 0 && /[a-z]/.test(line)) break;
    dataLines.push(line);
  }
  const tokens = dataLines.join(' ').replace(/\t/g, ' ').split(/\s+/).filter(Boolean);
  const amount = tokens[0] || '';
  const numberOfShares = tokens[1] || '';
  const rest = tokens.slice(2);
  const shareType = rest.length ? rest[rest.length - 1] : '';
  const currency = rest.slice(0, -1).join(' ');
  return { amount, numberOfShares, currency, shareType };
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
    // A next-heading/footnote label can legitimately repeat on EVERY PDF
    // page a multi-page table spans — confirmed on a real 2-page
    // Shareholder(s) table (LAKEFILL VENTURES, 2026-09-09): "Includes
    // nationality and citizenship" is reprinted at the bottom of BOTH
    // pages, not just the true last one. Taking the FIRST match (as this
    // used to) anchors `bottom` to the FIRST page's own copy, which then
    // wrongly excludes every row on a later merged page (its Y, offset well
    // below the first page's, reads as "past the boundary"). The correct
    // bound is the LOWEST (smallest y — i.e. the one nearest the table's
    // real end) among every occurrence of this label.
    const matches = items.filter(it => it.str.trim().startsWith(nextLabel) && it.y < heading.y);
    if (!matches.length) continue;
    const lowestY = Math.min(...matches.map(it => it.y));
    // The footnote text this often anchors to ("Includes nationality and
    // citizenship", "Includes place of incorporation...") has its own
    // reference-number superscript ("²"/"³") floating ~4.5pt above it, same
    // offset as every other superscript on this page — without the same
    // buffer used for row boundaries, that stray digit sits just inside the
    // table's own band and gets read as trailing data on the LAST row
    // (confirmed in production: a real address ending in ", 2").
    if (lowestY + ROW_BOUNDARY_EPSILON > bottom) bottom = lowestY + ROW_BOUNDARY_EPSILON;
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

// The header row's OWN reference-number superscripts (e.g. "Number of
// Shares³") sit ~4.5pt above whichever of their column header's own text
// lines they're attached to — which is safely excluded by a fixed `Name`-Y
// - 5 buffer ONLY when the header block is a single line. Several of this
// table's own headers wrap onto a SECOND line ("Number of" / "Shares",
// "Identification" / "Number", "Nationality /" / "Place of origin") sitting
// well BELOW "Name"'s own Y — a superscript on one of those wrapped words
// can then sit BELOW `nameY - 5` and slip through as if it were real row
// data (confirmed in production: a real Currency value ended up with a
// stray "3" appended). The true bottom of the header block is the LOWEST Y
// among every column-header label actually present, not just "Name"'s own.
function headerBlockBottomY(items: Item[], band: { top: number; bottom: number }): number {
  const headerItems = items.filter(it => TABLE_HEADER_LABELS.has(it.str.trim()) && it.y < band.top && it.y > band.bottom);
  return Math.min(...headerItems.map(it => it.y));
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

  const headerY = headerBlockBottomY(items, band);
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

  // "Address" (the first word of the wrapped "Address Changed" column header)
  // appears TWICE in this table: once on the header's OWN TOP line (same Y
  // as "Name"/"Number of", the real "Address Changed" column this needs) and
  // again as the Name column's own sub-header two lines further down ("Name"
  // / "Address" stacked, like every other column here). Scoping to the
  // header's top-line Y disambiguates them — a plain first/last match picked
  // whichever happened to come first in the PDF's content-stream order,
  // which isn't guaranteed to be the header line and in production picked
  // the wrong one (confirmed: real "Number of Shares" data came back
  // corrupted with the neighboring "Address Changed" column's date glued
  // on, because nothing bounded the shares column's right edge without
  // this). This must stay anchored to the TOP line specifically — not the
  // header block's overall lowest line used for `dataUpperBoundY` below —
  // since "Address" only appears once, on that top line.
  const topHeaderY = items.find(it => it.str.trim() === 'Name' && it.y < band.top && it.y > band.bottom)!.y;
  const changedHit = items.find(it => it.str.trim() === 'Address' && Math.abs(it.y - topHeaderY) < 2);
  const changedX = changedHit ? changedHit.x : null;
  const dataUpperBoundY = headerBlockBottomY(items, band);
  const dataItems = items.filter(it => it.y < dataUpperBoundY - 5 && it.y > band.bottom && it.str.trim() && !isNomineeDirectorAnnotation(it.str));
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

// A Bizfile Officer(s)/Shareholder(s) table that doesn't fit on one PDF page
// continues onto the next page — confirmed against a real Bizfile (LAKEFILL
// VENTURES, 2026-09-09): its 5-shareholder table split 3 rows on the
// heading's own page and 2 rows on the page after, and the old per-page-only
// loop below only ever looked at the ONE page where the heading text itself
// appeared, silently discarding every row that spilled onto a continuation
// page — the rows it did find looked like a complete (if oddly small)
// result, not an obvious failure.
//
// Fixed by walking forward from the heading's own page and merging in every
// following page that REPEATS the exact same heading text — this is the one
// signal confirmed reliable on a real multi-page table: ACRA reprints
// "Shareholder(s)" (and its column headers, and even its closing "Includes
// nationality..." footnote) at the top/bottom of EVERY page that table
// spans, not just once. The walk stops as soon as a page does NOT repeat the
// heading — which correctly also covers the single-page case (Officer(s) on
// this same real document sat entirely on one page; the very next page
// starts a different section, 'Shareholder(s)', with no continuation at
// all — trying to use "does the NEXT page contain a DIFFERENT known
// section" as the stop signal instead was tried first and rejected: it
// wrongly walked into that next, unrelated page anyway).
//
// Each later page's Y is offset down by a fixed step far larger than any
// real page height, so the existing Y-based row/column logic (which only
// ever compares relative Y within one flat item list) keeps working
// unmodified across the page boundary — row 1 of page 2 sorts as "below" the
// last row of page 1, exactly like a row that wrapped within a single page
// already does. Every page's own repeated header/disclaimer block (printed
// at the TOP of every single Bizfile page, not just continuation ones —
// "ACCOUNTING AND CORPORATE REGULATORY AUTHORITY", "Business Profile
// (Company) of...", the document's own print date) and footer boilerplate
// are stripped from every page EXCEPT the section's own first/last page
// respectively — otherwise, once offset, that junk sorts as if it were more
// data for whichever real row sits nearest the page boundary (confirmed in
// production: a real director's ID/nationality/appointment-date fields got
// corrupted with fragments of the NEXT page's header block).
const HEADER_ITEM_PATTERNS = [
  /^ACCOUNTING AND CORPORATE REGULATORY AUTHORITY$/i,
  /^\(ACRA\)$/i,
  /^Whilst every endeavor/i,
  /^liability for any damage/i,
  /^Business Profile \(Company\) of/i,
  /^\([0-9]{8,10}[A-Z]\)$/, // the company's own UEN in parens, repeated under the header line above
  /^Date:\s*\d{1,2}\s+\w+\s+\d{4}$/i, // the header's own print date, e.g. "Date: 21 Aug 2026"
];
// ACRA ALSO reprints the table's own column-header row (Name/Address/
// Identification Number/Nationality/.../Currency/...) and the section
// heading itself at the top of every continuation page, immediately below
// the disclaimer block above — confirmed on the same real document: a
// shareholder whose row happened to be the last one on a non-final merged
// page had her address/ID/nationality/currency each end up with the NEXT
// page's repeated "Shareholder(s)"/"Name"/"Identification Number"/
// "Nationality / Place of origin"/"Currency" column labels appended, since
// nothing excluded them either. A small fixed, exact-match vocabulary — none
// of these words is a plausible genuine data value on their own — covers
// both tables' column headers plus the two section headings themselves.
// `findHeaderX`/`headerY` still work off the FIRST page's own (never
// stripped) copy, so removing the repeats elsewhere costs nothing real.
const TABLE_HEADER_LABELS = new Set([
  'Officer(s)', 'Shareholder(s)',
  'Name', 'Address', 'Identification', 'Number', 'Nationality/', 'Citizenship',
  'Position', 'Date of', 'Appointment',
  'Nationality /', 'Place of origin', 'Number of', 'Shares', 'Currency', 'Changed',
]);
// The Shareholder(s) table's own closing footnote ("Includes nationality
// and citizenship" / "Includes place of incorporation...") reprints at the
// bottom of EVERY page the table spans — same repeating-boilerplate
// behavior as the header/footer blocks above, but this one sits MID-page
// (right after that page's own last row), so — unlike header/footer, which
// only ever need stripping on non-first/non-last pages — this must be
// stripped from EVERY page: even the section's own first page has a real
// copy of it that isn't the table's true end when more pages follow.
// Confirmed on the real document: without this, the row immediately above a
// non-final page's own footnote got it appended to its address/currency.
// Both the footnote line AND the table's own column headers ("Number of
// Shares³") carry a bare 1-2-digit reference-number superscript floating
// ~4.5pt just above whichever line they annotate (the same superscript-
// offset pattern `ROW_BOUNDARY_EPSILON` already documents elsewhere in this
// file). On a single-page table `headerBlockBottomY`'s upper bound already
// excludes the header's own copy — but that bound is anchored to the
// FIRST page's header Y specifically, so it does nothing for a REPEATED
// header's own superscript reprinted on a later merged page (confirmed on
// the real document: a shareholder whose row was the last one on a
// non-final page ended up with the NEXT page's own "Number of Shares³"-
// style superscripts appended to her Currency value, well past where her
// own real row data ends). Stripped uniformly, on every page, gated
// tightly to "a bare short digit sitting within 10pt above a KNOWN
// footnote OR header-label line on this SAME page" so it can never remove
// a genuine short data value (e.g. a real 1-2 share count) anywhere else —
// the header LABEL text itself is left untouched here (still needed by
// `findHeaderX`/`headerBlockBottomY`); its own selective non-first-page
// removal happens separately, below.
const FOOTNOTE_ITEM_PATTERNS = [
  /^Includes nationality and citizenship$/i,
  /^Includes place of incorporation, place of origin and place of registration$/i,
];
function stripSuperscriptNoise(items: Item[]): Item[] {
  const anchorYs = items
    .filter(it => {
      const s = it.str.trim();
      return FOOTNOTE_ITEM_PATTERNS.some(re => re.test(s)) || TABLE_HEADER_LABELS.has(s);
    })
    .map(it => it.y);
  if (!anchorYs.length) return items;
  return items.filter(it => {
    const s = it.str.trim();
    if (FOOTNOTE_ITEM_PATTERNS.some(re => re.test(s))) return false;
    if (/^\d{1,2}$/.test(s) && anchorYs.some(ay => it.y > ay && it.y <= ay + 10)) return false;
    return true;
  });
}
const PAGE_Y_STEP = 100000;

function collectSectionItems(pageItems: Item[][], heading: string): Item[] {
  const startPage = pageItems.findIndex(items => items.some(it => it.str.trim() === heading));
  if (startPage === -1) return [];

  let endPage = startPage;
  for (let p = startPage + 1; p < pageItems.length; p++) {
    if (!pageItems[p].some(it => it.str.trim() === heading)) break;
    endPage = p;
  }

  const merged: Item[] = [];
  for (let p = startPage; p <= endPage; p++) {
    const isFirstPage = p === startPage;
    const isLastPage = p === endPage;
    const offset = (p - startPage) * PAGE_Y_STEP;
    for (const it of stripSuperscriptNoise(pageItems[p])) {
      const s = it.str.trim();
      if (!s) continue;
      if (!isFirstPage && HEADER_ITEM_PATTERNS.some(re => re.test(s))) continue;
      if (!isFirstPage && TABLE_HEADER_LABELS.has(s)) continue;
      if (!isLastPage && FOOTER_ITEM_PATTERNS.some(re => re.test(s))) continue;
      merged.push({ str: it.str, x: it.x, y: it.y - offset });
    }
  }
  return merged;
}

export function parseBizfilePages(pageTexts: string[], pageItems: Item[][]): ParsedBizfile {
  const { company } = parseBizfileText(pageTexts.join('\n'));
  const officers = extractOfficersFromItems(collectSectionItems(pageItems, 'Officer(s)'));
  const shareholders = extractShareholdersFromItems(collectSectionItems(pageItems, 'Shareholder(s)'));
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
