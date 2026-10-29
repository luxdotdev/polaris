import { AttemptCause, AttemptId, CheckReceipt } from "@polaris/protocol";
import { expect, test } from "bun:test";
import { claimDetail, claimStep } from "./claimSheet.ts";
import type { Delivery } from "./outbox.ts";
import { attempt, claim, constellation, projection, task } from "./stats/fixtures.testing.ts";
import { canSend } from "./verdict.ts";

const NOW = Date.parse("2026-10-29T11:12:00Z");

const receipts = [
  CheckReceipt.cases.Reported.make({ label: "bun run typecheck", text: "14s", exitCode: 0 }),
  CheckReceipt.cases.Reported.make({
    label: "bun test apps/mobile/src/hosts",
    text: "23 pass, 0 fail across 4 files in 1.2s",
    exitCode: 1,
  }),
  CheckReceipt.cases.Reported.make({ label: "bun run lint", text: "clean" }),
];

/** MX-AA: B3's second attempt, handed to the user. */
const handed = (handedUpAt: string | null = "2026-10-29T11:10:00Z") => {
  const second = attempt("B3", 2, {
    state: "review",
    cause: AttemptCause.cases.SentBack.make({ ref: AttemptId.make("B3-a1") }),
    handedUpAt,
    claim: claim("4c19e2a77f", "lucas/eng-530-hosts-instrument-rows-b3", {
      receipts,
      summary: "Each host is one row with its connection state dot, round trip and route.",
    }),
  });

  return {
    constellation: constellation([task("B3")], [attempt("B3", 1, { state: "rejected" }), second]),
    projections: [projection("B3", "review", "B3-a2")],
  };
};

test("the claim sheet reads the task's latest claim as MX-AA does", () => {
  const detail = claimDetail(handed(), "B3", NOW);

  expect(detail).toMatchObject({
    taskId: "B3",
    title: "Task B3",
    attempt: 2,
    summary: "Each host is one row with its connection state dot, round trip and route.",
    head: "4c19e2a",
    branch: "lucas/eng-530-hosts-instrument-rows-b3",
  });
  // Long output stays on the Host; a failed exit code is a failed check.
  expect(detail?.checks).toEqual([
    { label: "bun run typecheck", result: "passed", detail: "14s" },
    { label: "bun test apps/mobile/src/hosts", result: "failed", detail: null },
    { label: "bun run lint", result: "reported", detail: "clean" },
  ]);
});

test("a task with no claim has no claim sheet", () => {
  const source = {
    constellation: constellation([task("A1")], [attempt("A1", 1)]),
    projections: [projection("A1", "working", "A1-a1")],
  };

  expect(claimDetail(source, "A1", NOW)).toBeNull();
  expect(claimDetail(source, "missing", NOW)).toBeNull();
});

// SAFETY: claimStep reads only a delivery's state.
const delivery = (state: Delivery["state"]) => ({ state }) as Delivery;

test("the verdicts show only while the claim is handed to the user", () => {
  const mine = claimDetail(handed(), "B3", NOW);
  const leads = claimDetail(handed(null), "B3", NOW);

  if (mine === null || leads === null) throw new Error("expected both claims");
  expect(claimStep(mine, null, false)).toBe("choose");
  expect(claimStep(leads, null, false)).toBe("read-only");
});

test("Send back asks for a reason first, and can't send without one", () => {
  const detail = claimDetail(handed(), "B3", NOW);

  if (detail === null) throw new Error("expected a claim");
  expect(claimStep(detail, null, true)).toBe("reason");
  expect(canSend("send-back", "   ")).toBe(false);
  expect(canSend("send-back", "Sort offline hosts last")).toBe(true);
  // Accept needs no answer: it sends at once.
  expect(canSend("accept", "")).toBe(true);
});

test("a verdict on its way replaces the buttons until the lead has it", () => {
  const detail = claimDetail(handed(), "B3", NOW);

  if (detail === null) throw new Error("expected a claim");
  expect(claimStep(detail, delivery("sending"), false)).toBe("delivering");
  expect(claimStep(detail, delivery("failed"), true)).toBe("delivering");
  expect(claimStep(detail, delivery("delivered"), false)).toBe("delivered");
});
