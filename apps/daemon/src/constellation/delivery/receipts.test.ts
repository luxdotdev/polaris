import { expect, test } from "bun:test";
import { AttemptId, CommandId, CommandRejected, MessageTarget } from "@polaris/protocol";
import { Effect, Fiber } from "effect";
import { CID, C, HOST } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import {
  ConstellationDelivery,
  DeliveryInput,
  applyWorkerDelivery,
  type DeliveryPacket,
} from "./index.ts";
import { setup, world, WORKER, send, finish, signal, wait } from "./testing.ts";

const packet = (id: string): DeliveryPacket => ({
  id,
  ownerHostId: HOST,
  workerHostId: HOST,
  constellationId: CID,
  attemptId: AttemptId.make("a1"),
  sessionId: WORKER,
  input: DeliveryInput.Turn({ text: "Use base2", cause: "message" }),
});

test("worker receipt deduplicates before binding and archived-state checks", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      let checks = 0;

      const validate = () =>
        Effect.sync(() => {
          checks++;
        });

      yield* applyWorkerDelivery(packet("opaque-1"), validate);
      yield* finish(WORKER);
      yield* signal(WORKER, { type: "session.archive", at: "2026-10-01T00:00:00Z" });
      yield* applyWorkerDelivery(packet("opaque-1"), () =>
        Effect.fail(
          new CommandRejected({
            commandId: CommandId.make("opaque-1"),
            reason: "The binding was revoked",
          })
        )
      );
      expect(checks).toBe(1);
      expect(w.turns).toHaveLength(1);
      expect(w.steers).toHaveLength(0);
    })
  );
});

test("a busy non-steering worker waits for a Session event without consuming the receipt", async () => {
  const w = world(":memory:", { canSteer: false });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      yield* send(WORKER);

      const fiber = yield* applyWorkerDelivery(packet("opaque-2"), () => Effect.void).pipe(
        Effect.forkChild
      );

      yield* Effect.promise(() => Bun.sleep(10));
      expect(w.turns).toHaveLength(0);
      yield* finish(WORKER);
      yield* Fiber.join(fiber);
      expect(w.turns).toHaveLength(1);
      yield* applyWorkerDelivery(packet("opaque-2"), () => Effect.void);
      expect(w.turns).toHaveLength(1);
    })
  );
});

test("immutable recipient IDs acknowledge once; replay neither resolves early nor starts another Turn", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const graphs = yield* Constellations;
      const delivery = yield* ConstellationDelivery;
      const store = yield* EventStore;
      yield* graphs.command(
        { kind: "user" },
        CommandId.make("message"),
        C.Message.make({
          constellationId: CID,
          target: MessageTarget.cases.Worker.make({ attemptId: AttemptId.make("a1") }),
          text: "Use base2",
          authority: "may_decide_and_continue",
        })
      );
      const sourceId = [...(yield* store.model).constellations.get(CID)!.messages.keys()][0]!;
      expect((yield* store.model).constellations.get(CID)!.inputDeliveries.size).toBe(0);
      const immutableId = JSON.stringify([sourceId, WORKER]);
      yield* delivery.acknowledge(immutableId, WORKER);
      yield* delivery.acknowledge(immutableId, WORKER);
      expect((yield* store.model).constellations.get(CID)!.messages.size).toBe(0);
      expect((yield* store.model).constellations.get(CID)!.inputDeliveries.size).toBe(1);
      yield* delivery.start();
      yield* wait(() => Effect.succeed(w.turns.length === 0));
      expect(w.turns).toHaveLength(0);
    })
  );
});

test("remote unblock waits for a Turn boundary even when the worker can steer; retries start once", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      yield* send(WORKER);

      const input = {
        ...packet("unblock-1"),
        input: DeliveryInput.Turn({ text: "B accepted at feed-head", cause: "unblock" }),
      };

      const fiber = yield* applyWorkerDelivery(input, () => Effect.void).pipe(Effect.forkChild);
      yield* Effect.promise(() => Bun.sleep(10));
      expect(w.turns).toHaveLength(0);
      expect(w.steers).toHaveLength(0);
      yield* finish(WORKER);
      yield* Fiber.join(fiber);
      expect(w.turns).toHaveLength(1);
      expect(w.steers).toHaveLength(0);
      yield* applyWorkerDelivery(input, () => Effect.void);
      expect(w.turns).toHaveLength(1);
    })
  );
});
