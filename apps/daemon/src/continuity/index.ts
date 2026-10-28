/**
 * Continuity (ENG-458, ADR 0082): read positions and composer drafts follow an
 * Agent Session between Clients. Kept in SQL beside the event log (never in it)
 * and fanned out to every `continuity.watch`; only real changes are sent.
 */
import {
  type ComposerDraft,
  ContinuityItem,
  ContinuityRpcs,
  NotFound,
  type ReadPosition,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";
import { EventStore } from "../store/EventStore.ts";

export class Continuity extends Context.Service<
  Continuity,
  {
    readonly watch: Stream.Stream<ContinuityItem>;
    readonly markRead: (
      sessionId: SessionId,
      turnId: TurnId
    ) => Effect.Effect<ReadPosition, NotFound>;
    readonly saveDraft: (
      sessionId: SessionId,
      text: string
    ) => Effect.Effect<ComposerDraft, NotFound>;
  }
>()("polaris/daemon/continuity/Continuity") {
  static readonly layer = Layer.effect(
    Continuity,
    Effect.gen(function* () {
      const store = yield* EventStore;
      const changes = yield* PubSub.unbounded<ContinuityItem>();
      const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString());

      const knownSession = (sessionId: SessionId) =>
        Effect.flatMap(store.model, (model) =>
          model.sessions.has(sessionId)
            ? Effect.void
            : Effect.fail(new NotFound({ what: "session", id: sessionId }))
        );

      const watch = Stream.unwrap(
        Effect.gen(function* () {
          // Subscribed before the Snapshot is read, so no change falls between them.
          const subscription = yield* PubSub.subscribe(changes);
          const reads = yield* store.continuity.reads;
          const drafts = yield* store.continuity.drafts;
          const snapshot = ContinuityItem.cases.Snapshot.make({ reads, drafts });

          return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription));
        })
      );

      const markRead = (sessionId: SessionId, turnId: TurnId) =>
        Effect.gen(function* () {
          yield* knownSession(sessionId);
          const written = yield* store.continuity.markRead({ sessionId, turnId, at: yield* now });

          if (written === null) return yield* new NotFound({ what: "turn", id: turnId });

          if (written.changed)
            yield* PubSub.publish(
              changes,
              ContinuityItem.cases.Read.make({ position: written.value })
            );

          return written.value;
        });

      const saveDraft = (sessionId: SessionId, text: string) =>
        Effect.gen(function* () {
          yield* knownSession(sessionId);
          const written = yield* store.continuity.saveDraft({ sessionId, text, at: yield* now });

          if (written.changed)
            yield* PubSub.publish(
              changes,
              ContinuityItem.cases.Draft.make({ draft: written.value })
            );

          return written.value;
        });

      return Continuity.of({ watch, markRead, saveDraft });
    })
  );
}

/** Requires `Continuity`. */
export const ContinuityRpcsLive = ContinuityRpcs.toLayer(
  Effect.gen(function* () {
    const continuity = yield* Continuity;

    return {
      "continuity.watch": () => continuity.watch,
      "continuity.markRead": ({ sessionId, turnId }) => continuity.markRead(sessionId, turnId),
      "continuity.saveDraft": ({ sessionId, text }) => continuity.saveDraft(sessionId, text),
    };
  })
);
