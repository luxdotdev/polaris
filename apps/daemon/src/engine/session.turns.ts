import {
  type AgentSession,
  type Attachment,
  DomainEvent,
  Turn,
  type TurnId,
  type TurnTrigger,
} from "@polaris/protocol";
import { lastTurn, workingTurn, type SessionRecord } from "../store/model.ts";
import { lastIsAccepted } from "./session.accept.ts";

export const userTurn = (
  session: Pick<AgentSession, "id" | "turnCount" | "model" | "effort" | "serviceTier">,
  input: {
    id: TurnId;
    prompt: string;
    attachments: ReadonlyArray<Attachment>;
    at: string;
  }
): Turn =>
  new Turn({
    id: input.id,
    sessionId: session.id,
    index: session.turnCount,
    prompt: input.prompt,
    attachments: [...input.attachments],
    model: session.model,
    effort: session.effort,
    serviceTier: session.serviceTier,
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: input.at,
    endedAt: null,
  });

/** Turns started by the Harness itself, including background reports and terminal input. */
export const harnessTurn = (
  record: SessionRecord,
  event: { turnId: TurnId; prompt: string; at: string; trigger: TurnTrigger | null }
): DomainEvent | null =>
  (event.trigger !== null &&
    (record.session.state !== "idle" || workingTurn(record) !== undefined)) ||
  record.turns.some((t) => t.id === event.turnId)
    ? null
    : DomainEvent.cases.TurnStarted.make({
        turn: new Turn({
          id: event.turnId,
          sessionId: record.session.id,
          index: record.session.turnCount,
          prompt: event.trigger === null ? event.prompt : "[Background task continuation]",
          trigger: event.trigger,
          attachments: [],
          model: record.session.model,
          effort: record.session.effort,
          serviceTier: record.session.serviceTier,
          status: "working",
          checkpointBefore: null,
          checkpointAfter: null,
          startedAt: event.at,
          endedAt: null,
        }),
      });

/** Session States that take a new Turn (with no Turn in flight). */
export const takesTurn = (record: SessionRecord): boolean => {
  if (workingTurn(record) !== undefined || record.session.worktreeSetup?.status === "running")
    return false;
  const { state } = record.session;

  if (state === "idle" || state === "dormant" || state === "failed") return true;

  // Needs You after a Daemon restart (an Interrupted Turn, nothing pending) takes a new Turn too.
  return state === "needs-you" && record.pending.size === 0;
};

/** Why a new or continued Turn is refused, in the order the checks read to a user. */
export const turnRefusal = (record: SessionRecord, kind: "send" | "continue" | "retry"): string => {
  const { state } = record.session;

  if (record.session.worktreeSetup?.status === "running") return "worktree setup is still running";

  const last = lastTurn(record)?.status;

  if (kind === "retry" && last !== "failed") return "there is no Failed Turn to retry";

  if (kind === "continue" && last !== "interrupted") {
    return "there is no Interrupted Turn to continue";
  }

  if (kind === "continue" && lastIsAccepted(record)) {
    return "the Interrupted Turn is accepted; send a new Turn instead";
  }

  if (kind !== "send") return `the session is ${state}`;

  if (state === "archived") return "the session is Archived";

  if (state === "in-terminal") return "the session is In Terminal; return it first";

  return `the session is ${state}; wait for the Turn to end`;
};
