import { expect, test } from "bun:test";
import {
  Attempt,
  AttemptCause,
  Command,
  CommandId,
  MessageTarget,
  ReviewAction,
  TurnId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Deferred, Effect, Exit, Fiber, Layer, Struct } from "effect";
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
import { finish, send, setup, wait, world } from "../delivery/testing.ts";
import { ConstellationOwner, ConstellationRuntime } from "../runtime.ts";
import { Constellations } from "../service.ts";
import { inputQueueWorld } from "./inputQueue.testing.ts";
import { sendBack } from "./sendback.testing.ts";
import { startAttempt } from "./workers.ts";
import { WorktreeSetupService } from "../setup/index.ts";

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
        Effect.catchTag("StartupAbandoned", (error) => Effect.succeed(error.attemptId)),
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
      expect(yield* Fiber.join(startup)).toEqual(Exit.succeed(attempt.id));
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

      expect(markerEvents.some((e) => e.commandId === `${attempt.id}:startup-failed`)).toBe(false);
      expect((yield* store.model).sessions.get(sid)!.session.lastError).toBeNull();
      yield* recordSendbackTrace("guard-rejected-input");
    }).pipe(Effect.provide(layer), Effect.provideService(ConstellationOwner, HOST))
  );
}, 10000);

test("stopping setup preserves an Existing Session for queued input and a new Attempt", async () => {
  const first = Attempt.make(
    Struct.assign(draft(), { startupSetup: { command: "paused setup", force: true } })
  );

  const next = draft(
    first.taskId,
    "next-attempt",
    first.sessionId,
    AttemptCause.cases.Followup.make({ ref: first.id })
  );

  const runtime = Layer.succeed(ConstellationRuntime)({
    prepare: (_binding, command, model) =>
      Effect.succeed({
        attempts: [
          model.constellations.get(command.constellationId)?.graph.attempts.length === 0
            ? first
            : next,
        ],
        newLeadSessionId: null,
        claimProbe: null,
        recordedChecks: [],
      }),
    resumeWorking: () => Effect.void,
    afterCommit: () => Effect.void,
  });

  const { driver, layer } = inputQueueWorld(makeFakes(), makeFakeDriver("codex", { steer: true }));

  await world(":memory:", { runtime }).run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const engine = yield* Engine;
      const graphs = yield* Constellations;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const graph = (yield* store.model).constellations.get(CID)!.graph;

      const startup = yield* startAttempt(graph, first).pipe(
        Effect.provideService(WorktreeSetupService, {
          run: () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(null)
            ),
        }),
        Effect.exit,
        Effect.forkChild
      );

      yield* Deferred.await(entered);
      expect((yield* store.model).sessions.get(first.sessionId)!.session.state).toBe("idle");

      const prompt = yield* engine
        .dispatch({
          commandId: CommandId.make("stopped-setup-user"),
          deviceLabel: "test",
          command: Command.cases.SendTurn.make({
            sessionId: first.sessionId,
            prompt: "After stop",
            attachments: [],
          }),
        })
        .pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* graphs.command(
        { kind: "user" },
        CommandId.make("stop-during-setup"),
        C.Review.make({
          constellationId: CID,
          attemptId: first.id,
          revision: first.revision,
          action: ReviewAction.cases.Stop.make({ reason: "Stop while setup runs" }),
        })
      );
      yield* Deferred.succeed(release, undefined);
      expect(Exit.isFailure(yield* Fiber.join(startup))).toBe(true);
      expect(yield* store.hasCommandReceipt(CommandId.make(`${first.id}:startup-failed`))).toBe(
        true
      );
      expect(yield* store.hasCommandReceipt(CommandId.make(`${first.id}:start`))).toBe(false);
      expect((yield* store.model).sessions.get(first.sessionId)!.session.state).not.toBe("failed");
      expect((yield* store.model).sessions.get(first.sessionId)!.session.lastError).toBeNull();

      yield* Fiber.join(prompt);
      yield* wait(() =>
        Effect.succeed(driver.latest(first.sessionId)?.turns[0]?.prompt === "After stop")
      );

      yield* finish(first.sessionId);
      yield* graphs.command(
        { kind: "user" },
        CommandId.make("dispatch-after-stop"),
        C.Dispatch.make({
          constellationId: CID,
          tasks: [
            {
              taskId: first.taskId,
              worker: WorkerPlacement.cases.Existing.make({ sessionId: first.sessionId }),
            },
          ],
        })
      );

      const current = (yield* store.model).constellations.get(CID)!.graph;
      expect(current.attempts.at(-1)!.id).toBe(next.id);
      yield* startAttempt(current, next);
      expect(yield* store.hasCommandReceipt(CommandId.make(`${next.id}:start`))).toBe(true);
      expect((yield* store.model).sessions.get(first.sessionId)!.session.state).toBe("working");
      expect((yield* store.model).sessions.get(first.sessionId)!.session.lastError).toBeNull();
      yield* recordSendbackTrace(
        "stopped-setup-new-attempt",
        new Map([["stop-during-setup", { offlineSessionIds: [], commanded: true }]])
      );
    }).pipe(Effect.provide(layer), Effect.provideService(ConstellationOwner, HOST))
  );
}, 10000);
