import type { LanguagePositionEncoding, LanguageTextEdit } from "@polaris/protocol";

const encoder = new TextEncoder();

interface Line {
  readonly start: number;
  readonly text: string;
}

const linesOf = (text: string): Line[] => {
  const lines: Line[] = [];
  let start = 0;

  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ start, text: text.slice(start, match.index) });
    start = match.index + match[0].length;
  }

  lines.push({ start, text: text.slice(start) });

  return lines;
};

const units = (character: string, encoding: typeof LanguagePositionEncoding.Type) => {
  if (encoding === "utf-8") return encoder.encode(character).length;

  return encoding === "utf-16" ? character.length : 1;
};

/** Validate negotiated positions without splitting Unicode characters or accepting clamped ranges. */
const offset = (
  lines: readonly Line[],
  line: number,
  character: number,
  encoding: typeof LanguagePositionEncoding.Type
) => {
  const value = lines[line];

  if (
    value === undefined ||
    !Number.isSafeInteger(line) ||
    line < 0 ||
    !Number.isSafeInteger(character) ||
    character < 0
  )
    throw new Error("Invalid formatter position.");

  let used = 0;
  let index = 0;

  for (const codepoint of value.text) {
    if (used === character) break;

    used += units(codepoint, encoding);
    index += codepoint.length;
  }

  if (used !== character) throw new Error("Invalid formatter character boundary.");

  return value.start + index;
};

/** E1 validates request/context/document fences before handing its selected provider's edits here. */
export const formattedText = (
  text: string,
  edits: readonly (typeof LanguageTextEdit.Type)[],
  encoding: typeof LanguagePositionEncoding.Type
): string => {
  const lines = linesOf(text);

  const changes = edits
    .map(({ range, newText }) => ({
      from: offset(lines, range.start.line, range.start.character, encoding),
      to: offset(lines, range.end.line, range.end.character, encoding),
      text: newText,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  let end = 0;
  let result = "";

  for (const change of changes) {
    if (change.from < end || change.to < change.from)
      throw new Error("Overlapping formatter edits.");

    result += text.slice(end, change.from) + change.text;
    end = change.to;
  }

  return result + text.slice(end);
};
