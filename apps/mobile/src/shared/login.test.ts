import { describe, expect, test } from "bun:test";
import { harnessLogin, loginWarning } from "./login.ts";
import { shareConsequences } from "./share.ts";

describe("what a Contributor's Turns run on", () => {
  test("a personal plan warns with its name, a company plan doesn't, and no plan warns as unknown", () => {
    const max = harnessLogin([{ harness: "claude", plan: "max" }], "claude");

    expect(loginWarning("contributor", max, "claude")).toBe(
      "This session runs on a personal Claude login (Max). Its terms may not let someone else send turns on it. A commenter share avoids this."
    );
    expect(
      loginWarning(
        "contributor",
        harnessLogin([{ harness: "claude", plan: "enterprise" }], "claude"),
        "claude"
      )
    ).toBeNull();
    expect(loginWarning("contributor", harnessLogin([], "claude"), "claude")).toContain(
      "Polaris can't tell which Claude login"
    );
    expect(loginWarning("commenter", max, "claude")).toBeNull();
  });

  test("the sheet names the session's own Harness login", () => {
    expect(shareConsequences("@alex", "contributor", "codex")[1]).toBe(
      "@alex can send turns and answer approvals. @alex's turns run on your ChatGPT login and count against your plan."
    );
  });
});
