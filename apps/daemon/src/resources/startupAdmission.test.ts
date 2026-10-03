import { expect, test } from "bun:test";
import { Command, CommandId, SessionId, TurnId } from "@polaris/protocol";
import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { Engine } from "../engine/Engine.ts";
import { CID, draft } from "../engine/constellation.testing.ts";
import { makeFakeDriver, makeFakes } from "../engine/testing.ts";
import { inputQueueWorld } from "../constellation/composition/inputQueue.testing.ts";
import { sendBack } from "../constellation/composition/sendback.testing.ts";
import { startAttempt } from "../constellation/composition/workers.ts";
import { finish, send, setup, wait } from "../constellation/delivery/testing.ts";
import { sendbackWorld } from "../mcp/sendback.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { HostResources } from "./index.ts";
import { registerWorkerAdmission, workerBusy } from "./workerAdmission.ts";

test("released worker admits the startup brief before a pre-brief user prompt behind a busy slot", async () => {
  const { driver, layer } = inputQueueWorld(makeFakes(), makeFakeDriver("codex"));
  let held = 0;
  await sendbackWorld(":memory:", false).run(
    Effect.gen(function* () {
      yield* setup();
      const engine = yield* Engine;
      const store = yield* EventStore;
      const sid = draft().sessionId;
      yield* send(sid, "Old Turn");
      const old = (yield* store.model).sessions.get(sid)!.turns.at(-1)!;
      yield* engine.runCommittedTurn(old, old.prompt);
      yield* finish(sid);
      const attempt = yield* sendBack();
      const graph = (yield* store.model).constellations.get(CID)!.graph;

      const context = yield* Layer.build(
        HostResources.layer.pipe(Layer.provide(Layer.succeed(EventStore)(store)))
      );

      const resources = Context.get(context, HostResources);
      yield* resources.setWorkerCap(CommandId.make("cap-one"), 1);

      const admission = yield* registerWorkerAdmission(
        store,
        sid,
        yield* Scope.Scope,
        Effect.acquireRelease(
          resources.acquireWorker(sid).pipe(
            Effect.interruptible,
            Effect.tap(() =>
              Effect.sync(() => {
                held++;
              })
            )
          ),
          () =>
            Effect.sync(() => {
              held--;
            })
        ),
        Effect.map(store.model, (m) => !workerBusy(m.sessions.get(sid)))
      );

      yield* admission.ensure;
      yield* admission.suspend;
      const other = yield* Scope.fork(yield* Scope.Scope);
      yield* resources.acquireWorker(SessionId.make("other-worker")).pipe(Scope.provide(other));

      const prompt = yield* engine
        .dispatch({
          commandId: CommandId.make("pre-brief-user"),
          deviceLabel: "test",
          command: Command.cases.SendTurn.make({
            sessionId: sid,
            prompt: "After the brief",
            attachments: [],
          }),
        })
        .pipe(Effect.forkChild);

      yield* wait(() => Effect.map(store.model, (m) => m.hostResources?.waiting.size === 1));
      const startup = yield* startAttempt(graph, attempt).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(held).toBe(0);
      expect(driver.sessions).toHaveLength(1);
      yield* Scope.close(other, Exit.void);
      yield* Fiber.join(startup);
      expect(held).toBe(1);
      const harness = driver.latest(sid)!;
      expect(harness.turns).toHaveLength(1);
      expect(harness.turns[0]!.turnId).toBe(TurnId.make(`${attempt.id}:start`));
      expect(harness.turns[0]!.prompt).toContain("Finish the cleanup");
      yield* finish(sid);
      yield* Fiber.join(prompt);
      yield* wait(() => Effect.succeed(harness.turns.length === 2));
      expect(harness.turns[1]!.prompt).toBe("After the brief");
      expect(held).toBe(1);
    }).pipe(Effect.scoped, Effect.timeout(5000), Effect.provide(layer))
  );
});
