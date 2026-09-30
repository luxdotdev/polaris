/**
 * Ranking for the K jump menu: a small fuzzy matcher (prefix beats word
 * start beats a scattered subsequence), every query word matched somewhere,
 * the title weighted over the rest, and Needs You first among sessions.
 */

/** Scattered letters only count for words this long; "po" must appear as written. */
export const SCATTERED_MIN = 3;

export interface WordOptions {
  /** Allow a scattered subsequence (titles); keywords must contain the word. */
  readonly scattered: boolean;
}

/** How one query word fits one text; null when it doesn't. Higher is better. */
export const wordScore = (
  word: string,
  text: string,
  options: WordOptions = { scattered: true }
): number | null => {
  const q = word.toLowerCase();
  const t = text.toLowerCase();

  if (q === "") return 0;
  const at = t.indexOf(q);

  if (at === 0) return 100 - Math.min(20, t.length - q.length) * 0.5;

  if (at > 0) return (isWordStart(t, at) ? 80 : 50) - Math.min(20, at) * 0.5;

  return options.scattered && q.length >= SCATTERED_MIN ? subsequenceScore(q, t) : null;
};

const isWordStart = (t: string, at: number) => at === 0 || /[\s/._\-·]/.test(t.charAt(at - 1));

const subsequenceScore = (q: string, t: string): number | null => {
  let from = 0;
  let previous = -2;
  let score = 0;

  for (const ch of q) {
    const found = t.indexOf(ch, from);

    if (found === -1) return null;
    score += found === previous + 1 ? 4 : isWordStart(t, found) ? 3 : 1;
    previous = found;
    from = found + 1;
  }

  // Tighter matches rank higher; never above a real substring match.
  return Math.min(45, score * 2 - (previous - q.length) * 0.1);
};

export interface Searchable {
  readonly title: string;
  /** Host, Workspace, state, Harness…: matched at a lower weight. */
  readonly keywords: ReadonlyArray<string>;
}

const KEYWORD_WEIGHT = 0.6;

/** The item's score for the whole query (every word must match); null when it doesn't. */
export const itemScore = (query: string, item: Searchable): number | null => {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");

  if (words.length === 0) return 0;
  let total = 0;

  for (const word of words) {
    const title = wordScore(word, item.title);

    const keyword = item.keywords.reduce<number | null>((best, k) => {
      const s = wordScore(word, k, { scattered: false });

      return s === null ? best : Math.max(best ?? 0, s * KEYWORD_WEIGHT);
    }, null);

    if (title === null && keyword === null) return null;
    total += Math.max(title ?? 0, keyword ?? 0);
  }

  return total;
};

export interface Ranked<A> {
  readonly item: A;
  readonly score: number;
}

export interface RankInput<A extends Searchable> {
  readonly query: string;
  readonly items: ReadonlyArray<A>;
  /** Needs You items first, whatever their score. */
  readonly urgent?: (item: A) => boolean;
  /** Tie-breaker: a smaller number is more recent. */
  readonly recency?: (item: A) => number;
  readonly limit: number;
}

export const rank = <A extends Searchable>({
  query,
  items,
  urgent = () => false,
  recency = () => Number.POSITIVE_INFINITY,
  limit,
}: RankInput<A>): ReadonlyArray<A> =>
  items
    .flatMap((item): Array<Ranked<A>> => {
      const score = itemScore(query, item);

      return score === null ? [] : [{ item, score }];
    })
    .sort(
      (a, b) =>
        Number(urgent(b.item)) - Number(urgent(a.item)) ||
        b.score - a.score ||
        recency(a.item) - recency(b.item)
    )
    .slice(0, limit)
    .map((r) => r.item);
