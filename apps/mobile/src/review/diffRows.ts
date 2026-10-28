/**
 * The diff as one flat list of rows for a virtualized list: each file's header, then (when open)
 * its hunks' lines with Risk Findings placed under the line they flag. Lines come from Pierre
 * Diffs' patch parser (`FileDiffMetadata`); nothing here touches React Native.
 */
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import { type RiskFinding, SEVERITY_RANK, type Severity } from "@polaris/protocol";
import { fileSeverities, highest, isListed, listedFindings, SEVERITIES } from "./model.ts";

export type LineKind = "context" | "add" | "remove";

export interface FileRow {
  readonly kind: "file";
  readonly key: string;
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly open: boolean;
  readonly severities: ReadonlyArray<Severity>;
}

export interface HunkRow {
  readonly kind: "hunk";
  readonly key: string;
  /** `@@ -36,7 +36,8 @@` and the symbol git names. */
  readonly header: string;
}

export interface LineRow {
  readonly kind: "line";
  readonly key: string;
  readonly path: string;
  readonly line: LineKind;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  readonly text: string;
  /** The most severe listed finding covering this line, for the gutter glyph and the 2px rule. */
  readonly mark: Severity | null;
}

export interface FindingRow {
  readonly kind: "finding";
  readonly key: string;
  readonly finding: RiskFinding;
}

/** A line of words in the list: a path the diff doesn't have, or why the diff can't show. */
export interface NoteRow {
  readonly kind: "note";
  readonly key: string;
  readonly text: string;
}

export type DiffRow = FileRow | HunkRow | LineRow | FindingRow | NoteRow;

export interface DiffFileInput {
  readonly diff: FileDiffMetadata;
  readonly added: number;
  readonly removed: number;
}

const trimNewline = (text: string) =>
  text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;

const hunkHeader = (hunk: Hunk) => {
  const specs =
    hunk.hunkSpecs ??
    `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;

  // Pierre's `hunkSpecs` is the whole `@@` line, the symbol git names included.
  if (hunk.hunkSpecs !== undefined || hunk.hunkContext === undefined) return specs.trim();

  return `${specs.trim()} ${hunk.hunkContext.trim()}`;
};

interface Line {
  readonly line: LineKind;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  readonly text: string;
}

/** A hunk's lines in unified order: context, then each change's deletions before its additions. */
export const hunkLines = (file: FileDiffMetadata, hunk: Hunk): ReadonlyArray<Line> => {
  const lines: Array<Line> = [];
  let oldNumber = hunk.deletionStart;
  let newNumber = hunk.additionStart;

  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      for (let i = 0; i < content.lines; i += 1) {
        const text = file.additionLines[content.additionLineIndex + i] ?? "";
        lines.push({ line: "context", oldNumber, newNumber, text: trimNewline(text) });
        oldNumber += 1;
        newNumber += 1;
      }

      continue;
    }

    for (let i = 0; i < content.deletions; i += 1) {
      const text = file.deletionLines[content.deletionLineIndex + i] ?? "";
      lines.push({ line: "remove", oldNumber, newNumber: null, text: trimNewline(text) });
      oldNumber += 1;
    }

    for (let i = 0; i < content.additions; i += 1) {
      const text = file.additionLines[content.additionLineIndex + i] ?? "";
      lines.push({ line: "add", oldNumber: null, newNumber, text: trimNewline(text) });
      newNumber += 1;
    }
  }

  return lines;
};

const covers = (finding: RiskFinding, line: Line) => {
  const number = finding.lines.side === "old" ? line.oldNumber : line.newNumber;

  return number !== null && number >= finding.lines.start && number <= finding.lines.end;
};

const anchors = (finding: RiskFinding, line: Line) =>
  (finding.lines.side === "old" ? line.oldNumber : line.newNumber) === finding.lines.end;

const fileRows = (
  input: DiffFileInput,
  findings: ReadonlyArray<RiskFinding>,
  open: boolean
): ReadonlyArray<DiffRow> => {
  const path = input.diff.name;

  const header: FileRow = {
    kind: "file",
    key: `f:${path}`,
    path,
    added: input.added,
    removed: input.removed,
    open,
    severities: fileSeverities(findings, path),
  };

  const mine = listedFindings(findings).filter((f) => f.path === path);

  // Closing a file never hides a Critical finding: its card stays under the header.
  if (!open)
    return [
      header,
      ...mine
        .filter((f) => f.severity === "critical")
        .map((finding): FindingRow => ({ kind: "finding", key: `r:${finding.id}`, finding })),
    ];

  const placed = new Set<string>();
  const rows: Array<DiffRow> = [header];

  input.diff.hunks.forEach((hunk, h) => {
    rows.push({ kind: "hunk", key: `h:${path}:${h}`, header: hunkHeader(hunk) });

    for (const [i, line] of hunkLines(input.diff, hunk).entries()) {
      const covering = mine.filter((f) => covers(f, line));
      rows.push({
        kind: "line",
        key: `l:${path}:${h}:${i}`,
        path,
        ...line,
        mark: highest(covering.map((f) => f.severity)),
      });

      for (const finding of mine) {
        if (placed.has(finding.id) || !anchors(finding, line)) continue;
        placed.add(finding.id);
        rows.push({ kind: "finding", key: `r:${finding.id}`, finding });
      }
    }
  });

  // A finding whose line the diff doesn't show still shows, under the file's header.
  const unplaced = mine
    .filter((f) => !placed.has(f.id))
    .map((finding): FindingRow => ({ kind: "finding", key: `r:${finding.id}`, finding }));

  return [header, ...unplaced, ...rows.slice(1)];
};

/** Which files open first: any with a listed Critical finding, else the first file. */
export const defaultOpen = (
  files: ReadonlyArray<DiffFileInput>,
  findings: ReadonlyArray<RiskFinding>
): ReadonlySet<string> => {
  const critical = new Set(
    findings.flatMap((f) => (f.severity === "critical" && isListed(f) ? [f.path] : []))
  );

  const open = files.flatMap((f) => (critical.has(f.diff.name) ? [f.diff.name] : []));
  const first = files[0];

  return new Set(open.length > 0 || first === undefined ? open : [first.diff.name]);
};

export type FileOrder = "risk" | "path";

/** Files by their most severe finding (then patch order), or in patch order. */
export const orderFiles = (
  files: ReadonlyArray<DiffFileInput>,
  findings: ReadonlyArray<RiskFinding>,
  order: FileOrder
): ReadonlyArray<DiffFileInput> => {
  if (order === "path") return files;

  const rank = (file: DiffFileInput) => {
    const top = highest(fileSeverities(findings, file.diff.name));

    return top === null ? SEVERITIES.length : SEVERITY_RANK[top];
  };

  return [...files].sort((a, b) => rank(a) - rank(b));
};

/** Listed findings on paths the patch doesn't have, under each path: nothing hides a Critical. */
const absentRows = (
  files: ReadonlyArray<DiffFileInput>,
  findings: ReadonlyArray<RiskFinding>
): ReadonlyArray<DiffRow> => {
  const present = new Set(files.map((f) => f.diff.name));
  const absent = listedFindings(findings).filter((f) => !present.has(f.path));
  const paths = [...new Set(absent.map((f) => f.path))];

  return paths.flatMap((path) => [
    { kind: "note", key: `n:${path}`, text: path } satisfies NoteRow,
    ...absent
      .filter((f) => f.path === path)
      .map((finding): FindingRow => ({ kind: "finding", key: `r:${finding.id}`, finding })),
  ]);
};

export const diffRows = (
  files: ReadonlyArray<DiffFileInput>,
  findings: ReadonlyArray<RiskFinding>,
  open: ReadonlySet<string>
): ReadonlyArray<DiffRow> => [
  ...absentRows(files, findings),
  ...files.flatMap((f) => fileRows(f, findings, open.has(f.diff.name))),
];

/** Review's list: the diff's rows, or why the diff can't show above every listed finding. */
export const reviewRows = (input: {
  readonly files: ReadonlyArray<DiffFileInput>;
  readonly problem: string | null;
  readonly findings: ReadonlyArray<RiskFinding>;
  readonly open: ReadonlySet<string>;
  readonly order: FileOrder;
}): ReadonlyArray<DiffRow> =>
  input.problem === null
    ? diffRows(orderFiles(input.files, input.findings, input.order), input.findings, input.open)
    : [
        { kind: "note", key: "n:problem", text: input.problem },
        ...diffRows([], input.findings, input.open),
      ];

/** Every line of one file, open or not: what "Ask to fix" quotes from. */
export const fileLines = (
  files: ReadonlyArray<DiffFileInput>,
  path: string
): ReadonlyArray<LineRow> =>
  diffRows(
    files.filter((f) => f.diff.name === path),
    [],
    new Set([path])
  ).filter((row): row is LineRow => row.kind === "line");
