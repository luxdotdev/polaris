import {
  Attempt,
  type AttemptId,
  Constellation,
  ConstellationEvent,
  type ConstellationId,
  type ConstellationQuestion,
  type DomainEvent,
  type TaskDefinition,
  type TaskId,
  Task,
} from "@polaris/protocol";
import { attemptData, graphData, taskData } from "../constellation/data.ts";
import { Predicate } from "effect";

export interface GraphQuestion {
  readonly attemptId: AttemptId;
  readonly question: ConstellationQuestion;
  readonly answer: string | null;
}

export interface ConstellationRecord {
  readonly graph: Constellation;
  readonly promoted: ReadonlySet<TaskId>;
  readonly proposals: ReadonlyMap<
    string,
    { readonly by: AttemptId; readonly task: TaskDefinition }
  >;
  readonly questions: ReadonlyMap<string, GraphQuestion>;
  readonly messages: ReadonlyMap<
    string,
    Extract<ConstellationEvent, { _tag: "OperatorMessageSent" }>
  >;
  readonly delivered: ReadonlySet<string>;
  readonly recoveries: ReadonlySet<string>;
  readonly progress: ReadonlyMap<
    AttemptId,
    Extract<ConstellationEvent, { _tag: "AttemptProgressed" }>
  >;
}

export const constellationOf = (event: DomainEvent): ConstellationId | null =>
  "constellationId" in event ? event.constellationId : null;

export const graphEvent = (event: DomainEvent): ConstellationEvent | null => {
  if (!("constellationId" in event)) return null;

  return event;
};

export const questionKey = (attemptId: AttemptId, id: string) => JSON.stringify([attemptId, id]);

const replace = <A extends { readonly id: string }>(items: ReadonlyArray<A>, next: A) =>
  items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];

const patchAttempt = (
  record: ConstellationRecord,
  event: { readonly attemptId: AttemptId; readonly attemptRevision: number },
  patch: Partial<typeof Attempt.Type>
) => {
  const current = record.graph.attempts.find((a) => a.id === event.attemptId);

  return current === undefined
    ? record.graph.attempts
    : replace(
        record.graph.attempts,
        new Attempt({ ...attemptData(current), ...patch, revision: event.attemptRevision })
      );
};

const started = (graph: Constellation): ConstellationRecord => ({
  graph,
  promoted: new Set(),
  proposals: new Map(),
  questions: new Map(),
  messages: new Map(),
  delivered: new Set(),
  recoveries: new Set(),
  progress: new Map(),
});

/** Fold durable graph and delivery metadata; no lifecycle or readiness is inferred here. */
export const foldConstellation = (
  record: ConstellationRecord | undefined,
  event: ConstellationEvent,
  at: string
): ConstellationRecord | undefined => {
  if (Predicate.isTagged(event, "ConstellationStarted")) return started(event.constellation);

  if (record === undefined) return undefined;
  let next = record;

  let graph = new Constellation({
    ...graphData(record.graph),
    revision: event.revision,
    updatedAt: at,
  });

  ConstellationEvent.match(event, {
    ConstellationStarted: () => {},
    ConstellationStateChanged: (e) => {
      graph = new Constellation({ ...graphData(graph), state: e.state });
    },
    LeadChanged: (e) => {
      graph = new Constellation({ ...graphData(graph), leadSessionId: e.to });
    },
    TaskDeclared: (e) => {
      graph = new Constellation({ ...graphData(graph), tasks: replace(graph.tasks, e.task) });
    },
    TaskEdited: (e) => {
      graph = new Constellation({ ...graphData(graph), tasks: replace(graph.tasks, e.task) });
    },
    TaskCanceled: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        tasks: graph.tasks.map((t) =>
          t.id === e.taskId
            ? new Task({ ...taskData(t), canceled: true, revision: e.taskRevision })
            : t
        ),
      });
    },
    TaskProposed: (e) => {
      next = {
        ...next,
        proposals: new Map([...next.proposals, [e.proposalId, { by: e.by, task: e.task }]]),
      };
    },
    ProposalAccepted: (e) => {
      const proposals = new Map(next.proposals);
      proposals.delete(e.proposalId);
      next = { ...next, proposals };
      graph = new Constellation({ ...graphData(graph), tasks: replace(graph.tasks, e.task) });
    },
    ProposalDeclined: (e) => {
      const proposals = new Map(next.proposals);
      proposals.delete(e.proposalId);
      next = { ...next, proposals };
    },
    AttemptStarted: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: replace(graph.attempts, e.attempt),
      });
    },
    AttemptProgressed: (e) => {
      graph = new Constellation({ ...graphData(graph), attempts: patchAttempt(next, e, {}) });
      next = { ...next, progress: new Map([...next.progress, [e.attemptId, e]]) };
    },
    AttemptClaimed: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { state: "review", claim: e.claim }),
      });
    },
    ClaimApproved: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { approvedByUserAt: e.at }),
      });
    },
    ClaimHandedUp: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { handedUpAt: e.at, handedUpReason: e.reason }),
      });
    },
    AttemptNudged: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { nudgedAt: e.at }),
      });
    },
    AttemptAccepted: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, {
          state: "accepted",
          mergedHead: e.mergedHead,
          receipts: e.receipts,
          evidence: e.evidence,
          endedAt: at,
        }),
      });
    },
    AttemptRejected: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { state: "rejected", endedAt: at }),
      });
    },
    AttemptSettled: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        attempts: patchAttempt(next, e, { state: e.outcome, endedAt: at }),
      });
    },
    GatePromoted: (e) => {
      next = { ...next, promoted: new Set([...next.promoted, e.taskId]) };
      graph = new Constellation({
        ...graphData(graph),
        tasks: graph.tasks.map((t) =>
          t.id === e.taskId
            ? new Task({ ...taskData(t), canceled: t.canceled, revision: e.taskRevision })
            : t
        ),
      });
    },
    NotificationQueued: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        pendingNotifications: [...graph.pendingNotifications, e.notification],
      });

      if (Predicate.isTagged(e.notification.item, "Question")) {
        const { attemptId, question } = e.notification.item;
        next = {
          ...next,
          questions: new Map([
            ...next.questions,
            [questionKey(attemptId, question.id), { attemptId, question, answer: null }],
          ]),
        };
      }
    },
    LeadNotified: (e) => {
      graph = new Constellation({
        ...graphData(graph),
        pendingNotifications: graph.pendingNotifications.filter((n) => !e.items.includes(n.id)),
      });
      next = { ...next, delivered: new Set([...next.delivered, ...e.items]) };
    },
    OperatorMessageSent: (e) => {
      next = { ...next, messages: new Map([...next.messages, [e.id, e]]) };

      if (e.questionId !== null && Predicate.isTagged(e.target, "Worker")) {
        const key = questionKey(e.target.attemptId, e.questionId);
        const question = next.questions.get(key);

        if (question !== undefined)
          next = {
            ...next,
            questions: new Map([...next.questions, [key, { ...question, answer: e.text }]]),
          };
      }
    },
    OperatorMessageResolved: (e) => {
      const messages = new Map(next.messages);
      messages.delete(e.id);
      next = { ...next, messages };
    },
    PeerMessage: () => {},
    AttemptRecoveryContinued: (e) => {
      next = {
        ...next,
        recoveries: new Set([...next.recoveries, JSON.stringify([e.attemptId, e.interruptionId])]),
      };
      graph = new Constellation({ ...graphData(graph), attempts: patchAttempt(next, e, {}) });
    },
  });

  return { ...next, graph };
};
