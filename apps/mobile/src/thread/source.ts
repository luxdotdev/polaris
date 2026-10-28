/**
 * What the thread needs from one Host, as a port: the session's feed, its
 * commands, continuity (read position and draft) and the session's Risk
 * Summary findings. `daemonThreadSource` backs it with the Host's live
 * `DaemonClient` (a `ThreadClient`); tests pass one over in-memory handlers.
 */
import {
  type Command,
  CommandId,
  type ComposerDraft,
  ContinuityItem,
  Dispatch,
  GetRiskSummary,
  MarkRead,
  SaveDraft,
  type Sequence,
  SessionStreamItem,
  SubscribeSession,
  WatchContinuity,
  WatchRiskSummary,
  type ReadPosition,
  type RiskFinding,
  type RiskSummaryId,
  type SessionId,
  type TurnId,
  type WorkspaceId,
  RiskSummaryRef,
} from "@polaris/protocol";
import { type LiveSource, makeFeed, type SequenceMark } from "@polaris/client/resume";
import { Data, Effect, Predicate, Stream } from "effect";
import { type RpcClient, RpcGroup } from "effect/rpc";
import type { RpcClientError } from "effect/rpc/RpcClientError";

/** Why a call or feed failed, as the user reads it. */
export class ThreadFailure extends Data.TaggedError("ThreadFailure")<{
  readonly message: string;
}> {}

export interface ThreadSource {
  /** The session's feed across reconnects: a Snapshot first, then its changes. */
  readonly session: (sessionId: SessionId) => Stream.Stream<SessionStreamItem, ThreadFailure>;
  readonly dispatch: (command: Command) => Effect.Effect<void, ThreadFailure>;
  /** Every session's read position and draft; ends at once on a Host without continuity. */
  readonly continuity: Stream.Stream<ContinuityItem, ThreadFailure>;
  readonly markRead: (
    sessionId: SessionId,
    turnId: TurnId
  ) => Effect.Effect<ReadPosition, ThreadFailure>;
  readonly saveDraft: (
    sessionId: SessionId,
    text: string
  ) => Effect.Effect<ComposerDraft, ThreadFailure>;
  /**
   * The session's cached Risk Summary findings as they change; ends with none
   * when no summary exists. Never starts a review.
   */
  readonly findings: (
    query: FindingsQuery
  ) => Stream.Stream<ReadonlyArray<RiskFinding>, ThreadFailure>;
  /** The Daemon has `session.steer`. */
  readonly canSteer: boolean;
}

export interface FindingsQuery {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  /** The last ended Turn's after-checkpoint commit, when known (`summaryHead`). */
  readonly head: string | null;
}

/** How many Turns the first Snapshot holds; earlier ones are not on the phone. */
export const TURN_LIMIT = 200;

/** What every Daemon and transport error carries. */
interface Failed {
  readonly _tag: string;
  readonly message: string;
}

const failure = (error: Failed) =>
  new ThreadFailure({ message: error.message === "" ? error._tag : error.message });

let commandCount = 0;

/** Client-generated, so a retried dispatch is applied once. */
export const newCommandId = (): CommandId => {
  commandCount++;

  return CommandId.make(
    `mobile-${Date.now().toString(36)}-${commandCount}-${Math.random().toString(36).slice(2, 8)}`
  );
};

const isDisconnect = (error: Failed) => Predicate.isTagged(error, "RpcClientError");

/** The RPCs the thread calls; a full `DaemonClient` is one of these. */
export const ThreadRpcs = RpcGroup.make(
  SubscribeSession,
  Dispatch,
  WatchContinuity,
  MarkRead,
  SaveDraft,
  GetRiskSummary,
  WatchRiskSummary
);

export type ThreadClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ThreadRpcs>, RpcClientError>;

const markSession = SessionStreamItem.match<SequenceMark>({
  Snapshot: (item) => ({ kind: "snapshot", sequence: item.sequence }),
  Event: (item) => ({ kind: "event", sequence: item.envelope.sequence }),
  Synchronized: (item) => ({ kind: "synchronized", sequence: item.sequence }),
  Delta: () => ({ kind: "ephemeral" }),
  ItemProgress: () => ({ kind: "ephemeral" }),
});

/** A reopened watch starts with a fresh Snapshot, which replaces everything. */
const markContinuity = ContinuityItem.match<SequenceMark>({
  Snapshot: () => ({ kind: "snapshot", sequence: 0 }),
  Read: () => ({ kind: "ephemeral" }),
  Draft: () => ({ kind: "ephemeral" }),
});

export interface DaemonThreadOptions {
  readonly live: LiveSource<ThreadClient>;
  readonly capabilities: ReadonlySet<string>;
  /** A Workspace's path on the Host: a session summary's `repo`. */
  readonly workspacePath: (workspaceId: WorkspaceId) => string | null;
  /** The summary Review last opened for the session, when the head isn't known. */
  readonly summaryOf?: (sessionId: SessionId) => RiskSummaryId | null;
}

/** The latest connection's client, waiting for one while the Host reconnects. */
const withClient = <A, E extends Failed>(
  live: LiveSource<ThreadClient>,
  use: (client: ThreadClient) => Effect.Effect<A, E>
) => Effect.flatMap(live.next(0), ({ client }) => use(client)).pipe(Effect.mapError(failure));

/** The summary already on the Host for the query's head, else the one Review recorded. */
const cachedSummary = (
  client: ThreadClient,
  options: DaemonThreadOptions,
  query: FindingsQuery
): Effect.Effect<RiskSummaryId | null, Failed> => {
  const recorded = options.summaryOf?.(query.sessionId) ?? null;
  const repo = options.workspacePath(query.workspaceId);

  if (query.head === null || repo === null) return Effect.succeed(recorded);

  return Effect.map(
    client["review.riskSummary"]({
      ref: RiskSummaryRef.cases.LatestAt.make({ repo, head: query.head }),
    }),
    (summary) => summary?.id ?? recorded
  );
};

export const daemonThreadSource = (options: DaemonThreadOptions): ThreadSource => {
  const { live, capabilities } = options;
  const has = (capability: string) => capabilities.has(capability);

  return {
    canSteer: has("session.steer"),
    session: (sessionId) =>
      Stream.unwrap(
        Effect.map(
          makeFeed<ThreadClient, SessionStreamItem, Failed>({
            source: live,
            open: (client, afterSequence) =>
              client.subscribeSession({
                sessionId,
                // SAFETY: the feed passes back a sequence the Daemon itself sent.
                afterSequence: afterSequence === null ? null : (afterSequence as Sequence),
                turnLimit: TURN_LIMIT,
              }),
            mark: markSession,
            isDisconnect,
            gapless: false,
          }),
          (feed) => feed.stream
        )
      ).pipe(Stream.mapError(failure)),
    dispatch: (command) =>
      withClient(live, (client) =>
        Effect.asVoid(client.dispatch({ commandId: newCommandId(), command }))
      ),
    continuity: has("session.continuity")
      ? Stream.unwrap(
          Effect.map(
            makeFeed<ThreadClient, ContinuityItem, Failed>({
              source: live,
              open: (client) => client["continuity.watch"]({}),
              mark: markContinuity,
              isDisconnect,
              gapless: false,
            }),
            (feed) => feed.stream
          )
        ).pipe(Stream.mapError(failure))
      : Stream.empty,
    markRead: (sessionId, turnId) =>
      withClient(live, (client) => client["continuity.markRead"]({ sessionId, turnId })),
    saveDraft: (sessionId, text) =>
      withClient(live, (client) => client["continuity.saveDraft"]({ sessionId, text })),
    findings: (query) =>
      has("review.risk-summary")
        ? Stream.unwrap(
            withClient(live, (client) =>
              Effect.map(cachedSummary(client, options, query), (summaryId) =>
                summaryId === null
                  ? Stream.empty
                  : client["review.watchRiskSummary"]({ summaryId }).pipe(
                      Stream.map((summary) => summary.findings)
                    )
              )
            )
          ).pipe(Stream.mapError(failure))
        : Stream.empty,
  };
};
