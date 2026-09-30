import { describe, expect, test } from "bun:test";
import { counts, retryDelay } from "./watch.ts";

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

test("a failed watch retries with backoff, capped", () => {
  expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
});
