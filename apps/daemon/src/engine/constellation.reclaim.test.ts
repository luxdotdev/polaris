import { expect, test } from "bun:test";
import { Claim, ReviewAction } from "@polaris/protocol";
import { Predicate, Struct } from "effect";
import { C, CID, LEAD, apply, claimed, ctx, draft, report } from "./constellation.testing.ts";
import { decideConstellation } from "./constellation.ts";

const reclaim = (head: string, dirtyPaths: string[] = []) => ({
  command: C.WorkerClaim.make({
    constellationId: CID,
    attemptId: draft().id,
    claim: report(draft().branch, head),
  }),
  context: ctx({
    binding: { kind: "session", sessionId: draft().sessionId },
    claimProbe: { dirtyPaths, branch: draft().branch, head },
  }),
});

test("a changed review head supersedes its Claim and clears approval/handoff; stale Accept fails", () => {
  let record = claimed();
  const revision = record.graph.attempts[0]!.revision;
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision,
      action: ReviewAction.cases.Approve.make({}),
    })
  );
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision: record.graph.attempts[0]!.revision,
      action: ReviewAction.cases.HandUp.make({ reason: "Review it" }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );
  const old = record.graph.attempts[0]!;
  const input = reclaim("edited-head");
  const decision = decideConstellation(record, input.command, input.context);
  expect(decision.rejection).toBeNull();
  expect(decision.events.filter((e) => Predicate.isTagged(e, "NotificationQueued"))).toHaveLength(
    1
  );
  record = apply(record, input.command, input.context);
  const revised = record.graph.attempts[0]!;
  expect(revised.id).toBe(old.id);
  expect(revised.revision).toBe(old.revision + 1);
  expect(revised.state).toBe("review");
  expect(revised.claim?.head).toBe("edited-head");
  expect(old.claim?.head).toBe("head");
  expect(revised.approvedByUserAt).toBeNull();
  expect(revised.handedUpAt).toBeNull();
  expect(revised.handedUpReason).toBeNull();

  const accept = (revision: number, head: string) =>
    decideConstellation(
      record,
      C.Review.make({
        constellationId: CID,
        attemptId: revised.id,
        revision,
        action: ReviewAction.cases.Accept.make({ mergedHead: head, receipts: [] }),
      }),
      ctx()
    );

  expect(accept(old.revision, "head").rejection?.findings[0]?.code).toBe("E-REVISION");
  expect(accept(revised.revision, "edited-head").rejection).toBeNull();
});

test("re-claim still requires a clean matching changed branch head", () => {
  const record = claimed();

  for (const [head, dirty, expected] of [
    ["head", [], "E-CLAIM-UNCHANGED"],
    ["edited-head", ["file.ts"], "E-CLAIM-DIRTY"],
  ] as const) {
    const input = reclaim(head, [...dirty]);
    const decision = decideConstellation(record, input.command, input.context);
    expect(decision.rejection?.findings.some((f) => f.code === expected)).toBe(true);
  }

  const input = reclaim("new");

  const mismatched = C.WorkerClaim.make({
    ...input.command,
    claim: Claim.make(Struct.assign(input.command.claim, { branch: "other" })),
  });

  expect(
    decideConstellation(record, mismatched, input.context).rejection?.findings.some(
      (f) => f.code === "E-CLAIM-HEAD"
    )
  ).toBe(true);
});
