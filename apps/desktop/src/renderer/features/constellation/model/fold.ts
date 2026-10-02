/**
 * Folds Constellation events into the read model, from a Host feed or a Constellation stream.
 * Pure; projections are derived once per batch, not per event.
 */
import {
  type ConstellationEvent,
  constellationEventFields,
  type ConstellationStreamItem,
  type DomainEvent,
  type HostStreamItem,
} from "@polaris/protocol";
import { Match, Predicate } from "effect";
import { deriveProjections } from "./project.ts";
import type {
  AttemptData,
  AttemptId,
  ConstellationData,
  ConstellationRecord,
  ConstellationsModel,
  Handover,
  ProjectionData,
  TaskData,
} from "./types.ts";

type Plainly<T> = { readonly [K in keyof T]: T[K] };

type Event = Plainly<ConstellationEvent>;

const TAGS: ReadonlySet<string> = new Set(Object.keys(constellationEventFields));

export const isConstellationEvent = (event: Plainly<DomainEvent>): event is Event =>
  TAGS.has(event._tag);

/** A record for a graph as a Snapshot has it, keeping what only events carried before. */
export const recordFrom = (
  constellation: ConstellationData,
  sequence: number,
  projections: ReadonlyArray<ProjectionData> = [],
  prior?: ConstellationRecord
): ConstellationRecord => ({
  constellation,
  projections: deriveProjections(constellation, projections),
  sequence,
  proposals: prior?.proposals ?? [],
  handovers: prior?.handovers ?? [],
  digests: prior?.digests ?? [],
  notifications: new Map([
    ...(prior?.notifications ?? []),
    ...(constellation.pendingNotifications ?? []).map((n) => [n.id, n] as const),
  ]),
  progress: prior?.progress ?? new Map(),
  claimedAt: prior?.claimedAt ?? new Map(),
  messages: prior?.messages ?? [],
});

type Step = (r: ConstellationRecord) => ConstellationRecord;

/** Values arrive as plain records (structured clone), so updating one is a plain merge. */
export const merged = <T extends object>(value: T, patch: Partial<T>): T =>
  Object.assign({}, value, patch);

const graph =
  (f: (c: ConstellationData) => ConstellationData): Step =>
  (r) => ({ ...r, constellation: f(r.constellation) });

const upsertTask = (task: TaskData): Step =>
  graph((c) => ({
    ...c,
    tasks: c.tasks.some((t) => t.id === task.id)
      ? c.tasks.map((t) => (t.id === task.id ? task : t))
      : [...c.tasks, task],
  }));

const patchAttempt = (
  id: AttemptId,
  revision: number,
  patch: (a: AttemptData) => Partial<AttemptData>
): Step =>
  graph((c) => ({
    ...c,
    attempts: c.attempts.map((a) => (a.id === id ? merged(a, { ...patch(a), revision }) : a)),
  }));

const withoutProposal =
  (proposalId: string): Step =>
  (r) => ({ ...r, proposals: r.proposals.filter((p) => p.proposalId !== proposalId) });

const answered = (questionId: string): Step =>
  graph((c) => ({
    ...c,
    pendingNotifications: (c.pendingNotifications ?? []).filter(
      (n) => !Predicate.isTagged(n.item, "Question") || n.item.question.id !== questionId
    ),
  }));

/** Appends unless an item with the same key is there: an event can arrive on two feeds. */
const appendOnce = <T>(list: ReadonlyArray<T>, item: T, key: (t: T) => string | number) =>
  list.some((x) => key(x) === key(item)) ? list : [...list, item];

const compose =
  (...steps: ReadonlyArray<Step>): Step =>
  (r) =>
    steps.reduce((acc, step) => step(acc), r);

const beforeHandover = (r: ConstellationRecord): Handover["before"] => ({
  projections: deriveProjections(r.constellation, r.projections),
  inFlight: r.constellation.attempts.filter((a) => a.state === "working" || a.state === "review"),
  questions: (r.constellation.pendingNotifications ?? []).filter((n) =>
    Predicate.isTagged(n.item, "Question")
  ),
  undelivered: r.messages,
});

/** The step for one event on an existing record. */
const stepFor = (event: Event, at: string): Step =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      ConstellationStarted: () => (r: ConstellationRecord) => r,
      ConstellationStateChanged: ({ state }) => graph((c) => ({ ...c, state })),
      LeadChanged: ({ from, to, summary, revision }) =>
        compose(
          graph((c) => ({ ...c, leadSessionId: to })),
          (r) => ({
            ...r,
            handovers: appendOnce(
              r.handovers,
              { from, to, summary, revision, at, before: beforeHandover(r) },
              (h) => h.revision
            ),
          })
        ),
      TaskDeclared: ({ task }) => upsertTask(task),
      TaskEdited: ({ task }) => upsertTask(task),
      TaskCanceled: ({ taskId, taskRevision }) =>
        graph((c) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === taskId ? merged(t, { canceled: true, revision: taskRevision }) : t
          ),
        })),
      TaskProposed:
        ({ proposalId, by, task }) =>
        (r: ConstellationRecord) => ({
          ...r,
          proposals: appendOnce(r.proposals, { proposalId, by, task, at }, (x) => x.proposalId),
        }),
      ProposalAccepted: ({ proposalId, task }) =>
        compose(withoutProposal(proposalId), upsertTask(task)),
      ProposalDeclined: ({ proposalId }) => withoutProposal(proposalId),
      AttemptStarted: ({ attempt }) =>
        graph((c) => ({
          ...c,
          attempts: [...c.attempts.filter((a) => a.id !== attempt.id), attempt],
        })),
      AttemptProgressed: ({ attemptId, attemptRevision, note, completed, total }) =>
        compose(
          patchAttempt(attemptId, attemptRevision, () => ({})),
          (r) => ({
            ...r,
            progress: new Map(r.progress).set(attemptId, {
              note,
              completed: completed ?? null,
              total: total ?? null,
              at,
            }),
          })
        ),
      ClaimApproved: ({ attemptId, attemptRevision, at: approvedByUserAt }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ approvedByUserAt })),
      ClaimHandedUp: ({ attemptId, attemptRevision, at: handedUpAt, reason: handedUpReason }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ handedUpAt, handedUpReason })),
      AttemptNudged: ({ attemptId, attemptRevision, at: nudgedAt }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ nudgedAt })),
      AttemptClaimed: ({ attemptId, attemptRevision, claim }) =>
        compose(
          patchAttempt(attemptId, attemptRevision, () => ({ state: "review", claim })),
          (r) => ({
            ...r,
            claimedAt: new Map(r.claimedAt).set(attemptId, at),
          })
        ),
      AttemptAccepted: ({ attemptId, attemptRevision, mergedHead, receipts, evidence }) =>
        patchAttempt(attemptId, attemptRevision, () => ({
          state: "accepted",
          mergedHead,
          receipts,
          evidence,
          endedAt: at,
        })),
      AttemptRejected: ({ attemptId, attemptRevision }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ state: "rejected", endedAt: at })),
      AttemptSettled: ({ attemptId, attemptRevision, outcome }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ state: outcome, endedAt: at })),
      GatePromoted: () => (r: ConstellationRecord) => r,
      NotificationQueued: ({ notification }) =>
        compose(
          graph((c) => ({
            ...c,
            pendingNotifications: appendOnce(
              c.pendingNotifications ?? [],
              notification,
              (n) => n.id
            ),
          })),
          (r) => ({
            ...r,
            notifications: new Map(r.notifications).set(notification.id, notification),
          })
        ),
      LeadNotified: ({ items, turnId, leadSessionId, revision }) =>
        compose(
          (r) => ({
            ...r,
            digests: appendOnce(
              r.digests,
              {
                turnId,
                leadSessionId,
                revision,
                at,
                items: items.flatMap((id) => {
                  const n = r.notifications.get(id);

                  return n === undefined ? [] : [n];
                }),
              },
              (d) => d.turnId
            ),
          }),
          graph((c) => ({
            ...c,
            pendingNotifications: (c.pendingNotifications ?? []).filter(
              (n) => !items.includes(n.id)
            ),
          }))
        ),
      OperatorMessageSent: ({ id, authority, target, text, questionId }) =>
        compose(
          (r) => ({
            ...r,
            messages: appendOnce(r.messages, { id, authority, target, text, at }, (m) => m.id),
          }),
          questionId == null ? (r: ConstellationRecord) => r : answered(questionId)
        ),
      OperatorMessageResolved:
        ({ id }) =>
        (r: ConstellationRecord) => ({
          ...r,
          messages: r.messages.filter((m) => m.id !== id),
        }),
      PeerMessage: () => (r: ConstellationRecord) => r,
      AttemptRecoveryContinued: ({ attemptId, attemptRevision }) =>
        patchAttempt(attemptId, attemptRevision, () => ({})),
    })
  );

/** Applies one event; a `ConstellationStarted` creates the record. */
export const applyEvent = (
  record: ConstellationRecord | undefined,
  event: Event,
  at: string,
  sequence: number
): ConstellationRecord | undefined => {
  if (Predicate.isTagged(event, "ConstellationStarted"))
    return record ?? recordFrom(event.constellation, sequence);

  // Already folded from the other feed (Host feed and Constellation stream both carry it).
  if (record === undefined || event.revision < record.constellation.revision) return record;
  const next = stepFor(event, at)(record);

  return {
    ...next,
    sequence,
    constellation: { ...next.constellation, revision: event.revision, updatedAt: at },
  };
};

interface Envelope {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly event: Plainly<DomainEvent>;
}

/** Folds envelopes into a Host's model, deriving projections once per touched graph. */
export const applyEnvelopes = (
  model: ConstellationsModel,
  envelopes: ReadonlyArray<Envelope>
): ConstellationsModel => {
  const byId = new Map(model.byId);
  const touched = new Set<string>();

  for (const { event, occurredAt, sequence } of envelopes) {
    if (!isConstellationEvent(event)) continue;
    const id = event.constellationId;
    const next = applyEvent(byId.get(id), event, occurredAt, sequence);

    if (next === undefined) continue;
    byId.set(id, next);
    touched.add(id);
  }

  if (touched.size === 0) return model;

  for (const id of touched) {
    const r = byId.get(id);

    if (r !== undefined)
      byId.set(id, { ...r, projections: deriveProjections(r.constellation, r.projections) });
  }

  return { byId };
};

/** A Host Snapshot's graphs replace the model's, keeping their event-only extras. */
export const applySnapshot = (
  model: ConstellationsModel,
  constellations: ReadonlyArray<ConstellationData>,
  sequence: number
): ConstellationsModel => ({
  byId: new Map(
    constellations.map((c) => [c.id, recordFrom(c, sequence, [], model.byId.get(c.id))])
  ),
});

type HostItem = Plainly<HostStreamItem>;

/** The Constellation part of a frame of Host feed items. */
export const applyHostItems = (
  model: ConstellationsModel,
  items: ReadonlyArray<HostItem>
): ConstellationsModel => {
  let next = model;
  const pending: Array<Envelope> = [];

  const flush = () => {
    next = applyEnvelopes(next, pending.splice(0));
  };

  for (const item of items) {
    if (Predicate.isTagged(item, "Event")) pending.push(item.envelope);
    else if (Predicate.isTagged(item, "Snapshot") && item.constellations !== undefined) {
      flush();
      next = applySnapshot(next, item.constellations, item.sequence);
    }
  }

  flush();

  return next;
};

type StreamItem = Plainly<ConstellationStreamItem>;

/** Ephemeral liveness lands on the projection whose latest Attempt it is; a replaced one is dropped. */
const withLiveness = (
  model: ConstellationsModel,
  attemptId: string,
  liveness: ProjectionData["liveness"]
): ConstellationsModel => {
  for (const [id, r] of model.byId) {
    const at = r.projections.findIndex((p) => p.latestAttemptId === attemptId);

    if (at === -1) continue;
    const projections = r.projections.map((p, n) => (n === at ? merged(p, { liveness }) : p));

    return { byId: new Map(model.byId).set(id, { ...r, projections }) };
  }

  return model;
};

/** One `constellation.subscribe` feed's items, for a graph on another Host's stream. */
export const applyStreamItems = (
  model: ConstellationsModel,
  items: ReadonlyArray<StreamItem>
): ConstellationsModel => {
  let next = model;

  for (const item of items) {
    if (Predicate.isTagged(item, "Snapshot")) {
      const byId = new Map(next.byId);
      const { constellation, projections, sequence } = item;
      const prior = byId.get(constellation.id);
      // The Host feed may already be past this Snapshot: keep its graph, take the flags.
      const ahead = prior !== undefined && prior.constellation.revision > constellation.revision;

      byId.set(
        constellation.id,
        ahead
          ? { ...prior, projections: deriveProjections(prior.constellation, projections) }
          : recordFrom(constellation, sequence, projections, prior)
      );
      next = { byId };
    } else if (Predicate.isTagged(item, "Event")) next = applyEnvelopes(next, [item.envelope]);
    else if (Predicate.isTagged(item, "LivenessChanged"))
      next = withLiveness(next, item.attemptId, item.liveness);
  }

  return next;
};

/** Graphs as views (shellui's fixtures) into the store's per-Host models. */
export const modelsFromViews = (
  byHost: Readonly<
    Record<
      string,
      ReadonlyArray<{
        readonly constellation: ConstellationData;
        readonly projections: ReadonlyArray<ProjectionData>;
      }>
    >
  >
): Readonly<Record<string, ConstellationsModel>> =>
  Object.fromEntries(
    Object.entries(byHost).map(([hostKey, views]) => [
      hostKey,
      {
        byId: new Map(
          views.map((v) => [v.constellation.id, recordFrom(v.constellation, 0, v.projections)])
        ),
      },
    ])
  );
