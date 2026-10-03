import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  ConstellationOutboxPacket,
  ConstellationRelayReceipt,
  ConstellationTransferError,
  PreparedWorktree,
  type AttemptId,
  type SessionId,
  RemoteWorkerAssignment,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Schema, SubscriptionRef } from "effect";

const Row = Schema.Struct({ value: Schema.String });

const rows = Schema.decodeUnknownSync(Schema.Array(Row));

const row = Schema.decodeUnknownSync(Schema.NullOr(Row));

const outboxRow = Schema.decodeUnknownSync(
  Schema.NullOr(Schema.Struct({ value: Schema.String, receipt: Schema.NullOr(Schema.String) }))
);

const ackCodec = Schema.fromJsonString(ConstellationRelayReceipt);

const packetCodec = Schema.fromJsonString(ConstellationOutboxPacket);

const assignmentCodec = Schema.fromJsonString(RemoteWorkerAssignment);

const placementCodec = Schema.fromJsonString(
  Schema.Struct({ request: Schema.String, prepared: PreparedWorktree, removed: Schema.Boolean })
);

const receiptCodec = Schema.fromJsonString(
  Schema.Struct({ packet: Schema.String, receipt: ConstellationRelayReceipt })
);

export class TransferStorage extends Context.Service<
  TransferStorage,
  {
    readonly changes: SubscriptionRef.SubscriptionRef<number>;
    readonly hasAssignmentsForSession?: (sessionId: SessionId) => boolean;
    readonly assignmentsForSession: (
      sessionId: SessionId
    ) => Effect.Effect<ReadonlyArray<RemoteWorkerAssignment>>;
    readonly assignmentChanges: (
      sessionId: SessionId
    ) => Effect.Effect<SubscriptionRef.SubscriptionRef<number>>;
    readonly get: (
      table:
        | "placements"
        | "receipts"
        | "requests"
        | "responses"
        | "deliveries"
        | "delivery_receipts"
        | "delivered"
        | "intents",
      id: string
    ) => Effect.Effect<string | null, ConstellationTransferError>;
    readonly put: (
      table:
        | "placements"
        | "receipts"
        | "requests"
        | "responses"
        | "deliveries"
        | "delivery_receipts"
        | "delivered"
        | "intents",
      id: string,
      value: string
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly existing: (
      id: string
    ) => Effect.Effect<
      { packet: ConstellationOutboxPacket; receipt: ConstellationRelayReceipt | null } | null,
      ConstellationTransferError
    >;
    readonly claimedAttempts: Effect.Effect<ReadonlySet<AttemptId>, ConstellationTransferError>;
    readonly packets: Effect.Effect<
      ReadonlyArray<ConstellationOutboxPacket>,
      ConstellationTransferError
    >;
    readonly enqueue: (
      packet: ConstellationOutboxPacket
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly ack: (
      receipt: ConstellationRelayReceipt
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly deliveries: Effect.Effect<ReadonlyArray<string>, ConstellationTransferError>;
    readonly deliveryReceipts: Effect.Effect<ReadonlyArray<string>, ConstellationTransferError>;
    readonly requests: Effect.Effect<ReadonlyArray<string>, ConstellationTransferError>;
    readonly receipts: Effect.Effect<ReadonlyArray<string>, ConstellationTransferError>;
    readonly placements: Effect.Effect<
      ReadonlyArray<{ request: string; prepared: PreparedWorktree; removed: boolean }>,
      ConstellationTransferError
    >;
    readonly assignments: Effect.Effect<
      ReadonlyArray<RemoteWorkerAssignment>,
      ConstellationTransferError
    >;
    readonly assign: (
      value: RemoteWorkerAssignment
    ) => Effect.Effect<void, ConstellationTransferError>;
  }
>()("polaris/constellation/TransferStorage") {
  static layer(path: string) {
    return Layer.effect(
      TransferStorage,
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
              const database = new Database(path, { create: true });

              if (path !== ":memory:") chmodSync(path, 0o600);
              database.exec(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"
              );
              database.exec(`CREATE TABLE IF NOT EXISTS placements (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL, receipt TEXT);
            CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS delivery_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS delivered (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);

              return database;
            },
            catch: () =>
              new ConstellationTransferError({
                code: "E-STORAGE",
                message: "Could not open Constellation transfers",
                retryable: true,
              }),
          }),
          (database) => Effect.sync(() => database.close())
        );

        const changes = yield* SubscriptionRef.make(0);

        const assignmentVersions = new Map<SessionId, SubscriptionRef.SubscriptionRef<number>>();

        const assignmentChanges = Effect.fnUntraced(function* (sessionId: SessionId) {
          const existing = assignmentVersions.get(sessionId);

          if (existing !== undefined) return existing;
          const version = yield* SubscriptionRef.make(0);
          const current = assignmentVersions.get(sessionId) ?? version;
          assignmentVersions.set(sessionId, current);

          return current;
        });

        const run = <A>(body: () => A) =>
          Effect.try({
            try: body,
            catch: (cause) =>
              cause instanceof ConstellationTransferError
                ? cause
                : new ConstellationTransferError({
                    code: "E-STORAGE",
                    message: "Could not persist Constellation transfers",
                    retryable: true,
                  }),
          });

        const get = (
          table:
            | "placements"
            | "receipts"
            | "requests"
            | "responses"
            | "deliveries"
            | "delivery_receipts"
            | "delivered"
            | "intents",
          id: string
        ) =>
          run(
            () => row(db.query(`SELECT value FROM ${table} WHERE id = ?`).get(id))?.value ?? null
          );

        const put = (
          table:
            | "placements"
            | "receipts"
            | "requests"
            | "responses"
            | "deliveries"
            | "delivery_receipts"
            | "delivered"
            | "intents",
          id: string,
          value: string
        ) =>
          run(() =>
            db.transaction(() => {
              const previous = row(db.query(`SELECT value FROM ${table} WHERE id = ?`).get(id));

              if (table !== "placements" && previous !== null && previous.value !== value)
                throw new ConstellationTransferError({
                  code: "E-IDEMPOTENCY",
                  message: "The transfer id already names another durable payload",
                  retryable: false,
                });
              db.query(
                `INSERT INTO ${table} (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`
              ).run(id, value);
            })()
          );

        const list = <A>(
          table:
            | "outbox"
            | "assignments"
            | "placements"
            | "receipts"
            | "requests"
            | "responses"
            | "deliveries"
            | "delivery_receipts"
            | "delivered"
            | "intents",
          decode: (s: string) => A
        ) =>
          run(() =>
            rows(
              db
                .query(
                  `SELECT value FROM ${table}${table === "outbox" ? " WHERE receipt IS NULL" : ""} ORDER BY rowid`
                )
                .all()
            ).map((r) => decode(r.value))
          );

        const bySession = new Map<SessionId, Map<AttemptId, RemoteWorkerAssignment>>();

        const indexAssignment = (assignment: RemoteWorkerAssignment) => {
          const sessionId = assignment.graph.attempts.find(
            (a) => a.id === assignment.attemptId
          )?.sessionId;

          if (sessionId === undefined) return;
          const bucket = bySession.get(sessionId) ?? new Map<AttemptId, RemoteWorkerAssignment>();
          bucket.set(assignment.attemptId, assignment);
          bySession.set(sessionId, bucket);
        };

        for (const assignment of yield* list(
          "assignments",
          Schema.decodeUnknownSync(assignmentCodec)
        ))
          indexAssignment(assignment);

        return TransferStorage.of({
          changes,
          hasAssignmentsForSession: (sessionId) => bySession.has(sessionId),
          assignmentChanges,
          assignmentsForSession: (sessionId) =>
            Effect.sync(() => [...(bySession.get(sessionId)?.values() ?? [])]),
          get,
          put,
          existing: (id) =>
            run(() => {
              const stored = outboxRow(
                db.query("SELECT value,receipt FROM outbox WHERE id = ?").get(id)
              );

              return stored === null
                ? null
                : {
                    packet: Schema.decodeUnknownSync(packetCodec)(stored.value),
                    receipt:
                      stored.receipt === null
                        ? null
                        : Schema.decodeUnknownSync(ackCodec)(stored.receipt),
                  };
            }),
          claimedAttempts: run(() => {
            const stored = Schema.decodeUnknownSync(
              Schema.Array(
                Schema.Struct({ value: Schema.String, receipt: Schema.NullOr(Schema.String) })
              )
            )(db.query("SELECT value,receipt FROM outbox").all());

            const attempts = new Set<AttemptId>();

            for (const value of stored) {
              const packet = Schema.decodeUnknownSync(packetCodec)(value.value);

              const receipt =
                value.receipt === null ? null : Schema.decodeUnknownSync(ackCodec)(value.receipt);

              if (
                "claim" in packet.entry.command &&
                (receipt === null || Predicate.isTagged(receipt, "Applied"))
              )
                attempts.add(packet.entry.attemptId);
            }

            return attempts;
          }),
          packets: list("outbox", Schema.decodeUnknownSync(packetCodec)),
          deliveries: list("deliveries", (s) => s),
          deliveryReceipts: list("delivery_receipts", (s) => s),
          requests: list("requests", (s) => s),
          receipts: list("receipts", (s) => s),
          placements: list("placements", Schema.decodeUnknownSync(placementCodec)),
          assignments: list("assignments", Schema.decodeUnknownSync(assignmentCodec)),
          enqueue: Effect.fnUntraced(function* (packet) {
            yield* run(() =>
              db.transaction(() => {
                const value = Schema.encodeSync(packetCodec)(packet);

                const previous = row(
                  db.query("SELECT value FROM outbox WHERE id = ?").get(packet.entry.id)
                );

                if (previous !== null && previous.value !== value)
                  throw new ConstellationTransferError({
                    code: "E-IDEMPOTENCY",
                    message: "The outbox ID already names a different request",
                    retryable: false,
                  });
                db.query("INSERT OR IGNORE INTO outbox (id,value) VALUES (?,?)").run(
                  packet.entry.id,
                  value
                );
              })()
            );
            yield* SubscriptionRef.update(changes, (n) => n + 1);
          }),
          ack: Effect.fnUntraced(function* (receipt) {
            yield* run(() =>
              db.transaction(() => {
                const stored = outboxRow(
                  db.query("SELECT value,receipt FROM outbox WHERE id = ?").get(receipt.id)
                );

                if (stored === null)
                  throw new ConstellationTransferError({
                    code: "E-NOT-FOUND",
                    message: "The acknowledged outbox entry does not exist",
                    retryable: false,
                  });
                const encoded = Schema.encodeSync(ackCodec)(receipt);

                if (stored.receipt !== null && stored.receipt !== encoded)
                  throw new ConstellationTransferError({
                    code: "E-IDEMPOTENCY",
                    message: "The outbox entry already has another receipt",
                    retryable: false,
                  });
                db.query("UPDATE outbox SET receipt = ? WHERE id = ? AND receipt IS NULL").run(
                  encoded,
                  receipt.id
                );
              })()
            );
            yield* SubscriptionRef.update(changes, (n) => n + 1);
          }),
          assign: (assignment) =>
            Effect.gen(function* () {
              yield* run(() => {
                db.query(
                  "INSERT INTO assignments (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value"
                ).run(assignment.attemptId, Schema.encodeSync(assignmentCodec)(assignment));
                indexAssignment(assignment);
              });

              const sessionId = assignment.graph.attempts.find(
                (a) => a.id === assignment.attemptId
              )?.sessionId;

              const version =
                sessionId === undefined ? undefined : assignmentVersions.get(sessionId);

              if (version !== undefined) yield* SubscriptionRef.update(version, (n) => n + 1);
            }),
        });
      })
    );
  }
}

export const decodePlacement = Schema.decodeUnknownSync(placementCodec);

export const encodePlacement = Schema.encodeSync(placementCodec);

export const decodeReceipt = Schema.decodeUnknownSync(receiptCodec);

export const encodeReceipt = Schema.encodeSync(receiptCodec);
