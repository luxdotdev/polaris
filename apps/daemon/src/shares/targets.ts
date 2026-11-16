/**
 * What a Share can target, read from the event store's model: a session touches itself and
 * the Constellation it belongs to, as its Lead or as a Worker, so a Constellation's Share
 * covers Workers added after it was made.
 */
import type { SessionId, Turn, TurnId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import type { ReadModel } from "../store/model.ts";
import { EventStore } from "../store/EventStore.ts";
import { ShareBook } from "./identities.ts";
import { constellationOf } from "./shared.ts";
import { Shares, type ShareTargets } from "./service.ts";

/** Reads a Turn the model no longer holds; null when the session has no such Turn. */
export type ReadTurn = (sessionId: SessionId, turnId: TurnId) => Effect.Effect<Turn | null>;

export const targetsOf = (model: Effect.Effect<ReadModel>, readTurn: ReadTurn): ShareTargets => ({
  session: (id) =>
    Effect.map(model, (current) => {
      const record = current.sessions.get(id);

      if (record === undefined) return null;

      return {
        touch: { sessionId: id, constellationId: constellationOf(current, id) },
        cwd: record.session.cwd,
        worker: record.session.worker != null,
      };
    }),
  hasConstellation: (id) => Effect.map(model, (current) => current.constellations.has(id)),
  turn: (sessionId, turnId) =>
    Effect.flatMap(model, (current) => {
      const recent = current.sessions.get(sessionId)?.turns.find((turn) => turn.id === turnId);

      return recent === undefined ? readTurn(sessionId, turnId) : Effect.succeed(recent);
    }).pipe(
      Effect.map((turn) =>
        turn === null || turn.sessionId !== sessionId
          ? null
          : { index: turn.index, working: turn.status === "working" }
      )
    ),
});

/** Binds the Shares and the Engine to each other once the event store is up. */
export const ShareTargetsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const shares = yield* Shares;
    const store = yield* EventStore;
    const book = yield* ShareBook;

    book.bind(shares.every);

    shares.bindTargets(
      targetsOf(store.model, (sessionId, turnId) =>
        Effect.orElseSucceed(store.readTurn({ sessionId, turnId }), () => null)
      )
    );
  })
);
