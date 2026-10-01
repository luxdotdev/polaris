/**
 * The branch, default branch and remote an accept commits and pushes to.
 * Reads only; nothing here changes the repository.
 */
import { gitText, runGitRaw } from "../git/git.ts";
import { listRemotes } from "../git/review/remotes.ts";

const decoder = new TextDecoder();

const text = async (root: string, args: ReadonlyArray<string>): Promise<string | null> => {
  const result = await runGitRaw(root, args);
  const out = decoder.decode(result.stdout).trim();

  return result.code === 0 && out !== "" ? out : null;
};

/** The branch checked out, or null when HEAD is detached. */
export const currentBranch = (root: string): Promise<string | null> =>
  text(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

export interface Remote {
  readonly name: string;
  readonly url: string;
}

/** The branch's configured remote, else `origin`, else the only remote; null when there is none. */
export const pushRemote = async (root: string, branch: string | null): Promise<Remote | null> => {
  const remotes = await listRemotes(root);

  const configured =
    branch === null ? null : await text(root, ["config", `branch.${branch}.remote`]);

  const chosen =
    remotes.find((r) => r.name === configured) ??
    remotes.find((r) => r.name === "origin") ??
    (remotes.length === 1 ? remotes[0] : undefined);

  if (chosen === undefined) return null;

  // `get-url` applies `insteadOf`; the configured URL names the code host.
  return { name: chosen.name, url: chosen.url };
};

/** The remote's default branch from `refs/remotes/<remote>/HEAD`, else `main` or `master` if present. */
export const defaultBranch = async (
  root: string,
  remote: string | null
): Promise<string | null> => {
  if (remote !== null) {
    const head = await text(root, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
    const prefix = `refs/remotes/${remote}/`;

    if (head?.startsWith(prefix) === true) return head.slice(prefix.length);
  }

  for (const name of ["main", "master"]) {
    const local = await runGitRaw(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);

    if (local.code === 0) return name;
  }

  return null;
};

/** Whether git accepts `name` as a branch name. */
export const validBranchName = async (root: string, name: string): Promise<boolean> =>
  name.trim() !== "" &&
  (await runGitRaw(root, ["check-ref-format", "--branch", name])).code === 0 &&
  !name.startsWith("-");

export const branchExists = async (root: string, name: string): Promise<boolean> =>
  (await runGitRaw(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;

/** Lines added and removed, and files changed, from `from` to `to`. */
export const diffStat = async (root: string, from: string, to: string) => {
  const out = await gitText(root, ["diff", "--numstat", "-z", "--no-renames", from, to, "--"]);
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const record of out.split("\0")) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(record);

    if (match === null) continue;
    files += 1;
    additions += match[1] === "-" ? 0 : Number(match[1]);
    deletions += match[2] === "-" ? 0 : Number(match[2]);
  }

  return { files, additions, deletions };
};
