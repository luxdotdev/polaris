import { expect, test } from "bun:test";
import {
  CommandId,
  DomainEvent,
  MessageTarget,
  SetConstellationStateAction,
  TurnItem,
  PlanOperation,
  AttemptCause,
  AttemptId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { C, CID, LEAD, G, draft, task, ctx } from "../../engine/constellation.testing.ts";
import { decideConstellation } from "../../engine/constellation.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";
import { ConstellationDelivery } from "../delivery/index.ts";
import { setup, world, WORKER, finish, send, wait } from "../delivery/testing.ts";

const handover = (summary = "Focus on the Gate", interrupt = false) =>
  C.SetState.make({
    constellationId: CID,
    action: SetConstellationStateAction.cases.HandOver.make({ summary, interrupt }),
  });

const cid = () => CommandId.make(crypto.randomUUID());

const completeSummary = Effect.fnUntraced(function* (turn: import("@polaris/protocol").Turn) {
  if (!turn.prompt.startsWith("Write a compact handover")) return;
  const store = yield* EventStore;
  yield* store.commit({
    commandId: null,
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: turn.sessionId,
          turnId: turn.id,
          subagentId: null,
          item: TurnItem.cases.AssistantMessage.make({
            id: "summary",
            text: "The implementation is ready; review the Gate.",
          }),
        }),
      ]),
  });
  yield* finish(turn.sessionId).pipe(Effect.orDie);
});

test("Lead self-call queues without blocking; boundary runs one summary, then atomically archives and switches", async () => {
  const w = world(":memory:", { onRun: (turn) => completeSummary(turn).pipe(Effect.orDie) });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graphs = yield* Constellations;
      const delivery = yield* ConstellationDelivery;
      yield* send(LEAD);
      yield* delivery.start();
      yield* graphs.command({ kind: "session", sessionId: LEAD }, cid(), handover());
      const before = (yield* store.model).constellations.get(CID)!;
      expect(before.graph.leadSessionId).toBe(LEAD);
      expect(before.handoverRequest).not.toBeNull();
      expect(w.turns).toHaveLength(0);
      yield* finish(LEAD);
      yield* wait(() => Effect.succeed(w.turns.length === 2));
      const model = yield* store.model;
      const record = model.constellations.get(CID)!;
      expect(record.graph.leadSessionId).not.toBe(LEAD);
      expect(record.handoverRequest).toBeNull();
      expect(model.sessions.get(LEAD)!.session.state).toBe("archived");
      expect(model.sessions.get(record.graph.leadSessionId)!.session.cwd).toBe(
        model.sessions.get(LEAD)!.session.cwd
      );
      expect(model.sessions.get(record.graph.leadSessionId)!.session.model).toBe("gpt-6.1-sol");
      expect(record.graph.attempts[0]!.sessionId).toBe(WORKER);
      expect(record.handovers[0]!.summary).toContain("review the Gate");
      expect(w.turns[1]!.prompt).toContain("Settings:");
      expect(w.turns[1]!.prompt).toContain("Existing workers continue");
      expect(w.retired).toEqual([LEAD]);
    })
  );
});

test("Hand over now interrupts the old Turn; a failed summary still supplies all in-transit messages", async () => {
  const w = world(":memory:", {
    canSteer: false,
    onRun: (turn) =>
      turn.prompt.startsWith("Write a compact handover")
        ? finish(turn.sessionId, "failed").pipe(Effect.orDie)
        : Effect.void,
  });

  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graphs = yield* Constellations;
      yield* send(LEAD);
      yield* send(WORKER);
      yield* graphs.command(
        { kind: "user" },
        cid(),
        C.Message.make({
          constellationId: CID,
          target: MessageTarget.cases.Worker.make({
            attemptId: (yield* store.model).constellations.get(CID)!.graph.attempts[0]!.id,
          }),
          text: "Keep this pending",
        })
      );
      yield* (yield* ConstellationDelivery).start();
      yield* graphs.command({ kind: "user" }, cid(), handover("", true));
      yield* wait(() => Effect.succeed(w.turns.length === 2));
      expect(w.turns[1]!.prompt).toContain("Keep this pending");
      expect(w.turns[1]!.prompt).toContain("could not provide a summary");
      expect((yield* store.model).constellations.get(CID)!.messages.size).toBe(1);
    })
  );
});

test("a superseded request cannot change the Lead; only the latest summary is used", async () => {
  const w = world(":memory:", { onRun: (turn) => completeSummary(turn).pipe(Effect.orDie) });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graphs = yield* Constellations;
      yield* send(LEAD);
      yield* (yield* ConstellationDelivery).start();
      yield* graphs.command({ kind: "user" }, cid(), handover("Old focus"));
      const old = (yield* store.model).constellations.get(CID)!.handoverRequest!.requestId;
      yield* graphs.command({ kind: "user" }, cid(), handover("Latest focus"));
      const latest = (yield* store.model).constellations.get(CID)!.handoverRequest!.requestId;
      expect(latest).not.toBe(old);
      yield* finish(LEAD);
      yield* wait(() => Effect.succeed(w.turns.length === 2));
      expect(w.turns[0]!.prompt).toContain("Latest focus");
      expect((yield* store.model).constellations.get(CID)!.handovers).toHaveLength(1);
    })
  );
});

test("handover stops the active Gate atomically, preserves workers, and its next Attempt supersedes it", async () => {
  const w = world(":memory:", { onRun: (turn) => completeSummary(turn).pipe(Effect.orDie) });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graphs = yield* Constellations;
      yield* graphs.command(
        { kind: "user" },
        cid(),
        C.Plan.make({
          constellationId: CID,
          operations: [PlanOperation.cases.Add.make({ task: task(G, [], "gate") })],
        })
      );

      const dispatch = (sessionId: import("@polaris/protocol").SessionId, id: string) =>
        store.commit({
          commandId: null,
          decide: (model) => {
            const decision = decideConstellation(
              model.constellations.get(CID),
              C.Dispatch.make({
                constellationId: CID,
                tasks: [{ taskId: G, worker: WorkerPlacement.cases.Existing.make({ sessionId }) }],
              }),
              ctx({ attempts: [draft(G, id, sessionId)], now: new Date().toISOString() })
            );

            return decision.rejection === null
              ? Effect.succeed(decision.events)
              : Effect.fail(decision.rejection);
          },
        });

      yield* dispatch(LEAD, "gate-1");
      yield* send(LEAD);
      yield* (yield* ConstellationDelivery).start();
      yield* graphs.command({ kind: "session", sessionId: LEAD }, cid(), handover());
      yield* wait(() =>
        Effect.map(store.model, (m) => m.constellations.get(CID)!.graph.leadSessionId !== LEAD)
      );
      const graph = (yield* store.model).constellations.get(CID)!;
      expect(graph.graph.attempts.find((a) => a.id === "gate-1")!.state).toBe("lost");
      expect(graph.graph.attempts[0]!.sessionId).toBe(WORKER);
      expect(graph.graph.attempts[0]!.state).toBe("working");
      expect(w.turns.at(-1)!.prompt).toContain("Gate G was in progress at handover: re-run it");

      const events = yield* store.readConstellationEvents({
        after: 0,
        upTo: (yield* store.model).sequence,
        constellationId: CID,
      });

      const stop = events.find((e) => Predicate.isTagged(e.event, "AttemptSettled"))!;
      const changed = events.find((e) => Predicate.isTagged(e.event, "LeadChanged"))!;
      expect(stop.occurredAt).toBe(changed.occurredAt);
      expect(stop.sequence).toBeLessThan(changed.sequence);
      yield* dispatch(graph.graph.leadSessionId, "gate-2");
      const next = (yield* store.model).constellations.get(CID)!.graph.attempts.at(-1)!;
      expect(next.cause).toEqual(
        AttemptCause.cases.Superseded.make({ ref: AttemptId.make("gate-1") })
      );
    })
  );
});
