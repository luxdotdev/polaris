/**
 * The conversation as a flat list of rows, the unit the virtualized list
 * renders: earlier Turns fold to one summary row, the rest expand into the
 * prompt, each item and the Turn's ending. Rows are cached per Turn view, so
 * a streaming Turn rebuilds only its own rows each frame.
 */
import type { ApprovalRequest, TurnItem, TurnStatus } from "@polaris/protocol";
import { Predicate } from "effect";
import type { TurnView } from "../../../store/sessionModel.ts";
import { completedItemView, type ItemView, liveItemView } from "./items.ts";

export interface TurnSummary {
  readonly turnId: string;
  /** One-based, as the UI numbers Turns. */
  readonly number: number;
  readonly status: TurnStatus;
  /** The last assistant message's first line, else the prompt's. */
  readonly summary: string;
  readonly files: number;
}

export type Row =
  | ({ readonly kind: "summary"; readonly key: string } & TurnSummary)
  | {
      readonly kind: "prompt";
      readonly key: string;
      readonly turnId: string;
      readonly text: string;
      readonly attachments: ReadonlyArray<string>;
      /** The Model and effort the Turn ran on; null for the Harness's defaults. */
      readonly model: string | null;
      readonly effort: string | null;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly turnId: string;
      readonly item: ItemView;
      /** The first agent row of its Turn carries the Harness avatar. */
      readonly lead: boolean;
    }
  | { readonly kind: "approval"; readonly key: string; readonly request: ApprovalRequest }
  | {
      readonly kind: "ending";
      readonly key: string;
      readonly turnId: string;
      readonly number: number;
      readonly status: "interrupted" | "failed";
      /** The last Turn was interrupted by a restart: offer Continue. */
      readonly canContinue: boolean;
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

export const summarize = (view: TurnView): TurnSummary => {
  const lastMessage = view.items.findLast(isMessage);
  const text = lastMessage === undefined ? view.turn.prompt : lastMessage.text;

  return {
    turnId: view.turn.id,
    number: view.turn.index + 1,
    status: view.turn.status,
    summary: firstLine(text),
    files: touchedFiles(view.items),
  };
};

const itemRows = (view: TurnView): ReadonlyArray<Row> => {
  const turnId = view.turn.id;

  const items = [
    ...view.items.map(completedItemView),
    ...[...view.live].map(([id, live]) => liveItemView(id, live)),
  ];

  return items.map((item, n) => ({
    kind: "item",
    key: `${turnId}:${item.id}`,
    turnId,
    item,
    lead: n === 0,
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
    },
  ];
};

const expandedRows = (view: TurnView, isLast: boolean): ReadonlyArray<Row> => [
  {
    kind: "prompt",
    key: `${view.turn.id}:prompt`,
    turnId: view.turn.id,
    text: view.turn.prompt,
    attachments: view.turn.attachments.map((a) => a.name),
    model: view.turn.model,
    effort: view.turn.effort,
  },
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
}: ConversationInput): ReadonlyArray<Row> => {
  const rows: Array<Row> = [];
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

  return rows;
};
