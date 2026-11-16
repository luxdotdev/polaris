/**
 * The `host` feed for another person's Host. A Teammate may not call `subscribeHost`, so the
 * feed is built from the shared sessions' own streams: a host Snapshot listing them, then their
 * events, renumbered so the renderer's host model never drops one stream's event behind another's.
 */
import {
  EventEnvelope,
  HostStreamItem,
  Sequence,
  type SessionId,
  type SessionStreamItem,
  SessionSummary,
} from "@polaris/protocol";
import { Predicate, Stream } from "effect";

export type SessionSource = (sessionId: SessionId) => Stream.Stream<SessionStreamItem, unknown>;

/** Turns as the renderer's session feed asks for them, so both share one upstream stream. */
export const TEAMMATE_TURN_LIMIT = 20;

/** Folds the shared sessions' items into host feed items. */
export const teammateHostItems = () => {
  const summaries = new Map<string, SessionSummary>();
  let sequence = 0;
  const next = () => Sequence.make(++sequence);

  const snapshot = (): ReadonlyArray<HostStreamItem> => {
    const at = next();

    return [
      HostStreamItem.cases.Snapshot.make({
        sequence: at,
        workspaces: [],
        worktrees: [],
        sessions: [...summaries.values()],
      }),
      HostStreamItem.cases.Synchronized.make({ sequence: at }),
    ];
  };

  const event = (envelope: EventEnvelope) =>
    HostStreamItem.cases.Event.make({
      envelope: new EventEnvelope({
        sequence: next(),
        occurredAt: envelope.occurredAt,
        commandId: envelope.commandId,
        event: envelope.event,
      }),
    });

  const fold = (item: SessionStreamItem): ReadonlyArray<HostStreamItem> => {
    if (Predicate.isTagged(item, "Snapshot")) {
      summaries.set(
        item.session.id,
        new SessionSummary({
          session: item.session,
          pendingApprovals: item.pendingApprovals,
          lastTurnPreview: null,
          subagents: [],
        })
      );

      return snapshot();
    }

    return Predicate.isTagged(item, "Event") ? [event(item.envelope)] : [];
  };

  return { fold };
};

/**
 * The host feed of `sessionIds` on a Teammate's connection: a host Snapshot per session Snapshot,
 * never before the first, so an offline Host keeps its cached history. A refused session drops out.
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
