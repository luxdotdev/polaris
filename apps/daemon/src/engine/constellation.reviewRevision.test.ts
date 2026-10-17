import { expect, test } from "bun:test";
import { ReviewAction } from "@polaris/protocol";
import type { ConstellationRecord } from "../store/constellation.ts";
import { C, CID, LEAD, apply, claimed, ctx, draft, report } from "./constellation.testing.ts";
import { decideConstellation } from "./constellation.ts";

const worker = ctx({ binding: { kind: "session", sessionId: draft().sessionId } });

const accept = (record: ConstellationRecord, revision: number, head = "head") =>
  decideConstellation(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision,
      action: ReviewAction.cases.Accept.make({ mergedHead: head, receipts: [] }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );

const amend = (record: ConstellationRecord, head: string) =>
  apply(
    record,
    C.WorkerClaim.make({
      constellationId: CID,
      attemptId: draft().id,
      claim: report(draft().branch, head),
    }),
    ctx({
      binding: { kind: "session", sessionId: draft().sessionId },
      claimProbe: { dirtyPaths: [], branch: draft().branch, head },
    })
  );

test("an Accept of an unchanged Claim tolerates later progress, approval and hand-up", () => {
  let record = claimed();
  const seen = record.graph.attempts[0]!.revision;

  record = apply(
    record,
    C.WorkerProgress.make({ constellationId: CID, attemptId: draft().id, note: "waiting" }),
    worker
  );
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision: seen,
      action: ReviewAction.cases.Approve.make({}),
    })
  );
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision: seen,
      action: ReviewAction.cases.HandUp.make({ reason: "Yours" }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );

  expect(record.graph.attempts[0]!.revision).toBe(seen + 3);
  expect(accept(record, seen).rejection).toBeNull();
});

test("an Accept is refused when the reviewer saw an older Claim or none", () => {
  const before = claimed();
  const first = before.graph.attempts[0]!.revision;

  expect(accept(before, first - 1).rejection?.findings[0]?.code).toBe("E-REVISION");

  const amended = amend(before, "amended-head");
  const findings = accept(amended, first).rejection?.findings.map((f) => f.code);

  expect(findings).toContain("E-REVISION");
  expect(accept(amended, first, "amended-head").rejection?.findings[0]?.code).toBe("E-REVISION");
  expect(accept(amended, first + 1, "amended-head").rejection).toBeNull();
});
