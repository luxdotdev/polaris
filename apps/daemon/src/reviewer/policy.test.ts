import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { probeClaudeSandbox } from "../harness/claude/sandbox.ts";
import { reviewerDecision, reviewerShell } from "./policy.ts";

const host = (platform: NodeJS.Platform, installed: ReadonlyArray<string>) => () =>
  probeClaudeSandbox({
    platform,
    find: (binary) => (installed.includes(binary) ? `/usr/bin/${binary}` : null),
  });

const sessionId = SessionId.make("ses-r");

describe("the Reviewer's read-only policy", () => {
  test.each(["codex", "claude"] as const)("declines every late request from %s", (harness) => {
    const base = { sessionId, harness, title: "git diff", detail: "git diff" };

    for (const kind of ["command", "file-change", "tool", "question"] as const) {
      expect(reviewerDecision({ ...base, kind })._tag).toBe("Deny");
    }
  });

  test("checks run where the Harness keeps them off the network", () => {
    expect(reviewerShell("codex", host("linux", []))).toBe("checks");
    expect(reviewerShell("claude", host("darwin", []))).toBe("checks");
    expect(reviewerShell("claude", host("linux", ["bwrap", "socat"]))).toBe("checks");
    expect(reviewerShell("opencode", host("darwin", []))).toBe("git");
  });

  test("Claude Code without its sandbox gets no shell, rather than failing", () => {
    expect(reviewerShell("claude", host("linux", ["bwrap"]))).toBe("none");
    expect(reviewerShell("claude", host("linux", []))).toBe("none");
    expect(reviewerShell("claude", host("win32", []))).toBe("none");
  });
});
