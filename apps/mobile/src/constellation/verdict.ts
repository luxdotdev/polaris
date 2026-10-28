/**
 * The user's verdict on a claim the lead handed up (DESIGN.md Mobile App, Constellation):
 * Accept records the approval and tells the lead to merge; Send back tells the lead to send
 * it back. Either carries the user's one-line answer to the lead.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import {
  CommandId,
  type ConstellationFinding,
  ConstellationId,
  MessageTarget,
  ReviewAction,
  AttemptId,
} from "@polaris/protocol";
import { Effect } from "effect";

export type Verdict = "accept" | "send-back";

export interface VerdictInput {
  readonly verdict: Verdict;
  readonly constellationId: string;
  readonly taskId: string;
  readonly attemptId: string;
  /** The Attempt revision the user saw the claim at. */
  readonly revision: number;
  /** The claim's head, short. */
  readonly head: string;
  /** The user's one-line answer; required to send back. */
  readonly reply: string;
}

/** The message the lead reads: the verdict first, in the user's words. */
export const verdictMessage = (input: VerdictInput): string => {
  const reply = input.reply.trim();

  if (input.verdict === "send-back")
    return `Send back ${input.taskId} (claim ${input.head}): ${reply}`;
  const accepted = `Accept ${input.taskId} (claim ${input.head}). I approved it on my phone; merge it and accept it.`;

  return reply === "" ? accepted : `${accepted} My answer: ${reply}`;
};

export const canSend = (verdict: Verdict, reply: string): boolean =>
  verdict === "accept" || reply.trim() !== "";

/** A refusal in the user's words: the Daemon's first finding. */
export class VerdictRefused extends Error {
  readonly _tag = "VerdictRefused";

  constructor(readonly findings: ReadonlyArray<ConstellationFinding>) {
    super(findings[0]?.message ?? "The Host refused it");
  }
}

// Idempotency keys only need to be unique, not secret.
const commandId = () =>
  CommandId.make(`mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Approves first on Accept, so a refused approval sends the lead nothing. */
export const sendVerdict = (client: DaemonClient, input: VerdictInput) =>
  Effect.gen(function* () {
    const constellationId = ConstellationId.make(input.constellationId);

    if (input.verdict === "accept")
      yield* client["constellation.review"]({
        commandId: commandId(),
        constellationId,
        attemptId: AttemptId.make(input.attemptId),
        revision: input.revision,
        action: ReviewAction.cases.Approve.make({}),
      }).pipe(
        Effect.catchTag("ConstellationRejected", (e) => Effect.fail(new VerdictRefused(e.findings)))
      );

    yield* client["constellation.message"]({
      commandId: commandId(),
      constellationId,
      target: MessageTarget.cases.Lead.make({}),
      text: verdictMessage(input),
    }).pipe(
      Effect.catchTag("ConstellationRejected", (e) => Effect.fail(new VerdictRefused(e.findings)))
    );
  });

/** Messages the lead from the composer. */
export const messageLead = (client: DaemonClient, constellationId: string, text: string) =>
  client["constellation.message"]({
    commandId: commandId(),
    constellationId: ConstellationId.make(constellationId),
    target: MessageTarget.cases.Lead.make({}),
    text,
  }).pipe(
    Effect.catchTag("ConstellationRejected", (e) => Effect.fail(new VerdictRefused(e.findings)))
  );
