import { expect, test } from "bun:test";
import { Command, CommandId, MessageTarget, TurnId } from "@polaris/protocol";
import { Effect, Fiber, Latch, Layer } from "effect";
import { Engine, EngineConfig } from "../../engine/Engine.ts";
import { C, CID, HOST, draft } from "../../engine/constellation.testing.ts";
import {
  fakeServices,
  makeFakes,
  makeFakeDriver,
  pendingReviewCheckoutGit,
} from "../../engine/testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { engineDeliveryLayer } from "../delivery/engine.ts";
import { deliverLocalInput } from "../delivery/local.ts";
import { pendingInputs } from "../delivery/messages.ts";
import { finish, send, setup, wait } from "../delivery/testing.ts";
import { ConstellationOwner } from "../runtime.ts";
import { sendbackWorld } from "../../mcp/sendback.testing.ts";
import { recordSendbackTrace } from "../../mcp/sendback.trace.testing.ts";
import { sendBack } from "./sendback.testing.ts";
import { startAttempt } from "./workers.ts";

for (const userMode of ["steer", "turn"] as const)
  for (const inputFirst of [true, false])
    test(`SendBack brief precedes new input while Steer reaches the old Turn; inputFirst=${inputFirst}, userMode=${userMode}`, async () => {
      const driver = makeFakeDriver("codex", { steer: true });

      const engine = Engine.layer.pipe(
        Layer.provide(fakeServices(makeFakes(), [driver])),
        Layer.provide(pendingReviewCheckoutGit),
        Layer.provide(
          Layer.succeed(EngineConfig)({ idleTimeout: "1 hour", checkpointSweepInterval: null })
        )
      );

      const delivery = engineDeliveryLayer.pipe(Layer.provideMerge(engine));
      const w = sendbackWorld(":memory:", false);

      await w.run(
        Effect.gen(function* () {
          yield* setup();
          const store = yield* EventStore;
          const engine = yield* Engine;
          const effects = yield* ConstellationSessionEffects;
          const sid = draft().sessionId;
          yield* send(sid, "Earlier work");
          const oldTurn = (yield* store.model).sessions.get(sid)!.turns.at(-1)!;
          yield* engine.runCommittedTurn(oldTurn, oldTurn.prompt);
          const oldHarness = driver.latest(sid)!;
          const attempt = yield* sendBack();
          const graphs = yield* Constellations;
          yield* graphs.command(
            { kind: "user" },
            CommandId.make("queued-lead"),
            C.Message.make({
              constellationId: CID,
              target: MessageTarget.cases.Worker.make({ attemptId: attempt.id }),
              text: "Lead follow-up",
            })
          );
          const graph = (yield* store.model).constellations.get(CID)!.graph;
          const input = pendingInputs((yield* store.model).constellations.get(CID)!)[0]!;
          const atRetire = Latch.makeUnsafe(false);
          const allowRetire = Latch.makeUnsafe(false);

          const stalled = {
            ...effects,
            retire: (id: typeof sid) =>
              Effect.gen(function* () {
                atRetire.openUnsafe();
                yield* allowRetire.await;
                yield* effects.retire(id);
              }),
          };

          const start = () =>
            startAttempt(graph, attempt).pipe(
              Effect.provideService(ConstellationSessionEffects, stalled),
              Effect.forkChild
            );

          const inputs = () =>
            Effect.gen(function* () {
              const lead = yield* deliverLocalInput(CID, input).pipe(Effect.forkChild);

              const user = yield* engine
                .dispatch({
                  commandId: CommandId.make("queued-user"),
                  deviceLabel: "test",
                  command:
                    userMode === "steer"
                      ? Command.cases.Steer.make({ sessionId: sid, text: "User follow-up" })
                      : Command.cases.SendTurn.make({
                          sessionId: sid,
                          prompt: "User follow-up",
                          attachments: [],
                        }),
                })
                .pipe(Effect.forkChild);

              return { lead, user };
            });

          const earlierQueued = inputFirst ? yield* inputs() : null;
          const startup = yield* start();
          const duplicate = yield* start();

          const queued = earlierQueued ?? (yield* inputs());

          if (userMode === "steer") {
            yield* Fiber.join(queued.user);
            yield* wait(() => Effect.succeed(oldHarness.steers.includes("User follow-up")));
          }

          yield* finish(sid);
          yield* atRetire.await;
          yield* Effect.yieldNow;
          expect(oldHarness.closed).toBe(false);
          expect(oldHarness.steers).toEqual(userMode === "steer" ? ["User follow-up"] : []);
          expect(driver.sessions).toHaveLength(1);
          allowRetire.openUnsafe();
          yield* Fiber.join(startup);
          yield* Fiber.join(duplicate);
          yield* Fiber.join(queued.lead);

          if (userMode === "turn") {
            expect(driver.latest(sid)!.turns).toHaveLength(1);
            yield* finish(sid);
          }

          yield* Fiber.join(queued.user);
          yield* wait(() =>
            Effect.succeed(
              userMode === "steer"
                ? driver.latest(sid)?.steers.length === 1
                : driver.latest(sid)?.turns.length === 2
            )
          );
          const current = driver.latest(sid)!;
          expect(current).not.toBe(oldHarness);
          expect(oldHarness.closed).toBe(true);
          expect(current.closed).toBe(false);
          expect(current.turns[0]!.turnId).toBe(TurnId.make(`${attempt.id}:start`));
          expect(current.turns[0]!.prompt).toContain("Finish the cleanup");

          if (userMode === "steer") expect(current.steers).not.toContain("User follow-up");
          else expect(current.turns[1]!.prompt).toBe("User follow-up");
          expect(current.steers.some((s) => s.includes("Lead follow-up"))).toBe(true);
          expect(driver.sessions).toHaveLength(2);
          yield* recordSendbackTrace(`serialized-boundary-${inputFirst}-${userMode}`);
        }).pipe(Effect.provide(delivery), Effect.provideService(ConstellationOwner, HOST))
      );
    }, 15000);
