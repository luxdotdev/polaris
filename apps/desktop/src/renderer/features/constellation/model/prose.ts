/**
 * Splits a Logbook entry's text into prose and mono runs (paths, dotted names) in one linear
 * pass: workers write this text, so no pattern may backtrack over a long run.
 */

export interface ProsePart {
  readonly text: string;
  readonly mono: boolean;
}

const OPENERS = new Set(["(", "[", '"', "'", "`"]);

const CLOSERS = new Set([")", "]", '"', "'", "`", ",", ".", ";", ":", "!", "?"]);

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";

const isWordChar = (c: string) => (c >= "a" && c <= "z") || c === "_";

/** "lead.ended", "ab.cd_e.fg": lowercase words of two letters or more joined by single dots. */
const isDotted = (word: string) => {
  let dots = 0;
  let run = 0;

  for (const c of word) {
    if (isWordChar(c)) run += 1;
    else if (c === "." && run > 1) {
      dots += 1;
      run = 0;
    } else return false;
  }

  return dots > 0 && run > 1;
};

/** A path has a slash with something on both sides of it. */
const isPath = (word: string) => {
  const at = word.indexOf("/", 1);

  return at > 0 && at < word.length - 1;
};

/** A whitespace-free run, its punctuation trimmed off either end. */
const classify = (run: string): ReadonlyArray<ProsePart> => {
  let start = 0;
  let end = run.length;

  while (start < end && OPENERS.has(run.charAt(start))) start += 1;

  while (end > start && CLOSERS.has(run.charAt(end - 1))) end -= 1;
  const core = run.slice(start, end);

  if (core === "" || !(isPath(core) || isDotted(core))) return [{ text: run, mono: false }];

  return [
    { text: run.slice(0, start), mono: false },
    { text: core, mono: true },
    { text: run.slice(end), mono: false },
  ];
};

/** Prose and mono parts in order; neighbouring prose is joined into one part. */
export const proseParts = (text: string): ReadonlyArray<ProsePart> => {
  const parts: Array<ProsePart> = [];

  const push = (part: ProsePart) => {
    if (part.text === "") return;
    const last = parts.at(-1);

    if (last !== undefined && !last.mono && !part.mono)
      parts[parts.length - 1] = { text: last.text + part.text, mono: false };
    else parts.push(part);
  };

  let at = 0;

  while (at < text.length) {
    let end = at;
    const space = isSpace(text.charAt(at));

    while (end < text.length && isSpace(text.charAt(end)) === space) end += 1;
    const run = text.slice(at, end);

    for (const part of space ? [{ text: run, mono: false }] : classify(run)) push(part);
    at = end;
  }

  return parts;
};
