import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
