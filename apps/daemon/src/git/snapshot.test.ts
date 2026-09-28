import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { snapshotWorkingTree } from "./snapshot.ts"

const dirs: Array<string> = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const git = (cwd: string, ...args: Array<string>) => {
  const r = Bun.spawnSync(["git", ...args], { cwd })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  return r.stdout.toString().trim()
}

test("a same-size edit in the same second as the last index write is still captured", async () => {
  const repo = mkdtempSync(join(tmpdir(), "polaris-racy-"))
  dirs.push(repo)
  git(repo, "init", "-q")
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "t")
  const file = join(repo, "a.txt")

  // Start just after a second boundary so the commit and the edit share a second:
  // git then can only tell the file changed through its racy-clean check.
  await Bun.sleep(1000 - (Date.now() % 1000) + 5)
  writeFileSync(file, "one\n")
  git(repo, "add", "a.txt")
  git(repo, "commit", "-qm", "init")
  writeFileSync(file, "two\n")
  // The snapshot itself runs a second later, as it does under load.
  await Bun.sleep(1100)

  const snapshot = await snapshotWorkingTree(repo)
  expect(snapshot?.tree).not.toBe(git(repo, "rev-parse", "HEAD^{tree}"))
})

const makeRepo = (files: Record<string, string>) => {
  const repo = mkdtempSync(join(tmpdir(), "polaris-snap-"))
  dirs.push(repo)
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "t")
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content)
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  return repo
}

const filesOf = (repo: string, tree: string) =>
  git(repo, "ls-tree", "-r", "--name-only", tree).split("\n").filter(Boolean).sort()

const ownIndex = (repo: string) => join(repo, ".git", "polaris", "index")

test("keeps its own index between snapshots and never writes the user's", async () => {
  const repo = makeRepo({ "a.txt": "a\n", ".gitignore": "*.log\n" })
  const userIndex = readFileSync(join(repo, ".git", "index"))
  const first = await snapshotWorkingTree(repo)
  expect(existsSync(ownIndex(repo))).toBe(true)
  expect(first?.tree).toBe(git(repo, "rev-parse", "HEAD^{tree}"))

  writeFileSync(join(repo, "a.txt"), "changed\n")
  writeFileSync(join(repo, "new.txt"), "new\n")
  writeFileSync(join(repo, "noise.log"), "ignored\n")
  const second = await snapshotWorkingTree(repo)
  expect(filesOf(repo, second!.tree)).toEqual([".gitignore", "a.txt", "new.txt"])
  expect(git(repo, "show", `${second!.tree}:a.txt`)).toBe("changed")

  rmSync(join(repo, "new.txt"))
  const third = await snapshotWorkingTree(repo)
  expect(filesOf(repo, third!.tree)).toEqual([".gitignore", "a.txt"])
  expect(readFileSync(join(repo, ".git", "index")).equals(userIndex)).toBe(true)
  expect(git(repo, "status", "--porcelain")).toBe("M a.txt")
})

test("a same-size edit in the same second as its own index's last write is still captured", async () => {
  const repo = makeRepo({ "a.txt": "zero\n" })
  await Bun.sleep(1000 - (Date.now() % 1000) + 5)
  writeFileSync(join(repo, "a.txt"), "one\n")
  const first = await snapshotWorkingTree(repo)
  writeFileSync(join(repo, "a.txt"), "two\n")
  await Bun.sleep(1100)
  const second = await snapshotWorkingTree(repo)
  expect(git(repo, "show", `${first!.tree}:a.txt`)).toBe("one")
  expect(git(repo, "show", `${second!.tree}:a.txt`)).toBe("two")
})

test("follows the user's index for which ignored files are tracked", async () => {
  const repo = makeRepo({ "a.txt": "a\n", ".gitignore": "*.log\n" })
  writeFileSync(join(repo, "kept.log"), "forced\n")
  expect(filesOf(repo, (await snapshotWorkingTree(repo))!.tree)).not.toContain("kept.log")
  git(repo, "add", "-f", "kept.log")
  expect(filesOf(repo, (await snapshotWorkingTree(repo))!.tree)).toContain("kept.log")
  git(repo, "rm", "-q", "--cached", "kept.log")
  expect(filesOf(repo, (await snapshotWorkingTree(repo))!.tree)).not.toContain("kept.log")
})

test("a corrupt own index falls back to a fresh copy and is rebuilt", async () => {
  const repo = makeRepo({ "a.txt": "a\n" })
  await snapshotWorkingTree(repo)
  writeFileSync(ownIndex(repo), "not an index")
  writeFileSync(join(repo, "b.txt"), "b\n")
  const snapshot = await snapshotWorkingTree(repo)
  expect(filesOf(repo, snapshot!.tree)).toEqual(["a.txt", "b.txt"])
  const again = await snapshotWorkingTree(repo)
  expect(again!.tree).toBe(snapshot!.tree)
  expect(readFileSync(ownIndex(repo)).subarray(0, 4).toString()).toBe("DIRC")
})

test("each worktree has its own index", async () => {
  const repo = makeRepo({ "a.txt": "a\n" })
  const other = mkdtempSync(join(tmpdir(), "polaris-wt-"))
  dirs.push(other)
  rmSync(other, { recursive: true })
  git(repo, "worktree", "add", "-q", "-b", "side", other)
  writeFileSync(join(other, "side.txt"), "side\n")
  const main = await snapshotWorkingTree(repo)
  const side = await snapshotWorkingTree(other)
  expect(filesOf(repo, main!.tree)).toEqual(["a.txt"])
  expect(filesOf(repo, side!.tree)).toEqual(["a.txt", "side.txt"])
  const sideIndex = join(repo, ".git", "worktrees", basename(other), "polaris", "index")
  expect(existsSync(sideIndex)).toBe(true)
})

test("concurrent snapshots of one repository agree", async () => {
  const repo = makeRepo({ "a.txt": "a\n" })
  writeFileSync(join(repo, "b.txt"), "b\n")
  const trees = await Promise.all([1, 2, 3, 4].map(() => snapshotWorkingTree(repo)))
  expect(new Set(trees.map((s) => s!.tree)).size).toBe(1)
})
