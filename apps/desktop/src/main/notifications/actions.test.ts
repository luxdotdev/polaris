import { describe, expect, test } from "bun:test";
import type { NeedsYouTurn, ReviewTarget } from "../../shared/needsYou.ts";
import { turnClick } from "./actions.ts";

const turn: NeedsYouTurn = {
  hostKey: "local",
  hostLabel: "This Mac",
  sessionId: "s-reviewer",
  title: "Reviewer · Pull request #12",
  harness: "Claude Code",
  state: "idle",
  reply: null,
  backgroundTasks: 0,
  userTurn: null,
  updatedAt: "2026-10-19T09:00:00.000Z",
};

describe("turnClick", () => {
  test("a session's banner opens the session", () => {
    expect(turnClick(turn)).toEqual({
      kind: "needs-you",
      action: "open",
      hostKey: "local",
      sessionId: "s-reviewer",
    });
  });

  test.each<[string, ReviewTarget]>([
    [
      "pull request",
      { kind: "pull", repo: { owner: "acme", name: "api" }, number: 12, pullId: null },
    ],
    ["Agent Session", { kind: "session", hostKey: "local", sessionId: "s-reviewed" }],
  ])("a Review's banner opens the Review of its %s", (_, target) => {
    const review = { kind: "reviewer" as const, change: "Retry uploads", target, findings: null };

    expect(turnClick({ ...turn, review })).toEqual({ kind: "open-review", target });
  });

  test("a Review the Client can't place opens the Reviewer's session", () => {
    const review = {
      kind: "reviewer" as const,
      change: "Retry uploads",
      target: null,
      findings: null,
    };

    expect(turnClick({ ...turn, review })).toMatchObject({ kind: "needs-you", action: "open" });
  });
});
