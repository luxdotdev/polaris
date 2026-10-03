import { expect, test } from "bun:test";
import {
  Attempt,
  Constellation,
  TaskDefinition,
  TaskId,
  ConstellationNotification,
  NotificationItem,
} from "@polaris/protocol";
import { Struct } from "effect";
import { A, claimed, draft, report } from "../engine/constellation.testing.ts";
import { stampKey } from "../store/constellation.ts";
import { graphResult } from "./service.ts";
import { notificationLine } from "./delivery/format.ts";
import { statusOutline } from "./status.ts";

test("status keeps only the latest rejected Claim with three indented feedback lines", () => {
  const record = claimed();

  const old = Attempt.make(
    Struct.assign(draft(A, "old"), {
      state: "rejected" as const,
      claim: report("branch", "old-head"),
      rejectionReason: "Old feedback",
    })
  );

  const latest = Attempt.make(
    Struct.assign(draft(A, "latest"), {
      state: "rejected" as const,
      claim: report("branch", "latest-head"),
      rejectionReason: "one\ntwo\nthree\nfour\nfive",
    })
  );

  const graph = Constellation.make(
    Struct.assign(record.graph, { attempts: [old, latest, draft(A, "current")] })
  );

  const text = statusOutline({ ...record, graph });

  expect(text).toContain("Claim latest-head");
  expect(text).toContain("  Review feedback:\n    one\n    two\n    three\n    …");
  expect(text).not.toContain("old-head");
  expect(text).not.toContain("four");
  expect(graph.attempts[1]!.rejectionReason).toBe("one\ntwo\nthree\nfour\nfive");
});

test("proposal details are available in status, digest and structured JSON", () => {
  const record = claimed();

  const proposed = TaskDefinition.make({
    id: TaskId.make("cleanup"),
    title: "Cleanup",
    brief: "Remove stale entries\nRetain active ones",
    deps: [A],
    area: ["apps/daemon/src/constellation/**"],
    criteria: ["No stale entries", "Active entries retained"],
    kind: "task",
  });

  const proposalId = "proposal-1";

  const enriched = {
    ...record,
    proposals: new Map([[proposalId, { by: draft().id, task: proposed }]]),
    stamps: new Map([[stampKey("proposal", proposalId), "2026-10-01T00:00:00.000Z"]]),
  };

  const n = ConstellationNotification.make({
    id: "note",
    queuedAt: record.graph.updatedAt,
    item: NotificationItem.cases.Proposal.make({ attemptId: draft().id, proposalId }),
  });

  const outline = statusOutline(enriched);
  const digest = notificationLine(enriched, n);

  for (const text of [outline, digest]) {
    expect(text).toContain("Remove stale entries");
    expect(text).toContain("Retain active ones");
    expect(text).toContain("Dependencies: A");
    expect(text).toContain("apps/daemon/src/constellation/**");
    expect(text).toContain("Active entries retained");
  }

  const result = graphResult(enriched, null, true);
  expect(result.proposals[0]?.task).toEqual(proposed);
  expect(result.proposals[0]?.at).toBe("2026-10-01T00:00:00.000Z");
  expect(JSON.stringify(result)).toContain(JSON.stringify(proposed));

  const sentBack = ConstellationNotification.make({
    id: n.id,
    queuedAt: n.queuedAt,
    item: NotificationItem.cases.Settled.make({ attemptId: draft().id, state: "rejected" }),
  });

  expect(notificationLine(enriched, sentBack)).toBe("A: sent back.");
});
