import { describe, expect, test } from "bun:test";
import type { DraftGroup } from "./group.ts";
import { needsUser } from "./controller.ts";

const group = (
  state: DraftGroup["state"],
  touched: readonly string[]
): Pick<DraftGroup, "state" | "touched"> => ({ state, touched });

describe("recovery UI shows only when it needs the user", () => {
  test("a one-file change applied or restored shows nothing; ⌘Z undoes it", () => {
    expect(needsUser(group("applied", ["/a.ts"]))).toBe(false);
    expect(needsUser(group("restored", ["/a.ts", "/b.ts"]))).toBe(false);
    expect(needsUser(group("prepared", ["/a.ts"]))).toBe(false);
  });

  test("unknown, partial and conflicting outcomes, and multi-file undo, need the user", () => {
    expect(needsUser(group("unknown", ["/a.ts"]))).toBe(true);
    expect(needsUser(group("partial", ["/a.ts"]))).toBe(true);
    expect(needsUser(group("conflict", ["/a.ts"]))).toBe(true);
    expect(needsUser(group("applied", ["/a.ts", "/b.ts"]))).toBe(true);
  });
});
