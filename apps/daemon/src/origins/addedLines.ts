/**
 * The lines a `git diff -U0` adds, per path: what a Turn wrote (its checkpoints' diff) or a
 * commit added. Binary files and deletions add none.
 */

export interface AddedLine {
  readonly path: string;
  readonly text: string;
}

const ESCAPES = new Map([
  ["n", 10],
  ["t", 9],
  ['"', 34],
  ["\\", 92],
  ["a", 7],
  ["b", 8],
]);

/** git C-quotes a path with unusual bytes ("a\303\251.ts"); octal escapes are UTF-8 bytes. */
export const unquotePath = (raw: string): string => {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: Array<number> = [];
  const body = raw.slice(1, -1);

  for (let at = 0; at < body.length; at++) {
    const char = body[at]!;

    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }

    const octal = /^[0-7]{3}/.exec(body.slice(at + 1));

    if (octal === null) bytes.push(ESCAPES.get(body[at + 1]!) ?? body.charCodeAt(at + 1));
    else bytes.push(Number.parseInt(octal[0], 8));
    at += octal === null ? 1 : 3;
  }

  return Buffer.from(bytes).toString("utf8");
};

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
