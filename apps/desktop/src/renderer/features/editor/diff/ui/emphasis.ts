/**
 * The syntax-aware diff's marks on Pierre's rows. Pierre has no hook for custom word marks,
 * so the changed tokens are CSS Custom Highlights over its drawn rows, set again whenever it
 * draws (rows come and go as the view scrolls). Highlights add no DOM and never relayout.
 */
import type { Emphasis } from "@polaris/syntax-diff";

const ADDED = "polaris-diff-added";

const REMOVED = "polaris-diff-removed";

/** The highlights' look, injected into each file's shadow root with Pierre's own word marks off. */
export const SYNTAX_CSS = `::highlight(${ADDED}) { background-color: var(--color-diff-added-emphasis); }
::highlight(${REMOVED}) { background-color: var(--color-diff-removed-emphasis); }
[data-diff-span] { background-color: transparent !important; }`;

const NEW_ROWS = ":is([data-unified], [data-additions])";

const CONTEXT = ':is([data-line-type="context"], [data-line-type="context-expanded"])';

/** A 2px `diff-added` bar on the rows that only gained tokens, which Pierre draws as context. */
export const insertedCss = (lines: ReadonlyArray<number>) =>
  lines.length === 0
    ? ""
    : `${lines
        .map((n) => `${NEW_ROWS} :is([data-line="${n}"], [data-column-number="${n}"])${CONTEXT}`)
        .join(",\n")} { box-shadow: inset 2px 0 0 var(--color-diff-added); }`;

/** Which side a drawn row shows, or null for one with no marks (old context, separators). */
const sideOf = (row: Element): "old" | "new" | null => {
  const type = row.getAttribute("data-line-type");

  if (type === "change-deletion") return "old";

  if (type === "change-addition") return "new";

  return row.closest("[data-unified], [data-additions]") === null ? null : "new";
};

/** A range over `[start, end)` of the row's text, found across its token spans. */
const rangeIn = (row: Element, start: number, end: number): Range | null => {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let started = false;

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;

    if (!started && start < at + length) {
      range.setStart(node, start - at);
      started = true;
    }

    if (started && end <= at + length) {
      range.setEnd(node, end - at);

      return range;
    }

    at += length;
  }

  return null;
};

export type EmphasisIndex = ReadonlyMap<string, ReadonlyArray<Emphasis>>;

/** The marks by side and line ("new:12"), so each drawn row finds its own. */
export const indexEmphasis = (emphasis: ReadonlyArray<Emphasis>): EmphasisIndex => {
  const index = new Map<string, Array<Emphasis>>();

  for (const mark of emphasis) {
    const key = `${mark.side}:${mark.line}`;
    const list = index.get(key) ?? [];

    list.push(mark);
    index.set(key, list);
  }

  return index;
};

/** Adds one drawn row's marks to `added` or `removed`. */
const markRow = (
  row: Element,
  index: EmphasisIndex,
  added: Array<Range>,
  removed: Array<Range>
) => {
  const side = sideOf(row);
  const marks = side === null ? undefined : index.get(`${side}:${row.getAttribute("data-line")}`);

  for (const mark of marks ?? []) {
    const range = rangeIn(row, mark.start, mark.end);

    if (range !== null) (mark.side === "old" ? removed : added).push(range);
  }
};

/** Marks every drawn row under `roots` (Pierre's shadow roots); returns how many ranges. */
export const applyEmphasis = (roots: Iterable<ParentNode>, index: EmphasisIndex): number => {
  const added: Array<Range> = [];
  const removed: Array<Range> = [];

  for (const root of roots)
    for (const row of root.querySelectorAll("[data-code] [data-line][data-line-type]"))
      markRow(row, index, added, removed);

  CSS.highlights.set(ADDED, new Highlight(...added));
  CSS.highlights.set(REMOVED, new Highlight(...removed));

  return added.length + removed.length;
};

export const clearEmphasis = () => {
  CSS.highlights.delete(ADDED);
  CSS.highlights.delete(REMOVED);
};
