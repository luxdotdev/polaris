/**
 * Finds menu labels in source and whether each declares `needsInput`, for the
 * ellipsis test (DESIGN.md, rule/ellipsis-means-input). Two shapes count as menu items:
 * JSX `<ContextMenuItem>` / `<DropdownMenuItem>` (and their SubTrigger, Checkbox and
 * Radio kin), and `{ kind: "item", label: … }` entries for `ContextMenuEntries`.
 */
import { ellipsisProblem } from "@polaris/ui";

export interface FoundLabel {
  readonly file: string;
  readonly line: number;
  readonly labels: ReadonlyArray<string>;
  readonly needsInput: boolean;
}

const JSX_ITEM = /<((?:ContextMenu|DropdownMenu)(?:Item|SubTrigger|CheckboxItem|RadioItem))\b/g;

const ENTRY_LABEL = /\blabel:\s*/g;

const QUOTES = new Set(['"', "'", "`"]);

const OPEN = new Set(["{", "(", "["]);

const CLOSE = new Set(["}", ")", "]"]);

const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** Where the string starting at `from` (on its quote) ends, past the closing quote. */
const skipString = (source: string, from: number): number => {
  const quote = source[from];
  let i = from + 1;

  while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;

  return i + 1;
};

/** The index of the first `stop` character outside strings and brackets, from `from`. */
const scanTo = (source: string, from: number, stop: ReadonlySet<string>): number => {
  let depth = 0;
  let i = from;

  while (i < source.length) {
    const c = source[i] ?? "";

    if (QUOTES.has(c)) {
      i = skipString(source, i);
      continue;
    }

    if (depth === 0 && stop.has(c)) return i;

    if (OPEN.has(c)) depth++;
    else if (CLOSE.has(c)) depth--;

    i++;
  }

  return i;
};

/** The texts of the string literals in `code` ("…", '…', `…` with its `${}` kept). */
const literals = (code: string): ReadonlyArray<string> =>
  [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? ""
  );

/** `code` with every balanced `{…}` expression replaced by a line break. */
const withoutExpressions = (code: string): string => {
  let out = "";
  let i = 0;

  while (i < code.length) {
    if (code[i] === "{") {
      i = scanTo(code, i + 1, new Set(["}"])) + 1;
      out += "\n";
      continue;
    }

    out += code[i];
    i++;
  }

  return out;
};

/** JSX text between tags, with `{…}` expressions removed. */
const jsxText = (body: string): ReadonlyArray<string> =>
  withoutExpressions(body)
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t !== "");

const declaresInput = (attrs: string) => /\bneedsInput\b(?!=\{false\})/.test(attrs);

/** `needsInput={entry.needsInput}`: a renderer of data entries, checked where the data is. */
const forwardsInput = (attrs: string) => /\bneedsInput=\{(?!true\}|false\})/.test(attrs);

const jsxItems = (file: string, source: string): ReadonlyArray<FoundLabel> =>
  [...source.matchAll(JSX_ITEM)].flatMap((m) => {
    const start = m.index;
    const tagEnd = scanTo(source, start + 1, new Set([">"]));
    const attrs = source.slice(start, tagEnd);
    const closing = `</${m[1] ?? ""}>`;
    const end = attrs.endsWith("/") ? tagEnd : source.indexOf(closing, tagEnd);
    const body = end < 0 ? "" : source.slice(tagEnd + 1, end);

    if (forwardsInput(attrs)) return [];

    return [
      {
        file,
        line: lineAt(source, start),
        labels: [...literals(body), ...jsxText(body)],
        needsInput: declaresInput(attrs),
      },
    ];
  });

/** The `{…}` object literal around `index`: its start and end. */
const enclosingObject = (source: string, index: number): string => {
  let depth = 0;
  let i = index;

  while (i > 0) {
    const c = source[i];

    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) break;
      depth--;
    }

    i--;
  }

  return source.slice(i, scanTo(source, i + 1, new Set(["}"])) + 1);
};

const entryItems = (file: string, source: string): ReadonlyArray<FoundLabel> =>
  [...source.matchAll(ENTRY_LABEL)].flatMap((m) => {
    const object = enclosingObject(source, m.index);

    if (!/\bkind:\s*"(?:item|sub)"(?!\s*;)/.test(object)) return [];
    const valueStart = m.index + m[0].length;
    const value = source.slice(valueStart, scanTo(source, valueStart, new Set([",", "}"])));

    return [
      {
        file,
        line: lineAt(source, m.index),
        labels: literals(value),
        needsInput: /\bneedsInput:\s*true\b/.test(object),
      },
    ];
  });

export const menuLabels = (file: string, source: string): ReadonlyArray<FoundLabel> => [
  ...jsxItems(file, source),
  ...entryItems(file, source),
];

/** A found item's problem, if any: an ellipsis without input, input without one, or "...". */
export const labelProblem = (found: FoundLabel): string | null => {
  const dots = found.labels.find((l) => l.trimEnd().endsWith("..."));

  if (dots !== undefined) return ellipsisProblem(dots, found.needsInput);
  const withEllipsis = found.labels.find((l) => l.trimEnd().endsWith("…"));

  if (withEllipsis !== undefined) return ellipsisProblem(withEllipsis, found.needsInput);

  const first = found.labels[0];

  return found.needsInput && first !== undefined ? ellipsisProblem(first, true) : null;
};
