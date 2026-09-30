/**
 * Answering from the inbox, hover cards and notifications: RespondToApproval, Continue, Retry
 * and Take back, dispatched like the conversation does, with the refusal shown as a toast.
 */
import type { ApprovalDecision, RequestId, SessionId } from "@polaris/protocol";
import { Commands, Decisions } from "../../commands.ts";
import { send } from "../session/dispatch.ts";
import { markAnswered } from "./answered.ts";

export interface RespondInput {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly requestId: string;
  readonly decision: ApprovalDecision;
}

export const respond = async ({ hostKey, sessionId, requestId, decision }: RespondInput) => {
  markAnswered(requestId);

  return send(
    hostKey,
    Commands.RespondToApproval({
      sessionId,
      // SAFETY: request ids come from the Daemon's ApprovalRequested events.
      requestId: requestId as RequestId,
      decision,
    }),
    "Couldn't answer"
  );
};

export const approve = (input: Omit<RespondInput, "decision">, remember = false) =>
  respond({ ...input, decision: Decisions.Allow({ remember }) });

export const deny = (input: Omit<RespondInput, "decision">) =>
  respond({ ...input, decision: Decisions.Deny({ reason: null }) });

export const answer = (input: Omit<RespondInput, "decision">, text: string) =>
  respond({ ...input, decision: Decisions.Answer({ text }) });

/** An Interrupted Turn after a restart: pick it up where it stopped. */
export const continueTurn = (hostKey: string, sessionId: SessionId) =>
  send(hostKey, Commands.Continue({ sessionId }), "Couldn't continue");

/** A Failed Turn: send its prompt again as a new Turn. */
export const retryTurn = (hostKey: string, sessionId: SessionId) =>
  send(hostKey, Commands.Retry({ sessionId }), "Couldn't retry");

/** In Terminal: hand the session back to Polaris. */
export const takeBack = (hostKey: string, sessionId: SessionId) =>
  send(hostKey, Commands.ReturnFromTerminal({ sessionId }), "Couldn't take it back");
