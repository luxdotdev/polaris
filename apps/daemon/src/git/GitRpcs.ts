/**
 * Handlers for `git.status` and `git.diff`. The transport mounts this layer
 * next to the other partial handler layers of `DaemonRpcs`.
 */
import { GitDiff, GitError, GitStatus, GitStatusEntry, NotFound } from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { BlobChannel } from "../services.ts";
import { computeDiff, DiffNotFound } from "./diff.ts";
import { gitStatus } from "./status.ts";

export class GitRpcs extends RpcGroup.make(GitStatus, GitDiff) {}

const gitError = (cwd: string) => (cause: unknown) =>
  new GitError({ cwd, message: cause instanceof Error ? cause.message : String(cause) });

export const handleGitStatus = Effect.fn("git.status")(function* ({
  cwd,
}: {
  readonly cwd: string;
}) {
  const status = yield* Effect.tryPromise({ try: () => gitStatus(cwd), catch: gitError(cwd) });
  return {
    ...status,
    entries: status.entries.map((entry) => new GitStatusEntry(entry)),
  };
});

export const handleGitDiff = Effect.fn("git.diff")(function* ({
  cwd,
  spec,
}: typeof GitDiff.payloadSchema.Type) {
  const diff = yield* Effect.tryPromise({
    try: () => computeDiff(cwd, spec),
    catch: (cause) =>
      cause instanceof DiffNotFound
        ? new NotFound({ what: cause.what, id: cause.id })
        : gitError(cwd)(cause),
  });
  const blobs = yield* BlobChannel;
  const blobId = yield* blobs.offer(diff.bytes);
  return { blobId, size: diff.bytes.byteLength, files: diff.files };
});

/**
 * Requires `BlobChannel` per request: when the transport provides it per
 * connection through an RpcMiddleware, the handler picks that one up.
 */
export const GitRpcsLive = GitRpcs.toLayer({
  "git.status": handleGitStatus,
  "git.diff": handleGitDiff,
});
