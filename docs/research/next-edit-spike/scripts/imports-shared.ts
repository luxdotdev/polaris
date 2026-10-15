// Shared by the import study's acquisition and scoring.
import type { LspTextEdit } from "../../../../packages/predict/src/edit/imports/index.ts";

export interface ImportCase {
  id: string;
  commit: string;
  path: string;
  buffer: string;
  history: readonly { line: number; after: string }[];
  expected: readonly { from: number; to: number; text: string }[];
}

/** UTF-16 LSP positions to offsets; edits apply from the end so earlier offsets hold. */
export const applyLspEdits = (text: string, edits: readonly LspTextEdit[]) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const at = (p: { line: number; character: number }) => (starts[p.line] ?? text.length) + p.character;
  return [...edits]
    .map((e) => ({ from: at(e.range.start), to: at(e.range.end), text: e.newText }))
    .sort((a, b) => b.from - a.from)
    .reduce((t, e) => t.slice(0, e.from) + e.text + t.slice(e.to), text);
};

/** The burst's lines in the buffer, and the names its text mentions. */
export const changedRegion = (buffer: string, history: ImportCase["history"]) => {
  const lines = new Set<number>();
  const names = new Set<string>();
  for (const hunk of history) {
    const near = buffer.split("\n").slice(0, hunk.line).join("\n").length;
    let at = -1;
    for (let i = buffer.indexOf(hunk.after); i !== -1 && hunk.after; i = buffer.indexOf(hunk.after, i + 1))
      if (at === -1 || Math.abs(i - near) < Math.abs(at - near)) at = i;
    const start = at === -1 ? hunk.line : buffer.slice(0, at).split("\n").length - 1;
    for (let k = 0; k < Math.max(1, hunk.after.split("\n").length); k++) lines.add(start + k);
    for (const m of hunk.after.matchAll(/[$A-Z_a-z][$\w]*/g)) names.add(m[0]);
  }
  return { lines, names };
};

/** name → module for every import binding in the text. */
export const bindings = (text: string) => {
  const result = new Map<string, string>();
  for (const m of text.matchAll(/^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s*["']([^"']+)["']/gm))
    for (const part of (m[1] ?? "").replace(/[{}]/g, ",").split(","))
      {
        const name = part.replace(/^\s*type\s+/, "").split(/\s+as\s+/).at(-1)?.trim();
        if (name && /^[$\w]+$/.test(name)) result.set(name, m[2]!);
      }
  return result;
};
