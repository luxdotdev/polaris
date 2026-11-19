/**
 * Output for one Agent Session (artboard 5's Changes tab): the whole session's diff, or the
 * chosen Turn's (every Turn the Harness started in it included), as file cards, virtualized by line. A light
 * unified renderer: code coloured by the syntax tokens from Pierre's worker pool
 * (useDiffSyntax.ts), drawn plain until ready; no word highlights, which stay in Review.
 * A chosen Subagent adds its tab after Changes (`SubagentOutput.tsx`) and shows in place.
 */
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  cn,
  DisclosureChevron,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PixelSparkleIcon,
} from "@polaris/ui";
import { isKnownHarness, type SessionId } from "@polaris/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { type DiffRow, diffRows, ROW_HEIGHT } from "../diffRows.ts";
import { type DiffSyntax, lineSyntax } from "../diffSyntax.ts";
import { isWindowsHost } from "../../../shell/hostPlatform.ts";
import { useHost, useSession } from "../hooks.ts";
import { useDiffSyntax } from "../useDiffSyntax.ts";
import { LineCode } from "./LineCode.tsx";
import {
  ChangesCommentsProvider,
  CommentsElsewhere,
  CommentsRow,
  LineNumber,
  useChangesMarks,
} from "./changesComments.tsx";
import { fileCardId, FileScrollbar, useFileScroll } from "./FileScrollbar.tsx";
import type { FileScroll } from "../fileScroll.ts";
import { turnOpening } from "../model/conversation.ts";
import { openingView, type TurnGroup } from "../model/turnGroups.ts";
import { type DiffFile, firstChangedLine, totals } from "../model/diff.ts";
import { plural } from "../model/format.ts";
import { revealFile, showSubagent, showTurnDiff, uiKey, useSessionUi } from "../state.ts";
import { type DiffState, spanRevision, useTurnDiff } from "../turnDiff.ts";
import { hideOutput } from "../output/actions.ts";
import { showHint } from "../output/OutputRail.tsx";
import { useFilesTick } from "../output/watch.ts";
import { type ScopeNote, useDiffScope } from "../output/sessionScope.ts";
import { ScopeNoteLine } from "../output/ScopeNote.tsx";
import type { SessionViewProps } from "./SessionIntent.tsx";
import { OutputTab, SubagentPane, SubagentTab, useShownSubagent } from "./SubagentOutput.tsx";
import { EditorPlaceProvider, OpenInEditorButton } from "../../editor-links/index.ts";
import { leaveBrowser } from "../output/browser.ts";
import { BrowserOutputTab, SessionBrowser, useBrowserShown } from "./BrowserOutput.tsx";
import { leaveSimulator } from "../output/simulator.ts";
import { SessionSimulator, SimulatorOutputTab, useSimulatorShown } from "./SimulatorOutput.tsx";
import { useSettings } from "../../settings/index.ts";
import {
  DataOutput,
  hasData,
  setDataOutputShown,
  useDataOutputShown,
  useTurnData,
} from "../../data/output/index.ts";
import {
  setTracesOutputShown,
  TracesOutput,
  TracesOutputTab,
  type TracesTab,
  useTracesTab,
} from "../../traces/output/index.ts";

const CARD = "mx-4 border-x border-hairline bg-surface-sunken";

const LINE_FILL = { add: "bg-diff-added-bg", remove: "bg-diff-removed-bg", context: "" } as const;

const SIGN = { add: "+", remove: "−", context: "" } as const;

/** Output highlights one Turn's hunks: the editor's diff tabs' pool size, shared if one runs. */
const OUTPUT_POOL_SIZE = 2;

const Counts = ({ added, removed }: { readonly added: number; readonly removed: number }) => (
  <>
    <span className="text-code-inline text-diff-added-text tabular font-mono">+{added}</span>
    <span className="text-code-inline text-diff-removed-text tabular font-mono">−{removed}</span>
  </>
);

interface RowViewProps {
  readonly row: DiffRow;
  readonly path: string;
  readonly syntax: DiffSyntax;
  readonly wrap: boolean;
  readonly scroll: FileScroll;
  /** Whether this row's file is wider than its card, so its foot carries a scrollbar. */
  readonly overflows: boolean;
  readonly onFold: (path: string) => void;
}

const RowView = ({ row, path, syntax, wrap, scroll, overflows, onFold }: RowViewProps) => {
  switch (row.kind) {
    case "file":
      return (
        <div
          id={fileCardId(row.file.path)}
          className={cn(
            CARD,
            "rounded-t-row group/file flex h-9 w-[calc(100%-2rem)] items-center border-t pr-1.5 transition-[border-radius] duration-120 ease-out",
            row.folded ? "rounded-b-row border-b" : "border-hairline border-b"
          )}
        >
          <button
            type="button"
            onClick={() => onFold(row.file.path)}
            aria-expanded={!row.folded}
            className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2.5 px-3 text-left"
            data-testid="diff-file"
          >
            <DisclosureChevron open={!row.folded} size={12} className="text-text-subtle" />
            <span className="text-code-inline text-text-default truncate font-mono">
              {row.file.oldPath === null ? row.file.path : `${row.file.oldPath} → ${row.file.path}`}
            </span>
            <Counts added={row.file.added} removed={row.file.removed} />
            <span className="flex-1" />
            {row.file.status === "modified" ? null : (
              <span className="text-caption text-text-subtle">{row.file.status}</span>
            )}
          </button>
          {row.file.status === "deleted" ? null : (
            <OpenInEditorButton
              path={row.file.path}
              line={firstChangedLine(row.file)}
              className="opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
            />
          )}
        </div>
      );
    case "hunk":
      return (
        <div
          className={cn(
            CARD,
            "text-code-inline text-text-subtle flex h-6 items-center truncate px-3 font-mono"
          )}
        >
          {row.header}
        </div>
      );
    case "line":
      return (
        <div
          className={cn(
            CARD,
            "text-code-inline flex font-mono leading-5",
            wrap ? "min-h-5 items-start" : "h-5 items-center",
            LINE_FILL[row.line.kind]
          )}
          data-scroll-file={path}
        >
          <span className="text-text-subtle tabular w-[42px] shrink-0 pr-2 text-right">
            <LineNumber path={path} line={row.line} />
          </span>
          <span
            className={cn(
              "w-[22px] shrink-0 text-center",
              row.line.kind === "add" ? "text-diff-added-text" : "text-diff-removed-text"
            )}
          >
            {SIGN[row.line.kind]}
          </span>
          <LineCode
            text={row.line.text}
            runs={lineSyntax(syntax, path, row.line)}
            wrap={wrap}
            onCode={(span) => scroll.code(path, span)}
          />
        </div>
      );
    case "note":
      return (
        <div className={cn(CARD, "text-caption text-text-subtle flex h-7 items-center px-3")}>
          {row.text}
        </div>
      );
    case "foot":
      return overflows ? (
        <div
          className={cn(CARD, "rounded-b-row flex h-3 items-center border-b pr-1.5 pl-16")}
          data-scroll-file={path}
        >
          <FileScrollbar path={path} scroll={scroll} />
        </div>
      ) : (
        <div className={cn(CARD, "rounded-b-row h-1.5 border-b")} />
      );
    case "comments":
      return <CommentsRow row={row} path={path} card={CARD} />;
    case "gap":
      return <div className="h-3" />;
  }
};

/** Each row's file path: a line row's colours are looked up by it. */
const rowPaths = (rows: ReadonlyArray<DiffRow>) => {
  let path = "";

  return rows.map((row) => {
    if (row.kind === "file") path = row.file.path;

    return path;
  });
};

/** A file to scroll to once listed (the rail's file rows), and how to say it's done. */
export interface Reveal {
  readonly path: string | null;
  readonly done: () => void;
}

interface DiffListProps {
  readonly files: ReadonlyArray<DiffFile>;
  readonly folded: ReadonlySet<string>;
  readonly onFold: (path: string) => void;
  readonly reveal?: Reveal | undefined;
}

const DiffList = ({ files, folded, onFold, reveal }: DiffListProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const marks = useChangesMarks();
  const rows = useMemo(() => diffRows(files, folded, marks), [files, folded, marks]);
  const paths = useMemo(() => rowPaths(rows), [rows]);
  const syntax = useDiffSyntax(files);
  const wrap = useSettings((s) => s.appearance.wordWrap);
  const { scroll, overflowing } = useFileScroll(scrollRef, probeRef, files, wrap);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ROW_HEIGHT[rows[index]?.kind ?? "line"],
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 24,
    paddingStart: 16,
    paddingEnd: 16,
    directDomUpdates: true,
  });

  const revealPath = reveal?.path ?? null;

  useEffect(() => {
    if (revealPath === null) return;
    const index = rows.findIndex((r) => r.kind === "file" && r.file.path === revealPath);

    if (index >= 0) virtualizer.scrollToIndex(index, { align: "start" });
    reveal?.done();
  }, [revealPath, rows, virtualizer, reveal]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto select-text"
      data-testid="diff"
    >
      <div ref={virtualizer.containerRef} className="relative w-full">
        {/* 100 code cells, in a box of no width: a cell's width, for how far each file scrolls. */}
        <div
          aria-hidden
          className="pointer-events-none invisible absolute top-0 left-0 w-0 overflow-hidden"
        >
          <span ref={probeRef} className="text-code-inline font-mono whitespace-pre">
            {"0".repeat(100)}
          </span>
        </div>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];

          return row === undefined ? null : (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
            >
              <RowView
                row={row}
                path={paths[item.index] ?? ""}
                syntax={syntax}
                wrap={wrap}
                scroll={scroll}
                overflows={overflowing.has(paths[item.index] ?? "")}
                onFold={onFold}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Lazy, as Review and the editor's diff tab are: the pool's `?worker` import only loads under Vite.
const DiffWorkers = lazy(() =>
  import("../../diffs/workers.tsx").then((m) => ({ default: m.DiffWorkers }))
);

/** A Turn's files as the Changes tab draws them, highlighted in the diffs' worker pool. */
export const TurnChanges = (props: DiffListProps) => (
  // The list that stays takes the reveal: the fallback's scroll is lost when it swaps.
  <Suspense fallback={<DiffList {...props} reveal={undefined} />}>
    <DiffWorkers poolSize={OUTPUT_POOL_SIZE}>
      <DiffList {...props} />
    </DiffWorkers>
  </Suspense>
);

/** The Turn menu's entry for the whole session. */
const ALL_TURNS = "all";

/** All turns, then one entry per shown Turn; a Turn's diff covers the Turns the Harness started in it. */
const TurnMenu = ({
  groups,
  narrowed,
  whole,
  onPick,
}: {
  readonly groups: ReadonlyArray<TurnGroup>;
  /** The Turn picked; null shows the whole session. */
  readonly narrowed: TurnGroup | null;
  /** The Host can diff the whole session. */
  readonly whole: boolean;
  readonly onPick: (turnId: string | null) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" data-testid="diff-turn">
        {narrowed === null ? "All turns" : `Turn ${narrowed.number}`}
        <ChevronDownIcon size={10} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup
        value={narrowed?.id ?? ALL_TURNS}
        onValueChange={(id) => onPick(id === ALL_TURNS ? null : id)}
      >
        {whole ? <DropdownMenuRadioItem value={ALL_TURNS}>All turns</DropdownMenuRadioItem> : null}
        {groups.toReversed().map((g) => (
          <DropdownMenuRadioItem key={g.id} value={g.id}>
            <span className="tabular">Turn {g.number}</span>
            <span className="text-caption text-text-subtle max-w-56 truncate pl-3">
              {turnOpening(openingView(g).turn)}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const errorText = (state: Extract<DiffState, { kind: "error" }>) => {
  if (/repositor/i.test(state.message)) return "This workspace isn't a git repository";

  if (state.code === "NotFound") return "This turn has no checkpoint yet";

  return state.message;
};

const Empty = ({ title, fact }: { title: string; fact?: string }) => (
  <div className="grid flex-1 place-items-center" data-testid="diff-empty">
    {/* The pane tier (Paper 5SH-1): a Starlight tile with the pixel sparkle, never blank. */}
    <EmptyState
      icon={<PixelSparkleIcon size={24} className="text-text-strong" />}
      title={title}
      fact={fact}
    />
  </div>
);

/** Nothing changed in the scope shown: one line, so the panel keeps its place and calm. */
const NoChanges = ({ text }: { text: string }) => (
  <p className="text-caption text-text-subtle px-4 py-3" data-testid="diff-empty">
    {text}
  </p>
);

const Body = ({
  state,
  narrowed,
  folded,
  onFold,
  reveal,
}: {
  state: DiffState;
  narrowed: boolean;
  folded: ReadonlySet<string>;
  onFold: (path: string) => void;
  reveal: Reveal;
}) => {
  switch (state.kind) {
    case "loading":
      return <div className="flex-1" />;
    case "error":
      return <Empty title="No diff to show" fact={errorText(state)} />;
    case "too-large":
      return (
        <Empty
          title="This diff is too large to show here"
          fact={`${Math.round(state.bytes / 1024)} KB · open it in review`}
        />
      );
    case "ready":
      return state.files.length === 0 ? (
        <NoChanges
          text={narrowed ? "This turn changed no files" : "No changes in this session yet"}
        />
      ) : (
        <TurnChanges files={state.files} folded={folded} onFold={onFold} reveal={reveal} />
      );
  }
};

/** The Changes tab's body: the session's or the chosen Turn's diff, or why there is none. */
const Changes = ({
  current,
  note,
  onPick,
  ...body
}: {
  readonly current: TurnGroup | null;
  readonly narrowed: boolean;
  /** The whole session's: why it isn't every Turn. */
  readonly note: ScopeNote | null;
  /** Narrows to a Turn, from the Comments it can't place. */
  readonly onPick: (turnId: string) => void;
  readonly state: DiffState;
  readonly folded: ReadonlySet<string>;
  readonly onFold: (path: string) => void;
  readonly reveal: Reveal;
}) =>
  current === null ? (
    <Empty title="No changes yet" fact="The session's changes show here" />
  ) : (
    <>
      <ScopeNoteLine note={note} />
      {body.narrowed ? null : <CommentsElsewhere onPick={onPick} />}
      <Body {...body} />
    </>
  );

export interface SessionOutputProps extends SessionViewProps {
  /** Tabs in place of the lone Changes label (a Lead's Constellation tab). */
  readonly tabs?: ReactNode;
}

/** Output's Data tab, after Changes: only while the Turn shown touched data. */
export const DataOutputTab = ({
  uiKey: key,
  on,
  visible,
  onPick,
}: {
  readonly uiKey: string;
  readonly on: boolean;
  readonly visible: boolean;
  readonly onPick: () => void;
}) =>
  visible ? (
    <OutputTab
      id="data"
      on={on}
      onClick={() => {
        onPick();
        setDataOutputShown(key, true);
      }}
    >
      Data
    </OutputTab>
  ) : null;

/** The header's diff controls: all turns or which Turn, and its file and line counts. */
const DiffSummary = ({
  groups,
  narrowed,
  whole,
  state,
  onPick,
}: {
  readonly groups: ReadonlyArray<TurnGroup>;
  readonly narrowed: TurnGroup | null;
  readonly whole: boolean;
  readonly state: DiffState;
  readonly onPick: (turnId: string | null) => void;
}) => {
  // An empty scope says so in its one line; no "0 files" beside it.
  const sum = state.kind === "ready" && state.files.length > 0 ? totals(state.files) : null;

  return (
    <>
      {groups.length === 0 ? null : (
        <TurnMenu groups={groups} narrowed={narrowed} whole={whole} onPick={onPick} />
      )}
      {sum === null ? null : (
        <>
          <span className="text-caption text-text-subtle tabular">
            · {plural(sum.files, "file")}
          </span>
          <Counts added={sum.added} removed={sum.removed} />
        </>
      )}
    </>
  );
};

type ShownSession = ReturnType<typeof useSession>["session"];

const harnessOf = (session: ShownSession) =>
  session !== null && isKnownHarness(session.harness) ? session.harness : null;

/** Where Open in Editor opens the session's files. */
const placeOf = (hostKey: string, session: ShownSession, windows: boolean) =>
  session === null
    ? null
    : {
        hostKey,
        root: session.cwd,
        workspaceId: session.workspaceId,
        sessionId: session.id,
        windows,
      };

/** The Data tab for the Turn shown: visible when it touched data, shown when picked and nothing else is. */
const useDataTab = (
  hostKey: string,
  sessionId: SessionOutputProps["sessionId"],
  model: ReturnType<typeof useSession>,
  current: TurnGroup | null,
  free: boolean
) => {
  const turnIds = current?.views.map((v) => v.turn.id) ?? [];
  const host = useHost(hostKey);
  const turnData = useTurnData({ hostKey, sessionId, host, model, turnIds });
  const visible = turnData !== null && hasData(turnData);
  const picked = useDataOutputShown(uiKey(hostKey, sessionId)) && visible && free;

  return {
    visible,
    shown:
      picked && turnData !== null && current !== null
        ? { data: turnData, turn: { number: current.number, ids: turnIds } }
        : null,
  };
};

/** Data's or Traces' body while its tab is picked; null otherwise. */
const pickedPane = (
  hostKey: string,
  sessionId: SessionId,
  data: ReturnType<typeof useDataTab>["shown"],
  traces: TracesTab["shown"]
) => {
  if (data !== null) return <DataOutput hostKey={hostKey} sessionId={sessionId} {...data} />;

  return traces === null ? null : <TracesOutput {...traces} />;
};

/** The Browser's or the Simulator's body while its tab is shown; null otherwise. */
const toolPane = ({
  hostKey,
  sessionId,
  session,
  harness,
  browser,
  simulator,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly session: ShownSession;
  readonly harness: ReturnType<typeof harnessOf>;
  readonly browser: boolean;
  readonly simulator: boolean;
}) => {
  if (session === null) return null;

  if (browser)
    return (
      <SessionBrowser
        hostKey={hostKey}
        sessionId={sessionId}
        workspaceId={session.workspaceId}
        harness={harness}
      />
    );

  return simulator ? (
    <SessionSimulator
      hostKey={hostKey}
      sessionId={sessionId}
      workspaceId={session.workspaceId}
      cwd={session.cwd}
      harness={harness}
    />
  ) : null;
};

export const SessionOutput = ({ hostKey, sessionId, tabs }: SessionOutputProps) => {
  const model = useSession(hostKey, sessionId);
  const key = uiKey(hostKey, sessionId);
  const ui = useSessionUi(key);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const subagent = useShownSubagent(hostKey, sessionId);
  const browser = useBrowserShown(hostKey, sessionId, subagent !== null);
  const simulator = useSimulatorShown(hostKey, sessionId, subagent !== null) && !browser;

  const host = useHost(hostKey);

  const { groups, narrowed, whole, shown, span, note } = useDiffScope(
    hostKey,
    sessionId,
    model.turns,
    ui.diffTurnId
  );

  const current = narrowed ?? groups.at(-1) ?? null;
  const isNarrowed = narrowed !== null;
  const free = subagent === null && !browser && !simulator;
  const dataTab = useDataTab(hostKey, sessionId, model, current, free);
  const data = dataTab.shown !== null;
  const tracesTab = useTracesTab(hostKey, sessionId, key, current, free && !data);
  const picked = pickedPane(hostKey, sessionId, dataTab.shown, tracesTab.shown);
  const onChanges = free && picked === null;

  const session = model.session;
  const cwd = session?.cwd ?? null;
  const files = useFilesTick(hostKey, cwd);
  const harness = harnessOf(session);

  const state = useTurnDiff(
    hostKey,
    cwd ?? "",
    sessionId,
    span === null || !onChanges ? null : span,
    shown === null ? "" : spanRevision(shown.views, files)
  );

  const close = () => showSubagent(key, null);

  const changes = () => {
    close();
    leaveBrowser(hostKey, sessionId);
    leaveSimulator(hostKey, sessionId);
    setDataOutputShown(key, false);
    setTracesOutputShown(key, false);
  };

  const fold = (path: string) => {
    const next = new Set(folded);

    if (!next.delete(path)) next.add(path);
    setFolded(next);
  };

  const reveal = useMemo<Reveal>(
    () => ({ path: ui.revealPath, done: () => revealFile(key, null) }),
    [ui.revealPath, key]
  );

  const place = placeOf(hostKey, session, isWindowsHost(host));
  const tool = toolPane({ hostKey, sessionId, session, harness, browser, simulator });

  return (
    <EditorPlaceProvider value={place}>
      <section
        aria-label="Output"
        className="bg-panel flex h-full min-h-0 min-w-0 flex-col"
        data-testid="session-output"
      >
        <div className="border-hairline flex h-11 shrink-0 items-center gap-1 border-b px-3">
          {tabs ?? (
            <OutputTab id="changes" on={onChanges} onClick={changes}>
              Changes
            </OutputTab>
          )}
          <DataOutputTab
            uiKey={key}
            on={data}
            visible={dataTab.visible}
            onPick={() => {
              close();
              leaveBrowser(hostKey, sessionId);
              leaveSimulator(hostKey, sessionId);
              setTracesOutputShown(key, false);
            }}
          />
          <TracesOutputTab tab={tracesTab} uiKey={key} onPick={changes} />
          <BrowserOutputTab
            hostKey={hostKey}
            sessionId={sessionId}
            on={browser}
            harness={harness}
          />
          <SimulatorOutputTab
            hostKey={hostKey}
            sessionId={sessionId}
            on={simulator}
            harness={harness}
          />
          {subagent === null ? null : (
            <SubagentTab shown={subagent} harness={harness} onClose={close} />
          )}
          <span className="flex-1" />
          {onChanges ? (
            <DiffSummary
              groups={groups}
              narrowed={narrowed}
              whole={whole}
              state={state}
              onPick={(id) => showTurnDiff(key, id)}
            />
          ) : null}
          {session === null ? null : (
            <IconButton
              size="sm"
              label="Hide output"
              shortcut={showHint()}
              icon={<ChevronRightIcon size={14} />}
              onClick={() => hideOutput({ hostKey, workspaceId: session.workspaceId }, sessionId)}
            />
          )}
        </div>
        {tool !== null ? (
          tool
        ) : picked !== null ? (
          picked
        ) : subagent === null ? (
          <ChangesCommentsProvider
            hostKey={hostKey}
            sessionId={sessionId}
            group={current}
            whole={!isNarrowed}
            groups={groups}
          >
            <Changes
              current={current}
              narrowed={isNarrowed}
              note={note}
              onPick={(id) => showTurnDiff(key, id)}
              state={state}
              folded={folded}
              onFold={fold}
              reveal={reveal}
            />
          </ChangesCommentsProvider>
        ) : (
          <SubagentPane
            shown={subagent}
            harness={harness}
            target={{ hostKey, sessionId }}
            onClose={close}
            onOpenDiff={() => {
              showTurnDiff(key, subagent.card.subagent.turnId);
              close();
            }}
          />
        )}
      </section>
    </EditorPlaceProvider>
  );
};
