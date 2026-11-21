import { describe, expect, test } from "bun:test";
import {
  AttemptId,
  constellationSummaryOf,
  DomainEvent,
  SessionId,
  TurnId,
} from "@polaris/protocol";
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

describe("fold: Inspection", () => {
  const id = AttemptId.make("att-B1-1");
  const target = { ...graph, attemptId: id, inspectionId: "i1", at: "2026-10-11T12:00:00Z" };

  const started = (inspectionId = "i1") =>
    E.InspectionStarted.make({
      ...target,
      inspectionId,
      revision: 41,
      attemptRevision: 3,
      sessionId: SessionId.make("inspector"),
      head: "head",
      accept: true,
    });

  const inspection = (events: ReadonlyArray<DomainEvent>) =>
    applyEnvelopes(
      loaded(),
      events.map((event, i) => envelope(2 + i, event))
    )
      .byId.get(c.id)
      ?.constellation.attempts.find((a) => a.id === id)?.inspection;

  test("a held Claim's Inspection is pending, then carries its verdict and why the merge was refused", () => {
    expect(inspection([started()])).toMatchObject({ state: "pending", accept: true });
    expect(
      inspection([
        started(),
        E.InspectionRecorded.make({
          ...target,
          revision: 42,
          attemptRevision: 4,
          verdict: "approve",
          route: "lead",
          reason: "Covers the criteria.",
          mergeRefusal: "The merge conflicts in a.ts",
        }),
      ])
    ).toMatchObject({
      state: "approved",
      reason: "Covers the criteria.",
      mergeRefusal: "The merge conflicts in a.ts",
    });
  });

  test("an ending that names an Inspection a newer Claim replaced leaves the current one pending", () => {
    const ended = E.InspectionEnded.make({
      ...target,
      revision: 43,
      attemptRevision: 5,
      cause: "lost",
      reason: "Its turn ended without a verdict",
    });

    expect(inspection([started("i2"), ended])?.state).toBe("pending");
    expect(inspection([started(), ended])).toMatchObject({ state: "lost" });
  });
});
