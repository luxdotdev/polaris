/**
 * The tree's keys, as macOS lists and VS Code's explorer have them: ↑/↓ move,
 * → opens a folder or steps in, ← closes it or steps out, ↵ opens, F2
 * renames, ⌘⌫ deletes. Pure: the view runs what this returns.
 */
import type { TreeRow } from "./tree.ts";

export type TreeKeyAction =
  | { readonly kind: "focus"; readonly path: string }
  | { readonly kind: "toggle"; readonly row: TreeRow; readonly open: boolean }
  | { readonly kind: "open"; readonly row: TreeRow }
  | { readonly kind: "rename"; readonly row: TreeRow }
  | { readonly kind: "delete"; readonly row: TreeRow };

export interface TreeKey {
  readonly key: string;
  readonly meta: boolean;
}

const step = (rows: ReadonlyArray<TreeRow>, at: number, by: number): TreeKeyAction | null => {
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + by))];

  return next === undefined ? null : { kind: "focus", path: next.path };
};

const parentOf = (rows: ReadonlyArray<TreeRow>, at: number): TreeKeyAction | null => {
  const depth = rows[at]!.depth;

  for (let i = at - 1; i >= 0; i--) {
    if (rows[i]!.depth < depth) return { kind: "focus", path: rows[i]!.path };
  }

  return null;
};

const right = (rows: ReadonlyArray<TreeRow>, at: number, row: TreeRow): TreeKeyAction | null => {
  if (row.kind !== "folder") return null;

  return row.open ? step(rows, at, 1) : { kind: "toggle", row, open: true };
};

const left = (rows: ReadonlyArray<TreeRow>, at: number, row: TreeRow): TreeKeyAction | null =>
  row.kind === "folder" && row.open ? { kind: "toggle", row, open: false } : parentOf(rows, at);

export const treeKey = (
  { key, meta }: TreeKey,
  rows: ReadonlyArray<TreeRow>,
  focused: string | null
): TreeKeyAction | null => {
  const at = rows.findIndex((r) => r.path === focused);
  const row = rows[at];

  if (row === undefined)
    return rows[0] === undefined ? null : { kind: "focus", path: rows[0].path };

  switch (key) {
    case "ArrowDown":
      return step(rows, at, 1);
    case "ArrowUp":
      return step(rows, at, -1);
    case "Home":
      return step(rows, 0, 0);
    case "End":
      return step(rows, rows.length - 1, 0);
    case "ArrowRight":
      return right(rows, at, row);
    case "ArrowLeft":
      return left(rows, at, row);
    case "Enter":
      return row.kind === "folder"
        ? { kind: "toggle", row, open: !row.open }
        : { kind: "open", row };
    case "F2":
      return row.deleted ? null : { kind: "rename", row };
    case "Backspace":
    case "Delete":
      return meta && !row.deleted ? { kind: "delete", row } : null;
    default:
      return null;
  }
};
