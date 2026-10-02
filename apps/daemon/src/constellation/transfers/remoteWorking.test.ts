import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import {
  ConstellationRelayReceipt,
  ConstellationResult,
  HostId,
  Task,
  Constellation,
  ConstellationSettings,
  RemoteWorkerAssignment,
  ConstellationOutboxEntry,
  ConstellationOutboxPacket,
  AgentSession,
  DomainEvent,
  Turn,
  TurnId,
} from "@polaris/protocol";
import { Context, Deferred, Effect, Layer, Semaphore } from "effect";
import {
  HOST,
  CID,
  LEAD,
  WS,
  AT,
  draft,
  task,
  C,
  report,
} from "../../engine/constellation.testing.ts";
import { removeDir } from "../../git/testing.ts";
import { HostResources } from "../../resources/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { McpTokens } from "../../mcp/index.ts";
import { ConstellationOwner } from "../runtime.ts";
import { TransferStorage } from "./storage.ts";
import { RemoteWorkers } from "./assignments.ts";
import { remoteWorkingAttemptsLayer } from "./remoteWorking.ts";

const graph = () =>
  new Constellation({
    id: CID,
    hostId: HostId.make("owner"),
    workspaceId: WS,
    leadSessionId: LEAD,
    name: "remote",
    state: "running",
    revision: 1,
    settings: ConstellationSettings.make({}),
    tasks: [
      Task.make({
        id: task().id,
        title: task().title,
        brief: task().brief,
        deps: [],
        kind: "task",
        revision: 0,
        canceled: false,
      }),
    ],
    attempts: [draft()],
    pendingNotifications: [],
    createdAt: AT,
    updatedAt: AT,
  });

test("a new remote Attempt starts its brief in an Existing Session with historical Turns, behind a scoped slot", async () => {
  const root = mkdtempSync("/tmp/c1wslots-");

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Semaphore.make(1);
          yield* gate.take(1);
          const started = yield* Deferred.make<void>();
          const resumed = yield* Deferred.make<void>();
          let holds = 0;
          let starts = 0;
          let resumes = 0;

          const resources = HostResources.of({
            get: Effect.die("unused"),
            declare: () => Effect.die("unused"),
            remove: () => Effect.die("unused"),
            release: () => Effect.die("unused"),
            setWorkerCap: () => Effect.die("unused"),
            acquire: () => Effect.die("unused"),
            acquireWorker: () =>
              Effect.acquireRelease(
                gate.take(1).pipe(Effect.tap(() => Effect.sync(() => holds++))),
                () => Effect.sync(() => holds--).pipe(Effect.andThen(gate.release(1)))
              ).pipe(Effect.asVoid),
          });

          const context = yield* Layer.build(
            Layer.mergeAll(
              EventStore.layerSqlite(":memory:"),
              TransferStorage.layer(":memory:"),
              McpTokens.layer(`${root}/tokens.sqlite`),
              Layer.succeed(HostResources)(resources),
              Layer.succeed(ConstellationOwner)(HOST)
            )
          );

          const workerContext = yield* Layer.build(
            remoteWorkingAttemptsLayer({
              prepare: () => Effect.die("unused"),
              start: () =>
                Effect.sync(() => {
                  expect(holds).toBe(1);
                  starts++;
                }).pipe(Effect.andThen(Deferred.succeed(started, undefined))),
              resume: () =>
                Effect.sync(() => {
                  expect(holds).toBe(1);
                  resumes++;
                }).pipe(Effect.andThen(Deferred.succeed(resumed, undefined))),
              failed: () => Effect.die("unexpected startup failure"),
            }).pipe(Layer.provide(Layer.succeedContext(context)))
          );

          const workers = Context.get(workerContext, RemoteWorkers);
          const storage = Context.get(context, TransferStorage);
          const store = Context.get(context, EventStore);
          const sessionId = draft().sessionId;

          const historical = Turn.make({
            id: TurnId.make("historical"),
            sessionId,
            index: 0,
            prompt: "Earlier work",
            attachments: [],
            model: null,
            effort: null,
            status: "working",
            checkpointBefore: null,
            checkpointAfter: null,
            startedAt: AT,
            endedAt: null,
          });

          yield* store.commit({
            commandId: null,
            decide: () =>
              Effect.succeed([
                DomainEvent.cases.SessionCreated.make({
                  session: AgentSession.make({
                    id: sessionId,
                    workspaceId: WS,
                    harness: "codex",
                    title: "Existing",
                    cwd: "/tmp/work",
                    worktreeId: null,
                    state: "idle",
                    permissionMode: "supervised",
                    model: null,
                    effort: null,
                    parentSessionId: null,
                    forkedFromTurnId: null,
                    harnessCursor: null,
                    turnCount: 0,
                    contextUsage: null,
                    lastError: null,
                    createdAt: AT,
                    updatedAt: AT,
                  }),
                }),
                DomainEvent.cases.TurnStarted.make({
                  turn: historical,
                }),
                DomainEvent.cases.TurnEnded.make({
                  turn: Turn.make({
                    id: historical.id,
                    sessionId,
                    index: 0,
                    prompt: historical.prompt,
                    attachments: [],
                    model: null,
                    effort: null,
                    status: "completed",
                    checkpointBefore: null,
                    checkpointAfter: null,
                    startedAt: AT,
                    endedAt: AT,
                  }),
                }),
              ]),
          });
          expect((yield* store.model).sessions.get(sessionId)?.session.turnCount).toBe(1);

          const assignment = RemoteWorkerAssignment.make({
            graph: graph(),
            attemptId: draft().id,
            repoPath: "/tmp/work",
          });

          yield* storage.assign(assignment);
          yield* workers.assigned(assignment);
          expect(starts).toBe(0);
          yield* gate.release(1);
          yield* Deferred.await(started);
          expect(starts).toBe(1);
          yield* workers.claimed(draft().id);
          expect(holds).toBe(0);
          yield* workers.assigned(assignment);
          yield* Deferred.await(resumed);
          expect(resumes).toBe(1);

          const packet = ConstellationOutboxPacket.make({
            entry: ConstellationOutboxEntry.make({
              id: "claim",
              ownerHostId: assignment.graph.hostId,
              workerHostId: HOST,
              constellationId: CID,
              sessionId: draft().sessionId,
              attemptId: draft().id,
              command: C.WorkerClaim.make({
                constellationId: CID,
                attemptId: draft().id,
                claim: report(),
              }),
            }),
            claimProbe: null,
            recordedChecks: [],
          });

          yield* storage.enqueue(packet);
          yield* storage.ack(
            ConstellationRelayReceipt.cases.Applied.make({
              id: packet.entry.id,
              result: ConstellationResult.make({
                summary: "queued",
                next: "review",
                revision: 1,
                sequence: null,
              }),
            })
          );
          expect(yield* storage.packets).toEqual([]);
          yield* workers.claimed(draft().id);
          yield* workers.assigned(assignment);
          expect(holds).toBe(0);
          expect(starts).toBe(1);
          expect(resumes).toBe(1);
        })
      ).pipe(Effect.timeout("3 seconds"))
    );
  } finally {
    removeDir(root);
  }
});
