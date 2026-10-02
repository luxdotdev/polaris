/**
 * ⌘⇧F's pure parts: grep hits grouped by file (in the order they came), each with its line,
 * the match's UTF-16 column (grep reports bytes) and the range to highlight in the line.
 */

export interface GrepHit {
  /** Absolute; relative to the searched root once grouped. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based byte column of the first match. */
  readonly column: number;
  readonly text: string;
}

export interface SearchOptions {
  readonly pattern: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
}

export interface MatchRow {
  readonly line: number;
  /** 1-based, in UTF-16 units: what the editor's cursor uses. */
  readonly column: number;
  readonly text: string;
  /** The match within `text`, for highlighting; null when it can't be found again. */
  readonly match: { readonly from: number; readonly to: number } | null;
}

export interface FileMatches {
  readonly path: string;
  readonly rows: ReadonlyArray<MatchRow>;
}

/** The UTF-16 index of the character starting at 0-based byte `bytes` in `text`. */
export const charIndexOfByte = (text: string, bytes: number): number => {
  let seen = 0;
  let index = 0;

  for (const char of text) {
    if (seen >= bytes) return index;
    seen += new TextEncoder().encode(char).length;
    index += char.length;
  }

  return index;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the pattern matches at or after `from` in `text`; null for an invalid regex. */
export const matchIn = (
  text: string,
  options: SearchOptions,
  from: number
): { readonly from: number; readonly to: number } | null => {
  try {
    const source = options.regex ? options.pattern : escape(options.pattern);
    const re = new RegExp(source, options.caseSensitive ? "g" : "gi");

    re.lastIndex = from;
    const found = re.exec(text);

    return found === null || found[0] === ""
      ? null
      : { from: found.index, to: found.index + found[0].length };
  } catch {
    return null;
  }
};

/** Lines can be long; a row shows at most this much, kept around the match. */
export const ROW_CHARS = 160;

/** Hits grouped by file in arrival order, rows by line. */
export const groupHits = (
  hits: ReadonlyArray<GrepHit>,
  options: SearchOptions,
  relative: (path: string) => string
): Array<FileMatches> => {
  const files = new Map<string, Array<MatchRow>>();

  for (const hit of hits) {
    const column = charIndexOfByte(hit.text, hit.column - 1) + 1;
    const rows = files.get(hit.path) ?? [];

    rows.push({
      line: hit.line,
      column,
      text: hit.text,
      match: matchIn(hit.text, options, column - 1),
    });
    files.set(hit.path, rows);
  }

  return [...files].map(([path, rows]) => ({
    path: relative(path),
    rows: rows.toSorted((a, b) => a.line - b.line),
  }));
};

/** "12 results in 3 files". */
export const resultsLabel = (files: ReadonlyArray<FileMatches>, limited: boolean): string => {
  const results = files.reduce((n, f) => n + f.rows.length, 0);
  const label = `${results} ${results === 1 ? "result" : "results"} in ${files.length} ${files.length === 1 ? "file" : "files"}`;

  return limited ? `${label} (the first ${results})` : label;
};
