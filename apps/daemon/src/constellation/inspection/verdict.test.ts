import { expect, test } from "bun:test";
import {
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  CommandId,
  type ConstellationCommand,
  DomainEvent,
  PlanOperation,
  ReviewAction,
  type SessionId,
  ToolCallReference,
  Turn,
  TurnId,
  TurnItem,
  WorkerPlacement,
} from "@polaris/protocol";
import { Deferred, Effect, Fiber, Layer, Predicate } from "effect";
import { A, AT, C, CID, HOST, LEAD, draft, report } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { finding, refusal } from "../decision.ts";
import { setup, world, WORKER } from "../delivery/testing.ts";
import { ConstellationRuntime, type ConstellationRuntimeService } from "../runtime.ts";
import { Constellations } from "../service.ts";

const ATTEMPT = AttemptId.make("a1");

const commandId = () => CommandId.make(crypto.randomUUID());

const RETRY = draft(A, "a2", WORKER, AttemptCause.cases.SentBack.make({ ref: ATTEMPT }));

/**
 * A runtime that records what it was asked to prepare and, as `merged`, each head an Accept's
 * preparation put on the lead branch; it refuses the merge on demand. `beforeSendBack` runs
 * inside a Lead SendBack's preparation, to hold it there.
 */
const recording = (conflict: boolean, beforeSendBack: Effect.Effect<void> = Effect.void) => {
  const prepared: Array<ConstellationCommand> = [];
  const merged: Array<string> = [];

  const answer = (sendBack: boolean) => ({
    attempts: [sendBack ? RETRY : draft()],
    newLeadSessionId: null,
    claimProbe: { dirtyPaths: [], branch: "polaris/A", head: "head" },
    recordedChecks: [],
  });

  const runtime: ConstellationRuntimeService = {
    prepare: (binding, command) => {
      prepared.push(command);

      if (!Predicate.isTagged(command, "Review")) return Effect.succeed(answer(false));

      if (Predicate.isTagged(command.action, "SendBack"))
        return Effect.as(
          binding.kind === "session" && binding.sessionId === LEAD ? beforeSendBack : Effect.void,
          answer(true)
        );

      if (!Predicate.isTagged(command.action, "Accept")) return Effect.succeed(answer(false));

      if (conflict)
        return Effect.fail(
          refusal(undefined, [
            finding("E-MERGE-CONFLICT", "The merge conflicts in a.ts", "Send it back."),
          ])
        );

      merged.push(command.action.mergedHead);

      return Effect.succeed(answer(false));
    },
    resumeWorking: () => Effect.void,
    afterCommit: () => Effect.void,
  };

  return { prepared, merged, layer: Layer.succeed(ConstellationRuntime)(runtime) };
};

const attempts = Effect.gen(function* () {
  const model = yield* (yield* EventStore).model;

  return model.constellations.get(CID)!.graph.attempts;
});

/** A Claim held by an Inspection on a marked Task, with or without the Accept grant. */
const held = Effect.fnUntraced(function* (accept: boolean, claim: Claim = report()) {
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
    C.WorkerClaim.make({ constellationId: CID, attemptId: ATTEMPT, claim })
  );

  return (yield* attempts)[0]!.inspection!;
});

const approve = (inspection: { readonly id: string; readonly sessionId: SessionId }) =>
  Effect.flatMap(Constellations, (graphs) =>
    graphs.command(
      { kind: "session", sessionId: inspection.sessionId },
      commandId(),
      C.Inspect.make({
        constellationId: CID,
        attemptId: ATTEMPT,
        inspectionId: inspection.id,
        verdict: "approve",
        reason: "Covers the criteria.",
      })
    )
  );

const CHECK = new ToolCallReference({
  hostId: HOST,
  sessionId: LEAD,
  turnId: TurnId.make("check"),
  itemId: "check",
});

const verifiedClaim = new Claim({
  branch: "polaris/A",
  head: "head",
  commits: ["head"],
  receipts: [CheckReceipt.cases.Verified.make({ label: "tests", item: CHECK })],
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "Implemented the task.",
});

/** The command the receipt names, as the Daemon recorded it in a Turn of this Host. */
const recordCheck = Effect.flatMap(EventStore, (store) =>
  store.commit({
    commandId: commandId(),
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.TurnStarted.make({
          turn: new Turn({
            id: CHECK.turnId,
            sessionId: LEAD,
            index: 0,
            prompt: "check",
            attachments: [],
            model: null,
            effort: null,
            status: "working",
            checkpointBefore: null,
            checkpointAfter: null,
            startedAt: AT,
            endedAt: null,
          }),
        }),
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: LEAD,
          turnId: CHECK.turnId,
          subagentId: null,
          item: TurnItem.cases.CommandExecution.make({
            id: CHECK.itemId,
            command: "bun test",
            cwd: "/tmp",
            output: "pass",
            exitCode: 0,
            status: "completed",
          }),
        }),
      ]),
  })
);

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

test("a granted approval of a Claim with a Verified receipt resolves it as a Lead Accept does, and accepts", async () => {
  const runtime = recording(false);
  const w = world(":memory:", { runtime: runtime.layer });

  const [attempt] = await w.run(
    Effect.gen(function* () {
      const inspection = yield* held(true, verifiedClaim);
      yield* recordCheck;
      yield* approve(inspection);

      return yield* attempts;
    })
  );

  expect(runtime.merged).toEqual(["head"]);
  expect(attempt).toMatchObject({ state: "accepted", evidence: "verified" });
});

test("a granted approval whose Verified receipt names no recorded command merges nothing and goes to the Lead", async () => {
  const runtime = recording(false);
  const w = world(":memory:", { runtime: runtime.layer });

  const [attempt] = await w.run(
    Effect.gen(function* () {
      yield* approve(yield* held(true, verifiedClaim));

      return yield* attempts;
    })
  );

  // The evidence is weighed before the merge: the lead branch is as it was.
  expect(runtime.merged).toEqual([]);
  expect(attempt).toMatchObject({
    state: "review",
    inspection: {
      state: "approved",
      mergeRefusal:
        "Receipt check is not a command execution the Harness recorded as completed with an exit code",
    },
  });
});

test("a Lead SendBack still preparing when a granted approval arrives is decided first: nothing is merged", async () => {
  const entered = Effect.runSync(Deferred.make<void>());
  const release = Effect.runSync(Deferred.make<void>());

  const runtime = recording(
    false,
    Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release))
  );

  const w = world(":memory:", { runtime: runtime.layer });

  const [first] = await w.run(
    Effect.gen(function* () {
      const inspection = yield* held(true);
      const reviewed = (yield* attempts)[0]!;

      const sendBack = yield* Effect.forkChild(
        (yield* Constellations).command(
          { kind: "session", sessionId: LEAD },
          commandId(),
          C.Review.make({
            constellationId: CID,
            attemptId: ATTEMPT,
            revision: reviewed.revision,
            action: ReviewAction.cases.SendBack.make({
              reason: "Not this way.",
              worker: WorkerPlacement.cases.Existing.make({ sessionId: WORKER }),
              mergeConflictBase: null,
            }),
          })
        )
      );

      yield* Deferred.await(entered);
      const verdict = yield* Effect.forkChild(Effect.flip(approve(inspection)));

      // Long enough for an unfenced verdict to reach its merge.
      yield* Effect.promise(() => Bun.sleep(50));
      expect(runtime.merged).toEqual([]);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(sendBack);
      const refused = yield* Fiber.join(verdict);

      expect(refused.findings.map((f) => f.code)).toEqual(["E-INSPECTION-STALE"]);

      return yield* attempts;
    })
  );

  expect(runtime.merged).toEqual([]);
  expect(first).toMatchObject({ state: "rejected", rejectedBy: "lead" });
});
