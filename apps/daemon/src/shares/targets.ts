/**
 * What a Share can target, read from the event store's model: a session touches itself and
 * the Constellation it belongs to, as its Lead or as a Worker, so a Constellation's Share
 * covers Workers added after it was made.
 */
import type { SessionId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import type { ReadModel } from "../store/model.ts";
import { EventStore } from "../store/EventStore.ts";
import { Shares, type ShareTargets } from "./service.ts";

const constellationOf = (model: ReadModel, sessionId: SessionId) => {
  const worker = model.sessions.get(sessionId)?.session.worker ?? null;

  if (worker !== null) return worker.constellationId;

  for (const { graph } of model.constellations.values())
    if (graph.leadSessionId === sessionId) return graph.id;

  return null;
};

export const targetsOf = (model: Effect.Effect<ReadModel>): ShareTargets => ({
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
});

/** Binds the Shares to the Engine's sessions and Constellations once the event store is up. */
export const ShareTargetsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const shares = yield* Shares;
    const store = yield* EventStore;

    shares.bindTargets(targetsOf(store.model));
  })
);
