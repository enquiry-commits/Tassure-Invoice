// Low-level OOXML (Word document.xml) manipulation helpers for the Post
// Incorporate document generator (lib/docx-post-incorporate.ts).
//
// Ported from the original desktop tool's approach (Operation_Docxs_Generator
// - Tassure V3.py), which used python-docx + lxml to: (1) replace {{field}}
// placeholders while preserving each text run's formatting, and (2) find
// [SECTION:name]...[ENDSECTION:name] marker pairs baked into the .docx
// templates themselves, then repeat/keep/drop the content between them based
// on real data (director lists, shareholder lists, conditional nominee-
// director clauses, paired signature blocks).
//
// Two things make this genuinely tricky, both confirmed against the real
// production templates (not assumed):
//
// 1. Word splits a paragraph's visible text across multiple <w:t> "run"
//    nodes wherever formatting changes (or for no visible reason at all).
//    A naive regex over the raw XML string will miss a placeholder or
//    marker that happens to be split mid-word across two runs. Every
//    function here that searches for text works by first concatenating all
//    <w:t> runs within a well-defined block into one string, matching
//    against THAT, then mapping the match back onto the original run
//    boundaries for replacement.
//
// 2. The markers are NOT scoped to a single paragraph/table-row containing
//    both [SECTION:x] and [ENDSECTION:x]. They are standalone marker
//    PARAGRAPHS, and the real repeatable/conditional content is the set of
//    TOP-LEVEL <w:body> children (whole paragraphs or whole tables) that sit
//    between them as siblings — exactly mirroring the original tool's
//    find_all_body_sections()/find_all_body_sections_any_marker(), which
//    walks doc._element.body's direct children. If no [ENDSECTION:x] exists
//    at all, the original falls back to "stop at the next block containing
//    any other [[SECTION:...]] marker, or end of document" — replicated
//    here identically.

type Block = { start: number; end: number; xml: string };

// A regex match for "<tag ...>" or "<tag .../>" or "</tag>" must never be
// confused with a DIFFERENT tag that happens to share the same prefix
// (<w:p vs <w:pPr, <w:tbl vs <w:tblPr, <w:tr vs <w:trPr) — the character
// right after the tag name must be '>', whitespace, or '/' (self-close).
function isGenuineTagStart(xml: string, tag: string, idx: number): boolean {
  const after = xml[idx + 1 + tag.length];
  return after === '>' || after === '/' || after === ' ' || after === '\t' || after === '\n' || after === '\r';
}

// Depth-tracking scan for ONE tag name, starting from a position already
// confirmed to be a genuine open (or self-closing) tag for it. Correctly
// treats "<tag .../>" as a zero-content block that never needs a closing
// tag — the bug that silently truncated the entire scan whenever a real
// template's empty "<w:p/>" self-closed paragraph was mistaken for an open
// tag awaiting a "</w:p>" that could only belong to some later, unrelated
// paragraph (desyncing the depth counter until the scan ran out of closing
// tags and gave up partway through the document).
function extractSingleBalancedBlockAt(xml: string, tag: string, startIdx: number): Block | null {
  const tokenRe = new RegExp(`<${tag}(?:\\s[^>]*)?/?>|</${tag}>`, 'g');
  tokenRe.lastIndex = startIdx;
  const openMatch = tokenRe.exec(xml);
  if (!openMatch || openMatch.index !== startIdx) return null;
  if (openMatch[0].endsWith('/>')) {
    return { start: startIdx, end: startIdx + openMatch[0].length, xml: openMatch[0] };
  }
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml))) {
    const token = m[0];
    if (token.startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        const end = m.index + token.length;
        return { start: startIdx, end, xml: xml.slice(startIdx, end) };
      }
    } else if (!token.endsWith('/>')) {
      depth += 1;
    }
    // self-closing occurrence of the same tag while already inside an open
    // block of it (e.g. a nested table's own self-closed empty paragraph)
    // — doesn't change depth, nothing to do.
  }
  return null; // unbalanced — stop rather than corrupt the doc
}

function extractBalancedBlocks(xml: string, tag: string): Block[] {
  const blocks: Block[] = [];
  const needle = `<${tag}`;
  let pos = 0;
  while (pos < xml.length) {
    const idx = xml.indexOf(needle, pos);
    if (idx === -1) break;
    if (!isGenuineTagStart(xml, tag, idx)) { pos = idx + 1; continue; }
    const block = extractSingleBalancedBlockAt(xml, tag, idx);
    if (!block) { pos = idx + 1; continue; }
    blocks.push(block);
    pos = block.end;
  }
  return blocks;
}

export function extractParagraphs(xml: string): Block[] {
  return extractBalancedBlocks(xml, 'w:p');
}

export function extractTableRows(xml: string): Block[] {
  return extractBalancedBlocks(xml, 'w:tr');
}

// Direct children of <w:body> only (whole <w:p> or whole <w:tbl>, each as
// one opaque unit — never descending into a table's internals). This is the
// granularity the original tool's marker system actually operates at: a
// [SECTION:x] marker paragraph and its [ENDSECTION:x] counterpart are
// siblings here, with the real content (often an entire table) sitting
// between them as further siblings.
export function extractBodyChildren(xml: string): (Block & { tag: 'w:p' | 'w:tbl' })[] {
  const bodyOpenMatch = /<w:body(?:\s[^>]*)?>/.exec(xml);
  const bodyCloseIdx = xml.lastIndexOf('</w:body>');
  if (!bodyOpenMatch || bodyCloseIdx === -1) return [];
  const bodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const children: (Block & { tag: 'w:p' | 'w:tbl' })[] = [];
  const candidateTags: ('w:tbl' | 'w:p')[] = ['w:tbl', 'w:p'];
  let pos = bodyStart;
  while (pos < bodyCloseIdx) {
    let earliestRaw = -1;
    let genuine: { tag: 'w:tbl' | 'w:p'; idx: number } | null = null;
    for (const tag of candidateTags) {
      const idx = xml.indexOf(`<${tag}`, pos);
      if (idx === -1 || idx >= bodyCloseIdx) continue;
      if (earliestRaw === -1 || idx < earliestRaw) earliestRaw = idx;
      if (isGenuineTagStart(xml, tag, idx) && (!genuine || idx < genuine.idx)) genuine = { tag, idx };
    }
    if (earliestRaw === -1) break;
    if (!genuine || genuine.idx !== earliestRaw) { pos = earliestRaw + 1; continue; }
    const block = extractSingleBalancedBlockAt(xml, genuine.tag, genuine.idx);
    if (!block) { pos = genuine.idx + 1; continue; }
    children.push({ tag: genuine.tag, ...block });
    pos = block.end;
  }
  return children;
}

// Concatenated plain text of every <w:t> run inside a block, in document
// order — this is what a human reading the rendered paragraph/table
// actually sees, independent of run-splitting.
export function blockText(blockXml: string): string {
  return [...blockXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Applies a list of (start, end, replacementText) edits — offsets measured
// against the block's CONCATENATED <w:t> run text — to a single block,
// correctly handling matches that straddle multiple runs (the replacement
// text lands on the first touched run; every other touched run just has its
// overlapping range deleted) and never mutating an already-processed span,
// since every offset is computed against the immutable original runs.
// Shared by placeholder substitution and marker-text stripping so both get
// the same run-splitting safety.
function editBlockText(blockXml: string, edits: { start: number; end: number; text: string }[]): string {
  if (!edits.length) return blockXml;
  const runs = [...blockXml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
  if (!runs.length) return blockXml;

  const spans: { runStart: number; runEnd: number; text: string }[] = [];
  let pos = 0;
  for (const r of runs) {
    spans.push({ runStart: pos, runEnd: pos + r[2].length, text: r[2] });
    pos += r[2].length;
  }

  const editsByRun: Map<number, { localStart: number; localEnd: number; text: string }[]> = new Map();
  for (const edit of edits) {
    const { start, end, text: replacement } = edit;
    let isFirstTouchedRun = true;
    spans.forEach((s, i) => {
      if (s.runStart >= end || s.runEnd <= start) return; // no overlap
      const localStart = Math.max(start, s.runStart) - s.runStart;
      const localEnd = Math.min(end, s.runEnd) - s.runStart;
      const list = editsByRun.get(i) ?? [];
      list.push({ localStart, localEnd, text: isFirstTouchedRun ? replacement : '' });
      editsByRun.set(i, list);
      isFirstTouchedRun = false;
    });
  }

  const newRunText = spans.map((s, i) => {
    const runEdits = editsByRun.get(i);
    if (!runEdits) return s.text;
    runEdits.sort((a, b) => b.localStart - a.localStart);
    let text = s.text;
    for (const e of runEdits) text = text.slice(0, e.localStart) + e.text + text.slice(e.localEnd);
    return text;
  });

  let result = blockXml;
  // Rebuild from the END of the block backward using each run's own match
  // position/length in the ORIGINAL blockXml string (runs[i].index, from the
  // matchAll pass above) — not a text search — so a block containing two
  // byte-identical <w:t> runs (e.g. two empty runs) can never have its
  // replacement land on the wrong one.
  for (let i = runs.length - 1; i >= 0; i--) {
    const original = runs[i][0];
    const attrs = runs[i][1];
    const value = newRunText[i];
    if (value === spans[i].text) continue; // unchanged — leave the original tag byte-for-byte
    const needsPreserve = value.length > 0 && /^\s|\s$/.test(value);
    const hasPreserve = /xml:space="preserve"/.test(attrs);
    const newAttrs = needsPreserve && !hasPreserve ? `${attrs} xml:space="preserve"` : attrs;
    const replacementTag = `<w:t${newAttrs}>${escapeXmlText(value)}</w:t>`;
    const idx = runs[i].index!;
    result = result.slice(0, idx) + replacementTag + result.slice(idx + original.length);
  }
  return result;
}

// Replaces {{field}} occurrences inside one block's <w:t> runs, preserving
// every run's own formatting (rPr). Unknown/unresolved keys are left as
// literal "{{key}}" text (visible on purpose, matching lib/email-merge.ts's
// existing convention) rather than silently blanked, so a missing field is
// obvious in the generated document rather than silently disappearing.
export function replacePlaceholdersInBlock(blockXml: string, data: Record<string, string>): string {
  const runs = [...blockXml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
  if (!runs.length) return blockXml;
  const fullText = runs.map(r => r[2]).join('');
  if (!fullText.includes('{{')) return blockXml;
  const matches = [...fullText.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  if (!matches.length) return blockXml;
  const edits = matches.map(m => {
    const key = m[1].trim();
    const replacement = Object.prototype.hasOwnProperty.call(data, key) ? String(data[key] ?? '') : m[0];
    return { start: m.index!, end: m.index! + m[0].length, text: replacement };
  });
  return editBlockText(blockXml, edits);
}

// Applies replacePlaceholdersInBlock across every <w:p> in a whole XML
// fragment (a full document.xml, header/footer, or a smaller extracted
// fragment such as one repeated section's content). Use for the final,
// plain substitution pass after all [SECTION:...] handling is done.
export function replaceAllPlaceholders(xml: string, data: Record<string, string>): string {
  const paragraphs = extractParagraphs(xml);
  let result = xml;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    const replaced = replacePlaceholdersInBlock(p.xml, data);
    if (replaced !== p.xml) {
      result = result.slice(0, p.start) + replaced + result.slice(p.end);
    }
  }
  return result;
}

function stripMarkerTextFromBlock(blockXml: string): string {
  const runs = [...blockXml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
  if (!runs.length) return blockXml;
  const fullText = runs.map(r => r[2]).join('');
  if (!/\[\[?(?:END)?SECTION:/i.test(fullText)) return blockXml;
  const matches = [...fullText.matchAll(/\[\[?(?:END)?SECTION:\s*[^\]]*?\s*\]\]?/gi)];
  if (!matches.length) return blockXml;
  const edits = matches.map(m => ({ start: m.index!, end: m.index! + m[0].length, text: '' }));
  return editBlockText(blockXml, edits);
}

// Strips the literal [SECTION:name]/[ENDSECTION:name] marker TEXT (and
// nothing else) out of every paragraph within an XML fragment — a single
// paragraph, or a multi-paragraph/whole-table section content blob — used
// when a section is being kept as-is (condition true) or after a section
// has been duplicated per-item (the markers themselves are never meant to
// appear in the final document). Cross-run-safe: a marker split across
// multiple <w:t> runs (e.g. "[SECTION:" + "appointND" + "]" as three
// separate runs, confirmed to occur in real templates) is still fully
// removed, via the same run-splitting-aware editBlockText used for
// placeholders.
export function stripMarkerText(xml: string): string {
  const paragraphs = extractParagraphs(xml);
  if (!paragraphs.length) return stripMarkerTextFromBlock(xml);
  let result = xml;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    const replaced = stripMarkerTextFromBlock(p.xml);
    if (replaced !== p.xml) result = result.slice(0, p.start) + replaced + result.slice(p.end);
  }
  return result;
}

// Cross-run-safe find/replace of an arbitrary text pattern (not just
// {{placeholder}} or [SECTION:...] syntax) within every paragraph of an XML
// fragment. `pattern` must have the 'g' flag. Reuses the same run-splitting
// safety as replacePlaceholdersInBlock/stripMarkerText — a naive
// xml.replace(pattern, ...) on the raw XML string would silently fail
// whenever the matched text happens to be split across multiple <w:t> runs
// (which real templates do constantly), so this always goes through
// editBlockText instead.
export function replaceTextPattern(xml: string, pattern: RegExp, replacement: string | ((match: RegExpMatchArray) => string)): string {
  const paragraphs = extractParagraphs(xml);
  let result = xml;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    const runs = [...p.xml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
    if (!runs.length) continue;
    const fullText = runs.map(r => r[2]).join('');
    const matches = [...fullText.matchAll(pattern)];
    if (!matches.length) continue;
    const edits = matches.map(m => ({
      start: m.index!,
      end: m.index! + m[0].length,
      text: typeof replacement === 'function' ? replacement(m) : replacement,
    }));
    const replacedBlock = editBlockText(p.xml, edits);
    if (replacedBlock !== p.xml) result = result.slice(0, p.start) + replacedBlock + result.slice(p.end);
  }
  return result;
}

export type MarkerSection = {
  removeStart: number;
  removeEnd: number;
  contentBlocks: Block[];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerRegexes(name: string) {
  const escaped = escapeRegExp(name);
  return {
    start: new RegExp(`\\[\\[?SECTION:\\s*${escaped}\\s*\\]\\]?`, 'i'),
    end: new RegExp(`\\[\\[?ENDSECTION:\\s*${escaped}\\s*\\]\\]?`, 'i'),
    // Any OTHER section marker (start or end, any name) — used as the
    // fallback boundary when a [SECTION:x] has no matching [ENDSECTION:x]
    // anywhere in the document, exactly mirroring the original tool's
    // find_all_body_sections_any_marker() fallback.
    anyMarker: /\[\[?(?:END)?SECTION:\s*[^\]\[]+?\s*\]\]?/i,
  };
}

// Finds a [SECTION:name] ... [ENDSECTION:name] pair (also tolerating the
// template's occasional [[SECTION:name]] / [[ENDSECTION:name]] double-
// bracket variant) at TOP-LEVEL <w:body> CHILD granularity — a whole
// paragraph or a whole table, exactly like the original desktop tool's
// find_all_body_sections()/find_all_body_sections_any_marker(). If no
// explicit [ENDSECTION:name] exists anywhere after the start marker, falls
// back to treating the next body child that contains ANY other section
// marker as the boundary (not included), or the end of the document if
// there is none — replicating the original's exact fallback behavior for
// markers like [[SECTION:signaturedirector]] that in some templates are
// only closed implicitly by the next marker.
export function findSection(xml: string, name: string): MarkerSection | null {
  const children = extractBodyChildren(xml);
  const { start: startRe, end: endRe, anyMarker } = markerRegexes(name);

  for (let i = 0; i < children.length; i++) {
    const text = blockText(children[i].xml);
    if (!startRe.test(text)) continue;
    const startIdx = i;

    if (endRe.test(text)) {
      return { removeStart: children[startIdx].start, removeEnd: children[startIdx].end, contentBlocks: [children[startIdx]] };
    }

    for (let j = startIdx + 1; j < children.length; j++) {
      if (endRe.test(blockText(children[j].xml))) {
        return {
          removeStart: children[startIdx].start,
          removeEnd: children[j].end,
          contentBlocks: children.slice(startIdx + 1, j),
        };
      }
    }

    let fallbackEnd = children.length;
    for (let j = startIdx + 1; j < children.length; j++) {
      const tj = blockText(children[j].xml);
      if (anyMarker.test(tj) && !startRe.test(tj)) { fallbackEnd = j; break; }
    }
    return {
      removeStart: children[startIdx].start,
      removeEnd: fallbackEnd < children.length ? children[fallbackEnd].start : children[children.length - 1].end,
      contentBlocks: children.slice(startIdx + 1, fallbackEnd),
    };
  }
  return null;
}

function sectionContentXml(section: MarkerSection): string {
  return section.contentBlocks.map(b => b.xml).join('');
}

// Removes every <w:tr> in a table-shaped XML fragment whose visible text
// (whitespace-normalized, lowercased) satisfies `predicate` — used for the
// "repeat a table's data row per item but keep the header row only once"
// pattern (template 01 First Board Resolution's [SECTION:shareholderlist]),
// mirroring the original tool's
// remove_post_incorporate_shareholder_header_from_xml exactly.
function removeMatchingTableRows(xml: string, predicate: (normalizedRowText: string) => boolean): string {
  const rows = extractTableRows(xml);
  let result = xml;
  for (let i = rows.length - 1; i >= 0; i--) {
    const normalized = blockText(rows[i].xml).replace(/\s+/g, ' ').trim().toLowerCase();
    if (predicate(normalized)) {
      result = result.slice(0, rows[i].start) + result.slice(rows[i].end);
    }
  }
  return result;
}

// Repeats the section's content once per item in `items`, substituting
// {{field}} in each copy from `{ ...baseData, ...item }`. Markers are
// stripped from every generated copy. If `items` is empty, the whole
// section (including its markers) is removed — an empty repeating list
// renders as nothing, not as a lone empty template row.
//
// `dropHeaderRowAfterFirst`: optional predicate identifying a table header
// row (by its normalized text) that should be removed from every copy AFTER
// the first — for sections whose content is a whole table with one header
// row + one repeatable data row (e.g. shareholderlist), so N items render
// as one continuous-looking table instead of N full header+data tables.
export function repeatSection(
  xml: string,
  name: string,
  items: Record<string, string>[],
  baseData: Record<string, string>,
  opts?: { dropHeaderRowAfterFirst?: (normalizedRowText: string) => boolean },
): string {
  const section = findSection(xml, name);
  if (!section) return xml;
  const contentXml = sectionContentXml(section);
  const pieces = items.map((item, idx) => {
    const merged = { ...baseData, ...item };
    let piece = stripMarkerText(contentXml);
    if (idx > 0 && opts?.dropHeaderRowAfterFirst) {
      piece = removeMatchingTableRows(piece, opts.dropHeaderRowAfterFirst);
    }
    return replaceAllPlaceholders(piece, merged);
  });
  return xml.slice(0, section.removeStart) + pieces.join('') + xml.slice(section.removeEnd);
}

// Repeats the section once per PAIR of items from `names` (e.g. two
// directors sharing one two-column signature table), filling `key1`/`key2`
// with each pair's values (the second is blank for a trailing odd one out).
// Mirrors the original tool's process_agm_pair_signature_section.
export function pairRepeatSection(xml: string, name: string, names: string[], key1: string, key2: string, baseData: Record<string, string>): string {
  const section = findSection(xml, name);
  if (!section) return xml;
  const contentXml = sectionContentXml(section);
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (!clean.length) return xml.slice(0, section.removeStart) + xml.slice(section.removeEnd);
  const pairs: string[][] = [];
  for (let i = 0; i < clean.length; i += 2) pairs.push([clean[i], clean[i + 1] ?? '']);
  const pieces = pairs.map(([a, b]) => {
    const merged = { ...baseData, [key1]: a, [key2]: b };
    return replaceAllPlaceholders(stripMarkerText(contentXml), merged);
  });
  return xml.slice(0, section.removeStart) + pieces.join('') + xml.slice(section.removeEnd);
}

// Keeps the section (markers stripped, content preserved) when `keep` is
// true; removes the whole block (markers AND content) when false. Use for
// a single conditional clause, e.g. "only show this paragraph if the
// company needs Nominee Director service". Deliberately does NOT fill
// {{field}} placeholders itself — unlike repeatSection/pairRepeatSection,
// keepSectionIf never needs a different value per call site, so filling its
// content is left to the caller's single, mandatory, whole-document
// replaceAllPlaceholders() pass (which also fills every other unconditional
// paragraph). A per-call optional baseData param here would be a footgun:
// forgetting to pass it silently leaves that section's placeholders
// unresolved while everything else in the document fills in correctly.
export function keepSectionIf(xml: string, name: string, keep: boolean): string {
  const section = findSection(xml, name);
  if (!section) return xml;
  if (!keep) return xml.slice(0, section.removeStart) + xml.slice(section.removeEnd);
  const content = stripMarkerText(sectionContentXml(section));
  return xml.slice(0, section.removeStart) + content + xml.slice(section.removeEnd);
}

// Picks exactly one of two mutually-exclusive named sections (e.g.
// "havenomineedir" vs "nothavenomineedir") — the chosen one is kept
// (markers stripped), the other is removed entirely. Order-independent: it
// re-locates each section fresh after the first removal so offsets never
// go stale. Placeholder filling: see keepSectionIf above.
export function chooseSection(xml: string, chooseName: string, dropName: string): string {
  let result = keepSectionIf(xml, dropName, false);
  result = keepSectionIf(result, chooseName, true);
  return result;
}
