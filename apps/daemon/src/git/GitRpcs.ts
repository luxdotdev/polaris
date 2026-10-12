/**
 * Handlers for `git.status` and `git.diff`. The transport mounts this layer
 * next to the other partial handler layers of `DaemonRpcs`.
 */
import {
  DiffFile,
  GitDiff,
  GitError,
  GitShow,
  GitStatus,
  GitStatusEntry,
  NotFound,
} from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { BlobChannel } from "../services.ts";
import { ReadContent, toContent } from "../files/fs.ts";
import { generatedPaths } from "../reviewer/generated.ts";
import { computeDiff, DiffNotFound, type DiffResult } from "./diff.ts";
import { indexDiff } from "./diffIndex.ts";
import { showFile } from "./show.ts";
import { gitStatus } from "./status.ts";

export class GitRpcs extends RpcGroup.make(GitStatus, GitDiff, GitShow) {}

const gitError = (cwd: string) => (cause: unknown) =>
  new GitError({ cwd, message: cause instanceof Error ? cause.message : String(cause) });

export const handleGitStatus = Effect.fn("git.status")(function* ({
  cwd,
  ignored,
}: typeof GitStatus.payloadSchema.Type) {
  const status = yield* Effect.tryPromise({
    try: () => gitStatus(cwd, { ignored: ignored === true }),
    catch: gitError(cwd),
  });

  return {
    ...status,
    entries: status.entries.map((entry) => new GitStatusEntry(entry)),
  };
});

/** The file index with each file's `generated` verdict; null where it couldn't be read. */
const indexWithGenerated = async (diff: DiffResult): Promise<ReadonlyArray<DiffFile>> => {
  const index = indexDiff(diff.bytes);

  const generated = await generatedPaths({
    root: diff.root,
    at: diff.rulesAt,
    repo: diff.root,
    paths: index.map((file) => file.path),
  }).catch(() => null);

  return index.map(
    (file) =>
      new DiffFile({
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        offset: file.offset,
        length: file.length,
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
        generated: generated?.has(file.path) ?? null,
      })
  );
};

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

  const fileIndex = yield* Effect.promise(() => indexWithGenerated(diff));
  const blobs = yield* BlobChannel;
  const blobId = yield* blobs.offer(diff.bytes);

  return { blobId, size: diff.bytes.byteLength, files: diff.files, fileIndex };
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
