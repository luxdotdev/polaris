/**
 * A Review's patch as files: each file's byte range, status and counts, from `git.diff`'s
 * `fileIndex`, or found by scanning for `diff --git` lines when an older Daemon sent none.
 * Files are parsed (Pierre's `parsePatchFiles`) one slice at a time, so nothing reads the whole patch twice.
 */

export type PatchFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "mode-changed";

export interface PatchFile {
  /** The new path (the old one for a deletion). */
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: PatchFileStatus;
  readonly offset: number;
  readonly length: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

/** `git.diff`'s `fileIndex` entry (protocol `DiffFile`). */
export interface IndexedFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: PatchFileStatus;
  readonly offset: number;
  readonly length: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

const NEWLINE = 0x0a;

const HEADER = new TextEncoder().encode("diff --git ");

const startsHeader = (bytes: Uint8Array, at: number) => {
  if (at + HEADER.length > bytes.length) return false;

  for (let i = 0; i < HEADER.length; i++) if (bytes[at + i] !== HEADER[i]) return false;

  return true;
};

/** Byte offsets of every `diff --git` line. */
const fileStarts = (bytes: Uint8Array): ReadonlyArray<number> => {
  const starts: Array<number> = [];

  for (let at = 0; at < bytes.length; at++) {
    if ((at === 0 || bytes[at - 1] === NEWLINE) && startsHeader(bytes, at)) starts.push(at);
  }

  return starts;
};

const unquote = (path: string) =>
  path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;

const stripSide = (path: string) => unquote(path).replace(/^[ab]\//, "");

const HEADER_STATUS: ReadonlyArray<readonly [RegExp, PatchFileStatus]> = [
  [/^new file mode /, "added"],
  [/^deleted file mode /, "deleted"],
  [/^rename from /, "renamed"],
  [/^copy from /, "copied"],
];

const statusOf = (lines: ReadonlyArray<string>): PatchFileStatus => {
  for (const line of lines) {
    for (const [pattern, status] of HEADER_STATUS) if (pattern.test(line)) return status;
  }

  return lines.some((l) => l.startsWith("@@") || l.startsWith("Binary files"))
    ? "modified"
    : "mode-changed";
};

/** Header and counts of one file's patch text (the fallback when there is no `fileIndex`). */
export const describeFile = (text: string, offset: number, length: number): PatchFile => {
  const lines = text.split("\n");
  const [, a = "", b = ""] = /^diff --git ("[^"]*"|\S+) ("[^"]*"|\S+)/.exec(lines[0] ?? "") ?? [];
  const status = statusOf(lines.slice(0, 8));
  let additions = 0;
  let deletions = 0;
  let inHunks = false;

  for (const line of lines) {
    if (line.startsWith("@@")) inHunks = true;
    else if (inHunks && line.startsWith("+")) additions++;
    else if (inHunks && line.startsWith("-")) deletions++;
  }

  const newPath = stripSide(b);
  const oldPath = stripSide(a);

  return {
    path: status === "deleted" ? oldPath : newPath,
    oldPath: status === "renamed" || status === "copied" ? oldPath : null,
    status,
    offset,
    length,
    additions,
    deletions,
    binary: lines.some((l) => l.startsWith("Binary files ") || l === "GIT binary patch"),
  };
};

/** The files of a patch, in patch order. */
export const indexPatch = (
  bytes: Uint8Array,
  fileIndex: ReadonlyArray<IndexedFile>
): ReadonlyArray<PatchFile> => {
  if (fileIndex.length > 0) return fileIndex;
  const starts = fileStarts(bytes);
  const decoder = new TextDecoder();

  return starts.map((offset, i) => {
    const end = starts[i + 1] ?? bytes.length;

    return describeFile(decoder.decode(bytes.subarray(offset, end)), offset, end - offset);
  });
};

/** One file's patch text. */
export const fileText = (bytes: Uint8Array, file: PatchFile) =>
  new TextDecoder().decode(bytes.subarray(file.offset, file.offset + file.length));

/** A short fingerprint of a file's patch (FNV-1a), so Viewed resets when the file's diff changes. */
export const fingerprint = (bytes: Uint8Array, file: PatchFile) => {
  let hash = 0x811c9dc5;
  const end = Math.min(bytes.length, file.offset + file.length);

  for (let at = file.offset; at < end; at++) {
    hash ^= bytes[at] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};
