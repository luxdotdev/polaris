/**
 * A fake Host for thread tests: the real effect/rpc client over in-memory
 * handlers for just the RPCs the thread calls. It numbers drafts and keeps
 * read positions like the Daemon (F3), records dispatched commands, and
 * answers cached Risk Summaries by head. It has no `review.runRiskSummary`.
 */
import type { LiveSource } from "@polaris/client/resume";
import {
  AgentSession,
  type Command,
  ComposerDraft,
  ContinuityItem,
  DomainEvent,
  EventEnvelope,
  LineRange,
  ReadPosition,
  RiskFinding,
  RiskFindingId,
  LayerRun,
  ReviewSubject,
  RiskSummary,
  RiskSummaryId,
  RiskSummaryKey,
  RiskSummaryLayers,
  RiskSummaryRef,
  Sequence,
  SessionId,
  SessionStreamItem,
  Turn,
  TurnDetail,
  TurnId,
  type TurnItem,
  WorkspaceId,
} from "@polaris/protocol";
import { Deferred, Effect, PubSub, Queue, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { type ThreadClient, ThreadRpcs } from "./source.ts";

export const at = "2026-10-27T12:00:00.000Z";

export const sessionId = SessionId.make("s-1");

export const workspaceId = WorkspaceId.make("w-1");

export const session = (fields: Partial<AgentSession> = {}) =>
  new AgentSession({
    id: sessionId,
    workspaceId,
    harness: "claude",
    title: "Polaris planning",
    cwd: "/repo",
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    ...fields,
  });

export const turn = (index: number, fields: Partial<Turn> = {}) =>
  new Turn({
    id: TurnId.make(`t-${index}`),
    sessionId,
    index,
    prompt: `prompt ${index}`,
    attachments: [],
    model: null,
    effort: null,
    status: "completed",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: at,
    endedAt: at,
    ...fields,
  });

export const snapshot = (
  turns: ReadonlyArray<{ readonly turn: Turn; readonly items?: ReadonlyArray<TurnItem> }>,
  fields: Partial<AgentSession> = {}
) =>
  SessionStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(1),
    session: session({ turnCount: turns.length, ...fields }),
    turns: turns.map(
      (entry) => new TurnDetail({ turn: entry.turn, items: entry.items ?? [], subagents: [] })
    ),
    pendingApprovals: [],
  });

export const event = (sequence: number, domain: DomainEvent) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: at,
      commandId: null,
      event: domain,
    }),
  });

export const finding = (fields: Partial<RiskFinding> = {}) =>
  new RiskFinding({
    id: RiskFindingId.make("f-1"),
    identity: "id-1",
    source: "rule",
    ruleId: "secret-like-value",
    path: "serve.ts",
    lines: new LineRange({ start: 4, end: 4, side: "new" }),
    severity: "critical",
    confidence: 1,
    title: "Secret-like value committed",
    reason: "A token in source",
    suggestion: null,
    status: "open",
    resolution: null,
    ...fields,
  });

/** A finished, rules-only session summary covering Turns through `head`. */
export const summaryAt = (head: string, findings: ReadonlyArray<RiskFinding>) =>
  new RiskSummary({
    id: RiskSummaryId.make(`sum-${head}`),
    key: new RiskSummaryKey({ repo: "/repo", mergeBase: "m0", head, since: null }),
    workspaceId,
    subject: ReviewSubject.cases.SessionTurns.make({
      sessionId,
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    status: "completed",
    layers: new RiskSummaryLayers({
      rules: new LayerRun({ status: "completed", note: null }),
      agent: new LayerRun({ status: "skipped", note: null }),
    }),
    reviewer: null,
    cost: null,
    note: null,
    findings,
    startedAt: at,
    endedAt: at,
  });

export interface FakeHost {
  readonly live: LiveSource<ThreadClient>;
  /** Sends an item down the session's feed. */
  readonly push: (item: SessionStreamItem) => Effect.Effect<void>;
  /** Another Client saves a draft. */
  readonly saveElsewhere: (text: string) => Effect.Effect<void>;
  readonly commands: ReadonlyArray<Command>;
  readonly reads: ReadonlyArray<number>;
  readonly summariesAsked: ReadonlyArray<string>;
  /** Holds saveDraft's answers until `release` (the phone waits for the Host's ack). */
  readonly holdSaves: () => void;
  readonly release: () => Effect.Effect<void>;
}

export interface FakeHostOptions {
  /** Cached Risk Summaries by the head commit they cover. */
  readonly summaries?: ReadonlyMap<string, RiskSummary>;
}

export const makeFakeHost = Effect.fnUntraced(function* (options: FakeHostOptions = {}) {
  const feed = yield* Queue.unbounded<SessionStreamItem>();
  const changes = yield* PubSub.unbounded<ContinuityItem>();
  const commands: Array<Command> = [];
  const reads: Array<number> = [];
  const summariesAsked: Array<string> = [];
  const drafts = new Map<SessionId, ComposerDraft>();
  let readPosition: ReadPosition | null = null;
  let revision = 0;
  let gate: Deferred.Deferred<void> | null = null;

  const save = (text: string) => {
    revision++;
    const draft = new ComposerDraft({ sessionId, text, revision, at });
    drafts.set(sessionId, draft);

    return Effect.as(PubSub.publish(changes, ContinuityItem.cases.Draft.make({ draft })), draft);
  };

  const handlers = ThreadRpcs.toLayer({
    subscribeSession: () => Stream.fromQueue(feed),
    dispatch: ({ command }) =>
      Effect.sync(() => {
        commands.push(command);

        return { sequence: null };
      }),
    "continuity.watch": () =>
      Stream.concat(
        Stream.make(
          ContinuityItem.cases.Snapshot.make({
            reads: readPosition === null ? [] : [readPosition],
            drafts: [...drafts.values()],
          })
        ),
        Stream.fromPubSub(changes)
      ),
    "continuity.markRead": ({ turnId }) =>
      Effect.sync(() => {
        const index = Number(turnId.slice(2));
        reads.push(index);

        if (readPosition === null || readPosition.turnIndex < index)
          readPosition = new ReadPosition({ sessionId, turnId, turnIndex: index, at });

        return readPosition;
      }),
    "continuity.saveDraft": ({ text }) =>
      Effect.flatMap(gate === null ? Effect.void : Deferred.await(gate), () => save(text)),
    "review.riskSummary": ({ ref }) =>
      Effect.sync(() =>
        RiskSummaryRef.match(ref, {
          LatestAt: ({ head }) => {
            summariesAsked.push(head);

            return options.summaries?.get(head) ?? null;
          },
          ById: () => null,
          ByKey: () => null,
        })
      ),
    "review.watchRiskSummary": ({ summaryId }) =>
      Stream.fromIterable(
        [...(options.summaries?.values() ?? [])].filter((summary) => summary.id === summaryId)
      ),
  });

  const client = yield* RpcTest.makeClient(ThreadRpcs).pipe(Effect.provide(handlers));

  const host: FakeHost = {
    live: { next: () => Effect.succeed({ epoch: 1, client }) },
    push: (item) => Effect.asVoid(Queue.offer(feed, item)),
    saveElsewhere: (text) => Effect.asVoid(save(text)),
    commands,
    reads,
    summariesAsked,
    holdSaves: () => {
      gate = Deferred.makeUnsafe<void>();
    },
    release: () => (gate === null ? Effect.void : Effect.asVoid(Deferred.succeed(gate, undefined))),
  };

  return host;
});

export const ended = (sequence: number, done: Turn) =>
  event(sequence, DomainEvent.cases.TurnEnded.make({ turn: done }));

export const started = (sequence: number, begun: Turn) =>
  event(sequence, DomainEvent.cases.TurnStarted.make({ turn: begun }));

export const stateChanged = (sequence: number, state: "working" | "idle") =>
  event(
    sequence,
    DomainEvent.cases.SessionStateChanged.make({ sessionId, state, reason: null, resetsAt: null })
  );

export const checkpoint = (sequence: number, turnIndex: number, ref: string, commit: string) =>
  event(
    sequence,
    DomainEvent.cases.CheckpointRecorded.make({
      sessionId,
      turnId: TurnId.make(`t-${turnIndex}`),
      ref,
      commit,
    })
  );
