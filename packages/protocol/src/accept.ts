/**
 * Accepting an Agent Session's work and ending it in a pull request (ENG-224):
 * what the Daemon answers to `session.acceptPlan`, `session.draftAccept`,
 * `session.commitAccepted` and `session.pushAccepted` (capability `session.accept`).
 * The pull request itself is opened by the Client, as the routed GitHub account.
 */
import { Schema } from "effect";
import { SessionId, TurnId } from "./ids.ts";

/** Where the accepted work is committed. */
export const AcceptBranch = Schema.TaggedUnion({
  /** The branch checked out now, the default branch included. */
  Current: {},
  /** A new branch from HEAD, checked out in place; the working tree is kept. */
  Create: { name: Schema.String },
});

export type AcceptBranch = typeof AcceptBranch.Type;

/** One commit for all the Turns, or one per Turn. */
export const CommitGranularity = Schema.Literals(["single", "per-turn"]);

export type CommitGranularity = typeof CommitGranularity.Type;

/** A Turn the next commit takes. */
export class AcceptTurn extends Schema.Class<AcceptTurn>("AcceptTurn")({
  turnId: TurnId,
  index: Schema.Int,
  /** The Turn's prompt, first line, clipped. */
  title: Schema.String,
  files: Schema.Int,
}) {}

export class AcceptRemote extends Schema.Class<AcceptRemote>("AcceptRemote")({
  name: Schema.String,
  url: Schema.String,
}) {}

/** What committing through a Turn would do, before anything is written. */
export class AcceptPlan extends Schema.Class<AcceptPlan>("AcceptPlan")({
  sessionId: SessionId,
  /** The repository's top level the commit is made in. */
  root: Schema.String,
  /** Not yet committed, oldest first, through the Turn asked about. */
  turns: Schema.Array(AcceptTurn),
  /** Turns after it, which accepting can revert. */
  laterTurns: Schema.Int,
  /** Checked out now; null when HEAD is detached. */
  branch: Schema.NullOr(Schema.String),
  /** The remote's default branch (`main`); null when unknown. */
  defaultBranch: Schema.NullOr(Schema.String),
  /** The session works in its own Worktree, so it always commits to that Worktree's branch. */
  worktree: Schema.Boolean,
  /** Where pushing goes: the branch's remote, else `origin`, else the only one. */
  remote: Schema.NullOr(AcceptRemote),
  files: Schema.Int,
  additions: Schema.Int,
  deletions: Schema.Int,
}) {}

/** The commit message and pull request text, editable before committing. */
export class AcceptDraft extends Schema.Class<AcceptDraft>("AcceptDraft")({
  title: Schema.String,
  body: Schema.String,
  prTitle: Schema.String,
  prBody: Schema.String,
  /** Per-Turn commit titles, in the plan's order, for "one commit per Turn". */
  turnTitles: Schema.Array(Schema.String),
  /** `harness`: the session's own Harness wrote it; `template`: built from the Turns. */
  source: Schema.Literals(["harness", "template"]),
  /** Why the Harness's draft wasn't used, when it wasn't. */
  note: Schema.NullOr(Schema.String),
}) {}

export class AcceptCommitted extends Schema.Class<AcceptCommitted>("AcceptCommitted")({
  branch: Schema.String,
  /** The new commits, oldest first; empty when the Turns changed nothing. */
  commits: Schema.Array(Schema.String),
  /** The pull request's base: the default branch, null when committing onto it. */
  base: Schema.NullOr(Schema.String),
}) {}

export class AcceptPushed extends Schema.Class<AcceptPushed>("AcceptPushed")({
  remote: AcceptRemote,
  branch: Schema.String,
}) {}

/** Committing or pushing was refused before git ran: the reason is for the user. */
export class AcceptRefused extends Schema.TaggedError<AcceptRefused>()("AcceptRefused", {
  reason: Schema.String,
}) {}
