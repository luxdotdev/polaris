import { LanguageTextEdit } from "@polaris/protocol";

/** Bash Language Server represents the whole document with this exact sentinel. */
export function shellFormatting(
  providerId: string,
  snapshot: string,
  edits: readonly (typeof LanguageTextEdit.Type)[]
) {
  if (providerId !== "bash-language-server") return edits;
  const lines = snapshot.split(/\r\n|\r|\n/);
  const end = { line: lines.length - 1, character: lines.at(-1)!.length };

  return edits.map((edit) => {
    const range = edit.range;

    if (
      range.start.line !== 0 ||
      range.start.character !== 0 ||
      range.end.line !== 2147483647 ||
      range.end.character !== 2147483647
    )
      return edit;

    return LanguageTextEdit.make({ ...edit, range: { start: range.start, end } });
  });
}
