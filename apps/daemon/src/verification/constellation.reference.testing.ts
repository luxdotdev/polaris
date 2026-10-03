import {
  ConstellationEvent,
  type AttemptState,
  type TaskState,
  type ConstellationState,
  type DomainEvent,
} from "@polaris/protocol";
import type { ConstellationRecord } from "../store/constellation.ts";
import { graphEvent } from "../store/constellation.ts";

export interface RefTask {
  id: string;
  deps: ReadonlyArray<string>;
  parent: string | null;
  kind: "task" | "gate";
  revision: number;
  canceled: boolean;
}

export interface RefAttempt {
  id: string;
  taskId: string;
  sessionId: string;
  state: AttemptState;
  revision: number;
  head: string | null;
  evidence: string | null;
  approved: string | null;
  handedUp: string | null;
  nudged: string | null;
  rejectionReason: string | null;
}

export interface Reference {
  revision: number;
  state: ConstellationState;
  lead: string;
  tasks: Map<string, RefTask>;
  attempts: Map<string, RefAttempt>;
  promoted: Set<string>;
  pending: Set<string>;
  delivered: Set<string>;
}

export const emptyReference = (): Reference => ({
  revision: 0,
  state: "planning",
  lead: "lead",
  tasks: new Map(),
  attempts: new Map(),
  promoted: new Set(),
  pending: new Set(),
  delivered: new Set(),
});

const refTask = (task: import("@polaris/protocol").Task): RefTask => ({
  id: task.id,
  deps: task.deps,
  parent: task.parent,
  kind: task.kind,
  revision: task.revision,
  canceled: task.canceled,
});

const refAttempt = (attempt: import("@polaris/protocol").Attempt): RefAttempt => ({
  id: attempt.id,
  taskId: attempt.taskId,
  sessionId: attempt.sessionId,
  state: attempt.state,
  revision: attempt.revision,
  head: attempt.claim?.head ?? null,
  evidence: attempt.evidence,
  approved: attempt.approvedByUserAt,
  handedUp: attempt.handedUpAt,
  nudged: attempt.nudgedAt,
  rejectionReason: attempt.rejectionReason,
});

const patch = (
  ref: Reference,
  e: { readonly attemptId: string; readonly attemptRevision: number },
  change: Partial<RefAttempt>
) => {
  const old = ref.attempts.get(e.attemptId);

  if (old === undefined) throw new Error("reference: unknown attempt");
  ref.attempts.set(e.attemptId, { ...old, ...change, revision: e.attemptRevision });
};

/** Independent abstract fold: it retains only the state checked by the model properties. */
export const foldReference = (ref: Reference, events: ReadonlyArray<DomainEvent>) => {
  for (const domain of events) {
    const event = graphEvent(domain);

    if (event === null) continue;
    ref.revision = event.revision;
    ConstellationEvent.match(event, {
      ConstellationStarted: (e) => {
        ref.state = e.constellation.state;
        ref.lead = e.constellation.leadSessionId;
      },
      ConstellationStateChanged: (e) => {
        ref.state = e.state;
      },
      LeadChanged: (e) => {
        ref.lead = e.to;
      },
      TaskDeclared: (e) => {
        ref.tasks.set(e.task.id, refTask(e.task));
      },
      TaskEdited: (e) => {
        ref.tasks.set(e.task.id, refTask(e.task));
      },
      TaskCanceled: (e) => {
        const old = ref.tasks.get(e.taskId);

        if (old === undefined) throw new Error("reference: unknown task");
        ref.tasks.set(e.taskId, { ...old, canceled: true, revision: e.taskRevision });
      },
      ProposalAccepted: (e) => {
        ref.tasks.set(e.task.id, refTask(e.task));
      },
      TaskProposed: () => {},
      ProposalDeclined: () => {},
      AttemptStarted: (e) => {
        ref.attempts.set(e.attempt.id, refAttempt(e.attempt));
      },
      AttemptProgressed: (e) => patch(ref, e, {}),
      AttemptClaimed: (e) => patch(ref, e, { state: "review", head: e.claim.head }),
      ClaimApproved: (e) => patch(ref, e, { approved: e.at }),
      ClaimHandedUp: (e) => patch(ref, e, { handedUp: e.at }),
      AttemptNudged: (e) => patch(ref, e, { nudged: e.at }),
      AttemptAccepted: (e) => patch(ref, e, { state: "accepted", evidence: e.evidence }),
      AttemptRejected: (e) => patch(ref, e, { state: "rejected", rejectionReason: e.reason }),
      AttemptSettled: (e) => patch(ref, e, { state: e.outcome }),
      GatePromoted: (e) => {
        if (ref.promoted.has(e.taskId)) throw new Error("reference: gate promoted twice");
        const task = ref.tasks.get(e.taskId);

        if (
          task === undefined ||
          referenceDeps(ref, task.id).some((dep) => !referenceDone(ref, dep))
        )
          throw new Error("reference: gate promoted without acceptance");
        ref.promoted.add(e.taskId);
        task.revision = e.taskRevision;
      },
      NotificationQueued: (e) => {
        if (ref.pending.has(e.notification.id) || ref.delivered.has(e.notification.id))
          throw new Error("reference: duplicate notification");
        ref.pending.add(e.notification.id);
      },
      LeadNotified: (e) => {
        if (e.leadSessionId !== ref.lead) throw new Error("reference: old lead delivery");

        for (const id of e.items) {
          if (!ref.pending.delete(id)) throw new Error("reference: duplicate delivery");
          ref.delivered.add(id);
        }
      },
      OperatorMessageSent: () => {},
      OperatorMessageResolved: () => {},
      PeerMessage: () => {},
      LeadHandoverRequested: () => {},
      LeadHandoverCancelled: () => {},
      AttemptInterrupted: () => {},
      AttemptStale: () => {},
      AttemptFresh: () => {},
      WorkerInputDelivered: () => {},
      AttemptRecoveryContinued: (e) => patch(ref, e, {}),
    });
  }
};

export const latest = (ref: Reference, taskId: string) =>
  [...ref.attempts.values()].findLast((a) => a.taskId === taskId);

export const observeReference = (ref: Reference) => ({
  revision: ref.revision,
  state: ref.state,
  lead: ref.lead,
  tasks: [...ref.tasks.values()],
  attempts: [...ref.attempts.values()],
  promoted: [...ref.promoted],
  pending: [...ref.pending],
  delivered: [...ref.delivered],
});

export const observeFold = (record: ConstellationRecord) => ({
  revision: record.graph.revision,
  state: record.graph.state,
  lead: String(record.graph.leadSessionId),
  tasks: record.graph.tasks.map(refTask),
  attempts: record.graph.attempts.map(refAttempt),
  promoted: [...record.promoted].map(String),
  pending: record.graph.pendingNotifications.map((n) => n.id),
  delivered: [...record.delivered],
});

export const referenceDone = (ref: Reference, taskId: string): boolean => {
  const task = ref.tasks.get(taskId);

  if (task === undefined || task.canceled) return false;

  const children = [...ref.tasks.values()].filter(
    (child) => child.parent === taskId && !child.canceled
  );

  return children.length > 0
    ? referenceDeps(ref, taskId).every((dep) => referenceDone(ref, dep)) &&
        children.every((child) => referenceDone(ref, child.id))
    : latest(ref, taskId)?.state === "accepted";
};

export const referenceDeps = (ref: Reference, taskId: string): ReadonlyArray<string> => {
  const result = new Set<string>();
  let task = ref.tasks.get(taskId);

  while (task !== undefined) {
    for (const dep of task.deps) result.add(dep);
    task = task.parent === null ? undefined : ref.tasks.get(task.parent);
  }

  return [...result];
};

export const referenceState = (ref: Reference, taskId: string): TaskState => {
  const task = ref.tasks.get(taskId);

  if (task === undefined || task.canceled) return "canceled";
  const children = [...ref.tasks.values()].filter((t) => t.parent === taskId && !t.canceled);
  const ready = referenceDeps(ref, taskId).every((dep) => referenceDone(ref, dep));

  if (children.length === 0) {
    const attempt = latest(ref, taskId);

    if (attempt?.state === "accepted") return "done";

    if (attempt !== undefined && attempt.state !== "rejected") return attempt.state;

    return ready ? "ready" : "waiting";
  }

  const states = children.map((child) => referenceState(ref, child.id));

  if (states.some((state) => ["working", "review", "blocked"].includes(state))) return "working";

  if (!ready) return "waiting";

  if (states.every((state) => state === "done")) return "done";

  return states.includes("ready") ? "ready" : "waiting";
};
