/** Approval rules the Session machine applies: Secret and computer use requests' decisions, and withdrawals. */
import {
  type Actor,
  appDecisionRefusal,
  ApprovalDecision,
  DomainEvent,
  type ApprovalRequest,
  type RequestId,
} from "@polaris/protocol";
import type { SessionInput } from "./session.inputs.ts";
import { Predicate } from "effect";
import type { SessionRecord } from "../store/model.ts";
import { workingTurn } from "../store/model.ts";

/** Why a text Answer can't close `request`, or null when it can. */
const answerRefusal = (request: ApprovalRequest | undefined) => {
  if (request?.grant !== undefined) return "a Grant Approval takes an allow or a deny";

  if (request?.profileAttach !== undefined)
    return "an inspector attach takes an allow once or a deny";

  if (request?.dataSource !== undefined || request?.dataWrite !== undefined)
    return "a Data Source Approval takes an allow or a deny";

  if (request?.origin !== undefined) return "an Origin Approval takes an allow or a deny";

  return request?.kind === "secret" ? "a Secret Request takes a secret or a decline" : null;
};

/** An Allow that outlives its request: on the Host, a Data Source or the Harness's settings. */
const remembers = (decision: ApprovalDecision) =>
  Predicate.isTagged(decision, "Allow") && (decision.remember || decision.dataScope !== undefined);

/** Why a Teammate can't make `decision`: the owner's secrets, and anything past this request. */
const teammateRefusal = (request: ApprovalRequest | undefined, decision: ApprovalDecision) => {
  if (request?.kind === "secret") return "a Secret Request is the owner's to answer";

  if (remembers(decision))
    return "a Teammate allows this request only; the owner can always allow it";

  return Predicate.isTagged(decision, "Answer") && request?.kind !== "question"
    ? "a Teammate answers a permission request with an allow once or a deny"
    : null;
};

/** Why `decision` can't answer the pending request, or null when it can. */
export const decisionRefusal = (
  record: SessionRecord,
  requestId: RequestId,
  decision: ApprovalDecision,
  actor: Actor | null = null
): string | null => {
  const request = record.pending.get(requestId);

  if (request?.grant !== undefined) {
    if (
      actor != null &&
      !Predicate.isTagged(actor, "Client") &&
      !Predicate.isTagged(actor, "LinkedDevice")
    )
      return "only the user grants session authority";

    if (
      Predicate.isTagged(decision, "Allow") &&
      !request.grant.rememberable &&
      (decision.remember || decision.grantScope !== undefined)
    )
      return "an action outside the Starter chain needs approval each time";
  }

  if (
    Predicate.isTagged(decision, "Allow") &&
    decision.grantScope !== undefined &&
    request?.grant === undefined
  )
    return "only a Grant Approval takes a grant scope";

  // Only Not now answers it; turning computer use on clears it (the Daemon withdraws it).
  if (request?.kind === "computer-use" && !Predicate.isTagged(decision, "Deny"))
    return "a computer use request takes Not now, or clears once computer use is on";

  // Computer use (ADR 0107): never always for headed input, nor from an Extension.
  const app = request === undefined ? null : appDecisionRefusal(request.kind, decision, actor);

  if (app !== null) return app;

  const teammate = Predicate.isTagged(actor, "Teammate")
    ? teammateRefusal(request, decision)
    : null;

  if (teammate !== null) return teammate;
  const secret = request?.kind === "secret";
  const attach = request?.profileAttach !== undefined;

  return ApprovalDecision.match(decision, {
    Allow: (allow) => {
      if (allow.originScope !== undefined && request?.origin === undefined)
        return "only an Origin Approval takes an origin scope";

      if (attach && (allow.remember || allow.dataScope !== undefined))
        return "an inspector attach requires a new approval every time";

      return secret ? "a Secret Request takes a secret or a decline" : null;
    },
    Answer: () => answerRefusal(request),
    Deny: () => null,
    Provided: () => (secret ? null : `request ${requestId} is not a Secret Request`),
  });
};

/** The kinds computer use opens: Polaris answers its own waiting tool call, never the Harness. */
export const isComputerUseApproval = (request: Pick<ApprovalRequest, "kind">) =>
  request.kind === "app" || request.kind === "headed-input" || request.kind === "computer-use";

/** Back to Working once nothing is pending, but only with a Turn to work on. */
export const backToWork = (record: SessionRecord, closing: RequestId) =>
  record.pending.size === 1 && record.pending.has(closing) && workingTurn(record) !== undefined
    ? ({ state: "working" } as const)
    : undefined;

export interface Withdrawal {
  readonly requestId: RequestId;
  /** The Daemon withdraws a Secret Request that timed out. */
  readonly withdrawnBy: "harness" | "daemon";
  readonly reason: string;
}

export const withdrawn = (record: SessionRecord, withdrawal: Withdrawal) =>
  DomainEvent.cases.ApprovalWithdrawn.make({
    sessionId: record.session.id,
    requestId: withdrawal.requestId,
    withdrawnBy: withdrawal.withdrawnBy,
    reason: withdrawal.reason,
  });

/** Requests only the Daemon raises and answers itself: never forwarded to a Harness. */
export const daemonOwned = (
  request: Pick<ApprovalRequest, "dataSource" | "dataWrite" | "origin" | "profileAttach" | "grant">
) =>
  request.grant !== undefined ||
  request.dataSource !== undefined ||
  request.dataWrite !== undefined ||
  request.origin !== undefined ||
  request.profileAttach !== undefined;

/** One card per origin across the Session's pending requests (ADR 0098). */
const originPending = (record: SessionRecord, origin: string) =>
  [...record.pending.values()].some((request) => request.origin?.origin === origin);

/** Only the Daemon may request Data or origin access; the same pending target shares one card. */
export const canRequestDataApproval = (
  record: SessionRecord,
  event: { type: string; request: ApprovalRequest }
) => {
  if (event.type === "grant.approvalRequested") return event.request.grant !== undefined;

  if (event.request.grant !== undefined) return false;
  const target = event.request.dataSource;

  const write = event.request.dataWrite;

  const attach = event.request.profileAttach;

  const origin = event.request.origin;

  if (event.type === "inspector.approvalRequested")
    return (
      attach !== undefined && target === undefined && write === undefined && origin === undefined
    );

  if (attach !== undefined) return false;

  if (event.type === "harness.approvalRequested") return !daemonOwned(event.request);

  if (origin !== undefined)
    return target === undefined && write === undefined && !originPending(record, origin.origin);

  if (write !== undefined)
    return (
      target === undefined &&
      ![...record.pending.values()].some(
        (request) => request.dataWrite?.fingerprint === write.fingerprint
      )
    );

  if (target === undefined) return false;

  const key = (value: typeof target) =>
    JSON.stringify([
      value.sourceId,
      value.engine,
      value.host,
      value.port,
      value.database,
      value.user,
    ]);

  return ![...record.pending.values()].some(
    (request) => request.dataSource !== undefined && key(request.dataSource) === key(target)
  );
};

/** An upgrade leaves the terminal Harness alive, but its Daemon-owned approval waiters are gone. */
export const withdrawDaemonApprovals = (record: SessionRecord) =>
  [...record.pending.values()].flatMap((request) =>
    !daemonOwned(request)
      ? []
      : [
          withdrawn(record, {
            requestId: request.id,
            withdrawnBy: "daemon",
            reason: "The Daemon restarted during this approval.",
          }),
        ]
  );

/** A remembered Allow is part of the same commit as the user's decision. */
export const rememberedGrant = (
  record: SessionRecord,
  requestId: RequestId,
  decision: ApprovalDecision
): ReadonlyArray<DomainEvent> => {
  const grant = record.pending.get(requestId)?.grant;

  if (
    grant === undefined ||
    !grant.rememberable ||
    !Predicate.isTagged(decision, "Allow") ||
    !decision.remember
  )
    return [];

  return [
    DomainEvent.cases.SessionGrantRemembered.make({
      sessionId: record.session.id,
      workspaceId: record.session.workspaceId,
      kind: grant.kind,
      scope: decision.grantScope ?? "session",
    }),
  ];
};

export const resolvedApproval = (
  record: SessionRecord,
  event: Extract<SessionInput, { type: "approval.respond" }>
) =>
  DomainEvent.cases.ApprovalResolved.make({
    sessionId: record.session.id,
    requestId: event.requestId,
    decision: event.decision,
    resolvedBy: event.resolvedBy,
  });
