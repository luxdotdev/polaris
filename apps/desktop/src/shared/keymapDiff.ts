/** The diff tabs' commands (DESIGN.md, Editor: diff tabs), with VS Code's keys; part of KEYMAP. */
import type { KeyBinding } from "./keymap.ts";

export type DiffCommandId =
  | "git.openChanges"
  | "diff.nextChange"
  | "diff.previousChange"
  | "diff.openFile";

const binding = (
  id: DiffCommandId,
  title: string,
  keys: ReadonlyArray<string>,
  keywords: ReadonlyArray<string>
): KeyBinding => ({ id, title, keys, when: "mode.edit", palette: { group: "file", keywords } });

export const DIFF_BINDINGS: ReadonlyArray<KeyBinding> = [
  binding(
    "git.openChanges",
    "Open changes",
    [],
    ["git", "diff", "compare", "working tree", "index"]
  ),
  binding("diff.nextChange", "Next change", ["F7"], ["diff"]),
  binding("diff.previousChange", "Previous change", ["Shift+F7"], ["diff"]),
  binding("diff.openFile", "Open file", [], ["diff", "source"]),
];
