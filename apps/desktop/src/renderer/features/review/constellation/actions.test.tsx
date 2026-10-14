import "../../../test/dom.testing.ts";
import {
  ConstellationId,
  MessageTarget,
  ReviewAction,
  TerminalId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Toaster } from "@polaris/ui";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Data } from "effect";
import type { TerminalItem } from "../../../../shared/api.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { batchOf, commentsStore, setBatch } from "../../comments/data/store.ts";
import { emptyBatch } from "../../comments/model/feedback.ts";
import { attempt, b1Claim, LEAD } from "../../constellation/preview/graph.ts";
import {
  acceptAndMerge,
  approveClaim,
  type MergePlace,
  sendToWorker,
  steerWorker,
  type WorkerTarget,
} from "./actions.ts";

const Items = Data.taggedEnum<TerminalItem>();

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
  const terminalId = TerminalId.make("term-1");

  const placeWith = (onApprove: () => void): MergePlace => ({
    workspaceId: "w1",
    cwd: "/code/polaris",
    leadSessionId: LEAD,
    onApprove,
  });

  /** Starts the merge, waits for its terminal, and ends it with `code`. */
  const mergeEnding = async (code: number, place: MergePlace) => {
    const merged = acceptAndMerge(target, place);

    await waitFor(() => expect(bridge.feeds("terminal")).toHaveLength(1));
    act(() => bridge.feeds("terminal")[0]?.listener.items([Items.Exit({ code })]));

    return merged;
  };

  beforeEach(() => {
    bridge.answerOk("terminal.open", { terminalId });
    bridge.answerOk("git.status", {
      branch: "polaris/const-v1",
      head: "merged-head",
      ahead: 0,
      behind: 0,
      entries: [],
    });
  });

  test("merges the claimed head in the Lead's checkout, then accepts with the merged head", async () => {
    expect(
      await mergeEnding(
        0,
        placeWith(() => undefined)
      )
    ).toBe(true);

    expect(bridge.sent("terminal.open")[0]).toMatchObject({
      hostKey: "lead",
      cwd: "/code/polaris",
      argv: ["git", "merge", "--no-edit", b1Claim.head],
    });
    expect(bridge.sent("git.status")).toEqual([{ hostKey: "lead", cwd: "/code/polaris" }]);
    expect(bridge.sent("constellation.review")[0]?.action).toEqual(
      ReviewAction.cases.Accept.make({ mergedHead: "merged-head", receipts: b1Claim.receipts })
    );
  });

  test("a failed merge accepts nothing and offers Approve instead", async () => {
    const onApprove = mock(() => undefined);

    expect(await mergeEnding(1, placeWith(onApprove))).toBe(false);
    expect(bridge.sent("constellation.review")).toEqual([]);
    expect(await page().findByText("Couldn't merge B1")).not.toBeNull();

    act(() => page().getByRole("button", { name: "Approve" }).click());

    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  test("a checkout with no head after the merge accepts nothing", async () => {
    bridge.answerOk("git.status", { branch: null, head: null, ahead: 0, behind: 0, entries: [] });

    expect(
      await mergeEnding(
        0,
        placeWith(() => undefined)
      )
    ).toBe(false);
    expect(bridge.sent("constellation.review")).toEqual([]);
    expect(
      await page().findByText("Merged, but the lead's checkout has no head to accept with.")
    ).not.toBeNull();
  });

  test("a refused accept names the Lead's branch and offers Approve", async () => {
    bridge.refuse("constellation.review", refusal("E-GIT"));

    expect(
      await mergeEnding(
        0,
        placeWith(() => undefined)
      )
    ).toBe(false);
    expect(await page().findByText("Couldn't accept B1")).not.toBeNull();
    expect(page().getByText(/into polaris\/const-v1 first/)).not.toBeNull();
    expect(page().getByRole("button", { name: "Approve" })).not.toBeNull();
  });

  test("a terminal that won't open merges nothing", async () => {
    bridge.refuse("terminal.open", { code: "NotConnected", message: "lead is offline" });

    expect(
      await acceptAndMerge(
        target,
        placeWith(() => undefined)
      )
    ).toBe(false);
    expect(bridge.sent("git.status")).toEqual([]);
    expect(bridge.sent("constellation.review")).toEqual([]);
  });
});
