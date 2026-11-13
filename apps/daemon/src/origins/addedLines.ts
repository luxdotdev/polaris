/**
 * The lines a `git diff -U0` adds, per path: what a Turn wrote (its checkpoints' diff) or a
 * commit added. Binary files and deletions add none.
 */

import { unquotePath } from "../git/quotePath.ts";

export interface AddedLine {
  readonly path: string;
  readonly text: string;
}

/** The new path of a `+++ b/<path>` header; null for `+++ /dev/null` (a deletion). */
const newPath = (header: string): string | null => {
  const raw = unquotePath(header.slice(4));

  return raw === "/dev/null" ? null : raw.replace(/^"?b\//, "");
};

/** Every `+` line of every hunk, with the path it was added to. */
export const parseAddedLines = (diff: string): ReadonlyArray<AddedLine> => {
  const added: Array<AddedLine> = [];
  let path: string | null = null;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith("+++ ")) path = newPath(line);
    else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && path !== null && line.startsWith("+"))
      added.push({ path, text: line.slice(1) });
  }

  return added;
};
