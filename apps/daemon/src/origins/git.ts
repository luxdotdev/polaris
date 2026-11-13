/**
 * The git Origins reads (ADR 0111): the repository's key, what a Turn's checkpoints show it
 * wrote, and what a commit added. Read-only, under the safe config.
 */
import { checkpointRef } from "../git/checkpointRefs.ts";
import { GitOutputTooLarge, gitText, resolveCommit, resolveHead, runGit } from "../git/git.ts";
import { type AddedLine, parseAddedLines } from "./addedLines.ts";

const TIMEOUT_MS = 60_000;

/** A Turn or commit whose diff passes this is a generated or vendored dump: it is not indexed. */
const MAX_DIFF_BYTES = 32 * 1024 * 1024;

const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "-U0",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

const decoder = new TextDecoder();

/** A full or abbreviated commit id; anything else could reach git as an option. */
export const OBJECT_ID = /^[0-9a-f]{4,64}$/i;

/**
 * The repository across Hosts: its oldest root commit reachable from HEAD (by committer time,
 * then SHA, so every clone agrees). Null on an unborn branch.
 */
export const findRepoKey = async (cwd: string): Promise<string | null> => {
  if ((await resolveHead(cwd)) === null) return null;

  const out = await gitText(cwd, ["log", "--max-parents=0", "--format=%ct %H", "HEAD", "--"], {
    timeoutMs: TIMEOUT_MS,
  });

  const roots = out
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => ({
      at: Number(row.slice(0, row.indexOf(" "))),
      sha: row.slice(row.indexOf(" ") + 1),
    }))
    .sort((a, b) => a.at - b.at || a.sha.localeCompare(b.sha));

  return roots[0]?.sha ?? null;
};

/** `git diff` output, or null when it is too large to index. */
const diffText = async (cwd: string, args: ReadonlyArray<string>): Promise<string | null> => {
  try {
    const { stdout } = await runGit(cwd, args, {
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: MAX_DIFF_BYTES,
    });

    return decoder.decode(stdout);
  } catch (error) {
    if (error instanceof GitOutputTooLarge) return null;
    throw error;
  }
};

/** What a Turn added between its before and after checkpoints; null when either is gone. */
export const turnAddedLines = async (
  cwd: string,
  sessionId: string,
  turnId: string
): Promise<ReadonlyArray<AddedLine> | null> => {
  const before = await resolveCommit(cwd, checkpointRef(sessionId, turnId, "before"));
  const after = await resolveCommit(cwd, checkpointRef(sessionId, turnId, "after"));

  if (before === null || after === null) return null;
  const diff = await diffText(cwd, ["diff", ...DIFF_FLAGS, before, after, "--"]);

  return diff === null ? [] : parseAddedLines(diff);
};

export interface CommitLines {
  /** Committer time, epoch ms. */
  readonly time: number;
  readonly added: ReadonlyArray<AddedLine>;
}

/** What commit `sha` added against its first parent (everything, for a root commit). */
export const commitAddedLines = async (cwd: string, sha: string): Promise<CommitLines> => {
  if (!OBJECT_ID.test(sha)) throw new Error(`${sha} is not a commit id`);

  const out = await diffText(cwd, [
    "show",
    "--format=%ct",
    "--diff-merges=first-parent",
    ...DIFF_FLAGS,
    "--end-of-options",
    `${sha}^{commit}`,
    "--",
  ]);

  if (out === null) {
    const time = await gitText(cwd, [
      "show",
      "-s",
      "--format=%ct",
      "--end-of-options",
      `${sha}^{commit}`,
      "--",
    ]);

    return { time: Number(time) * 1000, added: [] };
  }

  const newline = out.indexOf("\n");

  return {
    time: Number(out.slice(0, newline)) * 1000,
    added: parseAddedLines(out.slice(newline + 1)),
  };
};
