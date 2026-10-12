/**
 * The file list's rows (Paper R1 1XP-0, R10, R11): a file with its Viewed checkbox and
 * highest Severity glyph, and a fold standing for viewed, generated or hidden test files.
 */
import { CheckIcon, cn, SeverityGlyph } from "@polaris/ui";
import type { Fold } from "../model/fileList.ts";
import type { ReviewFile } from "../model/layout.ts";
import type { MarkSeverity } from "../model/marks.ts";

export const Check = ({ checked }: { readonly checked: boolean }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex size-3.5 shrink-0 items-center justify-center rounded-[4px]",
      checked ? "bg-text-subtle text-bg" : "border-text-faint border"
    )}
  >
    {checked && <CheckIcon size={10} strokeWidth={2.5} />}
  </span>
);

export const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export interface FoldRowModel {
  readonly fold: Fold;
  readonly count: number;
  readonly open: boolean;
}

const foldLabel = (row: FoldRowModel) => {
  if (row.fold === "tests")
    return row.open
      ? `Hide ${plural(row.count, "test", "tests")}`
      : `+ ${plural(row.count, "test", "tests")} hidden`;

  const what =
    row.fold === "viewed"
      ? plural(row.count, "viewed file", "viewed files")
      : `${row.count.toLocaleString("en-US")} generated`;

  return `${row.open ? "Hide" : "+"} ${what}`;
};

const FOLD_TITLES: Partial<Record<Fold, (row: FoldRowModel) => string>> = {
  generated: () => "Lockfiles and generated files; not counted as viewed",
  tests: (row) =>
    row.open
      ? "Hide test files on this Mac; tests with findings stay"
      : `Show ${plural(row.count, "test file", "test files")} in the diff · Hidden on this Mac · tests with findings stay`,
};

export const FoldRow = ({
  row,
  onToggle,
}: {
  readonly row: FoldRowModel;
  readonly onToggle: (fold: Fold) => void;
}) => (
  <button
    type="button"
    onClick={() => onToggle(row.fold)}
    aria-expanded={row.fold === "tests" ? undefined : row.open}
    aria-pressed={row.fold === "tests" ? !row.open : undefined}
    data-testid={`review-files-${row.fold}`}
    title={FOLD_TITLES[row.fold]?.(row)}
    className="text-caption text-text-subtle hover:bg-fill-hover rounded-row h-tree-row gap-row-x px-gap flex w-full cursor-default items-center font-mono"
  >
    {row.fold === "viewed" ? (
      <Check checked />
    ) : (
      <span aria-hidden="true" className="size-3.5 shrink-0" />
    )}
    {foldLabel(row)}
  </button>
);

export interface FileRowProps {
  readonly file: ReviewFile;
  readonly viewed: boolean;
  readonly changed: boolean;
  readonly severity: MarkSeverity | undefined;
  readonly current: boolean;
  /** Under an open group: indented to the group's label. */
  readonly nested?: boolean;
  readonly onOpen: (key: string) => void;
  readonly onViewed: (key: string, viewed: boolean) => void;
}

export const FileRow = ({
  file,
  viewed,
  changed,
  severity,
  current,
  nested = false,
  onOpen,
  onViewed,
}: FileRowProps) => (
  <div
    data-testid="review-file-row"
    data-path={file.file.path}
    className={cn(
      "rounded-row hover:bg-fill-hover flex h-tree-row items-center gap-row-x pr-gap",
      nested ? "pl-[48px]" : "pl-gap",
      current && "bg-fill-hover"
    )}
  >
    <label className="flex shrink-0 cursor-default items-center" title="Viewed">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={viewed}
        aria-label={`Viewed ${file.file.path}`}
        onChange={(event) => onViewed(file.key, event.target.checked)}
      />
      <Check checked={viewed} />
    </label>
    <button
      type="button"
      onClick={() => onOpen(file.key)}
      className={cn(
        "text-caption min-w-0 flex-1 cursor-default truncate text-left font-mono",
        viewed ? "text-text-subtle" : "text-text-default",
        current && "text-text-strong"
      )}
      title={file.file.path}
    >
      {file.file.path}
    </button>
    {changed && (
      <span className="text-caption text-text-subtle shrink-0" title="Changed since viewed">
        changed
      </span>
    )}
    {severity !== undefined && <SeverityGlyph severity={severity} tone="text" />}
  </div>
);
