/**
 * Handlers for `git.status` and `git.diff`. The transport mounts this layer
 * next to the other partial handler layers of `DaemonRpcs`.
 */
import { GitDiff, GitError, GitShow, GitStatus, GitStatusEntry, NotFound } from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { BlobChannel } from "../services.ts";
import { ReadContent, toContent } from "../files/fs.ts";
import { computeDiff, DiffNotFound } from "./diff.ts";
import { indexDiff } from "./diffIndex.ts";
import { showFile } from "./show.ts";
import { gitStatus } from "./status.ts";

export class GitRpcs extends RpcGroup.make(GitStatus, GitDiff, GitShow) {}

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

const notFoundOr = (cwd: string) => (cause: unknown) =>
  cause instanceof DiffNotFound
    ? new NotFound({ what: cause.what, id: cause.id })
    : gitError(cwd)(cause);

export const handleGitDiff = Effect.fn("git.diff")(function* ({
  cwd,
  spec,
}: typeof GitDiff.payloadSchema.Type) {
  const diff = yield* Effect.tryPromise({
    try: () => computeDiff(cwd, spec),
    catch: notFoundOr(cwd),
  });

  const blobs = yield* BlobChannel;
  const blobId = yield* blobs.offer(diff.bytes);

  return {
    blobId,
    size: diff.bytes.byteLength,
    files: diff.files,
    fileIndex: indexDiff(diff.bytes),
  };
});

export const handleGitShow = Effect.fn("git.show")(function* ({
  cwd,
  revision,
  path,
}: typeof GitShow.payloadSchema.Type) {
  const file = yield* Effect.tryPromise({
    try: () => showFile(cwd, revision, path),
    catch: notFoundOr(cwd),
  });

  const content = toContent(file.mimeType, file.bytes);

  if (ReadContent.$is("Inline")(content)) {
    return { size: file.size, mimeType: file.mimeType, content };
  }

  const blobs = yield* BlobChannel;
  const blobId = yield* blobs.offer(file.bytes);

  return { size: file.size, mimeType: file.mimeType, content: { _tag: "Blob" as const, blobId } };
});

/**
 * Requires `BlobChannel` per request: when the transport provides it per
 * connection through an RpcMiddleware, the handler picks that one up.
 */
export const GitRpcsLive = GitRpcs.toLayer({
  "git.status": handleGitStatus,
  "git.diff": handleGitDiff,
  "git.show": handleGitShow,
});
