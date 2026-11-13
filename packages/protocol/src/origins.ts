/**
 * Origins (ADR 0111, capability `origins`): `git.blame` gives each line its commit and line hash,
 * `origins.match` finds the Agent Sessions and Turns that wrote those lines on this Host, and
 * `origins.forCommit` does the same for every line a commit added. Times are epoch milliseconds.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CelestialBody } from "./celestial.ts";
import { SessionState } from "./domain.ts";
import { NotFound } from "./errors.ts";
import { GitError } from "./git.ts";
import { HarnessKind } from "./harnesses.ts";
import { SessionId, TurnId, WorkspaceId, WorktreeId } from "./ids.ts";

/** The most lines one `git.blame` or `origins.match` answers. */
export const MAX_ORIGIN_LINES = 5_000;

const LineNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** The commit `git blame` gives a line; `time` is the committer's, so a rebase or squash moves it later. */
export const BlameCommit = Schema.Struct({
  sha: Schema.String,
  subject: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  time: Schema.Number,
});

export type BlameCommit = typeof BlameCommit.Type;

/** One line of a file: `hash` is null when the line is too short or common to identify; `commit` is null when uncommitted. */
export const BlameLine = Schema.Struct({
  line: LineNumber,
  hash: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(BlameCommit),
});

export type BlameLine = typeof BlameLine.Type;

/**
 * Blames lines `startLine` through `endLine` of `path` (relative to the checkout) as it is on
 * disk, uncommitted edits included. `worktreeId` blames that Worktree of the Workspace instead.
 */
export const GitBlame = Rpc.make("git.blame", {
  payload: {
    workspaceId: WorkspaceId,
    path: Schema.String,
    startLine: LineNumber,
    endLine: LineNumber,
    worktreeId: Schema.optionalKey(Schema.NullOr(WorktreeId)),
  },
  success: Schema.Struct({
    /** The repository across Hosts: the SHA of its oldest root commit. */
    repoKey: Schema.String,
    lines: Schema.Array(BlameLine),
  }),
  error: Schema.Union([NotFound, GitError]),
});

/** A line to look up: its hash and commit as `git.blame` gave them. */
export const OriginLineQuery = Schema.Struct({
  line: LineNumber,
  hash: Schema.NullOr(Schema.String),
  commitSha: Schema.NullOr(Schema.String),
  commitTime: Schema.NullOr(Schema.Number),
});

export type OriginLineQuery = typeof OriginLineQuery.Type;

/** One Agent Session that wrote a line, with the Turns in it that wrote it. */
export const LineOrigin = Schema.Struct({
  sessionId: SessionId,
  turnIds: Schema.Array(TurnId),
});

export type LineOrigin = typeof LineOrigin.Type;

export const OriginLine = Schema.Struct({
  line: LineNumber,
  origins: Schema.Array(LineOrigin),
});

export type OriginLine = typeof OriginLine.Type;

/** A Turn that wrote matched lines: `prompt` is the user's message, cut to 280 characters. */
export const OriginTurn = Schema.Struct({
  turnId: TurnId,
  time: Schema.Number,
  prompt: Schema.String,
});

export type OriginTurn = typeof OriginTurn.Type;

/** An Origin as the hover shows it: the session and the Turns of it that matched. */
export const OriginSession = Schema.Struct({
  sessionId: SessionId,
  workspaceId: WorkspaceId,
  title: Schema.String,
  harness: HarnessKind,
  sessionState: SessionState,
  archived: Schema.Boolean,
  celestial: Schema.NullOr(CelestialBody),
  turns: Schema.Array(OriginTurn),
});

export type OriginSession = typeof OriginSession.Type;

/** Each line's Origins from this Host's own fingerprints; Turns of another repository never match. */
export const OriginsMatch = Rpc.make("origins.match", {
  payload: {
    repoKey: Schema.String,
    lines: Schema.Array(OriginLineQuery).check(Schema.isMaxLength(MAX_ORIGIN_LINES)),
  },
  success: Schema.Struct({
    lines: Schema.Array(OriginLine),
    sessions: Schema.Array(OriginSession),
  }),
});

/** The Origins of every line commit `sha` added, in the Workspace's repository. */
export const OriginsForCommit = Rpc.make("origins.forCommit", {
  payload: { workspaceId: WorkspaceId, sha: Schema.String },
  success: Schema.Struct({ sessions: Schema.Array(OriginSession) }),
  error: Schema.Union([NotFound, GitError]),
});

export class OriginRpcs extends RpcGroup.make(GitBlame, OriginsMatch, OriginsForCommit) {}
