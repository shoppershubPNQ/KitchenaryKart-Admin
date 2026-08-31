/**
 * Shared "smart search" ranking. Copied VERBATIM from web/lib/search.ts so the
 * admin product search ranks identically to the storefront — a SKU that finds a
 * product on the shop page must find it here too. Keep the two files in sync.
 *
 * Goals (in priority order):
 *   1. Correct spelling -> the most accurate match ranks first.
 *      Exact > prefix > substring matches always outrank fuzzy ones.
 *   2. Misspelled / typo'd query -> still surface *similar* products via
 *      typo-tolerant fuzzy matching (Damerau/OSA edit distance, which also
 *      forgives the most common typo: two adjacent letters swapped —
 *      "kettel" -> "kettle").
 *
 * Zero dependencies and no DB extension (no pg_trgm) required — it runs the
 * same in a Node API route and in the browser. Catalog is ~2k rows so an
 * in-memory rank per query is cheap.
 */

/** Fields a rankable item may expose. All optional; missing fields are skipped. */
export interface Searchable {
  name?: string | null;
  sku?: string | null;
  subcategory?: string | null;
  category?: string | null;
  metaKeywords?: string | null;
  /** Only used as a tie-breaker (in-stock first), never for matching. */
  stock?: number | null;
}

/** Per-field weight. A strong name match should beat a weak keyword match. */
const FIELD_WEIGHTS: { key: keyof Searchable; weight: number }[] = [
  { key: 'name', weight: 1.0 },
  { key: 'sku', weight: 0.95 },
  { key: 'subcategory', weight: 0.6 },
  { key: 'category', weight: 0.5 },
  { key: 'metaKeywords', weight: 0.45 },
];

/** Items scoring below this are treated as non-matches and dropped. */
export const MIN_SCORE = 0.33;

/**
 * Lowercase, strip diacritics, collapse punctuation/whitespace to single
 * spaces. "Cafe  Creme!" -> "cafe creme".
 */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Optimal String Alignment distance (Damerau-Levenshtein restricted to
 * adjacent transpositions). Good enough for query-length strings and treats a
 * single swapped-letter typo as distance 1.
 */
function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Cheap early-out: if the length gap already exceeds any plausible tolerance
  // there's no point building the matrix.
  if (Math.abs(m - n) > 4) return Math.abs(m - n);

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[m][n];
}

/**
 * Edit distance we'll forgive for a token of the given length. Deliberately
 * tight: distance 3 on a 7-char word (43% different) let unrelated words match
 * (e.g. query "charger" fuzzy-matching "gear"), which inflated products that
 * only really matched a *different* query word. Capping longer tokens at 2
 * keeps genuine typos (transpositions / one-off letters) while rejecting
 * coincidental near-misses.
 */
function allowedDistance(len: number): number {
  if (len <= 4) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * Score how well a single query token matches one field word, in [0, 1].
 * Tiered so exact/prefix/substring always beat fuzzy.
 */
function tokenWordScore(token: string, word: string): number {
  if (word === token) return 1.0;
  if (token.length >= 2 && word.startsWith(token)) return 0.85;
  if (token.length >= 3 && word.includes(token)) return 0.65;
  // Fuzzy fallback — forgives typos but always scores below substring.
  const allowed = allowedDistance(token.length);
  const dist = osaDistance(word, token);
  if (dist <= allowed) {
    const sim = 1 - dist / Math.max(word.length, token.length);
    return 0.45 + 0.3 * sim; // ~0.45 - 0.75
  }
  return 0;
}

/**
 * Score how well the whole query matches one field's text, in [0, 1].
 *
 * We compute BOTH a whole-string score (exact / whole-word / prefix / substring
 * tiers) AND a per-token average (every query word must land somewhere), then
 * return the higher of the two.
 *
 * Taking the max matters for multi-word queries: searching "cream charger",
 * the product "…Cream Chargers…" contains the substring "cream charger" (tier
 * = 0.8) but ALSO matches both words strongly (cream = exact word, charger =
 * prefix of "chargers" → token avg ≈ 0.93). Returning only the substring tier
 * capped it at 0.8, letting a product that matches just ONE word ("Ice Cream
 * Scoop") edge ahead. Taking the max lets the true full match win.
 *
 * The whole-word tier also means an exact keyword outranks a query that merely
 * appears inside a longer word — "pan" ranks "Frying Pan" above "Panini Press".
 */
function fieldScore(fieldText: string, qn: string, qTokens: string[]): number {
  const f = normalize(fieldText);
  if (!f) return 0;
  const words = f.split(' ');

  let whole = 0;
  if (f === qn) whole = 1.0; // the whole field is exactly the query
  else if (words.includes(qn)) whole = 0.95; // the query is an exact, whole word
  else if (f.startsWith(qn)) whole = 0.88; // the query is a prefix (possibly mid-word)
  else if (qn.length >= 3 && f.includes(qn)) whole = 0.8; // substring somewhere

  let sum = 0;
  for (const t of qTokens) {
    let best = 0;
    for (const w of words) {
      const s = tokenWordScore(t, w);
      if (s > best) best = s;
      if (best === 1.0) break;
    }
    sum += best;
  }
  const tokenAvg = sum / qTokens.length;

  return Math.max(whole, tokenAvg);
}

/** Relevance score for an item against the (raw) query. 0 = no match. */
export function scoreItem(item: Searchable, rawQuery: string): number {
  const qn = normalize(rawQuery);
  if (!qn) return 0;
  const qTokens = qn.split(' ');

  let best = 0;
  for (const { key, weight } of FIELD_WEIGHTS) {
    const val = item[key];
    if (typeof val !== 'string' || !val) continue;
    const s = fieldScore(val, qn, qTokens) * weight;
    if (s > best) best = s;
    if (best >= 1.0) break;
  }
  return best;
}

/**
 * Rank items by relevance to `rawQuery`, dropping non-matches. Ties break on
 * in-stock first, then name A->Z, so the order is stable and sensible.
 */
export function rankItems<T extends Searchable>(items: T[], rawQuery: string): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = scoreItem(item, rawQuery);
    if (score >= MIN_SCORE) scored.push({ item, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const as = (a.item.stock ?? 0) > 0 ? 1 : 0;
    const bs = (b.item.stock ?? 0) > 0 ? 1 : 0;
    if (bs !== as) return bs - as;
    return (a.item.name ?? '').localeCompare(b.item.name ?? '');
  });
  return scored.map((s) => s.item);
}
