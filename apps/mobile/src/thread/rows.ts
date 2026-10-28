/**
 * The thread as flat rows for a virtualized list (M4): each earlier Turn is
 * one collapsed row until opened, the latest Turn shows its prompt, replies
 * and numbered tool steps; finished calls in a row fold into a run until opened
 * (`steps.ts`). A Turn's rows are cached on its entry, so text streaming into the
 * latest Turn rebuilds only that Turn's rows.
 */
import type { TurnItem, TurnStatus } from "@polaris/protocol";
import { Match } from "effect";
import type { TurnEntry } from "./fold.ts";
import { runKind, runSummary, toolLabel } from "./steps.ts";

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
    | {
        readonly kind: "run";
        /** "Read 3 files, ran 4 commands", as the Desktop App says it. */
        readonly summary: string;
        readonly open: boolean;
        /** As a step's: the last of a group closes it with a hairline. */
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
  label: toolLabel(item),
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

interface Placed {
  readonly id: string;
  readonly item: TurnItem | null;
  readonly piece: Exclude<Piece, null>;
}

/** Its items in order, then what is still live, then text streaming into no item yet. */
const placedOf = (entry: TurnEntry): ReadonlyArray<Placed> => {
  const live = new Set(entry.live.map((item) => item.id));
  const items = [...entry.items, ...entry.live];

  const streamingOnly = entry.streaming
    .filter((text) => !items.some((item) => item.id === text.itemId))
    .map((text) => ({
      id: text.itemId,
      item: null,
      piece: { kind: "text", row: "reply", text: text.text } as const,
    }));

  return [
    ...items.flatMap((item) => {
      const piece = pieceOf(item);

      // A live item is still running whatever its status says: never folded.
      return piece === null ? [] : [{ id: item.id, item: live.has(item.id) ? null : item, piece }];
    }),
    ...streamingOnly,
  ];
};

/** Consecutive finished calls as runs; a lone call stays a step. */
const segments = (placed: ReadonlyArray<Placed>) => {
  const out: Array<{ readonly run: ReadonlyArray<Placed> } | { readonly one: Placed }> = [];
  let pending: Array<Placed> = [];

  const flush = () => {
    if (pending.length > 1) out.push({ run: pending });
    else pending.forEach((one) => out.push({ one }));
    pending = [];
  };

  for (const one of placed) {
    if (one.item !== null && runKind(one.item) !== null) pending.push(one);
    else {
      flush();
      out.push({ one });
    }
  }

  flush();

  return out;
};

/** The rows of one opened Turn: its prompt, then its items, each run folded unless `isOpen`. */
const openRows = (
  entry: TurnEntry,
  isOpen: (runKey: string) => boolean
): ReadonlyArray<ThreadRow> => {
  const { turn } = entry;
  const rows: Array<ThreadRow> = [];
  let step = 0;

  if (turn.prompt.trim() !== "")
    rows.push({ kind: "prompt", key: `${turn.id}:p`, turnId: turn.id, text: turn.prompt });

  const streamed = new Map(entry.streaming.map((live) => [live.itemId, live.text]));

  const place = ({ id, piece }: Placed, shown: boolean) => {
    if (piece.kind === "step") {
      step++;

      if (shown)
        rows.push({
          ...piece,
          key: `${turn.id}:${id}`,
          turnId: turn.id,
          index: pad(step),
          last: false,
        });

      return;
    }

    const text = streamed.get(id) ?? piece.text;

    if (text.trim() !== "")
      rows.push({ kind: piece.row, key: `${turn.id}:${id}`, turnId: turn.id, text });
  };

  for (const segment of segments(placedOf(entry))) {
    if ("one" in segment) {
      place(segment.one, true);
      continue;
    }

    const key = `${turn.id}:run:${segment.run[0]?.id ?? ""}`;
    const open = isOpen(key);
    const summary = runSummary(segment.run.flatMap(({ item }) => (item === null ? [] : [item])));
    rows.push({ kind: "run", key, turnId: turn.id, summary, open, last: false });
    segment.run.forEach((one) => place(one, open));
  }

  const grouped = (row: ThreadRow | undefined) => row?.kind === "step" || row?.kind === "run";

  return rows.map((row, index) =>
    grouped(row) && !grouped(rows[index + 1]) ? { ...row, last: true } : row
  );
};

export type StepRow = Extract<ThreadRow, { kind: "step" }>;

/** Every step of a Turn, folded or not, numbered as the thread numbers them. */
export const turnSteps = (entry: TurnEntry): ReadonlyArray<StepRow> =>
  openRows(entry, () => true).filter((row): row is StepRow => row.kind === "step");

const earlierRow = (entry: TurnEntry): ThreadRow => ({
  kind: "earlier",
  key: `${entry.turn.id}:e`,
  turnId: entry.turn.id,
  number: entry.turn.userTurnNumber ?? entry.turn.index + 1,
  title: firstLine(entry.turn.replyPreview ?? entry.turn.prompt) || "No reply",
  status: entry.turn.status,
});

const opened = new WeakMap<
  TurnEntry,
  { readonly runs: string; readonly rows: ReadonlyArray<ThreadRow> }
>();

const collapsed = new WeakMap<TurnEntry, ThreadRow>();

/** Which of the Turn's runs are open, as a cache key. */
const openRuns = (entry: TurnEntry, expanded: ReadonlySet<string>) => {
  const prefix = `${entry.turn.id}:run:`;

  return [...expanded].filter((key) => key.startsWith(prefix)).join("\n");
};

const cachedOpen = (entry: TurnEntry, expanded: ReadonlySet<string>) => {
  const runs = openRuns(entry, expanded);
  const held = opened.get(entry);

  if (held !== undefined && held.runs === runs) return held.rows;
  const rows = openRows(entry, (key) => expanded.has(key));
  opened.set(entry, { runs, rows });

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
 * A run opens when its row's key is in `expanded`.
 */
export const threadRows = (
  turns: ReadonlyArray<TurnEntry>,
  expanded: ReadonlySet<string>
): ReadonlyArray<ThreadRow> => {
  const last = turns.length - 1;

  return turns.flatMap((entry, index) => {
    if (index === last) return cachedOpen(entry, expanded);

    const header = cachedEarlier(entry);

    return expanded.has(entry.turn.id) ? [header, ...cachedOpen(entry, expanded)] : [header];
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
