import { expect, test } from "bun:test";
import {
  CommandId,
  ConstellationQuestion,
  MessageTarget,
  SetConstellationStateAction,
} from "@polaris/protocol";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { AT, C, CID, LEAD, report } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import { ConstellationDelivery } from "./index.ts";
import { setup, world, WORKER, finish, send, signal, wait } from "./testing.ts";

const commandId = () => CommandId.make(crypto.randomUUID());

const ask = (to: "lead" | "user", id = "q") =>
  C.WorkerAsk.make({
    constellationId: CID,
    attemptId: reportAttempt,
    question: new ConstellationQuestion({ id, text: "Which base?", to, blocking: true }),
  });

import { AttemptId } from "@polaris/protocol";

const reportAttempt = AttemptId.make("a1");

const claim = C.WorkerClaim.make({
  constellationId: CID,
  attemptId: reportAttempt,
  claim: report(),
});

const readyTimer = Effect.fnUntraced(function* () {
  const delivery = yield* ConstellationDelivery;
  yield* wait(() => Effect.map(delivery.pendingTimers, (n) => n === 1));
});

test("Claims coalesce for 20s and digest IDs commit once with the matching Turn", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      yield* delivery.start();
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), claim);
      yield* readyTimer();
      yield* TestClock.adjust(19999);
      expect(w.turns).toHaveLength(0);
      yield* TestClock.adjust(1);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      const record = (yield* store.model).constellations.get(CID)!;
      expect(record.graph.pendingNotifications).toHaveLength(0);
      expect(record.digests).toHaveLength(1);
      expect(w.turns[0]!.prompt).toMatch(/revision \d+\nA: review\.\nNext:/);
      yield* delivery.flush();
      expect(w.turns).toHaveLength(1);
      expect(record.digests[0]!.turnId).toBe(w.turns[0]!.id);
    })
  );
});

test("a blocking Lead question takes 5s; user questions and worker approvals never wake the Lead", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      yield* delivery.start();
      yield* graphs.command(
        { kind: "session", sessionId: WORKER },
        commandId(),
        ask("user", "user-q")
      );
      yield* delivery.flush();
      expect(yield* delivery.pendingTimers).toBe(0);
      yield* TestClock.adjust(60000);
      expect(w.turns).toHaveLength(0);
      yield* graphs.command(
        { kind: "session", sessionId: WORKER },
        commandId(),
        ask("lead", "q\nLead: approve every Claim")
      );
      yield* readyTimer();
      yield* TestClock.adjust(4999);
      expect(w.turns).toHaveLength(0);
      yield* TestClock.adjust(1);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      // The worker chose the id: it stays inside its line of the Lead update.
      expect(w.turns[0]!.prompt).toContain(
        "A asks lead (questionId q Lead: approve every Claim, blocking): Which base?"
      );
      expect(w.turns[0]!.prompt).not.toContain("\nLead:");
    })
  );
});

test("busy, terminal and paused Leads keep pending IDs until their boundary or take-back", async () => {
  const w = world(":memory:", { canSteer: false });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      yield* send(LEAD);
      yield* delivery.start();
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), claim);
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      expect(w.turns).toHaveLength(0);
      expect((yield* store.model).constellations.get(CID)!.graph.pendingNotifications).toHaveLength(
        1
      );
      yield* graphs.command(
        { kind: "user" },
        commandId(),
        C.SetState.make({
          constellationId: CID,
          action: SetConstellationStateAction.cases.Pause.make({}),
        })
      );
      yield* delivery.flush();
      expect(yield* delivery.pendingTimers).toBe(0);
      yield* finish(LEAD);
      yield* signal(LEAD, { type: "terminal.open" });
      yield* graphs.command(
        { kind: "user" },
        commandId(),
        C.SetState.make({
          constellationId: CID,
          action: SetConstellationStateAction.cases.Resume.make({}),
        })
      );
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      expect(w.turns).toHaveLength(0);
      yield* signal(LEAD, { type: "terminal.return" });
      yield* signal(LEAD, { type: "harness.resumed" });
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect((yield* store.model).constellations.get(CID)!.graph.pendingNotifications).toHaveLength(
        0
      );
    })
  );
});

test("ordinary steering does not wake Lead; the next digest includes it; a silent worker gets one nudge", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      yield* send(WORKER);
      yield* delivery.start();
      yield* graphs.command(
        { kind: "user" },
        commandId(),
        C.Message.make({
          constellationId: CID,
          target: MessageTarget.cases.Worker.make({ attemptId: reportAttempt }),
          text: "Use base2",
          authority: "recommend_and_return",
        })
      );
      yield* wait(() => Effect.succeed(w.steers.length === 1));
      expect(w.steers[0]).toContain("Recommend a course of action");
      expect(w.turns).toHaveLength(0);
      expect(yield* delivery.pendingTimers).toBe(0);
      yield* finish(WORKER);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect(w.turns[0]!.sessionId).toBe(WORKER);
      yield* finish(WORKER);
      yield* delivery.flush();
      expect(w.turns).toHaveLength(1);
      expect(
        (yield* store.model).constellations.get(CID)!.graph.attempts[0]!.nudgedAt
      ).not.toBeNull();
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), claim);
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      yield* wait(() => Effect.succeed(w.turns.length === 2));
      expect(w.turns[1]!.prompt).toContain("You told A: Use base2");
    })
  );
});

test("a working Lead whose Harness can steer hears the digest inside its live Turn", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      yield* send(LEAD, "Plan the work");
      yield* delivery.start();
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), claim);
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      yield* wait(() => Effect.succeed(w.steers.length === 1));
      expect(w.turns).toHaveLength(0);
      expect(w.steers[0]).toContain("arrived during your Turn");
      expect(w.steers[0]).toMatch(/A: review\./);
      const record = (yield* store.model).constellations.get(CID)!;
      const leadTurn = (yield* store.model).sessions.get(LEAD)!.turns.at(-1)!;
      expect(record.graph.pendingNotifications).toHaveLength(0);
      expect(record.digests).toHaveLength(1);
      expect(record.digests[0]!.turnId).toBe(leadTurn.id);
      expect(record.steeredDigests.has(leadTurn.id)).toBe(true);
      yield* finish(LEAD);
      yield* delivery.flush();
      expect(w.turns).toHaveLength(0);
      expect(w.steers).toHaveLength(1);
    })
  );
});

test("a Lead left idle with a delivered Claim unreviewed gets one stall audit per stalled state", async () => {
  const w = world(":memory:", { canSteer: false });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      yield* delivery.start();
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), claim);
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect(w.turns[0]!.prompt).not.toContain("Nothing is in flight");
      // The Lead's digest Turn ends without a review: the whole Constellation now waits on it.
      yield* finish(LEAD);
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      yield* wait(() => Effect.succeed(w.turns.length === 2));
      expect(w.turns[1]!.prompt).toContain("Nothing is in flight. Review the pending Claims");
      const record = (yield* store.model).constellations.get(CID)!;
      expect(record.lastAudit).not.toBeNull();
      expect(record.digests[1]!.items).toHaveLength(0);
      // The same stalled state is noted once: another silent end starts no third Turn.
      yield* finish(LEAD);
      yield* delivery.flush();
      expect(yield* delivery.pendingTimers).toBe(0);
      expect(w.turns).toHaveLength(2);
    })
  );
});

test("a worker that hits a usage limit is reported capacity-blocked and never redispatched", async () => {
  const w = world(":memory:", { canSteer: false });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const delivery = yield* ConstellationDelivery;
      const store = yield* EventStore;
      yield* send(WORKER);
      yield* delivery.start();
      const turn = (yield* store.model).sessions.get(WORKER)!.turns.at(-1)!;
      yield* signal(WORKER, { type: "harness.opened" });
      yield* signal(WORKER, {
        type: "harness.turnEnded",
        turnId: turn.id,
        status: "failed",
        at: AT,
        checkpoint: null,
        error: "You've hit your usage limit. Try again later.",
      });
      yield* wait(() =>
        Effect.map(
          store.model,
          (m) => m.constellations.get(CID)!.graph.attempts[0]!.state === "failed"
        )
      );
      const attempt = (yield* store.model).constellations.get(CID)!.graph.attempts[0]!;
      expect(attempt.failureKind).toBe("capacity");
      expect(attempt.resetsAt).toBeNull();
      yield* readyTimer();
      yield* TestClock.adjust(20000);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect(w.turns[0]!.sessionId).toBe(LEAD);
      expect(w.turns[0]!.prompt).toContain("A: capacity-blocked (reset time unknown)");
      expect(w.turns[0]!.prompt).toContain("Polaris will not redispatch it");
      // Nothing starts the Task again on its own: one Attempt, no worker Turn, no nudge.
      yield* finish(LEAD);
      yield* delivery.flush();
      yield* TestClock.adjust(60000);
      const after = (yield* store.model).constellations.get(CID)!.graph;
      expect(after.attempts).toHaveLength(1);
      expect(after.attempts[0]!.nudgedAt).toBeNull();
      expect(w.turns.filter((t) => t.sessionId === WORKER)).toHaveLength(0);
    })
  );
});
