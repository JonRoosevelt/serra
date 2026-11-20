// Fuzzy matching for the command palette: the query's letters must appear in order in the text, and matches that
// start words or run together score higher, so "aau" finds "Add allowed user" and "peo" puts People first.
// Pure functions: imported by `node --test` as well as the renderer.

export interface FuzzyMatch {
  /** Higher is better. Only compare scores for the same query. */
  score: number;
  /** Positions in the text that matched, for highlighting. */
  indices: number[];
}

const START_BONUS = 8;
const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 4;
const MAX_GAP_PENALTY = 3;

const isSeparator = (char: string): boolean => /[\s\-_/.·›&()]/.test(char);

/** Whether `index` begins a word: the text's first letter, after a separator, or an upper case letter after a lower one. */
const isWordStart = (text: string, index: number): boolean => {
  if (index === 0) return true;
  const previous = text[index - 1] ?? '';
  const current = text[index] ?? '';
  if (isSeparator(previous)) return true;
  return current !== current.toLowerCase() && previous === previous.toLowerCase() && previous !== previous.toUpperCase();
};

/**
 * Matches `query` against `text`, ignoring case and the query's spaces. Returns null when a letter is missing.
 * An empty query matches everything with score 0. Finds the best-scoring placement, not just the first one.
 */
export const fuzzyMatch = (query: string, text: string): FuzzyMatch | null => {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (needle.length === 0) return { score: 0, indices: [] };
  const haystack = text.toLowerCase();
  const n = needle.length;
  const m = haystack.length;
  if (n > m) return null;

  const letterScore = (j: number): number =>
    1 + (j === 0 ? START_BONUS : 0) + (isWordStart(text, j) ? WORD_START_BONUS : 0);

  // best[i][j]: the best score with needle[i] placed at haystack[j]; from[i][j] is where needle[i - 1] went.
  const best: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-Infinity));
  const from: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  for (let j = 0; j < m; j++) {
    if (haystack[j] === needle[0]) best[0]![j] = letterScore(j);
  }
  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (haystack[j] !== needle[i]) continue;
      for (let k = i - 1; k < j; k++) {
        const previous = best[i - 1]![k]!;
        if (previous === -Infinity) continue;
        const gap = j - k - 1;
        const link = gap === 0 ? CONSECUTIVE_BONUS : -Math.min(gap, MAX_GAP_PENALTY);
        const score = previous + link + letterScore(j);
        if (score > best[i]![j]!) { best[i]![j] = score; from[i]![j] = k; }
      }
    }
  }

  let end = -1;
  for (let j = 0; j < m; j++) {
    if (best[n - 1]![j]! > (end === -1 ? -Infinity : best[n - 1]![end]!)) end = j;
  }
  if (end === -1 || best[n - 1]![end] === -Infinity) return null;
  const indices: number[] = [];
  for (let i = n - 1, j = end; i >= 0; j = from[i]![j]!, i--) indices.unshift(j);
  return { score: best[n - 1]![end]!, indices };
};
