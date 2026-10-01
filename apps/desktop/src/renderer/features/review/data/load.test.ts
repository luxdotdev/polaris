import { describe, expect, test } from "bun:test";
import type { GitDiffSpec } from "@polaris/protocol";
import { Data } from "effect";
import type { DiffSource } from "./source.ts";
import { type Fetched, failureOf, loadReviewDiff, type ReviewDiff } from "./load.ts";

const Specs = Data.taggedEnum<GitDiffSpec>();

const SOURCE: DiffSource = { hostKey: "local", cwd: "/repo", sections: [], key: "k" };

const fetched = (): ReadonlyArray<Fetched> => [
  {
    section: {
      id: "t1",
      divider: null,
      spec: Specs.Range({ base: "a", head: "b" }),
      base: "a",
      next: "b",
    },
    bytes: new TextEncoder().encode("diff --git a/x b/x\n"),
    files: [
      {
        key: "t1:x",
        index: 0,
        section: "t1",
        fingerprint: "f",
        file: {
          path: "x",
          oldPath: null,
          status: "modified",
          offset: 0,
          length: 19,
          additions: 1,
          deletions: 0,
          binary: false,
        },
      },
    ],
  },
];

const run = (deps: Partial<Parameters<typeof loadReviewDiff>[1]>) => {
  const states: Array<ReviewDiff> = [];
  let current: ReviewDiff = { kind: "loading" };

  const load = loadReviewDiff(SOURCE, {
    fetch: () => Promise.resolve(fetched()),
    parse: () => Promise.resolve(),
    live: () => true,
    set: (next) => {
      current = "kind" in next ? next : next(current);
      states.push(current);
    },
    ...deps,
  });

  return { load, states, last: () => current };
};

describe("loadReviewDiff", () => {
  test("a parse that throws rejects, and the view shows it failed instead of a blank pane", async () => {
    const { load, last } = run({
      parse: () => Promise.reject(new Error("hunk line count mismatch")),
    });

    expect(last().kind).toBe("loading");
    expect(
      await load.then(
        () => null,
        (cause: unknown) => cause
      )
    ).toBeInstanceOf(Error);
    expect(last()).toMatchObject({ kind: "ready", complete: false });
    expect(failureOf(new Error("hunk line count mismatch"))).toEqual({
      kind: "failed",
      error: { code: "ReviewDiffFailed", message: "hunk line count mismatch" },
    });
  });

  test("a fetch error is a failed state; a parsed diff completes", async () => {
    const failed = run({
      fetch: () => Promise.resolve({ code: "GitError", message: "bad revision" }),
    });

    await failed.load;
    expect(failed.last()).toEqual({
      kind: "failed",
      error: { code: "GitError", message: "bad revision" },
    });

    const done = run({});

    await done.load;
    expect(done.last()).toMatchObject({ kind: "ready", complete: true, size: 19 });
  });
});
