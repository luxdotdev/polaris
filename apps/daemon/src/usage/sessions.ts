/**
 * What the Usage index needs from the event store: which Harness session ids
 * (a session's cursors) belong to which Agent Session, and when a Turn ends.
 */
import type { HarnessKind, SessionId } from "@polaris/protocol";
import { Context, Data, Effect, Layer, Match, Option, Predicate, Stream } from "effect";
import { EventStore } from "../store/EventStore.ts";
import type { LiveItem } from "../store/hub.ts";

export interface SessionLink {
  readonly harness: HarnessKind;
  /** The Harness's own session id: a cursor the Agent Session had. */
  readonly native: string;
  readonly sessionId: SessionId;
}

export type SessionActivity = Data.TaggedEnum<{
  Linked: { readonly link: SessionLink };
  TurnEnded: { readonly harness: HarnessKind };
}>;

export const SessionActivity = Data.taggedEnum<SessionActivity>();

export class UsageSessions extends Context.Service<
  UsageSessions,
  {
    /** Each Agent Session's current cursor. */
    readonly current: Effect.Effect<ReadonlyArray<SessionLink>>;
    /** Every cursor each Agent Session ever had, from its events (for a rebuilt index). */
    readonly history: Effect.Effect<ReadonlyArray<SessionLink>>;
    /** New cursors and Turn ends as they are committed. Ends if it falls behind; subscribe again. */
    readonly activity: Stream.Stream<SessionActivity>;
  }
>()("polaris/daemon/usage/UsageSessions") {
  static readonly layer = Layer.effect(
    UsageSessions,
    Effect.gen(function* () {
      const store = yield* EventStore;

      const harnessOf = (sessionId: SessionId) =>
        Effect.map(store.model, (model) => model.sessions.get(sessionId)?.session.harness ?? null);

      const current = Effect.map(store.model, (model) =>
        [...model.sessions.values()].flatMap(({ session }): Array<SessionLink> =>
          session.harnessCursor === null
            ? []
            : [{ harness: session.harness, native: session.harnessCursor, sessionId: session.id }]
        )
      );

      const history = Effect.gen(function* () {
        const model = yield* store.model;
        const links: Array<SessionLink> = [...(yield* current)];

        for (const { session } of model.sessions.values()) {
          const events = yield* store
            .readEvents({ after: 0, upTo: model.sequence, sessionId: session.id })
            .pipe(Effect.orElseSucceed(() => []));

          for (const { event } of events)
            if (Predicate.isTagged(event, "SessionCursorUpdated"))
              links.push({
                harness: session.harness,
                native: event.harnessCursor,
                sessionId: session.id,
              });
        }

        return links;
      });

      const toActivity = (item: LiveItem): Effect.Effect<Option.Option<SessionActivity>> => {
        if (!Predicate.isTagged(item, "Event")) return Effect.succeedNone;

        return Match.value(item.envelope.event).pipe(
          Match.tag("SessionCursorUpdated", (event) =>
            Effect.map(harnessOf(event.sessionId), (harness) =>
              harness === null
                ? Option.none()
                : Option.some(
                    SessionActivity.Linked({
                      link: { harness, native: event.harnessCursor, sessionId: event.sessionId },
                    })
                  )
            )
          ),
          Match.tag("TurnEnded", (event) =>
            Effect.map(harnessOf(event.turn.sessionId), (harness) =>
              harness === null ? Option.none() : Option.some(SessionActivity.TurnEnded({ harness }))
            )
          ),
          Match.orElse(() => Effect.succeedNone)
        );
      };

      const wanted = (item: LiveItem) =>
        Predicate.isTagged(item, "Event") &&
        (Predicate.isTagged(item.envelope.event, "SessionCursorUpdated") ||
          Predicate.isTagged(item.envelope.event, "TurnEnded"));

      const activity = Stream.unwrap(
        Effect.map(store.subscribe({ filter: wanted }), (items) =>
          items.pipe(
            Stream.mapEffect(toActivity),
            Stream.filter(Option.isSome),
            Stream.map((item) => item.value)
          )
        )
      );

      return UsageSessions.of({ current, history, activity });
    })
  );
}
