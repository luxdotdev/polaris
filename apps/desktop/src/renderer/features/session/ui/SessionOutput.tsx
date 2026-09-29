/**
 * Output for one Agent Session (artboard 5's Changes tab): the chosen Turn's
 * diff as file cards, virtualized by line. A lightweight unified renderer:
 * no syntax or word highlights, which come with Pierre Diffs in Review (M2).
 */
import { isKnownHarness, type TurnId } from "@polaris/protocol";
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  cn,
  Dither,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  type Harness,
} from "@polaris/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Predicate } from "effect";
import { useRef, useState } from "react";
import type { TurnView } from "../../../store/sessionModel.ts";
import { type DiffRow, diffRows, ROW_HEIGHT } from "../diffRows.ts";
import { useSession } from "../hooks.ts";
import { totals } from "../model/diff.ts";
import { plural } from "../model/format.ts";
import { showTurnDiff, uiKey, useSessionUi } from "../state.ts";
import { type DiffState, useTurnDiff } from "../turnDiff.ts";
import type { SessionViewProps } from "./SessionIntent.tsx";

const CARD = "mx-4 border-x border-hairline bg-surface-sunken";

const LINE_FILL = { add: "bg-diff-added-bg", remove: "bg-diff-removed-bg", context: "" } as const;

const SIGN = { add: "+", remove: "−", context: "" } as const;

const Counts = ({ added, removed }: { readonly added: number; readonly removed: number }) => (
  <>
    <span className="text-code-inline text-diff-added tabular font-mono">+{added}</span>
    <span className="text-code-inline text-diff-removed tabular font-mono">−{removed}</span>
  </>
);

const RowView = ({ row, onFold }: { row: DiffRow; onFold: (path: string) => void }) => {
  switch (row.kind) {
    case "file":
      return (
        <button
          type="button"
          onClick={() => onFold(row.file.path)}
          aria-expanded={!row.folded}
          className={cn(
            CARD,
            "rounded-t-row flex h-9 w-[calc(100%-2rem)] cursor-default items-center gap-2.5 border-t px-3 text-left",
            row.folded ? "rounded-b-row border-b" : "border-hairline border-b"
          )}
          data-testid="diff-file"
        >
          {row.folded ? (
            <ChevronRightIcon size={12} className="text-text-subtle" />
          ) : (
            <ChevronDownIcon size={12} className="text-text-subtle" />
          )}
          <span className="text-code-inline text-text-default truncate font-mono">
            {row.file.oldPath === null ? row.file.path : `${row.file.oldPath} → ${row.file.path}`}
          </span>
          <Counts added={row.file.added} removed={row.file.removed} />
          <span className="flex-1" />
          {row.file.status === "modified" ? null : (
            <span className="text-caption text-text-faint">{row.file.status}</span>
          )}
        </button>
      );
    case "hunk":
      return (
        <div
          className={cn(
            CARD,
            "text-code-inline text-text-faint flex h-6 items-center truncate px-3 font-mono"
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
            "text-code-inline flex h-5 items-center font-mono leading-5",
            LINE_FILL[row.line.kind]
          )}
        >
          <span className="text-text-faint tabular w-[42px] shrink-0 pr-2 text-right">
            {row.line.newNumber ?? ""}
          </span>
          <span
            className={cn(
              "w-[22px] shrink-0 text-center",
              row.line.kind === "add" ? "text-diff-added" : "text-diff-removed"
            )}
          >
            {SIGN[row.line.kind]}
          </span>
          <span className="text-text-default flex-1 truncate whitespace-pre">{row.line.text}</span>
        </div>
      );
    case "note":
      return (
        <div className={cn(CARD, "text-caption text-text-faint flex h-7 items-center px-3")}>
          {row.text}
        </div>
      );
    case "foot":
      return <div className={cn(CARD, "rounded-b-row h-1.5 border-b")} />;
    case "gap":
      return <div className="h-3" />;
  }
};

const DiffList = ({
  rows,
  onFold,
}: {
  rows: ReadonlyArray<DiffRow>;
  onFold: (p: string) => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto select-text" data-testid="diff">
      <div ref={virtualizer.containerRef} className="relative w-full">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];

          return row === undefined ? null : (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
            >
              <RowView row={row} onFold={onFold} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TurnMenu = ({
  turns,
  current,
  onPick,
}: {
  readonly turns: ReadonlyArray<TurnView>;
  readonly current: TurnView;
  readonly onPick: (turnId: string) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" data-testid="diff-turn">
        Turn {current.turn.index + 1}
        <ChevronDownIcon size={10} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={current.turn.id} onValueChange={onPick}>
        {turns.toReversed().map((t) => (
          <DropdownMenuRadioItem key={t.turn.id} value={t.turn.id}>
            <span className="tabular">Turn {t.turn.index + 1}</span>
            <span className="text-caption text-text-faint max-w-56 truncate pl-3">
              {t.turn.prompt}
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

const Empty = ({
  harness,
  title,
  fact,
}: {
  harness: Harness | null;
  title: string;
  fact?: string;
}) => (
  <div className="grid flex-1 place-items-center" data-testid="diff-empty">
    <EmptyState
      hue={harness ?? "starlight"}
      icon={harness === null ? null : <Dither hue={harness} size={16} />}
      title={title}
      fact={fact}
    />
  </div>
);

const Body = ({
  state,
  harness,
  folded,
  onFold,
}: {
  state: DiffState;
  harness: Harness | null;
  folded: ReadonlySet<string>;
  onFold: (path: string) => void;
}) => {
  switch (state.kind) {
    case "loading":
      return <div className="flex-1" />;
    case "error":
      return <Empty harness={harness} title="No diff to show" fact={errorText(state)} />;
    case "too-large":
      return (
        <Empty
          harness={harness}
          title="This diff is too large to show here"
          fact={`${Math.round(state.bytes / 1024)} KB · open it in review`}
        />
      );
    case "ready":
      return state.files.length === 0 ? (
        <Empty harness={harness} title="This turn changed no files" />
      ) : (
        <DiffList rows={diffRows(state.files, folded)} onFold={onFold} />
      );
  }
};

const revisionOf = (view: TurnView) =>
  `${view.turn.status}:${view.turn.checkpointAfter ?? ""}:${view.items.filter((i) => Predicate.isTagged(i, "FileChange")).length}`;

export const SessionOutput = ({ hostKey, sessionId }: SessionViewProps) => {
  const model = useSession(hostKey, sessionId);
  const kind = model.session?.harness ?? "";
  const harness: Harness | null = isKnownHarness(kind) ? kind : null;
  const key = uiKey(hostKey, sessionId);
  const ui = useSessionUi(key);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const current =
    model.turns.find((t) => t.turn.id === ui.diffTurnId) ?? model.turns.at(-1) ?? null;

  const turnId: TurnId | null = current?.turn.id ?? null;

  const state = useTurnDiff(
    hostKey,
    model.session?.cwd ?? "",
    sessionId,
    turnId,
    current === null ? "" : revisionOf(current)
  );

  const sum = state.kind === "ready" ? totals(state.files) : null;

  const fold = (path: string) => {
    const next = new Set(folded);

    if (!next.delete(path)) next.add(path);
    setFolded(next);
  };

  return (
    <section
      aria-label="Output"
      className="bg-bg flex h-full min-h-0 min-w-0 flex-col"
      data-testid="session-output"
    >
      <div className="border-hairline flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <Button variant="secondary" className="text-text-strong" aria-pressed>
          Changes
        </Button>
        <span className="flex-1" />
        {current === null ? null : (
          <TurnMenu turns={model.turns} current={current} onPick={(id) => showTurnDiff(key, id)} />
        )}
        {sum === null ? null : (
          <>
            <span className="text-caption text-text-faint tabular">
              · {plural(sum.files, "file")}
            </span>
            <Counts added={sum.added} removed={sum.removed} />
          </>
        )}
      </div>
      {current === null ? (
        <Empty harness={harness} title="No changes yet" fact="Each turn's diff shows here" />
      ) : (
        <Body state={state} harness={harness} folded={folded} onFold={fold} />
      )}
    </section>
  );
};
