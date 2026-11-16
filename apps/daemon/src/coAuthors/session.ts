import type { Actor, SessionId, Turn, TurnId } from "@polaris/protocol";
import { DomainEvent } from "@polaris/protocol";
import { Effect } from "effect";
import type { EventStore } from "../store/EventStore.ts";
import { CommitIdentities } from "./identities.ts";
import { coAuthorTrailers, contributors } from "./trailers.ts";

type Store = EventStore["Service"];

/** Who sent each of the session's Turns, from its `TurnStarted` events. */
const turnActors = (store: Store, sessionId: SessionId, upTo: number) =>
  store.readEvents({ after: 0, upTo, sessionId, eventTypes: ["TurnStarted"] }).pipe(
    Effect.map((envelopes) => {
      const actors = new Map<TurnId, Actor>();

      for (const { event } of envelopes)
        if (DomainEvent.guards.TurnStarted(event) && event.actor != null)
          actors.set(event.turn.id, event.actor);

      return actors;
    })
  );

/**
 * The `Co-authored-by` trailers for `turns` of a session: its Teammates who sent one of them
 * or wrote a Comment one carried. Empty, reading nothing, while the Host has had no Share.
 */
export const sessionTrailers = Effect.fn("coAuthors.sessionTrailers")(function* (
  store: Store,
  sessionId: SessionId,
  /** Null: all of the session's Turns. */
  only: ReadonlyArray<Pick<Turn, "id" | "commentIds">> | null
) {
  const identities = yield* CommitIdentities;

  if (only?.length === 0 || !(yield* identities.any)) return [];
  const turns = only ?? (yield* store.readTurns({ sessionId, beforeIndex: null, limit: null }));
  const model = yield* store.model;
  const actors = yield* turnActors(store, sessionId, model.sequence);
  const people = contributors(turns, actors, model.sessions.get(sessionId)?.comments);

  return coAuthorTrailers(yield* Effect.forEach(people, identities.identify));
});
