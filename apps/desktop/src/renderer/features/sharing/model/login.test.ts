import { describe, expect, test } from "bun:test";
import type { LimitData } from "../../harness/model/limits.ts";
import { harnessLogin, loginWarning, roleStatement } from "./login.ts";

const limit = (harness: string, plan: string | null): LimitData => ({
  harness,
  kind: "five-hour",
  scope: null,
  windowMinutes: 300,
  usedPercent: 12,
  status: "ok",
  resetsAt: null,
  observedAt: "2026-11-16T10:00:00.000Z",
  plan,
  weeklyPerSession: null,
});

describe("what a Contributor's Turns run on", () => {
  test("a personal plan warns with its name; a company plan doesn't; no plan reported warns as unknown", () => {
    const max = harnessLogin([limit("codex", "plus"), limit("claude", "max")], "claude");
    const team = harnessLogin([limit("claude", "team")], "claude");
    const none = harnessLogin([limit("claude", null), limit("codex", "pro")], "claude");

    expect(loginWarning("contributor", max, "claude")).toBe(
      "This session runs on a personal Claude login (Max). Its terms may not let someone else send Turns on it. A Commenter share avoids this."
    );
    expect(loginWarning("contributor", team, "claude")).toBeNull();
    expect(loginWarning("contributor", none, "claude")).toBe(
      "Polaris can't tell which Claude login this session runs on. If it's a personal subscription, its terms may not let someone else send Turns on it. A Commenter share avoids this."
    );
    expect(loginWarning("contributor", harnessLogin([], "codex"), "codex")).toContain(
      "which ChatGPT login"
    );
  });

  test("a Commenter share needs no warning", () => {
    expect(
      loginWarning("commenter", harnessLogin([limit("claude", "pro")], "claude"), "claude")
    ).toBeNull();
  });

  test("the role's statement says on whose login a Contributor's Turns run", () => {
    expect(roleStatement("contributor", "@alex", "claude")).toBe(
      "@alex can send Turns and answer approvals. @alex's Turns run on your Claude login and count against your plan."
    );
    expect(roleStatement("contributor", "They", "codex")).toBe(
      "They can send Turns and answer approvals. Their Turns run on your ChatGPT login and count against your plan."
    );
    expect(roleStatement("commenter", "@alex", "claude")).toBe(
      "@alex can comment on messages and changes, and can't send Turns or answer approvals."
    );
  });
});
