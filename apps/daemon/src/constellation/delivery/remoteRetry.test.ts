import { expect, test } from "bun:test";
import { Attempt, CommandId, HostId, MessageTarget } from "@polaris/protocol";
import { Effect, Struct } from "effect";
import { C, CID, HOST, draft } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import { observeWorkerHost } from "../recovery.ts";
import { ConstellationOwner } from "../runtime.ts";
import { ConstellationDelivery } from "./index.ts";
import { setup, wait, WORKER, world } from "./testing.ts";

for (const retry of ["reconnect", "acknowledgement"] as const) {
  test(`a failed remote unblock retries on ${retry} without another graph event`, async () => {
    const remoteId = HostId.make("remote-worker");
    let sends = 0;

    const w = world(":memory:", {
      attempt: Attempt.make(Struct.assign(draft(), { hostId: remoteId })),
      remoteSend: () =>
        Effect.suspend(() => (++sends === 1 ? Effect.die("disconnected") : Effect.void)),
    });

    await w.run(
      Effect.gen(function* () {
        yield* setup();
        const graphs = yield* Constellations;
        const store = yield* EventStore;
        const delivery = yield* ConstellationDelivery;
        yield* graphs.command(
          { kind: "session", sessionId: WORKER },
          CommandId.make("block"),
          C.WorkerBlock.make({
            constellationId: CID,
            attemptId: draft().id,
            on: [],
            reason: "Need direction",
          })
        );
        yield* graphs.command(
          { kind: "user" },
          CommandId.make("message"),
          C.Message.make({
            constellationId: CID,
            target: MessageTarget.cases.Worker.make({ attemptId: draft().id }),
            text: "Continue",
          })
        );
        yield* delivery.start();
        yield* wait(() => Effect.succeed(sends === 1));
        yield* Effect.yieldNow;
        const before = (yield* store.model).sequence;
        expect((yield* store.model).constellations.get(CID)!.graph.attempts[0]!.state).toBe(
          "blocked"
        );

        if (retry === "reconnect")
          yield* observeWorkerHost(remoteId, false).pipe(
            Effect.provideService(ConstellationOwner, HOST)
          );
        else yield* delivery.acknowledge("already-delivered", WORKER);
        yield* wait(() =>
          Effect.map(
            store.model,
            (m) => m.constellations.get(CID)!.graph.attempts[0]!.state === "working"
          )
        );
        expect(sends).toBe(2);

        const events = yield* store.readConstellationEvents({
          constellationId: CID,
          after: before,
          upTo: (yield* store.model).sequence,
        });

        expect(events.map((e) => e.event._tag)).toEqual([
          "AttemptUnblocked",
          "WorkerInputDelivered",
          "OperatorMessageResolved",
        ]);
        yield* delivery.flush();
        expect(sends).toBe(2);
      })
    );
  });
}
