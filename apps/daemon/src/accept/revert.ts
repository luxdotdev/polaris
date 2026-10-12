/**
 * Undoing the Turns after an accepted one (`AcceptTurns` with `revertLaterTurns`):
 * every file a later Turn changed goes back to the accepted Turn's
 * after-checkpoint; files only later Turns created are deleted. Other files,
 * and the index, are left alone.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { gitText, runGitRaw } from "../git/git.ts";

export interface LaterTurn {
  readonly before: string;
  readonly after: string;
}

export const splitPaths = (out: string) => out.split("\0").filter((path) => path !== "");

/** The files `later` changed, relative to `root`. */
export const changedPaths = async (
  root: string,
  later: ReadonlyArray<LaterTurn>
): Promise<ReadonlySet<string>> => {
  const paths = new Set<string>();

  for (const turn of later) {
    const out = await gitText(root, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      turn.before,
      turn.after,
      "--",
    ]);

    for (const path of splitPaths(out)) paths.add(path);
  }

  return paths;
};

/** Restores the files `later` changed to `target` (a commit); answers the paths touched. */
export const revertLaterTurns = async (
  root: string,
  target: string,
  later: ReadonlyArray<LaterTurn>
): Promise<ReadonlyArray<string>> => {
  const paths = await changedPaths(root, later);

  if (paths.size === 0) return [];
  const all = [...paths];
  const present = await filesIn(root, target, all);

  const restore = all.filter((path) => present.has(path));

  if (restore.length > 0) {
    await gitText(
      root,
      [
        "restore",
        `--source=${target}`,
        "--worktree",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      { stdin: restore.join("\0") }
    );
  }

  for (const path of all) {
    if (!present.has(path)) rmSync(join(root, path), { force: true });
  }

  return all;
};

/** Which of `paths` exist in `target`'s tree. */
const filesIn = async (root: string, target: string, paths: ReadonlyArray<string>) => {
  const result = await runGitRaw(root, ["ls-tree", "-r", "-z", "--name-only", target]);
  const wanted = new Set(paths);

  return new Set(
    splitPaths(new TextDecoder().decode(result.stdout)).filter((path) => wanted.has(path))
  );
};
