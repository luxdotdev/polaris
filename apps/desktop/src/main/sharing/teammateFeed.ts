/**
 * The `host` feed for another person's Host. A Teammate may not call `subscribeHost`, so the
 * feed is built from the shared sessions' own streams: one host Snapshot, then their events,
 * renumbered so the renderer's host model never drops one stream's event behind another's.
 */
import {
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  Sequence,
  type SessionId,
  type SessionStreamItem,
  SessionSummary,
} from "@polaris/protocol";
import { Predicate, Stream } from "effect";

export type SessionSource = (sessionId: SessionId) => Stream.Stream<SessionStreamItem, unknown>;

type SessionSnapshot = Extract<SessionStreamItem, { readonly _tag: "Snapshot" }>;

/** Turns as the renderer's session feed asks for them, so both share one upstream stream. */
export const TEAMMATE_TURN_LIMIT = 20;

/**
 * Folds the shared sessions' items into host feed items. Only the first session Snapshot makes a
 * host Snapshot; a later one resets just its own session, so it never rolls another one back.
 */
export const teammateHostItems = () => {
  let sequence = 0;
  let snapshotted = false;
  const next = () => Sequence.make(++sequence);

  const hostSnapshot = (item: SessionSnapshot): ReadonlyArray<HostStreamItem> => {
    const at = next();

    const summary = new SessionSummary({
      session: item.session,
      pendingApprovals: item.pendingApprovals,
      lastTurnPreview: null,
      subagents: [],
    });

    snapshotted = true;

    return [
      HostStreamItem.cases.Snapshot.make({
        sequence: at,
        workspaces: [],
        worktrees: [],
        sessions: [summary],
      }),
      HostStreamItem.cases.Synchronized.make({ sequence: at }),
    ];
  };

  const event = (event: DomainEvent, occurredAt: string, commandId: EventEnvelope["commandId"]) =>
    HostStreamItem.cases.Event.make({
      envelope: new EventEnvelope({ sequence: next(), occurredAt, commandId, event }),
    });

  /** SessionCreated replaces the session's entry; its pending approvals follow it. */
  const sessionReset = (item: SessionSnapshot): ReadonlyArray<HostStreamItem> => {
    const at = item.session.updatedAt;

    return [
      event(DomainEvent.cases.SessionCreated.make({ session: item.session }), at, null),
      ...item.pendingApprovals.map((request) =>
        event(DomainEvent.cases.ApprovalRequested.make({ request }), at, null)
      ),
    ];
  };

  const fold = (item: SessionStreamItem): ReadonlyArray<HostStreamItem> => {
    if (Predicate.isTagged(item, "Snapshot"))
      return snapshotted ? sessionReset(item) : hostSnapshot(item);

    return Predicate.isTagged(item, "Event")
      ? [event(item.envelope.event, item.envelope.occurredAt, item.envelope.commandId)]
      : [];
  };

  return { fold };
};

/**
 * The host feed of `sessionIds` on a Teammate's connection: a host Snapshot at the first session
 * Snapshot, never before, so an offline Host keeps its cached history. A refused session drops out.
 */
export const teammateHostFeed = (
  sessionIds: ReadonlyArray<SessionId>,
  subscribe: SessionSource,
  /** Shared across a Host's feeds, so its sequence keeps rising when the session list changes. */
  items: ReturnType<typeof teammateHostItems> = teammateHostItems()
): Stream.Stream<HostStreamItem> => {
  const sessions = Stream.mergeAll(
    sessionIds.map((id) => subscribe(id).pipe(Stream.catchCause(() => Stream.empty))),
    { concurrency: "unbounded" }
  );

  return sessions.pipe(Stream.flatMap((item) => Stream.fromIterable(items.fold(item))));
};
