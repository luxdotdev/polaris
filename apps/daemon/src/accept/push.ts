/**
 * Pushing an accepted branch with the Host's own git credentials (ssh agent,
 * credential helper): never prompting, since there is no terminal.
 */
import { runGitRaw } from "../git/git.ts";
import { CommitRefused } from "./commit.ts";
import type { Remote } from "./branch.ts";

const PUSH_TIMEOUT_MS = 120_000;

/** `git push -u <remote> <branch>`; fails with git's own words. */
export const pushBranch = async (root: string, remote: Remote, branch: string): Promise<void> => {
  const ref = `refs/heads/${branch}`;

  const result = await runGitRaw(
    root,
    ["push", "--porcelain", "-u", remote.name, `${ref}:${ref}`],
    {
      timeoutMs: PUSH_TIMEOUT_MS,
      env: { GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" },
    }
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || new TextDecoder().decode(result.stdout).trim();

    throw new CommitRefused(`git push to ${remote.name} failed: ${detail}`);
  }
};
