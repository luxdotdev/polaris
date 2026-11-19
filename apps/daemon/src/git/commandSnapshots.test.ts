import { expect, test } from "bun:test";
import { CommandSnapshots } from "./commandSnapshots.ts";
import type { TreeSnapshot } from "./snapshot.ts";

test("past the most snapshots that may wait on one worktree, a command goes without one", async () => {
  const asked: Array<PromiseWithResolvers<TreeSnapshot | null>> = [];

  const snapshots = new CommandSnapshots({
    budgetMs: 60_000,
    maxPending: 2,
    snapshot: () => {
      const taking = Promise.withResolvers<TreeSnapshot | null>();
      asked.push(taking);

      return taking.promise;
    },
  });

  const scope = { cwd: "/repo", sessionId: "s1", turnId: "t1" };
  const held = [snapshots.started("c1", scope), snapshots.started("c2", scope)];

  // The third isn't held, and asks for nothing.
  await snapshots.started("c3", scope);

  expect(asked.length).toBe(2);
  expect(snapshots.isPrecise("c3")).toBe(false);

  for (const taking of asked) taking.resolve({ root: "/repo", tree: "a".repeat(40), ms: 1 });
  await Promise.all(held);

  // Room again once they settled.
  void snapshots.started("c4", scope);

  expect(asked.length).toBe(3);
});
