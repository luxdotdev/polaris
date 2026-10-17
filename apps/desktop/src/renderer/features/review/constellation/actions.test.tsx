import "../../../test/dom.testing.ts";
import { ConstellationId, MessageTarget, ReviewAction, WorkerPlacement } from "@polaris/protocol";
import { Toaster } from "@polaris/ui";
import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { batchOf, commentsStore, setBatch } from "../../comments/data/store.ts";
import { emptyBatch } from "../../comments/model/feedback.ts";
import { attempt, b1Claim } from "../../constellation/preview/graph.ts";
import {
  acceptClaim,
  approveClaim,
  sendToWorker,
  steerWorker,
  type WorkerTarget,
} from "./actions.ts";

/** The toasts, as the user reads them. */
const page = () => within(document.body);

const SUBJECT = "session:lead:s-b1";

const constellationId = ConstellationId.make("c1");

const target: WorkerTarget = {
  leadHostKey: "lead",
  constellationId,
  attempt: attempt({ taskId: "B1", state: "review", minutes: 40, claim: b1Claim }),
};

const done = {
  summary: "",
  next: "",
  revision: 3,
  sequence: null,
  constellation: null,
  projections: [],
  proposals: [],
};

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeBridge();
  bridge.answerOk("constellation.review", done);
  bridge.answerOk("constellation.message", done);
  render(<Toaster />);
});

afterEach(() => {
  cleanup();
  standInBridge(null);
  commentsStore.setState({ batches: {} });
});

const refusal = (code: string) => ({
  code: "ConstellationRejected",
  message: "refused",
  findings: [{ code, message: "Refused.", fix: "Agent-facing fix" }],
});

describe("approving a Claim", () => {
  test("tells the Lead's Host the user approved this Attempt at its revision", async () => {
    expect(await approveClaim(target)).toBe(true);

    const [sent] = bridge.sent("constellation.review");

    expect(sent).toMatchObject({
      hostKey: "lead",
      constellationId,
      attemptId: target.attempt.id,
      revision: target.attempt.revision,
    });
    expect(sent?.action).toEqual(ReviewAction.cases.Approve.make({}));
  });

  test("a refusal is toasted in the user's words, without the agent's fix", async () => {
    bridge.refuse("constellation.review", refusal("E-REVISION"));

    expect(await approveClaim(target)).toBe(false);
    expect(await page().findByText("Couldn't approve B1")).not.toBeNull();
    expect(
      page().getByText("B1's claim changed since you opened it. Read it again, then decide.")
    ).not.toBeNull();
    expect(page().queryByText(/Agent-facing fix/)).toBeNull();
  });
});

describe("sending feedback to the worker", () => {
  test("sends the batch back to the same session and clears it once it lands", async () => {
    setBatch(SUBJECT, { message: "Cover the handover", comments: [] });

    expect(await sendToWorker(target, SUBJECT)).toBe(true);
    expect(bridge.sent("constellation.review")[0]?.action).toEqual(
      ReviewAction.cases.SendBack.make({
        reason: "Cover the handover",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: target.attempt.sessionId }),
      })
    );
    expect(batchOf(SUBJECT)).toEqual(emptyBatch);
  });

  test("with no feedback written, it still goes back with a reason", async () => {
    await sendToWorker(target, SUBJECT);

    expect(bridge.sent("constellation.review")[0]?.action).toMatchObject({
      reason: "Sent back from Review.",
    });
  });

  test("a refused send-back keeps the batch", async () => {
    bridge.refuse("constellation.review", { code: "NotConnected", message: "lead is offline" });
    setBatch(SUBJECT, { message: "Cover the handover", comments: [] });

    expect(await sendToWorker(target, SUBJECT)).toBe(false);
    expect(batchOf(SUBJECT).message).toBe("Cover the handover");
    expect(await page().findByText("Couldn't send it back")).not.toBeNull();
  });

  test("a steer messages the worker's Attempt and clears the batch", async () => {
    setBatch(SUBJECT, { message: "Use the shared port", comments: [] });

    expect(await steerWorker(target, SUBJECT)).toBe(true);

    const [sent] = bridge.sent("constellation.message");

    expect(sent).toMatchObject({ hostKey: "lead", constellationId, text: "Use the shared port" });
    expect(sent?.target).toEqual(MessageTarget.cases.Worker.make({ attemptId: target.attempt.id }));
    expect(batchOf(SUBJECT)).toEqual(emptyBatch);
  });

  test("a steer with nothing written sends nothing", async () => {
    expect(await steerWorker(target, SUBJECT)).toBe(false);
    expect(bridge.calls).toEqual([]);
  });
});

describe("accept and merge myself", () => {
  const seen = { head: b1Claim.head, revision: target.attempt.revision };

  test("accepts the claimed head the user read, at its revision; the Lead's Host merges it", async () => {
    const later = { ...target, attempt: { ...target.attempt, revision: seen.revision + 2 } };

    expect(await acceptClaim(later, seen, { leadBranch: "main", onApprove: () => undefined })).toBe(
      true
    );

    expect(bridge.sent("constellation.review")[0]).toMatchObject({
      attemptId: target.attempt.id,
      revision: seen.revision,
    });
    expect(bridge.sent("constellation.review")[0]?.action).toEqual(
      ReviewAction.cases.Accept.make({ mergedHead: b1Claim.head, receipts: b1Claim.receipts })
    );
    expect(bridge.sent("terminal.open")).toEqual([]);
  });

  test("a merge the Lead's Host refused is worded and offers Approve", async () => {
    const onApprove = mock(() => undefined);
    bridge.refuse("constellation.review", refusal("E-MERGE-CONFLICT"));

    expect(await acceptClaim(target, seen, { leadBranch: "polaris/const-v1", onApprove })).toBe(
      false
    );
    expect(await page().findByText("Couldn't accept B1")).not.toBeNull();
    expect(page().getByText(/conflicts with polaris\/const-v1; nothing was merged/)).not.toBeNull();
    expect(page().queryByText(/Agent-facing fix/)).toBeNull();

    act(() => page().getByRole("button", { name: "Approve" }).click());

    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
