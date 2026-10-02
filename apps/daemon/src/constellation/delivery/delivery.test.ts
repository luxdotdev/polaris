import { expect, test } from "bun:test";
import {
  CommandId,
  ConstellationQuestion,
  MessageTarget,
  SetConstellationStateAction,
} from "@polaris/protocol";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { C, CID, LEAD, report } from "../../engine/constellation.testing.ts";
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
      yield* graphs.command({ kind: "session", sessionId: WORKER }, commandId(), ask("lead"));
      yield* readyTimer();
      yield* TestClock.adjust(4999);
      expect(w.turns).toHaveLength(0);
      yield* TestClock.adjust(1);
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect(w.turns[0]!.prompt).toContain("A asks lead: Which base?");
    })
  );
});

test("busy, terminal and paused Leads keep pending IDs until their boundary or take-back", async () => {
  const w = world();
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
