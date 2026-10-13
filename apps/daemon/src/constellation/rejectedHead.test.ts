import { expect, test } from "bun:test";
import { Claim, ReviewAction, SessionId, WorkerPlacement } from "@polaris/protocol";
import { Struct } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import { A, C, CID, apply, claimed, ctx, draft, report } from "../engine/constellation.testing.ts";

const retry = draft(A, "a2", SessionId.make("worker-2"));

/** The first Attempt's Claim at `head` is sent back and a linked retry starts on another Session. */
const sentBack = () => {
  const record = claimed();
  const attempt = record.graph.attempts[0]!;

  return apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "Cleanup is missing.\nAdd the regression test.",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: retry.sessionId }),
      }),
    }),
    ctx({ attempts: [retry] })
  );
};

const claimRetry = (claim: Claim) => {
  const record = sentBack();
  const attempt = record.graph.attempts.at(-1)!;

  return decideConstellation(
    record,
    C.WorkerClaim.make({ constellationId: CID, attemptId: attempt.id, claim }),
    ctx({
      binding: { kind: "session", sessionId: attempt.sessionId },
      claimProbe: { dirtyPaths: [], branch: claim.branch, head: claim.head },
    })
  );
};

test("a retry cannot re-claim the sent-back head unless a decision names it", () => {
  const unchanged = claimRetry(report(retry.branch, "head"));
  const finding = unchanged.rejection?.findings.find((f) => f.code === "E-CLAIM-REJECTED-HEAD");
  expect(finding?.message).toBe("Head head was sent back on Attempt a1: Cleanup is missing.");
  expect(finding?.fix).toContain("add a decision naming this head");

  const disposed = claimRetry(
    Claim.make(
      Struct.assign(report(retry.branch, "head"), {
        decisions: ["head stands: the cleanup lives in the accepted dependency, test added there"],
      })
    )
  );

  expect(disposed.rejection).toBeNull();

  const fixed = claimRetry(report(retry.branch, "fixed-head"));
  expect(fixed.rejection).toBeNull();
});
