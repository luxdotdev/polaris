import { describe, expect, test } from "bun:test";
import { AttemptId, constellationSummaryOf, DomainEvent, TurnId } from "@polaris/protocol";
import { attempt, constellationOf, LEAD } from "../preview/graph.ts";
import { applyEnvelopes, startedRecord } from "./fold.ts";

const E = DomainEvent.cases;

const c = constellationOf({ attempts: [attempt({ taskId: "B1", state: "working", minutes: 9 })] });

const graph = { constellationId: c.id };

const loaded = () => ({
  listed: new Map([[c.id, constellationSummaryOf(c)]]),
  byId: new Map([[c.id, startedRecord(c, 1)]]),
});

const envelope = (sequence: number, event: DomainEvent) => ({
  sequence,
  occurredAt: "2026-10-11T12:00:00Z",
  event,
});

const notified = (steered: boolean) =>
  E.LeadNotified.make({
    ...graph,
    revision: 40,
    leadSessionId: LEAD,
    items: [],
    turnId: TurnId.make("t-lead"),
    steered,
  });

describe("fold: K-ENG fields", () => {
  test("a digest keeps whether it was steered into a running Turn", () => {
    for (const steered of [true, false]) {
      const r = applyEnvelopes(loaded(), [envelope(2, notified(steered))]).byId.get(c.id);

      expect(r?.digests.at(-1)?.steered).toBe(steered);
    }
  });

  test("a failed settle keeps its reason, failure kind and reset", () => {
    const r = applyEnvelopes(loaded(), [
      envelope(
        2,
        E.AttemptSettled.make({
          ...graph,
          revision: 41,
          attemptId: AttemptId.make("att-B1-1"),
          attemptRevision: 3,
          outcome: "failed",
          reason: "Selected model is at capacity",
          failureKind: "capacity",
          resetsAt: "2026-10-11T14:00:00Z",
        })
      ),
    ]).byId.get(c.id);

    expect(r?.constellation.attempts.find((a) => a.id === "att-B1-1")).toMatchObject({
      state: "failed",
      settleReason: "Selected model is at capacity",
      failureKind: "capacity",
      resetsAt: "2026-10-11T14:00:00Z",
    });
  });
});
