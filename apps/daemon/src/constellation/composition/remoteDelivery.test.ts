import { expect, test } from "bun:test";
import {
  Constellation,
  HostId,
  MessageTarget,
  RemoteWorkerAssignment,
  ReviewAction,
  SessionId,
  WorkerPlacement,
  type RemoteDeliveryPacket,
} from "@polaris/protocol";
import { Effect, Predicate, Struct } from "effect";
import {
  A,
  B,
  C,
  CID,
  HOST,
  apply,
  ctx,
  draft,
  planned,
  report,
  task,
} from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import type { ReadModel } from "../../store/model.ts";
import { decideConstellationJournal } from "../journal.ts";
import { pendingInputs } from "../delivery/messages.ts";
import { applyWorkerDelivery, DeliveryInput } from "../delivery/index.ts";
import { setup, WORKER, world, fakeWorkerAdmission } from "../delivery/testing.ts";
import { validateRemoteDelivery } from "./remoteDelivery.ts";

const owner = HostId.make("owner");

const blockedOwner = (cause: "Accepted" | "Lead") => {
  const base = planned([task(A), task(B)]);
  let record = { ...base, graph: new Constellation(Struct.assign(base.graph, { hostId: owner })) };
  const context = ctx({ hostId: owner });
  record = apply(
    record,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [{ taskId: A, worker: WorkerPlacement.cases.Existing.make({ sessionId: WORKER }) }],
    }),
    { ...context, attempts: [draft()] }
  );
  record = apply(
    record,
    C.WorkerBlock.make({
      constellationId: CID,
      attemptId: draft().id,
      on: cause === "Accepted" ? [B] : [],
      reason: "Waiting",
    }),
    { ...context, binding: { kind: "session", sessionId: WORKER } }
  );

  if (cause === "Lead")
    return apply(
      record,
      C.Message.make({
        constellationId: CID,
        target: MessageTarget.cases.Worker.make({ attemptId: draft().id }),
        text: "Continue A",
      }),
      context
    );
  const feed = draft(B, "feed", SessionId.make("feed"));
  const claim = report(feed.branch, "feed-head");
  record = apply(
    record,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [
        { taskId: B, worker: WorkerPlacement.cases.Existing.make({ sessionId: feed.sessionId }) },
      ],
    }),
    { ...context, attempts: [feed] }
  );
  record = apply(record, C.WorkerClaim.make({ constellationId: CID, attemptId: feed.id, claim }), {
    ...context,
    binding: { kind: "session", sessionId: feed.sessionId },
    claimProbe: { branch: feed.branch, head: claim.head, dirtyPaths: [] },
  });

  return apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: feed.id,
      revision: 1,
      action: ReviewAction.cases.Accept.make({ mergedHead: claim.head, receipts: [] }),
    }),
    context
  );
};

for (const cause of ["Accepted", "Lead"] as const) {
  test(`composed remote ${cause} unblock accepts the blocked mirror and retries one Turn`, async () => {
    const w = world();
    await w.run(
      Effect.gen(function* () {
        yield* setup();
        const store = yield* EventStore;
        yield* fakeWorkerAdmission(store, WORKER);
        const record = blockedOwner(cause);
        const input = pendingInputs(record).find((i) => i.sessionId === WORKER)!;

        const assignment = new RemoteWorkerAssignment({
          graph: record.graph,
          attemptId: draft().id,
          repoPath: "/tmp/remote",
        });

        const packet = {
          id: JSON.stringify([input.id, WORKER]),
          constellationId: CID,
          attemptId: draft().id,
          sessionId: WORKER,
          ownerHostId: owner,
          workerHostId: HOST,
          input: DeliveryInput.Turn({ cause: "unblock", text: input.text }),
        };

        const validate = (p: RemoteDeliveryPacket, model: ReadModel) =>
          validateRemoteDelivery(p, model, [assignment]);

        yield* applyWorkerDelivery(packet, validate);
        yield* applyWorkerDelivery(packet, validate);
        expect(w.turns).toHaveLength(1);
        expect(w.turns[0]!.prompt).toBe(input.text);

        const ack = {
          type: "inputDelivered" as const,
          id: input.id,
          sessionId: WORKER,
          turnEvents: [],
        };

        const decision = decideConstellationJournal(record, ack, ctx({ hostId: owner }));
        expect(decision.rejection).toBeNull();
        expect(
          decision.events.find((e) => Predicate.isTagged(e, "AttemptUnblocked"))
        ).toMatchObject({ cause });

        const denied = yield* validateRemoteDelivery(
          {
            ...packet,
            input: DeliveryInput.Turn({ cause: "message", text: "An earlier conversation" }),
          },
          yield* store.model,
          [assignment]
        ).pipe(Effect.flip);

        expect(denied.reason).toBe("The input is not for an active remote worker");
      })
    );
  });
}
