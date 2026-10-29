/**
 * One Agent Session folded from `subscribeSession`: its Turns with their
 * completed items, the items still running (`ItemProgress`), and text still
 * streaming in. A Snapshot resets it, except the checkpoint commits seen so
 * far; Subagents' own items stay out.
 */
import type {
  AgentSession,
  ApprovalRequest,
  DomainEvent,
  SessionStreamItem,
  Turn,
  TurnItem,
} from "@polaris/protocol";
import { Match } from "effect";

export interface TurnEntry {
  readonly turn: Turn;
  /** Completed items, in completion order. */
  readonly items: ReadonlyArray<TurnItem>;
  /** Items still in progress, by id, replaced as their progress arrives. */
  readonly live: ReadonlyArray<TurnItem>;
  /** Text streaming into an item that hasn't completed, by item id. */
  readonly streaming: ReadonlyArray<{ readonly itemId: string; readonly text: string }>;
}

/** The session as plain fields, so a change can copy it. */
export type Session = { readonly [K in keyof AgentSession]: AgentSession[K] };

export interface SessionFold {
  readonly sequence: number;
  readonly synchronized: boolean;
  readonly session: Session;
  /** Oldest first. */
  readonly turns: ReadonlyArray<TurnEntry>;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  /** Checkpoint refs to their commits, as `CheckpointRecorded` reported them on this feed. */
  readonly checkpoints: ReadonlyMap<string, string>;
}

type Fold = (state: SessionFold) => SessionFold;

const unchanged: Fold = (state) => state;

const patch =
  (fields: Partial<Session>): Fold =>
  (state) => ({ ...state, session: { ...state.session, ...fields } });

/** Only the changed Turn's entry is replaced, so the others keep their identity. */
const withTurn =
  (turnId: string, change: (entry: TurnEntry) => TurnEntry): Fold =>
  (state) => ({
    ...state,
    turns: state.turns.map((entry) => (entry.turn.id === turnId ? change(entry) : entry)),
  });

const withoutRequest =
  (requestId: string): Fold =>
  (state) => ({
    ...state,
    pendingApprovals: state.pendingApprovals.filter((request) => request.id !== requestId),
  });

const entryOf = (turn: Turn, items: ReadonlyArray<TurnItem> = []): TurnEntry => ({
  turn,
  items,
  live: [],
  streaming: [],
});

const startTurn =
  (turn: Turn): Fold =>
  (state) => ({
    ...state,
    session: { ...state.session, turnCount: Math.max(state.session.turnCount, turn.index + 1) },
    turns: [...state.turns.filter((entry) => entry.turn.id !== turn.id), entryOf(turn)],
  });

const completeItem = (turnId: string, item: TurnItem): Fold =>
  withTurn(turnId, (entry) => ({
    ...entry,
    items: [...entry.items.filter((done) => done.id !== item.id), item],
    live: entry.live.filter((running) => running.id !== item.id),
    streaming: entry.streaming.filter((text) => text.itemId !== item.id),
  }));

const endTurn = (turn: Turn): Fold =>
  withTurn(turn.id, (entry) => ({ ...entry, turn, live: [], streaming: [] }));

const foldEvent = (event: DomainEvent): Fold =>
  Match.value(event).pipe(
    Match.tags({
      SessionStateChanged: (changed) =>
        patch({
          state: changed.state,
          lastError: changed.state === "failed" ? changed.reason : null,
        }),
      SessionRenamed: ({ title }) => patch({ title }),
      SessionModelChanged: ({ model, effort }) => patch({ model, effort }),
      SessionPermissionModeChanged: ({ permissionMode }) => patch({ permissionMode }),
      TurnStarted: ({ turn }) => startTurn(turn),
      TurnItemCompleted: ({ turnId, item, subagentId }) =>
        subagentId === null ? completeItem(turnId, item) : unchanged,
      TurnEnded: ({ turn }) => endTurn(turn),
      ApprovalRequested:
        ({ request }): Fold =>
        (state) => ({
          ...state,
          pendingApprovals: [...withoutRequest(request.id)(state).pendingApprovals, request],
        }),
      CheckpointRecorded:
        ({ ref, commit }): Fold =>
        (state) => ({ ...state, checkpoints: new Map(state.checkpoints).set(ref, commit) }),
      ApprovalResolved: ({ requestId }) => withoutRequest(requestId),
      ApprovalWithdrawn: ({ requestId }) => withoutRequest(requestId),
    }),
    Match.orElse(() => unchanged)
  );

const appendText = (turnId: string, itemId: string, text: string): Fold =>
  withTurn(turnId, (entry) => {
    const held = entry.streaming.find((live) => live.itemId === itemId);

    return {
      ...entry,
      streaming:
        held === undefined
          ? [...entry.streaming, { itemId, text }]
          : entry.streaming.map((live) =>
              live === held ? { itemId, text: live.text + text } : live
            ),
    };
  });

const progress = (turnId: string, item: TurnItem): Fold =>
  withTurn(turnId, (entry) =>
    entry.items.some((done) => done.id === item.id)
      ? entry
      : { ...entry, live: [...entry.live.filter((running) => running.id !== item.id), item] }
  );

/** Applies one item of a session's feed; null before the first Snapshot. */
export const applySessionItem = (
  state: SessionFold | null,
  item: SessionStreamItem
): SessionFold | null =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: (snapshot): SessionFold => ({
        sequence: snapshot.sequence,
        synchronized: false,
        session: snapshot.session,
        turns: snapshot.turns.map((detail) => entryOf(detail.turn, detail.items)),
        pendingApprovals: snapshot.pendingApprovals,
        checkpoints: state?.checkpoints ?? new Map(),
      }),
      Event: ({ envelope }) => {
        if (state === null || envelope.sequence <= state.sequence) return state;
        // A session's feed carries only that session's events.
        const next = foldEvent(envelope.event)(state);

        return { ...next, sequence: envelope.sequence };
      },
      Delta: ({ turnId, itemId, field, text, subagentId }) =>
        state === null || subagentId !== null || field !== "text"
          ? state
          : appendText(turnId, itemId, text)(state),
      ItemProgress: ({ turnId, item, subagentId }) =>
        state === null || subagentId !== null ? state : progress(turnId, item)(state),
      Synchronized: ({ sequence }) =>
        state === null ? null : { ...state, sequence, synchronized: true },
    })
  );

/** Older Turns paged in, ahead of those the feed holds; ones it already has are skipped. */
export const withOlder = (
  state: SessionFold,
  older: ReadonlyArray<{ readonly turn: Turn; readonly items: ReadonlyArray<TurnItem> }>
): SessionFold => {
  const first = state.turns[0]?.turn.index ?? Number.POSITIVE_INFINITY;
  const before = older.filter((detail) => detail.turn.index < first);

  return before.length === 0
    ? state
    : { ...state, turns: [...before.map((d) => entryOf(d.turn, d.items)), ...state.turns] };
};

/**
 * The commit a session Risk Summary of every ended Turn is keyed by: the last
 * ended Turn's after-checkpoint, when this feed saw it recorded.
 */
export const summaryHead = (state: SessionFold): string | null => {
  const ended = state.turns.findLast((entry) => entry.turn.status !== "working");
  const ref = ended?.turn.checkpointAfter ?? null;

  return ref === null ? null : (state.checkpoints.get(ref) ?? null);
};
