/**
 * One Agent Session in detail: its Turns with their items, its pending
 * approvals, and the text still streaming into items in progress, folded from
 * `subscribeSession`. A Snapshot resets it.
 */
import type {
  ApprovalRequest,
  DomainEvent,
  Sequence,
  SessionStreamItem,
  Turn,
  TurnItem,
} from "@polaris/protocol";
import { Match } from "effect";
import { type Session, stateFields } from "./hostView.ts";

export interface TurnEntry {
  readonly turn: Turn;
  /** Completed items, in completion order. */
  readonly items: ReadonlyArray<TurnItem>;
}

/** Text arriving for an item that hasn't completed yet. */
export interface StreamingText {
  readonly turnId: string;
  readonly itemId: string;
  readonly field: "text" | "output";
  readonly text: string;
}

export interface SessionView {
  readonly hostId: string;
  /** False while the SDK reconnects; the rest is as last seen. */
  readonly connected: boolean;
  readonly session: Session;
  /** Oldest first. The Snapshot holds the latest `turnLimit` Turns. */
  readonly turns: ReadonlyArray<TurnEntry>;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  readonly streaming: ReadonlyArray<StreamingText>;
}

export interface SessionState {
  readonly sequence: Sequence;
  readonly synchronized: boolean;
  readonly session: Session;
  readonly turns: ReadonlyArray<TurnEntry>;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  readonly streaming: ReadonlyArray<StreamingText>;
}

type Fold = (state: SessionState) => SessionState;

const unchanged: Fold = (state) => state;

const patch =
  (fields: Partial<Session>): Fold =>
  (state) => ({ ...state, session: { ...state.session, ...fields } });

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

const startTurn =
  (turn: Turn): Fold =>
  (state) => ({
    ...state,
    session: { ...state.session, turnCount: Math.max(state.session.turnCount, turn.index + 1) },
    turns: [...state.turns.filter((entry) => entry.turn.id !== turn.id), { turn, items: [] }],
  });

const completeItem =
  (turnId: string, item: TurnItem): Fold =>
  (state) => ({
    ...withTurn(turnId, (entry) => ({
      ...entry,
      items: [...entry.items.filter((done) => done.id !== item.id), item],
    }))(state),
    streaming: state.streaming.filter((live) => live.itemId !== item.id),
  });

const fold = (event: DomainEvent, sessionId: string): Fold =>
  Match.value(event).pipe(
    Match.tags({
      SessionStateChanged:
        (event): Fold =>
        (state) =>
          patch(stateFields(state.session, event))(state),
      SessionResumeAtResetChanged: ({ resumeAtReset }) => patch({ resumeAtReset }),
      SessionRenamed: ({ title }) => patch({ title }),
      SessionPermissionModeChanged: ({ permissionMode }) => patch({ permissionMode }),
      SessionModelChanged: ({ model, effort }) => patch({ model, effort }),
      TurnStarted: ({ turn }) => startTurn(turn),
      // A Subagent's own items stay out of the Turn's.
      TurnItemCompleted: ({ turnId, item, subagentId }) =>
        subagentId === null ? completeItem(turnId, item) : unchanged,
      TurnEnded:
        ({ turn }): Fold =>
        (state) => ({
          ...withTurn(turn.id, (entry) => ({ ...entry, turn }))(state),
          streaming: state.streaming.filter((live) => live.turnId !== turn.id),
        }),
      ApprovalRequested:
        ({ request }): Fold =>
        (state) => ({
          ...state,
          pendingApprovals: [...withoutRequest(request.id)(state).pendingApprovals, request],
        }),
      ApprovalResolved: ({ requestId }) => withoutRequest(requestId),
      ApprovalWithdrawn: ({ requestId }) => withoutRequest(requestId),
    }),
    Match.orElse(() => unchanged),
    // Session feeds carry only their session's events; this guards a stray one.
    (apply): Fold =>
      (state) =>
        state.session.id === sessionId ? apply(state) : state
  );

const appendDelta =
  (delta: Omit<StreamingText, "text"> & { readonly text: string }): Fold =>
  (state) => {
    const existing = state.streaming.find(
      (live) => live.itemId === delta.itemId && live.field === delta.field
    );

    return {
      ...state,
      streaming:
        existing === undefined
          ? [...state.streaming, delta]
          : state.streaming.map((live) =>
              live === existing ? { ...live, text: live.text + delta.text } : live
            ),
    };
  };

/** Applies one item of a session's feed; null before the first Snapshot. */
export const applySessionItem = (
  state: SessionState | null,
  item: SessionStreamItem
): SessionState | null =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: (snapshot): SessionState => ({
        sequence: snapshot.sequence,
        synchronized: false,
        session: snapshot.session,
        turns: snapshot.turns.map((detail) => ({ turn: detail.turn, items: detail.items })),
        pendingApprovals: snapshot.pendingApprovals,
        streaming: [],
      }),
      Event: ({ envelope }) => {
        if (state === null || envelope.sequence <= state.sequence) return state;
        const next = fold(envelope.event, state.session.id)(state);

        return {
          ...next,
          session: { ...next.session, updatedAt: envelope.occurredAt },
          sequence: envelope.sequence,
        };
      },
      Delta: ({ turnId, itemId, field, text, subagentId }) =>
        state === null || subagentId !== null
          ? state
          : appendDelta({ turnId, itemId, field, text })(state),
      ItemProgress: () => state,
      Synchronized: ({ sequence }) =>
        state === null ? null : { ...state, sequence, synchronized: true },
    })
  );

export const sessionView = (
  state: SessionState,
  hostId: string,
  connected: boolean
): SessionView => ({
  hostId,
  connected,
  session: state.session,
  turns: state.turns,
  pendingApprovals: state.pendingApprovals,
  streaming: state.streaming,
});
