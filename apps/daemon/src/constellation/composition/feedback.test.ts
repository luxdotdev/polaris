import { expect, test } from "bun:test";
import { Attempt, AttemptCause, AttemptId, Constellation } from "@polaris/protocol";
import { Struct } from "effect";
import { A, claimed, draft, report } from "../../engine/constellation.testing.ts";
import { workerBrief } from "../../harness/constellation/worker.ts";
import { assignment } from "../../harness/constellation/testing.ts";
import { reviewFeedback } from "./feedback.ts";

const previous = (patch: {
  readonly state: Attempt["state"];
  readonly rejectionReason?: string;
  readonly settleReason?: string;
  readonly failureKind?: Attempt["failureKind"];
}) =>
  Attempt.make(
    Struct.assign(draft(A, "a1"), {
      claim: report("polaris/A", "old-head"),
      state: patch.state,
      rejectionReason: patch.rejectionReason ?? null,
      settleReason: patch.settleReason ?? null,
      failureKind: patch.failureKind ?? null,
    })
  );

const graphWith = (first: Attempt) =>
  Constellation.make(Struct.assign(claimed().graph, { attempts: [first] }));

const next = (cause: Attempt["cause"]) => draft(A, "a2", draft().sessionId, cause);

test("every cause that names an earlier Attempt carries what it left behind", () => {
  const ref = AttemptId.make("a1");

  const sentBack = reviewFeedback(
    graphWith(previous({ state: "rejected", rejectionReason: "Fix cleanup." })),
    next(AttemptCause.cases.SentBack.make({ ref }))
  );

  expect(sentBack.feedback).toBe("Fix cleanup.");
  expect(sentBack.rejectedClaim?.head).toBe("old-head");

  const failed = reviewFeedback(
    graphWith(
      previous({
        state: "failed",
        settleReason: "Selected model is at capacity.",
        failureKind: "capacity",
      })
    ),
    next(AttemptCause.cases.Followup.make({ ref }))
  );

  expect(failed.feedback).toContain("a1 failed (model capacity): Selected model is at capacity.");
  expect(failed.feedback).toContain("the failure was not the implementation's");

  const superseded = reviewFeedback(
    graphWith(previous({ state: "lost", settleReason: "stopped by handover" })),
    next(AttemptCause.cases.Superseded.make({ ref }))
  );

  expect(superseded.feedback).toContain("stopped by a Lead handover (stopped by handover)");

  const recover = reviewFeedback(
    graphWith(previous({ state: "lost", settleReason: "MCP HTTP 401 after Session reuse" })),
    next(AttemptCause.cases.Recover.make({ ref }))
  );

  expect(recover.feedback).toContain("could not be continued: MCP HTTP 401 after Session reuse");

  expect(reviewFeedback(graphWith(previous({ state: "accepted" })), draft(A, "a2"))).toEqual({});
});

test("the brief labels a previous Claim by its cause and states the rejected-head rule", () => {
  const base = assignment();

  const brief = workerBrief({
    ...base,
    attempt: Attempt.make(
      Struct.assign(base.attempt, {
        cause: AttemptCause.cases.Followup.make({ ref: AttemptId.make("a1") }),
      })
    ),
    feedback: "Attempt a1 failed (model capacity).",
    rejectedClaim: report("polaris/A", "old-head"),
  });

  expect(brief).toContain("Previous Attempt's Claim:");
  expect(brief).toContain("Previous Attempt:\nAttempt a1 failed (model capacity).");
  expect(brief).toContain("A head that was sent back cannot be claimed again as corrected");
  expect(brief).not.toContain("Sent-back Claim:");
});
