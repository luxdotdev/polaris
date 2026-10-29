/**
 * Restart daemon's two RPCs: the confirm's preview, read from the model and the
 * live terminals, and the clean stop of in-process Harness Turns before the Client
 * restarts the service (docs/adr/0086-restart-runs-from-the-client-through-the-service-manager.md).
 */
import { DaemonRpcs, RestartPreview, RestartWorkingSession } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import type { ReadModel, SessionRecord } from "../store/model.ts";
import { EventStore } from "../store/EventStore.ts";
import { type TerminalInfo, Terminals } from "../terminal/Terminals.ts";
import { Engine } from "./Engine.ts";

const WORKING = new Set(["starting", "working"]);

/** Working, or waiting on an approval with its Turn still in flight. */
const busy = (record: SessionRecord) =>
  WORKING.has(record.session.state) || record.turns.some((turn) => turn.status === "working");

/** Pure: what a restart would interrupt, given the model and the terminals. */
export const restartPreviewOf = (
  model: ReadModel,
  terminals: ReadonlyArray<Pick<TerminalInfo, "exit">>
): RestartPreview => {
  const records = [...model.sessions.values()];

  return RestartPreview.make({
    workingSessions: records.flatMap((record) =>
      busy(record)
        ? [
            RestartWorkingSession.make({
              sessionId: record.session.id,
              title: record.session.title,
              harness: record.session.harness,
              turn: Math.max(1, record.session.turnCount),
            }),
          ]
        : []
    ),
    terminals: terminals.filter((terminal) => terminal.exit === null).length,
    pendingApprovals: records.reduce((total, record) => total + record.pending.size, 0),
  });
};

const inFlight = (model: ReadModel) => [...model.sessions.values()].filter(busy).length;

/** The confirm's preview, from the model and the live terminals. */
export const restartPreview = Effect.gen(function* () {
  const store = yield* EventStore;
  const terminals = yield* Terminals;

  return restartPreviewOf(yield* store.model, yield* terminals.list);
});

/** Ends in-process Harness Turns as before an upgrade; answers how many Turns it ended. */
export const prepareRestart = Effect.gen(function* () {
  const store = yield* EventStore;
  const before = inFlight(yield* store.model);
  yield* (yield* Engine).prepareForUpgrade;
  const interruptedTurns = Math.max(0, before - inFlight(yield* store.model));
  yield* Effect.logInfo(`preparing for a restart ended ${interruptedTurns} Turns`);

  return { interruptedTurns };
});

const PreviewHandler = DaemonRpcs.toLayerHandler(
  "host.restartPreview",
  Effect.map(
    Effect.context<EventStore | Terminals>(),
    (context) => () => Effect.provide(restartPreview, context)
  )
);

const PrepareHandler = DaemonRpcs.toLayerHandler(
  "host.prepareRestart",
  Effect.map(
    Effect.context<Engine | EventStore>(),
    (context) => () => Effect.provide(prepareRestart, context)
  )
);

export const RestartRpcHandlers = Layer.mergeAll(PreviewHandler, PrepareHandler);
