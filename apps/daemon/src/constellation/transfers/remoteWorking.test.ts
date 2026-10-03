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
  Attempt,
  RemoteDeliveryPacket,
  RemoteDeliveryInput,
} from "@polaris/protocol";
import { Context, Deferred, Effect, Layer, Semaphore, Struct, Fiber, Predicate } from "effect";
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
import { McpBinding } from "../../mcp/binding.ts";
import { ConstellationOwner } from "../runtime.ts";
import { TransferStorage } from "./storage.ts";
import { RemoteAssignments, RemoteWorkers } from "./assignments.ts";
import { ConstellationWorktrees } from "../worktrees.ts";
import { applyWorkerDelivery, ConstellationSessionEffects } from "../delivery/index.ts";
import { validateRemoteDelivery } from "../composition/remoteDelivery.ts";
import { finish, wait, session } from "../delivery/testing.ts";
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
          let acquisitions = 0;
          let deliveries = 0;

          const resources = HostResources.of({
            get: Effect.die("unused"),
            declare: () => Effect.die("unused"),
            remove: () => Effect.die("unused"),
            release: () => Effect.die("unused"),
            setWorkerCap: () => Effect.die("unused"),
            acquire: () => Effect.die("unused"),
            acquireWorker: () =>
              Effect.sync(() => acquisitions++)
                .pipe(
                  Effect.andThen(
                    Effect.acquireRelease(
                      gate.take(1).pipe(Effect.tap(() => Effect.sync(() => holds++))),
                      () => Effect.sync(() => holds--).pipe(Effect.andThen(gate.release(1)))
                    )
                  )
                )
                .pipe(Effect.asVoid),
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
                  expect(holds).toBe(0);
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
          const tokens = Context.get(context, McpTokens);

          const binding = McpBinding.cases.Worker.make({
            sessionId,
            constellationId: CID,
            attemptId: draft().id,
          });

          const token = yield* tokens.issue(binding);

          const blockedAssignment = RemoteWorkerAssignment.make(
            Struct.assign(assignment, {
              graph: new Constellation(
                Struct.assign(assignment.graph, {
                  attempts: [
                    new Attempt(
                      Struct.assign(assignment.graph.attempts[0]!, {
                        state: "blocked" as const,
                        blockedOn: [],
                        blockedReason: "Waiting for the Lead",
                        blockedAt: AT,
                      })
                    ),
                  ],
                })
              ),
            })
          );

          yield* storage.assign(blockedAssignment);
          yield* workers.assigned(blockedAssignment);
          expect(holds).toBe(0);
          expect(starts).toBe(1);
          expect(yield* tokens.authenticate(token)).toEqual(binding);
          yield* gate.take(1);

          const packet = RemoteDeliveryPacket.make({
            id: "unblock-packet",
            ownerHostId: assignment.graph.hostId,
            workerHostId: HOST,
            constellationId: CID,
            attemptId: draft().id,
            sessionId,
            input: RemoteDeliveryInput.cases.Turn.make({
              text: "Resume blocked worker",
              cause: "unblock",
            }),
          });

          const effects = ConstellationSessionEffects.of({
            runTurn: () =>
              Effect.sync(() => {
                expect(holds).toBe(1);
                deliveries++;
              }),
            canSteer: () => Effect.succeed(true),
            steer: () => Effect.void,
            retire: () => Effect.void,
            interrupt: () => Effect.void,
          });

          const apply = applyWorkerDelivery(packet, (p, model) =>
            Effect.flatMap(storage.assignments.pipe(Effect.orDie), (a) =>
              validateRemoteDelivery(p, model, a)
            )
          ).pipe(
            Effect.provideService(EventStore, store),
            Effect.provideService(ConstellationSessionEffects, effects)
          );

          const delivery = yield* apply.pipe(Effect.forkScoped);
          yield* wait(() => Effect.succeed(acquisitions === 2));
          expect(deliveries).toBe(0);
          expect((yield* store.model).sessions.get(sessionId)!.turns).toHaveLength(1);
          yield* gate.release(1);
          yield* Fiber.join(delivery);
          yield* apply;
          expect(deliveries).toBe(1);
          expect(acquisitions).toBe(2);
          expect(yield* tokens.authenticate(token)).toEqual(binding);
          yield* finish(sessionId).pipe(Effect.provideService(EventStore, store));
          yield* wait(() => Effect.succeed(holds === 0));
          yield* gate.take(1);
          yield* apply;
          expect(acquisitions).toBe(2);
          expect(deliveries).toBe(1);
          yield* gate.release(1);

          const turns = yield* store.readEvents({
            after: 0,
            upTo: (yield* store.model).sequence,
            sessionId,
          });

          expect(
            turns.filter(
              (e) => Predicate.isTagged(e.event, "TurnStarted") && e.event.turn.id === packet.id
            )
          ).toHaveLength(1);
          yield* workers.claimed(draft().id);
          expect(holds).toBe(0);
          yield* workers.resume(blockedAssignment);
          yield* Deferred.await(resumed);
          expect(resumes).toBe(1);
          yield* storage.assign(assignment);

          const claimPacket = ConstellationOutboxPacket.make({
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

          yield* storage.enqueue(claimPacket);
          yield* storage.ack(
            ConstellationRelayReceipt.cases.Applied.make({
              id: claimPacket.entry.id,
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

test("Host restart restores persisted blocked assignments without starting a first Turn", async () => {
  const root = mkdtempSync("/tmp/blocked-assignment-");
  const file = `${root}/transfers.sqlite`;

  const assignment = new RemoteWorkerAssignment({
    graph: new Constellation(
      Struct.assign(graph(), {
        attempts: [new Attempt(Struct.assign(draft(), { state: "blocked" as const }))],
      })
    ),
    attemptId: draft().id,
    repoPath: root,
  });

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* (yield* TransferStorage).assign(assignment);
        })
      ).pipe(Effect.provide(TransferStorage.layer(file)))
    );
    let resumes = 0;

    const base = Layer.mergeAll(
      EventStore.layerSqlite(":memory:"),
      TransferStorage.layer(file),
      Layer.succeed(ConstellationOwner)(HOST),
      Layer.succeed(RemoteWorkers)({
        prepare: () => Effect.die("unexpected prepare"),
        assigned: () => Effect.die("unexpected first Turn"),
        claimed: () => Effect.void,
        resume: (restored) =>
          Effect.sync(() => {
            expect(restored).toEqual(assignment);
            resumes++;
          }),
      })
    );

    const dependencies = ConstellationWorktrees.layer.pipe(Layer.provideMerge(base));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* (yield* RemoteAssignments).resumeWorking();
          expect(resumes).toBe(1);
        })
      ).pipe(Effect.provide(RemoteAssignments.layer.pipe(Layer.provide(dependencies))))
    );
  } finally {
    removeDir(root);
  }
});

test("remote restart restores blocked binding without a slot and reacquires on unblock packet", async () => {
  const root = mkdtempSync("/tmp/remote-blocked-admission-");

  const assignment = RemoteWorkerAssignment.make({
    graph: Constellation.make(
      Struct.assign(graph(), {
        attempts: [Attempt.make(Struct.assign(draft(), { state: "blocked" as const }))],
      })
    ),
    attemptId: draft().id,
    repoPath: root,
  });

  const binding = McpBinding.cases.Worker.make({
    sessionId: draft().sessionId,
    constellationId: CID,
    attemptId: draft().id,
  });

  const durable = () =>
    Layer.mergeAll(
      EventStore.layerSqlite(`${root}/store.sqlite`),
      TransferStorage.layer(`${root}/transfers.sqlite`),
      McpTokens.layer(`${root}/tokens.sqlite`),
      Layer.succeed(ConstellationOwner)(HOST)
    );

  let token = "";
  let held = 0;
  let resumes = 0;
  let runs = 0;

  const resources = HostResources.of({
    get: Effect.die("unused"),
    declare: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    release: () => Effect.die("unused"),
    setWorkerCap: () => Effect.die("unused"),
    acquire: () => Effect.die("unused"),
    acquireWorker: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          held++;
        }),
        () =>
          Effect.sync(() => {
            held--;
          })
      ),
  });

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* (yield* TransferStorage).assign(assignment);
          const store = yield* EventStore;
          yield* store.commit({
            commandId: null,
            decide: () =>
              Effect.succeed([
                DomainEvent.cases.SessionCreated.make({ session: session(draft().sessionId) }),
              ]),
          });
          token = yield* (yield* McpTokens).issue(binding);
        })
      ).pipe(Effect.provide(durable()))
    );
    const base = durable().pipe(Layer.provideMerge(Layer.succeed(HostResources)(resources)));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const workers = yield* RemoteWorkers;
          const store = yield* EventStore;
          const storage = yield* TransferStorage;
          yield* workers.resume((yield* storage.assignments)[0]!);
          yield* wait(() => Effect.succeed(resumes === 1));
          expect(held).toBe(0);
          expect(yield* (yield* McpTokens).authenticate(token)).toEqual(binding);

          const packet = RemoteDeliveryPacket.make({
            id: "restart-unblock",
            ownerHostId: assignment.graph.hostId,
            workerHostId: HOST,
            constellationId: CID,
            attemptId: draft().id,
            sessionId: draft().sessionId,
            input: RemoteDeliveryInput.cases.Turn.make({ text: "Continue", cause: "unblock" }),
          });

          const apply = applyWorkerDelivery(packet, (p, model) =>
            Effect.flatMap(storage.assignments.pipe(Effect.orDie), (a) =>
              validateRemoteDelivery(p, model, a)
            )
          );

          yield* apply;
          yield* apply;
          expect(runs).toBe(1);
          expect(held).toBe(1);
          expect(yield* (yield* McpTokens).authenticate(token)).toEqual(binding);
          expect((yield* store.model).sessions.get(draft().sessionId)!.turns).toHaveLength(1);
        })
      ).pipe(
        Effect.provide(
          remoteWorkingAttemptsLayer({
            prepare: () => Effect.die("unused"),
            start: () => Effect.die("A blocked restart cannot start a first Turn"),
            resume: () =>
              Effect.sync(() => {
                expect(held).toBe(0);
                resumes++;
              }),
            failed: () => Effect.die("Unexpected failure"),
          }).pipe(Layer.provideMerge(base))
        ),
        Effect.provide(
          Layer.succeed(ConstellationSessionEffects)({
            runTurn: () =>
              Effect.sync(() => {
                expect(held).toBe(1);
                runs++;
              }),
            canSteer: () => Effect.succeed(true),
            steer: () => Effect.void,
            retire: () => Effect.void,
            interrupt: () => Effect.void,
          })
        )
      )
    );
    expect(held).toBe(0);
  } finally {
    removeDir(root);
  }
});
