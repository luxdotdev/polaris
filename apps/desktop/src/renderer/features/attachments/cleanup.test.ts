import { describe, expect, test } from "bun:test";
import {
  amountLine,
  type CleanupSettings,
  policyChoices,
  policyKey,
  policyLabel,
  policyOf,
  withDefault,
  withWorkspace,
} from "./cleanup.ts";

const settings: CleanupSettings = {
  default: { kind: "on-archive" },
  workspaces: { ws1: { kind: "never" } },
};

describe("attachment cleanup", () => {
  test("policies round-trip through their select keys", () => {
    for (const p of policyChoices({ kind: "on-archive" }))
      expect(policyOf(policyKey(p))).toEqual(p);
    expect(policyOf("after-days:0")).toBeNull();
    expect(policyOf("sometimes")).toBeNull();
  });

  test("labels read plainly", () => {
    expect(policyLabel({ kind: "on-archive" })).toBe("When the session is archived");
    expect(policyLabel({ kind: "after-days", days: 1 })).toBe("After 1 day");
    expect(policyLabel({ kind: "after-days", days: 30 })).toBe("After 30 days");
    expect(policyLabel({ kind: "never" })).toBe("Never, until cleared");
  });

  test("an unusual day count in effect stays in the list, in order", () => {
    const keys = policyChoices({ kind: "after-days", days: 14 }).map(policyKey);

    expect(keys).toEqual([
      "on-archive",
      "after-days:1",
      "after-days:7",
      "after-days:14",
      "after-days:30",
      "after-days:90",
      "never",
    ]);
  });

  test("the default and a Workspace override change independently", () => {
    const next = withDefault(settings, { kind: "after-days", days: 7 });

    expect(next.default).toEqual({ kind: "after-days", days: 7 });
    expect(next.workspaces).toEqual(settings.workspaces);

    const overridden = withWorkspace(next, "ws2", { kind: "after-days", days: 1 });

    expect(overridden.workspaces).toEqual({
      ws1: { kind: "never" },
      ws2: { kind: "after-days", days: 1 },
    });
    expect(withWorkspace(overridden, "ws1", null).workspaces).toEqual({
      ws2: { kind: "after-days", days: 1 },
    });
  });

  test("amounts read as size and files", () => {
    expect(amountLine(undefined)).toBe("Nothing staged");
    expect(amountLine({ bytes: 0, files: 0 })).toBe("Nothing staged");
    expect(amountLine({ bytes: 1536, files: 1 })).toBe("1.5 KB in 1 file");
    expect(amountLine({ bytes: 3 * 1024 * 1024, files: 4 })).toBe("3.0 MB in 4 files");
  });
});
