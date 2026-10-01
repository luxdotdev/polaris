import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { COMMITS_SHOWN, toCompareView } from "./compare.ts";
import { harness, signIn } from "./github.testing.ts";
import { GitHub } from "./index.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

const REPO = { owner: "acme", name: "widgets" };

const headOf = (h: ReturnType<typeof harness>) =>
  h.fake.world.pulls.find((p) => p.repo === "acme/widgets" && p.number === 42)?.headRefOid ?? "";

test("lists the commits a checkout's update brings, newest first", async () => {
  const h = harness();

  harnesses.push(h);

  const before = headOf(h);

  h.fake.pushCommit("acme/widgets", 42, "9e07b3c0", "Rename limit helper");
  h.fake.pushCommit("acme/widgets", 42, "c41d2a10", "Handle zero-member households\n\nAnd tests.");

  const view = await h.run(
    Effect.gen(function* () {
      yield* signIn(h, "mona");

      return yield* (yield* GitHub).compare({ repo: REPO, base: before, head: "c41d2a10" });
    })
  );

  expect(view).toEqual({
    status: "ahead",
    total: 2,
    commits: [
      expect.objectContaining({ oid: "c41d2a10", headline: "Handle zero-member households" }),
      expect.objectContaining({ oid: "9e07b3c0", headline: "Rename limit helper" }),
    ],
  });
});

test("a rewritten branch compares as diverged", async () => {
  const h = harness();

  harnesses.push(h);
  h.fake.pushCommit("acme/widgets", 42, "abcdef12", "Squashed");

  const view = await h.run(
    Effect.gen(function* () {
      yield* signIn(h, "mona");

      return yield* (yield* GitHub).compare({ repo: REPO, base: "0123456f", head: "abcdef12" });
    })
  );

  expect(view.status).toBe("diverged");
});

test("at most COMMITS_SHOWN are listed; the total counts them all", () => {
  const commits = Array.from({ length: 30 }, (_, i) => ({
    sha: `c${i}`,
    commit: { message: `commit ${i}`, committer: null },
  }));

  const view = toCompareView({ status: "ahead", total_commits: 30, commits });

  expect(view.total).toBe(30);
  expect(view.commits).toHaveLength(COMMITS_SHOWN);
  expect(view.commits[0]).toEqual({ oid: "c29", headline: "commit 29", date: null });
});
