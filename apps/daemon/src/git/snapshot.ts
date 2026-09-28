/**
 * Working-tree snapshots through a temporary index.
 *
 * Design follows pingdotgg/t3code@de251fc (MIT): point `GIT_INDEX_FILE` at a
 * throwaway index, `git add -A`, `git write-tree`. The user's index, HEAD and
 * branch are never written. No code was copied.
 */
import { existsSync } from "node:fs"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRepoRoot, gitText, resolveHead } from "./git.ts"

export interface Snapshot {
  /** The repository top level the snapshot was taken from. */
  readonly root: string
  /** Tree of the working tree: tracked and untracked files, minus ignored ones. */
  readonly tree: string
  /** HEAD at the time of the snapshot; null on an unborn branch. */
  readonly head: string | null
}

/**
 * Snapshots the working tree of the repository containing `cwd`. Returns null
 * outside git repositories.
 *
 * The user's index is copied (never modified) into the temporary one first so
 * that git's stat cache lets `add -A` rehash only files that changed, which
 * keeps this cheap on large repositories.
 */
export const snapshotWorkingTree = async (cwd: string): Promise<Snapshot | null> => {
  const root = await findRepoRoot(cwd)
  if (root === null) return null
  const head = await resolveHead(root)
  const dir = await mkdtemp(join(tmpdir(), "polaris-index-"))
  try {
    const index = join(dir, "index")
    const userIndex = await gitText(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
    if (existsSync(userIndex)) await copyFile(userIndex, index)
    const env = { GIT_INDEX_FILE: index }
    await gitText(root, ["add", "-A"], { env })
    const tree = await gitText(root, ["write-tree"], { env })
    return { root, tree, head }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
