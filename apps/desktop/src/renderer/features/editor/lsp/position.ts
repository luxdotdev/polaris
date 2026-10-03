import type { Text } from "@codemirror/state";
import type { LanguagePosition, LanguagePositionEncoding } from "@polaris/protocol";

type Position = typeof LanguagePosition.Type;

type Encoding = typeof LanguagePositionEncoding.Type;

const units = (point: string, encoding: Encoding): number => {
  if (encoding === "utf-16") return point.length;

  if (encoding === "utf-32") return 1;
  const code = point.codePointAt(0) ?? 0;

  if (code <= 0x7f) return 1;

  if (code <= 0x7ff) return 2;

  return code <= 0xffff ? 3 : 4;
};

/** Reject split code points and out-of-line positions instead of silently moving edits. */
export const offsetAt = (doc: Text, position: Position, encoding: Encoding): number => {
  if (!Number.isInteger(position.line) || position.line < 0 || position.line >= doc.lines)
    throw new RangeError("Language line outside document");
  const line = doc.line(position.line + 1);
  let character = 0;
  let offset = line.from;

  for (const point of line.text) {
    if (character === position.character) return offset;
    character += units(point, encoding);
    offset += point.length;
  }

  if (character === position.character) return offset;
  throw new RangeError("Language character outside code point boundary");
};

export const positionAt = (doc: Text, offset: number, encoding: Encoding): Position => {
  if (!Number.isInteger(offset) || offset < 0 || offset > doc.length)
    throw new RangeError("Language offset outside document");
  const line = doc.lineAt(offset);
  let character = 0;
  let current = line.from;

  for (const point of line.text) {
    if (current === offset) return { line: line.number - 1, character };
    character += units(point, encoding);
    current += point.length;
  }

  if (current === offset) return { line: line.number - 1, character };
  throw new RangeError("Language offset splits code point");
};
