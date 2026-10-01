/**
 * An Agent Session's change, as the Review shows it: what its Turns changed,
 * and nothing that landed between them (someone else's commits, a pull).
 * Each file the Turns touched goes from its version before the first Turn
 * that touched it to its version after the last; two trees hold that diff.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutGit } from "../git/review/refs.ts";

/** One Turn's before- and after-checkpoint commits. */
export interface TurnCommits {
  readonly before: string;
  readonly after: string;
}

export interface ComposedChange {
  readonly base: string;
  readonly head: string;
}

const ZERO = "0".repeat(40);

const split = (output: string) => output.split("\0").filter((part) => part !== "");

/** Paths a Turn changed; a rename counts as its old and its new path. */
const touched = async (cwd: string, turn: TurnCommits): Promise<ReadonlyArray<string>> =>
  split(
    await checkoutGit(cwd, ["diff", "--name-only", "--no-renames", "-z", turn.before, turn.after])
  );

/** `<mode> <object>\t<path>` index lines for `paths` at `commit`; a missing path removes it. */
const entriesAt = async (
  cwd: string,
  commit: string,
  paths: ReadonlyArray<string>
): Promise<ReadonlyArray<string>> => {
  const listed = split(
    await checkoutGit(cwd, ["ls-tree", "-z", "--full-tree", commit, "--", ...paths])
  );

  const found = new Map<string, string>();

  for (const line of listed) {
    const tab = line.indexOf("\t");
    const [mode, , object] = line.slice(0, tab).split(" ");

    found.set(line.slice(tab + 1), `${mode} ${object}\t${line.slice(tab + 1)}`);
  }

  return paths.map((path) => found.get(path) ?? `0 ${ZERO}\t${path}`);
};

/** `start` with the given index lines applied, written as a tree. */
const treeWith = async (
  cwd: string,
  start: string,
  lines: ReadonlyArray<string>,
  index: string
): Promise<string> => {
  const env = { GIT_INDEX_FILE: index };
  await checkoutGit(cwd, ["read-tree", start], { env });

  if (lines.length > 0) {
    await checkoutGit(cwd, ["update-index", "--index-info"], {
      env,
      stdin: new TextEncoder().encode(`${lines.join("\n")}\n`),
    });
  }

  return checkoutGit(cwd, ["write-tree"], { env });
};

/** Group paths by the commit their version comes from. */
const byCommit = (versions: ReadonlyMap<string, string>) => {
  const groups = new Map<string, Array<string>>();

  for (const [path, commit] of versions) groups.set(commit, [...(groups.get(commit) ?? []), path]);

  return groups;
};

const linesFor = async (cwd: string, versions: ReadonlyMap<string, string>) => {
  const lines: Array<string> = [];

  for (const [commit, paths] of byCommit(versions))
    lines.push(...(await entriesAt(cwd, commit, paths)));

  return lines;
};

/** The two trees whose diff is exactly the Turns' changes, in order. */
export const composeTurns = async (
  cwd: string,
  turns: ReadonlyArray<TurnCommits>
): Promise<ComposedChange> => {
  const first = turns[0];

  if (first === undefined) throw new Error("no Turns to compose");
  const from = new Map<string, string>();
  const to = new Map<string, string>();

  for (const turn of turns) {
    for (const path of await touched(cwd, turn)) {
      if (!from.has(path)) from.set(path, turn.before);
      to.set(path, turn.after);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "polaris-compose-"));
  const index = join(dir, "index");

  try {
    return {
      base: await treeWith(cwd, first.before, await linesFor(cwd, from), index),
      head: await treeWith(cwd, first.before, await linesFor(cwd, to), index),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
