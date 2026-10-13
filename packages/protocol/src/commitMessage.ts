/**
 * `commit.suggestMessage` (capability `commit.suggest-message`): a commit message
 * for the staged changes, drafted by a Harness. Ephemeral like `inline.propose`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ModelId, ReasoningEffort } from "./models.ts";

export const CommitMessageRequest = Schema.Struct({
  /** The directory `git.commit` commits in; the Daemon reads its index. */
  cwd: Schema.String,
  harness: Schema.Literals(["codex", "claude"]),
  model: Schema.NullOr(ModelId),
  effort: Schema.NullOr(ReasoningEffort),
});

export type CommitMessageRequest = typeof CommitMessageRequest.Type;

/** The Harness's structured output. The body may be empty. */
export const CommitMessage = Schema.Struct({
  subject: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isMaxLength(8000)),
});

export type CommitMessage = typeof CommitMessage.Type;

/** A message as the Commit box's text: the subject, a blank line, then the body. */
export const commitMessageText = (message: CommitMessage): string =>
  message.body === "" ? message.subject : `${message.subject}\n\n${message.body}`;

export const CommitMessageStreamItem = Schema.TaggedUnion({
  /** Provisional Harness text, never the message itself. */
  Delta: { text: Schema.String },
  /** Exactly one final message; `truncated` when the Harness saw only part of the diff. */
  Suggested: {
    message: CommitMessage,
    truncated: Schema.Boolean,
    thoughtMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  },
});

export type CommitMessageStreamItem = typeof CommitMessageStreamItem.Type;

/**
 * `nothing-staged` and `not-a-repository` are refused before any Harness runs;
 * `harness-missing` and `needs-sign-in` come from the Host's Harness availability.
 */
export const CommitMessageErrorReason = Schema.Literals([
  "nothing-staged",
  "not-a-repository",
  "harness-missing",
  "needs-sign-in",
  "timed-out",
  "invalid-message",
  "harness-failed",
]);

export type CommitMessageErrorReason = typeof CommitMessageErrorReason.Type;

export class CommitMessageError extends Schema.TaggedError<CommitMessageError>()(
  "CommitMessageError",
  { reason: CommitMessageErrorReason, message: Schema.String }
) {}

/** Ending consumption cancels the Harness; it never writes files, the index or events. */
export const CommitSuggestMessage = Rpc.make("commit.suggestMessage", {
  payload: CommitMessageRequest,
  success: CommitMessageStreamItem,
  error: CommitMessageError,
  stream: true,
});

export class CommitMessageRpcs extends RpcGroup.make(CommitSuggestMessage) {}
