/**
 * Per-Turn checkpoints as git refs:
 * `refs/polaris/checkpoints/<session>/<turn>/{before,after}`.
 *
 * Design follows pingdotgg/t3code@de251fc (MIT); no code was copied.
 */
import type { SessionId, TurnId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { Checkpoints, ServiceError } from "../services.ts";
import { GitCommandError, gitText, runGitRaw } from "./git.ts";
import { snapshotWorkingTree } from "./snapshot.ts";

export const checkpointRef = (
  sessionId: SessionId | string,
  turnId: TurnId | string,
  label: "before" | "after"
): string => `refs/polaris/checkpoints/${sessionId}/${turnId}/${label}`;

/** Checkpoint commits are Polaris's own; don't depend on the user having an identity set. */
const identity = {
  GIT_AUTHOR_NAME: "Polaris",
  GIT_AUTHOR_EMAIL: "polaris@localhost",
  GIT_COMMITTER_NAME: "Polaris",
  GIT_COMMITTER_EMAIL: "polaris@localhost",
};

/** How long a checkpoint commit is reused for an identical snapshot. */
const REUSE_MS = 10 * 60_000;

/**
 * The last checkpoint commit per repository. A Turn's `before` usually
 * snapshots exactly what the previous Turn's `after` did (nothing changed in
 * between), so its commit is reused instead of writing an identical one.
 */
const lastCommits = new Map<
  string,
  {
    readonly tree: string;
    readonly head: string | null;
    readonly commit: string;
    readonly at: number;
  }
>();

export const captureCheckpoint = async (options: {
  readonly cwd: string;
  readonly sessionId: SessionId | string;
  readonly turnId: TurnId | string;
  readonly label: "before" | "after";
}): Promise<{ readonly ref: string; readonly commit: string } | null> => {
  const snapshot = await snapshotWorkingTree(options.cwd);
  if (snapshot === null) return null;
  const ref = checkpointRef(options.sessionId, options.turnId, options.label);
  const newCommit = () => {
    const parents = snapshot.head === null ? [] : ["-p", snapshot.head];
    const message = `polaris checkpoint ${options.sessionId}/${options.turnId}/${options.label}`;
    return gitText(snapshot.root, ["commit-tree", snapshot.tree, ...parents, "-m", message], {
      env: identity,
    });
  };
  const last = lastCommits.get(snapshot.root);
  const reusable =
    last !== undefined &&
    last.tree === snapshot.tree &&
    last.head === snapshot.head &&
    Date.now() - last.at < REUSE_MS;
  let commit = reusable ? last.commit : await newCommit();
  const update = await runGitRaw(snapshot.root, ["update-ref", ref, commit]);
  if (update.code !== 0) {
    if (!reusable)
      throw new GitCommandError(
        snapshot.root,
        ["update-ref", ref, commit],
        update.code,
        update.stderr
      );
    // The reused commit is gone (its refs were pruned and gc'd): write a new one.
    commit = await newCommit();
    await gitText(snapshot.root, ["update-ref", ref, commit]);
  }
  lastCommits.set(snapshot.root, {
    tree: snapshot.tree,
    head: snapshot.head,
    commit,
    at: reusable ? last.at : Date.now(),
  });
  return { ref, commit };
};

export const CheckpointsLive = Layer.succeed(
  Checkpoints,
  Checkpoints.of({
    capture: Effect.fn("Checkpoints.capture")(function* (options) {
      return yield* Effect.tryPromise({
        try: () => captureCheckpoint(options),
        catch: (cause) =>
          new ServiceError({
            service: "Checkpoints",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    }),
  })
);
