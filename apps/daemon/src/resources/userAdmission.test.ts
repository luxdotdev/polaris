import { expect, test } from "bun:test";
import {
  Command,
  CommandRejected,
  DomainEvent,
  TurnItem,
  SessionId,
  SessionPlacement,
  TurnId,
  TurnTrigger,
} from "@polaris/protocol";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Match, Scope } from "effect";
import { wait } from "../constellation/delivery/testing.ts";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "../engine/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { Checkpoints } from "../services.ts";
import { HostResources } from "./index.ts";
import { registerWorkerAdmission, workerBusy } from "./workerAdmission.ts";

const S = SessionId.make("blocked-user");

const B = SessionId.make("capacity-holder");

for (const kind of ["SendTurn", "Continue", "Retry"] as const)
  test(`direct ${kind} reacquires released worker admission without locking out Steer`, async () => {
    let held = 0;
    const executionSlots: number[] = [];

    const driver = makeFakeDriver("codex", {
      steer: true,
      onTurn: () => {
        executionSlots.push(held);

        return [];
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* Engine;
        const store = yield* EventStore;

        const dispatch = (command: Command) =>
          engine.dispatch({ commandId: cid(), command, deviceLabel: "test" });

        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: S,
            workspaceId: [...model.workspaces.keys()][0]!,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "initial",
            attachments: [],
          })
        );
        yield* waitUntil(() => executionSlots.length === 1);
        const harness = driver.latest(S)!;
        harness.emit(
          HarnessEvent.TurnEnded({
            turnId: harness.turns[0]!.turnId,
            status: Match.value(kind).pipe(
              Match.when("Continue", () => "interrupted" as const),
              Match.when("Retry", () => "failed" as const),
              Match.orElse(() => "completed" as const)
            ),
            error: kind === "Retry" ? "failed preparation" : null,
          })
        );
        yield* waitFor((m) => !m.sessions.get(S)!.turns.some((t) => t.status === "working"));

        const context = yield* Layer.build(
          HostResources.layer.pipe(Layer.provide(Layer.succeed(EventStore)(store)))
        );

        const resources = Context.get(context, HostResources);
        yield* resources.setWorkerCap(cid(), 1);

        const admission = yield* registerWorkerAdmission(
          store,
          S,
          yield* Scope.Scope,
          Effect.acquireRelease(
            resources.acquireWorker(S).pipe(
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
          Effect.map(store.model, (m) => !workerBusy(m.sessions.get(S)))
        );

        yield* admission.ensure;
        yield* admission.suspend;
        expect(held).toBe(0);
        const other = yield* Scope.fork(yield* Scope.Scope);
        yield* resources.acquireWorker(B).pipe(Scope.provide(other));

        const command = Match.value(kind).pipe(
          Match.when("SendTurn", () =>
            Command.cases.SendTurn.make({ sessionId: S, prompt: "next", attachments: [] })
          ),
          Match.when("Continue", () => Command.cases.Continue.make({ sessionId: S })),
          Match.when("Retry", () => Command.cases.Retry.make({ sessionId: S })),
          Match.exhaustive
        );

        const input = yield* dispatch(command).pipe(Effect.forkChild);
        yield* waitFor((m) => (m.hostResources?.waiting.size ?? 0) === 1);
        expect(executionSlots).toEqual([0]);

        const steer = yield* dispatch(
          Command.cases.Steer.make({ sessionId: S, text: "steer" })
        ).pipe(Effect.flip, Effect.timeout(200));

        expect(steer).toBeInstanceOf(CommandRejected);
        expect(executionSlots).toEqual([0]);
        yield* Scope.close(other, Exit.void);
        yield* Fiber.join(input);
        yield* waitUntil(() => executionSlots.length === 2);
        expect(executionSlots).toEqual([0, 1]);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          engineLayer({
            filename: `${tempDir()}/store.sqlite`,
            fakes: makeFakes(),
            drivers: [driver],
          })
        )
      )
    );
  });

for (const outcome of ["resume", "retire"] as const)
  test(`deferred accepted prompt ${outcome} after its native target ends keeps correct admission`, async () => {
    const native = TurnId.make("native-before-admission");
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    let held = 0;
    const executionSlots: number[] = [];

    const driver = makeFakeDriver("codex", {
      onTurn: () => {
        executionSlots.push(held);

        return [];
      },
    });

    const checkpoints = Layer.succeed(Checkpoints)({
      capture: ({ turnId, label }) =>
        turnId === native && label === "before"
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(null)
            )
          : Effect.succeed(null),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* Engine;
        const store = yield* EventStore;

        const dispatch = (command: Command) =>
          engine.dispatch({ commandId: cid(), command, deviceLabel: "test" });

        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: S,
            workspaceId: [...model.workspaces.keys()][0]!,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "initial",
            attachments: [],
          })
        );
        yield* waitUntil(() => executionSlots.length === 1);
        const harness = driver.latest(S)!;
        harness.emit(
          HarnessEvent.TurnEnded({
            turnId: harness.turns[0]!.turnId,
            status: "completed",
            error: null,
          })
        );
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
        harness.emit(
          HarnessEvent.TurnStarted({
            turnId: native,
            prompt: null,
            trigger: TurnTrigger.cases.BackgroundTasksReported.make({ tasks: [] }),
          })
        );
        yield* waitFor((m) => m.sessions.get(S)?.turns.some((t) => t.id === native) === true);

        const context = yield* Layer.build(
          HostResources.layer.pipe(Layer.provide(Layer.succeed(EventStore)(store)))
        );

        const resources = Context.get(context, HostResources);
        yield* resources.setWorkerCap(cid(), 1);

        const admissionScope = yield* Scope.fork(yield* Scope.Scope);

        const admission = yield* registerWorkerAdmission(
          store,
          S,
          admissionScope,
          Effect.acquireRelease(
            resources.acquireWorker(S).pipe(
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
          Effect.map(store.model, (m) => !workerBusy(m.sessions.get(S)))
        );

        yield* admission.ensure;
        yield* dispatch(
          Command.cases.SendTurn.make({ sessionId: S, prompt: "accepted once", attachments: [] })
        );
        yield* Deferred.await(entered);
        const other = yield* Scope.fork(yield* Scope.Scope);

        const waitingB = yield* resources
          .acquireWorker(B)
          .pipe(Scope.provide(other), Effect.forkChild);

        yield* waitFor((m) => (m.hostResources?.waiting.size ?? 0) === 1);
        harness.emit(HarnessEvent.TurnEnded({ turnId: native, status: "completed", error: null }));
        yield* waitFor((m) => !m.sessions.get(S)!.turns.some((t) => t.status === "working"));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(waitingB);
        yield* waitFor((m) => (m.hostResources?.waiting.size ?? 0) === 1);
        expect(harness.turns).toHaveLength(1);

        const steer = yield* dispatch(
          Command.cases.Steer.make({ sessionId: S, text: "free queue" })
        ).pipe(Effect.flip, Effect.timeout(200));

        expect(steer).toBeInstanceOf(CommandRejected);

        if (outcome === "retire") {
          yield* Scope.close(admissionScope, Exit.void);
          yield* wait(() =>
            Effect.gen(function* () {
              const events = yield* store.readEvents({
                after: 0,
                upTo: (yield* store.model).sequence,
                sessionId: S,
              });

              return events.some(
                (e) =>
                  DomainEvent.guards.TurnItemCompleted(e.event) &&
                  TurnItem.guards.Error(e.event.item) &&
                  e.event.item.message.includes("admission was retired")
              );
            }).pipe(Effect.orDie)
          );

          const events = yield* store.readEvents({
            after: 0,
            upTo: (yield* store.model).sequence,
            sessionId: S,
          });

          const refusals = events.flatMap((e) =>
            DomainEvent.guards.TurnItemCompleted(e.event) && e.event.item.id.startsWith("refused:")
              ? [e.event.item]
              : []
          );

          expect(refusals).toMatchObject([{ text: "accepted once" }]);
          expect(harness.turns).toHaveLength(1);
          expect(held).toBe(0);
          yield* Scope.close(other, Exit.void);

          return;
        }

        yield* Scope.close(other, Exit.void);
        yield* waitUntil(() => harness.turns.length === 2);
        expect(harness.turns[1]!.prompt).toBe("accepted once");
        expect(harness.turns[1]!.turnId).not.toBe(native);
        expect(executionSlots).toEqual([0, 1]);
        expect(
          (yield* store.model).sessions.get(S)!.turns.filter((t) => t.prompt === "accepted once")
        ).toHaveLength(1);
      }).pipe(
        Effect.scoped,
        Effect.timeout(5000),
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.provide(
          engineLayer({
            filename: `${tempDir()}/store.sqlite`,
            fakes: makeFakes(),
            drivers: [driver],
            checkpoints,
          })
        )
      )
    );
  });
