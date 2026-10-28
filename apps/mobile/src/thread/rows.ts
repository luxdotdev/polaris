/**
 * The thread as flat rows for a virtualized list (M4): each earlier Turn is
 * one collapsed row until opened, the latest Turn shows its prompt, replies
 * and numbered tool steps. A Turn's rows are cached on its entry, so text
 * streaming into the latest Turn rebuilds only that Turn's rows.
 */
import type { TurnItem, TurnStatus } from "@polaris/protocol";
import { Match } from "effect";
import type { TurnEntry } from "./fold.ts";

export type StepTone = "done" | "active" | "failed";

interface RowBase {
  readonly key: string;
  readonly turnId: string;
}

export type ThreadRow = RowBase &
  (
    | {
        readonly kind: "earlier";
        /** "Turn 23", one-based like the Desktop App. */
        readonly number: number;
        readonly title: string;
        readonly status: TurnStatus;
      }
    | { readonly kind: "prompt"; readonly text: string }
    | { readonly kind: "reply"; readonly text: string }
    | {
        readonly kind: "step";
        /** Two digits, counted within its Turn: "01". */
        readonly index: string;
        readonly label: string;
        readonly detail: string;
        readonly tone: StepTone;
        /** Files it touched, to mark the one a Critical finding is in. */
        readonly paths: ReadonlyArray<string>;
        /** The last step of a run of steps, which closes its group with a hairline. */
        readonly last: boolean;
      }
    | { readonly kind: "error"; readonly text: string }
  );

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const firstLine = (text: string) => {
  const trimmed = text.trim();
  const end = trimmed.indexOf("\n");

  return end === -1 ? trimmed : trimmed.slice(0, end);
};

const toneOf = (status: "running" | "completed" | "failed" | "declined"): StepTone =>
  Match.value(status).pipe(
    Match.when("running", (): StepTone => "active"),
    Match.when("completed", (): StepTone => "done"),
    Match.orElse((): StepTone => "failed")
  );

const VERBS = { add: "Created", modify: "Edited", delete: "Deleted" } as const;

type Step = Omit<Extract<ThreadRow, { kind: "step" }>, "key" | "turnId" | "index" | "last">;

const fileStep = (item: Extract<TurnItem, { _tag: "FileChange" }>): Step => {
  const paths = item.changes.map((change) => change.path);
  const only = item.changes.length === 1 ? item.changes[0] : undefined;
  const running = item.status === "running";

  const label =
    only === undefined
      ? `${running ? "Editing" : "Edited"} ${item.changes.length} files`
      : `${running ? "Writing" : VERBS[only.kind]} ${basename(only.path)}`;

  return {
    kind: "step",
    label,
    detail: failedDetail(item.status),
    tone: toneOf(item.status),
    paths,
  };
};

const failedDetail = (status: "running" | "completed" | "failed" | "declined") =>
  Match.value(status).pipe(
    Match.when("declined", () => "declined"),
    Match.when("failed", () => "failed"),
    Match.orElse(() => "")
  );

const commandStep = (item: Extract<TurnItem, { _tag: "CommandExecution" }>): Step => ({
  kind: "step",
  label: firstLine(item.command),
  detail:
    item.status === "failed" && item.exitCode !== null
      ? `exit ${item.exitCode}`
      : failedDetail(item.status),
  tone: toneOf(item.status),
  paths: [],
});

const toolStep = (item: Extract<TurnItem, { _tag: "ToolCall" }>): Step => ({
  kind: "step",
  label: item.title ?? item.mcp?.tool ?? item.name,
  detail: failedDetail(item.status),
  tone: toneOf(item.status),
  paths: [],
});

const planStep = (item: Extract<TurnItem, { _tag: "Plan" }>): Step => {
  const done = item.steps.filter((step) => step.status === "completed").length;

  return {
    kind: "step",
    label: "Updated the plan",
    detail: `${done} of ${item.steps.length}`,
    tone: done === item.steps.length ? "done" : "active",
    paths: [],
  };
};

type Piece =
  | { readonly kind: "text"; readonly row: "reply" | "prompt" | "error"; readonly text: string }
  | Step
  | null;

const pieceOf = (item: TurnItem): Piece =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      AssistantMessage: ({ text }): Piece => ({ kind: "text", row: "reply", text }),
      UserMessage: ({ text }): Piece => ({ kind: "text", row: "prompt", text }),
      Error: ({ message }): Piece => ({ kind: "text", row: "error", text: message }),
      // Thinking stays out of the phone's thread.
      Reasoning: (): Piece => null,
      CommandExecution: commandStep,
      FileChange: fileStep,
      ToolCall: toolStep,
      Plan: planStep,
    })
  );

const pad = (n: number) => n.toString().padStart(2, "0");

/** The rows of one opened Turn: its prompt, then its items in order, then what is still live. */
const openRows = (entry: TurnEntry): ReadonlyArray<ThreadRow> => {
  const { turn } = entry;
  const rows: Array<ThreadRow> = [];
  let step = 0;

  if (turn.prompt.trim() !== "")
    rows.push({ kind: "prompt", key: `${turn.id}:p`, turnId: turn.id, text: turn.prompt });

  const streamed = new Map(entry.streaming.map((live) => [live.itemId, live.text]));
  const items = [...entry.items, ...entry.live];

  const streamingOnly = entry.streaming
    .filter((live) => !items.some((item) => item.id === live.itemId))
    .map((live) => ({
      id: live.itemId,
      piece: { kind: "text", row: "reply", text: live.text } as const,
    }));

  const pieces = [
    ...items.map((item) => ({ id: item.id, piece: pieceOf(item) })),
    ...streamingOnly,
  ];

  for (const { id, piece } of pieces) {
    if (piece === null) continue;

    if (piece.kind === "step") {
      step++;
      rows.push({
        ...piece,
        key: `${turn.id}:${id}`,
        turnId: turn.id,
        index: pad(step),
        last: false,
      });
      continue;
    }

    const text = streamed.get(id) ?? piece.text;

    if (text.trim() !== "")
      rows.push({ kind: piece.row, key: `${turn.id}:${id}`, turnId: turn.id, text });
  }

  return rows.map((row, index) =>
    row.kind === "step" && rows[index + 1]?.kind !== "step" ? { ...row, last: true } : row
  );
};

const earlierRow = (entry: TurnEntry): ThreadRow => ({
  kind: "earlier",
  key: `${entry.turn.id}:e`,
  turnId: entry.turn.id,
  number: entry.turn.userTurnNumber ?? entry.turn.index + 1,
  title: firstLine(entry.turn.replyPreview ?? entry.turn.prompt) || "No reply",
  status: entry.turn.status,
});

const opened = new WeakMap<TurnEntry, ReadonlyArray<ThreadRow>>();

const collapsed = new WeakMap<TurnEntry, ThreadRow>();

const cachedOpen = (entry: TurnEntry) => {
  const held = opened.get(entry);

  if (held !== undefined) return held;
  const rows = openRows(entry);
  opened.set(entry, rows);

  return rows;
};

const cachedEarlier = (entry: TurnEntry) => {
  const held = collapsed.get(entry);

  if (held !== undefined) return held;
  const row = earlierRow(entry);
  collapsed.set(entry, row);

  return row;
};

/**
 * Oldest first. Every Turn but the latest is collapsed to one row unless its
 * id is in `expanded`; an opened earlier Turn keeps its collapsed row as a header.
 */
export const threadRows = (
  turns: ReadonlyArray<TurnEntry>,
  expanded: ReadonlySet<string>
): ReadonlyArray<ThreadRow> => {
  const last = turns.length - 1;

  return turns.flatMap((entry, index) => {
    if (index === last) return cachedOpen(entry);

    const header = cachedEarlier(entry);

    return expanded.has(entry.turn.id) ? [header, ...cachedOpen(entry)] : [header];
  });
};

/** The newest ended Turn among those whose rows are on screen, for the read position. */
export const newestEndedOnScreen = (
  turns: ReadonlyArray<TurnEntry>,
  visibleTurnIds: ReadonlyArray<string>
): TurnEntry | null => {
  const ids = new Set(visibleTurnIds);
  let newest: TurnEntry | null = null;

  for (const entry of turns) {
    if (entry.turn.status !== "working" && ids.has(entry.turn.id)) newest = entry;
  }

  return newest;
};
