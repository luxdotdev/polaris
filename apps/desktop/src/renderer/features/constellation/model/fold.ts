/**
 * The read model's folds: the Host feed keeps a listing of graphs; each graph's own stream
 * (Snapshot, then events, then liveness) is the only source of its contents. Pure.
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
  SummaryData,
  TaskData,
} from "./types.ts";

type Plainly<T> = { readonly [K in keyof T]: T[K] };

type Event = Plainly<ConstellationEvent>;

const TAGS: ReadonlySet<string> = new Set(Object.keys(constellationEventFields));

export const isConstellationEvent = (event: Plainly<DomainEvent>): event is Event =>
  TAGS.has(event._tag);

type SnapshotItem = Extract<Plainly<ConstellationStreamItem>, { readonly _tag: "Snapshot" }>;

/** A record exactly as a stream Snapshot has it. */
export const recordFrom = (
  snapshot: Omit<SnapshotItem, "_tag" | "sequence"> & { readonly sequence: number }
): ConstellationRecord => ({
  constellation: snapshot.constellation,
  projections: snapshot.projections,
  sequence: snapshot.sequence,
  proposals: snapshot.proposals,
  handovers: snapshot.handovers,
  digests: snapshot.digests,
  notifications: new Map(
    [
      ...snapshot.digests.flatMap((d) => d.items),
      ...snapshot.constellation.pendingNotifications,
    ].map((n) => [n.id, n] as const)
  ),
  progress: new Map(snapshot.progress.map((p) => [p.attemptId, p])),
  messages: snapshot.messages,
});

/** A record for a graph as it starts (its `ConstellationStarted`), with nothing else yet. */
export const startedRecord = (
  constellation: ConstellationData,
  sequence: number
): ConstellationRecord =>
  recordFrom({
    sequence,
    constellation,
    projections: deriveProjections(constellation),
    proposals: [],
    progress: [],
    messages: [],
    digests: [],
    handovers: [],
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
    pendingNotifications: c.pendingNotifications.filter(
      (n) => !Predicate.isTagged(n.item, "Question") || n.item.question.id !== questionId
    ),
  }));

const compose =
  (...steps: ReadonlyArray<Step>): Step =>
  (r) =>
    steps.reduce((acc, step) => step(acc), r);

/** The handover record as the owner keeps it: the graph as it stood at the switch. */
const handoverOf = (
  r: ConstellationRecord,
  e: Pick<Handover, "from" | "to" | "summary" | "revision">,
  at: string
): Handover => ({
  from: e.from,
  to: e.to,
  summary: e.summary,
  revision: e.revision,
  at,
  projections: r.projections,
  inFlight: r.constellation.attempts.flatMap((a) =>
    a.state === "working" || a.state === "blocked" || a.state === "review" ? [a.id] : []
  ),
  questions: r.constellation.pendingNotifications.filter((n) =>
    Predicate.isTagged(n.item, "Question")
  ),
  undelivered: r.messages,
});

/** The step for one event on an existing record. */
const stepFor = (event: Event, at: string): Step =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      LeadHandoverRequested: () => (r: ConstellationRecord) => r,
      LeadHandoverCancelled: () => (r: ConstellationRecord) => r,
      WorkerInputDelivered: () => (r: ConstellationRecord) => r,
      AttemptInterrupted: () => (r: ConstellationRecord) => r,
      AttemptStale:
        ({ attemptId }) =>
        (r: ConstellationRecord) => ({
          ...r,
          projections: r.projections.map((p) =>
            p.latestAttemptId === attemptId ? { ...p, stale: true } : p
          ),
        }),
      AttemptFresh:
        ({ attemptId }) =>
        (r: ConstellationRecord) => ({
          ...r,
          projections: r.projections.map((p) =>
            p.latestAttemptId === attemptId ? { ...p, stale: false } : p
          ),
        }),
      ConstellationStarted: () => (r: ConstellationRecord) => r,
      ConstellationStateChanged: ({ state }) => graph((c) => ({ ...c, state })),
      LeadChanged: (e) =>
        compose(
          (r) => ({ ...r, handovers: [...r.handovers, handoverOf(r, e, at)] }),
          graph((c) => ({ ...c, leadSessionId: e.to }))
        ),
      TaskDeclared: ({ task }) => upsertTask(task),
      TaskEdited: ({ task }) => upsertTask(task),
      TaskCanceled: ({ taskId, taskRevision }) =>
        graph((c) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === taskId ? merged(t, { canceled: true, revision: taskRevision }) : t
          ),
          attempts: c.attempts.map((a) =>
            a.state === "blocked"
              ? merged(a, { blockedOn: a.blockedOn.filter((id) => id !== taskId) })
              : a
          ),
        })),
      TaskProposed:
        ({ proposalId, by, task }) =>
        (r: ConstellationRecord) => ({
          ...r,
          proposals: [...r.proposals, { proposalId, by, task, at }],
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
              attemptId,
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
      AttemptBlocked: ({ attemptId, attemptRevision, on, reason, at: blockedAt }) =>
        patchAttempt(attemptId, attemptRevision, () => ({
          state: "blocked",
          blockedOn: on,
          blockedReason: reason,
          blockedAt,
        })),
      AttemptUnblocked: ({ attemptId, attemptRevision }) =>
        patchAttempt(attemptId, attemptRevision, () => ({
          state: "working",
          blockedOn: [],
          blockedReason: null,
          blockedAt: null,
          nudgedAt: null,
        })),
      AttemptNudged: ({ attemptId, attemptRevision, at: nudgedAt }) =>
        patchAttempt(attemptId, attemptRevision, () => ({ nudgedAt })),
      AttemptClaimed: ({ attemptId, attemptRevision, claim }) =>
        patchAttempt(attemptId, attemptRevision, () => ({
          state: "review",
          claim,
          claimedAt: at,
          approvedByUserAt: null,
          handedUpAt: null,
          handedUpReason: null,
          nudgedAt: null,
        })),
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
            pendingNotifications: [...c.pendingNotifications, notification],
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
            digests: [
              ...r.digests,
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
            ],
          }),
          graph((c) => ({
            ...c,
            pendingNotifications: c.pendingNotifications.filter((n) => !items.includes(n.id)),
          }))
        ),
      OperatorMessageSent: ({ id, authority, target, text, questionId }) =>
        compose(
          (r) => ({
            ...r,
            messages: [...r.messages, { id, authority, target, text, at }],
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

/** Applies one stream event to its graph; a `ConstellationStarted` creates the record. */
export const applyEvent = (
  record: ConstellationRecord | undefined,
  event: Event,
  at: string,
  sequence: number
): ConstellationRecord | undefined => {
  if (Predicate.isTagged(event, "ConstellationStarted"))
    return startedRecord(event.constellation, sequence);

  if (record === undefined) return undefined;
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

const withRecord = (
  model: ConstellationsModel,
  id: string,
  record: ConstellationRecord | undefined
): ConstellationsModel =>
  record === undefined ? model : { ...model, byId: new Map(model.byId).set(id, record) };

/** Folds one graph's stream events, deriving its projections once for the batch. */
export const applyEnvelopes = (
  model: ConstellationsModel,
  envelopes: ReadonlyArray<Envelope>
): ConstellationsModel => {
  let next = model;
  const touched = new Set<string>();

  for (const { event, occurredAt, sequence } of envelopes) {
    if (!isConstellationEvent(event)) continue;
    const id = event.constellationId;

    next = withRecord(next, id, applyEvent(next.byId.get(id), event, occurredAt, sequence));
    touched.add(id);
  }

  for (const id of touched) {
    const r = next.byId.get(id);

    if (r !== undefined)
      next = withRecord(next, id, {
        ...r,
        projections: deriveProjections(r.constellation, r.projections),
      });
  }

  return next;
};

type HostItem = Plainly<HostStreamItem>;

const listedFrom = (c: ConstellationData): SummaryData => ({
  id: c.id,
  workspaceId: c.workspaceId,
  hostId: c.hostId,
  leadSessionId: c.leadSessionId,
  name: c.name,
  state: c.state,
  createdAt: c.createdAt,
});

/** A listing event (the only Constellation events on the Host feed) updates the listing. */
const listEvent = (
  listed: ReadonlyMap<string, SummaryData>,
  event: Plainly<DomainEvent>
): ReadonlyMap<string, SummaryData> => {
  if (Predicate.isTagged(event, "ConstellationStarted"))
    return new Map(listed).set(event.constellationId, listedFrom(event.constellation));
  const prior = isConstellationEvent(event) ? listed.get(event.constellationId) : undefined;

  if (prior === undefined) return listed;

  if (Predicate.isTagged(event, "ConstellationStateChanged"))
    return new Map(listed).set(prior.id, { ...prior, state: event.state });

  return Predicate.isTagged(event, "LeadChanged")
    ? new Map(listed).set(prior.id, { ...prior, leadSessionId: event.to })
    : listed;
};

/** The Host feed's part: its Snapshot's listing and the listing events after it. */
export const applyHostItems = (
  model: ConstellationsModel,
  items: ReadonlyArray<HostItem>
): ConstellationsModel => {
  let listed = model.listed;

  for (const item of items) {
    if (Predicate.isTagged(item, "Snapshot"))
      listed = new Map((item.constellations ?? []).map((c) => [c.id, c]));
    else if (Predicate.isTagged(item, "Event")) listed = listEvent(listed, item.envelope.event);
  }

  return listed === model.listed ? model : { ...model, listed };
};

type StreamItem = Plainly<ConstellationStreamItem>;

/** Liveness lands on the projection whose latest Attempt it names; a replaced one is dropped. */
const withLiveness = (
  model: ConstellationsModel,
  attemptId: string,
  liveness: ProjectionData["liveness"]
): ConstellationsModel => {
  for (const [id, r] of model.byId) {
    const at = r.projections.findIndex((p) => p.latestAttemptId === attemptId);

    if (at === -1) continue;
    const projections = r.projections.map((p, n) => (n === at ? merged(p, { liveness }) : p));

    return withRecord(model, id, { ...r, projections });
  }

  return model;
};

const withBranchFetched = (
  model: ConstellationsModel,
  attemptId: string,
  branchFetched: boolean
): ConstellationsModel => {
  for (const [id, r] of model.byId) {
    if (!r.projections.some((p) => p.latestAttemptId === attemptId)) continue;

    const projections = r.projections.map((p) =>
      p.latestAttemptId === attemptId ? merged(p, { branchFetched }) : p
    );

    return withRecord(model, id, { ...r, projections });
  }

  return model;
};

/** One graph's `constellation.subscribe` items: Snapshot, events and liveness. */
export const applyStreamItems = (
  model: ConstellationsModel,
  items: ReadonlyArray<StreamItem>
): ConstellationsModel => {
  let next = model;

  for (const item of items) {
    if (Predicate.isTagged(item, "Snapshot"))
      next = withRecord(next, item.constellation.id, recordFrom(item));
    else if (Predicate.isTagged(item, "Event")) next = applyEnvelopes(next, [item.envelope]);
    else if (Predicate.isTagged(item, "BranchFetched"))
      next = withBranchFetched(next, item.attemptId, item.branchFetched);
    else if (Predicate.isTagged(item, "LivenessChanged"))
      next = withLiveness(next, item.attemptId, item.liveness);
  }

  return next;
};

/** Graphs as views (shellui's fixtures) into the store's per-Host models, listed and loaded. */
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
        listed: new Map(views.map((v) => [v.constellation.id, listedFrom(v.constellation)])),
        byId: new Map(
          views.map((v) => [
            v.constellation.id,
            { ...startedRecord(v.constellation, 0), projections: v.projections },
          ])
        ),
      },
    ])
  );
