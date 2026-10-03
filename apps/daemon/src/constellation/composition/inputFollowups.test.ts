import { expect, test } from "bun:test";
import { Command, CommandId, MessageTarget, TurnId } from "@polaris/protocol";
import { Effect, Exit, Fiber } from "effect";
import { Engine } from "../../engine/Engine.ts";
import { C, CID, HOST, draft } from "../../engine/constellation.testing.ts";
import { makeFakes, makeFakeDriver } from "../../engine/testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { sendbackWorld } from "../../mcp/sendback.testing.ts";
import { recordSendbackTrace } from "../../mcp/sendback.trace.testing.ts";
import { applyWorkerDelivery } from "../delivery/turns.ts";
import { deliverLocalInput } from "../delivery/local.ts";
import { pendingInputs } from "../delivery/messages.ts";
import { ConstellationSessionEffects, DeliveryInput } from "../delivery/inputs.ts";
import { finish, send, setup, wait } from "../delivery/testing.ts";
import { ConstellationOwner } from "../runtime.ts";
import { Constellations } from "../service.ts";
import { inputQueueWorld } from "./inputQueue.testing.ts";
import { sendBack } from "./sendback.testing.ts";
import { startAttempt } from "./workers.ts";

for (const route of ["local", "remote-steer", "remote-message"] as const)
  test(`Lead delivery bypasses queued prompts during the brief Turn: ${route}`, async () => {
    const { driver, layer } = inputQueueWorld(
      makeFakes(),
      makeFakeDriver("codex", { steer: true })
    );

    await sendbackWorld(":memory:", false).run(
      Effect.gen(function* () {
        yield* setup();
        const engine = yield* Engine;
        const store = yield* EventStore;
        const sid = draft().sessionId;
        yield* send(sid, "Old Turn");
        const old = (yield* store.model).sessions.get(sid)!.turns.at(-1)!;
        yield* engine.runCommittedTurn(old, old.prompt);
        const attempt = yield* sendBack();
        const graph = (yield* store.model).constellations.get(CID)!.graph;

        const prompt = yield* engine
          .dispatch({
            commandId: CommandId.make("queued-user"),
            deviceLabel: "test",
            command: Command.cases.SendTurn.make({
              sessionId: sid,
              prompt: "User prompt",
              attachments: [],
            }),
          })
          .pipe(Effect.forkChild);

        yield* Effect.yieldNow;
        const startup = yield* startAttempt(graph, attempt).pipe(Effect.forkChild);
        yield* finish(sid);
        yield* Fiber.join(startup);
        yield* wait(() =>
          Effect.map(store.model, (m) => m.sessions.get(sid)?.session.state === "working")
        );
        const briefHarness = driver.latest(sid)!;
        expect(briefHarness.turns).toHaveLength(1);
        expect((yield* store.model).sessions.get(sid)!.turns.at(-1)!.id).toBe(
          TurnId.make(`${attempt.id}:start`)
        );

        const graphs = yield* Constellations;
        yield* graphs.command(
          { kind: "user" },
          CommandId.make("lead-message"),
          C.Message.make({
            constellationId: CID,
            target: MessageTarget.cases.Worker.make({ attemptId: attempt.id }),
            text: "Lead live steer",
          })
        );
        const input = pendingInputs((yield* store.model).constellations.get(CID)!)[0]!;

        const delivery =
          route === "local"
            ? deliverLocalInput(CID, input)
            : applyWorkerDelivery(
                {
                  id: "remote-live-steer",
                  ownerHostId: HOST,
                  workerHostId: HOST,
                  constellationId: CID,
                  attemptId: attempt.id,
                  sessionId: sid,
                  input:
                    route === "remote-steer"
                      ? DeliveryInput.Steer({ text: input.text })
                      : DeliveryInput.Turn({ text: input.text, cause: "message" }),
                },
                () => Effect.void
              );

        const delivered = yield* delivery.pipe(Effect.forkChild);
        yield* wait(() => Effect.succeed(briefHarness.steers.length === 1));
        yield* Fiber.join(delivered);
        expect(briefHarness.steers).toEqual([input.text]);
        expect(briefHarness.turns).toHaveLength(1);
        expect((yield* store.model).sessions.get(sid)!.turns.at(-1)!.id).toBe(
          TurnId.make(`${attempt.id}:start`)
        );
        yield* finish(sid);
        yield* Fiber.join(prompt);
        yield* wait(() => Effect.succeed(briefHarness.turns.length === 2));
        expect(briefHarness.turns[1]!.prompt).toBe("User prompt");
        expect(briefHarness.steers).toEqual([input.text]);
        yield* recordSendbackTrace(`lead-steer-${route}`);
      }).pipe(Effect.provide(layer), Effect.provideService(ConstellationOwner, HOST))
    );
  }, 10000);

test("startup guard rejection clears the fence while the Attempt stays working", async () => {
  const { driver, layer } = inputQueueWorld(makeFakes(), makeFakeDriver("codex", { steer: true }));
  await sendbackWorld(":memory:", false).run(
    Effect.gen(function* () {
      yield* setup();
      const engine = yield* Engine;
      const store = yield* EventStore;
      const effects = yield* ConstellationSessionEffects;
      const sid = draft().sessionId;
      yield* send(sid, "Old Turn");
      const old = (yield* store.model).sessions.get(sid)!.turns.at(-1)!;
      yield* engine.runCommittedTurn(old, old.prompt);
      const attempt = yield* sendBack();
      const graph = (yield* store.model).constellations.get(CID)!.graph;
      let eligible = true;

      const startup = yield* startAttempt(graph, attempt, () => Effect.succeed(eligible)).pipe(
        Effect.provideService(ConstellationSessionEffects, {
          ...effects,
          retire: (id) =>
            effects.retire(id).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  eligible = false;
                })
              )
            ),
        }),
        Effect.exit,
        Effect.forkChild
      );

      const prompt = yield* engine
        .dispatch({
          commandId: CommandId.make("guard-rejected-user"),
          deviceLabel: "test",
          command: Command.cases.SendTurn.make({
            sessionId: sid,
            prompt: "After rejected startup",
            attachments: [],
          }),
        })
        .pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* finish(sid);
      expect(Exit.isFailure(yield* Fiber.join(startup))).toBe(true);
      expect((yield* store.model).constellations.get(CID)!.graph.attempts.at(-1)!.state).toBe(
        "working"
      );
      expect(yield* store.hasCommandReceipt(CommandId.make(`${attempt.id}:start`))).toBe(false);
      expect(yield* store.hasCommandReceipt(CommandId.make(`${attempt.id}:startup-failed`))).toBe(
        true
      );
      yield* Fiber.join(prompt);
      yield* wait(() =>
        Effect.succeed(driver.latest(sid)!.turns.at(-1)?.prompt === "After rejected startup")
      );
      expect(driver.latest(sid)!.turns[0]!.prompt).toBe("After rejected startup");

      const markerEvents = yield* store.readEvents({
        after: 0,
        upTo: (yield* store.model).sequence,
        sessionId: sid,
      });

      expect(markerEvents.some((e) => e.commandId === `${attempt.id}:startup-failed`)).toBe(true);
      yield* recordSendbackTrace("guard-rejected-input");
    }).pipe(Effect.provide(layer), Effect.provideService(ConstellationOwner, HOST))
  );
}, 10000);
