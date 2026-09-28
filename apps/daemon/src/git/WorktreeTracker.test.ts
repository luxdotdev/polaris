import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber, Stream } from "effect";
import { type WorktreeInfo, WorktreeTracker } from "../services.ts";
import { gitText, runGitRaw } from "./git.ts";
import { commitAll, makeRepo, removeDir, tempDir, write } from "./testing.ts";
import { parseWorktreeList, WorktreeTrackerLive } from "./WorktreeTracker.ts";

const cleanup: Array<string> = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const run = <A, E>(effect: Effect.Effect<A, E, WorktreeTracker>) =>
  Effect.runPromise(effect.pipe(Effect.provide(WorktreeTrackerLive)));

const withTracker = <A, E>(f: (t: WorktreeTracker["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* f(yield* WorktreeTracker);
  });

const branchExists = async (root: string, branch: string) =>
  (await runGitRaw(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

describe("WorktreeTracker", () => {
  test("parses porcelain output with detached and locked worktrees", () => {
    const out = [
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /elsewhere/wt",
      "HEAD bbb",
      "detached",
      "locked",
      "",
      "",
    ].join("\0");
    expect(parseWorktreeList(out)).toEqual([
      { path: "/repo", head: "aaa", branch: "main", isMain: true },
      { path: "/elsewhere/wt", head: "bbb", branch: null, isMain: false },
    ]);
  });

  test("create adds a new branch from baseRef; remove keeps the branch", async () => {
    const root = await makeRepo();
    const outside = tempDir("polaris-wt-");
    cleanup.push(root, outside);
    const path = join(outside, "project-wt", "feature");

    const created = await run(
      Effect.gen(function* () {
        const tracker = yield* WorktreeTracker;
        return yield* tracker.create({ repoPath: root, path, branch: "feature", baseRef: "main" });
      })
    );
    expect(created).toMatchObject({ path, branch: "feature", isMain: false });
    expect(existsSync(join(path, "README.md"))).toBe(true);

    const list = await run(withTracker((t) => t.list(root)));
    expect(list.map((w) => w.branch)).toEqual(["main", "feature"]);

    await run(withTracker((t) => t.remove({ repoPath: root, path, deleteBranchIfMerged: false })));
    expect(existsSync(path)).toBe(false);
    expect(await branchExists(root, "feature")).toBe(true);
  });

  test("remove deletes a merged branch only when asked, and never an unmerged one", async () => {
    const root = await makeRepo();
    const outside = tempDir("polaris-wt-");
    cleanup.push(root, outside);
    const tracker = (f: (t: WorktreeTracker["Service"]) => Effect.Effect<unknown, unknown>) =>
      run(withTracker(f));

    // Merged (no new commits): deleted when deleteBranchIfMerged.
    const merged = join(outside, "merged");
    await tracker((t) =>
      t.create({ repoPath: root, path: merged, branch: "merged", baseRef: null })
    );
    await tracker((t) => t.remove({ repoPath: root, path: merged, deleteBranchIfMerged: true }));
    expect(await branchExists(root, "merged")).toBe(false);

    // Unmerged (a commit only on the branch): kept even when deleteBranchIfMerged.
    const unmerged = join(outside, "unmerged");
    await tracker((t) =>
      t.create({ repoPath: root, path: unmerged, branch: "unmerged", baseRef: null })
    );
    write(unmerged, "work.txt", "work\n");
    await commitAll(unmerged, "work");
    await tracker((t) => t.remove({ repoPath: root, path: unmerged, deleteBranchIfMerged: true }));
    expect(existsSync(unmerged)).toBe(false);
    expect(await branchExists(root, "unmerged")).toBe(true);
  });

  test("watch detects a worktree created and removed outside Polaris", async () => {
    const root = await makeRepo();
    const outside = tempDir("polaris-wt-");
    cleanup.push(root, outside);
    const external = join(outside, "external");

    const seen: Array<ReadonlyArray<WorktreeInfo>> = [];
    const waitFor = async (predicate: (list: ReadonlyArray<WorktreeInfo>) => boolean) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (seen.some(predicate)) return;
        await Bun.sleep(25);
      }
      throw new Error(`timed out; saw ${JSON.stringify(seen)}`);
    };

    const fiber = Effect.runFork(
      withTracker((t) =>
        t.watch(root).pipe(Stream.runForEach((list) => Effect.sync(() => seen.push(list))))
      ).pipe(Effect.provide(WorktreeTrackerLive))
    );
    try {
      await waitFor((list) => list.length === 1);
      // Created by the user's own git, not through the tracker.
      await gitText(root, ["worktree", "add", "-q", "-b", "ext", external]);
      await waitFor((list) => list.some((w) => w.branch === "ext"));
      await gitText(root, ["worktree", "remove", external]);
      const count = seen.length;
      await waitFor((list) => seen.indexOf(list) >= count && list.length === 1);
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  });
});
