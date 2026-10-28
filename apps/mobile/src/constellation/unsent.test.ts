import { describe, expect, test } from "bun:test";
import { chosen, claimKey, type ClaimRef, typed, unsentFor } from "./unsent.ts";

const first: ClaimRef = { attemptId: "A1:attempt", revision: 3, head: "head-1" };

const answered = () => {
  const key = claimKey(first);

  return typed(unsentFor(chosen(key, "accept"), key), "answer for head-1");
};

describe("a handed claim's unsent verdict", () => {
  test("stays with its claim across re-renders", () => {
    const kept = unsentFor(answered(), claimKey(first));

    expect(kept.step).toEqual({ kind: "reply", verdict: "accept" });
    expect(kept.draft).toBe("answer for head-1");
  });

  test.each([
    ["Attempt", { ...first, attemptId: "A1:attempt-2" }],
    ["revision", { ...first, revision: 4 }],
    ["head", { ...first, head: "head-2" }],
  ])("starts clean when a replacement claim changes its %s", (_, replacement) => {
    const next = unsentFor(answered(), claimKey(replacement));

    expect(next.step).toEqual({ kind: "choose" });
    expect(next.draft).toBeNull();
  });
});
