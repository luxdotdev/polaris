/**
 * What Review on iPhone sends to the Host: Accept (`AcceptTurns` through the reviewed Turn),
 * Send back (a feedback Turn with the user's reply), "Ask {harness} to fix" (a feedback Turn
 * quoting the flagged lines), and verdicts on a finding.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import {
  Command,
  type CommandId,
  FeedbackBatch,
  FeedbackComment,
  type RiskFinding,
  type RiskSummaryId,
  SessionId,
  TurnId,
  type VerdictReason,
  VerdictId,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { LineRow } from "./diffRows.ts";

// Idempotency keys only need to be unique, not secret.
export const uniqueId = () =>
  `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** A refusal in the Host's words: nothing was recorded. */
export class ReviewRefused extends Error {
  readonly _tag = "ReviewRefused";
}

/** Sends one command under its id; a retry passes the same id, so the Host applies it once. */
export const dispatchReview = (client: DaemonClient, command: Command, commandId: CommandId) =>
  client.dispatch({ commandId, command }).pipe(
    Effect.asVoid,
    Effect.catchTags({
      CommandRejected: (e) => Effect.fail(new ReviewRefused(e.message)),
      NotFound: (e) => Effect.fail(new ReviewRefused(e.message)),
    })
  );

export const acceptCommand = (sessionId: string, turnId: string) =>
  Command.cases.AcceptTurns.make({
    sessionId: SessionId.make(sessionId),
    throughTurnId: TurnId.make(turnId),
    revertLaterTurns: false,
  });

const feedbackCommand = (sessionId: string, feedback: FeedbackBatch) =>
  Command.cases.SendFeedback.make({
    sessionId: SessionId.make(sessionId),
    feedback,
    attachments: [],
  });

export const sendBackCommand = (sessionId: string, reply: string) =>
  feedbackCommand(sessionId, new FeedbackBatch({ message: reply.trim(), comments: [] }));

/** The code a finding flags, as the diff shows it on the finding's side. */
export const flaggedCode = (finding: RiskFinding, lines: ReadonlyArray<LineRow>): string =>
  lines
    .flatMap((row) => {
      const number = finding.lines.side === "old" ? row.oldNumber : row.newNumber;

      const flagged =
        row.path === finding.path &&
        number !== null &&
        number >= finding.lines.start &&
        number <= finding.lines.end;

      return flagged ? [row.text] : [];
    })
    .join("\n");

/** "Ask {harness} to fix": a feedback Turn whose comment (`commentId`) quotes the flagged code. */
export const askToFixCommand = (
  sessionId: string,
  finding: RiskFinding,
  code: string,
  commentId: string
) =>
  feedbackCommand(
    sessionId,
    new FeedbackBatch({
      message: null,
      comments: [
        new FeedbackComment({
          id: commentId,
          path: finding.path,
          lines: finding.lines,
          code,
          note: `Fix this: ${finding.title}. ${finding.reason}`,
          findingId: finding.id,
        }),
      ],
    })
  );

/** Thumbs up with no reason, or thumbs down with one; "this repo" is the scope by default. */
export const verdictCommand = (
  summaryId: RiskSummaryId,
  finding: RiskFinding,
  reason: VerdictReason | null,
  verdictId: string
) =>
  Command.cases.RecordVerdict.make({
    verdictId: VerdictId.make(verdictId),
    summaryId,
    findingId: finding.id,
    thumb: reason === null ? "up" : "down",
    reasons: reason === null ? [] : [reason],
    text: null,
    scope: "repo",
  });
