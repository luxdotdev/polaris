/**
 * Per-Turn checkpoints as git refs:
 * `refs/polaris/checkpoints/<session>/<turn>/{before,after}`.
 *
 * Design follows pingdotgg/t3code@de251fc (MIT); no code was copied.
 */
import type { SessionId, TurnId } from "@polaris/protocol"
import { Effect, Layer } from "effect"
import { Checkpoints, ServiceError } from "../services.ts"
import { gitText } from "./git.ts"
import { snapshotWorkingTree } from "./snapshot.ts"

export const checkpointRef = (
  sessionId: SessionId | string,
  turnId: TurnId | string,
  label: "before" | "after",
): string => `refs/polaris/checkpoints/${sessionId}/${turnId}/${label}`

/** Checkpoint commits are Polaris's own; don't depend on the user having an identity set. */
const identity = {
  GIT_AUTHOR_NAME: "Polaris",
  GIT_AUTHOR_EMAIL: "polaris@localhost",
  GIT_COMMITTER_NAME: "Polaris",
  GIT_COMMITTER_EMAIL: "polaris@localhost",
}

export const captureCheckpoint = async (options: {
  readonly cwd: string
  readonly sessionId: SessionId | string
  readonly turnId: TurnId | string
  readonly label: "before" | "after"
}): Promise<{ readonly ref: string; readonly commit: string } | null> => {
  const snapshot = await snapshotWorkingTree(options.cwd)
  if (snapshot === null) return null
  const ref = checkpointRef(options.sessionId, options.turnId, options.label)
  const parents = snapshot.head === null ? [] : ["-p", snapshot.head]
  const message = `polaris checkpoint ${options.sessionId}/${options.turnId}/${options.label}`
  const commit = await gitText(
    snapshot.root,
    ["commit-tree", snapshot.tree, ...parents, "-m", message],
    {
      env: identity,
    },
  )
  await gitText(snapshot.root, ["update-ref", ref, commit])
  return { ref, commit }
}

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
      })
    }),
  }),
)
