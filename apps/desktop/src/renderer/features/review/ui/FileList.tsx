/**
 * The file list under the risk column (Paper R1 1XP-0): Viewed progress, then a row per
 * file with its Viewed checkbox and highest Severity glyph; viewed files fold into one
 * row, generated files into another. Virtualized, since a list-only Review can hold tens of thousands of files.
 */
import { CheckIcon, cn, SeverityGlyph } from "@polaris/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { type FileListRow, fileListRows, type Fold, type TestsFold } from "../model/fileList.ts";
import type { ReviewFile } from "../model/layout.ts";
import type { MarkSeverity } from "../model/marks.ts";
import type { ViewedProgress } from "../model/viewed.ts";

export interface FileListProps {
  readonly files: ReadonlyArray<ReviewFile>;
  readonly viewedOf: (file: ReviewFile) => boolean;
  /** Viewed, then changed: the row says so. */
  readonly changedOf: (file: ReviewFile) => boolean;
  readonly severities: ReadonlyMap<string, MarkSeverity>;
  readonly progress: ViewedProgress;
  readonly current: string | null;
  readonly notice: string | null;
  readonly onOpen: (key: string) => void;
  readonly onViewed: (key: string, viewed: boolean) => void;
  /** "Hide tests": null when the Review has no test file it could hide. */
  readonly tests: TestsFold | null;
  readonly onTestsHidden: (hidden: boolean) => void;
}

const ROW_HEIGHT = 28;

const Check = ({ checked }: { readonly checked: boolean }) => (
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

interface RowProps {
  readonly row: FileListRow;
  readonly props: FileListProps;
  readonly onToggle: (fold: Fold) => void;
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const foldLabel = (row: Extract<FileListRow, { kind: "fold" }>) => {
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

const FOLD_TITLES: Partial<Record<Fold, (row: Extract<FileListRow, { kind: "fold" }>) => string>> =
  {
    generated: () => "Lockfiles and generated files; not counted as viewed",
    tests: (row) =>
      row.open
        ? "Hide test files on this Mac; tests with findings stay"
        : `Show ${plural(row.count, "test file", "test files")} in the diff · Hidden on this Mac · tests with findings stay`,
  };

const FoldRow = ({
  row,
  onToggle,
}: {
  readonly row: Extract<FileListRow, { kind: "fold" }>;
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

const Row = ({ row, props, onToggle }: RowProps) => {
  if (row.kind === "fold") return <FoldRow row={row} onToggle={onToggle} />;

  const { file, viewed } = row;
  const severity = props.severities.get(file.file.path);

  return (
    <div
      data-testid="review-file-row"
      data-path={file.file.path}
      className={cn(
        "rounded-row hover:bg-fill-hover flex h-tree-row items-center gap-row-x px-gap",
        props.current === file.key && "bg-fill-hover"
      )}
    >
      <label className="flex shrink-0 cursor-default items-center" title="Viewed">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={viewed}
          aria-label={`Viewed ${file.file.path}`}
          onChange={(event) => props.onViewed(file.key, event.target.checked)}
        />
        <Check checked={viewed} />
      </label>
      <button
        type="button"
        onClick={() => props.onOpen(file.key)}
        className={cn(
          "text-caption min-w-0 flex-1 cursor-default truncate text-left font-mono",
          viewed ? "text-text-subtle" : "text-text-default",
          props.current === file.key && "text-text-strong"
        )}
        title={file.file.path}
      >
        {file.file.path}
      </button>
      {props.changedOf(file) && (
        <span className="text-caption text-text-subtle shrink-0" title="Changed since viewed">
          changed
        </span>
      )}
      {severity !== undefined && <SeverityGlyph severity={severity} tone="text" />}
    </div>
  );
};

export const FileList = (props: FileListProps) => {
  const [open, setOpen] = useState<ReadonlySet<Fold>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = fileListRows(props.files, props.viewedOf, open, props.tests);

  const toggle = (fold: Fold) =>
    fold === "tests"
      ? props.onTestsHidden(props.tests?.hidden !== true)
      : setOpen((now) => {
          const next = new Set(now);

          if (!next.delete(fold)) next.add(fold);

          return next;
        });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => {
      const row = rows[index];

      return row === undefined || row.kind === "fold" ? `fold:${row?.fold}` : row.file.key;
    },
    overscan: 12,
  });

  return (
    <section data-testid="review-files" className="px-gap pt-panel flex min-h-0 flex-1 flex-col">
      <div className="gap-row-x px-gap pb-gap flex items-center">
        <span className="text-caption text-text-subtle">Files</span>
        <span className="bg-surface-sunken flex h-1 flex-1 rounded-full">
          <span
            className="bg-text-subtle h-1 rounded-full"
            style={{ width: `${Math.round(props.progress.fraction * 100)}%` }}
          />
        </span>
        <span className="text-caption text-text-subtle tabular" data-testid="review-progress">
          {props.progress.label}
        </span>
      </div>
      {props.notice !== null && (
        <p className="text-caption text-text-subtle px-gap pb-gap" data-testid="review-scale">
          {props.notice}
        </p>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];

            return row === undefined ? null : (
              <div
                key={item.key}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Row row={row} props={props} onToggle={toggle} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
