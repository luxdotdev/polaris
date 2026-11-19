/**
 * A list of file changes as the conversation draws them (ENG-979): "Writing index.html" while
 * the tool input streams, then each file's first changed lines, highlighted, opening in place.
 * Without a patch (a Daemon before `session.file-patches`) each file is one row, as before.
 */
import { cn, GitStatusLetter } from "@polaris/ui";
import { useMemo, useState } from "react";
import { useThemeType } from "../../../diffs/useThemeType.ts";
import { OpenInEditorButton } from "../../../editor-links/index.ts";
import { themeFor } from "../../../highlight/index.ts";
import { chooseCollapse, initialOpen } from "../../model/collapse.ts";
import { plural } from "../../model/format.ts";
import type { FileChangeKind, FileChangeView, ItemStatus } from "../../model/items.ts";
import { type Hue, LiveMark, WELL } from "../marks.tsx";
import { highlightLines, type Runs } from "./highlightLines.ts";
import { isLine, type PatchRow, patchRows, patchShown, patchView } from "./patchRows.ts";

const GIT_STATUS = {
  add: "added",
  modify: "modified",
  delete: "deleted",
} as const satisfies Record<FileChangeKind, string>;

const FILL = { add: "bg-diff-added-bg", remove: "bg-diff-removed-bg", context: "" } as const;

const SIGN = { add: "+", remove: "−", context: "" } as const;

const SIGN_COLOUR = {
  add: "text-diff-added-text",
  remove: "text-diff-removed-text",
  context: "",
} as const;

export interface FileChangesProps {
  /** Keys each file's open state, so it survives the virtualized list's unmounts. */
  readonly id: string;
  readonly changes: ReadonlyArray<FileChangeView>;
  readonly status: ItemStatus;
  /** The tool input still streams: the first file shows as "Writing …". */
  readonly writing: boolean;
  readonly hue: Hue;
  /** Opens the file in the Changes panel; without it a click opens the Turn's diff. */
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly onOpenDiff: () => void;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const Counts = ({ added, removed }: { readonly added: number; readonly removed: number }) => (
  <span className="text-code-inline tabular flex shrink-0 gap-1.5 font-mono" data-testid="counts">
    <span className="text-diff-added-text">+{added}</span>
    <span className="text-diff-removed-text">−{removed}</span>
  </span>
);

const Code = ({ runs }: { readonly runs: Runs }) =>
  runs.map((run, at) =>
    run.color === null ? (
      run.text
    ) : (
      <span key={at} style={{ color: run.color }}>
        {run.text}
      </span>
    )
  );

const Line = ({ row, runs }: { readonly row: PatchRow; readonly runs: Runs }) => {
  if (row.kind === "gap")
    return <div className="text-text-faint h-5 pl-[38px] leading-5 select-none">⋯</div>;

  if (row.kind === "no-newline")
    return (
      <div className="text-caption text-text-subtle h-5 pl-[38px] leading-5">
        No newline at end of file
      </div>
    );

  return (
    <div className={cn("flex h-5 min-w-max pr-3 leading-5", FILL[row.kind])} data-line={row.kind}>
      <span className={cn("w-[38px] shrink-0 pr-2.5 text-right", SIGN_COLOUR[row.kind])}>
        {SIGN[row.kind]}
      </span>
      <code className="text-text-default whitespace-pre">
        <Code runs={runs} />
      </code>
    </div>
  );
};

const Preview = ({
  id,
  path,
  diff,
}: {
  readonly id: string;
  readonly path: string;
  readonly diff: string;
}) => {
  const key = `edit:${id}:${path}`;
  const [open, setOpen] = useState(() => initialOpen(key));
  const theme = themeFor(useThemeType());
  const all = useMemo(() => patchRows(diff), [diff]);
  const view = patchView(all, open);
  const code = view.rows.filter(isLine);

  const runs = highlightLines(
    code.map((row) => row.text),
    path,
    theme
  );

  let next = 0;

  const toggle = () => {
    chooseCollapse(key, !open);
    setOpen(!open);
  };

  return (
    <div className="flex flex-col pb-1" data-testid="file-patch">
      <div className="text-code-inline overflow-x-auto font-mono">
        {view.rows.map((row, at) => (
          <Line
            key={`${row.kind}:${at}`}
            row={row}
            runs={isLine(row) ? (runs[next++] ?? []) : []}
          />
        ))}
      </div>
      {view.more ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="text-caption text-text-subtle hover:text-text-default h-6 cursor-default self-start pl-[38px] text-left"
        >
          {open ? "Show fewer lines" : `Show all ${plural(view.total, "line")}`}
        </button>
      ) : null}
    </div>
  );
};

interface FileRowProps extends Omit<FileChangesProps, "changes"> {
  readonly change: FileChangeView;
  /** This row is the file being written. */
  readonly writingThis: boolean;
}

const FileRow = ({
  change,
  writingThis,
  status,
  hue,
  id,
  onOpenFile,
  onOpenDiff,
}: FileRowProps) => {
  const shown = patchShown(change.patch);
  const patch = change.patch;

  return (
    <div className="flex flex-col" data-testid="file-change-row" data-shown={shown}>
      <div
        className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
        data-menu-path={change.kind === "delete" ? undefined : change.path}
        data-menu-diff=""
      >
        <button
          type="button"
          title={change.path}
          onClick={() => (onOpenFile === undefined ? onOpenDiff() : onOpenFile(change.path))}
          className="gap-row-x flex h-full min-w-0 flex-1 cursor-default items-center pl-3 text-left"
        >
          {writingThis ? (
            <>
              <span className="flex w-4 shrink-0 justify-center">
                <LiveMark hue={hue} />
              </span>
              <span className="text-body text-text-strong min-w-0 flex-1 truncate">
                Writing <span className="text-code-inline font-mono">{baseName(change.path)}</span>
              </span>
            </>
          ) : (
            <>
              <GitStatusLetter status={GIT_STATUS[change.kind]} />
              <span
                className={cn(
                  "text-code-inline text-text-default flex-1 truncate font-mono",
                  change.kind === "delete" && "line-through"
                )}
              >
                {change.path}
              </span>
            </>
          )}
          {patch === undefined ? null : <Counts added={patch.added} removed={patch.removed} />}
          {patch === undefined && status === "running" && !writingThis ? (
            <span className="text-caption text-text-subtle">writing</span>
          ) : null}
        </button>
        {change.kind === "delete" ? null : (
          <OpenInEditorButton
            path={change.path}
            className="opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
      {shown === "lines" && patch !== undefined ? (
        <Preview id={id} path={change.path} diff={patch.diff} />
      ) : null}
    </div>
  );
};

/** Every file of one change, or of a command that changed several ("Changed 2 files"). */
export const FileChanges = ({ changes, writing, ...rest }: FileChangesProps) => (
  <div className={cn(WELL, "flex flex-col overflow-hidden py-1.5")} data-testid="file-change">
    {changes.map((change, at) => (
      <FileRow
        key={change.path}
        change={change}
        writingThis={writing && at === 0 && change.patch === undefined}
        writing={writing}
        {...rest}
      />
    ))}
  </div>
);
