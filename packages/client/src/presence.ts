/**
 * Reports the user's presence to one Host (ENG-495): on each connection and each change,
 * and `present` again at half its lease while it lasts. A Host without the `presence`
 * capability is told nothing; a new connection starts away, so away is sent only to end a lease.
 */
import type { PresenceLease, UserPresence } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { LiveSession } from "./HostConnection.ts";

/** What reporting reads of a live connection. */
export type PresenceSession = Pick<LiveSession, "capabilities"> & {
  readonly client: {
    readonly "presence.report": (input: {
      readonly presence: UserPresence;
    }) => Effect.Effect<PresenceLease, unknown>;
  };
};

const holdWhilePresent = (session: PresenceSession) =>
  Effect.gen(function* () {
    for (;;) {
      const { leaseMs } = yield* session.client["presence.report"]({ presence: "present" });

      if (leaseMs <= 0) return;
      yield* Effect.sleep(leaseMs / 2);
    }
  });

/** Runs until interrupted; a lost connection's failures end with it and the next one reports again. */
export const reportPresence = (
  sessions: Stream.Stream<PresenceSession | null>,
  presence: Stream.Stream<UserPresence>
): Effect.Effect<void> => {
  let presentOn: PresenceSession | null = null;

  const report = ([session, current]: readonly [PresenceSession | null, UserPresence]) => {
    if (session === null || !session.capabilities.includes("presence")) return Effect.void;

    if (current === "present") {
      presentOn = session;

      return holdWhilePresent(session);
    }

    if (presentOn !== session) return Effect.void;
    presentOn = null;

    return Effect.asVoid(session.client["presence.report"]({ presence: "away" }));
  };

  return Stream.zipLatest(sessions, Stream.changes(presence)).pipe(
    Stream.switchMap((pair) => Stream.fromEffectDrain(Effect.ignore(report(pair)))),
    Stream.runDrain
  );
};
