/**
 * A unified diff (as `git.diff` returns it) parsed into files, hunks and
 * lines for Output's Changes view. Only what the lightweight renderer needs:
 * no word-level highlights and no syntax, which wait for Pierre Diffs in Review.
 */

export type LineKind = "context" | "add" | "remove";

export interface DiffLine {
  readonly kind: LineKind;
  readonly text: string;
  /** Null on the side the line doesn't exist. */
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
}

export interface DiffHunk {
  readonly header: string;
  readonly lines: ReadonlyArray<DiffLine>;
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: FileStatus;
  readonly binary: boolean;
  readonly added: number;
  readonly removed: number;
  readonly hunks: ReadonlyArray<DiffHunk>;
}

/** The first line a file's diff adds or changes, on the new side: where "Open in editor" lands. */
export const firstChangedLine = (file: DiffFile): number | null => {
  for (const hunk of file.hunks) {
    const line = hunk.lines.find((l) => l.kind !== "context" && l.newNumber !== null);

    if (line !== undefined) return line.newNumber;
  }

  return null;
};

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const stripPrefix = (path: string) => path.replace(/^[ab]\//, "");

interface FileDraft {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  added: number;
  removed: number;
  hunks: Array<{ header: string; lines: Array<DiffLine> }>;
  oldLine: number;
  newLine: number;
}

const newFile = (line: string): FileDraft => {
  const [, a = "", b = ""] = /^diff --git (\S+) (\S+)/.exec(line) ?? [];

  return {
    path: stripPrefix(b),
    oldPath: stripPrefix(a),
    status: "modified",
    binary: false,
    added: 0,
    removed: 0,
    hunks: [],
    oldLine: 0,
    newLine: 0,
  };
};

const addBody = (file: FileDraft, line: string) => {
  const hunk = file.hunks.at(-1);

  if (hunk === undefined) return;
  const sign = line[0];
  const text = line.slice(1);

  if (sign === "+") {
    hunk.lines.push({ kind: "add", text, oldNumber: null, newNumber: file.newLine++ });
    file.added++;
  } else if (sign === "-") {
    hunk.lines.push({ kind: "remove", text, oldNumber: file.oldLine++, newNumber: null });
    file.removed++;
  } else if (sign === " " || line === "") {
    hunk.lines.push({
      kind: "context",
      text,
      oldNumber: file.oldLine++,
      newNumber: file.newLine++,
    });
  }
};

const META: ReadonlyArray<readonly [string, (file: FileDraft, rest: string) => void]> = [
  ["new file mode", (f) => (f.status = "added")],
  ["deleted file mode", (f) => (f.status = "deleted")],
  ["rename from ", (f, rest) => ((f.status = "renamed"), (f.oldPath = rest))],
  ["rename to ", (f, rest) => (f.path = rest)],
  ["Binary files", (f) => (f.binary = true)],
  ["GIT binary patch", (f) => (f.binary = true)],
  ["--- ", () => undefined],
  ["+++ ", () => undefined],
];

const applyMeta = (file: FileDraft, line: string): boolean => {
  for (const [prefix, apply] of META) {
    if (!line.startsWith(prefix)) continue;
    apply(file, line.slice(prefix.length));

    return true;
  }

  return false;
};

const startHunk = (file: FileDraft, line: string): boolean => {
  const match = HUNK.exec(line);

  if (match === null) return false;
  file.oldLine = Number(match[1]);
  file.newLine = Number(match[2]);
  file.hunks.push({ header: line, lines: [] });

  return true;
};

const finish = (file: FileDraft): DiffFile => ({
  path: file.path,
  oldPath: file.status === "renamed" ? file.oldPath : null,
  status: file.status,
  binary: file.binary,
  added: file.added,
  removed: file.removed,
  hunks: file.hunks,
});

const readLine = (file: FileDraft, line: string) => {
  if (file.hunks.length === 0 && applyMeta(file, line)) return;

  if (startHunk(file, line)) return;

  if (line.startsWith("\\")) return; // "\ No newline at end of file"
  addBody(file, line);
};

export const parseUnifiedDiff = (patch: string): ReadonlyArray<DiffFile> => {
  const files: Array<DiffFile> = [];
  let current: FileDraft | null = null;

  for (const line of patch.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current !== null) files.push(finish(current));
      current = newFile(line);
    } else if (current !== null) readLine(current, line);
  }

  if (current !== null) files.push(finish(current));

  return files;
};

export interface DiffTotals {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export const totals = (files: ReadonlyArray<DiffFile>): DiffTotals => ({
  files: files.length,
  added: files.reduce((n, f) => n + f.added, 0),
  removed: files.reduce((n, f) => n + f.removed, 0),
});
