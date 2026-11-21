import { expect, test } from "bun:test";
import {
  AttemptId,
  CommandId,
  isWorkerSession,
  PlanOperation,
  ReviewAction,
  type SessionId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { A, C, CID, LEAD, report } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationDelivery } from "../delivery/index.ts";
import { finish, send, setup, wait, world, WORKER } from "../delivery/testing.ts";
import { Constellations } from "../service.ts";

const ATTEMPT = AttemptId.make("a1");

const SECRET = "WORKER-TRANSCRIPT-ONLY-7731";

const commandId = () => CommandId.make(crypto.randomUUID());

const graph = Effect.gen(function* () {
  const model = yield* (yield* EventStore).model;

  return model.constellations.get(CID)!.graph;
});

const inspection = Effect.map(graph, (g) => g.attempts.find((a) => a.id === ATTEMPT)!.inspection!);

/** A dispatched Task marked for Inspection, its worker mid-Turn, and its Claim. */
const claimMarked = Effect.fnUntraced(function* (accept?: boolean) {
  const graphs = yield* Constellations;
  yield* setup();
  yield* graphs.command(
    { kind: "session", sessionId: LEAD },
    commandId(),
    C.Plan.make({
      constellationId: CID,
      operations: [
        PlanOperation.cases.Edit.make({
          taskId: A,
          revision: (yield* graph).tasks[0]!.revision,
          task: {
            inspect: accept === undefined ? {} : { accept },
            criteria: ["Retries are tested"],
          },
        }),
      ],
    })
  );
  yield* (yield* ConstellationDelivery).start();
  // What the worker said in its own Turn is in its transcript and nowhere else.
  yield* send(WORKER, SECRET);
  yield* finish(WORKER);
  yield* graphs.command(
    { kind: "session", sessionId: WORKER },
    commandId(),
    C.WorkerClaim.make({ constellationId: CID, attemptId: ATTEMPT, claim: report() })
  );
});

const verdict = Effect.fnUntraced(function* (
  sessionId: SessionId,
  inspectionId: string,
  kind: "approve" | "send_back" = "approve"
) {
  return yield* (yield* Constellations).command(
    { kind: "session", sessionId },
    commandId(),
    C.Inspect.make({
      constellationId: CID,
      attemptId: ATTEMPT,
      inspectionId,
      verdict: kind,
      reason: "Covers the criteria.",
    })
  );
});

test("a Claim on a marked Task starts an Inspector with the Claim, brief, Area and Logbook, and no Lead Turn", async () => {
  const w = world(":memory:", { inspections: true });
  await w.run(
    Effect.gen(function* () {
      yield* claimMarked();
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      const held = yield* inspection;
      const store = yield* EventStore;
      const session = (yield* store.model).sessions.get(held.sessionId)!.session;

      expect(w.turns[0]!.sessionId).toBe(held.sessionId);
      expect(isWorkerSession(session)).toBe(true);
      expect(session.worker).toEqual({ constellationId: CID, role: "inspector" });
      expect((yield* graph).attempts.map((a) => a.sessionId)).not.toContain(held.sessionId);

      const prompt = w.prompts[0]!;

      expect(prompt).toContain("Build A");
      expect(prompt).toContain("Retries are tested");
      expect(prompt).toContain("Branch polaris/A at head");
      expect(prompt).toContain("Implemented the task.");
      expect(prompt).toContain("git diff base...head");
      expect(prompt).toContain("Logbook, oldest first:");
      expect(prompt).toContain("worker · claim: Implemented the task.");
      expect(prompt).not.toContain(SECRET);

      // The Lead hears nothing while the Claim is held, however long the Inspector takes.
      yield* TestClock.adjust(60_000);
      yield* (yield* ConstellationDelivery).flush();
      expect(w.turns.map((t) => t.sessionId)).toEqual([held.sessionId]);
      expect((yield* graph).pendingNotifications).toEqual([]);
    })
  );
});

test("an approval reaches the Lead as the Claim with the verdict, and the Inspector's session is closed", async () => {
  const w = world(":memory:", { inspections: true });
  await w.run(
    Effect.gen(function* () {
      yield* claimMarked();
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      const held = yield* inspection;
      const result = yield* verdict(held.sessionId, held.id);

      expect(result.constellation).toBeNull();
      expect(result.summary).toBe("Verdict recorded.");

      yield* finish(held.sessionId);
      yield* wait(() => Effect.succeed(w.retired.includes(held.sessionId)));
      const store = yield* EventStore;

      expect((yield* store.model).sessions.get(held.sessionId)!.session.state).toBe("archived");

      yield* TestClock.adjust(2000);
      yield* wait(() => Effect.succeed(w.turns.length === 2));

      expect(w.turns[1]!.sessionId).toBe(LEAD);
      expect(w.prompts[1]).toContain(
        "A: review. Its inspector approved: Covers the criteria. You still accept it."
      );
    })
  );
});

test("an Inspector whose Turn ends without a verdict releases the Claim to the Lead", async () => {
  const w = world(":memory:", { inspections: true });
  await w.run(
    Effect.gen(function* () {
      yield* claimMarked();
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      const held = yield* inspection;
      yield* finish(held.sessionId);
      const store = yield* EventStore;
      yield* wait(() =>
        Effect.map(
          store.model,
          (m) => m.constellations.get(CID)!.graph.attempts[0]!.inspection?.state === "lost"
        )
      );
      yield* TestClock.adjust(2000);
      yield* wait(() => Effect.succeed(w.turns.length === 2));

      expect(w.prompts[1]).toContain(
        "A: review. Its inspector ended without a verdict (its Turn ended without a verdict); review the Claim yourself."
      );

      // The lost Inspector's late verdict is refused, with no graph in the refusal.
      const late = yield* Effect.flip(verdict(held.sessionId, held.id));

      expect(late.findings.map((f) => f.code)).toEqual(["E-INSPECTION-STALE"]);
      expect(late.graph).toBeNull();
    })
  );
});

test("a review by the Lead stops the Inspector, and only the Inspector may record a verdict", async () => {
  const w = world(":memory:", { inspections: true });
  await w.run(
    Effect.gen(function* () {
      yield* claimMarked();
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      const first = yield* inspection;
      const store = yield* EventStore;

      const stale = yield* Effect.flip(verdict(WORKER, first.id));

      expect(stale.findings.map((f) => f.code)).toEqual(["E-AUTHORITY"]);
      expect(stale.graph).toBeNull();

      const attempt = (yield* graph).attempts[0]!;
      yield* (yield* Constellations).command(
        { kind: "session", sessionId: LEAD },
        commandId(),
        C.Review.make({
          constellationId: CID,
          attemptId: ATTEMPT,
          revision: attempt.revision,
          action: ReviewAction.cases.HandUp.make({ reason: "The user decides this one." }),
        })
      );
      yield* wait(() =>
        Effect.map(
          store.model,
          (m) => m.sessions.get(first.sessionId)!.session.state === "archived"
        )
      );

      expect((yield* inspection).state).toBe("superseded");
      expect(w.turns.map((t) => t.sessionId)).toEqual([first.sessionId]);
    })
  );
});
