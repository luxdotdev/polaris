import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { shortTemp } from "../../platform/testing.ts";
import { workerRepoPath } from "./rpc.ts";

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const graph = { hostId: "host-owner", workspaceId: "workspace-1" };

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("a worker repository prepared at the older two-hash path is still used", async () => {
  const root = mkdtempSync(shortTemp("c1rp-"));
  roots.push(root);
  const legacy = join(root, "constellation", "repos", sha(graph.hostId), sha(graph.workspaceId));
  mkdirSync(legacy, { recursive: true });

  expect(await workerRepoPath(root, graph)).toBe(legacy);
});

test("a new worker repository leaves its worktrees' git dirs room under Windows' 220", async () => {
  const root = mkdtempSync(shortTemp("c1rp-"));
  roots.push(root);
  const path = await workerRepoPath(root, graph);
  const other = await workerRepoPath(root, { ...graph, workspaceId: "workspace-2" });

  expect(path).not.toBe(other);
  // C:\Users\<name>\.polaris\ is about 30 characters; a worktree's git dir adds .git\worktrees\<task>.
  expect(path.length - root.length).toBeLessThan(60);
});
