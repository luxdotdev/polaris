import { expect, test } from "bun:test";
import {
  Command,
  CommandId,
  CommandRejected,
  ConstellationSettings,
  PlanOperation,
  SessionId,
  SessionPlacement,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Scope } from "effect";
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
import { registerWorkerAdmission } from "./workerAdmission.ts";

const S = SessionId.make("failed-worker-input");

for (const mode of ["acquire", "start", "resume"] as const)
  test(`${mode} failure rejects later user SendTurn promptly with the durable assignment present`, async () => {
    const driver = makeFakeDriver("codex");
    let failures = 0;
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
            acquireWorker: () => (mode === "acquire" ? Effect.fail("acquire failed") : Effect.void),
            startWorker: () => Effect.fail("start failed"),
            resumeWorker: () => Effect.fail("resume failed"),
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
        yield* waitUntil(() => failures === 1);
        // Run twice after cleanup: neither later request can become a new registration wait.

        for (let i = 0; i < 2; i++) {
          const error = yield* dispatch(
            Command.cases.SendTurn.make({ sessionId: S, prompt: "retry", attachments: [] })
          ).pipe(Effect.flip, Effect.timeout(200));

          expect(error).toBeInstanceOf(CommandRejected);

          if (!(error instanceof CommandRejected)) throw error;
          expect(error.reason).toContain("admission closed");
        }

        expect(harness.turns).toHaveLength(1);
        expect((yield* store.model).constellations.get(CID)!.graph.attempts[0]!.state).toBe(
          "working"
        );

        yield* registerWorkerAdmission(
          store,
          S,
          yield* Scope.Scope,
          Effect.void,
          Effect.succeed(false)
        );
        yield* store.commit({
          commandId: CommandId.make(`${attempt.id}:start`),
          decide: () => Effect.succeed([]),
        });

        yield* dispatch(
          Command.cases.SendTurn.make({ sessionId: S, prompt: "replacement", attachments: [] })
        );
        yield* waitUntil(() => harness.turns.length === 2);
        expect(harness.turns[1]!.prompt).toBe("replacement");
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
