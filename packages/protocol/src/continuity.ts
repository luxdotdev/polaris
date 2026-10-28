/**
 * Continuity (ENG-458): an Agent Session's read position and composer draft,
 * kept by the Daemon so they follow the session between Clients. Neither goes
 * through `dispatch` or the event log: they are the user's view of a session,
 * not its history (ADR 0082). Capability `session.continuity`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { AgentSession, Turn } from "./domain.ts";
import { NotFound, Unsupported } from "./errors.ts";
import { SessionId, Timestamp, TurnId } from "./ids.ts";

/** The longest draft a Daemon keeps, in UTF-16 code units. */
export const MAX_DRAFT_LENGTH = 100_000;

/** The last Turn the user has seen in a session, on any Client. */
export class ReadPosition extends Schema.Class<ReadPosition>("ReadPosition")({
  sessionId: SessionId,
  turnId: TurnId,
  /** The Turn's index in its session; a read position only moves forward. */
  turnIndex: Schema.Int,
  at: Timestamp,
}) {}

/** A session's unsent composer text; an empty text is no draft (a cleared one keeps its revision). */
export class ComposerDraft extends Schema.Class<ComposerDraft>("ComposerDraft")({
  sessionId: SessionId,
  text: Schema.String,
  /** Counts the session's saves; a Client keeps the highest it has seen. */
  revision: Schema.Int,
  at: Timestamp,
}) {}

export const ContinuityItem = Schema.TaggedUnion({
  /** Every session's read position and every draft, emptied ones too, first. */
  Snapshot: { reads: Schema.Array(ReadPosition), drafts: Schema.Array(ComposerDraft) },
  Read: { position: ReadPosition },
  Draft: { draft: ComposerDraft },
});

export type ContinuityItem = typeof ContinuityItem.Type;

/** The Host's read positions and drafts: a Snapshot, then each change from any Client. */
export const WatchContinuity = Rpc.make("continuity.watch", {
  payload: {},
  success: ContinuityItem,
  error: Unsupported,
  stream: true,
});

/**
 * Marks `turnId` seen. The position never moves back: an earlier Turn answers
 * the current position unchanged.
 */
export const MarkRead = Rpc.make("continuity.markRead", {
  payload: { sessionId: SessionId, turnId: TurnId },
  success: ReadPosition,
  error: Schema.Union([NotFound, Unsupported]),
});

/** Replaces the session's draft (last writer wins) and answers it with its new revision. */
export const SaveDraft = Rpc.make("continuity.saveDraft", {
  payload: {
    sessionId: SessionId,
    text: Schema.String.check(Schema.isMaxLength(MAX_DRAFT_LENGTH)),
  },
  success: ComposerDraft,
  error: Schema.Union([NotFound, Unsupported]),
});

export class ContinuityRpcs extends RpcGroup.make(WatchContinuity, MarkRead, SaveDraft) {}

/**
 * Ended Turns after the read position: every Client counts unread the same
 * way. `latest` is the session's last Turn; while it works it isn't unread yet,
 * whatever the Session State (Needs You on an approval, In Terminal).
 */
export const unreadTurns = (
  session: Pick<AgentSession, "turnCount">,
  latest: Pick<Turn, "status"> | null,
  read: Pick<ReadPosition, "turnIndex"> | null
): number => {
  const ended = latest?.status === "working" ? session.turnCount - 1 : session.turnCount;

  return Math.max(0, ended - (read === null ? 0 : read.turnIndex + 1));
};
