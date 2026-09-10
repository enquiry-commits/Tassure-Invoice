/**
 * THE single company-name normaliser + fuzzy matcher.
 *
 * Four divergent copies of these lived in the API routes and the billing page;
 * the drift (some stripped "(F.K.A. …)" clauses, some didn't; word-overlap
 * scores were on different scales) meant a renamed company could join in one
 * place and miss in another. Everything now imports from here.
 *
 * Memoised: these run millions of times per request when fuzzy-scanning
 * hundreds of QB customer names (see renewals route), and the regex pipeline
 * dominated CPU before caching.
 */
const normCache = new Map<string, string>();
export function normalize(name: string): string {
  const hit = normCache.get(name);
  if (hit !== undefined) return hit;
  const v = (name ?? '')
    .toLowerCase()
    .replace(/\(fka\b[^)]*\)/gi, '')
    .replace(/\(f\.k\.a\.[^)]*\)/gi, '')
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bsdn\.?\s*bhd\.?\b/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  normCache.set(name, v);
  return v;
}

const wordsCache = new Map<string, Set<string>>();
function wordsOf(normalized: string): Set<string> {
  let s = wordsCache.get(normalized);
  if (!s) {
    s = new Set(normalized.split(' ').filter(w => w.length > 1));
    wordsCache.set(normalized, s);
  }
  return s;
}

function coreScore(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const wa = wordsOf(na), wb = wordsOf(nb);
  if (!wa.size || !wb.size) return 0;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(wa.size, wb.size);
    const longer = Math.max(wa.size, wb.size);
    if (shorter / longer >= 0.5) return 85;
  }
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return Math.round((common / Math.max(wa.size, wb.size)) * 100);
}

// A freshly renamed company's `(F.K.A. Old Name)` clause is stripped by
// normalize() (so the current name matches cleanly on its own) — but that
// throws away the one piece of information that lets a rename-in-progress
// still find its OWN prior invoices, which QB keeps filed under whatever
// name was current when they were raised. A full rebrand (e.g. "Huakai
// Technology" -> "Huako Portrait") shares zero words with its old name, so
// without this the match silently returns 0 and billing thinks the company
// has no history at all. Confirmed live: HUAKO PORTRAIT PTE. LTD. (UEN
// 202416638M) — real Secretary/Address/AR invoices sit under "Huakai
// Technology Pte. Ltd." in quickbooks_invoice_items, invisible to
// getPriorInvoice()/getAnnualFeeRecord() until this alias was added.
function extractFkaAlias(name: string): string | null {
  const m = (name ?? '').match(/\(f\.?k\.?a\.?\s*([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

/**
 * 100 = exact (normalised); 85 = one contains the other AND the shorter name
 * is at least half the longer one's word count; else word overlap × 100.
 * Also tries each side's `(F.K.A. …)` alias (see extractFkaAlias) and keeps
 * the best score across all combinations, so a rename-in-progress matches
 * either its current or its pre-rename name.
 *
 * The length-ratio guard on the containment bonus matters because QB has no
 * UEN to disambiguate: without it, a short/generic real company name (e.g.
 * "Blockchain Pte Ltd") sitting as a literal substring inside an unrelated,
 * longer company's name (e.g. "CWIOS International Blockchain Technology
 * Pte Ltd") would score 85 and get treated as the same company. Verified
 * against the live company registry — every such case found was two
 * genuinely different registered entities (different registration numbers),
 * often sibling companies sharing a brand word.
 */
export function matchScore(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  let best = coreScore(na, nb);
  if (best === 100) return best;
  const aliasA = extractFkaAlias(a);
  const aliasB = extractFkaAlias(b);
  if (aliasA) best = Math.max(best, coreScore(normalize(aliasA), nb));
  if (aliasB) best = Math.max(best, coreScore(na, normalize(aliasB)));
  if (aliasA && aliasB) best = Math.max(best, coreScore(normalize(aliasA), normalize(aliasB)));
  return best;
}

/**
 * Return one defensible fuzzy match. A tied best score is deliberately treated
 * as ambiguous so billing/workflow code cannot silently pick the first row.
 */
export function findUniqueBestMatch<T>(
  target: string,
  candidates: readonly T[],
  getName: (candidate: T) => string,
  minimumScore = 70,
): { value: T | null; score: number; ambiguous: boolean } {
  let best: T | null = null;
  let bestScore = 0;
  let tied = false;

  for (const candidate of candidates) {
    const score = matchScore(target, getName(candidate));
    if (score < minimumScore) continue;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }

  return { value: tied ? null : best, score: bestScore, ambiguous: tied };
}

// Resolve a user-typed company query into a decision a caller can act on.
// Added 2026-09-10 after a real usability failure: findUniqueBestMatch()
// already reports `ambiguous: true` when several names tie, but every caller
// only read `.value` and then told the user "No company matched" — which is
// factually WRONG. Confirmed on production: typing "remobie" (3 real
// companies: REMOBIE COMPANY / ENTERPRISES / TECHNOLOGIES) produced "No
// company matched \"remobie\"". People type partial names constantly, so a
// dead end there reads as "the system doesn't have my client".
//
// 'ambiguous' is the case that matters: the right response is to ASK which
// one, not to give up. Candidates are de-duplicated by normalized name so a
// company appearing in two source tables is never offered twice.
export type CompanyResolution<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'best'; value: T; score: number }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'none'; suggestions: T[] };

export function resolveCompany<T>(
  query: string,
  candidates: readonly T[],
  getName: (candidate: T) => string,
  minimumScore = 70,
): CompanyResolution<T> {
  const q = normalize(query);
  if (!q) return { kind: 'none', suggestions: [] };

  const dedupe = (list: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const c of list) {
      const key = normalize(getName(c));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  };

  const exact = candidates.find(c => normalize(getName(c)) === q);
  if (exact) return { kind: 'exact', value: exact };

  let bestScore = 0;
  let topScorers: T[] = [];
  for (const c of candidates) {
    const score = matchScore(query, getName(c));
    if (score < minimumScore) continue;
    if (score > bestScore) { bestScore = score; topScorers = [c]; }
    else if (score === bestScore) topScorers.push(c);
  }
  const tops = dedupe(topScorers);
  if (tops.length === 1) return { kind: 'best', value: tops[0], score: bestScore };
  if (tops.length > 1) return { kind: 'ambiguous', candidates: tops.slice(0, 8) };

  // Nothing scored high enough — fall back to plain substring hits, which is
  // what a person typing a short brand name ("remobie") usually means.
  const substring = dedupe(candidates.filter(c => normalize(getName(c)).includes(q)));
  if (substring.length === 1) return { kind: 'best', value: substring[0], score: minimumScore };
  if (substring.length > 1) return { kind: 'ambiguous', candidates: substring.slice(0, 8) };
  return { kind: 'none', suggestions: [] };
}
