/**
 * The file list grouped (Paper R11): a row per group with its viewed count and highest
 * Severity; an open group adds its "why" and its files. A group of generated files counts
 * them instead ("2 generated"), since they stay outside Viewed progress.
 */
import type { FileGroup } from "./groups.ts";
import type { ReviewFile } from "./layout.ts";
import { type MarkSeverity, SEVERITY_ORDER } from "./marks.ts";

export interface GroupHead {
  readonly group: FileGroup;
  readonly open: boolean;
  /** "1 of 3", or "2 generated" when every file is generated. */
  readonly count: string;
  readonly severity: MarkSeverity | null;
}

export type GroupListRow =
  | { readonly kind: "group"; readonly head: GroupHead }
  | { readonly kind: "summary"; readonly key: string; readonly text: string }
  | { readonly kind: "file"; readonly file: ReviewFile; readonly viewed: boolean };

const highest = (
  files: ReadonlyArray<ReviewFile>,
  severities: ReadonlyMap<string, MarkSeverity>
): MarkSeverity | null =>
  files.reduce<MarkSeverity | null>((top, f) => {
    const s = severities.get(f.file.path);

    return s !== undefined && (top === null || SEVERITY_ORDER[s] < SEVERITY_ORDER[top]) ? s : top;
  }, null);

const countOf = (files: ReadonlyArray<ReviewFile>, viewed: (file: ReviewFile) => boolean) => {
  const counted = files.filter((f) => !f.generated);

  if (counted.length === 0) return `${files.length.toLocaleString("en-US")} generated`;

  return `${counted.filter(viewed).length.toLocaleString("en-US")} of ${counted.length.toLocaleString("en-US")}`;
};

export const groupListRows = (
  groups: ReadonlyArray<FileGroup>,
  viewed: (file: ReviewFile) => boolean,
  severities: ReadonlyMap<string, MarkSeverity>,
  open: ReadonlySet<string>
): ReadonlyArray<GroupListRow> =>
  groups.flatMap((group): ReadonlyArray<GroupListRow> => {
    const isOpen = open.has(group.key);

    const head: GroupListRow = {
      kind: "group",
      head: {
        group,
        open: isOpen,
        count: countOf(group.files, viewed),
        severity: highest(group.files, severities),
      },
    };

    if (!isOpen) return [head];

    return [
      head,
      ...(group.summary === null
        ? []
        : [{ kind: "summary" as const, key: group.key, text: group.summary }]),
      ...group.files.map((file) => ({ kind: "file" as const, file, viewed: viewed(file) })),
    ];
  });
