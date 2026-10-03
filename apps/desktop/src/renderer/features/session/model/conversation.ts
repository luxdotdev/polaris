/**
 * The conversation as a flat list of rows, the unit the virtualized list
 * renders: earlier Turns fold to one summary row, the rest expand into the
 * prompt, each item and the Turn's ending. Rows are cached per Turn view, so
 * a streaming Turn rebuilds only its own rows each frame.
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
import type { TurnView } from "../../../store/sessionModel.ts";
import { triggerPhrase } from "./background.ts";
import { completedItemView, liveItemView } from "./items.ts";
import type { Outgoing } from "./outbox.ts";
import { type Entry, groupItems } from "./runs.ts";
import { subagentCard } from "./subagents.ts";

export interface TurnSummary {
  readonly turnId: TurnId;
  /** One-based, as the UI numbers Turns. */
  readonly number: number;
  readonly status: TurnStatus;
  /** The last assistant message's first line, else the prompt's. */
  readonly summary: string;
  readonly files: number;
}

export type Row =
  | { readonly kind: "setup"; readonly key: string; readonly setup: WorktreeSetupRun }
  | ({ readonly kind: "summary"; readonly key: string } & TurnSummary)
  | {
      readonly kind: "prompt";
      readonly key: string;
      readonly turnId: string;
      readonly text: string;
      /** What the prompt carried, in the order attached (previews above the bubble). */
      readonly attachments: ReadonlyArray<Attachment>;
      /** The Model and effort the Turn ran on; null for the Harness's defaults. */
      readonly model: string | null;
      readonly effort: string | null;
    }
  /** A Turn the Harness started itself: what woke it, in place of a prompt. */
  | {
      readonly kind: "trigger";
      readonly key: string;
      readonly turnId: string;
      readonly text: string;
      readonly model: string | null;
      readonly effort: string | null;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly turnId: string;
      /** One item, a folded tool run, or a Subagent. */
      readonly entry: Entry;
      /** The first agent row of its Turn carries the Harness avatar. */
      readonly lead: boolean;
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

  const items = [
    ...view.items.map(completedItemView),
    ...[...view.live].map(([id, live]) => liveItemView(id, live)),
  ];

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

const itemRows = (view: TurnView): ReadonlyArray<Row> => {
  const turnId = view.turn.id;
  const entries = turnEntries(view);

  // The first agent row carries the avatar, and so does the first one after a steer.
  return entries.map((entry, n) => ({
    kind: "item",
    key: `${turnId}:${entryKey(entry)}`,
    turnId,
    entry,
    lead: !isSteer(entry) && (n === 0 || isSteer(entries[n - 1])),
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
        text: turn.prompt,
        attachments: turn.attachments,
        model: turn.model,
        effort: turn.effort,
      }
    : {
        kind: "trigger",
        key: `${turn.id}:trigger`,
        turnId: turn.id,
        text: triggerPhrase(turn.trigger),
        model: turn.model,
        effort: turn.effort,
      };

const expandedRows = (view: TurnView, isLast: boolean): ReadonlyArray<Row> => [
  openingRow(view),
  ...itemRows(view),
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

export interface ConversationInput {
  readonly turns: ReadonlyArray<TurnView>;
  readonly approvals: ReadonlyArray<ApprovalRequest>;
  /** Turns the user unfolded; the last Turn is always open. */
  readonly unfolded: ReadonlySet<string>;
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
  unfolded,
  outbox = [],
  setup = null,
  waiting = [],
}: ConversationInput): ReadonlyArray<Row> => {
  const rows: Array<Row> = setup === null ? [] : [{ kind: "setup", key: setup.id, setup }];
  const placed = new Set<string>();
  const lastIndex = turns.length - 1;

  turns.forEach((view, n) => {
    const isLast = n === lastIndex;

    rows.push(...turnRows(view, isLast || unfolded.has(view.turn.id), isLast));

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
