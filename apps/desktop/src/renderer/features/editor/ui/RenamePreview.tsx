/**
 * The multi-file rename preview (DESIGN.md, Editor: Language refactors; Paper L7, L7b): each file
 * with its change count and diff, then Cancel (esc) and "Rename in N files" (⌘↵). Accepting lands
 * the changes as unsaved edits; one ⌘Z undoes them everywhere (`refactors/undo.ts`).
 */
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@polaris/ui";
import { useState, type KeyboardEvent } from "react";
import type { Preview } from "../refactors/coordinator.ts";
import {
  linesPhrase,
  plural,
  renameFiles,
  renameNames,
  visibleHunks,
  type DiffLine,
  type Hunk,
  type RenameFile,
} from "../refactors/renamePreview.ts";

const MONO = "font-mono text-[12px] leading-5 whitespace-pre [font-variant-ligatures:none]";

const Chevron = ({ open }: { readonly open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-text-subtle shrink-0">
    <path
      d={open ? "M3 4.5l3 3 3-3" : "M4.5 3l3 3-3 3"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Line = ({ line, kind }: { readonly line: DiffLine; readonly kind: "removed" | "added" }) => (
  <div
    data-kind={kind}
    className={cn(
      "flex h-5 items-center",
      kind === "removed" ? "bg-diff-removed-bg" : "bg-diff-added-bg"
    )}
  >
    <span className={cn(MONO, "text-text-faint w-10 shrink-0 pr-2 text-right")}>{line.line}</span>
    <span
      className={cn(MONO, kind === "removed" ? "text-diff-removed-text" : "text-diff-added-text")}
    >
      {kind === "removed" ? "-  " : "+  "}
      {line.text}
    </span>
  </div>
);

const HunkView = ({ hunk }: { readonly hunk: Hunk }) => (
  <>
    <div className="text-caption text-text-faint flex h-6 items-end pb-0.5 pl-12">
      Line {hunk.line}
    </div>
    {hunk.removed.map((line) => (
      <Line key={`r${line.line}`} line={line} kind="removed" />
    ))}
    {hunk.added.map((line) => (
      <Line key={`a${line.line}`} line={line} kind="added" />
    ))}
  </>
);

const FileRow = ({
  file,
  open,
  onToggle,
}: {
  readonly file: RenameFile;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => {
  const [all, setAll] = useState(false);
  const shown = visibleHunks(file.hunks, all);
  const hidden = file.hunks.slice(shown.length);

  return (
    <li
      data-testid="rename-file"
      className={cn("rounded-row flex flex-col overflow-hidden", open && "bg-fill-hover")}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="rounded-row hover:bg-fill-hover focus-visible:outline-starlight flex h-8 items-center gap-2 px-2.5 text-left focus-visible:outline-2"
      >
        <Chevron open={open} />
        <span className={cn("text-body truncate", open ? "text-text-strong" : "text-text-default")}>
          {file.name}
        </span>
        {file.folder === "" ? null : (
          <span className="text-caption text-text-faint truncate">{file.folder}</span>
        )}
        {file.unsaved ? (
          <span className="text-caption text-text-subtle shrink-0">· unsaved edits kept</span>
        ) : null}
        <span className="flex-1" />
        <span className="text-caption text-text-subtle w-[72px] shrink-0 text-right">
          {plural(file.hunks.length, "change")}
        </span>
      </button>
      {open ? (
        <div className="border-hairline bg-bg flex flex-col overflow-x-auto border-t pt-0.5 pb-2">
          {shown.map((hunk) => (
            <HunkView key={hunk.line} hunk={hunk} />
          ))}
          {hidden.length === 0 ? null : (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="text-caption text-text-faint hover:text-text-subtle flex h-6 items-end pb-0.5 pl-12 text-left"
            >
              {plural(hidden.length, "more change")}, {linesPhrase(hidden)}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
};

export interface RenamePreviewProps {
  readonly preview: Preview;
  readonly root: string;
  /** The file the rename started in, listed and opened first. */
  readonly first: string | null;
  /** "TypeScript 7.0.2", "TypeScript · bundled". */
  readonly provider: string;
  readonly host: string;
  readonly busy: boolean;
  /** One line saying why nothing was renamed, or null. */
  readonly failure: string | null;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
}

/** The card's content (header, files, footer); the dialog wraps it. */
export const RenamePreviewCard = ({
  preview,
  root,
  provider,
  host,
  busy,
  failure,
  onAccept,
  onCancel,
  first,
}: RenamePreviewProps) => {
  const files = renameFiles(preview, root).toSorted(
    (a, b) => Number(b.path === first) - Number(a.path === first)
  );

  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(files.slice(0, 1).map((f) => f.path))
  );

  const names = renameNames(preview.proposal.label);
  const changes = files.reduce((sum, file) => sum + file.hunks.length, 0);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);

      if (next.has(path)) next.delete(path);
      else next.add(path);

      return next;
    });

  return (
    <>
      <div className="border-hairline flex flex-col gap-1 border-b px-5 pt-4 pb-3.5">
        <h2 className="flex items-baseline gap-2">
          {names === null ? (
            <span className="text-heading text-text-strong">{preview.proposal.label}</span>
          ) : (
            <>
              <span className="text-heading text-text-strong">Rename</span>
              <code className="text-text-default font-mono text-[14px] [font-variant-ligatures:none]">
                {names.from}
              </code>
              <span className="text-heading text-text-strong">to</span>
              <code className="text-text-default font-mono text-[14px] [font-variant-ligatures:none]">
                {names.to}
              </code>
            </>
          )}
        </h2>
        <p className="text-caption text-text-subtle">
          {plural(changes, "change")} in {plural(files.length, "file")} · {provider} · {host}
        </p>
      </div>
      <ul aria-label="Files" className="flex min-h-0 flex-col gap-1 overflow-y-auto p-1.5">
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            open={open.has(file.path)}
            onToggle={() => toggle(file.path)}
          />
        ))}
      </ul>
      <div className="border-hairline bg-surface-sunken flex items-center gap-3 border-t py-3 pr-4 pl-5">
        {failure === null ? (
          <span className="text-caption text-text-subtle truncate">
            Edits stay unsaved in each file · ⌘Z undoes the rename everywhere
          </span>
        ) : (
          <span role="alert" className="text-caption text-text-strong">
            {failure}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-control bg-fill-selected text-body text-text-default focus-visible:outline-starlight flex h-[30px] shrink-0 items-center gap-2 px-3 focus-visible:outline-2"
        >
          Cancel <span className="text-caption text-text-faint">esc</span>
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy || failure !== null}
          className="rounded-control bg-text-strong text-body text-bg focus-visible:outline-starlight flex h-[30px] shrink-0 items-center gap-2 px-3 font-medium focus-visible:outline-2 disabled:opacity-55"
        >
          {busy ? "Renaming…" : `Rename in ${plural(files.length, "file")}`}
          <span className="text-caption text-text-faint">⌘↵</span>
        </button>
      </div>
    </>
  );
};

/** ⌘↵ accepts while the card has focus; esc (the dialog's own) cancels. */
export const acceptKey =
  (busy: boolean, failure: string | null, onAccept: () => void) =>
  (event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "preventDefault">) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();

    if (!busy && failure === null) onAccept();
  };

export const RenamePreview = (props: RenamePreviewProps) => (
  <Dialog open onOpenChange={(next) => (next || props.busy ? undefined : props.onCancel())}>
    <DialogContent
      placement="top"
      data-testid="rename-preview"
      onKeyDown={acceptKey(props.busy, props.failure, props.onAccept)}
      onOpenAutoFocus={(event) => {
        // The card takes focus, so ⌘↵ and esc work without a ring on either button.
        event.preventDefault();
        // SAFETY: Radix fires this on the dialog content element it renders.
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
      className="top-[72px] max-h-[calc(100vh-144px)] w-[760px] p-0"
    >
      <DialogTitle className="sr-only">{props.preview.proposal.label}</DialogTitle>
      <DialogDescription className="sr-only">
        Review each file's changes, then rename or cancel.
      </DialogDescription>
      <RenamePreviewCard {...props} />
    </DialogContent>
  </Dialog>
);
