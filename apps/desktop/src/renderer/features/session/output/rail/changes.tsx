/**
 * The rail's Changes block (Paper R1, R2): the session's totals and its first five files, each
 * with its git letter and counts; a file opens the panel scrolled to it.
 */
import { cn, GitStatusLetter } from "@polaris/ui";
import type { SessionId } from "@polaris/protocol";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { SessionModel } from "../../../../store/sessionModel.ts";
import type { DiffFile } from "../../model/diff.ts";
import { plural } from "../../model/format.ts";
import { type DiffState, spanRevision, useTurnDiff } from "../../turnDiff.ts";
import type { GitFacts } from "../gitStatus.ts";
import { useDiffScope } from "../sessionScope.ts";
import { middleCut, railChanges } from "./model.ts";
import { openAtFile, openChanges } from "./open.ts";
import { ChangesIcon, ROW, Section, Slot } from "./parts.tsx";

const basename = (path: string) => path.split("/").at(-1) ?? path;

/** How many mono cells fit in `box`, measured from its own text; null until laid out. */
const useCells = (box: RefObject<HTMLSpanElement | null>) => {
  const [cells, setCells] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = box.current;

    if (element === null || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      const text = element.firstElementChild;
      const length = text?.textContent?.length ?? 0;

      if (!(text instanceof HTMLElement) || length === 0 || text.scrollWidth === 0) return;
      setCells(Math.floor(element.clientWidth / (text.scrollWidth / length)));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [box]);

  return cells;
};

/**
 * A name cut in its middle so its end shows, in text: CSS's ellipsis is narrower than a mono
 * cell and leaves a gap before the tail.
 */
const FileName = ({ path }: { readonly path: string }) => {
  const box = useRef<HTMLSpanElement>(null);
  const cells = useCells(box);
  const name = basename(path);

  return (
    <span
      ref={box}
      className="text-code-inline text-text-default flex min-w-0 flex-1 overflow-hidden font-mono"
    >
      <span className="whitespace-pre">{cells === null ? name : middleCut(name, cells)}</span>
    </span>
  );
};

const Counts = ({
  added,
  removed,
  className,
}: {
  readonly added: number;
  readonly removed: number;
  readonly className: string;
}) => (
  <span className={cn("tabular shrink-0 font-mono whitespace-pre", className)}>
    {added > 0 ? <span className="text-diff-added-text">+{added}</span> : null}
    {added > 0 && removed > 0 ? " " : null}
    {removed > 0 ? <span className="text-diff-removed-text">−{removed}</span> : null}
  </span>
);

const FileRow = ({
  file,
  onOpen,
}: {
  readonly file: DiffFile;
  readonly onOpen: (path: string) => void;
}) => (
  <button
    type="button"
    title={file.path}
    onClick={() => onOpen(file.path)}
    className={cn(
      ROW,
      "hover:bg-fill-hover h-[calc(var(--spacing-tree-row)-2px)] cursor-default text-left"
    )}
    data-testid="rail-file"
  >
    <GitStatusLetter status={file.status} className="text-[11px]" />
    <FileName path={file.path} />
    <Counts added={file.added} removed={file.removed} className="text-[11px]" />
  </button>
);

/** The latest listed state for this scope, so a refetch never blanks the list. */
const useSteadyDiff = (key: string, state: DiffState) => {
  const [last, setLast] = useState<{ key: string; state: DiffState } | null>(null);

  if (state.kind !== "loading" && (last?.key !== key || last.state !== state))
    setLast({ key, state });

  return state.kind === "loading" && last?.key === key ? last.state : state;
};

/** What the header says when there's no file list: why, in words. */
const headline = (state: DiffState, git: GitFacts) => {
  if (state.kind === "loading") return "Changes";

  if (state.kind === "too-large") return "Too many changes to list";

  if (state.kind === "ready") return state.files.length === 0 ? "No changes yet" : null;

  return git.kind === "ready" && git.changed > 0 ? plural(git.changed, "change") : "No changes yet";
};

export const ChangesBlock = ({
  hostKey,
  sessionId,
  model,
  tick,
  git,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly model: SessionModel;
  readonly tick: number;
  readonly git: GitFacts;
}) => {
  const cwd = model.session?.cwd ?? "";
  const { span, narrowed, shown } = useDiffScope(hostKey, sessionId, model.turns, null);

  const live = useTurnDiff(
    hostKey,
    cwd,
    sessionId,
    span,
    shown === null ? "" : spanRevision(shown.views, tick)
  );

  const state = useSteadyDiff(
    `${hostKey}\u0000${sessionId}`,
    model.turns.length === 0 ? READY_EMPTY : live
  );

  const title = headline(state, git);
  const open = () => openChanges(hostKey, sessionId);

  if (title !== null || state.kind !== "ready")
    return (
      <Section label="Changes">
        <button
          type="button"
          onClick={open}
          className={cn(ROW, "hover:bg-fill-hover h-tree-row cursor-default text-left")}
          data-testid="output-rail-changes"
        >
          <Slot>
            <ChangesIcon />
          </Slot>
          <span className="text-body text-text-default min-w-0 flex-1 truncate">{title}</span>
        </button>
      </Section>
    );
  const rail = railChanges(state.files);

  return (
    <Section label="Changes" className="pt-3">
      <button
        type="button"
        onClick={open}
        className={cn(ROW, "hover:bg-fill-hover h-tree-row cursor-default text-left")}
        data-testid="output-rail-changes"
      >
        <Slot>
          <ChangesIcon />
        </Slot>
        <span className="text-label text-text-default tabular min-w-0 flex-1 truncate">
          {plural(rail.count, "file")}
        </span>
        <Counts added={rail.added} removed={rail.removed} className="text-code-inline" />
      </button>
      <div className={cn(ROW, "pb-1.5")}>
        <Slot />
        <span className="text-caption text-text-subtle truncate">
          {narrowed === null ? "this agent session" : `turn ${narrowed.number}`}
        </span>
      </div>
      {rail.shown.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          onOpen={(path) => openAtFile(hostKey, sessionId, path)}
        />
      ))}
      {rail.more === 0 ? null : (
        <button
          type="button"
          onClick={open}
          className={cn(
            ROW,
            "hover:bg-fill-hover h-[calc(var(--spacing-tree-row)-2px)] cursor-default text-left"
          )}
          data-testid="rail-more"
        >
          <Slot />
          <span className="text-caption text-text-subtle tabular truncate">
            and {rail.more} more
          </span>
        </button>
      )}
    </Section>
  );
};

const READY_EMPTY: DiffState = { kind: "ready", files: [] };
