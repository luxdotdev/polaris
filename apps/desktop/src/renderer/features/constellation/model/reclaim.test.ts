import { expect, test } from "bun:test";
import {
  Constellation,
  ConstellationStreamItem,
  DomainEvent,
  EventEnvelope,
  Sequence,
} from "@polaris/protocol";
import { Struct } from "effect";
import { c1Record } from "../preview/graph.ts";
import { applyEnvelopes, applyStreamItems, merged } from "./fold.ts";
import { emptyConstellations } from "./types.ts";

test("a fresh Claim clears previous user approval and handoff in the Desktop event fold", () => {
  const record = c1Record();
  const old = record.constellation.attempts.find((a) => a.claim !== null)!;
  const at = "2026-10-03T05:00:00Z";

  const graph = new Constellation({
    ...record.constellation,
    attempts: record.constellation.attempts.map((a) =>
      a.id === old.id
        ? merged(a, {
            state: "review",
            approvedByUserAt: at,
            handedUpAt: at,
            handedUpReason: "Review",
            nudgedAt: at,
          })
        : a
    ),
  });

  const model = applyStreamItems(emptyConstellations, [
    ConstellationStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(1),
      constellation: graph,
      projections: [],
      proposals: [],
      progress: [],
      messages: [],
      digests: [],
      handovers: [],
    }),
  ]);

  const next = applyEnvelopes(model, [
    EventEnvelope.make({
      sequence: Sequence.make(2),
      occurredAt: at,
      commandId: null,
      event: DomainEvent.cases.AttemptClaimed.make({
        constellationId: graph.id,
        revision: graph.revision + 1,
        attemptId: old.id,
        attemptRevision: old.revision + 1,
        claim: Struct.assign(old.claim!, { head: "new-head" }),
      }),
    }),
  ]);

  const attempt = next.byId.get(graph.id)!.constellation.attempts.find((a) => a.id === old.id)!;
  expect(attempt.claim?.head).toBe("new-head");
  expect(attempt.approvedByUserAt).toBeNull();
  expect(attempt.handedUpAt).toBeNull();
  expect(attempt.handedUpReason).toBeNull();
  expect(attempt.nudgedAt).toBeNull();
  expect(attempt.state).toBe("review");
});
