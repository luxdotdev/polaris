import { describe, expect, test } from "bun:test";
import { counts } from "./watch.ts";

describe("files.watch filter", () => {
  test("work tree edits count", () => {
    expect(counts("/repo/src/main.ts")).toBe(true);
    expect(counts("/repo/.gitignore")).toBe(true);
  });

  test("git's own writes don't, except HEAD's reflog", () => {
    expect(counts("/repo/.git/index")).toBe(false);
    expect(counts("/repo/.git/objects/ab/cdef")).toBe(false);
    expect(counts("/repo/.git/logs/HEAD")).toBe(true);
  });
});
