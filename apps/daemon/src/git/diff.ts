/**
 * Unified diffs for `git.diff`: the working tree (untracked files included),
 * one Turn (between its checkpoint refs), or an arbitrary range.
 */
import { GitDiff } from "@polaris/protocol";
import { checkpointRef } from "./Checkpoints.ts";
import { emptyTree, findRepoRoot, resolveCommit, resolveHead, runGit } from "./git.ts";
import { snapshotWorkingTree } from "./snapshot.ts";

/** What `git.diff` compares: the protocol's tagged union, with its `cases` constructors. */
export const DiffSpec = GitDiff.payloadSchema.fields.spec;

export type DiffSpec = typeof DiffSpec.Type;

type WorkingTreeSpec = typeof DiffSpec.cases.WorkingTree.Type;

type TurnSpec = typeof DiffSpec.cases.Turn.Type;

type RangeSpec = typeof DiffSpec.cases.Range.Type;

type TurnsSpec = typeof DiffSpec.cases.Turns.Type;

export class DiffNotFound extends Error {
  constructor(
    readonly what: string,
    readonly id: string
  ) {
    super(`${what} not found: ${id}`);
  }
}

export class NotARepository extends Error {
  constructor(readonly cwd: string) {
    super(`not a git repository: ${cwd}`);
  }
}

export interface DiffResult {
  readonly bytes: Uint8Array;
  readonly files: number;
}

const DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "-M"] as const;

const diffTrees = async (root: string, from: string, to: string): Promise<DiffResult> => {
  const { stdout } = await runGit(root, [...DIFF_FLAGS, from, to, "--"]);

  return { bytes: stdout, files: countFiles(stdout) };
};

/** Counts `diff --git ` headers at line starts without decoding the whole diff. */
export const countFiles = (bytes: Uint8Array): number => {
  const marker = new TextEncoder().encode("diff --git ");
  let count = 0;

  for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (i !== 0 && bytes[i - 1] !== 0x0a) continue;
    let match = true;

    for (let k = 0; k < marker.length; k++) {
      if (bytes[i + k] !== marker[k]) {
        match = false;
        break;
      }
    }

    if (match) count++;
  }

  return count;
};

const requireCommit = async (root: string, ref: string, what: string): Promise<string> => {
  const commit = await resolveCommit(root, ref);

  if (commit === null) throw new DiffNotFound(what, ref);

  return commit;
};

const diffWorkingTree = async (cwd: string, root: string, spec: WorkingTreeSpec) => {
  const snapshot = await snapshotWorkingTree(root);

  if (snapshot === null) throw new NotARepository(cwd);

  const base =
    spec.base !== null
      ? await requireCommit(root, spec.base, "ref")
      : ((await resolveHead(root)) ?? (await emptyTree(root)));

  return diffTrees(root, base, snapshot.tree);
};

const diffTurn = async (cwd: string, root: string, spec: TurnSpec) => {
  const before = await requireCommit(
    root,
    checkpointRef(spec.sessionId, spec.turnId, "before"),
    "checkpoint"
  );

  // A Turn still in progress has no `after` yet: diff against the working tree now.
  const after =
    (await resolveCommit(root, checkpointRef(spec.sessionId, spec.turnId, "after"))) ??
    (await snapshotWorkingTree(root))?.tree;

  if (after === undefined) throw new NotARepository(cwd);

  return diffTrees(root, before, after);
};

/** A run of Turns: the first one's before-checkpoint to the last one's after (or the working tree). */
const diffTurns = async (cwd: string, root: string, spec: TurnsSpec) => {
  const before = await requireCommit(
    root,
    checkpointRef(spec.sessionId, spec.firstTurnId, "before"),
    "checkpoint"
  );

  const after =
    (await resolveCommit(root, checkpointRef(spec.sessionId, spec.lastTurnId, "after"))) ??
    (await snapshotWorkingTree(root))?.tree;

  if (after === undefined) throw new NotARepository(cwd);

  return diffTrees(root, before, after);
};

const diffRange = async (root: string, spec: RangeSpec) => {
  const base = await requireCommit(root, spec.base, "ref");
  const head = await requireCommit(root, spec.head, "ref");

  return diffTrees(root, base, head);
};

export const computeDiff = async (cwd: string, spec: DiffSpec): Promise<DiffResult> => {
  const root = await findRepoRoot(cwd);

  if (root === null) throw new NotARepository(cwd);

  return DiffSpec.match(spec, {
    WorkingTree: (workingTree) => diffWorkingTree(cwd, root, workingTree),
    Turn: (turn) => diffTurn(cwd, root, turn),
    Range: (range) => diffRange(root, range),
    Turns: (turns) => diffTurns(cwd, root, turns),
  });
};
