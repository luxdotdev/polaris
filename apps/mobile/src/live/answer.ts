/**
 * Answers from the Live Activity's takeover. Its LiveActivityIntent runs in the app and hands
 * `{hostId, sessionId, requestId, decision}` to JS, which sends it as a notification's answer.
 */
import { ApprovalDecision, Command, CommandId, RequestId, SessionId } from "@polaris/protocol";
import { Schema } from "effect";
import type { Answer } from "../push/answer.ts";

export const LiveAnswer = Schema.Struct({
  hostId: Schema.String,
  sessionId: SessionId,
  requestId: RequestId,
  decision: Schema.Literals(["approve", "always", "deny"]),
});

export type LiveAnswer = typeof LiveAnswer.Type;

/** What `takeAnswers` hands over; None for anything the intent didn't send. */
export const decodeLiveAnswer = Schema.decodeUnknownOption(LiveAnswer);

const DECISIONS = {
  approve: ApprovalDecision.cases.Allow.make({ remember: false }),
  always: ApprovalDecision.cases.Allow.make({ remember: true }),
  deny: ApprovalDecision.cases.Deny.make({ reason: null }),
} as const;

/** The id the module's `answered` takes to let the intent return. */
export const liveAnswerId = (answer: Answer & { readonly requestId: string }) =>
  `${answer.hostId}:${answer.requestId}`;

export const liveAnswerOf = ({
  hostId,
  sessionId,
  requestId,
  decision,
}: LiveAnswer): Answer & { readonly requestId: string } => ({
  hostId,
  requestId,
  dispatch: {
    // The notification's id for the same request: answered from both, it's one answer.
    commandId: CommandId.make(`push-answer:${hostId}:${requestId}`),
    command: Command.cases.RespondToApproval.make({
      sessionId,
      requestId,
      decision: DECISIONS[decision],
    }),
  },
});
