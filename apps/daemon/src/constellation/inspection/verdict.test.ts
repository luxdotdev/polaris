import { expect, test } from "bun:test";
import {
  AttemptCause,
  AttemptId,
  CommandId,
  type ConstellationCommand,
  PlanOperation,
} from "@polaris/protocol";
import { Effect, Layer, Predicate } from "effect";
import { A, C, CID, LEAD, draft, report } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { finding, refusal } from "../decision.ts";
import { setup, world, WORKER } from "../delivery/testing.ts";
import { ConstellationRuntime, type ConstellationRuntimeService } from "../runtime.ts";
import { Constellations } from "../service.ts";

const ATTEMPT = AttemptId.make("a1");

const commandId = () => CommandId.make(crypto.randomUUID());

const RETRY = draft(A, "a2", WORKER, AttemptCause.cases.SentBack.make({ ref: ATTEMPT }));

/** A runtime that records what it was asked to prepare, and refuses an Accept's merge on demand. */
const recording = (conflict: boolean) => {
  const prepared: Array<ConstellationCommand> = [];

  const runtime: ConstellationRuntimeService = {
    prepare: (_binding, command) => {
      prepared.push(command);

      const sendBack =
        Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "SendBack");

      const accept =
        Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "Accept");

      return accept && conflict
        ? Effect.fail(
            refusal(undefined, [
              finding("E-MERGE-CONFLICT", "The merge conflicts in a.ts", "Send it back."),
            ])
          )
        : Effect.succeed({
            attempts: [sendBack ? RETRY : draft()],
            newLeadSessionId: null,
            claimProbe: { dirtyPaths: [], branch: "polaris/A", head: "head" },
            recordedChecks: [],
          });
    },
    resumeWorking: () => Effect.void,
    afterCommit: () => Effect.void,
  };

  return { prepared, layer: Layer.succeed(ConstellationRuntime)(runtime) };
};

const attempts = Effect.gen(function* () {
  const model = yield* (yield* EventStore).model;

  return model.constellations.get(CID)!.graph.attempts;
});

/** A Claim held by an Inspection on a marked Task, with or without the Accept grant. */
const held = Effect.fnUntraced(function* (accept: boolean) {
  const graphs = yield* Constellations;
  yield* setup();
  yield* graphs.command(
    { kind: "session", sessionId: LEAD },
    commandId(),
    C.Plan.make({
      constellationId: CID,
      operations: [
        PlanOperation.cases.Edit.make({ taskId: A, revision: 0, task: { inspect: { accept } } }),
      ],
    })
  );
  yield* graphs.command(
    { kind: "session", sessionId: WORKER },
    commandId(),
    C.WorkerClaim.make({ constellationId: CID, attemptId: ATTEMPT, claim: report() })
  );

  return (yield* attempts)[0]!.inspection!;
});

const verdict = Effect.fnUntraced(function* (kind: "approve" | "send_back", accept: boolean) {
  const inspection = yield* held(accept);

  yield* (yield* Constellations).command(
    { kind: "session", sessionId: inspection.sessionId },
    commandId(),
    C.Inspect.make({
      constellationId: CID,
      attemptId: ATTEMPT,
      inspectionId: inspection.id,
      verdict: kind,
      reason: "The retry is untested.",
    })
  );

  return yield* attempts;
});

const reviews = (prepared: ReadonlyArray<ConstellationCommand>) =>
  prepared.flatMap((c) => (Predicate.isTagged(c, "Review") ? [c.action] : []));

test("a send-back prepares the worker's own session as a Lead SendBack would, and starts the next Attempt on it", async () => {
  const runtime = recording(false);
  const w = world(":memory:", { runtime: runtime.layer });
  const [first, second] = await w.run(verdict("send_back", false));

  expect(reviews(runtime.prepared)).toMatchObject([
    { reason: "The retry is untested.", worker: { sessionId: WORKER }, mergeConflictBase: null },
  ]);
  expect(first).toMatchObject({ state: "rejected", rejectedBy: "inspector" });
  expect(second).toMatchObject({ id: RETRY.id, state: "working", sessionId: WORKER });
});

test("an approval under the grant merges the claimed head through Accept's own path, then accepts", async () => {
  const runtime = recording(false);
  const w = world(":memory:", { runtime: runtime.layer });
  const [attempt] = await w.run(verdict("approve", true));

  expect(reviews(runtime.prepared)).toMatchObject([{ mergedHead: "head", receipts: [] }]);
  expect(attempt).toMatchObject({ state: "accepted", mergedHead: "head" });
});

test("a granted approval whose merge is refused stays in review for the Lead, with the refusal", async () => {
  const runtime = recording(true);
  const w = world(":memory:", { runtime: runtime.layer });
  const [attempt] = await w.run(verdict("approve", true));

  expect(attempt).toMatchObject({
    state: "review",
    inspection: { state: "approved", mergeRefusal: "The merge conflicts in a.ts" },
  });
});

test("an approval without the grant merges nothing", async () => {
  const runtime = recording(false);
  const w = world(":memory:", { runtime: runtime.layer });
  const [attempt] = await w.run(verdict("approve", false));

  expect(reviews(runtime.prepared)).toEqual([]);
  expect(attempt).toMatchObject({ state: "review", inspection: { state: "approved" } });
});
