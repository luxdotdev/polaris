import { expect, test } from "bun:test";
import {
  Command,
  CommandId,
  ConstellationSettings,
  PlanOperation,
  SessionId,
  SessionPlacement,
} from "@polaris/protocol";
import { Context, Effect, Exit, Fiber, Layer, Predicate, Scope } from "effect";
import { A, C, CID, ctx, draft, task } from "../engine/constellation.testing.ts";
import { decideConstellation } from "../engine/constellation.ts";
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
import { ConstellationRuntime } from "../constellation/runtime.ts";
import { workingAttemptsLayer } from "../constellation/working.ts";
import { EventStore } from "../store/EventStore.ts";
import { HostResources } from "./index.ts";
import { StartupAbandoned } from "../constellation/composition/startupAbandoned.ts";

const S = SessionId.make("abandoned-worker-input");

for (const mode of ["start", "resume"] as const)
  test(`${mode} abandonment retains registration and the next user Turn reacquires FIFO capacity`, async () => {
    const driver = makeFakeDriver("codex");
    let failures = 0;
    let held = 0;
    let abandoned = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* Engine;
        const store = yield* EventStore;

        const dispatch = (command: Command) =>
          engine.dispatch({ commandId: cid(), command, deviceLabel: "test" });

        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        const workspaceId = [...model.workspaces.keys()][0]!;
        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: S,
            workspaceId,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "initial",
            attachments: [],
          })
        );
        yield* waitUntil(() => (driver.latest(S)?.turns.length ?? 0) === 1);
        const harness = driver.latest(S)!;
        harness.emit(
          HarnessEvent.TurnEnded({
            turnId: harness.turns[0]!.turnId,
            status: "completed",
            error: null,
          })
        );
        yield* waitFor((m) => !m.sessions.get(S)!.turns.some((t) => t.status === "working"));
        const attempt = draft(A, "failure", S);

        const resourceContext = yield* Layer.build(
          HostResources.layer.pipe(Layer.provide(Layer.succeed(EventStore)(store)))
        );

        const resources = Context.get(resourceContext, HostResources);
        yield* resources.setWorkerCap(cid(), 1);

        const abandon = store
          .commit({
            commandId: CommandId.make(`${attempt.id}:startup-failed`),
            decide: () => Effect.succeed([]),
          })
          .pipe(
            Effect.orDie,
            Effect.tap(() =>
              Effect.sync(() => {
                abandoned = true;
              })
            ),
            Effect.andThen(Effect.fail(new StartupAbandoned({ attemptId: attempt.id })))
          );

        const context = yield* Layer.build(
          workingAttemptsLayer({
            runtime: {
              prepare: () =>
                Effect.succeed({
                  attempts: [],
                  newLeadSessionId: null,
                  claimProbe: null,
                  recordedChecks: [],
                }),
              resumeWorking: () => Effect.void,
              afterCommit: () => Effect.void,
            },
            acquireWorker: () =>
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
            startWorker: () => abandon,
            resumeWorker: () => abandon,
            failed: () =>
              Effect.sync(() => {
                failures++;
              }),
          }).pipe(Layer.provide(Layer.succeed(EventStore)(store)))
        );

        const runtime = Context.get(context, ConstellationRuntime);

        for (const command of [
          C.Plan.make({
            constellationId: CID,
            start: {
              workspaceId,
              name: "Failure",
              leadSessionId: S,
              settings: ConstellationSettings.make({}),
            },
            operations: [PlanOperation.cases.Add.make({ task: task() })],
          }),
          C.Dispatch.make({ constellationId: CID }),
        ]) {
          const result = yield* store.commit({
            commandId: cid(),
            decide: (m) => {
              const decision = decideConstellation(
                m.constellations.get(CID),
                command,
                ctx({ attempts: [attempt] })
              );

              expect(decision.rejection).toBeNull();

              return Effect.succeed(decision.events);
            },
          });

          if (mode !== "resume" && Predicate.isTagged(result, "Committed"))
            yield* runtime.afterCommit({ kind: "user" }, command, result.envelopes);
        }

        if (mode === "resume") yield* runtime.resumeWorking();
        yield* waitUntil(() => abandoned && held === 0);
        expect(failures).toBe(0);
        expect((yield* store.model).sessions.get(S)!.session.state).toBe("idle");

        const other = yield* Scope.fork(yield* Scope.Scope);
        yield* resources.acquireWorker(SessionId.make("other-worker")).pipe(Scope.provide(other));

        const input = yield* dispatch(
          Command.cases.SendTurn.make({
            sessionId: S,
            prompt: "after abandonment",
            attachments: [],
          })
        ).pipe(Effect.forkChild);

        yield* waitFor((m) => (m.hostResources?.waiting.size ?? 0) === 1);
        expect(harness.turns).toHaveLength(1);
        expect(held).toBe(0);
        yield* Scope.close(other, Exit.void);
        yield* Fiber.join(input);
        yield* waitUntil(() => harness.turns.length === 2);
        expect(harness.turns[1]!.prompt).toBe("after abandonment");
        expect(held).toBe(1);
        expect(failures).toBe(0);
        expect((yield* store.model).constellations.get(CID)!.graph.attempts[0]!.state).toBe(
          "working"
        );
        harness.emit(
          HarnessEvent.TurnEnded({
            turnId: harness.turns[1]!.turnId,
            status: "completed",
            error: null,
          })
        );
        yield* waitUntil(() => held === 0);
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
