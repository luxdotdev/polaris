import { createHash } from "node:crypto";
import {
  RemoteDeliveryPacket,
  RemoteDeliveryReceipt,
  type ConstellationTransferError,
} from "@polaris/protocol";
import { Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect";
import { ConstellationOwner } from "../runtime.ts";
import { transferError } from "../worktrees.ts";
import { TransferStorage } from "./storage.ts";
import { assignmentAttempt } from "./outbox.ts";

const packetCodec = Schema.fromJsonString(RemoteDeliveryPacket);

const receiptCodec = Schema.fromJsonString(RemoteDeliveryReceipt);

const encodePacket = Schema.encodeSync(packetCodec);

const decodePacket = Schema.decodeUnknownSync(packetCodec);

const decodeReceipt = Schema.decodeUnknownSync(receiptCodec);

const packetHash = (packet: RemoteDeliveryPacket) =>
  createHash("sha256").update(encodePacket(packet)).digest("hex");

export class RemoteWorkerDelivery extends Context.Reference<{
  /** Commit the Session command under packet.id; duplicates must not run its reactor again. */
  readonly apply: (packet: RemoteDeliveryPacket) => Effect.Effect<void, ConstellationTransferError>;
}>("polaris/constellation/RemoteWorkerDelivery", {
  defaultValue: () => ({
    apply: () =>
      Effect.fail(transferError("E-UNAVAILABLE", "Remote Session delivery is not mounted", true)),
  }),
}) {}

export class RemoteDeliveries extends Context.Service<
  RemoteDeliveries,
  {
    readonly send: (
      packet: RemoteDeliveryPacket
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly apply: (
      packet: RemoteDeliveryPacket
    ) => Effect.Effect<RemoteDeliveryReceipt, ConstellationTransferError>;
    readonly ack: (
      receipt: RemoteDeliveryReceipt
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly watch: Stream.Stream<ReadonlyArray<RemoteDeliveryPacket>, ConstellationTransferError>;
    readonly acknowledged: Stream.Stream<
      ReadonlyArray<RemoteDeliveryPacket>,
      ConstellationTransferError
    >;
  }
>()("polaris/constellation/RemoteDeliveries") {
  static readonly layer = Layer.effect(
    RemoteDeliveries,
    Effect.gen(function* () {
      const storage = yield* TransferStorage;
      const hostId = yield* ConstellationOwner;
      const hooks = yield* RemoteWorkerDelivery;
      const changes = yield* SubscriptionRef.make(0);
      const serial = yield* Semaphore.make(1);

      const pending = Effect.gen(function* () {
        const result: Array<RemoteDeliveryPacket> = [];

        for (const encoded of yield* storage.deliveries) {
          const packet = decodePacket(encoded);

          if ((yield* storage.get("delivery_receipts", packet.id)) === null) result.push(packet);
        }

        return result;
      });

      const acknowledged = Effect.gen(function* () {
        const result: Array<RemoteDeliveryPacket> = [];

        for (const encoded of yield* storage.deliveryReceipts) {
          const receipt = decodeReceipt(encoded);
          const packet = yield* storage.get("deliveries", receipt.id);

          if (packet !== null) result.push(decodePacket(packet));
        }

        return result;
      });

      return RemoteDeliveries.of({
        watch: SubscriptionRef.changes(changes).pipe(Stream.mapEffect(() => pending)),
        acknowledged: SubscriptionRef.changes(changes).pipe(Stream.mapEffect(() => acknowledged)),
        send: Effect.fnUntraced(function* (packet) {
          if (packet.ownerHostId !== hostId)
            return yield* transferError("E-OWNER", "Only the owner can queue this input");
          const encoded = encodePacket(packet);
          const prior = yield* storage.get("deliveries", packet.id);

          if (prior !== null && prior !== encoded)
            return yield* transferError("E-IDEMPOTENCY", "This input ID names another delivery");
          yield* storage.put("deliveries", packet.id, encoded);
          yield* SubscriptionRef.update(changes, (n) => n + 1);
          yield* SubscriptionRef.changes(changes).pipe(
            Stream.mapEffect(() => storage.get("delivery_receipts", packet.id)),
            Stream.filter((value) => value !== null),
            Stream.take(1),
            Stream.runDrain
          );
        }),
        apply: (packet) =>
          serial.withPermits(1)(
            Effect.gen(function* () {
              if (packet.workerHostId !== hostId)
                return yield* transferError("E-ROUTE", "The input targets another worker Host");
              const hash = packetHash(packet);
              const prior = yield* storage.get("delivered", packet.id);

              if (prior !== null) {
                const receipt = decodeReceipt(prior);

                if (receipt.packetHash !== hash)
                  return yield* transferError(
                    "E-IDEMPOTENCY",
                    "This input ID already delivered another payload"
                  );

                return receipt;
              }

              const assignment = (yield* storage.assignments).find(
                (a) =>
                  a.graph.id === packet.constellationId &&
                  a.attemptId === packet.attemptId &&
                  a.graph.hostId === packet.ownerHostId &&
                  assignmentAttempt(a).sessionId === packet.sessionId
              );

              if (assignment === undefined)
                return yield* transferError(
                  "E-ASSIGNMENT",
                  "The input has no registered remote worker binding",
                  true
                );
              yield* storage.put("intents", `delivery:${packet.id}`, encodePacket(packet));
              yield* hooks.apply(packet);
              const receipt = RemoteDeliveryReceipt.make({ id: packet.id, packetHash: hash });
              yield* storage.put("delivered", packet.id, Schema.encodeSync(receiptCodec)(receipt));

              return receipt;
            })
          ),
        ack: Effect.fnUntraced(function* (receipt) {
          const encoded = yield* storage.get("deliveries", receipt.id);

          if (encoded === null || packetHash(decodePacket(encoded)) !== receipt.packetHash)
            return yield* transferError(
              "E-RECEIPT",
              "The input receipt does not match the queued delivery"
            );
          yield* storage.put(
            "delivery_receipts",
            receipt.id,
            Schema.encodeSync(receiptCodec)(receipt)
          );
          yield* SubscriptionRef.update(changes, (n) => n + 1);
        }),
      });
    })
  );
}
