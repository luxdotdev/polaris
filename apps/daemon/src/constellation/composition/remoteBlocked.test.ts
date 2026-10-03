import { expect, test } from "bun:test";
import {
  CommandId,
  HostId,
  PlanOperation,
  RemoteWorkerAssignment,
  ReviewAction,
  WorkerPlacement,
  Attempt,
} from "@polaris/protocol";
import { Deferred, Effect, Predicate, Struct } from "effect";
import { A, B, C, CID, ctx, draft, report, task } from "../../engine/constellation.testing.ts";
import { decideConstellation } from "../../engine/constellation.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import {
  ConstellationDelivery,
  ConstellationSessionEffects,
  applyWorkerDelivery,
} from "../delivery/index.ts";
import { pendingInputs } from "../delivery/messages.ts";
import { finish, send, setup, STANDALONE, wait, WORKER, world } from "../delivery/testing.ts";
import { validateRemoteDelivery } from "./remoteDelivery.ts";
import { recordRemoteBlockTrace } from "./remoteBlocked.trace.testing.ts";

const acceptFeed = Effect.fnUntraced(function* () {
  const store = yield* EventStore;
  const feed = draft(B, "feed", STANDALONE);
  const claim = report(feed.branch, "feed-head");

  const commands = [
    {
      command: C.Dispatch.make({
        constellationId: CID,
        tasks: [
          { taskId: B, worker: WorkerPlacement.cases.Existing.make({ sessionId: STANDALONE }) },
        ],
      }),
      context: ctx({ attempts: [feed] }),
    },
    {
      command: C.WorkerClaim.make({ constellationId: CID, attemptId: feed.id, claim }),
      context: ctx({
        binding: { kind: "session", sessionId: STANDALONE },
        claimProbe: { branch: feed.branch, head: claim.head, dirtyPaths: [] },
      }),
    },
    {
      command: C.Review.make({
        constellationId: CID,
        attemptId: feed.id,
        revision: 1,
        action: ReviewAction.cases.Accept.make({ mergedHead: claim.head, receipts: [] }),
      }),
      context: ctx(),
    },
  ];

  for (const { command, context } of commands)
    yield* store.commit({
      commandId: CommandId.make(crypto.randomUUID()),
      decide: (model) => {
        const result = decideConstellation(model.constellations.get(CID), command, context);
        expect(result.rejection).toBeNull();

        return Effect.succeed(result.events);
      },
    });
});

test("remote worker TurnEnded retries an accepted block without another owner event, then acknowledges once", async () => {
  const worker = world();
  await worker.run(
    Effect.gen(function* () {
      yield* setup();
      yield* send(WORKER);
      const workerContext = yield* Effect.context<EventStore | ConstellationSessionEffects>();
      const arrived = yield* Deferred.make<void>();
      const settled = yield* Deferred.make<void>();
      const remoteId = HostId.make("remote-worker");
      let checks = 0;
      let ownerStore: EventStore["Service"] | undefined;

      const owner = world(":memory:", {
        attempt: new Attempt(Struct.assign(draft(), { hostId: remoteId })),
        remoteSend: (packet) =>
          Effect.gen(function* () {
            const store = ownerStore;

            if (store === undefined) throw new Error("owner not ready");
            yield* applyWorkerDelivery(packet, (p, model) =>
              Effect.gen(function* () {
                checks++;
                const graph = (yield* store.model).constellations.get(CID)!.graph;
                yield* validateRemoteDelivery(p, model, [
                  new RemoteWorkerAssignment({
                    graph,
                    attemptId: p.attemptId,
                    repoPath: "/tmp/fake-remote",
                  }),
                ]);
                yield* Deferred.succeed(arrived, undefined);
              })
            ).pipe(Effect.provide(workerContext));
            yield* Deferred.succeed(settled, undefined);
          }).pipe(Effect.orDie),
      });

      yield* Effect.promise(() =>
        owner.run(
          Effect.gen(function* () {
            yield* setup();
            const graphs = yield* Constellations;
            const store = yield* EventStore;
            ownerStore = store;
            const delivery = yield* ConstellationDelivery;
            yield* graphs.command(
              { kind: "user" },
              CommandId.make("add-feed"),
              C.Plan.make({
                constellationId: CID,
                operations: [PlanOperation.cases.Add.make({ task: task(B) })],
              })
            );
            yield* graphs.command(
              { kind: "session", sessionId: WORKER },
              CommandId.make("block"),
              C.WorkerBlock.make({
                constellationId: CID,
                attemptId: draft().id,
                on: [B],
                reason: "Waiting for feed",
              })
            );
            yield* delivery.start();
            yield* acceptFeed();
            yield* Deferred.await(arrived);
            const before = (yield* store.model).sequence;

            const input = pendingInputs((yield* store.model).constellations.get(CID)!).find(
              (i) => i.sessionId === WORKER
            )!;

            expect(worker.turns).toHaveLength(0);
            expect((yield* store.model).constellations.get(CID)!.graph.attempts[0]!.state).toBe(
              "blocked"
            );
            yield* finish(WORKER).pipe(Effect.provide(workerContext));
            yield* Deferred.await(settled);
            yield* wait(() =>
              Effect.map(
                store.model,
                (m) => m.constellations.get(CID)!.graph.attempts[0]!.state === "working"
              )
            );
            expect(checks).toBeGreaterThanOrEqual(2);
            expect(worker.turns).toHaveLength(1);
            expect(worker.turns[0]!.prompt).toContain("B accepted at feed-head");
            expect(worker.steers).toHaveLength(0);

            const events = yield* store.readConstellationEvents({
              constellationId: CID,
              after: before,
              upTo: (yield* store.model).sequence,
            });

            expect(events.map((e) => e.event._tag)).toEqual([
              "AttemptUnblocked",
              "WorkerInputDelivered",
            ]);
            expect(
              events.filter((e) => Predicate.isTagged(e.event, "AttemptUnblocked"))
            ).toHaveLength(1);
            yield* delivery.acknowledge(JSON.stringify([input.id, WORKER]), WORKER);
            yield* delivery.flush();
            expect(worker.turns).toHaveLength(1);
            expect(
              (yield* store.model).constellations
                .get(CID)!
                .graph.attempts.find((a) => a.taskId === A)!.blockedOn
            ).toEqual([]);
            const remoteStore = yield* EventStore.pipe(Effect.provide(workerContext));
            yield* recordRemoteBlockTrace(store, remoteStore, remoteId);
          })
        )
      );
    })
  );
});
