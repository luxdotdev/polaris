/**
 * Git errors, the Changes tab's writes (capability `git.write`) and `git.watch`;
 * `git.status`, `git.diff` and `git.show` stay in `rpc.ts`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  cwd: Schema.String,
  message: Schema.String,
}) {}

/** Paths relative to the repository's top level, as `git.status` reports them. */
const GitPaths = { cwd: Schema.String, paths: Schema.Array(Schema.String) };

/** Stages the paths' changes, deletions included (capability `git.write`). */
export const GitStage = Rpc.make("git.stage", {
  payload: GitPaths,
  success: Schema.Void,
  error: GitError,
});

/** Takes the paths out of the index, back to HEAD (capability `git.write`). */
export const GitUnstage = Rpc.make("git.unstage", {
  payload: GitPaths,
  success: Schema.Void,
  error: GitError,
});

/**
 * Puts tracked paths' unstaged changes back to the index's version (capability
 * `git.write`). Untracked files are the Client's to trash; they are refused here.
 */
export const GitDiscard = Rpc.make("git.discard", {
  payload: GitPaths,
  success: Schema.Void,
  error: GitError,
});

/** What `git.commit` streams: the hooks' output as it comes, then how it ended. */
export const GitCommitItem = Schema.TaggedUnion({
  Output: { text: Schema.String },
  Committed: { head: Schema.String },
  /** git (or a hook) refused; `Output` already carried why. */
  Failed: { exitCode: Schema.Int },
});

export type GitCommitItem = typeof GitCommitItem.Type;

/**
 * Commits the index with `message`, running the repository's hooks (capability
 * `git.write`). The commit runs to its end even when the stream is dropped.
 */
export const GitCommit = Rpc.make("git.commit", {
  payload: { cwd: Schema.String, message: Schema.String },
  success: GitCommitItem,
  error: GitError,
  stream: true,
});

export class GitWriteRpcs extends RpcGroup.make(GitStage, GitUnstage, GitDiscard, GitCommit) {}

/**
 * One item each time git's own state moves for `cwd`'s checkout: its index, HEAD, HEAD's reflog
 * or packed refs (capability `git.watch`). The working tree's edits come from `files.watch`.
 */
export const GitWatch = Rpc.make("git.watch", {
  payload: { cwd: Schema.String },
  success: Schema.Null,
  error: GitError,
  stream: true,
});

export class GitWatchRpcs extends RpcGroup.make(GitWatch) {}
