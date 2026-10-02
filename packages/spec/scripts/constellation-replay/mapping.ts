import type { ReplayContext, ReplayResourceEvent } from "./index.ts";
import { Match } from "effect";
import type { ConstellationEvent } from "../../../protocol/src/constellation/events.ts";

export class ReplayIds {
  readonly values = new Map<string, number>();

  id(value: string): number {
    const existing = this.values.get(value);

    if (existing !== undefined) return existing;
    const id = this.values.size;
    this.values.set(value, id);

    return id;
  }

  set(): string {
    const ids = [...this.values.values()];

    return `Set(${(ids.length === 0 ? [0] : ids).join(", ")})`;
  }
}

export class ReplayGroup {
  readonly tasks = new ReplayIds();
  readonly sessions = new ReplayIds();
  readonly requests = new ReplayIds();
  readonly notifications = new ReplayIds();
  readonly heads = new ReplayIds();
  readonly interruptions = new ReplayIds();
  readonly handovers = new ReplayIds();
  readonly inputs = new ReplayIds();
  readonly outboxes = new ReplayIds();
  readonly attempts = new Map<string, number>();
  readonly workers = new Map<string, string>();
  readonly batches: Array<Array<string>> = [];
  readonly capacity = 1;
  isGraph = false;
  started = false;

  constructor(readonly owner: string) {}

  event(host: string, kind: string): string {
    return `{ host: ${JSON.stringify(host)}, kind: ${kind} }`;
  }

  attemptId(id: string): number {
    const index = this.attempts.get(id);

    if (index === undefined) throw new Error(`Attempt ${id} has no earlier AttemptStarted`);

    return index;
  }

  requestId(id: string): number {
    return this.requests.id(id);
  }

  outboxId(id: string): number {
    return this.outboxes.id(id);
  }
}

const taskDeclaration = (
  g: ReplayGroup,
  task: {
    readonly id: string;
    readonly deps: ReadonlyArray<string>;
    readonly kind: "task" | "gate";
  }
) =>
  `TaskDeclared({ task: ${g.tasks.id(task.id)}, deps: Set(${task.deps.map((id) => g.tasks.id(id)).join(", ")}), gate: ${task.kind === "gate"} })`;

export const mapGraphEvent = (
  g: ReplayGroup,
  event: ConstellationEvent,
  host: string,
  context?: ReplayContext
): Array<string> => {
  if (host !== g.owner) throw new Error("Constellation event was not committed by its owner");

  if (
    !g.started &&
    !Match.value(event).pipe(
      Match.tag("ConstellationStarted", () => true),
      Match.orElse(() => false)
    )
  )
    throw new Error("replay requires an earlier ConstellationStarted");
  g.isGraph = true;
  const record = (kind: string) => [g.event(host, kind)];

  return Match.value(event).pipe(
    Match.tagsExhaustive({
      ConstellationStarted: ({ constellation }) => {
        if (g.started) throw new Error("ConstellationStarted repeated");
        g.started = true;

        if (
          constellation.tasks.length > 0 ||
          constellation.attempts.length > 0 ||
          constellation.state !== "planning"
        ) {
          throw new Error(
            "replay requires the complete log from an empty planning Constellation, not a snapshot"
          );
        }

        if (constellation.hostId !== g.owner || host !== g.owner)
          throw new Error("ConstellationStarted was not committed by the owner");
        g.sessions.id(constellation.leadSessionId);

        return [];
      },
      ConstellationStateChanged: ({ state }) =>
        record(`ConstellationStateChanged(${JSON.stringify(state)})`),
      LeadHandoverRequested: ({ requestId, from }) =>
        record(
          `LeadHandoverRequested({ id: ${g.handovers.id(requestId)}, from: ${g.sessions.id(from)} })`
        ),
      LeadHandoverCancelled: ({ requestId }) =>
        record(`LeadHandoverCancelled(${g.handovers.id(requestId)})`),
      LeadChanged: ({ to, requestId }) =>
        record(
          `LeadChanged({ to: ${g.sessions.id(to)}, request: ${requestId === null ? -1 : g.handovers.id(requestId)} })`
        ),
      AttemptInterrupted: ({ attemptId, interruptionId, eligible }) =>
        record(
          `AttemptInterrupted({ attempt: ${g.attemptId(attemptId)}, interruption: ${g.interruptions.id(interruptionId)}, eligible: ${eligible} })`
        ),
      AttemptStale: ({ attemptId }) => record(`AttemptStale(${g.attemptId(attemptId)})`),
      AttemptFresh: ({ attemptId }) => record(`AttemptFresh(${g.attemptId(attemptId)})`),
      WorkerInputDelivered: ({ id, sessionId }) =>
        record(
          `WorkerInputDelivered({ id: ${g.inputs.id(id)}, session: ${g.sessions.id(sessionId)} })`
        ),
      TaskDeclared: ({ task }) => record(taskDeclaration(g, task)),
      TaskEdited: ({ task }) =>
        record(
          `TaskEdited({ task: ${g.tasks.id(task.id)}, deps: Set(${task.deps.map((id) => g.tasks.id(id)).join(", ")}) })`
        ),
      TaskCanceled: ({ taskId }) => record(`TaskCanceled(${g.tasks.id(taskId)})`),
      ProposalAccepted: ({ task }) => record(taskDeclaration(g, task)),
      TaskProposed: () => [],
      ProposalDeclined: () => [],
      AttemptStarted: ({ attempt }) => {
        if (g.attempts.has(attempt.id)) throw new Error(`AttemptStarted repeated ${attempt.id}`);
        const index = g.attempts.size;
        g.attempts.set(attempt.id, index);
        g.workers.set(attempt.id, attempt.sessionId);

        const ref = Match.value(attempt.cause).pipe(
          Match.tag("Initial", () => -1),
          Match.orElse((cause) => g.attemptId(cause.ref))
        );

        return record(
          `AttemptStarted({ task: ${g.tasks.id(attempt.taskId)}, session: ${g.sessions.id(attempt.sessionId)}, ref: ${ref} })`
        );
      },
      AttemptProgressed: ({ attemptId }) => record(`AttemptProgressed(${g.attemptId(attemptId)})`),
      AttemptClaimed: ({ attemptId, claim }) =>
        record(
          `AttemptClaimed({ attempt: ${g.attemptId(attemptId)}, sha: ${g.heads.id(claim.head)} })`
        ),
      ClaimApproved: ({ attemptId }) => record(`ClaimApproved(${g.attemptId(attemptId)})`),
      ClaimHandedUp: ({ attemptId }) => record(`ClaimHandedUp(${g.attemptId(attemptId)})`),
      AttemptNudged: ({ attemptId }) => record(`AttemptNudged(${g.attemptId(attemptId)})`),
      AttemptAccepted: ({ attemptId, mergedHead }) =>
        record(
          `AttemptAccepted({ attempt: ${g.attemptId(attemptId)}, sha: ${g.heads.id(mergedHead)} })`
        ),
      AttemptRejected: ({ attemptId }) => record(`AttemptRejected(${g.attemptId(attemptId)})`),
      AttemptSettled: ({ attemptId, outcome }) => {
        if (context === undefined)
          throw new Error(
            "AttemptSettled requires batch.context (offlineSessionIds and commanded)"
          );
        const worker = g.workers.get(attemptId);
        const stale = worker !== undefined && context.offlineSessionIds.includes(worker);

        return record(
          `AttemptSettled({ attempt: ${g.attemptId(attemptId)}, outcome: ${JSON.stringify(outcome)}, stale: ${stale}, commanded: ${context.commanded} })`
        );
      },
      GatePromoted: ({ taskId }) => record(`GatePromoted(${g.tasks.id(taskId)})`),
      NotificationQueued: ({ notification }) => {
        const kind = Match.value(notification.item).pipe(
          Match.tag("Settled", () => "settle"),
          Match.tag("Question", () => "question"),
          Match.orElse(() => "message")
        );

        return record(
          `NotificationQueued({ id: ${g.notifications.id(notification.id)}, kind: ${JSON.stringify(kind)} })`
        );
      },
      LeadNotified: ({ items, leadSessionId }) => {
        if (new Set(items).size !== items.length)
          throw new Error("LeadNotified repeats a notification ID");

        return record(
          `LeadNotified({ ids: Set(${items.map((id) => g.notifications.id(id)).join(", ")}), lead: ${g.sessions.id(leadSessionId)} })`
        );
      },
      AttemptRecoveryContinued: ({ attemptId, interruptionId }) =>
        record(
          `AttemptRecoveryContinued({ attempt: ${g.attemptId(attemptId)}, interruption: ${g.interruptions.id(interruptionId)} })`
        ),
      OperatorMessageSent: () => [],
      OperatorMessageResolved: () => [],
      PeerMessage: () => [],
    })
  );
};

export const resourceKey = (
  event: ReplayResourceEvent
): { readonly host: string; readonly name: string } =>
  Match.value(event).pipe(
    Match.tag("ResourceDeclared", ({ resource }) => ({
      host: resource.hostId,
      name: resource.name,
    })),
    Match.tag("ResourceLeased", ({ lease }) => ({ host: lease.hostId, name: lease.resource })),
    Match.orElse((resource) => ({ host: resource.hostId, name: resource.resource }))
  );

export const mapResourceEvent = (
  g: ReplayGroup,
  event: ReplayResourceEvent,
  host: string
): Array<string> => {
  const record = (kind: string) => [g.event(host, kind)];

  return Match.value(event).pipe(
    Match.tagsExhaustive({
      ResourceDeclared: ({ resource }) => {
        return record(`ResourceDeclared(${resource.capacity})`);
      },
      ResourceLeaseQueued: ({ requestId }) =>
        record(`ResourceLeaseQueued(${g.requestId(requestId)})`),
      ResourceLeased: ({ lease }) => record(`ResourceLeased(${g.requestId(lease.id)})`),
      ResourceReleased: ({ leaseId }) => record(`ResourceReleased(${g.requestId(leaseId)})`),
    })
  );
};
