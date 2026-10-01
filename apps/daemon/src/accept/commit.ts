/**
 * Committing accepted Turns (ENG-224): each Turn's own change (its before- to
 * after-checkpoint) is applied to a scratch index built from HEAD and committed
 * with the user's `git commit`, so their identity, signing and hooks apply. The
 * working tree is never touched: later Turns and the user's own edits stay
 * uncommitted. Committed Turns are marked under `refs/polaris/committed/`.
 */
import type { TurnId } from "@polaris/protocol";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommandError, gitText, resolveHead, runGit, runGitRaw } from "../git/git.ts";

export const COMMITTED_PREFIX = "refs/polaris/committed/";

export const committedRef = (sessionId: string, turnId: string): string =>
  `${COMMITTED_PREFIX}${sessionId}/${turnId}`;

/** A Turn with the commits its checkpoint refs point at. */
export interface CheckpointedTurn {
  readonly turnId: TurnId;
  readonly index: number;
  readonly before: string;
  readonly after: string;
}

/** The Turn ids of this session already committed. */
export const committedTurnIds = async (
  root: string,
  sessionId: string
): Promise<ReadonlySet<string>> => {
  const out = await gitText(root, [
    "for-each-ref",
    "--format=%(refname)",
    `${COMMITTED_PREFIX}${sessionId}/`,
  ]);

  return new Set(
    out
      .split("\n")
      .filter((line) => line !== "")
      .map((ref) => ref.slice(`${COMMITTED_PREFIX}${sessionId}/`.length))
  );
};

/** Why the change could not be committed, in words for the user. */
export class CommitRefused extends Error {}

export interface CommitGroup {
  readonly turns: ReadonlyArray<CheckpointedTurn>;
  /** The full commit message. */
  readonly message: string;
}

export interface CommitOptions {
  readonly root: string;
  readonly sessionId: string;
  /** Applied in order; each group becomes one commit (skipped when it changes nothing). */
  readonly groups: ReadonlyArray<CommitGroup>;
  /** Create this branch from HEAD and check it out in place first; null commits to the current one. */
  readonly createBranch: string | null;
}

const changedPaths = async (root: string, from: string, to: string) =>
  (await gitText(root, ["diff", "--name-only", "-z", "--no-renames", from, to, "--"]))
    .split("\0")
    .filter((path) => path !== "");

const decoder = new TextDecoder();

/** Sets the scratch index's entry for `path` to what `commit` has there, or removes it. */
const takeWhole = async (
  root: string,
  env: Record<string, string>,
  commit: string,
  path: string
) => {
  const entry = decoder
    .decode((await runGit(root, ["ls-tree", "-z", commit, "--", path])).stdout)
    .replace(/\0$/, "");

  const match = /^(\d+) blob ([0-9a-f]+)\t/.exec(entry);

  if (match === null) {
    await runGit(root, ["update-index", "--force-remove", "--", path], { env });

    return;
  }

  await runGit(root, ["update-index", "--index-info"], {
    env,
    stdin: `${match[1]} ${match[2]}\t${path}\n`,
  });
};

/**
 * Applies one Turn's change to the scratch index, file by file: a three-way patch keeps
 * the user's own uncommitted edits out; a file the patch can't apply to (one HEAD doesn't
 * have, or edits overlapping the user's) is taken whole, as the Turn left it.
 */
const applyTurn = async (root: string, env: Record<string, string>, turn: CheckpointedTurn) => {
  for (const path of await changedPaths(root, turn.before, turn.after)) {
    const patch = (
      await runGit(root, [
        "diff",
        "--binary",
        "--full-index",
        "--no-renames",
        turn.before,
        turn.after,
        "--",
        path,
      ])
    ).stdout;

    const applied = await runGitRaw(root, ["apply", "--cached", "--3way", "--whitespace=nowarn"], {
      env,
      stdin: patch,
    });

    if (applied.code !== 0) await takeWhole(root, env, turn.after, path);
  }
};

const switchToNewBranch = async (root: string, name: string, head: string | null) => {
  if (head === null) {
    await gitText(root, ["symbolic-ref", "HEAD", `refs/heads/${name}`]);

    return;
  }

  await gitText(root, ["update-ref", `refs/heads/${name}`, head, ""]);
  await gitText(root, ["symbolic-ref", "HEAD", `refs/heads/${name}`]);
};

const commitGroup = async (
  root: string,
  env: Record<string, string>,
  group: CommitGroup
): Promise<string | null> => {
  for (const turn of group.turns) await applyTurn(root, env, turn);
  const tree = await gitText(root, ["write-tree"], { env });
  const head = await resolveHead(root);
  const headTree = head === null ? null : await gitText(root, ["rev-parse", `${head}^{tree}`]);

  if (tree === headTree) return null;

  const committed = await runGitRaw(root, ["commit", "-q", "--cleanup=strip", "-F", "-"], {
    env,
    stdin: group.message,
  });

  if (committed.code !== 0) {
    throw new CommitRefused(`git commit failed: ${committed.stderr.trim()}`);
  }

  return gitText(root, ["rev-parse", "HEAD"]);
};

/** What HEAD names now: `refs/heads/<branch>`, or the commit when detached. */
const currentRef = async (root: string): Promise<string | null> => {
  const symbolic = await runGitRaw(root, ["symbolic-ref", "--quiet", "HEAD"]);

  return symbolic.code === 0 ? new TextDecoder().decode(symbolic.stdout).trim() : resolveHead(root);
};

/** Back to where HEAD was, and the new, still empty branch removed. */
const abandonBranch = async (root: string, name: string, previous: string) => {
  if (previous.startsWith("refs/")) await gitText(root, ["symbolic-ref", "HEAD", previous]);
  else await gitText(root, ["update-ref", "--no-deref", "HEAD", previous]);
  await runGitRaw(root, ["update-ref", "-d", `refs/heads/${name}`]);
};

/** Commits the groups; answers the new commits, oldest first. */
export const commitTurns = async (options: CommitOptions): Promise<ReadonlyArray<string>> => {
  const { root, sessionId } = options;
  const head = await resolveHead(root);
  const index = join(tmpdir(), `polaris-accept-${process.pid}-${Date.now()}.index`);
  const env = { GIT_INDEX_FILE: index };
  const touched = new Set<string>();
  const commits: Array<string> = [];
  const previous = options.createBranch === null ? null : await currentRef(root);

  try {
    await gitText(root, head === null ? ["read-tree", "--empty"] : ["read-tree", head], { env });

    if (options.createBranch !== null) await switchToNewBranch(root, options.createBranch, head);

    for (const group of options.groups) {
      const commit = await commitGroup(root, env, group);

      if (commit !== null) commits.push(commit);

      for (const turn of group.turns) {
        for (const path of await changedPaths(root, turn.before, turn.after)) touched.add(path);
        await gitText(root, ["update-ref", committedRef(sessionId, turn.turnId), turn.after]);
      }
    }

    return commits;
  } catch (error) {
    if (options.createBranch !== null && previous !== null && commits.length === 0) {
      await abandonBranch(root, options.createBranch, previous);
    }

    throw error;
  } finally {
    rmSync(index, { force: true });
    await syncIndex(root, [...touched]);
  }
};

/** Brings the real index's entries for `paths` to HEAD, so they don't show as staged reversals. */
const syncIndex = async (root: string, paths: ReadonlyArray<string>) => {
  if (paths.length === 0 || (await resolveHead(root)) === null) return;

  const result = await runGitRaw(
    root,
    ["reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", "HEAD"],
    { stdin: paths.join("\0") }
  );

  // `reset` exits 1 when entries remain different from the working tree; that's expected.
  if (result.code > 1) {
    throw new GitCommandError(root, ["reset", "HEAD"], result.code, result.stderr);
  }
};
