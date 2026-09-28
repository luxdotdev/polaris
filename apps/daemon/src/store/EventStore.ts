/**
 * The event-sourced store. One SQLite database per Host holds the `events`
 * log (global, gapless `sequence`), the command receipts and the projection
 * tables; `commit` writes all three in one transaction.
 *
 * Commits are serialized (one drain writes batches of them), so the sequence is gapless and
 * the order subscribers see equals the order of commit. Subscribers are only
 * notified after the transaction commits.
 *
 * Design follows pingdotgg/t3code@de251fc (MIT), docs/internals/overview.md:
 * command receipts, projections in the same transaction as the events, and
 * reactors after commit. No code was copied.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import {
  AgentSession,
  ApprovalRequest,
  CommandId,
  CommandRejected,
  DomainEvent,
  EventEnvelope,
  NotFound,
  type Sequence,
  type SessionId,
  Turn,
  type TurnId,
  TurnItem,
  Workspace,
  Worktree,
} from "@polaris/protocol";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Queue,
  Ref,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import { paths } from "../paths.ts";
import { ServiceError } from "../services.ts";
import { MigrationsLayer } from "./migrations.ts";
import {
  emptyModel,
  project,
  RECENT_TURNS,
  type ReadModel,
  type SessionRecord,
  sessionOf,
  sessionOnlyEventTypes,
} from "./model.ts";

// ── Codecs ──────────────────────────────────────────────────────────────────

const json = <S extends Schema.Top>(schema: S) => {
  const codec = Schema.toCodecJson(schema);

  return {
    encode: (value: S["Type"]): string =>
      JSON.stringify(Schema.encodeSync(codec as never)(value as never)),
    decode: (text: string): S["Type"] =>
      Schema.decodeUnknownSync(codec as never)(JSON.parse(text)) as S["Type"],
  };
};

const EventJson = json(DomainEvent);

const WorkspaceJson = json(Workspace);

const WorktreeJson = json(Worktree);

const SessionJson = json(AgentSession);

const TurnJson = json(Turn);

const TurnItemJson = json(TurnItem);

const ApprovalJson = json(ApprovalRequest);

const RejectionJson = json(Schema.Union([CommandRejected, NotFound]));

// ── Public types ────────────────────────────────────────────────────────────

/** What subscribers receive: committed events, and ephemeral output deltas and item progress. */
export type LiveItem =
  | {
      readonly _tag: "Event";
      readonly envelope: EventEnvelope;
      readonly sessionId: SessionId | null;
    }
  | {
      readonly _tag: "Delta";
      readonly sessionId: SessionId;
      readonly turnId: TurnId;
      readonly itemId: string;
      readonly field: "text" | "output";
      readonly text: string;
    }
  | {
      readonly _tag: "ItemProgress";
      readonly sessionId: SessionId;
      readonly turnId: TurnId;
      readonly item: TurnItem;
    };

export type EphemeralItem = Extract<LiveItem, { _tag: "Delta" | "ItemProgress" }>;

export interface StoreSettings {
  /**
   * Items buffered per live subscriber. A subscriber that falls this far behind
   * (a stalled Client) is dropped: its stream ends after the items it already
   * has, and the Client resubscribes from its last sequence. Ephemeral items are
   * dropped earlier, once the buffer is half full, so they never cost a subscriber.
   */
  readonly subscriberCapacity: number;
}

export const StoreConfig = Context.Reference<StoreSettings>("polaris/daemon/store/StoreConfig", {
  defaultValue: () => ({ subscriberCapacity: 4096 }),
});

export type CommitResult =
  | {
      readonly _tag: "Committed";
      readonly envelopes: ReadonlyArray<EventEnvelope>;
      /** Sequence of the last event written; null when the command produced none. */
      readonly sequence: Sequence | null;
      readonly model: ReadModel;
    }
  | {
      /** The command id already has a receipt; nothing was written. */
      readonly _tag: "Duplicate";
      readonly sequence: Sequence | null;
    };

export type Rejection = CommandRejected | NotFound;

export interface CommitOptions<E extends Rejection> {
  /** Client-chosen id; null for events the Daemon records on its own (Harness output, recovery). */
  readonly commandId: CommandId | null;
  /** Runs under the commit lock against the latest read model. */
  readonly decide: (model: ReadModel) => Effect.Effect<ReadonlyArray<DomainEvent>, E>;
}

export class EventStore extends Context.Service<
  EventStore,
  {
    readonly model: Effect.Effect<ReadModel>;
    /**
     * Decide and commit atomically. A command id seen before returns
     * `Duplicate` (or re-fails with the original rejection) without deciding again.
     */
    readonly commit: <E extends Rejection = never>(
      options: CommitOptions<E>
    ) => Effect.Effect<CommitResult, E | ServiceError>;
    /**
     * Subscribe before reading a snapshot, so nothing committed in between is
     * missed. The subscription lives as long as the scope; `filter` keeps
     * unrelated items out of its buffer. The stream ends (without an error) if
     * the subscriber falls `subscriberCapacity` items behind; resume from the
     * last sequence seen.
     */
    readonly subscribe: (options?: {
      /** Only this session's items; cheaper than a filter, since other sessions' items skip it. */
      readonly sessionId?: SessionId;
      readonly filter?: (item: LiveItem) => boolean;
    }) => Effect.Effect<Stream.Stream<LiveItem>, never, Scope.Scope>;
    readonly publishEphemeral: (item: EphemeralItem) => Effect.Effect<void>;
    /** Live subscribers right now (for tests and diagnostics). */
    readonly subscriberCount: Effect.Effect<number>;
    /**
     * Committed events with `after < sequence <= upTo`, in order. With a
     * session id, only that session's events; without, the Host stream's events.
     */
    readonly readEvents: (options: {
      readonly after: number;
      readonly upTo: number;
      readonly sessionId: SessionId | null;
    }) => Effect.Effect<ReadonlyArray<EventEnvelope>, ServiceError>;
    /**
     * A session's Turns from SQL, ordered by index: those with `index < beforeIndex`
     * (all when null), at most the last `limit` of them (all when null).
     */
    readonly readTurns: (options: {
      readonly sessionId: SessionId;
      readonly beforeIndex: number | null;
      readonly limit: number | null;
    }) => Effect.Effect<ReadonlyArray<Turn>, ServiceError>;
    /** The last recorded state of a Worktree, even one since removed (from its `WorktreeDetected`). */
    readonly lastKnownWorktree: (
      worktreeId: Worktree["id"]
    ) => Effect.Effect<Worktree | null, ServiceError>;
    /** Completed items of the given Turns, as of `upTo`, in completion order. */
    readonly readTurnItems: (options: {
      readonly turnIds: ReadonlyArray<TurnId>;
      readonly upTo: number;
    }) => Effect.Effect<ReadonlyMap<TurnId, ReadonlyArray<TurnItem>>, ServiceError>;
  }
>()("polaris/daemon/store/EventStore") {
  static readonly layer = Layer.effect(
    EventStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const loaded = yield* loadModel(sql).pipe(Effect.mapError(storeError("load the read model")));
      // WAL (set by the client) with synchronous = NORMAL: a commit is durable once it
      // is in the WAL, so a Daemon crash loses nothing that was acked; only an OS crash
      // or power loss can roll back the last commits (the database stays consistent).
      // FULL would fsync the WAL on every commit, the biggest cost of a small commit.
      yield* sql`PRAGMA synchronous = NORMAL`.pipe(Effect.orDie);
      const modelRef = yield* Ref.make(loaded);
      const { subscriberCapacity } = yield* StoreConfig;
      const hub = makeHub(subscriberCapacity);

      const findReceipt = (commandId: CommandId) =>
        sql<{
          sequence: number | null;
          rejection: string | null;
        }>`SELECT sequence, rejection FROM command_receipts WHERE command_id = ${commandId}`.pipe(
          Effect.map((rows) => rows[0])
        );

      // ── Group commit ──────────────────────────────────────────────────────
      //
      // A commit that finds the store idle writes in its own fiber; commits that arrive
      // while one is writing queue, and the writer then takes all of them as one batch:
      // it decides each in order against the model the previous ones produced and
      // writes them in one transaction. Per command, events + projections + receipt are
      // still atomic (the whole batch is), the sequence stays gapless, subscribers hear
      // of a batch only after it commits, and a caller's result (its ack) only after
      // that too. Batches form on their own under load, with no added delay when idle.

      interface Pending {
        readonly options: CommitOptions<Rejection>;
        readonly deferred: Deferred.Deferred<CommitResult, Rejection | ServiceError>;
        /** The caller was interrupted before its batch started: skip it. */
        abandoned: boolean;
      }

      type Outcome = Exit.Exit<CommitResult, Rejection | ServiceError>;

      let queued: Array<Pending> = [];
      /** A drain is scheduled or running; later commits queue for it. */
      let writing = false;
      const context = yield* Effect.context<never>();

      const runBatch = (batch: ReadonlyArray<Pending>) =>
        Effect.gen(function* () {
          const now = new Date(yield* Clock.currentTimeMillis).toISOString();
          const start = yield* Ref.get(modelRef);
          let next = start;
          const writes: Array<Effect.Effect<unknown, SqlError.SqlError>> = [];
          const published: Array<EventEnvelope> = [];
          const outcomes: Array<Outcome> = [];

          // Receipts written earlier in this batch, not yet visible to `findReceipt`.
          const receipts = new Map<
            CommandId,
            { readonly sequence: number | null; readonly rejection: Rejection | null }
          >();

          for (const { options } of batch) {
            const { commandId } = options;

            if (commandId !== null) {
              const receipt =
                receipts.get(commandId) ??
                (yield* findReceipt(commandId).pipe(
                  Effect.map((row) =>
                    row === undefined
                      ? undefined
                      : {
                          sequence: row.sequence,
                          rejection:
                            row.rejection === null ? null : RejectionJson.decode(row.rejection),
                        }
                  ),
                  Effect.mapError(storeError("read a command receipt"))
                ));

              if (receipt !== undefined) {
                outcomes.push(
                  receipt.rejection !== null
                    ? Exit.fail(receipt.rejection)
                    : Exit.succeed({
                        _tag: "Duplicate",
                        sequence: receipt.sequence as Sequence | null,
                      })
                );
                continue;
              }
            }

            const decided = yield* Effect.exit(options.decide(next));

            if (decided._tag === "Failure") {
              const rejection = Cause.findErrorOption(decided.cause);

              if (commandId !== null && rejection._tag === "Some") {
                writes.push(
                  sql`INSERT INTO command_receipts ${sql.insert({
                    command_id: commandId,
                    sequence: null,
                    rejection: RejectionJson.encode(rejection.value),
                    recorded_at: now,
                  })}`
                );
                receipts.set(commandId, { sequence: null, rejection: rejection.value });
              }

              outcomes.push(Exit.failCause(decided.cause));
              continue;
            }

            const envelopes: Array<EventEnvelope> = [];

            for (const event of decided.value) {
              const envelope = new EventEnvelope({
                sequence: (next.sequence + 1) as Sequence,
                occurredAt: now,
                commandId,
                event,
              });

              const after = project(next, envelope);
              writes.push(writeEvent(sql, envelope), writeProjection(sql, after, envelope));
              envelopes.push(envelope);
              published.push(envelope);
              next = after;
            }

            const sequence = envelopes.length > 0 ? next.sequence : null;

            if (commandId !== null) {
              writes.push(
                sql`INSERT INTO command_receipts ${sql.insert({
                  command_id: commandId,
                  sequence,
                  rejection: null,
                  recorded_at: now,
                })}`
              );
              receipts.set(commandId, { sequence, rejection: null });
            }

            outcomes.push(
              Exit.succeed({
                _tag: "Committed",
                envelopes,
                sequence: sequence as Sequence | null,
                model: next,
              })
            );
          }

          if (writes.length > 0) {
            yield* sql
              .withTransaction(Effect.forEach(writes, (write) => write, { discard: true }))
              .pipe(Effect.mapError(storeError("commit events")));
          }

          yield* Ref.set(modelRef, next);

          for (const envelope of published) {
            hub.publish({ _tag: "Event", envelope, sessionId: sessionOf(envelope.event) });
          }

          return outcomes;
        });

      const settle = (batch: ReadonlyArray<Pending>, outcomes: ReadonlyArray<Outcome>) => {
        for (let i = 0; i < batch.length; i++)
          Deferred.doneUnsafe(batch[i]!.deferred, outcomes[i]!);
      };

      const writeBatch = (taken: ReadonlyArray<Pending>) =>
        Effect.gen(function* () {
          const batch = taken.filter((pending) => !pending.abandoned);

          if (batch.length === 0) return;
          const result = yield* Effect.exit(runBatch(batch));

          if (result._tag === "Success") return settle(batch, result.value);

          if (batch.length === 1) {
            return settle(batch, [result as Exit.Exit<never, ServiceError>]);
          }

          // A failed batch wrote nothing; commit its commands one by one, so one bad
          // command (or a transient error) only fails itself.
          for (const pending of batch) {
            const single = yield* Effect.exit(runBatch([pending]));
            settle(
              [pending],
              single._tag === "Success" ? single.value : [single as Exit.Exit<never, ServiceError>]
            );
          }
        }).pipe(Effect.uninterruptible);

      /** Writes batches until nothing is queued. */
      const drain = Effect.gen(function* () {
        while (queued.length > 0) {
          const taken = queued;
          queued = [];
          yield* writeBatch(taken);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            writing = false;
          })
        ),
        Effect.uninterruptible
      );

      const commit = <E extends Rejection>(options: CommitOptions<E>) =>
        Effect.suspend(() => {
          const pending: Pending = {
            options: options as CommitOptions<Rejection>,
            deferred: Deferred.makeUnsafe<CommitResult, Rejection | ServiceError>(),
            abandoned: false,
          };

          queued.push(pending);

          if (!writing) {
            // Write in a microtask: it runs once every fiber the scheduler is running
            // right now has had its turn (so their commits join this batch), but before
            // the event loop moves on, so a commit costs no extra turn of it.
            writing = true;
            queueMicrotask(() => Effect.runForkWith(context)(drain));
          }

          return Deferred.await(pending.deferred).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                pending.abandoned = true;
              })
            )
          );
        }) as Effect.Effect<CommitResult, E | ServiceError>;

      const readEvents = (options: {
        readonly after: number;
        readonly upTo: number;
        readonly sessionId: SessionId | null;
      }) =>
        (options.sessionId === null
          ? sql<EventRow>`
              SELECT sequence, occurred_at, command_id, payload FROM events
              WHERE sequence > ${options.after} AND sequence <= ${options.upTo}
                AND event_type NOT IN ${sql.in(sessionOnlyEventTypes)}
              ORDER BY sequence`
          : sql<EventRow>`
              SELECT sequence, occurred_at, command_id, payload FROM events
              WHERE session_id = ${options.sessionId}
                AND sequence > ${options.after} AND sequence <= ${options.upTo}
              ORDER BY sequence`
        ).pipe(
          Effect.map((rows) => rows.map(decodeEventRow)),
          Effect.mapError(storeError("read events"))
        );

      const readTurnItems = (options: {
        readonly turnIds: ReadonlyArray<TurnId>;
        readonly upTo: number;
      }) =>
        Effect.gen(function* () {
          const out = new Map<TurnId, Array<TurnItem>>();

          if (options.turnIds.length === 0) return out;

          const rows = yield* sql<{ turn_id: string; item_id: string; data: string }>`
            SELECT turn_id, item_id, data FROM turn_items
            WHERE turn_id IN ${sql.in(options.turnIds)} AND sequence <= ${options.upTo}
            ORDER BY sequence`;

          // An item completed twice keeps its first position and its latest content.
          const byTurn = new Map<string, Map<string, TurnItem>>();

          for (const row of rows) {
            const items = byTurn.get(row.turn_id) ?? new Map<string, TurnItem>();
            items.set(row.item_id, TurnItemJson.decode(row.data));
            byTurn.set(row.turn_id, items);
          }

          for (const [turnId, items] of byTurn) out.set(turnId as TurnId, [...items.values()]);

          return out;
        }).pipe(Effect.mapError(storeError("read turn items")));

      const readTurns = (options: {
        readonly sessionId: SessionId;
        readonly beforeIndex: number | null;
        readonly limit: number | null;
      }) =>
        sql<{ data: string }>`
          SELECT data FROM (
            SELECT data, turn_index FROM turns
            WHERE session_id = ${options.sessionId}
              AND turn_index < ${options.beforeIndex ?? Number.MAX_SAFE_INTEGER}
            ORDER BY turn_index DESC
            LIMIT ${options.limit ?? -1}
          ) ORDER BY turn_index`.pipe(
          Effect.map((rows) => rows.map((row) => TurnJson.decode(row.data))),
          Effect.mapError(storeError("read turns"))
        );

      const lastKnownWorktree = (worktreeId: Worktree["id"]) =>
        sql<{ payload: string }>`
          SELECT payload FROM events
          WHERE event_type = 'WorktreeDetected'
            AND json_extract(payload, '$.worktree.id') = ${worktreeId}
          ORDER BY sequence DESC LIMIT 1`.pipe(
          Effect.map((rows) => {
            const event = rows[0] === undefined ? null : EventJson.decode(rows[0].payload);

            return event?._tag === "WorktreeDetected" ? event.worktree : null;
          }),
          Effect.mapError(storeError("read a Worktree"))
        );

      return EventStore.of({
        model: Ref.get(modelRef),
        commit,
        subscribe: (options) => hub.subscribe(options),
        publishEphemeral: (item) => Effect.sync(() => hub.publish(item)),
        subscriberCount: Effect.sync(() => hub.size()),
        readEvents,
        readTurns,
        lastKnownWorktree,
        readTurnItems,
      });
    })
  );

  /** A migrated SQLite database at `filename` (`:memory:` in tests). */
  static readonly layerSqlite = (filename: string) =>
    EventStore.layer.pipe(
      Layer.provide(MigrationsLayer),
      Layer.provide(SqliteClient.layer({ filename })),
      Layer.orDie
    );

  /** The Host's database at `~/.polaris/state.sqlite`. */
  static readonly layerLive = Layer.unwrap(
    Effect.sync(() => {
      const file = paths().database;
      mkdirSync(dirname(file), { recursive: true });

      return EventStore.layerSqlite(file);
    })
  );
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * The live fan-out: one bounded buffer per subscriber, so a stalled Client
 * costs at most `capacity` items. Publishing never blocks a commit. On
 * overflow the subscriber is dropped rather than skipping an event, so its
 * stream has no gaps: it ends, and the Client resumes from its last sequence
 * (replayed from the `events` table). Ephemeral items (Deltas, item progress)
 * are only buffered while the buffer is less than half full; a Client that
 * falls behind loses some live output but still gets every item's final state.
 */
const makeHub = (capacity: number) => {
  interface Subscriber {
    readonly queue: Queue.Queue<LiveItem, Cause.Done>;
    readonly filter: ((item: LiveItem) => boolean) | undefined;
    /** Set for a subscriber to one session only. */
    readonly sessionId: SessionId | undefined;
  }

  // Subscribers to one session are kept apart, so an item (most are one session's
  // Deltas) visits only that session's subscribers, not every stream of every Client.
  const everything = new Set<Subscriber>();
  const bySession = new Map<SessionId, Set<Subscriber>>();
  let size = 0;
  const ephemeralLimit = Math.max(1, Math.floor(capacity / 2));

  const drop = (subscriber: Subscriber) => {
    const bucket =
      subscriber.sessionId === undefined ? everything : bySession.get(subscriber.sessionId);

    if (bucket === undefined || !bucket.delete(subscriber)) return;
    size--;

    if (bucket.size === 0 && subscriber.sessionId !== undefined) {
      bySession.delete(subscriber.sessionId);
    }

    Queue.endUnsafe(subscriber.queue);
  };

  const offer = (subscribers: ReadonlySet<Subscriber>, item: LiveItem) => {
    for (const subscriber of subscribers) {
      if (subscriber.filter !== undefined && !subscriber.filter(item)) continue;

      if (item._tag !== "Event") {
        if (Queue.sizeUnsafe(subscriber.queue) < ephemeralLimit)
          Queue.offerUnsafe(subscriber.queue, item);
        continue;
      }

      if (!Queue.offerUnsafe(subscriber.queue, item)) drop(subscriber);
    }
  };

  const publish = (item: LiveItem) => {
    if (everything.size > 0) offer(everything, item);

    if (item.sessionId !== null) {
      const bucket = bySession.get(item.sessionId);

      if (bucket !== undefined) offer(bucket, item);
    }
  };

  const subscribe = (options?: {
    readonly sessionId?: SessionId | undefined;
    readonly filter?: ((item: LiveItem) => boolean) | undefined;
  }) =>
    Effect.gen(function* () {
      const queue = yield* Queue.dropping<LiveItem, Cause.Done>(capacity);
      const sessionId = options?.sessionId;
      const subscriber: Subscriber = { queue, filter: options?.filter, sessionId };

      if (sessionId === undefined) {
        everything.add(subscriber);
      } else {
        const bucket = bySession.get(sessionId) ?? new Set<Subscriber>();
        bucket.add(subscriber);
        bySession.set(sessionId, bucket);
      }

      size++;
      yield* Effect.addFinalizer(() => Effect.sync(() => drop(subscriber)));

      return Stream.fromQueue(queue);
    });

  return { publish, subscribe, size: () => size };
};

const storeError = (what: string) => (cause: unknown) =>
  new ServiceError({ service: "store", message: `failed to ${what}`, cause });

interface EventRow {
  readonly sequence: number;
  readonly occurred_at: string;
  readonly command_id: string | null;
  readonly payload: string;
}

const decodeEventRow = (row: EventRow): EventEnvelope =>
  new EventEnvelope({
    sequence: row.sequence as Sequence,
    occurredAt: row.occurred_at,
    commandId: row.command_id === null ? null : CommandId.make(row.command_id),
    event: EventJson.decode(row.payload),
  });

const writeEvent = (sql: SqlClient.SqlClient, envelope: EventEnvelope) => {
  const sessionId = sessionOf(envelope.event);

  return sql`INSERT INTO events ${sql.insert({
    sequence: envelope.sequence,
    stream_kind: sessionId === null ? "host" : "session",
    session_id: sessionId,
    event_type: envelope.event._tag,
    command_id: envelope.commandId,
    occurred_at: envelope.occurredAt,
    payload: EventJson.encode(envelope.event),
  })}`;
};

const upsertSession = (sql: SqlClient.SqlClient, record: SessionRecord | undefined) =>
  record === undefined
    ? Effect.void
    : sql`INSERT OR REPLACE INTO sessions ${sql.insert({
        id: record.session.id,
        workspace_id: record.session.workspaceId,
        state: record.session.state,
        title_locked: record.titleLocked ? 1 : 0,
        data: SessionJson.encode(record.session),
      })}`;

const upsertTurn = (sql: SqlClient.SqlClient, turn: Turn | undefined) =>
  turn === undefined
    ? Effect.void
    : sql`INSERT OR REPLACE INTO turns ${sql.insert({
        id: turn.id,
        session_id: turn.sessionId,
        turn_index: turn.index,
        status: turn.status,
        data: TurnJson.encode(turn),
      })}`;

/** Persist what `envelope` changed in the read model `after` it. */
const writeProjection = (
  sql: SqlClient.SqlClient,
  after: ReadModel,
  envelope: EventEnvelope
): Effect.Effect<unknown, SqlError.SqlError> => {
  const event = envelope.event;

  switch (event._tag) {
    case "WorkspaceRegistered":
    case "WorkspaceUpdated":
      return sql`INSERT OR REPLACE INTO workspaces ${sql.insert({
        id: event.workspace.id,
        path: event.workspace.path,
        data: WorkspaceJson.encode(event.workspace),
      })}`;
    case "WorkspaceRemoved":
      return Effect.all([
        sql`DELETE FROM workspaces WHERE id = ${event.workspaceId}`,
        sql`DELETE FROM worktrees WHERE workspace_id = ${event.workspaceId}`,
      ]);
    case "WorktreeDetected":
      return sql`INSERT OR REPLACE INTO worktrees ${sql.insert({
        id: event.worktree.id,
        workspace_id: event.worktree.workspaceId,
        data: WorktreeJson.encode(event.worktree),
      })}`;
    case "WorktreeRemoved":
      return sql`DELETE FROM worktrees WHERE id = ${event.worktreeId}`;
    default: {
      const sessionId = sessionOf(event)!;
      const record = after.sessions.get(sessionId);
      const session = upsertSession(sql, record);

      switch (event._tag) {
        case "TurnStarted":
        case "TurnEnded":
          return Effect.all([session, upsertTurn(sql, event.turn)]);
        case "CheckpointRecorded":
          return Effect.all([
            session,
            upsertTurn(
              sql,
              record?.turns.find((t) => t.id === event.turnId)
            ),
          ]);
        case "TurnItemCompleted":
          return Effect.all([
            session,
            sql`INSERT INTO turn_items ${sql.insert({
              sequence: envelope.sequence,
              session_id: event.sessionId,
              turn_id: event.turnId,
              item_id: event.item.id,
              data: TurnItemJson.encode(event.item),
            })}`,
          ]);
        case "ApprovalRequested":
          return Effect.all([
            session,
            sql`INSERT OR REPLACE INTO pending_approvals ${sql.insert({
              request_id: event.request.id,
              session_id: event.request.sessionId,
              data: ApprovalJson.encode(event.request),
            })}`,
          ]);
        case "ApprovalResolved":
        case "ApprovalWithdrawn":
          return Effect.all([
            session,
            sql`DELETE FROM pending_approvals WHERE request_id = ${event.requestId}`,
          ]);
        default:
          return session;
      }
    }
  }
};

const loadModel = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const [max] = yield* sql<{
      sequence: number | null;
    }>`SELECT MAX(sequence) AS sequence FROM events`;

    const workspaces = yield* sql<{ data: string }>`SELECT data FROM workspaces`;
    const worktrees = yield* sql<{ data: string }>`SELECT data FROM worktrees`;

    const sessions = yield* sql<{ data: string; title_locked: number }>`
      SELECT data, title_locked FROM sessions`;

    // Only the most recent Turns of each session stay in memory (see RECENT_TURNS).
    const turns = yield* sql<{ data: string }>`
      SELECT data FROM (
        SELECT data, session_id, turn_index,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index DESC) AS recency
        FROM turns
      ) WHERE recency <= ${RECENT_TURNS}
      ORDER BY session_id, turn_index`;

    const pending = yield* sql<{ data: string }>`SELECT data FROM pending_approvals`;

    const turnsBySession = new Map<string, Array<Turn>>();

    for (const row of turns) {
      const turn = TurnJson.decode(row.data);
      const list = turnsBySession.get(turn.sessionId) ?? [];
      list.push(turn);
      turnsBySession.set(turn.sessionId, list);
    }

    const pendingBySession = new Map<string, Map<ApprovalRequest["id"], ApprovalRequest>>();

    for (const row of pending) {
      const request = ApprovalJson.decode(row.data);
      const map = pendingBySession.get(request.sessionId) ?? new Map();
      map.set(request.id, request);
      pendingBySession.set(request.sessionId, map);
    }

    const model: ReadModel = {
      ...emptyModel,
      sequence: max?.sequence ?? 0,
      workspaces: new Map(
        workspaces.map((row) => {
          const w = WorkspaceJson.decode(row.data);

          return [w.id, w];
        })
      ),
      worktrees: new Map(
        worktrees.map((row) => {
          const w = WorktreeJson.decode(row.data);

          return [w.id, w];
        })
      ),
      sessions: new Map(
        sessions.map((row) => {
          const session = SessionJson.decode(row.data);

          return [
            session.id,
            {
              session,
              titleLocked: row.title_locked === 1,
              turns: turnsBySession.get(session.id) ?? [],
              pending: pendingBySession.get(session.id) ?? new Map(),
            },
          ];
        })
      ),
    };

    return model;
  });
