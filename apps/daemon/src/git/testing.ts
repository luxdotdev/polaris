/** Test helpers: throwaway git repositories. Not used at runtime. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { gitText } from "./git.ts"

export const tempDir = (prefix = "polaris-test-"): string =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)))

export const removeDir = (path: string): void => rmSync(path, { recursive: true, force: true })

export const write = (root: string, path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

/** A repository with an identity set and one commit containing `files`. */
export const makeRepo = async (files: Record<string, string> = { "README.md": "hello\n" }) => {
  const root = tempDir("polaris-repo-")
  await gitText(root, ["init", "-q", "-b", "main"])
  await gitText(root, ["config", "user.name", "Test"])
  await gitText(root, ["config", "user.email", "test@example.com"])
  await gitText(root, ["config", "commit.gpgsign", "false"])
  for (const [path, content] of Object.entries(files)) write(root, path, content)
  if (Object.keys(files).length > 0) {
    await gitText(root, ["add", "-A"])
    await gitText(root, ["commit", "-q", "-m", "initial"])
  }
  return root
}

export const commitAll = async (root: string, message: string): Promise<string> => {
  await gitText(root, ["add", "-A"])
  await gitText(root, ["commit", "-q", "-m", message])
  return gitText(root, ["rev-parse", "HEAD"])
}
