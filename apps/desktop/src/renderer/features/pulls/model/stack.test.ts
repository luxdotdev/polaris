import { describe, expect, test } from "bun:test";
import type { StackView } from "../../../../shared/github.ts";
import { checksText, layerText, shortBranch, stackTitle, topDown } from "./stack.ts";

const stack = (patch: Partial<StackView> = {}): StackView => ({
  source: "github",
  number: 635,
  trunk: "nightly",
  position: 2,
  size: 3,
  members: [1, 2, 3].map((n) => ({
    id: `PR_${n}`,
    number: n,
    title: `Layer ${n}`,
    url: "",
    headRefName: `layer/${n}`,
    status: "open",
    additions: n,
    deletions: 0,
    checks: null,
  })),
  ...patch,
});

describe("the stack's words", () => {
  test("branches cut after 20 characters", () => {
    expect(shortBranch("abrahamrubio/eng-1845-admin-impersonation")).toBe("abrahamrubio/eng-184…");
    expect(shortBranch("main")).toBe("main");
    // One character over isn't worth an ellipsis.
    expect(shortBranch("a".repeat(21))).toBe("a".repeat(21));
  });

  test("checks, layer and title", () => {
    expect(checksText({ state: "success", total: 4 })).toBe("4 checks");
    expect(checksText({ state: "failure", total: 1 })).toBe("1 check failing");
    expect(checksText({ state: "pending", total: 10 })).toBe("10 checks running");
    expect(checksText(null)).toBeNull();
    expect(layerText(stack())).toBe("2/3");
    expect(stackTitle(stack())).toBe("Stack #635");
    expect(stackTitle(stack({ number: null, source: "inferred" }))).toBe("Stack from branch names");
    expect(topDown(stack()).map((m) => m.number)).toEqual([3, 2, 1]);
  });
});
