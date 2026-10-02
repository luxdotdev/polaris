import { join } from "node:path";
import {
  Constellation,
  ConstellationId,
  ConstellationSettings,
  DomainEvent,
  Task,
  TaskId,
  Attempt,
  AttemptId,
  AttemptCause,
} from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { loadHostInfo } from "../transport/hostInfo.ts";

/** Seed durable graphs while the setup Daemon is stopped, then measure the normal restart path. */
export const seedIdleConstellations = Effect.fnUntraced(function* (home: string) {
  const store = yield* EventStore;
  const model = yield* store.model;
  const { hostId } = yield* loadHostInfo(home);
  const now = new Date().toISOString();
  let count = 0;

  for (const workspace of model.workspaces.values()) {
    const sessions = [...model.sessions.values()].filter(
      (r) => r.session.workspaceId === workspace.id
    );

    const lead = sessions[0]?.session;
    const worker = sessions[1]?.session;

    if (lead === undefined || worker === undefined) continue;
    const id = ConstellationId.make(`idle-${workspace.id}`);

    const task = new Task({
      id: TaskId.make("A"),
      title: "Idle worker",
      kind: "task",
      brief: "Remain idle",
      revision: 0,
      canceled: false,
    });

    const graph = new Constellation({
      id,
      workspaceId: workspace.id,
      hostId,
      leadSessionId: lead.id,
      name: "Idle constellation",
      state: "planning",
      revision: 0,
      settings: new ConstellationSettings({}),
      tasks: [],
      attempts: [],
      pendingNotifications: [],
      createdAt: now,
      updatedAt: now,
    });

    const attempt = new Attempt({
      id: AttemptId.make(`${id}:a1`),
      taskId: task.id,
      revision: 0,
      cause: AttemptCause.cases.Initial.make({}),
      claimedAt: null,
      approvedByUserAt: null,
      handedUpAt: null,
      handedUpReason: null,
      nudgedAt: null,
      by: lead.id,
      sessionId: worker.id,
      hostId,
      worktree: worker.cwd,
      branch: "main",
      base: "idle-base",
      state: "working",
      startedAt: now,
    });

    yield* store.commit({
      commandId: null,
      decide: () =>
        Effect.succeed([
          DomainEvent.cases.ConstellationStarted.make({
            constellationId: id,
            revision: 0,
            constellation: graph,
          }),
          DomainEvent.cases.TaskDeclared.make({ constellationId: id, revision: 1, task }),
          DomainEvent.cases.ConstellationStateChanged.make({
            constellationId: id,
            revision: 2,
            state: "running",
          }),
          DomainEvent.cases.AttemptStarted.make({ constellationId: id, revision: 3, attempt }),
        ]),
    });
    count++;
  }

  return count;
});

export const seedIdleGraphs = (home: string) =>
  seedIdleConstellations(home).pipe(
    Effect.provide(EventStore.layerSqlite(join(home, "state.sqlite")))
  );

if (import.meta.main) {
  const home = process.argv[2];

  if (home === undefined) throw new Error("supply the benchmark temporary home");
  console.log(await Effect.runPromise(seedIdleGraphs(home)));
}
