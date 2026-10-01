/**
 * Flagged lines in the diff (DESIGN.md, Review → Diff): the Severity glyph in the gutter and a
 * 2px rule in the Severity colour at the line's left edge, drawn by CSS that Pierre injects into each file's
 * shadow root (`unsafeCSS`). ENG-230 chose this over waiting for Pierre's Decorations (#459).
 * Selectors use only Pierre's gutter attributes (`data-column-number`, `data-line-type`), scoped to one file by the `data-review-item` its host element carries.
 */

export type MarkSeverity = "critical" | "high" | "medium" | "low";

/** A flagged run of lines in one file of the Review. */
export interface LineMark {
  /** The file's item key (`itemKey`), set on its host element as `data-review-item`. */
  readonly item: string;
  /** `new`: addition and context lines; `old`: deleted lines. */
  readonly side: "new" | "old";
  readonly start: number;
  readonly end: number;
  readonly severity: MarkSeverity;
}

/** Lines one mark may cover; a longer range marks only its first lines. */
export const MAX_MARKED_LINES = 200;

export const SEVERITY_ORDER: Readonly<Record<MarkSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** The glyph shapes of `SeverityGlyph` (@polaris/ui), as masks. */
const GLYPH_PATHS: Readonly<Record<MarkSeverity, string>> = {
  critical: '<path d="M4 .5 7.5 4 4 7.5.5 4Z"/>',
  high: '<path d="M4 .8 7.6 7.2H.4Z"/>',
  medium: '<circle cx="4" cy="4" r="3.25"/>',
  low: '<circle cx="4" cy="4" r="2.75" fill="none" stroke="#000" stroke-width="1.25"/>',
};

const maskOf = (severity: MarkSeverity) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${GLYPH_PATHS[severity]}</svg>`
  )}")`;

/** Item keys go into attribute selectors; keep them to safe characters. */
export const itemKey = (index: number) => `f${index}`;

const scope = (item: string) => `:host([data-review-item="${item}"])`;

const sideFilter = (side: "new" | "old") =>
  side === "old"
    ? '[data-line-type="change-deletion"]'
    : ':not([data-line-type="change-deletion"])';

const gutterSelector = (mark: Pick<LineMark, "item" | "side">, line: number) =>
  `${scope(mark.item)} [data-column-number="${line}"]${sideFilter(mark.side)}`;

/** One line keeps only its most severe mark. */
const strongestPerLine = (marks: ReadonlyArray<LineMark>) => {
  const lines = new Map<string, { mark: LineMark; line: number; first: boolean }>();

  for (const mark of marks) {
    const end = Math.min(mark.end, mark.start + MAX_MARKED_LINES - 1);

    for (let line = mark.start; line <= end; line++) {
      const key = `${mark.item}:${mark.side}:${line}`;
      const held = lines.get(key);

      if (
        held === undefined ||
        SEVERITY_ORDER[mark.severity] < SEVERITY_ORDER[held.mark.severity]
      ) {
        lines.set(key, { mark, line, first: line === mark.start });
      }
    }
  }

  return [...lines.values()];
};

const BASE = "[data-column-number] { position: relative; }";

const glyphRule = (selector: string, severity: MarkSeverity) =>
  `${selector}::before { content: ""; position: absolute; left: 6px; top: 50%; width: 8px; height: 8px; margin-top: -4px; background: var(--color-severity-${severity}); mask: ${maskOf(severity)} center / 8px 8px no-repeat; }`;

/**
 * The stylesheet for a Review's flagged lines; the same string for the same marks, so
 * Pierre re-renders only when they change.
 */
export const marksCss = (marks: ReadonlyArray<LineMark>): string => {
  if (marks.length === 0) return "";

  const rules = strongestPerLine(marks).map(({ mark, line, first }) => {
    const gutter = gutterSelector(mark, line);
    const rule = `${gutter} { box-shadow: inset 2px 0 0 var(--color-severity-${mark.severity}); }`;

    return first ? `${rule}\n${glyphRule(gutter, mark.severity)}` : rule;
  });

  return `${BASE}\n${rules.join("\n")}`;
};

/** Lines the comment composer is open on, in one or more files of the Review. */
export interface SelectionTint {
  readonly items: ReadonlyArray<string>;
  readonly side: "new" | "old";
  readonly start: number;
  readonly end: number;
}

const contentSelector = (item: string, side: "new" | "old", line: number) =>
  `${scope(item)} [data-line="${line}"]${sideFilter(side)}`;

/**
 * The `diff-selection` tint on the lines a comment is anchored to (DESIGN.md, Comment
 * composer), layered over the line's own diff fill.
 */
export const selectionCss = (tint: SelectionTint | null): string => {
  if (tint === null) return "";

  const end = Math.min(tint.end, tint.start + MAX_MARKED_LINES - 1);
  const selectors: Array<string> = [];

  for (const item of tint.items) {
    for (let line = tint.start; line <= end; line++) {
      selectors.push(
        contentSelector(item, tint.side, line),
        gutterSelector({ item, side: tint.side }, line)
      );
    }
  }

  return selectors.length === 0
    ? ""
    : `${selectors.join(",\n")} { background-image: linear-gradient(var(--color-diff-selection), var(--color-diff-selection)); }`;
};

/** A hunk's header as the band above it shows it: `@@ -36,7 +36,8 @@ submitEligibility`. */
export const hunkLabel = (hunkSpecs: string | undefined): string | null => {
  const label = hunkSpecs?.split("\n")[0]?.trim() ?? "";

  return label === "" ? null : label;
};
