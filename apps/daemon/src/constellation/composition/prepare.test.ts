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
          WorktreeSetupService.layer.pipe(Layer.provideMerge(EventStore.layerSqlite(":memory:")))
        )
      )
    )
  );
});
