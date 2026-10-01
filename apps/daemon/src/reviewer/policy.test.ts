import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { canRunChecks, reviewerDecision } from "./policy.ts";

const sessionId = SessionId.make("ses-r");

describe("the Reviewer's read-only policy", () => {
  test.each(["codex", "claude"] as const)("declines every late request from %s", (harness) => {
    const base = { sessionId, harness, title: "git diff", detail: "git diff" };

    for (const kind of ["command", "file-change", "tool", "question"] as const) {
      expect(reviewerDecision({ ...base, kind })._tag).toBe("Deny");
    }
  });

  test("checks run where the Harness keeps them off the network", () => {
    expect(canRunChecks("codex", "linux")).toBe(true);
    expect(canRunChecks("claude", "darwin")).toBe(true);
    expect(canRunChecks("opencode", "darwin")).toBe(false);
    expect(canRunChecks("claude", "win32")).toBe(false);
  });
});
