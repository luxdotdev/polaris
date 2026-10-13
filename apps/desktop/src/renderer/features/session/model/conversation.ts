/**
 * The conversation as a flat list of rows, the unit the virtualized list
 * renders: a folded Turn is one summary row, an open one expands into the
 * prompt, each item and the Turn's ending. Turns that were already there when
 * the session was first shown start folded; the latest one then and every
 * Turn after it stay open until the user folds them. Rows are cached per Turn
 * view, so a streaming Turn rebuilds only its own rows each frame.
 */
import type {
  ApprovalRequest,
  Attachment,
  BackgroundTask,
  TurnId,
  TurnItem,
  TurnStatus,
  WorktreeSetupRun,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { entriesInStartOrder, type TurnView } from "../../../store/sessionModel.ts";
import { triggerPhrase } from "./background.ts";
import { completedItemView, liveItemView } from "./items.ts";
import type { Outgoing } from "./outbox.ts";
import { type Entry, groupItems } from "./runs.ts";
import { subagentCard } from "./subagents.ts";

const pad = (n: number) => String(n).padStart(2, "0");

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** When a Turn started, in local time: "14:02" today, "Sep 20 14:02" before. */
export const turnTime = (iso: string, now: Date): string => {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return "";
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;

  if (sameDay(at, now)) return clock;
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return at.getFullYear() === now.getFullYear()
    ? `${day} ${clock}`
    : `${day}, ${at.getFullYear()} ${clock}`;
};

/** Loading Turns older than the feed's first (`session.turns`). */
export type OlderState = "idle" | "loading" | "failed";

/** The row that opens the list while older Turns remain on the Host. */
export const olderRow = (state: OlderState): Row => ({ kind: "older", key: "older", state });

export interface TurnSummary {
  readonly turnId: TurnId;
  /** One-based, as the UI numbers Turns. */
  readonly number: number;
  readonly status: TurnStatus;
  /** The last assistant message's first line, else the prompt's. */
  readonly summary: string;
  readonly files: number;
  /** When the Turn started (ISO). */
  readonly startedAt: string;
}

export type Row =
  | { readonly kind: "setup"; readonly key: string; readonly setup: WorktreeSetupRun }
  | ({ readonly kind: "summary"; readonly key: string } & TurnSummary)
  | {
      readonly kind: "prompt";
      readonly key: string;
      readonly turnId: string;
      /** One-based, as the UI numbers Turns. */
      readonly number: number;
      readonly text: string;
      /** What the prompt carried, in the order attached (previews above the bubble). */
      readonly attachments: ReadonlyArray<Attachment>;
      /** The Model and effort the Turn ran on; null for the Harness's defaults. */
      readonly model: string | null;
      readonly effort: string | null;
      /** When the Turn started (ISO). */
      readonly startedAt: string;
    }
  /** A Turn the Harness started itself: what woke it, in place of a prompt. */
  | {
      readonly kind: "trigger";
      readonly key: string;
      readonly turnId: string;
      readonly number: number;
      readonly text: string;
      readonly model: string | null;
      readonly effort: string | null;
      readonly startedAt: string;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly turnId: string;
      /** One item, a folded tool run, or a Subagent. */
      readonly entry: Entry;
      /** The first agent row of its Turn carries the Harness avatar. */
      readonly lead: boolean;
      /** Its Turn is the session's latest (in-Turn defaults read it). */
      readonly latest: boolean;
      /** When a single item started (ISO); null for runs, Subagents, or no stamp. */
      readonly startedAt: string | null;
    }
  | { readonly kind: "approval"; readonly key: string; readonly request: ApprovalRequest }
  /** A steer or queued follow-up that hasn't landed yet (`outbox.ts`). */
  | { readonly kind: "outgoing"; readonly key: string; readonly entry: Outgoing }
  /** An Idle session's background tasks still running: what it waits on. */
  | {
      readonly kind: "waiting";
      readonly key: string;
      readonly tasks: ReadonlyArray<BackgroundTask>;
    }
  /** Turns before the first one loaded: being fetched as the list reaches the top, or failed. */
  | { readonly kind: "older"; readonly key: string; readonly state: OlderState }
  /** Whatever the session's chrome closes the list with (a Claim card). */
  | { readonly kind: "trailer"; readonly key: string }
  | {
      readonly kind: "ending";
      readonly key: string;
      readonly turnId: string;
      readonly number: number;
      readonly status: "interrupted" | "failed";
      /** The last Turn was interrupted by a restart: offer Continue. */
      readonly canContinue: boolean;
      /** The last Turn failed: offer Retry, which sends its prompt again. */
      readonly canRetry: boolean;
    };

const firstLine = (text: string) => {
  const line = text.trimStart().split("\n", 1)[0] ?? "";

  return line.trim();
};

const touchedFiles = (items: ReadonlyArray<TurnItem>): number => {
  const paths = new Set<string>();

  for (const item of items) {
    if (Predicate.isTagged(item, "FileChange")) for (const c of item.changes) paths.add(c.path);
  }

  return paths.size;
};

type AssistantMessage = Extract<TurnItem, { readonly _tag: "AssistantMessage" }>;

const isMessage = (item: TurnItem): item is AssistantMessage =>
  Predicate.isTagged(item, "AssistantMessage");

/** What started a Turn, in words: its prompt, or what woke a Turn the Harness started. */
export const turnOpening = (turn: TurnView["turn"]): string =>
  turn.trigger === null ? turn.prompt : triggerPhrase(turn.trigger);

export const summarize = (view: TurnView): TurnSummary => {
  const lastMessage = view.items.findLast(isMessage);
  const text = lastMessage === undefined ? turnOpening(view.turn) : lastMessage.text;

  return {
    turnId: view.turn.id,
    number: view.turn.index + 1,
    status: view.turn.status,
    summary: firstLine(text),
    files: touchedFiles(view.items),
    startedAt: view.turn.startedAt,
  };
};

type ToolCallItem = Extract<TurnItem, { readonly _tag: "ToolCall" }>;

/** The Turn's items with each Subagent in place of the call that spawned it (else at the end). */
const turnEntries = (view: TurnView): ReadonlyArray<Entry> => {
  const byParent = new Map(
    view.subagents.map((s) => [s.subagent.parentItemId ?? s.subagent.id, s])
  );

  const placed = new Set<string>();

  const calls = new Map(
    view.items.flatMap((i): Array<readonly [string, ToolCallItem]> =>
      Predicate.isTagged(i, "ToolCall") ? [[i.id, i]] : []
    )
  );

  // In the order the model started them (H2), so a running command stays where it began.
  const items = entriesInStartOrder(view).map((entry) =>
    entry.kind === "completed" ? completedItemView(entry.item) : liveItemView(entry.id, entry.live)
  );

  const entries = groupItems(items).map((entry): Entry => {
    const sub = entry.kind === "item" ? byParent.get(entry.item.id) : undefined;

    if (sub === undefined) return entry;
    placed.add(sub.subagent.id);

    return {
      kind: "subagent",
      card: subagentCard(sub, calls.get(sub.subagent.parentItemId ?? "")),
    };
  });

  const orphans = view.subagents
    .filter((s) => !placed.has(s.subagent.id))
    .map((s): Entry => ({ kind: "subagent", card: subagentCard(s, undefined) }));

  return [...entries, ...orphans];
};

const entryKey = (entry: Entry) => {
  switch (entry.kind) {
    case "item":
      return entry.item.id;
    case "run":
      return `run:${entry.id}`;
    case "subagent":
      return `subagent:${entry.card.id}`;
  }
};

const isSteer = (entry: Entry | undefined) => entry?.kind === "item" && entry.item.kind === "user";

/** When each item started, by id; null when the Harness didn't say (`TurnItem.startedAt`). */
const itemStarts = (view: TurnView): ReadonlyMap<string, string | null> =>
  new Map([
    ...view.items.map((item): [string, string | null] => [item.id, item.startedAt]),
    ...[...view.live].map(([id, live]): [string, string | null] => [
      id,
      live.item?.startedAt ?? null,
    ]),
  ]);

const entryStart = (entry: Entry, starts: ReadonlyMap<string, string | null>) =>
  entry.kind === "item" ? (starts.get(entry.item.id) ?? null) : null;

const itemRows = (view: TurnView, isLast: boolean): ReadonlyArray<Row> => {
  const turnId = view.turn.id;
  const entries = turnEntries(view);
  const starts = itemStarts(view);

  // The first agent row carries the avatar, and so does the first one after a steer.
  return entries.map((entry, n) => ({
    kind: "item",
    key: `${turnId}:${entryKey(entry)}`,
    turnId,
    entry,
    lead: !isSteer(entry) && (n === 0 || isSteer(entries[n - 1])),
    latest: isLast,
    startedAt: entryStart(entry, starts),
  }));
};

const endingRow = (view: TurnView, isLast: boolean): ReadonlyArray<Row> => {
  const { status, id, index } = view.turn;

  if (status !== "interrupted" && status !== "failed") return [];

  return [
    {
      kind: "ending",
      key: `${id}:ending`,
      turnId: id,
      number: index + 1,
      status,
      canContinue: isLast && status === "interrupted",
      canRetry: isLast && status === "failed",
    },
  ];
};

const openingRow = ({ turn }: TurnView): Row =>
  turn.trigger === null
    ? {
        kind: "prompt",
        key: `${turn.id}:prompt`,
        turnId: turn.id,
        number: turn.index + 1,
        text: turn.prompt,
        attachments: turn.attachments,
        model: turn.model,
        effort: turn.effort,
        startedAt: turn.startedAt,
      }
    : {
        kind: "trigger",
        key: `${turn.id}:trigger`,
        turnId: turn.id,
        number: turn.index + 1,
        text: triggerPhrase(turn.trigger),
        model: turn.model,
        effort: turn.effort,
        startedAt: turn.startedAt,
      };

const expandedRows = (view: TurnView, isLast: boolean): ReadonlyArray<Row> => [
  openingRow(view),
  ...itemRows(view, isLast),
  ...endingRow(view, isLast),
];

interface Cached {
  readonly expanded: boolean;
  readonly isLast: boolean;
  readonly rows: ReadonlyArray<Row>;
}

const cache = new WeakMap<TurnView, Cached>();

/** One Turn's rows; the same array while its view and fold state are unchanged. */
export const turnRows = (view: TurnView, expanded: boolean, isLast: boolean) => {
  const hit = cache.get(view);

  if (hit !== undefined && hit.expanded === expanded && hit.isLast === isLast) return hit.rows;

  const rows: ReadonlyArray<Row> = expanded
    ? expandedRows(view, isLast)
    : [{ kind: "summary", key: `${view.turn.id}:summary`, ...summarize(view) }];

  cache.set(view, { expanded, isLast, rows });

  return rows;
};

/** Which Turns are open: the user's own choices, else from `openFrom` on. */
export interface Folds {
  /** Per Turn, what the user chose: true opened, false folded. */
  readonly chosen: ReadonlyMap<string, boolean>;
  /** The latest Turn when the session was first shown; null until then (the last Turn). */
  readonly openFrom: string | null;
}

export const noFolds: Folds = { chosen: new Map(), openFrom: null };

/** Whether each Turn is open; a newer Turn arriving never folds one. */
export const openTurns = (
  turns: ReadonlyArray<TurnView>,
  { chosen, openFrom }: Folds
): ReadonlyArray<boolean> => {
  const from = turns.findIndex((t) => t.turn.id === openFrom);
  const first = from === -1 ? turns.length - 1 : from;

  return turns.map((view, n) => chosen.get(view.turn.id) ?? n >= first);
};

/** Whether the session's latest Turn is open (T-ITEMS opens its runs by default). */
export const latestTurnOpen = (turns: ReadonlyArray<TurnView>, folds: Folds): boolean =>
  openTurns(turns, folds).at(-1) ?? false;

export interface ConversationInput {
  readonly turns: ReadonlyArray<TurnView>;
  readonly approvals: ReadonlyArray<ApprovalRequest>;
  /** Which Turns are open; default: only the last. */
  readonly folds?: Folds;
  /** Steers and follow-ups not landed yet; they close the list. */
  readonly setup?: WorktreeSetupRun | null;
  readonly outbox?: ReadonlyArray<Outgoing>;
  /** Background tasks an Idle session waits on (`waitingOn`); they follow the last Turn. */
  readonly waiting?: ReadonlyArray<BackgroundTask>;
}

const approvalRow = (request: ApprovalRequest): Row => ({
  kind: "approval",
  key: `approval:${request.id}`,
  request,
});

/** Every row, in order; pending approvals follow the Turn that asked, or close the list. */
export const conversationRows = ({
  turns,
  approvals,
  folds = noFolds,
  outbox = [],
  setup = null,
  waiting = [],
}: ConversationInput): ReadonlyArray<Row> => {
  const rows: Array<Row> = setup === null ? [] : [{ kind: "setup", key: setup.id, setup }];
  const placed = new Set<string>();
  const lastIndex = turns.length - 1;
  const open = openTurns(turns, folds);

  turns.forEach((view, n) => {
    rows.push(...turnRows(view, open[n] ?? true, n === lastIndex));

    for (const request of approvals) {
      if (request.turnId !== view.turn.id) continue;
      rows.push(approvalRow(request));
      placed.add(request.id);
    }
  });

  for (const request of approvals) if (!placed.has(request.id)) rows.push(approvalRow(request));

  if (waiting.length > 0) rows.push({ kind: "waiting", key: "waiting", tasks: waiting });

  for (const entry of outbox) rows.push({ kind: "outgoing", key: `outgoing:${entry.id}`, entry });

  return rows;
};

/** The row a Turn starts at (its summary, prompt or trigger); -1 when it isn't listed. */
export const turnStartRow = (rows: ReadonlyArray<Row>, turnId: string): number =>
  rows.findIndex(
    (r) =>
      (r.kind === "summary" || r.kind === "prompt" || r.kind === "trigger") && r.turnId === turnId
  );
