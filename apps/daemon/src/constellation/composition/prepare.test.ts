import { expect, test } from "bun:test";
import {
  CommandId,
  DomainEvent,
  PreparedWorktree,
  SessionId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect, Layer, Result } from "effect";
import { HOST, LEAD, planned } from "../../engine/constellation.testing.ts";
import { decideSession } from "../../engine/session.ts";
import { makeFakeDriver } from "../../engine/testing.ts";
import { HarnessError } from "../../harness/HarnessDriver.ts";
import { HarnessRegistry } from "../../services.ts";
import { EventStore } from "../../store/EventStore.ts";
import { patchSession } from "../../store/model.ts";
import { session } from "../delivery/testing.ts";
import { WorktreeSetupService } from "../setup/index.ts";
import { prepareSession } from "./prepare.ts";
import { trustedSetup } from "../setup/trust.testing.ts";

test("unsupported inherited auto permissions refuse dispatch before Session registration or Attempt creation", async () => {
  let checked = 0;

  const driver = {
    ...makeFakeDriver("claude").driver,
    validatePermissionMode: (requested: { permissionMode: string; model: string | null }) => {
      checked++;
      expect(requested.permissionMode).toBe("auto");
      expect(requested.model).toBe("haiku");

      return Effect.fail(
        new HarnessError({
          harness: "claude",
          message: "Claude model haiku does not support the auto permission mode.",
        })
      );
    },
  };

  const registry = Layer.succeed(HarnessRegistry)({
    get: () => Effect.succeed(driver),
    all: Effect.succeed([driver]),
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* EventStore;
      const graph = planned().graph;

      const lead = patchSession(session(LEAD), {
        harness: "claude",
        model: "sonnet",
        permissionMode: "auto",
      });

      yield* store.commit({
        commandId: CommandId.make("seed"),
        decide: () =>
          Effect.succeed([
            ...decideSession(undefined, { type: "session.fork", session: lead }).events,
            DomainEvent.cases.ConstellationStarted.make({
              constellationId: graph.id,
              revision: graph.revision,
              constellation: graph,
            }),
          ]),
      });

      const result = yield* Effect.result(
        prepareSession(
          {
            key: "dispatch:T4",
            graph,
            task: graph.tasks[0]!,
            previous: null,
            placement: WorkerPlacement.cases.New.make({
              hostId: HOST,
              selection: { harness: "claude", model: "haiku" },
            }),
            worktree: new PreparedWorktree({
              repoPath: "/tmp/repo",
              worktree: "/tmp/repo.worker",
              branch: "worker",
              base: "base",
              managed: true,
              managedBranch: true,
            }),
          },
          HOST
        )
      );

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.findings[0]?.code).toBe("E-HARNESS-PERMISSIONS");
        expect(result.failure.findings[0]?.message).toContain("haiku does not support");
        expect(result.failure.findings[0]?.fix).toContain("Choose a model");
      }

      const model = yield* store.model;
      expect(model.sessions.has(SessionId.make("dispatch:T4:worker"))).toBe(false);
      expect(model.constellations.get(graph.id)?.graph.attempts).toEqual([]);
      expect(checked).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          registry,
          WorktreeSetupService.layer.pipe(
            Layer.provide(trustedSetup),
            Layer.provideMerge(EventStore.layerSqlite(":memory:"))
          )
        )
      )
    )
  );
});

const ceilingCase = (input: {
  readonly lead: "supervised" | "auto-edits" | "auto" | "full-access" | null;
  readonly worker: "supervised" | "auto-edits" | "auto" | "full-access";
  readonly remoteCeiling?: "supervised" | "auto-edits" | "auto" | "full-access";
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* EventStore;
      const graph = planned().graph;

      const worker = patchSession(session(SessionId.make("reused")), {
        permissionMode: input.worker,
      });

      yield* store.commit({
        commandId: CommandId.make("seed"),
        decide: () =>
          Effect.succeed([
            ...(input.lead === null
              ? []
              : decideSession(undefined, {
                  type: "session.fork",
                  session: patchSession(session(LEAD), { permissionMode: input.lead }),
                }).events),
            ...decideSession(undefined, { type: "session.fork", session: worker }).events,
            DomainEvent.cases.ConstellationStarted.make({
              constellationId: graph.id,
              revision: graph.revision,
              constellation: graph,
            }),
          ]),
      });

      const result = yield* Effect.result(
        prepareSession(
          {
            key: "dispatch:reuse",
            graph,
            task: graph.tasks[0]!,
            previous: null,
            placement: WorkerPlacement.cases.Existing.make({ sessionId: worker.id }),
            leadPermissionMode: input.remoteCeiling ?? null,
            worktree: new PreparedWorktree({
              repoPath: "/tmp",
              worktree: "/tmp",
              branch: "worker",
              base: "base",
              managed: false,
              managedBranch: false,
            }),
          },
          HOST
        )
      );

      return Result.isFailure(result) ? result.failure.findings.map((f) => f.code) : [];
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HarnessRegistry)({
            get: () => Effect.succeed(makeFakeDriver("codex").driver),
            all: Effect.succeed([makeFakeDriver("codex").driver]),
          }),
          WorktreeSetupService.layer.pipe(
            Layer.provide(trustedSetup),
            Layer.provideMerge(EventStore.layerSqlite(":memory:"))
          )
        )
      )
    )
  );

test("a reused worker Session may not run broader than the Lead; equal or narrower passes", async () => {
  expect(await ceilingCase({ lead: "supervised", worker: "full-access" })).toContain(
    "E-PERMISSION-CEILING"
  );
  expect(await ceilingCase({ lead: "auto", worker: "auto-edits" })).not.toContain(
    "E-PERMISSION-CEILING"
  );
  expect(await ceilingCase({ lead: "auto-edits", worker: "auto-edits" })).not.toContain(
    "E-PERMISSION-CEILING"
  );
  // On a worker Host the Lead's Session is absent; the owner sends its mode with the request.
  expect(await ceilingCase({ lead: null, worker: "auto", remoteCeiling: "auto-edits" })).toContain(
    "E-PERMISSION-CEILING"
  );
});
