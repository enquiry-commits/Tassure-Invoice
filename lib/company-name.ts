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

/**
 * 100 = exact (normalised); 85 = one contains the other AND the shorter name
 * is at least half the longer one's word count; else word overlap × 100.
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
