import { describe, expect, test } from "bun:test";
import type { ReviewersView } from "../../../../../shared/githubActions.ts";
import { canAskAgain, candidatesOf, reviewersLabel } from "./reviewers.ts";

const VIEW: ReviewersView = {
  requested: [
    { kind: "user", login: "ada", name: "Ada" },
    { kind: "team", login: "platform", name: "Platform" },
  ],
  reviewed: [{ login: "grace", state: "approved", at: null }],
  suggested: [
    { kind: "user", login: "ada", name: "Ada" },
    { kind: "user", login: "lin", name: "Lin" },
    { kind: "user", login: "ken", name: null },
  ],
  canRequest: true,
  author: "lin",
};

describe("reviewers", () => {
  test("the header's label", () => {
    expect(reviewersLabel(VIEW)).toBe("3 reviewers");
    expect(reviewersLabel({ ...VIEW, requested: [], reviewed: [] })).toBe("Request reviewers");
    expect(reviewersLabel({ ...VIEW, requested: [] })).toBe("grace");
  });

  test("candidates leave out who is asked and the author", () => {
    expect(candidatesOf(VIEW, null).map((r) => r.login)).toEqual(["ken"]);
    expect(
      candidatesOf(VIEW, [
        { kind: "team", login: "platform", name: null },
        { kind: "team", login: "docs", name: null },
      ]).map((r) => r.login)
    ).toEqual(["docs"]);
  });

  test("a reviewer can be asked again unless already asked", () => {
    expect(canAskAgain(VIEW, "grace", "you")).toBe(true);
    expect(canAskAgain(VIEW, "ada", "you")).toBe(false);
    expect(canAskAgain(VIEW, "grace", "grace")).toBe(false);
  });
});
