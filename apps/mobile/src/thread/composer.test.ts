import { describe, expect, test } from "bun:test";
import { ApprovalRequest, RequestId, type SessionState, type TurnStatus } from "@polaris/protocol";
import { type ComposerMode, composerMode, submitCommand } from "./composer.ts";
import { at, finding, sessionId, turn } from "./daemon.testing.ts";
import { type Suggestion, suggestions } from "./suggestions.ts";

const question = new ApprovalRequest({
  id: RequestId.make("r-1"),
  sessionId,
  turnId: turn(0).id,
  kind: "question",
  title: "Which base?",
  detail: null,
  options: [],
  openedAt: at,
});

describe("composer mode", () => {
  test.each<[string, SessionState, TurnStatus | null, boolean, ComposerMode["kind"]]>([
    ["idle sends a Turn", "idle", "completed", true, "send"],
    ["working steers where the Host can", "working", "working", true, "steer"],
    ["working queues where it can't", "working", "working", false, "queue"],
    ["archived can't send", "archived", "completed", true, "blocked"],
  ])("%s", (_, state, lastTurn, canSteer, kind) => {
    expect(composerMode({ state, lastTurn, pendingApprovals: [], canSteer }).kind).toBe(kind);
  });

  test("an open question is answered from the composer", () => {
    const mode = composerMode({
      state: "needs-you",
      lastTurn: "working",
      pendingApprovals: [question],
      canSteer: true,
    });

    const command = submitCommand(mode, sessionId, " main ");

    expect(command?._tag).toBe("RespondToApproval");
  });

  test("typed text never answers an open secret: the composer waits for its card", () => {
    const secret = new ApprovalRequest({
      id: RequestId.make("r-2"),
      sessionId,
      turnId: turn(0).id,
      kind: "secret",
      title: "API key",
      detail: null,
      options: [],
      openedAt: at,
    });

    const mode = composerMode({
      state: "needs-you",
      lastTurn: "working",
      pendingApprovals: [secret],
      canSteer: true,
    });

    expect(mode.kind).toBe("blocked");
    expect(submitCommand(mode, sessionId, "sk-live-123")).toBeNull();
  });

  test("queue mode never sends straight away", () => {
    expect(submitCommand({ kind: "queue" }, sessionId, "after this")).toBeNull();
  });
});

describe("suggested chips appear only in the states DESIGN.md allows", () => {
  const critical = finding();
  const high = finding({ severity: "high" });
  const dismissed = finding({ status: "dismissed" });

  test.each<
    [string, SessionState, TurnStatus | null, ReturnType<typeof finding>[], Suggestion["kind"][]]
  >([
    ["working with an open Critical: fix only", "working", "working", [critical], ["fix"]],
    [
      "finished with an open Critical: fix and review",
      "idle",
      "completed",
      [critical],
      ["fix", "review"],
    ],
    ["finished, no Critical: review only", "idle", "completed", [high], ["review"]],
    ["a dismissed Critical isn't open", "idle", "completed", [dismissed], ["review"]],
    ["working, no Critical: nothing", "working", "working", [], []],
    ["a failed Turn didn't finish: nothing", "failed", "failed", [], []],
    ["interrupted: nothing", "idle", "interrupted", [], []],
  ])("%s", (_, state, lastTurn, findings, kinds) => {
    expect(suggestions({ state, lastTurn, findings }).map((chip) => chip.kind)).toEqual(kinds);
  });
});
